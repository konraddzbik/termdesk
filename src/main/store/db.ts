import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { devEnvFlag } from '../app-paths'
import * as schema from './schema'

/**
 * Idempotent bootstrap DDL mirroring `schema.ts` by hand for now.
 * drizzle-kit migrations replace this in a later phase — keep in sync.
 */
const BOOTSTRAP_DDL = `
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  parent_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'ssh' CHECK (type IN ('ssh','vnc')),
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('password','key','agent')),
  key_path TEXT,
  password_enc BLOB,
  passphrase_enc BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hosts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  hostname TEXT NOT NULL,
  username TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('password','key','agent')),
  key_path TEXT,
  proxy_jump TEXT,
  default_path TEXT,
  kind TEXT NOT NULL DEFAULT 'ssh' CHECK (kind IN ('ssh','vnc','rdp','both')),
  vnc_port INTEGER,
  vnc_mode TEXT NOT NULL DEFAULT 'tunnel' CHECK (vnc_mode IN ('tunnel','direct')),
  vnc_password_enc BLOB,
  rdp_port INTEGER,
  rdp_mode TEXT NOT NULL DEFAULT 'direct' CHECK (rdp_mode IN ('tunnel','direct')),
  rdp_password_enc BLOB,
  domain TEXT,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  credential_id TEXT REFERENCES credentials(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  color TEXT,
  password_enc BLOB,
  passphrase_enc BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  description TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  default_harness_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  harness_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'interactive',
  autonomy INTEGER NOT NULL DEFAULT 0,
  schedule TEXT NOT NULL DEFAULT '{"kind":"manual"}',
  variables TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_runs (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  exit_code INTEGER,
  summary TEXT,
  out_bytes INTEGER
);

CREATE INDEX IF NOT EXISTS routine_runs_routine_started_idx
  ON routine_runs(routine_id, started_at DESC);

CREATE TABLE IF NOT EXISTS automation_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  snippet_id TEXT,
  host_ids TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL,
  kind TEXT NOT NULL,
  host_id TEXT,
  host_label TEXT NOT NULL,
  host_subtitle TEXT,
  detail TEXT,
  user TEXT,
  device TEXT
);

CREATE INDEX IF NOT EXISTS activity_log_ts_idx ON activity_log(ts DESC);

CREATE TABLE IF NOT EXISTS ai_audit (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  client TEXT,
  tool TEXT NOT NULL,
  host_id TEXT,
  host_label TEXT,
  summary TEXT NOT NULL,
  verdict TEXT NOT NULL,
  outcome TEXT NOT NULL,
  detail TEXT,
  duration_ms INTEGER,
  in_bytes INTEGER,
  out_bytes INTEGER
);

CREATE INDEX IF NOT EXISTS ai_audit_ts_idx ON ai_audit(ts DESC);

CREATE TABLE IF NOT EXISTS local_terminals (
  id TEXT PRIMARY KEY,
  name TEXT,
  path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tunnels (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'local',
  listen_host TEXT NOT NULL DEFAULT '127.0.0.1',
  listen_port INTEGER NOT NULL,
  dst_host TEXT,
  dst_port INTEGER,
  name TEXT,
  auto_start INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS known_hosts (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  key_type TEXT NOT NULL,
  fingerprint_sha256 TEXT NOT NULL,
  added_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS known_hosts_host_port_key_type_unique ON known_hosts(host, port, key_type);

CREATE TABLE IF NOT EXISTS vnc_known_keys (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  fingerprint_sha256 TEXT NOT NULL,
  added_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS vnc_known_keys_host_port_unique ON vnc_known_keys(host, port);

CREATE TABLE IF NOT EXISTS rdp_known_certs (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  fingerprint_sha256 TEXT NOT NULL,
  added_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS rdp_known_certs_host_port_unique ON rdp_known_certs(host, port);
`

/**
 * Tiny additive migration guard for databases created before a column existed.
 * `CREATE TABLE IF NOT EXISTS` never alters existing tables, so newly added
 * nullable columns must be backfilled with ALTER TABLE.
 */
function ensureColumn(handle: Database.Database, table: string, column: string, ddl: string): void {
  const columns = handle.pragma(`table_info(${table})`) as Array<{ name: string }>
  if (!columns.some((col) => col.name === column)) {
    handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
  }
}

