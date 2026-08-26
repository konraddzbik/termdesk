import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** Read TERMDESK_* with SSHDECK_* fallback for existing dev/CI scripts. */
export function envFlag(name: string): string | undefined {
  return process.env[`TERMDESK_${name}`] ?? process.env[`SSHDECK_${name}`]
}

/**
 * Like {@link envFlag}, but honored ONLY in unpackaged (dev/CI) builds. Packaged
 * installers ignore it entirely, so a shipped app cannot have its vault path,
 * settings path or download URL repointed at attacker-controlled values through
 * the environment. `app.isPackaged` is false under `electron .` and vitest.
 */
export function devEnvFlag(name: string): string | undefined {
  return app.isPackaged ? undefined : envFlag(name)
}

/**
 * Keeps hosts/settings when upgrading from the sshdeck-branded userData folder.
 * Must run before app.whenReady() (before any app.getPath('userData') use).
 */
export function configureUserDataPath(): void {
  const appData = app.getPath('appData')
  const termdeskDir = join(appData, 'termdesk')
  const legacyDir = join(appData, 'sshdeck')
  if (!existsSync(termdeskDir) && existsSync(legacyDir)) {
    app.setPath('userData', legacyDir)
    // The sshdeck-era vault's secrets are encrypted with safeStorage, whose key
    // is derived from app.name and cached on first use. The rebrand to TermDesk
    // changed app.name, orphaning those secrets ("Error while decrypting…"), so
    // when we adopt the legacy vault we must also adopt the legacy app name —
    // before any secret is read — so safeStorage uses the matching Keychain key.
    // On macOS the visible app menu name comes from the bundle, so packaged
    // builds still display "TermDesk".
    app.setName('sshdeck')
    return
  }
  app.setPath('userData', termdeskDir)
}
