import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type Settings, type SettingsPatch, settingsSchema } from '@shared/ipc'
import { app } from 'electron'
import { devEnvFlag } from '../app-paths'

/**
 * App settings — a small JSON file in userData. No secrets ever live here;
 * those belong to the safeStorage-encrypted vault.
 */

let cached: Settings | null = null

function settingsPath(): string {
  // Dev/CI hook only — a packaged build must not let its environment repoint
  // settings at a substituted file (same reasoning as the vault path).
  return devEnvFlag('SETTINGS_PATH') ?? join(app.getPath('userData'), 'settings.json')
}

/**
 * Parse a raw settings object without ever discarding valid fields. The whole
 * schema is tried first (the common case). If it fails — because ONE field holds
 * a value a newer app version no longer accepts (a removed enum value, a
 * tightened range, a changed shape) — we must NOT reset every setting: we keep
 * each field that still validates on its own and default only the offending (or
 * missing) ones. Without this, installing a new version that narrows any single
 * field would silently wipe the user's entire configuration on next launch.
 */
function parseSettingsResilient(raw: unknown): Settings {
  const whole = settingsSchema.safeParse(raw)
  if (whole.success) return whole.data
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const kept: Record<string, unknown> = {}
  const shape = settingsSchema.shape
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    if (!(key in source)) continue
    // Validate each field in isolation and keep the ORIGINAL value, so the final
    // full parse below applies defaults + transforms uniformly. Invalid fields
    // are dropped here and picked up as defaults by that parse.
    if (shape[key].safeParse(source[key]).success) kept[key as string] = source[key]
  }
  return settingsSchema.parse(kept)
}

export function getSettings(): Settings {
  if (cached) return cached
  let raw: unknown = {}
  try {
    raw = JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    // missing or corrupt file → defaults
  }
  cached = parseSettingsResilient(raw)
  // Migrate the legacy `tmuxEnabled` toggle to `terminalProgram`, but only when
  // the file predates `terminalProgram` and had tmux turned on. Applied on read
  // (patches the in-memory cache) until the next settings write persists it;
  // idempotent, so re-applying each launch is harmless.
  if (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>).terminalProgram === undefined &&
    (raw as Record<string, unknown>).tmuxEnabled === true
  ) {
    cached = { ...cached, terminalProgram: 'tmux' }
  }
  return cached
}

export function updateSettings(patch: SettingsPatch): Settings {
  const next = settingsSchema.parse({ ...getSettings(), ...patch })
  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  // Write-then-rename. A plain writeFileSync truncates first, so a crash or a
  // full disk mid-write leaves a half-JSON file — which parses as nothing and
  // silently resets every setting, exactly the outcome parseSettingsResilient
  // exists to prevent. rename() is atomic within a directory.
  const staging = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(staging, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(staging, path)
  } catch (err) {
    try {
      rmSync(staging, { force: true })
    } catch {
      // nothing more to do
    }
    throw err
  }
  cached = next
  return next
}