/** All `hosts` columns, by name — used to migrate the table without positional coupling. */
const HOSTS_COLUMNS = [
  'id',
  'label',
  'hostname',
  'username',
  'port',
  'auth_type',
  'key_path',
  'proxy_jump',
  'default_path',
  'kind',
  'vnc_port',
  'vnc_mode',
  'vnc_password_enc',
  'rdp_port',
  'rdp_mode',
  'rdp_password_enc',
  'domain',
  'group_id',
  'credential_id',
  'tags',
  'color',
  'password_enc',
  'passphrase_enc',
  'created_at',
  'updated_at',
]

/** Full CREATE for the current `hosts` schema, parameterized by table name (for rebuilds). */
function hostsTableDdl(name: string): string {
  return `CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  hostname TEXT NOT NULL,
  username TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('password','key','agent')),
  key_path TEXT,
  proxy_jump TEXT,
  default_path TEXT,
  kind TEXT NOT NULL DEFAULT 'ssh' CHECK (kind IN ('ssh','vnc','rdp','both')),
  vnc_port INTEGER,
  vnc_mode TEXT NOT NULL DEFAULT 'tunnel' CHECK (vnc_mode IN ('tunnel','direct')),
  vnc_password_enc BLOB,
  rdp_port INTEGER,
  rdp_mode TEXT NOT NULL DEFAULT 'direct' CHECK (rdp_mode IN ('tunnel','direct')),
  rdp_password_enc BLOB,
  domain TEXT,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  credential_id TEXT REFERENCES credentials(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  color TEXT,
  password_enc BLOB,
  passphrase_enc BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`
}

/** How many `*.bak-*` snapshots to keep beside the live database. */
const MAX_DB_BACKUPS = 3

