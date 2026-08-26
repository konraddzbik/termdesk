import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hostInputSchema } from '@shared/ipc'
import { app } from 'electron'
import { getSqlite, setSmokeDbPath } from './db'
import { createHost, listHosts } from './hosts-repo'

const SMOKE_PASSWORD = 'smoke-secret-12345'
const SMOKE_PASSPHRASE = 'smoke-passphrase-67890'

/**
 * End-to-end vault smoke test (run with TERMDESK_SMOKE=vault). Creates a host
 * with secrets through the real repo code path, then proves the plaintext
 * never reaches disk and never reaches the renderer-facing host list.
 * Prints VAULT_SMOKE_OK / VAULT_SMOKE_FAIL and quits the app.
 *
 * Always creates its own fresh temp DB (via `setSmokeDbPath`) so smoke data can
 * never land in a real vault, packaged or not.
 */
export async function runVaultSmokeTest(): Promise<void> {
  // Always create a fresh temp dir so we never touch a real DB.
  const smokeDir = mkdtempSync(join(tmpdir(), 'sshdeck-vault-smoke-'))
  const dbPath = join(smokeDir, 'smoke.db')
  // In-process override so db.ts picks up our temp path regardless of whether
  // this build is packaged (an env var would be ignored in a packaged app).
  setSmokeDbPath(dbPath)

  try {
    // Secrets are scoped to the auth type that uses them: a password only on a
    // password-auth host, a key passphrase only on a key-auth host. Exercise
    // both with one host each so the ciphertext columns are populated legitimately.
    const host = createHost(
      hostInputSchema.parse({
        label: `smoke-host-${Date.now()}`,
        hostname: '127.0.0.1',
        username: 'smoke',
        authType: 'password',
        password: SMOKE_PASSWORD,
      }),
    )
    const keyHost = createHost(
      hostInputSchema.parse({
        label: `smoke-keyhost-${Date.now()}`,
        hostname: '127.0.0.1',
        username: 'smoke',
        authType: 'key',
        keyPath: '/home/smoke/.ssh/id_ed25519',
        passphrase: SMOKE_PASSPHRASE,
      }),
    )

    // 1. The stored ciphertext columns must be non-null blobs.
    const row = getSqlite().prepare('SELECT password_enc FROM hosts WHERE id = ?').get(host.id) as
      | { password_enc: unknown }
      | undefined
    const keyRow = getSqlite()
      .prepare('SELECT passphrase_enc FROM hosts WHERE id = ?')
      .get(keyHost.id) as { passphrase_enc: unknown } | undefined
    if (!row || !keyRow) throw new Error('created host row not found in DB')
    if (!Buffer.isBuffer(row.password_enc) || row.password_enc.length === 0) {
      throw new Error('password_enc is not a non-null blob')
    }
    if (!Buffer.isBuffer(keyRow.passphrase_enc) || keyRow.passphrase_enc.length === 0) {
      throw new Error('passphrase_enc is not a non-null blob')
    }

    // 2. Plaintext secrets must not appear anywhere in the raw DB, WAL, or SHM bytes.
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (!existsSync(file)) continue
      const bytes = readFileSync(file)
      if (bytes.includes(SMOKE_PASSWORD)) throw new Error(`plaintext password found in ${file}`)
      if (bytes.includes(SMOKE_PASSPHRASE)) throw new Error(`plaintext passphrase found in ${file}`)
    }

    // 3. The hosts:list payload must carry no secret material or secret fields.
    const serialized = JSON.stringify(listHosts())
    if (serialized.includes(SMOKE_PASSWORD) || serialized.includes(SMOKE_PASSPHRASE)) {
      throw new Error('hosts:list output contains plaintext secret')
    }
    // Match key positions only ("field":) — authType's legitimate value is the
    // string "password", which must not trip the field check.
    for (const field of ['"password":', '"passphrase":', '"passwordEnc":', '"passphraseEnc":']) {
      if (serialized.includes(field)) throw new Error(`hosts:list output exposes ${field} field`)
    }
    const listed = JSON.parse(serialized) as Array<Record<string, unknown>>
    const listedHost = listed.find((h) => h.id === host.id)
    const listedKeyHost = listed.find((h) => h.id === keyHost.id)
    if (!listedHost || !listedKeyHost)
      throw new Error('created host missing from hosts:list output')
    if (listedHost.hasPassword !== true || listedHost.hasPassphrase !== false) {
      throw new Error('password-auth host has* booleans not derived correctly')
    }
    if (listedKeyHost.hasPassphrase !== true || listedKeyHost.hasPassword !== false) {
      throw new Error('key-auth host has* booleans not derived correctly')
    }

    console.log('VAULT_SMOKE_OK')
  } catch (err) {
    console.log(`VAULT_SMOKE_FAIL: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    // Close the sqlite handle so we can unlink on Windows too.
    try {
      getSqlite().close()
    } catch {
      // ignore — may already be closed
    }
    // Clean up the temp DB and its WAL/SHM siblings.
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        unlinkSync(file)
      } catch {
        // file may not exist — that's fine
      }
    }
    try {
      rmSync(smokeDir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
    app.quit()
  }
}
