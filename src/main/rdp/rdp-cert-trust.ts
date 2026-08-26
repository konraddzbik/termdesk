/**
 * Pure trust-on-first-use decision for RDP server certificates. No Electron/db
 * imports so it stays unit-testable (mirrors vnc-key-trust).
 */

export type RdpCertClass = 'match' | 'mismatch' | 'unknown'

/**
 * How a presented leaf-cert fingerprint compares to the set already pinned for
 * an endpoint:
 *   - unknown  → nothing pinned yet (first use)
 *   - match    → the presented cert is among the pinned ones
 *   - mismatch → certs are pinned but none matches (changed cert → possible MITM)
 */
export function classifyRdpCert(known: string[], fingerprint: string): RdpCertClass {
  if (known.length === 0) return 'unknown'
  return known.includes(fingerprint) ? 'match' : 'mismatch'
}