/** App version used to name backups; `app.getVersion` is absent under vitest. */
function versionTag(): string {
  try {
    return typeof app?.getVersion === 'function' ? app.getVersion() : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Snapshot the vault before a *structural* migration touches it.
 *
 * `VACUUM INTO` is the right tool: it is synchronous, produces a single
 * consistent file (WAL content folded in, no `-wal`/`-shm` sidecars to keep
 * together) and cannot observe a half-written page. A plain file copy of a
 * WAL database can, which is why this is not `copyFileSync`.
 *
 * Best-effort by design: a missing backup must not stop the user's app from
 * opening, but a migration that eats the only copy of their hosts must never
 * happen silently either — so the failure is logged loudly.
 */
function backupDatabase(handle: Database.Database, dbPath: string, reason: string): void {
  const dest = `${dbPath}.bak-${versionTag()}`
  try {
    rmSync(dest, { force: true })
    // Single-quoted SQL string literal: escape embedded quotes. The path comes
    // from userData (or a dev env override), never from the renderer.
    handle.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
    try {
      chmodSync(dest, 0o600)
    } catch {
      // FS may not support chmod
    }
    console.log(`[db] backed up vault before ${reason} → ${basename(dest)}`)
    pruneBackups(dbPath)
  } catch (err) {
    console.error(
      `[db] WARNING: could not back up the vault before ${reason}:`,
      err instanceof Error ? err.message : err,
    )
  }
}

/** Keep only the newest {@link MAX_DB_BACKUPS} snapshots for this database. */
function pruneBackups(dbPath: string): void {
  try {
    const dir = dirname(dbPath)
    const prefix = `${basename(dbPath)}.bak-`
    const backups = readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .map((name) => join(dir, name))
      .sort()
    for (const stale of backups.slice(0, Math.max(0, backups.length - MAX_DB_BACKUPS))) {
      rmSync(stale, { force: true })
    }
  } catch {
    // pruning is housekeeping — never fatal
  }
}

/**
 * SQLite can't `ALTER` a CHECK constraint, so a DB created before RDP existed
 * still restricts `kind` to ('ssh','vnc','both') and would reject an 'rdp' host.
 * When the stored table SQL predates 'rdp', rebuild the table (data preserved,
 * columns matched by name) with the current schema. No-op on fresh/migrated DBs.
 * Requires the new columns to already exist (run after the rdp ensureColumn calls).
 *
 * The rebuild is the only destructive statement in the whole bootstrap, so it
 * takes a snapshot first and verifies referential integrity afterwards.
 */
function migrateHostsKindConstraint(handle: Database.Database, dbPath: string): void {
  const row = handle
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='hosts'")
    .get() as { sql?: string } | undefined
  const sql = row?.sql ?? ''
  // Only tables carrying the old kind CHECK need rebuilding; a table with no
  // kind CHECK, or one already listing 'rdp', is left untouched.
  if (!sql.includes('kind IN') || sql.includes("'rdp'")) return

  const hasRows = (handle.prepare('SELECT COUNT(*) AS n FROM hosts').get() as { n: number }).n > 0
  // Nothing to lose on an empty table — skip the snapshot, keep first run fast.
  if (hasRows) backupDatabase(handle, dbPath, 'the hosts table rebuild')

  // Copy only the columns the OLD table actually has. Naming all 25
  // unconditionally makes the INSERT — and therefore app startup — fail hard on
  // any database missing one; intersecting lets such a column fall back to its
  // DDL default instead of locking the user out of their vault.
  const existing = new Set(
    (handle.pragma('table_info(hosts)') as Array<{ name: string }>).map((c) => c.name),
  )
  const copied = HOSTS_COLUMNS.filter((c) => existing.has(c))
  const missing = HOSTS_COLUMNS.filter((c) => !existing.has(c))
  if (missing.length > 0) {
    console.warn(`[db] hosts rebuild: defaulting absent column(s) ${missing.join(', ')}`)
  }
  const cols = copied.join(', ')
  // A crashed earlier attempt cannot leave this behind (the rebuild is one
  // transaction), but an interrupted *older* build could — so start clean.
  handle.exec('DROP TABLE IF EXISTS hosts_rdp_migrate')
  handle.pragma('foreign_keys = OFF')
  try {
    handle.transaction(() => {
      handle.exec(hostsTableDdl('hosts_rdp_migrate'))
      handle.exec(`INSERT INTO hosts_rdp_migrate (${cols}) SELECT ${cols} FROM hosts`)
      handle.exec('DROP TABLE hosts')
      handle.exec('ALTER TABLE hosts_rdp_migrate RENAME TO hosts')
    })()
  } finally {
    handle.pragma('foreign_keys = ON')
  }
  // FKs were off during the rebuild; confirm nothing dangles now that they're
  // back on. Violations are reported, not repaired — the snapshot is the escape
  // hatch, and silently deleting a user's host rows would be worse.
  const violations = handle.pragma('foreign_key_check') as unknown[]
  if (violations.length > 0) {
    console.error(
      `[db] WARNING: ${violations.length} foreign-key violation(s) after the hosts rebuild`,
    )
  }
}

let sqlite: Database.Database | null = null
let db: BetterSQLite3Database<typeof schema> | null = null

/**
 * Explicit path override for the SMOKE harnesses.
 *
 * They must never write into a real vault, and they used to guarantee that by
 * setting `SSHDECK_DB_PATH` — which no longer works once that env var is
 * honored in dev builds only (a packaged app can still be put into smoke mode
 * via TERMDESK_SMOKE). An in-process override is independent of packaging, so
 * the guarantee holds either way.
 */
let smokeDbPath: string | null = null

/** Redirects the vault to `path`. Callable only before the first getSqlite(). */
export function setSmokeDbPath(path: string): void {
  if (sqlite) throw new Error('setSmokeDbPath: the database is already open')
  smokeDbPath = path
}

function resolveDbPath(): string {
  // app.getPath('userData') requires the app to be ready, hence the lazy init.
  // The override is a dev/CI hook and MUST stay one: honoring it in a packaged
  // build would let anything that can set the app's environment (a tampered
  // launcher, a wrapper on PATH) point TermDesk at a substituted vault, which
  // is the exact attack `devEnvFlag` exists to prevent for the license/update
  // endpoints. Vitest runs unpackaged, so tests keep working.
  if (smokeDbPath) return smokeDbPath
  const override = devEnvFlag('DB_PATH')
  if (override) return override
  const userData = app.getPath('userData')
  const primary = join(userData, 'termdesk.db')
  const legacy = join(userData, 'sshdeck.db')
  if (!existsSync(primary) && existsSync(legacy)) return legacy
  return primary
}

/** Raw better-sqlite3 handle. Prefer `getDb()`; this exists for pragmas and diagnostics. */
export function getSqlite(): Database.Database {
  if (sqlite) return sqlite

  const dbPath = resolveDbPath()
  mkdirSync(dirname(dbPath), { recursive: true })
  // Build against a LOCAL handle and publish it only once every pragma, the
  // bootstrap DDL and every migration has succeeded. `new Database()` merely
  // opens a file descriptor — it never reads a page — so a corrupt, truncated
  // or read-only file fails later, in the DDL. Assigning the module-level
  // handle first meant that failure left a permanently half-initialized,
  // cached connection: every later caller got an un-migrated vault back with
  // no error, for the rest of the session.
  const handle = new Database(dbPath)
  try {
    handle.pragma('journal_mode = WAL')
    handle.pragma('foreign_keys = ON')
    // WAL lets a reader and a writer coexist, but two *writers* still collide —
    // and nothing stops a second TermDesk process (or a dev build alongside the
    // packaged app) from opening this file. Wait for the lock instead of
    // throwing SQLITE_BUSY straight into the user's face.
    handle.pragma('busy_timeout = 5000')
    handle.exec(BOOTSTRAP_DDL)
    // Owner-only perms (after WAL is active so the sidecars exist): the DB holds
    // encrypted secrets plus plaintext host metadata (hostnames, usernames).
    // Restrict the parent directory too — SQLite can recreate the -wal/-shm
    // sidecars later with default perms, so a 0700 dir is the durable guarantee.
    // Best-effort; chmod is a no-op on Windows.
    try {
      chmodSync(dirname(dbPath), 0o700)
    } catch {
      // FS may not support chmod
    }
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        chmodSync(p, 0o600)
      } catch {
        // sidecar may not exist yet, or the FS may not support chmod
      }
    }
    ensureColumn(handle, 'hosts', 'proxy_jump', 'TEXT')
    ensureColumn(handle, 'hosts', 'default_path', 'TEXT')
    ensureColumn(handle, 'hosts', 'kind', "TEXT NOT NULL DEFAULT 'ssh'")
    ensureColumn(handle, 'hosts', 'vnc_port', 'INTEGER')
    ensureColumn(handle, 'hosts', 'vnc_mode', "TEXT NOT NULL DEFAULT 'tunnel'")
    ensureColumn(handle, 'hosts', 'vnc_password_enc', 'BLOB')
    ensureColumn(
      handle,
      'hosts',
      'credential_id',
      'TEXT REFERENCES credentials(id) ON DELETE SET NULL',
    )
    ensureColumn(handle, 'groups', 'parent_id', 'TEXT REFERENCES groups(id) ON DELETE SET NULL')
    ensureColumn(handle, 'credentials', 'type', "TEXT NOT NULL DEFAULT 'ssh'")
    // RDP columns (added before the CHECK rebuild so the rebuild can copy them).
    ensureColumn(handle, 'hosts', 'rdp_port', 'INTEGER')
    ensureColumn(handle, 'hosts', 'rdp_mode', "TEXT NOT NULL DEFAULT 'direct'")
    ensureColumn(handle, 'hosts', 'rdp_password_enc', 'BLOB')
    ensureColumn(handle, 'hosts', 'domain', 'TEXT')
    ensureColumn(handle, 'ai_audit', 'in_bytes', 'INTEGER')
    ensureColumn(handle, 'ai_audit', 'out_bytes', 'INTEGER')
    // Widen the kind CHECK to allow 'rdp' on databases created before RDP.
    migrateHostsKindConstraint(handle, dbPath)
  } catch (err) {
    try {
      handle.close()
    } catch {
      // nothing more to do
    }
    // Rethrow so the caller surfaces a real error and the next call retries
    // cleanly against a fresh handle instead of inheriting a broken one.
    throw err
  }

  sqlite = handle
  return sqlite
}

/** Lazily-initialized drizzle instance over the app database. */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!db) {
    db = drizzle(getSqlite(), { schema })
  }
  return db
}
