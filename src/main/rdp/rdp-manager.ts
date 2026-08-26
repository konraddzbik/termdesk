import { connect as netConnect } from 'node:net'
import type { Duplex } from 'node:stream'
import type { RdpOpenResult } from '@shared/ipc'
import { findHostRow, resolveHostRdpAuth } from '../store/hosts-repo'
import { decryptSecret } from '../store/secrets'
import { verifyRdpServerCert } from './rdp-known-certs'
import { rdpLog } from './rdp-log'
import { registerRdpTarget } from './rdp-proxy'

const DEFAULT_RDP_PORT = 3389
const CONNECT_TIMEOUT_MS = 15_000

/** Direct TCP transport to the RDP server. */
function tcpStream(host: string, port: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    rdpLog(`direct TCP connect → ${host}:${port}`)
    const socket = netConnect({ host, port, timeout: CONNECT_TIMEOUT_MS })
    socket.once('connect', () => {
      socket.setTimeout(0)
      socket.setNoDelay(true)
      resolve(socket)
    })
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error(`RDP connection to ${host}:${port} timed out`))
    })
    socket.once('error', reject)
  })
}

/**
 * Opens an RDP session for a vault host: registers a one-time RDCleanPath proxy
 * target (direct TCP) and returns the proxy ws:// URL plus the logon material
 * the client needs. The password is decrypted here and handed to the renderer
 * exactly once — never persisted or echoed back. Mirrors openVnc.
 *
 * RDP is reached over direct TCP: a pure-RDP host (kind 'rdp') carries no SSH
 * credentials, so there is nothing to tunnel over. SSH-tunnelled RDP awaits a
 * combined SSH+RDP host kind; until then the host form and the IPC schema
 * (`hostInputSchema.superRefine`) reject tunnel mode, so `direct` is the only
 * reachable transport here.
 */
export async function openRdp(hostId: string): Promise<RdpOpenResult> {
  const row = findHostRow(hostId)
  if (!row) throw new Error('Host not found')
  if (row.kind !== 'rdp') throw new Error('This host is not configured for RDP')

  const rdpPort = row.rdpPort ?? DEFAULT_RDP_PORT
  rdpLog(`open "${row.label}" — direct mode, target ${row.hostname}:${rdpPort}`)

  const serverAddr = `${row.hostname}:${rdpPort}`
  const wsUrl = await registerRdpTarget({
    connect: () => tcpStream(row.hostname, rdpPort),
    serverAddr,
    verifyCert: (fingerprint) => verifyRdpServerCert(hostId, fingerprint),
    onClosed: () => {
      /* direct mode holds no dedicated connection to release */
    },
  })

  const auth = resolveHostRdpAuth(row)
  const password = auth.passwordEnc ? decryptSecret(auth.passwordEnc) : null
  rdpLog(
    `credentials for "${row.label}": username=${auth.username !== ''}, password=${password !== null}`,
  )
  return {
    wsUrl,
    // The proxy does not validate this token; the client only needs a non-empty
    // value for the RDCleanPath proxyAuth field.
    authToken: 'termdesk',
    destination: serverAddr,
    username: auth.username,
    domain: auth.domain,
    password,
  }
}
