import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialInputSchema, hostInputSchema } from '@shared/ipc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) =>
      Buffer.from(`enc:${Buffer.from(s, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (b: Buffer) =>
      Buffer.from(b.toString('utf8').replace(/^enc:/, ''), 'base64').toString('utf8'),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

// better-sqlite3 ABI shim shared with the other store tests.
vi.mock('better-sqlite3', async () => {
  const actual = (
    (await vi.importActual('better-sqlite3')) as unknown as {
      default: typeof import('better-sqlite3')
    }
  ).default
  try {
    new actual(':memory:').close()
    return { default: actual }
  } catch {
    // ABI mismatch — fall through to the cached Node prebuild.
  }
  const { execFileSync } = await import('node:child_process')
  const { existsSync, readdirSync, renameSync, writeFileSync } = await import('node:fs')
  const { createRequire } = await import('node:module')
  const { homedir, tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const pkg = createRequire(import.meta.url)('better-sqlite3/package.json') as { version: string }
  const abi = process.versions.modules
  const suffix = `better-sqlite3-v${pkg.version}-node-v${abi}-${process.platform}-${process.arch}.tar.gz`
  const nativePath = join(tmpdir(), `sshdeck-test-better_sqlite3-v${pkg.version}-node-v${abi}.node`)
  if (!existsSync(nativePath)) {
    const cacheDir = join(homedir(), '.npm', '_prebuilds')
    const tarball = readdirSync(cacheDir).find((f) => f.endsWith(suffix))
    if (!tarball) {
      throw new Error(
        `better-sqlite3 native binary targets Electron and no Node prebuild *${suffix} is cached in ${cacheDir}`,
      )
    }
    const bytes = execFileSync(
      'tar',
      ['-xzOf', join(cacheDir, tarball), 'build/Release/better_sqlite3.node'],
      { maxBuffer: 256 * 1024 * 1024 },
    )
    const staging = `${nativePath}.${process.pid}.tmp`
    writeFileSync(staging, bytes)
    renameSync(staging, nativePath)
  }
  function Wrapped(filename?: string, options?: Record<string, unknown>) {
    return new actual(filename, { ...options, nativeBinding: nativePath })
  }
  Wrapped.prototype = actual.prototype
  return { default: Wrapped as unknown as typeof actual }
})

type CredInputRaw = z.input<typeof credentialInputSchema>
type HostInputRaw = z.input<typeof hostInputSchema>

const decrypt = (b: Buffer) =>
  Buffer.from(b.toString('utf8').replace(/^enc:/, ''), 'base64').toString('utf8')

describe('credentials-repo', () => {
  let dir: string
  let creds: typeof import('./credentials-repo')
  let hostsRepo: typeof import('./hosts-repo')
  let dbMod: typeof import('./db')

  // See hosts-repo.test.ts: `?.` + `.equals()` turns a missing row into an
  // opaque TypeError. Fail with the id instead.
  const credEnc = (id: string, field: 'passwordEnc' | 'passphraseEnc'): Buffer => {
    const row = creds.findCredentialRow(id)
    if (!row) throw new Error(`expected a credential row for ${id}`)
    return row[field] as Buffer
  }

  const credInput = (over: Partial<CredInputRaw> = {}): z.output<typeof credentialInputSchema> =>
    credentialInputSchema.parse({
      label: 'shared deploy',
      username: 'deploy',
      authType: 'password',
      ...over,
    })

  const hostInput = (over: Partial<HostInputRaw> = {}): z.output<typeof hostInputSchema> =>
    hostInputSchema.parse({
      label: 'web',
      hostname: 'example.com',
      username: 'root',
      authType: 'agent',
      ...over,
    })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-creds-'))
    process.env.SSHDECK_DB_PATH = join(dir, 'sshdeck.db')
    vi.resetModules()
    dbMod = await import('./db')
    creds = await import('./credentials-repo')
    hostsRepo = await import('./hosts-repo')
  })

  afterEach(() => {
    try {
      dbMod.getSqlite().close()
    } catch {
      // already closed
    }
    delete process.env.SSHDECK_DB_PATH
    rmSync(dir, { recursive: true, force: true })
  })

  describe('createCredential / updateCredential secret enforcement', () => {
    it('encrypts the password for a password credential and exposes hasPassword', () => {
      const c = creds.createCredential(credInput({ authType: 'password', password: 'pw' }))
      expect(c.hasPassword).toBe(true)
      expect(c.hasPassphrase).toBe(false)
      expect(decrypt(creds.findCredentialRow(c.id)?.passwordEnc as Buffer)).toBe('pw')
    })

    it('drops a password sent with a non-password authType', () => {
      const c = creds.createCredential(credInput({ authType: 'agent', password: 'sneaky' }))
      expect(c.hasPassword).toBe(false)
      expect(creds.findCredentialRow(c.id)?.passwordEnc).toBeNull()
    })

    it('keeps the passphrase across an update that omits it, and clears on request', () => {
      const c = creds.createCredential(
        credInput({ authType: 'key', keyPath: '/k', passphrase: 'pp' }),
      )
      const before = creds.findCredentialRow(c.id)?.passphraseEnc as Buffer

      const kept = creds.updateCredential(c.id, credInput({ authType: 'key', keyPath: '/k' }))
      expect(kept.hasPassphrase).toBe(true)
      expect(credEnc(c.id, 'passphraseEnc').equals(before)).toBe(true)

      const cleared = creds.updateCredential(
        c.id,
        credInput({ authType: 'key', keyPath: '/k', clearPassphrase: true }),
      )
      expect(cleared.hasPassphrase).toBe(false)
    })

    it('nulls the password when an update switches authType away from password', () => {
      const c = creds.createCredential(credInput({ authType: 'password', password: 'pw' }))
      const updated = creds.updateCredential(c.id, credInput({ authType: 'agent' }))
      expect(updated.hasPassword).toBe(false)
      expect(creds.findCredentialRow(c.id)?.passwordEnc).toBeNull()
    })

    it('listCredentials never exposes ciphertext fields', () => {
      creds.createCredential(credInput({ authType: 'password', password: 'pw' }))
      const serialized = JSON.stringify(creds.listCredentials())
      expect(serialized).not.toContain('passwordEnc')
      expect(serialized).not.toContain('pw')
    })
  })

  describe('resolveHostAuth', () => {
    it('uses the host’s own auth when no credential is referenced', () => {
      const host = hostsRepo.createHost(
        hostInput({ authType: 'password', password: 'host-pw', username: 'alice' }),
      )
      const row = hostsRepo.findHostRow(host.id)
      const resolved = hostsRepo.resolveHostAuth(row as NonNullable<typeof row>)
      expect(resolved.username).toBe('alice')
      expect(resolved.authType).toBe('password')
      expect(decrypt(resolved.passwordEnc as Buffer)).toBe('host-pw')
    })

    it('borrows the credential’s username and secret when referenced', () => {
      const cred = creds.createCredential(
        credInput({ username: 'svc', authType: 'password', password: 'cred-pw' }),
      )
      const host = hostsRepo.createHost(
        hostInput({ username: 'ignored', credentialId: cred.id, authType: 'password' }),
      )
      const row = hostsRepo.findHostRow(host.id)
      const resolved = hostsRepo.resolveHostAuth(row as NonNullable<typeof row>)
      expect(resolved.username).toBe('svc')
      expect(decrypt(resolved.passwordEnc as Buffer)).toBe('cred-pw')
    })

    it('a host using a credential stores no inline SSH secret of its own', () => {
      const cred = creds.createCredential(credInput({ authType: 'password', password: 'cred-pw' }))
      const host = hostsRepo.createHost(
        hostInput({ credentialId: cred.id, authType: 'password', password: 'inline-pw' }),
      )
      expect(host.hasPassword).toBe(false)
      expect(hostsRepo.findHostRow(host.id)?.passwordEnc).toBeNull()
    })

    it('uses the host’s username when the credential has none (a "just a secret" credential)', () => {
      const cred = creds.createCredential(
        credInput({ username: '', authType: 'password', password: 'cred-pw' }),
      )
      const host = hostsRepo.createHost(
        hostInput({ username: 'alice', credentialId: cred.id, authType: 'password' }),
      )
      const row = hostsRepo.findHostRow(host.id)
      const resolved = hostsRepo.resolveHostAuth(row as NonNullable<typeof row>)
      // Username from the host, secret from the credential.
      expect(resolved.username).toBe('alice')
      expect(decrypt(resolved.passwordEnc as Buffer)).toBe('cred-pw')
    })

    it('falls back to the host’s own auth when the credential was deleted', () => {
      const cred = creds.createCredential(credInput({ username: 'svc' }))
      const host = hostsRepo.createHost(
        hostInput({ username: 'fallback', credentialId: cred.id, authType: 'agent' }),
      )
      creds.deleteCredential(cred.id)
      const row = hostsRepo.findHostRow(host.id)
      // ON DELETE SET NULL detaches the reference.
      expect(row?.credentialId).toBeNull()
      expect(hostsRepo.resolveHostAuth(row as NonNullable<typeof row>).username).toBe('fallback')
    })

    it('ignores a VNC credential on the SSH path (no cross-use), falling back to host auth', () => {
      const vncCred = creds.createCredential(credInput({ type: 'vnc', password: 'vnc-pw' }))
      const host = hostsRepo.createHost(
        hostInput({ kind: 'both', credentialId: vncCred.id, authType: 'password', password: 'h' }),
      )
      const row = hostsRepo.findHostRow(host.id)
      const resolved = hostsRepo.resolveHostAuth(row as NonNullable<typeof row>)
      // The VNC cred must not supply SSH auth; the host keeps its own SSH password.
      expect(resolved.username).toBe('root')
      expect(decrypt(resolved.passwordEnc as Buffer)).toBe('h')
    })
  })

  describe('VNC credentials', () => {
    it('a VNC credential stores username and password; SSH-only fields are blanked', () => {
      const c = creds.createCredential(
        credInput({ type: 'vnc', username: 'vncuser', password: 'vnc-secret' }),
      )
      expect(c.type).toBe('vnc')
      expect(c.username).toBe('vncuser')
      expect(c.hasPassword).toBe(true)
      expect(c.hasPassphrase).toBe(false)
      expect(decrypt(creds.findCredentialRow(c.id)?.passwordEnc as Buffer)).toBe('vnc-secret')
    })

    it('resolveHostVncAuth prefers a referenced VNC credential over the inline password', () => {
      const vncCred = creds.createCredential(
        credInput({ type: 'vnc', username: 'realvnc-user', password: 'shared-vnc' }),
      )
      const host = hostsRepo.createHost(
        hostInput({ kind: 'vnc', vncMode: 'direct', credentialId: vncCred.id, vncPassword: 'x' }),
      )
      const row = hostsRepo.findHostRow(host.id)
      // The host stores no inline VNC password (the shared one wins).
      expect(row?.vncPasswordEnc).toBeNull()
      const auth = hostsRepo.resolveHostVncAuth(row as NonNullable<typeof row>)
      expect(auth.username).toBe('realvnc-user')
      expect(decrypt(auth.passwordEnc as Buffer)).toBe('shared-vnc')
    })

    it('resolveHostVncAuth falls back to the host inline password when no VNC credential', () => {
      const host = hostsRepo.createHost(
        hostInput({ kind: 'vnc', vncMode: 'direct', vncPassword: 'inline-vnc' }),
      )
      const row = hostsRepo.findHostRow(host.id)
      const auth = hostsRepo.resolveHostVncAuth(row as NonNullable<typeof row>)
      expect(auth.username).toBeNull()
      expect(decrypt(auth.passwordEnc as Buffer)).toBe('inline-vnc')
    })

    it('resolveHostVncAuth ignores an SSH credential (no cross-use)', () => {
      const sshCred = creds.createCredential(credInput({ type: 'ssh', password: 'ssh-pw' }))
      const host = hostsRepo.createHost(
        hostInput({ kind: 'both', credentialId: sshCred.id, vncPassword: 'inline-vnc' }),
      )
      const row = hostsRepo.findHostRow(host.id)
      // SSH cred must not feed the VNC path; the host's own VNC password applies.
      const auth = hostsRepo.resolveHostVncAuth(row as NonNullable<typeof row>)
      expect(auth.username).toBeNull()
      expect(decrypt(auth.passwordEnc as Buffer)).toBe('inline-vnc')
    })
  })
})
