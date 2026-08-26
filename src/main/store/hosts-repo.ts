import { randomUUID } from 'node:crypto'
import { type Host, type hostInputSchema, hostSchema } from '@shared/ipc'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { findCredentialRow } from './credentials-repo'
import { getDb, getSqlite } from './db'
import { hosts } from './schema'
import { encryptSecret } from './secrets'

/** Fully-parsed host input (defaults applied by zod). */
export type HostInputParsed = z.output<typeof hostInputSchema>

type HostKind = 'ssh' | 'vnc' | 'rdp' | 'both'

/**
 * Single source of truth for which secret slots a host may hold, given its
 * `kind`, SSH `authType`, and whether it references a shared credential of each
 * type. Used by both createHost and updateHost so the two entry points can never
 * diverge:
 *   - SSH password/passphrase → only a non-VNC host using that auth AND not
 *     deferring to a shared SSH credential.
 *   - VNC password → only a host with a VNC capability AND not deferring to a
 *     shared VNC credential.
 * The credential gates are by TYPE: a referenced VNC credential never suppresses
 * the host's SSH secret, and vice versa — the two secrets are independent.
 */
function allowsPassword(
  kind: HostKind,
  authType: HostInputParsed['authType'],
  usesSshCredential: boolean,
): boolean {
  return !usesSshCredential && kind !== 'vnc' && authType === 'password'
}
function allowsPassphrase(
  kind: HostKind,
  authType: HostInputParsed['authType'],
  usesSshCredential: boolean,
): boolean {
  return !usesSshCredential && kind !== 'vnc' && authType === 'key'
}
function allowsVncPassword(kind: HostKind, usesVncCredential: boolean): boolean {
  return !usesVncCredential && kind !== 'ssh' && kind !== 'rdp'
}
/** An inline RDP password is only meaningful for an RDP host. */
function allowsRdpPassword(kind: HostKind): boolean {
  return kind === 'rdp'
}

/** The type of the referenced credential, or null when none/dangling. */
function referencedCredentialType(credentialId: string | null | undefined): 'ssh' | 'vnc' | null {
  if (!credentialId) return null
  return findCredentialRow(credentialId)?.type ?? null
}

/**
 * Raw DB row including secret ciphertext. Main-process only — must never be
 * sent over IPC or serialized into logs.
 */
export type HostRow = typeof hosts.$inferSelect

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    return []
  }
}

/**
 * Maps a DB row to the renderer-facing Host shape. Secret ciphertext is
 * reduced to derived booleans — the blobs never cross this boundary.
 */
