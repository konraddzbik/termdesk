/**
 * Run the RA2 probe using VNC credentials stored in termdesk.db (Electron safeStorage).
 * Usage: npx electron scripts/vnc-probe-from-db.mjs [hostLabelOrId]
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, safeStorage } from 'electron'
import Database from 'better-sqlite3'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const hostNeedle = process.argv[2]
if (!hostNeedle) {
  console.error('usage: npx electron scripts/vnc-probe-from-db.mjs <hostLabelOrId>')
  process.exit(2)
}

function dbPath() {
  return (
    process.env.TERMDESK_DB_PATH ??
    process.env.SSHDECK_DB_PATH ??
    join(app.getPath('userData'), 'termdesk.db')
  )
}

function resolveVncAuth(db, hostRow) {
  if (!hostRow.credential_id) {
    throw new Error(`Host "${hostRow.label}" has no managed VNC credential`)
  }
  const cred = db
    .prepare('SELECT id, label, type, username, password_enc FROM credentials WHERE id = ?')
    .get(hostRow.credential_id)
  if (!cred || cred.type !== 'vnc') {
    throw new Error(`Credential ${hostRow.credential_id} is missing or not VNC`)
  }
  if (!cred.password_enc) {
    throw new Error(`Credential "${cred.label}" has no password`)
  }
  const blob = Buffer.isBuffer(cred.password_enc)
    ? cred.password_enc
    : Buffer.from(cred.password_enc)
  const password = safeStorage.decryptString(blob)
  const username = (cred.username ?? '').trim() || null
  if (!username) throw new Error(`Credential "${cred.label}" has no username`)
  return { username, password, host: hostRow }
}

async function main() {
  // Match the packaged app id so macOS Keychain decrypt works for stored secrets.
  if (app.setAppUserModelId) {
    app.setAppUserModelId('com.termdesk.app')
  }
  await app.whenReady()
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level secret encryption is not available')
  }
  const db = new Database(dbPath(), { readonly: true })
  const hostRow =
    db
      .prepare(
        `SELECT id, label, hostname, vnc_port, credential_id FROM hosts
         WHERE id = ? OR label LIKE ? LIMIT 1`,
      )
      .get(hostNeedle, `%${hostNeedle}%`) ?? null
  if (!hostRow) throw new Error(`Host not found: ${hostNeedle}`)

  const { username, password, host } = resolveVncAuth(db, hostRow)
  const port = host.vnc_port ?? 5900
  console.log(
    `[probe-db] host="${host.label}" target=${host.hostname}:${port} user=${username}`,
  )

  const probe = join(root, 'scripts', 'vnc-ra2-probe.mjs')
  const child = spawn(process.execPath, [probe, host.hostname, String(port)], {
    cwd: root,
    env: { ...process.env, VNC_USER: username, VNC_PASS: password, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  })
  child.on('exit', (code) => {
    db.close()
    app.quit()
    process.exit(code ?? 1)
  })
}

main().catch((err) => {
  console.error(`[probe-db] ${err.message}`)
  app.quit()
  process.exit(1)
})