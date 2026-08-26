import { sql } from 'drizzle-orm'
import { blob, check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle table definitions for the host vault.
 *
 * NOTE: the bootstrap DDL in `db.ts` mirrors these definitions by hand for
 * now (drizzle-kit migrations land in a later phase). Keep both in sync.
 */

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color'),
  /** Parent group for nesting (subgroups); null = top-level. Self-referential. */
  parentId: text('parent_id'),
  sortOrder: integer('sort_order').notNull().default(0),
})

/**
 * Reusable SSH identities ("Keychain"): a username + auth method that can be
 * shared across many hosts. Secret ciphertext lives here exactly like on hosts;
 * a host that references a credential ignores its own auth fields at connect time.
 */
export const credentials = sqliteTable(
  'credentials',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    /** 'ssh' = identity (username + password/key); 'vnc' = a shared VNC password. */
    type: text('type', { enum: ['ssh', 'vnc'] })
      .notNull()
      .default('ssh'),
    username: text('username').notNull(),
    authType: text('auth_type', { enum: ['password', 'key', 'agent'] }).notNull(),
    keyPath: text('key_path'),
    /** safeStorage ciphertext. For a 'vnc' credential this holds the VNC password. */
    passwordEnc: blob('password_enc', { mode: 'buffer' }),
    /** safeStorage ciphertext. Never leaves the main process. */
    passphraseEnc: blob('passphrase_enc', { mode: 'buffer' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('cred_auth_type_check', sql`${table.authType} IN ('password','key','agent')`),
    check('cred_type_check', sql`${table.type} IN ('ssh','vnc')`),
  ],
)

export const hosts = sqliteTable(
  'hosts',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    hostname: text('hostname').notNull(),
    username: text('username').notNull(),
    port: integer('port').notNull().default(22),
    authType: text('auth_type', { enum: ['password', 'key', 'agent'] }).notNull(),
    keyPath: text('key_path'),
    /** Jump host chain, OpenSSH ProxyJump syntax: `user@jump1:port,jump2`. */
    proxyJump: text('proxy_jump'),
    /**
     * Default remote directory. SFTP opens here and a terminal `cd`s here on
     * connect; null falls back to the server's login default.
     */
    defaultPath: text('default_path'),
    /** 'ssh' | 'vnc' | 'both' — controls which capabilities (and required secrets/fields) are active. */
    kind: text('kind', { enum: ['ssh', 'vnc', 'rdp', 'both'] })
      .notNull()
      .default('ssh'),
    vncPort: integer('vnc_port'),
    vncMode: text('vnc_mode').notNull().default('tunnel'),
    vncPasswordEnc: blob('vnc_password_enc', { mode: 'buffer' }),
    /** RDP server port on the remote (null → default 3389). */
    rdpPort: integer('rdp_port'),
    /** 'direct' (default) or 'tunnel' over SSH. */
    rdpMode: text('rdp_mode').notNull().default('direct'),
    /** safeStorage ciphertext of the RDP password. Never leaves the main process. */
    rdpPasswordEnc: blob('rdp_password_enc', { mode: 'buffer' }),
    /** Optional Windows/AD logon domain for RDP. */
    domain: text('domain'),
    groupId: text('group_id').references(() => groups.id, { onDelete: 'set null' }),
    /** Optional shared credential; when set, supplies username/auth at connect time. */
    credentialId: text('credential_id').references(() => credentials.id, { onDelete: 'set null' }),
    /** JSON-encoded string array. */
    tags: text('tags').notNull().default('[]'),
    color: text('color'),
    /** safeStorage ciphertext. Never leaves the main process. */
    passwordEnc: blob('password_enc', { mode: 'buffer' }),
    /** safeStorage ciphertext. Never leaves the main process. */
    passphraseEnc: blob('passphrase_enc', { mode: 'buffer' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('auth_type_check', sql`${table.authType} IN ('password','key','agent')`),
    check('kind_check', sql`${table.kind} IN ('ssh','vnc','rdp','both')`),
  ],
)

export const snippets = sqliteTable('snippets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  command: text('command').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

/**
 * Prompt Book: reusable, `{{variable}}`-templated prompts run against AI
 * harnesses (or sent into any session). `tags` is a JSON-encoded string array;
 * `defaultHarnessId` is an optional preferred harness id (nullable).
 */
export const prompts = sqliteTable('prompts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  description: text('description'),
  tags: text('tags').notNull().default('[]'),
  defaultHarnessId: text('default_harness_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * A Routine: run a Prompt Book prompt through an AI harness in a directory,
 * manually or on a schedule. `schedule`/`variables` are JSON. `autonomy` (0/1)
 * gates auto-approve flags; `mode` is 'interactive' | 'headless'. `lastRunAt`/
 * `nextRunAt` are scheduler bookkeeping (nextRunAt used from M4).
 */
export const routines = sqliteTable('routines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  promptId: text('prompt_id').notNull(),
  harnessId: text('harness_id').notNull(),
  cwd: text('cwd').notNull(),
  mode: text('mode').notNull().default('interactive'),
  autonomy: integer('autonomy').notNull().default(0),
  schedule: text('schedule').notNull().default('{"kind":"manual"}'),
  variables: text('variables').notNull().default('{}'),
  enabled: integer('enabled').notNull().default(1),
  lastRunAt: integer('last_run_at'),
  nextRunAt: integer('next_run_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** One recorded execution of a routine (its audit history). */
export const routineRuns = sqliteTable('routine_runs', {
  id: text('id').primaryKey(),
  routineId: text('routine_id').notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  status: text('status').notNull(),
  exitCode: integer('exit_code'),
  /** Redacted, short description of what ran (never secret-bearing). */
  summary: text('summary'),
  outBytes: integer('out_bytes'),
})

/**
 * Saved automation jobs: a named (host set + command) that runs a snippet/script
 * across many SSH hosts at once. `command` is stored inline (robust against
 * snippet edits/deletes); `snippetId` is informational provenance. `hostIds` is
 * a JSON-encoded string array of host ids.
 */
export const automationJobs = sqliteTable('automation_jobs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  command: text('command').notNull(),
  snippetId: text('snippet_id'),
  hostIds: text('host_ids').notNull().default('[]'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * Local activity log: a per-host timeline of connects/disconnects, SFTP/VNC
 * opens, and automation runs. `hostLabel`/`hostSubtitle` are denormalized
 * snapshots so entries survive host deletion. Never stores secrets.
 */
export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  ts: integer('ts').notNull(),
  action: text('action').notNull(),
  kind: text('kind').notNull(),
  hostId: text('host_id'),
  hostLabel: text('host_label').notNull(),
  hostSubtitle: text('host_subtitle'),
  detail: text('detail'),
  user: text('user'),
  device: text('device'),
})

/** Saved SSH port-forward / tunnel definitions (local `-L` or dynamic SOCKS `-D`). */
export const tunnels = sqliteTable('tunnels', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull(),
  /** 'local' (-L) or 'dynamic' (-D SOCKS). */
  type: text('type').notNull().default('local'),
  listenHost: text('listen_host').notNull().default('127.0.0.1'),
  listenPort: integer('listen_port').notNull(),
  /** Destination host/port for local forwards; null for dynamic (SOCKS picks it). */
  dstHost: text('dst_host'),
  dstPort: integer('dst_port'),
  name: text('name'),
  autoStart: integer('auto_start', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * AI activity audit: one row per MCP agent tool call. Records the decision and
 * action so the user can see exactly what an agent did. Never stores secrets —
 * command text is redacted and only a short result summary is kept.
 */
export const aiAudit = sqliteTable('ai_audit', {
  id: text('id').primaryKey(),
  ts: integer('ts').notNull(),
  /** MCP client label (from the initialize handshake), best-effort. */
  client: text('client'),
  /** Tool name, e.g. run_command, list_hosts. */
  tool: text('tool').notNull(),
  hostId: text('host_id'),
  hostLabel: text('host_label'),
  /** Human summary of what was requested (redacted). */
  summary: text('summary').notNull(),
  /** Policy verdict: allow | needs-approval | deny. */
  verdict: text('verdict').notNull(),
  /** How it resolved: auto | approved | denied | error | ok. */
  outcome: text('outcome').notNull(),
  /** Short result/error summary (no secrets, no full file contents). */
  detail: text('detail'),
  /** Wall-clock duration in ms, when the tool ran. */
  durationMs: integer('duration_ms'),
  /** Byte size of the command/args relayed in — basis for a local usage estimate. */
  inBytes: integer('in_bytes'),
  /** Byte size of the output captured/returned — basis for a local usage estimate. */
  outBytes: integer('out_bytes'),
})

/** Saved local-terminal working directories (reopen a shell there in one click). */
export const localTerminals = sqliteTable('local_terminals', {
  id: text('id').primaryKey(),
  name: text('name'),
  path: text('path').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const knownHosts = sqliteTable(
  'known_hosts',
  {
    id: text('id').primaryKey(),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    keyType: text('key_type').notNull(),
    fingerprintSha256: text('fingerprint_sha256').notNull(),
    addedAt: integer('added_at').notNull(),
  },
  (table) => [
    uniqueIndex('known_hosts_host_port_key_type_unique').on(table.host, table.port, table.keyType),
  ],
)

/**
 * Trust-on-first-use store for VNC server public keys (RealVNC RSA-AES / RA2).
 * Pinned per (host, port) like known_hosts: a changed key on a pinned endpoint
 * is treated as a possible MITM and the connection is refused. Holds only a
 * fingerprint, never the key itself or any secret.
 */
export const vncKnownKeys = sqliteTable(
  'vnc_known_keys',
  {
    id: text('id').primaryKey(),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    fingerprintSha256: text('fingerprint_sha256').notNull(),
    addedAt: integer('added_at').notNull(),
  },
  (table) => [uniqueIndex('vnc_known_keys_host_port_unique').on(table.host, table.port)],
)

/**
 * Trust-on-first-use store for RDP server TLS certificates. Pinned per
 * (host, port) like vnc_known_keys: a changed leaf-cert fingerprint on a pinned
 * endpoint is treated as a possible MITM and the connection is refused. Holds
 * only a SHA-256 fingerprint, never the certificate itself or any secret.
 */
export const rdpKnownCerts = sqliteTable(
  'rdp_known_certs',
  {
    id: text('id').primaryKey(),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    fingerprintSha256: text('fingerprint_sha256').notNull(),
    addedAt: integer('added_at').notNull(),
  },
  (table) => [uniqueIndex('rdp_known_certs_host_port_unique').on(table.host, table.port)],
)
