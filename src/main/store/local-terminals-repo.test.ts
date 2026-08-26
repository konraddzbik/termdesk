import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('local-terminals-repo', () => {
  let dir: string
  let repo: typeof import('./local-terminals-repo')
  let dbMod: typeof import('./db')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-localterm-'))
    process.env.SSHDECK_DB_PATH = join(dir, 'sshdeck.db')
    vi.resetModules()
    dbMod = await import('./db')
    repo = await import('./local-terminals-repo')
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

  it('creates with a null name and reads it back', () => {
    const saved = repo.createLocalTerminal({ path: '/Users/k/git/app' })
    expect(saved.name).toBeNull()
    expect(saved.path).toBe('/Users/k/git/app')
    expect(repo.listLocalTerminals()).toHaveLength(1)
  })

  it('updates name and path', () => {
    const saved = repo.createLocalTerminal({ path: '/a/b' })
    const updated = repo.updateLocalTerminal(saved.id, { name: 'My app', path: '/a/c' })
    expect(updated.name).toBe('My app')
    expect(updated.path).toBe('/a/c')
  })

  it('orders by sortOrder then path', () => {
    repo.createLocalTerminal({ path: '/z', sortOrder: 0 })
    repo.createLocalTerminal({ path: '/a', sortOrder: 0 })
    repo.createLocalTerminal({ path: '/m', sortOrder: -1 })
    expect(repo.listLocalTerminals().map((e) => e.path)).toEqual(['/m', '/a', '/z'])
  })

  it('deletes an entry', () => {
    const saved = repo.createLocalTerminal({ path: '/a/b' })
    repo.deleteLocalTerminal(saved.id)
    expect(repo.listLocalTerminals()).toHaveLength(0)
  })

  it('reorders entries by the given id order and persists it', () => {
    const a = repo.createLocalTerminal({ path: '/a' })
    const b = repo.createLocalTerminal({ path: '/b' })
    const c = repo.createLocalTerminal({ path: '/c' })
    const reordered = repo.reorderLocalTerminals([c.id, a.id, b.id])
    expect(reordered.map((e) => e.path)).toEqual(['/c', '/a', '/b'])
    // Order survives a fresh read (it was written, not just returned).
    expect(repo.listLocalTerminals().map((e) => e.path)).toEqual(['/c', '/a', '/b'])
  })

  it('ignores unknown ids when reordering', () => {
    const a = repo.createLocalTerminal({ path: '/a' })
    const b = repo.createLocalTerminal({ path: '/b' })
    const reordered = repo.reorderLocalTerminals(['missing', b.id, a.id])
    expect(reordered.map((e) => e.path)).toEqual(['/b', '/a'])
  })
})
