import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({ available: true, backend: 'gnome_libsecret' }))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  safeStorage: {
    isEncryptionAvailable: () => mockState.available,
    getSelectedStorageBackend: () => mockState.backend,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => {
      // Mirror real safeStorage: undecryptable input (tampered/foreign/truncated
      // ciphertext) throws rather than returning attacker-controlled plaintext.
      const s = b.toString('utf8')
      if (!s.startsWith('enc:')) throw new Error('Failed to decrypt')
      return s.slice(4)
    },
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

import { decryptSecret, encryptSecret } from './secrets'

/** Run a body with process.platform forced to a value, then restore it. */
function withPlatform(platform: NodeJS.Platform, body: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    body()
  } finally {
    if (original) Object.defineProperty(process, 'platform', original)
  }
}

describe('secrets', () => {
  beforeEach(() => {
    mockState.available = true
    mockState.backend = 'gnome_libsecret'
  })

  it('round-trips a secret through encrypt/decrypt', () => {
    const plain = 'hunter2'
    expect(decryptSecret(encryptSecret(plain))).toBe(plain)
  })

  it('round-trips empty and unicode strings', () => {
    for (const plain of ['', 'pässwörd-✓-日本語', 'with\nnewline\tand tab']) {
      expect(decryptSecret(encryptSecret(plain))).toBe(plain)
    }
  })

  it('returns a Buffer whose bytes differ from the plaintext input', () => {
    const plain = 'topsecret'
    const cipher = encryptSecret(plain)
    expect(Buffer.isBuffer(cipher)).toBe(true)
    expect(cipher.equals(Buffer.from(plain, 'utf8'))).toBe(false)
    // The mock prefixes ciphertext, so length must exceed the input's.
    expect(cipher.length).toBeGreaterThan(Buffer.byteLength(plain))
  })

  it('encryptSecret throws when OS encryption is unavailable', () => {
    mockState.available = false
    expect(() => encryptSecret('x')).toThrow(/not available/i)
  })

  it('decryptSecret throws when OS encryption is unavailable', () => {
    const cipher = encryptSecret('x')
    mockState.available = false
    expect(() => decryptSecret(cipher)).toThrow(/not available/i)
  })

  it('recovers when encryption becomes available again', () => {
    mockState.available = false
    expect(() => encryptSecret('x')).toThrow()
    mockState.available = true
    expect(decryptSecret(encryptSecret('x'))).toBe('x')
  })

  it('on Linux, refuses the insecure basic_text fallback backend', () => {
    withPlatform('linux', () => {
      mockState.backend = 'basic_text'
      expect(() => encryptSecret('x')).toThrow(/keyring/i)
      expect(() => decryptSecret(Buffer.from('enc:x'))).toThrow(/keyring/i)
    })
  })

  it('on Linux, refuses the unknown backend', () => {
    withPlatform('linux', () => {
      mockState.backend = 'unknown'
      expect(() => encryptSecret('x')).toThrow(/keyring/i)
    })
  })

  it('on Linux, allows a real keyring backend (gnome-libsecret/kwallet)', () => {
    withPlatform('linux', () => {
      mockState.backend = 'kwallet'
      expect(decryptSecret(encryptSecret('x'))).toBe('x')
    })
  })

  it('fails closed on a tampered / foreign ciphertext blob (never returns garbage plaintext)', () => {
    // A hostile imported or restored DB could carry arbitrary bytes in a secret
    // column; decryptSecret must throw so callers surface an error, not connect
    // with attacker-controlled "plaintext".
    expect(() => decryptSecret(Buffer.from('not-real-ciphertext', 'utf8'))).toThrow()
    expect(() => decryptSecret(Buffer.alloc(0))).toThrow()
  })

  it('on macOS/Windows, never consults the storage backend (no insecure fallback exists)', () => {
    withPlatform('darwin', () => {
      mockState.backend = 'basic_text' // would be rejected on Linux, ignored here
      expect(decryptSecret(encryptSecret('x'))).toBe('x')
    })
  })
})
