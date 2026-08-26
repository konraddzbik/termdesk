import { execFile } from 'node:child_process'
import type { TerminalProgramInfo } from '@shared/ipc'

/**
 * Terminal-program integration: the user picks *what runs* when a terminal
 * opens — the plain login shell (`default`), a multiplexer (tmux / Zellij /
 * screen), or an alternate shell (bash / zsh / fish / PowerShell / Nushell).
 *
 * Shared by the local-terminal manager (spawns the program in a PTY on this
 * machine) and the SSH session manager (execs into it on the remote when
 * present). Two orthogonal notions:
 *  - **chosen** — the user's `terminalProgram` setting.
 *  - **available** — whether the program's binary exists on a given machine.
 * Local terminals require both (probed here); remote sessions only consult the
 * setting and guard with `command -v` on the remote (buildRemoteInitCommand).
 */

export type TerminalProgramKind = 'shell' | 'multiplexer'

export interface TerminalProgramDef {
  /** Stable id persisted in settings (see TERMINAL_PROGRAM_IDS in shared/ipc). */
  readonly id: string
  /** Human label for the Settings dropdown. */
  readonly label: string
  /** Executable probed on PATH locally and exec'd (guarded) on the remote. */
  readonly bin: string
  readonly kind: TerminalProgramKind
}

/**
 * Fixed multiplexer session name used for REMOTE sessions, so reconnecting to a
 * host re-attaches the same session (persistence across disconnects). Local
 * sessions use a per-tab name instead (each tab is its own session).
 */
export const REMOTE_MUX_SESSION = 'termdesk'

/**
 * Known terminal programs, in the order shown in Settings. Multiplexers wrap the
 * shell (attach-or-create, survive disconnects); shells simply replace which
 * shell runs. `default` (the login shell) is implicit and not listed here.
 */
export const TERMINAL_PROGRAMS: readonly TerminalProgramDef[] = [
  { id: 'tmux', label: 'tmux', bin: 'tmux', kind: 'multiplexer' },
  { id: 'zellij', label: 'Zellij', bin: 'zellij', kind: 'multiplexer' },
  { id: 'screen', label: 'GNU Screen', bin: 'screen', kind: 'multiplexer' },
  { id: 'bash', label: 'bash', bin: 'bash', kind: 'shell' },
  { id: 'zsh', label: 'zsh', bin: 'zsh', kind: 'shell' },
  { id: 'fish', label: 'fish', bin: 'fish', kind: 'shell' },
  { id: 'pwsh', label: 'PowerShell', bin: 'pwsh', kind: 'shell' },
  { id: 'nu', label: 'Nushell', bin: 'nu', kind: 'shell' },
]

/** The program def for an id, or undefined for `default`/unknown ids. */
export function findProgram(id: string): TerminalProgramDef | undefined {
  return TERMINAL_PROGRAMS.find((p) => p.id === id)
}

/**
 * node-pty argv for a fresh LOCAL session of a multiplexer. `sessionName` is
 * unique per tab so tabs don't mirror one another. Shells take no extra args
 * (they launch interactively).
 */
export function localProgramArgs(def: TerminalProgramDef, sessionName: string): string[] {
  switch (def.id) {
    case 'tmux':
      return ['new-session', '-A', '-s', sessionName]
    case 'zellij':
      return ['attach', '--create', sessionName]
    case 'screen':
      return ['-D', '-R', sessionName]
    default:
      return []
  }
}

/** Remote multiplexer argv, using the shared persistent session name. */
function remoteMuxArgs(def: TerminalProgramDef): string[] {
  switch (def.id) {
    case 'tmux':
      return ['new-session', '-A', '-s', REMOTE_MUX_SESSION]
    case 'zellij':
      return ['attach', '--create', REMOTE_MUX_SESSION]
    case 'screen':
      return ['-D', '-R', REMOTE_MUX_SESSION]
    default:
      return []
  }
}

