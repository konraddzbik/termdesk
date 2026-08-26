import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import { findHostRow, listHosts, resolveHostVncAuth } from '../store/hosts-repo'
import { decryptSecret } from '../store/secrets'
import { shutdownBridge } from './ws-bridge'

/**
 * Headless RealVNC RSA-AES probe against a saved host (TERMDESK_VNC_PROBE=<id|label>).
 * Uses the real keychain-backed decrypt path, then runs scripts/vnc-ra2-probe.mjs.
 * Prints VNC_RA2_PROBE_OK or VNC_RA2_PROBE_FAIL.
 */
export async function runVncRa2Probe(needle: string): Promise<void> {
  const hosts = listHosts()
  const match =
    hosts.find((h) => h.id === needle) ??
    hosts.find((h) => h.label.toLowerCase().includes(needle.toLowerCase()))
  if (!match) {
    console.log(`VNC_RA2_PROBE_FAIL: host not found (${needle})`)
    process.exitCode = 1
    app.quit()
    return
  }

  const row = findHostRow(match.id)
  if (!row) {
    console.log(`VNC_RA2_PROBE_FAIL: host row missing (${match.id})`)
    process.exitCode = 1
    app.quit()
    return
  }

  const vncAuth = resolveHostVncAuth(row)
  const password = vncAuth.passwordEnc ? decryptSecret(vncAuth.passwordEnc) : null
  const username = vncAuth.username
  if (!username || !password) {
    console.log(`VNC_RA2_PROBE_FAIL: host "${match.label}" needs a managed VNC credential`)
    process.exitCode = 1
    app.quit()
    return
  }

  const port = row.vncPort ?? 5900
  const probeScript = join(app.getAppPath(), 'scripts', 'vnc-ra2-probe.mjs')
  console.log(`[vnc-probe] "${match.label}" → ${row.hostname}:${port} user=${username}`)

  await new Promise<void>((resolve) => {
    const child = spawn(process.execPath, [probeScript, row.hostname, String(port)], {
      cwd: app.getAppPath(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        VNC_USER: username,
        VNC_PASS: password,
      },
      stdio: 'inherit',
    })
    child.on('exit', (code) => {
      if (code !== 0) process.exitCode = code ?? 1
      resolve()
    })
  })

  shutdownBridge()
  app.quit()
}
