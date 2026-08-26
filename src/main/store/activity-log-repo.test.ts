import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityInput } from './activity-log-repo'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

// better-sqlite3 ABI shim shared with the other store tests.
vi.mock('better-sqlite3', async () => {
  const actual = (
    (await vi.importActual('better-sqlite3')) as unknown as {
      default: typeof import('better-sqlite3')
    }
  ).default
  try {
    new actual(':memory:').close()
    return { default: actual }
  } catch {
    // ABI mismatch — fall through to the cached Node prebuild.
  }
  const { execFileSync } = await import('node:child_process')
  const { existsSync, readdirSync, renameSync, writeFileSync } = await import('node:fs')
  const { createRequire } = await import('node:module')
  const { homedir, tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const pkg = createRequire(import.meta.url)('better-sqlite3/package.json') as { version: string }
  const abi = process.versions.modules
  const suffix = `better-sqlite3-v${pkg.version}-node-v${abi}-${process.platform}-${process.arch}.tar.gz`
  const nativePath = join(tmpdir(), `sshdeck-test-better_sqlite3-v${pkg.version}-node-v${abi}.node`)
  if (!existsSync(nativePath)) {
    const cacheDir = join(homedir(), '.npm', '_prebuilds')
    const tarball = readdirSync(cacheDir).find((f) => f.endsWith(suffix))
    if (!tarball) {
      throw new Error(
        `better-sqlite3 native binary targets Electron and no Node prebuild *${suffix} is cached in ${cacheDir}`,
      )
    }
    const bytes = execFileSync(
      'tar',
      ['-xzOf', join(cacheDir, tarball), 'build/Release/better_sqlite3.node'],
      { maxBuffer: 256 * 1024 * 1024 },
    )
    const staging = `${nativePath}.${process.pid}.tmp`
    writeFileSync(staging, bytes)
    renameSync(staging, nativePath)
  }
  function Wrapped(filename?: string, options?: Record<string, unknown>) {
    return new actual(filename, { ...options, nativeBinding: nativePath })
  }
  Wrapped.prototype = actual.prototype
  return { default: Wrapped as unknown as typeof actual }
})

describe('activity-log-repo', () => {
  let dir: string
  let repo: typeof import('./activity-log-repo')
  let dbMod: typeof import('./db')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-log-'))
    process.env.SSHDECK_DB_PATH = join(dir, 'sshdeck.db')
    vi.resetModules()
    dbMod = await import('./db')
    repo = await import('./activity-log-repo')
  })

  afterEach(() => {
    try {
      dbMod.getSqlite().close()
    } catch {
      // already closed
    }
    delete process.env.SSHDECK_DB_PATH
    rmSync(dir, { recursive: true, force: true })
  })

  const entry = (over: Partial<ActivityInput> = {}): ActivityInput => ({
    ts: Date.now(),
    action: 'connected',
    kind: 'ssh',
    hostId: 'h1',
    hostLabel: 'web',
    hostSubtitle: 'ssh',
    detail: null,
    user: 'a@b.com',
    device: 'Mac',
    ...over,
  })

  it('records and reads back an entry', () => {
    const rec = repo.recordActivity(entry({ action: 'sftp-open', kind: 'sftp' }))
    expect(rec.id).toBeTruthy()
    const all = repo.listActivity()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ action: 'sftp-open', kind: 'sftp', hostLabel: 'web' })
  })

  it('lists newest-first by timestamp', () => {
    repo.recordActivity(entry({ ts: 1000, hostLabel: 'old' }))
    repo.recordActivity(entry({ ts: 3000, hostLabel: 'new' }))
    repo.recordActivity(entry({ ts: 2000, hostLabel: 'mid' }))
    expect(repo.listActivity().map((e) => e.hostLabel)).toEqual(['new', 'mid', 'old'])
  })

  it('respects the list limit', () => {
    for (let i = 0; i < 5; i++) repo.recordActivity(entry({ ts: i }))
    expect(repo.listActivity(2)).toHaveLength(2)
  })

  it('clears all entries', () => {
    repo.recordActivity(entry())
    repo.recordActivity(entry())
    repo.clearActivity()
    expect(repo.listActivity()).toHaveLength(0)
  })
})