/**
 * Single-quotes a string for safe interpolation into a POSIX shell command,
 * escaping embedded single quotes via the `'\''` idiom.
 */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * The remote `exec` fragment that swaps the login shell for the chosen program
 * — but ONLY when that program exists on the remote (`command -v` guard), else
 * the normal shell is kept. Null for `default` and unknown ids.
 */
export function remoteExecFragment(programId: string): string | null {
  if (programId === 'default') return null
  const def = findProgram(programId)
  if (!def) return null
  const args = def.kind === 'multiplexer' ? remoteMuxArgs(def) : []
  const cmd = [def.bin, ...args].join(' ')
  return `command -v ${def.bin} >/dev/null 2>&1 && exec ${cmd}`
}

/**
 * Builds the shell line written into a freshly-opened SSH shell to apply the
 * host's default path and/or the chosen terminal program, or null when neither
 * applies.
 *
 * - `cd` into the default path first (best-effort; a missing dir is ignored) so
 *   the program — and the interactive shell — start there.
 * - The program `exec`s only when its binary exists on the remote; otherwise the
 *   `command -v` guard short-circuits and the normal shell is kept. Reconnecting
 *   re-attaches the same multiplexer session.
 */
export function buildRemoteInitCommand(opts: {
  defaultPath: string | null
  program: string
}): string | null {
  const parts: string[] = []
  if (opts.defaultPath && opts.defaultPath.trim() !== '') {
    parts.push(`cd ${shellSingleQuote(opts.defaultPath)} 2>/dev/null`)
  }
  const frag = remoteExecFragment(opts.program)
  if (frag) parts.push(frag)
  return parts.length > 0 ? parts.join('; ') : null
}

// ---------------------------------------------------------------------------
// Local availability detection
// ---------------------------------------------------------------------------

/** bin → whether it exists on PATH (populated by probeProgram). */
const availability = new Map<string, boolean>()
const inFlight = new Map<string, Promise<boolean>>()

/**
 * Whether `bin` is installed on THIS machine. Cached after the first probe;
 * concurrent callers share one probe. A binary that runs but rejects `--version`
 * (e.g. tmux wants `-V`) still counts as installed — only "not found / not
 * executable" marks it unavailable.
 */
export function probeProgram(bin: string): Promise<boolean> {
  const cached = availability.get(bin)
  if (cached !== undefined) return Promise.resolve(cached)
  const flying = inFlight.get(bin)
  if (flying) return flying
  const probe = new Promise<boolean>((resolve) => {
    execFile(bin, ['--version'], { timeout: 2000 }, (err) => {
      // "Assume installed unless clearly missing": only ENOENT/EACCES mean the
      // binary isn't there. A non-zero exit (wrong flag), or a 2000ms timeout
      // kill (SIGTERM, no `code`), still means the binary EXISTS → available.
      const missing = !!err && (err.code === 'ENOENT' || err.code === 'EACCES')
      const ok = !missing
      availability.set(bin, ok)
      inFlight.delete(bin)
      resolve(ok)
    })
  })
  inFlight.set(bin, probe)
  return probe
}

/**
 * Last known local availability of `bin` without awaiting a probe (false until
 * the first probe resolves). Used by the synchronous local-terminal open path;
 * call prewarmTerminalPrograms() at startup so this is populated in time.
 */
export function isProgramAvailableSync(bin: string): boolean {
  return availability.get(bin) === true
}

/**
 * Resolve the LOCAL program to launch for a chosen id, or null to fall back to
 * the login shell (chosen `default`, unknown id, or the program isn't installed
 * on this machine).
 */
export function resolveLocalProgram(id: string): TerminalProgramDef | null {
  if (id === 'default') return null
  const def = findProgram(id)
  if (!def || !isProgramAvailableSync(def.bin)) return null
  return def
}

/** Probe every known program and report which are installed (for the UI). */
export function detectTerminalPrograms(): Promise<TerminalProgramInfo[]> {
  return Promise.all(
    TERMINAL_PROGRAMS.map(async (p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      available: await probeProgram(p.bin),
    })),
  )
}

/** Kick off probes so isProgramAvailableSync() is populated before first use. */
export function prewarmTerminalPrograms(): void {
  void detectTerminalPrograms()
}
