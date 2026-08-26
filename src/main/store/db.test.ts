import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

// The bundled better-sqlite3 binary is rebuilt for Electron's ABI by the
// postinstall hook, so plain-Node test workers cannot load it. Probe first;
// on ABI mismatch fall back to the Node prebuild cached by prebuild-install,
// injected through the `nativeBinding` option (node_modules stays untouched).
vi.mock('better-sqlite3', async () => {
  // better-sqlite3 uses `export =`, so the runtime ESM shape is { default: ctor }.
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
    renameSync(staging, nativePath) // atomic — safe across parallel test workers
  }
  function Wrapped(filename?: string, options?: Record<string, unknown>) {
    return new actual(filename, { ...options, nativeBinding: nativePath })
  }
  Wrapped.prototype = actual.prototype
  return { default: Wrapped as unknown as typeof actual }
})

/** hosts table as it looked before the proxy_jump / vnc_* columns existed. */
const LEGACY_DDL = `
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE hosts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  hostname TEXT NOT NULL,
  username TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('password','key','agent')),
  key_path TEXT,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  color TEXT,
  password_enc BLOB,
  passphrase_enc BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

describe('db', () => {
  let dir: string
  let dbPath: string
  let mod: typeof import('./db') | null

  const load = async (): Promise<typeof import('./db')> => {
    mod = await import('./db')
    return mod
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-db-'))
    dbPath = join(dir, 'sshdeck.db')
    process.env.SSHDECK_DB_PATH = dbPath
    mod = null
    vi.resetModules()
  })

  afterEach(() => {
    try {
      mod?.getSqlite().close()
    } catch {
      // already closed or never opened
    }
    delete process.env.SSHDECK_DB_PATH
    rmSync(dir, { recursive: true, force: true })
  })

  it('bootstraps all four tables on first open', async () => {
    const { getSqlite } = await load()
    const rows = getSqlite()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>
    const names = rows.map((r) => r.name)
    for (const table of ['groups', 'hosts', 'snippets', 'known_hosts']) {
      expect(names).toContain(table)
    }
  })

  it('enables WAL journal mode and foreign key enforcement', async () => {
    const { getSqlite } = await load()
    const handle = getSqlite()
    expect(handle.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(handle.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it("widens the hosts.kind CHECK to allow 'rdp' on a pre-RDP database", async () => {
    // Seed a pre-RDP hosts table whose CHECK rejects 'rdp', plus one existing row.
    const seed = new Database(dbPath)
    seed.exec(`
      CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE hosts (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, hostname TEXT NOT NULL, username TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        auth_type TEXT NOT NULL CHECK (auth_type IN ('password','key','agent')),
        key_path TEXT, proxy_jump TEXT, default_path TEXT,
        kind TEXT NOT NULL DEFAULT 'ssh' CHECK (kind IN ('ssh','vnc','both')),
        vnc_port INTEGER, vnc_mode TEXT NOT NULL DEFAULT 'tunnel', vnc_password_enc BLOB,
        group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
        credential_id TEXT, tags TEXT NOT NULL DEFAULT '[]', color TEXT,
        password_enc BLOB, passphrase_enc BLOB, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO hosts (id, label, hostname, username, auth_type, kind, created_at, updated_at)
        VALUES ('h1', 'legacy', 'example.com', 'root', 'password', 'both', 1, 1);
    `)
    // The old CHECK must reject 'rdp' before migration.
    expect(() =>
      seed
        .prepare(
          "INSERT INTO hosts (id,label,hostname,username,auth_type,kind,created_at,updated_at) VALUES ('x','x','x','x','password','rdp',1,1)",
        )
        .run(),
    ).toThrow()
    seed.close()

    const { getSqlite } = await load()
    const handle = getSqlite()
    // The rebuilt table preserves the legacy row and now accepts an 'rdp' host.
    expect(handle.prepare("SELECT label FROM hosts WHERE id = 'h1'").get()).toEqual({
      label: 'legacy',
    })
    expect(() =>
      handle
        .prepare(
          "INSERT INTO hosts (id,label,hostname,username,auth_type,kind,rdp_mode,created_at,updated_at) VALUES ('r1','win','10.0.0.9','admin','password','rdp','direct',2,2)",
        )
        .run(),
    ).not.toThrow()
    const sql = (
      handle.prepare("SELECT sql FROM sqlite_master WHERE name='hosts'").get() as { sql: string }
    ).sql
    expect(sql).toContain("'rdp'")
  })

  it('snapshots the vault before rebuilding a populated hosts table', async () => {
    const seed = new Database(dbPath)
    seed.exec(`
      CREATE TABLE hosts (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, hostname TEXT NOT NULL, username TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        auth_type TEXT NOT NULL CHECK (auth_type IN ('password','key','agent')),
        kind TEXT NOT NULL DEFAULT 'ssh' CHECK (kind IN ('ssh','vnc','both')),
        tags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO hosts (id, label, hostname, username, auth_type, kind, created_at, updated_at)
        VALUES ('h1', 'precious', 'example.com', 'root', 'password', 'both', 1, 1);
    `)
    seed.close()

    const { getSqlite } = await load()
    const handle = getSqlite() // triggers bootstrap + the destructive rebuild

    // The seed table lacks key_path/color/password_enc entirely — the rebuild
    // must default those rather than abort startup, and keep the row.
    expect(handle.prepare("SELECT label, key_path FROM hosts WHERE id = 'h1'").get()).toEqual({
      label: 'precious',
      key_path: null,
    })

    const backups = readdirSync(dir).filter((f) => f.startsWith('sshdeck.db.bak-'))
    expect(backups).toHaveLength(1)

    // The snapshot must be a readable database still holding the pre-migration row.
    const snapshot = new Database(join(dir, backups[0] ?? ''), { readonly: true })
    expect(snapshot.prepare("SELECT label FROM hosts WHERE id = 'h1'").get()).toEqual({
      label: 'precious',
    })
    snapshot.close()
  })

  it('skips the snapshot when there is nothing to lose', async () => {
    const seed = new Database(dbPath)
    seed.exec(`
      CREATE TABLE hosts (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, hostname TEXT NOT NULL, username TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        auth_type TEXT NOT NULL CHECK (auth_type IN ('password','key','agent')),
        kind TEXT NOT NULL DEFAULT 'ssh' CHECK (kind IN ('ssh','vnc','both')),
        tags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
    `)
    seed.close()

    const { getSqlite } = await load()
    getSqlite()
    expect(readdirSync(dir).filter((f) => f.includes('.bak-'))).toHaveLength(0)
  })

  it('leaves a fresh database untouched — no rebuild, no snapshot', async () => {
    const { getSqlite } = await load()
    getSqlite()
    expect(readdirSync(dir).filter((f) => f.includes('.bak-'))).toHaveLength(0)
  })

  it('waits on a busy lock instead of throwing', async () => {
    const { getSqlite } = await load()
    expect(getSqlite().pragma('busy_timeout', { simple: true })).toBe(5000)
  })

  it('caches the handle and the drizzle instance', async () => {
    const { getSqlite, getDb } = await load()
    expect(getSqlite()).toBe(getSqlite())
    expect(getDb()).toBe(getDb())
  })

  it('migrates a legacy hosts table by adding proxy_jump and vnc_* columns', async () => {
    const legacy = new Database(dbPath)
    legacy.exec(LEGACY_DDL)
    legacy
      .prepare(
        `INSERT INTO hosts (id, label, hostname, username, auth_type, created_at, updated_at)
         VALUES ('old-1', 'old box', 'old.example.com', 'root', 'agent', 1, 1)`,
      )
      .run()
    legacy.close()

    const { getSqlite } = await load()
    const handle = getSqlite()
    const columns = (handle.pragma('table_info(hosts)') as Array<{ name: string }>).map(
      (c) => c.name,
    )
    for (const col of ['proxy_jump', 'vnc_port', 'vnc_mode', 'vnc_password_enc']) {
      expect(columns).toContain(col)
    }

    // Pre-existing rows survive and pick up the vnc_mode default.
    const row = handle.prepare("SELECT * FROM hosts WHERE id = 'old-1'").get() as Record<
      string,
      unknown
    >
    expect(row.label).toBe('old box')
    expect(row.vnc_mode).toBe('tunnel')
    expect(row.proxy_jump).toBeNull()
    expect(row.vnc_port).toBeNull()
    expect(row.vnc_password_enc).toBeNull()
  })

  it('enforces the known_hosts (host, port, key_type) unique index', async () => {
    const { getSqlite } = await load()
    const insert = getSqlite().prepare(
      `INSERT INTO known_hosts (id, host, port, key_type, fingerprint_sha256, added_at)
       VALUES (?, 'h', 22, 'ssh-ed25519', 'fp', 1)`,
    )
    insert.run('a')
    expect(() => insert.run('b')).toThrow(/UNIQUE/i)
  })
})
