import { execFile, spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { ExternalTerminalInfo } from '@shared/ipc'

/**
 * External terminal emulators (Ghostty, Warp, iTerm2, kitty, …). Unlike the
 * in-tab terminal programs (shells/multiplexers that run *inside* TermDesk's
 * PTY), these are standalone GUI apps that draw their own windows and therefore
 * cannot be embedded — the integration is "open this directory in <app>",
 * launching the app detached at a chosen cwd.
 *
 * Detection deliberately never *runs* the emulator (that would pop a window):
 * macOS apps are checked with `open -Ra`, PATH binaries with `which`/`where`.
 */

type Platform = NodeJS.Platform

export interface ExternalTerminalDef {
  /** Stable id persisted in settings. */
  readonly id: string
  readonly label: string
  /** Platforms this emulator ships on (limits detection to the relevant OS). */
  readonly platforms: readonly Platform[]
  /** macOS LaunchServices app name for `open -Ra` / `open -a`, when present. */
  readonly macApp?: string
  /** PATH binary used on Linux/Windows for detection and launch. */
  readonly bin?: string
}

/** Known emulators, in the order shown in Settings. */
export const EXTERNAL_TERMINALS: readonly ExternalTerminalDef[] = [
  { id: 'terminal-app', label: 'Terminal (macOS)', platforms: ['darwin'], macApp: 'Terminal' },
  { id: 'iterm2', label: 'iTerm2', platforms: ['darwin'], macApp: 'iTerm' },
  {
    id: 'ghostty',
    label: 'Ghostty',
    platforms: ['darwin', 'linux'],
    macApp: 'Ghostty',
    bin: 'ghostty',
  },
  {
    id: 'warp',
    label: 'Warp',
    platforms: ['darwin', 'linux'],
    macApp: 'Warp',
    bin: 'warp-terminal',
  },
  { id: 'kitty', label: 'kitty', platforms: ['darwin', 'linux'], macApp: 'kitty', bin: 'kitty' },
  {
    id: 'alacritty',
    label: 'Alacritty',
    platforms: ['darwin', 'linux', 'win32'],
    macApp: 'Alacritty',
    bin: 'alacritty',
  },
  {
    id: 'wezterm',
    label: 'WezTerm',
    platforms: ['darwin', 'linux', 'win32'],
    macApp: 'WezTerm',
    bin: 'wezterm',
  },
  { id: 'gnome-terminal', label: 'GNOME Terminal', platforms: ['linux'], bin: 'gnome-terminal' },
  { id: 'konsole', label: 'Konsole', platforms: ['linux'], bin: 'konsole' },
  { id: 'windows-terminal', label: 'Windows Terminal', platforms: ['win32'], bin: 'wt' },
]

export function findExternalTerminal(id: string): ExternalTerminalDef | undefined {
  return EXTERNAL_TERMINALS.find((t) => t.id === id)
}

/** A resolved launch plan: what to spawn (detached) to open `cwd`. */
export interface LaunchPlan {
  file: string
  args: string[]
  /** Working directory for the spawned process (so flag-less emulators inherit it). */
  cwd: string
}

/**
 * Build the command that opens `cwd` in emulator `id` on `platform`, or null
 * when that emulator isn't supported on the platform. Pure (no spawning), so the
 * per-emulator argv is unit-testable.
 *
 * macOS goes through `open` (LaunchServices); `-n -a App --args …` forwards flags
 * to the app's own CLI where a bare `open -a App <dir>` wouldn't set the cwd.
 * Linux/Windows call the binary directly with its cwd flag, and also set the
 * spawn cwd as a fallback for emulators without one (e.g. Warp on Linux).
 */
export function buildLaunch(id: string, platform: Platform, cwd: string): LaunchPlan | null {
  const def = findExternalTerminal(id)
  if (!def?.platforms.includes(platform)) return null

  if (platform === 'darwin') {
    const app = def.macApp
    if (!app) return null
    switch (id) {
      case 'ghostty':
        return {
          file: 'open',
          args: ['-n', '-a', app, '--args', `--working-directory=${cwd}`],
          cwd,
        }
      case 'kitty':
        return { file: 'open', args: ['-n', '-a', app, '--args', '--directory', cwd], cwd }
      case 'alacritty':
        return { file: 'open', args: ['-n', '-a', app, '--args', '--working-directory', cwd], cwd }
      case 'wezterm':
        return { file: 'open', args: ['-n', '-a', app, '--args', 'start', '--cwd', cwd], cwd }
      default:
        // Terminal & iTerm2 register as LaunchServices folder handlers, so
        // `open -a <App> <dir>` opens a new window cd'd to <dir>. Warp goes
        // through the same path (best-effort): if it isn't the folder handler it
        // may open at its last/home dir instead — acceptable, still opens Warp.
        return { file: 'open', args: ['-a', app, cwd], cwd }
    }
  }

  // Linux / Windows: invoke the binary directly.
  const bin = def.bin
  if (!bin) return null
  switch (id) {
    case 'ghostty':
      return { file: bin, args: [`--working-directory=${cwd}`], cwd }
    case 'kitty':
      return { file: bin, args: ['--directory', cwd], cwd }
    case 'alacritty':
      return { file: bin, args: ['--working-directory', cwd], cwd }
    case 'wezterm':
      return { file: bin, args: ['start', '--cwd', cwd], cwd }
    case 'gnome-terminal':
      return { file: bin, args: [`--working-directory=${cwd}`], cwd }
    case 'konsole':
      return { file: bin, args: ['--workdir', cwd], cwd }
    case 'windows-terminal':
      return { file: bin, args: ['-d', cwd], cwd }
    default:
      // Warp on Linux and any other flag-less emulator: rely on the spawn cwd.
      return { file: bin, args: [], cwd }
  }
}

// ---------------------------------------------------------------------------
// Detection (never executes the emulator itself)
// ---------------------------------------------------------------------------

// Availability is cached for the app's lifetime (never invalidated): an emulator
// installed after launch isn't picked up until restart. Fine given prewarm.
const availability = new Map<string, boolean>()
const inFlight = new Map<string, Promise<boolean>>()

function macAppInstalled(app: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('open', ['-Ra', app], { timeout: 2000 }, (err) => resolve(!err))
  })
}

