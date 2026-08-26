import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { fingerprintOf } from '../ssh/ssh-util'
import { getDb } from '../store/db'
import { findHostRow } from '../store/hosts-repo'
import { vncKnownKeys } from '../store/schema'
import { classifyVncKey } from './vnc-key-trust'
import { vncLog } from './vnc-log'

/**
 * Trust-on-first-use pinning for VNC server public keys (RealVNC RSA-AES / RA2).
 *
 * noVNC performs the RA2 handshake in the renderer and asks the client to
 * verify the server's public key before authenticating. Previously the viewer
 * auto-approved any key, which waives RA2's whole server-authentication
 * guarantee. We instead pin the key per (host, port) like SSH known_hosts:
 *   - match    → approve
 *   - mismatch → refuse (the pinned key changed → possible MITM)
 *   - unknown  → pin it and approve (first use)
 *
 * In tunnel mode this rides an already SSH-host-key-verified channel; in direct
 * mode this pin is the only server-authentication the viewer gets.
 */

const DEFAULT_VNC_PORT = 5900

export interface VncKeyVerdict {
  ok: boolean
  reason?: string
}

function persist(host: string, port: number, fingerprint: string): void {
  getDb()
    .insert(vncKnownKeys)
    .values({ id: randomUUID(), host, port, fingerprintSha256: fingerprint, addedAt: Date.now() })
    .onConflictDoNothing()
    .run()
}

/**
 * Verifies a VNC server's public key for `hostId` against the pin store,
 * recording it on first use. Returns whether the viewer should approve.
 */
export function verifyVncServerKey(hostId: string, publicKey: Buffer): VncKeyVerdict {
  const row = findHostRow(hostId)
  if (!row) return { ok: false, reason: 'Host not found' }
  const host = row.hostname
  const port = row.vncPort ?? DEFAULT_VNC_PORT
  const fingerprint = fingerprintOf(publicKey)

  const known = getDb()
    .select()
    .from(vncKnownKeys)
    .where(and(eq(vncKnownKeys.host, host), eq(vncKnownKeys.port, port)))
    .all()

  const verdict = classifyVncKey(
    known.map((k) => k.fingerprintSha256),
    fingerprint,
  )

  if (verdict === 'match') {
    vncLog(`server key for ${host}:${port} matches the pinned key — approving`)
    return { ok: true }
  }
  if (verdict === 'mismatch') {
    vncLog(
      `server key for ${host}:${port} CHANGED (presented ${fingerprint}) — refusing (possible MITM)`,
    )
    return {
      ok: false,
      reason:
        `The VNC server's key for ${host}:${port} has changed since it was first trusted ` +
        '(possible man-in-the-middle). The connection was refused. If the change is ' +
        'legitimate, remove the pinned VNC key for this host and reconnect.',
    }
  }
  vncLog(`server key for ${host}:${port} not seen before (${fingerprint}) — pinning (first use)`)
  persist(host, port, fingerprint)
  return { ok: true }
}
