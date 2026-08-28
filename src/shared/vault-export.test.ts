import { describe, expect, it } from 'vitest'
import {
  buildVaultExport,
  parseVaultExport,
  secretFieldsIn,
  stripSecretFields,
  VAULT_EXPORT_FORMAT,
  VAULT_EXPORT_VERSION,
  VaultImportError,
} from './vault-export'

describe('stripSecretFields', () => {
  it('removes secret-looking fields at any depth and never mutates the input', () => {
    const input = {
      hosts: [
        {
          id: 'h1',
          label: 'db',
          username: 'root',
          passwordEnc: 'BASE64CIPHERTEXT',
          passphraseEnc: 'X',
          hasPassword: true,
        },
      ],
      credentials: [{ id: 'c1', label: 'ci', apiKey: 'sk-123', privateKey: 'KEY' }],
      settings: { theme: 'dark', updateToken: 't' },
    }
    const snapshot = JSON.parse(JSON.stringify(input))
    const { cleaned, removed } = stripSecretFields(input)

    expect(cleaned.hosts[0]).not.toHaveProperty('passwordEnc')
    expect(cleaned.hosts[0]).not.toHaveProperty('passphraseEnc')
    expect(cleaned.hosts[0]).toHaveProperty('hasPassword', true) // boolean flag survives
    expect(cleaned.hosts[0]).toMatchObject({ id: 'h1', label: 'db', username: 'root' })
    expect(cleaned.credentials[0]).not.toHaveProperty('apiKey')
    expect(cleaned.credentials[0]).not.toHaveProperty('privateKey')
    expect(cleaned.settings).not.toHaveProperty('updateToken')
    expect(cleaned.settings).toHaveProperty('theme', 'dark')

    expect(removed).toEqual(
      expect.arrayContaining([
        'hosts[0].passwordEnc',
        'hosts[0].passphraseEnc',
        'credentials[0].apiKey',
        'credentials[0].privateKey',
        'settings.updateToken',
      ]),
    )
    expect(input).toEqual(snapshot) // untouched
  })

  it('does not strip the boolean has* flags that tell the importer what to re-enter', () => {
    expect(secretFieldsIn({ hasPassword: true, hasVncPassword: false })).toEqual([])
  })
})

describe('buildVaultExport', () => {
  it('wraps data in a versioned, secret-free envelope', () => {
    const env = buildVaultExport({ hosts: [{ id: 'h1', passwordEnc: 'X' }] })
    expect(env.format).toBe(VAULT_EXPORT_FORMAT)
    expect(env.version).toBe(VAULT_EXPORT_VERSION)
    expect(env.secretsIncluded).toBe(false)
    expect(JSON.stringify(env)).not.toContain('passwordEnc')
  })

  it('omits exportedAt unless provided (byte-stable/diffable by default)', () => {
    expect(buildVaultExport({}).exportedAt).toBeUndefined()
    expect(buildVaultExport({}, { exportedAt: '2026-01-01T00:00:00Z' }).exportedAt).toBe(
      '2026-01-01T00:00:00Z',
    )
  })
})

describe('parseVaultExport', () => {
  it('round-trips an exported envelope', () => {
    const original = { groups: [{ id: 'g1', name: 'prod' }], settings: { theme: 'dark' } }
    const json = JSON.stringify(buildVaultExport(original))
    const parsed = parseVaultExport<typeof original>(JSON.parse(json))
    expect(parsed.data).toEqual(original)
  })

  it('rejects a non-object', () => {
    expect(() => parseVaultExport(null)).toThrow(VaultImportError)
    expect(() => parseVaultExport('nope')).toThrow(VaultImportError)
  })

  it('rejects an unknown format', () => {
    expect(() => parseVaultExport({ format: 'something-else', version: 1, data: {} })).toThrow(
      /unrecognized format/,
    )
  })

  it('rejects an unsupported version', () => {
    expect(() =>
      parseVaultExport({ format: VAULT_EXPORT_FORMAT, version: 999, data: {} }),
    ).toThrow(/unsupported version/)
  })

  it('rejects an envelope with no data', () => {
    expect(() => parseVaultExport({ format: VAULT_EXPORT_FORMAT, version: 1 })).toThrow(/no data/)
  })
})
