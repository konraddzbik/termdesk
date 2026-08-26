import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../store/db'
import { findHostRow } from '../store/hosts-repo'
import { rdpKnownCerts } from '../store/schema'
import { classifyRdpCert } from './rdp-cert-trust'
import { rdpLog } from './rdp-log'

const DEFAULT_RDP_PORT = 3389

export interface RdpCertVerdict {
  ok: boolean
  reason?: string
}

function persist(host: string, port: number, fingerprint: string): void {
  getDb()
    .insert(rdpKnownCerts)
    .values({ id: randomUUID(), host, port, fingerprintSha256: fingerprint, addedAt: Date.now() })
    .onConflictDoNothing()
    .run()
}

/**
 * Verifies an RDP server's leaf-certificate fingerprint for `hostId` against the
 * pin store, recording it on first use. Returns whether the session may proceed.
 * Mirrors verifyVncServerKey: unknown → pin & allow; match → allow; mismatch →
 * refuse (possible MITM).
 */
export function verifyRdpServerCert(hostId: string, fingerprint: string): RdpCertVerdict {
  const row = findHostRow(hostId)
  if (!row) return { ok: false, reason: 'Host not found' }
  const host = row.hostname
  const port = row.rdpPort ?? DEFAULT_RDP_PORT

  const known = getDb()
    .select()
    .from(rdpKnownCerts)
    .where(and(eq(rdpKnownCerts.host, host), eq(rdpKnownCerts.port, port)))
    .all()

  const verdict = classifyRdpCert(
    known.map((k) => k.fingerprintSha256),
    fingerprint,
  )

  if (verdict === 'match') {
    rdpLog(`server cert for ${host}:${port} matches the pinned cert — approving`)
    return { ok: true }
  }
  if (verdict === 'mismatch') {
    rdpLog(`server cert for ${host}:${port} CHANGED — refusing (possible MITM)`)
    return {
      ok: false,
      reason:
        `The RDP server's certificate for ${host}:${port} has changed since it was first ` +
        'trusted (possible man-in-the-middle). The connection was refused. If the change is ' +
        'legitimate, remove the pinned RDP certificate for this host and reconnect.',
    }
  }
  rdpLog(`server cert for ${host}:${port} not seen before — pinning (first use)`)
  persist(host, port, fingerprint)
  return { ok: true }
}