function toHost(row: HostRow): Host {
  return hostSchema.parse({
    id: row.id,
    label: row.label,
    hostname: row.hostname,
    port: row.port,
    username: row.username,
    authType: row.authType,
    keyPath: row.keyPath,
    proxyJump: row.proxyJump,
    defaultPath: row.defaultPath,
    groupId: row.groupId,
    credentialId: row.credentialId,
    tags: parseTags(row.tags),
    color: row.color,
    kind: row.kind,
    vncPort: row.vncPort,
    vncMode: row.vncMode,
    rdpPort: row.rdpPort,
    rdpMode: row.rdpMode,
    domain: row.domain,
    hasPassword: row.passwordEnc !== null,
    hasPassphrase: row.passphraseEnc !== null,
    hasVncPassword: row.vncPasswordEnc !== null,
    hasRdpPassword: row.rdpPasswordEnc !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export function listHosts(): Host[] {
  return getDb().select().from(hosts).orderBy(hosts.label).all().map(toHost)
}

export function findHost(id: string): Host | null {
  const row = getDb().select().from(hosts).where(eq(hosts.id, id)).get()
  return row ? toHost(row) : null
}

/**
 * Fetches the raw host row INCLUDING secret ciphertext, for connection time
 * only. Decrypt at the last moment and drop references immediately after.
 * Never expose the returned row to the renderer.
 */
export function findHostRow(id: string): HostRow | null {
  return getDb().select().from(hosts).where(eq(hosts.id, id)).get() ?? null
}

/**
 * Finds a vault host matching a ProxyJump hop endpoint so the hop can reuse
 * its stored auth. Main-process only (returns ciphertext).
 */
export function findHostRowByEndpoint(
  hostname: string,
  username: string,
  port: number,
): HostRow | null {
  return (
    getDb()
      .select()
      .from(hosts)
      .where(and(eq(hosts.hostname, hostname), eq(hosts.username, username), eq(hosts.port, port)))
      .get() ?? null
  )
}

export function createHost(input: HostInputParsed): Host {
  const now = Date.now()
  const kind = input.kind ?? 'ssh'
  const credType = referencedCredentialType(input.credentialId)
  const usesSshCredential = credType === 'ssh'
  const usesVncCredential = credType === 'vnc'
  const row: typeof hosts.$inferInsert = {
    id: randomUUID(),
    label: input.label,
    hostname: input.hostname,
    port: input.port,
    username: input.username,
    authType: input.authType,
    keyPath: input.keyPath ?? null,
    proxyJump: input.proxyJump ?? null,
    defaultPath: input.defaultPath ?? null,
    groupId: input.groupId ?? null,
    credentialId: input.credentialId ?? null,
    tags: JSON.stringify(input.tags),
    color: input.color ?? null,
    kind,
    vncPort: input.vncPort ?? null,
    vncMode: input.vncMode,
    rdpPort: input.rdpPort ?? null,
    rdpMode: input.rdpMode,
    domain: input.domain ?? null,
    // Plaintext is encrypted the moment the payload arrives; only ciphertext is stored.
    // Enforced by kind + authType via the allows* helpers (shared with updateHost).
    passwordEnc:
      allowsPassword(kind, input.authType, usesSshCredential) && input.password !== undefined
        ? encryptSecret(input.password)
        : null,
    passphraseEnc:
      allowsPassphrase(kind, input.authType, usesSshCredential) && input.passphrase !== undefined
        ? encryptSecret(input.passphrase)
        : null,
    vncPasswordEnc:
      allowsVncPassword(kind, usesVncCredential) && input.vncPassword !== undefined
        ? encryptSecret(input.vncPassword)
        : null,
    rdpPasswordEnc:
      allowsRdpPassword(kind) && input.rdpPassword !== undefined
        ? encryptSecret(input.rdpPassword)
        : null,
    createdAt: now,
    updatedAt: now,
  }
  const inserted = getDb().insert(hosts).values(row).returning().get()
  if (!inserted) throw new Error('Failed to create host')
  return toHost(inserted)
}

/**
 * Full-replace (PUT) semantics: every non-secret field is unconditionally
 * overwritten with the provided value. The form always sends the complete
 * payload, so this is intentional and symmetric with createHost.
 *
 * Secrets use a keep/clear/replace policy:
 *   - `input.password` present  → encrypt & store the new value.
 *   - `input.clearPassword` true → null out the stored ciphertext.
 *   - Neither                   → keep the existing ciphertext untouched.
 * Same logic applies to `passphrase`/`clearPassphrase`.
 *
 * Regardless of the above, authType is enforced server-side:
 *   - passwordEnc is forced null unless final authType === 'password'.
 *   - passphraseEnc is forced null unless final authType === 'key'.
 */
export function updateHost(id: string, input: HostInputParsed): Host {
  const db = getDb()
  const existing = db.select().from(hosts).where(eq(hosts.id, id)).get()
  if (!existing) throw new Error('Host not found')

  // Secret semantics: provided -> encrypt & replace, clear flag -> null out,
  // absent -> keep the stored ciphertext untouched.
  let passwordEnc =
    input.password !== undefined
      ? encryptSecret(input.password)
      : input.clearPassword
        ? null
        : existing.passwordEnc
  let passphraseEnc =
    input.passphrase !== undefined
      ? encryptSecret(input.passphrase)
      : input.clearPassphrase
        ? null
        : existing.passphraseEnc
  let vncPasswordEnc =
    input.vncPassword !== undefined
      ? encryptSecret(input.vncPassword)
      : input.clearVncPassword
        ? null
        : existing.vncPasswordEnc
  let rdpPasswordEnc =
    input.rdpPassword !== undefined
      ? encryptSecret(input.rdpPassword)
      : input.clearRdpPassword
        ? null
        : existing.rdpPasswordEnc

  const kind = input.kind ?? 'ssh'
  const credType = referencedCredentialType(input.credentialId)
  const usesSshCredential = credType === 'ssh'
  const usesVncCredential = credType === 'vnc'

  // Enforce by kind, authType and credential use (identical rules to createHost):
  // a host never retains a secret for a capability it no longer has — including a
  // value stored under a previous kind/authType, or one made moot by a credential
  // of the matching type.
  if (!allowsPassword(kind, input.authType, usesSshCredential)) passwordEnc = null
  if (!allowsPassphrase(kind, input.authType, usesSshCredential)) passphraseEnc = null
  if (!allowsVncPassword(kind, usesVncCredential)) vncPasswordEnc = null
  if (!allowsRdpPassword(kind)) rdpPasswordEnc = null

  const updated = db
    .update(hosts)
    .set({
      label: input.label,
      hostname: input.hostname,
      port: input.port,
      username: input.username,
      authType: input.authType,
      keyPath: input.keyPath ?? null,
      proxyJump: input.proxyJump ?? null,
      defaultPath: input.defaultPath ?? null,
      groupId: input.groupId ?? null,
      credentialId: input.credentialId ?? null,
      tags: JSON.stringify(input.tags),
      color: input.color ?? null,
      kind,
      vncPort: input.vncPort ?? null,
      vncMode: input.vncMode,
      rdpPort: input.rdpPort ?? null,
      rdpMode: input.rdpMode,
      domain: input.domain ?? null,
      passwordEnc,
      passphraseEnc,
      vncPasswordEnc,
      rdpPasswordEnc,
      updatedAt: Date.now(),
    })
    .where(eq(hosts.id, id))
    .returning()
    .get()
  if (!updated) throw new Error('Host not found')
  return toHost(updated)
}

/**
 * Clones an existing host under a new label + hostname, copying everything else
 * verbatim — including encrypted secrets and the credential/group references.
 * The copy happens entirely in the main process so ciphertext never round-trips
 * through the renderer.
 */
export function duplicateHost(id: string, label: string, hostname: string): Host {
  const db = getDb()
  const source = db.select().from(hosts).where(eq(hosts.id, id)).get()
  if (!source) throw new Error('Host not found')

  const now = Date.now()
  const row: typeof hosts.$inferInsert = {
    ...source,
    id: randomUUID(),
    label,
    hostname,
    createdAt: now,
    updatedAt: now,
  }
  const inserted = db.insert(hosts).values(row).returning().get()
  if (!inserted) throw new Error('Failed to duplicate host')
  return toHost(inserted)
}

/**
 * Narrow update used by drag-and-drop: reassigns only the host's group (and
 * bumps updatedAt). Unlike updateHost's full-replace, it cannot touch secrets or
 * other columns. Passing null moves the host to "Ungrouped".
 */
export function setHostGroup(id: string, groupId: string | null): Host {
  const db = getDb()
  const existing = db.select().from(hosts).where(eq(hosts.id, id)).get()
  if (!existing) throw new Error('Host not found')
  const updated = db
    .update(hosts)
    .set({ groupId, updatedAt: Date.now() })
    .where(eq(hosts.id, id))
    .returning()
    .get()
  if (!updated) throw new Error('Host not found')
  return toHost(updated)
}

/**
 * Deletes a host and everything keyed to it that has no FK to clean it up.
 *
 * `tunnels.host_id` carries no REFERENCES clause, so `foreign_keys = ON` does
 * nothing for it: deleting a host left its saved port-forwards listed in the
 * sidebar forever, and starting one failed with an opaque error. The trust pins
 * (`known_hosts`, `vnc_known_keys`, `rdp_known_certs`) are keyed by host:port,
 * not host id, and are deliberately left alone — they are per-endpoint facts
 * that must survive removing and re-adding an entry.
 */
export function deleteHost(id: string): void {
  const sqlite = getSqlite()
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM tunnels WHERE host_id = ?').run(id)
    getDb().delete(hosts).where(eq(hosts.id, id)).run()
  })()
}

/** Effective SSH auth fields for a host: from its referenced credential when set. */
export interface ResolvedHostAuth {
  username: string
  authType: HostRow['authType']
  keyPath: string | null
  passwordEnc: Buffer | null
  passphraseEnc: Buffer | null
}

/**
 * Resolves the auth material a connection should use for `row`. A host that
 * references a credential borrows that credential's username + secrets; if the
 * credential was deleted (FK set null) or none is set, the host's own fields win.
 */
export function resolveHostAuth(row: HostRow): ResolvedHostAuth {
  if (row.credentialId) {
    const cred = findCredentialRow(row.credentialId)
    // Only an SSH credential supplies SSH auth — never cross-use a VNC password.
    if (cred && cred.type === 'ssh') {
      return {
        // A credential may omit its username (it's "just a secret"); the host's
        // own username then applies, with the credential providing only the auth.
        username: cred.username.trim() !== '' ? cred.username : row.username,
        authType: cred.authType,
        keyPath: cred.keyPath,
        passwordEnc: cred.passwordEnc,
        passphraseEnc: cred.passphraseEnc,
      }
    }
  }
  return {
    username: row.username,
    authType: row.authType,
    keyPath: row.keyPath,
    passwordEnc: row.passwordEnc,
    passphraseEnc: row.passphraseEnc,
  }
}

/** Resolved VNC login material for a host (main-process only). */
export interface ResolvedHostVncAuth {
  /** From a managed VNC credential; null when only an inline password is stored. */
  username: string | null
  passwordEnc: Buffer | null
}

/**
 * The VNC auth material a connection should use for `row`: from a referenced
 * VNC credential when set (and live), else the host's own inline vncPasswordEnc.
 * Mirrors resolveHostAuth; never cross-uses an SSH credential's secret.
 */
export function resolveHostVncAuth(row: HostRow): ResolvedHostVncAuth {
  if (row.credentialId) {
    const cred = findCredentialRow(row.credentialId)
    if (cred && cred.type === 'vnc') {
      return {
        username: cred.username.trim() !== '' ? cred.username : null,
        passwordEnc: cred.passwordEnc,
      }
    }
  }
  return { username: null, passwordEnc: row.vncPasswordEnc }
}

/** @deprecated Use resolveHostVncAuth — password ciphertext only. */
export function resolveHostVncPassword(row: HostRow): Buffer | null {
  return resolveHostVncAuth(row).passwordEnc
}

/** Resolved RDP logon material for a host (main-process only). */
export interface ResolvedHostRdpAuth {
  username: string
  domain: string | null
  passwordEnc: Buffer | null
}

/**
 * RDP logon material for `row`: the host's own username/domain and inline
 * RDP password. RDP does not (yet) share credentials, so this is always the
 * host-local set. Mirrors resolveHostVncAuth's shape.
 */
export function resolveHostRdpAuth(row: HostRow): ResolvedHostRdpAuth {
  return {
    username: row.username,
    domain: row.domain,
    passwordEnc: row.rdpPasswordEnc,
  }
}
