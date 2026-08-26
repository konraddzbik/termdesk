import { createHash } from 'node:crypto'

/**
 * Pure SSH helpers — no Electron/db imports so they stay unit-testable.
 */

export interface JumpHop {
  host: string
  port: number
  username: string | null
}

/**
 * Parses an OpenSSH ProxyJump value: comma-separated `[user@]host[:port]`
 * hops. IPv6 literals are not supported.
 */
export function parseProxyJump(spec: string): JumpHop[] {
  return spec
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      let rest = part
      let username: string | null = null
      const at = rest.lastIndexOf('@')
      if (at !== -1) {
        username = rest.slice(0, at)
        rest = rest.slice(at + 1)
      }
      let port = 22
      const colon = rest.lastIndexOf(':')
      if (colon !== -1 && /^\d+$/.test(rest.slice(colon + 1))) {
        port = Number.parseInt(rest.slice(colon + 1), 10)
        rest = rest.slice(0, colon)
      }
      return { host: rest, port, username }
    })
}

/**
 * Extracts the key algorithm name from a raw SSH public-key blob. The wire
 * format starts with a 4-byte big-endian length followed by the ASCII
 * algorithm name (e.g. `ssh-ed25519`).
 */
export function parseKeyType(blob: Buffer): string {
  if (blob.length < 4) return 'unknown'
  const len = blob.readUInt32BE(0)
  if (len <= 0 || len > 64 || blob.length < 4 + len) return 'unknown'
  return blob.subarray(4, 4 + len).toString('ascii')
}

/** OpenSSH-style fingerprint: `SHA256:` + unpadded base64 of SHA-256(blob). */
export function fingerprintOf(blob: Buffer): string {
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`
}

/** A trusted host key, as stored in the known_hosts table (only the fields verification needs). */
export interface TrustedHostKey {
  keyType: string
  fingerprintSha256: string
}

export type HostKeyVerdict = 'match' | 'mismatch' | 'unknown' | 'changed'

/**
 * Classifies a presented host key against ALL keys trusted for an endpoint
 * (host+port). Four outcomes, from safest to most alarming:
 *  - `match`    → some trusted key has the same type AND fingerprint. Proceed.
 *  - `mismatch` → a key of the SAME TYPE is trusted but its fingerprint differs.
 *                 The classic "host key CHANGED" case (rotation or MITM on an
 *                 already-established algorithm). Hard-fail, never prompt —
 *                 OpenSSH's REMOTE HOST IDENTIFICATION HAS CHANGED.
 *  - `changed`  → the endpoint already has trusted key(s), but NONE matches the
 *                 presented key and it is of a TYPE we have never trusted here.
 *                 A legitimate new algorithm looks identical on the wire to a
 *                 MITM that dropped the trusted algorithm and offered another,
 *                 so we must NOT show a benign first-contact prompt. We still
 *                 prompt (to avoid locking out a real algorithm change) but the
 *                 caller surfaces a distinct, loud "this host is already known"
 *                 warning. Closes the downgrade gap the old `unknown` had.
 *  - `unknown`  → the endpoint has no trusted keys at all: a genuine first
 *                 contact → ordinary TOFU prompt. OpenSSH's HOST_NEW.
 *
 * The lookup is keyed only by (host, port), never by keyType, so neither a
 * same-type fingerprint change nor a never-seen algorithm on a known host can
 * slip through as a plain first-contact prompt.
 */
export function classifyHostKey(
  trusted: readonly TrustedHostKey[],
  keyType: string,
  fingerprint: string,
): HostKeyVerdict {
  if (trusted.some((k) => k.keyType === keyType && k.fingerprintSha256 === fingerprint)) {
    return 'match'
  }
  // A trusted key of the SAME type with a different fingerprint → the host key
  // changed on an established channel: the loud MITM/rotation alarm (hard-fail).
  if (trusted.some((k) => k.keyType === keyType)) {
    return 'mismatch'
  }
  // Endpoint is already known (has trusted keys) but the presented key is of a
  // type we've never trusted here → not a first contact. Prompt, but loudly.
  if (trusted.length > 0) {
    return 'changed'
  }
  // Nothing trusted for this endpoint yet → genuine first contact (TOFU).
  return 'unknown'
}
