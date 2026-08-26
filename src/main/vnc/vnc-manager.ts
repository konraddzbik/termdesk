import { connect as netConnect } from 'node:net'
import type { Duplex } from 'node:stream'
import type { VncOpenResult } from '@shared/ipc'
import type { Client, ClientChannel } from 'ssh2'
import { type DataSink, sessionManager } from '../ssh/session-manager'
import { findHostRow, resolveHostVncAuth } from '../store/hosts-repo'
import { decryptSecret } from '../store/secrets'
import { vncLog } from './vnc-log'
import { registerBridgeTarget } from './ws-bridge'

/**
 * VNC session provisioning. Default and recommended path is variant B — the
 * VNC bytes ride an SSH channel (`forwardOut`) so port 5900 never needs to be
 * exposed; variant A is a plain TCP connection for servers reachable directly.
 *
 * Every open() provisions exactly one single-use bridge token. The SSH
 * connection is borrowed from a live terminal session when possible;
 * otherwise a dedicated shell-less session is established and torn down when
 * the bridged connection closes (or the token expires unused).
 */

const DEFAULT_VNC_PORT = 5900
const CONNECT_TIMEOUT_MS = 15_000

function tcpStream(host: string, port: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    vncLog(`direct TCP connect → ${host}:${port} (timeout ${CONNECT_TIMEOUT_MS}ms)`)
    const startedAt = Date.now()
    const socket = netConnect({ host, port, timeout: CONNECT_TIMEOUT_MS })
    socket.once('connect', () => {
      socket.setTimeout(0)
      socket.setNoDelay(true)
      vncLog(`direct TCP connected → ${host}:${port} in ${Date.now() - startedAt}ms`)
      resolve(socket)
    })
    socket.once('timeout', () => {
      socket.destroy()
      vncLog(
        `direct TCP TIMEOUT → ${host}:${port} after ${CONNECT_TIMEOUT_MS}ms (port filtered / no route?)`,
      )
      reject(new Error(`VNC connection to ${host}:${port} timed out`))
    })
    socket.once('error', (err) => {
      vncLog(`direct TCP ERROR → ${host}:${port}: ${err.message}`)
      reject(err)
    })
  })
}

function tunnelStream(client: Client, port: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    vncLog(`tunnel forwardOut → 127.0.0.1:${port} on remote loopback`)
    // The VNC server is addressed from the remote host's own loopback.
    client.forwardOut('127.0.0.1', 0, '127.0.0.1', port, (err, stream) => {
      if (err) {
        vncLog(
          `tunnel forwardOut FAILED → 127.0.0.1:${port}: ${err.message} (is a VNC server listening on the remote?)`,
        )
        reject(new Error(`SSH tunnel to VNC failed: ${err.message}`))
      } else {
        vncLog(`tunnel forwardOut established → 127.0.0.1:${port}`)
        resolve(stream)
      }
    })
  })
}

export async function openVnc(hostId: string, owner: DataSink): Promise<VncOpenResult> {
  const row = findHostRow(hostId)
  if (!row) throw new Error('Host not found')
  const vncPort = row.vncPort ?? DEFAULT_VNC_PORT
  const mode = row.vncMode === 'direct' ? 'direct' : 'tunnel'
  vncLog(
    `open "${row.label}" — ${mode} mode, target ${row.hostname}:${vncPort}, kind=${row.kind}` +
      `${row.vncPort == null ? ' (vncPort unset → default 5900)' : ''}`,
  )

  // Guard: pure VNC hosts cannot use SSH tunnel (they have no SSH credentials stored for this purpose).
  if (mode === 'tunnel' && row.kind === 'vnc') {
    throw new Error(
      'Tunnel mode requires SSH credentials. This host is configured as VNC-only. Switch to direct mode or edit the host and enable SSH support.',
    )
  }

  let dedicatedSessionId: string | null = null
  let createStream: () => Promise<Duplex>

  if (mode === 'tunnel') {
    let client = sessionManager.borrowClient(hostId, owner.id)
    if (!client) {
      const dedicated = await sessionManager.connectDedicated(hostId, owner)
      client = dedicated.client
      dedicatedSessionId = dedicated.sessionId
    }
    const tunnelClient = client
    createStream = () => tunnelStream(tunnelClient, vncPort)
  } else {
    createStream = () => tcpStream(row.hostname, vncPort)
  }

  const onClosed = (): void => {
    if (dedicatedSessionId) {
      sessionManager.disconnect(dedicatedSessionId, owner.id)
      dedicatedSessionId = null
    }
  }

  const wsUrl = await registerBridgeTarget(createStream, onClosed)
  // Log the port, never the path: the path IS the single-use bridge credential,
  // and vncLog can append to a 0644 file under app.getPath('logs') when
  // TERMDESK_VNC_DEBUG=1 — which is exactly when a support log gets shared.
  vncLog(`bridge token registered, listening on port ${new URL(wsUrl).port}`)
  // The VNC password (from a shared VNC credential, or the host's own) leaves
  // main exactly once, scoped to this single bridge session, to answer noVNC's
  // credentials callback.
  const vncAuth = resolveHostVncAuth(row)
  const password = vncAuth.passwordEnc ? decryptSecret(vncAuth.passwordEnc) : null
  const username = vncAuth.username
  vncLog(
    `credentials for "${row.label}": username=${username !== null}, password=${password !== null}`,
  )
  return { wsUrl, username, password }
}
