import { describe, expect, it } from 'vitest'
import { classifyHostKey, fingerprintOf, parseKeyType, parseProxyJump } from './ssh-util'

describe('classifyHostKey', () => {
  const ed25519 = { keyType: 'ssh-ed25519', fingerprintSha256: 'SHA256:AAA' }
  const rsa = { keyType: 'ssh-rsa', fingerprintSha256: 'SHA256:BBB' }

  it('returns "unknown" when nothing is trusted for the endpoint (TOFU)', () => {
    expect(classifyHostKey([], 'ssh-ed25519', 'SHA256:AAA')).toBe('unknown')
  })

  it('returns "match" when type and fingerprint both match a trusted key', () => {
    expect(classifyHostKey([ed25519], 'ssh-ed25519', 'SHA256:AAA')).toBe('match')
  })

  it('returns "match" when the presented key matches any one of several trusted keys', () => {
    expect(classifyHostKey([ed25519, rsa], 'ssh-rsa', 'SHA256:BBB')).toBe('match')
  })

  it('returns "mismatch" when the same type is trusted but the fingerprint differs (key CHANGED)', () => {
    expect(classifyHostKey([ed25519], 'ssh-ed25519', 'SHA256:EVIL')).toBe('mismatch')
  })

  it('still flags a same-type fingerprint change even when other key types are also trusted', () => {
    // The (host,port)-only lookup is what makes this work: an ed25519 change is
    // detected as mismatch regardless of the unrelated trusted rsa key.
    expect(classifyHostKey([ed25519, rsa], 'ssh-ed25519', 'SHA256:EVIL')).toBe('mismatch')
  })

  it('returns "changed" (not benign "unknown") for a never-seen key TYPE on a known host', () => {
    // A host trusted only for ed25519; the server now presents an rsa key we've
    // never trusted. This is indistinguishable on the wire from a MITM that
    // dropped ed25519 and offered rsa, so it must NOT look like a first contact.
    // We still prompt (no permanent lockout for a real algorithm change) but the
    // caller shows a loud "already-known host" warning.
    expect(classifyHostKey([ed25519], 'ssh-rsa', 'SHA256:BBB')).toBe('changed')
  })

  it('returns "changed" when the same fingerprint string appears under an untrusted type', () => {
    expect(classifyHostKey([ed25519], 'ssh-rsa', 'SHA256:AAA')).toBe('changed')
  })

  it('returns "unknown" only when the endpoint has no trusted keys at all', () => {
    expect(classifyHostKey([], 'ssh-rsa', 'SHA256:ZZZ')).toBe('unknown')
  })
})

describe('parseProxyJump', () => {
  it('parses a single bare host', () => {
    expect(parseProxyJump('jump.example.com')).toEqual([
      { host: 'jump.example.com', port: 22, username: null },
    ])
  })

  it('parses user, host and port', () => {
    expect(parseProxyJump('alice@jump:2200')).toEqual([
      { host: 'jump', port: 2200, username: 'alice' },
    ])
  })

  it('parses a multi-hop chain with whitespace', () => {
    expect(parseProxyJump('a@first:22, second , bob@third:2022')).toEqual([
      { host: 'first', port: 22, username: 'a' },
      { host: 'second', port: 22, username: null },
      { host: 'third', port: 2022, username: 'bob' },
    ])
  })

  it('keeps an @ inside the username (last @ wins as separator)', () => {
    expect(parseProxyJump('user@corp@jump')).toEqual([
      { host: 'jump', port: 22, username: 'user@corp' },
    ])
  })

  it('treats a non-numeric port suffix as part of the hostname', () => {
    expect(parseProxyJump('host:abc')).toEqual([{ host: 'host:abc', port: 22, username: null }])
  })

  it('ignores empty segments', () => {
    expect(parseProxyJump(' , jump, ')).toEqual([{ host: 'jump', port: 22, username: null }])
  })
})

describe('parseKeyType', () => {
  function keyBlob(type: string): Buffer {
    const name = Buffer.from(type, 'ascii')
    const len = Buffer.alloc(4)
    len.writeUInt32BE(name.length, 0)
    return Buffer.concat([len, name, Buffer.from([1, 2, 3])])
  }

  it('extracts the algorithm name', () => {
    expect(parseKeyType(keyBlob('ssh-ed25519'))).toBe('ssh-ed25519')
    expect(parseKeyType(keyBlob('rsa-sha2-512'))).toBe('rsa-sha2-512')
  })

  it('returns unknown for malformed blobs', () => {
    expect(parseKeyType(Buffer.alloc(0))).toBe('unknown')
    expect(parseKeyType(Buffer.from([0, 0, 0, 200, 65]))).toBe('unknown')
  })
})

describe('fingerprintOf', () => {
  it('produces the OpenSSH SHA256 presentation without padding', () => {
    const fp = fingerprintOf(Buffer.from('test-key-blob'))
    expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]+$/)
    expect(fp).not.toMatch(/=$/)
  })

  it('is deterministic and input-sensitive', () => {
    const a = fingerprintOf(Buffer.from('a'))
    expect(fingerprintOf(Buffer.from('a'))).toBe(a)
    expect(fingerprintOf(Buffer.from('b'))).not.toBe(a)
  })
})
