import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appMock = { isPackaged: false, getPath: () => '/tmp', setPath: vi.fn(), setName: vi.fn() }
vi.mock('electron', () => ({ app: appMock }))

const MAIN_DIR = join(fileURLToPath(new URL('.', import.meta.url)))

describe('devEnvFlag', () => {
  beforeEach(() => {
    appMock.isPackaged = false
    delete process.env.TERMDESK_SMOKE
    delete process.env.SSHDECK_SMOKE
  })

  it('reads TERMDESK_* and falls back to SSHDECK_* when unpackaged', async () => {
    const { devEnvFlag } = await import('./app-paths')
    process.env.SSHDECK_SMOKE = 'ssh'
    expect(devEnvFlag('SMOKE')).toBe('ssh')
    process.env.TERMDESK_SMOKE = 'vault'
    expect(devEnvFlag('SMOKE')).toBe('vault')
  })

  // The security property: a shipped installer must not let the environment
  // reach behaviour that only the dev/CI harnesses are allowed to reach —
  // above all the SSH host-key prompt, which TERMDESK_SMOKE turns into silent
  // trust-on-first-use (see session-manager.verifyHostKey).
  it('ignores the environment entirely in a packaged build', async () => {
    const { devEnvFlag } = await import('./app-paths')
    appMock.isPackaged = true
    process.env.TERMDESK_SMOKE = 'ssh'
    process.env.SSHDECK_SMOKE = 'ssh'
    expect(devEnvFlag('SMOKE')).toBeUndefined()
  })
})

describe('main-process env-flag discipline', () => {
  // A bare `process.env.TERMDESK_*` read bypasses the app.isPackaged guard, which
  // is exactly how the host-key auto-trust once became reachable in a packaged
  // build. Every read goes through envFlag/devEnvFlag so that the "does a
  // packaged installer honor this?" decision is made in one reviewable place.
  const ALLOWED = /(^|\/)app-paths\.ts$/

  function walk(dir: string): string[] {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
    return readdirSync(dir).flatMap((entry: string) => {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) return walk(full)
      return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : []
    })
  }

  it('reads TERMDESK_*/SSHDECK_* only through envFlag/devEnvFlag', () => {
    const offenders = walk(MAIN_DIR)
      .filter((f) => !ALLOWED.test(f.replace(MAIN_DIR, '')))
      .filter((f) => /process\.env\.(TERMDESK|SSHDECK)_/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(MAIN_DIR, ''))

    expect(offenders).toEqual([])
  })
})
