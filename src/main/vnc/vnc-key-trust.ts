/**
 * Pure trust-on-first-use decision for VNC server keys. No Electron/db imports
 * so it stays unit-testable (mirrors sftp-name-safety).
 */

export type VncKeyClass = 'match' | 'mismatch' | 'unknown'

/**
 * How a presented fingerprint compares to the set already pinned for an
 * endpoint:
 *   - unknown  → nothing pinned yet (first use)
 *   - match    → the presented key is among the pinned keys
 *   - mismatch → keys are pinned but none matches (changed key → possible MITM)
 */
export function classifyVncKey(known: string[], fingerprint: string): VncKeyClass {
  if (known.length === 0) return 'unknown'
  return known.includes(fingerprint) ? 'match' : 'mismatch'
}
