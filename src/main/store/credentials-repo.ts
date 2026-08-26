import { randomUUID } from 'node:crypto'
import { type Credential, type credentialInputSchema, credentialSchema } from '@shared/ipc'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { getDb } from './db'
import { credentials } from './schema'
import { encryptSecret } from './secrets'

/** Fully-parsed credential input (defaults applied by zod). */
export type CredentialInputParsed = z.output<typeof credentialInputSchema>

/** Raw DB row including secret ciphertext. Main-process only. */
export type CredentialRow = typeof credentials.$inferSelect

/** Maps a DB row to the renderer-facing shape — ciphertext reduced to booleans. */
function toCredential(row: CredentialRow): Credential {
  return credentialSchema.parse({
    id: row.id,
    label: row.label,
    type: row.type,
    username: row.username,
    authType: row.authType,
    keyPath: row.keyPath,
    hasPassword: row.passwordEnc !== null,
    hasPassphrase: row.passphraseEnc !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export function listCredentials(): Credential[] {
  return getDb().select().from(credentials).orderBy(credentials.label).all().map(toCredential)
}

export function findCredential(id: string): Credential | null {
  const row = getDb().select().from(credentials).where(eq(credentials.id, id)).get()
  return row ? toCredential(row) : null
}

/** Main-process only — returns ciphertext. Used by connection auth resolution. */
export function findCredentialRow(id: string): CredentialRow | null {
  return getDb().select().from(credentials).where(eq(credentials.id, id)).get() ?? null
}

export function createCredential(input: CredentialInputParsed): Credential {
  const now = Date.now()
  const isVnc = input.type === 'vnc'
  const row: typeof credentials.$inferInsert = {
    id: randomUUID(),
    label: input.label,
    type: input.type,
    // VNC credentials store a RealVNC username + password; SSH-only fields are blanked.
    username: input.username,
    authType: isVnc ? 'password' : input.authType,
    keyPath: isVnc ? null : (input.keyPath ?? null),
    // For VNC the secret is the VNC password (username is stored separately); for SSH it is scoped to authType.
    passwordEnc:
      (isVnc || input.authType === 'password') && input.password !== undefined
        ? encryptSecret(input.password)
        : null,
    passphraseEnc:
      !isVnc && input.authType === 'key' && input.passphrase !== undefined
        ? encryptSecret(input.passphrase)
        : null,
    createdAt: now,
    updatedAt: now,
  }
  const inserted = getDb().insert(credentials).values(row).returning().get()
  if (!inserted) throw new Error('Failed to create credential')
  return toCredential(inserted)
}

export function updateCredential(id: string, input: CredentialInputParsed): Credential {
  const db = getDb()
  const existing = db.select().from(credentials).where(eq(credentials.id, id)).get()
  if (!existing) throw new Error('Credential not found')

  // provided -> encrypt & replace, clear flag -> null, absent -> keep stored.
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

  const isVnc = input.type === 'vnc'
  // Enforce by type: VNC keeps only the password; SSH scopes secrets to authType.
  if (isVnc) {
    passphraseEnc = null
  } else {
    if (input.authType !== 'password') passwordEnc = null
    if (input.authType !== 'key') passphraseEnc = null
  }

  const updated = db
    .update(credentials)
    .set({
      label: input.label,
      type: input.type,
      username: input.username,
      authType: isVnc ? 'password' : input.authType,
      keyPath: isVnc ? null : (input.keyPath ?? null),
      passwordEnc,
      passphraseEnc,
      updatedAt: Date.now(),
    })
    .where(eq(credentials.id, id))
    .returning()
    .get()
  if (!updated) throw new Error('Credential not found')
  return toCredential(updated)
}

export function deleteCredential(id: string): void {
  // hosts.credential_id is ON DELETE SET NULL: referencing hosts are detached,
  // never deleted. Note they keep no SSH secret of their own (it was cleared when
  // the credential was attached), so they need new auth afterward — the UI warns
  // before deleting a credential that hosts depend on.
  getDb().delete(credentials).where(eq(credentials.id, id)).run()
}
