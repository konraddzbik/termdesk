import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) =>
      Buffer.from(`enc:${Buffer.from(s, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (b: Buffer) =>
      Buffer.from(b.toString('utf8').replace(/^enc:/, ''), 'base64').toString('utf8'),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}))

// Same better-sqlite3 ABI shim as the store tests: the bundled binary targets
// Electron's ABI, so fall back to the cached Node prebuild in plain-Node workers.
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

const SAMPLE = `
Host web1
  HostName 10.0.0.1
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_ed25519

Host db1
  HostName db.internal
  User postgres
`

describe('importFromContent', () => {
  let dir: string
  let mod: typeof import('./ssh-config')
  let repo: typeof import('../store/hosts-repo')
  let dbMod: typeof import('../store/db')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-sshcfg-'))
    process.env.SSHDECK_DB_PATH = join(dir, 'sshdeck.db')
    vi.resetModules()
    dbMod = await import('../store/db')
    repo = await import('../store/hosts-repo')
    mod = await import('./ssh-config')
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

  it('imports each Host block as an ssh host with mapped fields', () => {
    const result = mod.importFromContent(SAMPLE)
    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)

    const web1 = repo.listHosts().find((h) => h.label === 'web1')
    expect(web1).toMatchObject({
      hostname: '10.0.0.1',
      username: 'deploy',
      port: 2222,
      authType: 'key',
      kind: 'ssh',
    })
    expect(web1?.keyPath?.endsWith('/.ssh/id_ed25519')).toBe(true)

    // No IdentityFile → agent auth.
    const db1 = repo.listHosts().find((h) => h.label === 'db1')
    expect(db1).toMatchObject({ authType: 'agent', port: 22 })
  })

  it('skips entries whose label already exists (idempotent re-import)', () => {
    expect(mod.importFromContent(SAMPLE).imported).toBe(2)
    const second = mod.importFromContent(SAMPLE)
    expect(second.imported).toBe(0)
    expect(second.skipped).toBe(2)
    expect(repo.listHosts()).toHaveLength(2)
  })

  it('returns an empty result for content with no Host entries', () => {
    const result = mod.importFromContent('# just a comment\n')
    expect(result).toMatchObject({ imported: 0, skipped: 0 })
    expect(result.hosts).toEqual([])
  })

  it('inherits a Host * IdentityFile/User into concrete hosts (auth flips to key)', () => {
    // Documented behavior change: a Host * defaults block now flows its
    // IdentityFile + User onto every imported host, so a host with no key of
    // its own is imported as key auth (not agent).
    const result = mod.importFromContent(
      'Host *\n  IdentityFile ~/.ssh/id_shared\n  User gituser\n\nHost plain\n  HostName plain.example.com\n',
    )
    expect(result.imported).toBe(1)
    const plain = repo.listHosts().find((h) => h.label === 'plain')
    expect(plain).toMatchObject({ authType: 'key', username: 'gituser' })
    expect(plain?.keyPath?.endsWith('/.ssh/id_shared')).toBe(true)
  })

  it('follows an Include directive end-to-end into the vault (real fs)', async () => {
    const { resolveSshConfigIncludes } = await import('../ssh/ssh-config-include')
    const rootPath = join(dir, 'config')
    const includePath = join(dir, 'extra.conf')
    writeFileSync(includePath, 'Host included\n  HostName inc.example.com\n  User incuser\n')
    writeFileSync(rootPath, `Host main\n  HostName main.example.com\nInclude ${includePath}\n`)

    const resolved = await resolveSshConfigIncludes(rootPath)
    expect(resolved.filesRead).toBe(2)

    const result = mod.importFromContent(resolved.content)
    expect(result.imported).toBe(2)
    expect(
      repo
        .listHosts()
        .map((h) => h.label)
        .sort(),
    ).toEqual(['included', 'main'])
  })
})