function binOnPath(bin: string): Promise<boolean> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    execFile(finder, [bin], { timeout: 2000 }, (err) => resolve(!err))
  })
}

/** Whether emulator `def` is installed on THIS machine (cached by id). */
function isInstalled(def: ExternalTerminalDef): Promise<boolean> {
  const cached = availability.get(def.id)
  if (cached !== undefined) return Promise.resolve(cached)
  const flying = inFlight.get(def.id)
  if (flying) return flying
  const probe = (async () => {
    let ok = false
    if (process.platform === 'darwin' && def.macApp) ok = await macAppInstalled(def.macApp)
    else if (def.bin) ok = await binOnPath(def.bin)
    availability.set(def.id, ok)
    inFlight.delete(def.id)
    return ok
  })()
  inFlight.set(def.id, probe)
  return probe
}

/** Detected emulators for the current platform, with availability. */
export function detectExternalTerminals(): Promise<ExternalTerminalInfo[]> {
  const onThisOs = EXTERNAL_TERMINALS.filter((t) => t.platforms.includes(process.platform))
  return Promise.all(
    onThisOs.map(async (t) => ({
      id: t.id,
      label: t.label,
      available: await isInstalled(t),
    })),
  )
}

/** Kick off detection so the picker and open-action are ready promptly. */
export function prewarmExternalTerminals(): void {
  void detectExternalTerminals()
}

/** A valid existing directory, else the home dir. */
function resolveCwd(cwd?: string | null): string {
  if (cwd) {
    try {
      if (statSync(cwd).isDirectory()) return cwd
    } catch {
      // fall through to home
    }
  }
  return homedir()
}

const OS_DEFAULT: Record<string, string> = {
  darwin: 'terminal-app',
  linux: 'gnome-terminal',
  win32: 'windows-terminal',
}

function supportedHere(id: string | undefined): boolean {
  return !!id && !!findExternalTerminal(id)?.platforms.includes(process.platform)
}

/**
 * Choose which emulator to open: an explicit `id`, else the saved preference
 * (both honored as-is when supported on this OS), else — with no explicit choice
 * — the OS default IF detection found it installed, else any installed emulator,
 * else the OS default as a last resort (which may then fail loudly via spawn).
 */
function pickTerminalId(preferred: string | undefined, saved: string): string | null {
  for (const candidate of [preferred, saved]) {
    if (supportedHere(candidate)) return candidate as string
  }
  const osDefault = OS_DEFAULT[process.platform]
  if (osDefault && availability.get(osDefault) === true) return osDefault
  const installed = EXTERNAL_TERMINALS.find(
    (t) => t.platforms.includes(process.platform) && availability.get(t.id) === true,
  )
  return installed?.id ?? osDefault ?? null
}

/**
 * Open `cwd` in an external terminal, spawned detached so it outlives TermDesk.
 * Resolves once the OS confirms the process spawned (`spawn` event) or the
 * launch fails (`error` event, e.g. ENOENT) — so a failure is reported, not
 * masked as success.
 */
export function openExternalTerminal(opts: {
  cwd?: string | null
  id?: string
  savedPreference: string
}): Promise<{ launched: boolean; error?: string }> {
  const id = pickTerminalId(opts.id, opts.savedPreference)
  if (!id) {
    return Promise.resolve({
      launched: false,
      error: 'No external terminal available on this platform',
    })
  }
  const plan = buildLaunch(id, process.platform, resolveCwd(opts.cwd))
  if (!plan) {
    return Promise.resolve({ launched: false, error: `Cannot launch ${id} on ${process.platform}` })
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: { launched: boolean; error?: string }): void => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    try {
      // No `shell` — args are passed as an array so a cwd with spaces/metachars
      // is never re-parsed by a shell (injection-safe by construction).
      const child = spawn(plan.file, plan.args, { cwd: plan.cwd, detached: true, stdio: 'ignore' })
      child.on('error', (err) => finish({ launched: false, error: err.message }))
      child.on('spawn', () => {
        child.unref()
        finish({ launched: true })
      })
    } catch (err) {
      finish({ launched: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}
