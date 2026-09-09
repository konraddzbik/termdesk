import { describe, expect, it } from 'vitest'
import {
  agentForwardingAdvice,
  authMethodInfo,
  CLASSICAL_KEX,
  certSecondsRemaining,
  certValidityState,
  describeCertValidity,
  isPostQuantumKex,
  isSecurityKeyType,
  kexProtection,
  orderKexAlgorithms,
  PQ_HYBRID_KEX,
} from './ssh-auth'

describe('orderKexAlgorithms (#89)', () => {
  it('offers post-quantum hybrids ahead of every classical algorithm', () => {
    const order = orderKexAlgorithms()
    const firstClassicalIdx = order.findIndex((a) =>
      (CLASSICAL_KEX as readonly string[]).includes(a),
    )
    for (const pq of PQ_HYBRID_KEX) {
      expect(order.indexOf(pq)).toBeGreaterThanOrEqual(0)
      expect(order.indexOf(pq)).toBeLessThan(firstClassicalIdx)
    }
    // mlkem768x25519 (OpenSSH 10.0 default) is the single most-preferred.
    expect(order[0]).toBe('mlkem768x25519-sha256')
  })

  it('restricts to server-supported algorithms while preserving our order', () => {
    const order = orderKexAlgorithms({
      serverSupported: ['ecdh-sha2-nistp256', 'mlkem768x25519-sha256'],
    })
    expect(order).toEqual(['mlkem768x25519-sha256', 'ecdh-sha2-nistp256'])
  })

  it('can offer PQ-only for a hardened fleet', () => {
    const order = orderKexAlgorithms({ postQuantumOnly: true })
    expect(order.every(isPostQuantumKex)).toBe(true)
    expect(order).not.toContain('curve25519-sha256')
  })

  it('returns an empty offer when there is no overlap with the server', () => {
    expect(orderKexAlgorithms({ serverSupported: ['some-unknown-kex'] })).toEqual([])
  })
})

describe('kexProtection (#89)', () => {
  it('recognizes PQ, classical, and unknown', () => {
    expect(kexProtection('mlkem768x25519-sha256')).toBe('post-quantum')
    expect(kexProtection('curve25519-sha256')).toBe('classical')
    expect(kexProtection('diffie-hellman-group1-sha1')).toBe('unknown')
    expect(kexProtection(null)).toBe('unknown')
  })
})

describe('certValidityState (#88)', () => {
  const now = 1_000_000
  it('is not-yet-valid before validAfter', () => {
    expect(certValidityState({ validAfter: now + 100, validBefore: now + 1000 }, { now })).toBe(
      'not-yet-valid',
    )
  })
  it('is valid inside the window', () => {
    expect(certValidityState({ validAfter: now - 100, validBefore: now + 100_000 }, { now })).toBe(
      'valid',
    )
  })
  it('is expiring-soon inside the warning window', () => {
    expect(certValidityState({ validBefore: now + 60 }, { now, expiringWindowSec: 3600 })).toBe(
      'expiring-soon',
    )
  })
  it('is expired at or after validBefore', () => {
    expect(certValidityState({ validBefore: now }, { now })).toBe('expired')
    expect(certValidityState({ validBefore: now - 1 }, { now })).toBe('expired')
  })
  it('treats an unbounded cert as valid, never expiring-soon', () => {
    expect(certValidityState({}, { now })).toBe('valid')
    expect(certSecondsRemaining({}, now)).toBe(Number.POSITIVE_INFINITY)
  })
  it('resolves a malformed cert (validAfter > validBefore) to not-yet-valid, never valid', () => {
    // A contradictory window can never be usable; not-yet-valid keeps us fail-safe.
    expect(certValidityState({ validAfter: now + 100, validBefore: now - 100 }, { now })).toBe(
      'not-yet-valid',
    )
  })
})

describe('describeCertValidity (#88)', () => {
  const now = 1_000_000
  it('renders minutes vs hours for the expiring badge', () => {
    expect(
      describeCertValidity({ validBefore: now + 30 * 60 }, { now, expiringWindowSec: 4 * 3600 }),
    ).toBe('Expires in 30m')
    expect(
      describeCertValidity({ validBefore: now + 3 * 3600 }, { now, expiringWindowSec: 4 * 3600 }),
    ).toBe('Expires in 3h')
    expect(describeCertValidity({ validBefore: now - 1 }, { now })).toBe('Expired')
  })
})

describe('agentForwardingAdvice (#90)', () => {
  it('is ok when forwarding is off', () => {
    expect(agentForwardingAdvice({ agentForwarding: false, hasProxyJump: false }).level).toBe('ok')
  })
  it('warns loudest when forwarding is on with no ProxyJump', () => {
    const a = agentForwardingAdvice({ agentForwarding: true, hasProxyJump: false })
    expect(a.level).toBe('warn')
    expect(a.code).toBe('forwarding-without-proxyjump')
    expect(a.message).toMatch(/ProxyJump/)
  })
  it('still warns (softer) when forwarding is on with a ProxyJump', () => {
    const a = agentForwardingAdvice({ agentForwarding: true, hasProxyJump: true })
    expect(a.level).toBe('warn')
    expect(a.code).toBe('forwarding-enabled')
  })
})

describe('authMethodInfo (#86/#87)', () => {
  it('ranks hardware-backed FIDO2 and passkeys strongest and phishing-resistant', () => {
    for (const kind of ['security-key', 'passkey'] as const) {
      const info = authMethodInfo(kind)
      expect(info.hardwareBacked).toBe(true)
      expect(info.phishingResistant).toBe(true)
      expect(info.strength).toBe(5)
    }
    expect(authMethodInfo('password').strength).toBe(1)
    expect(authMethodInfo('security-key').strength).toBeGreaterThan(authMethodInfo('key').strength)
  })
})

describe('isSecurityKeyType (#86)', () => {
  it('detects the sk-* OpenSSH FIDO2 key types', () => {
    expect(isSecurityKeyType('sk-ssh-ed25519@openssh.com')).toBe(true)
    expect(isSecurityKeyType('sk-ecdsa-sha2-nistp256@openssh.com')).toBe(true)
    expect(isSecurityKeyType('webauthn-sk-ecdsa-sha2-nistp256@openssh.com')).toBe(true)
    expect(isSecurityKeyType('ssh-ed25519')).toBe(false)
    expect(isSecurityKeyType('ssh-rsa')).toBe(false)
  })
})
