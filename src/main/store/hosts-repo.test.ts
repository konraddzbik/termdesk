import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hostInputSchema } from '@shared/ipc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'

// Base64 payload (instead of a bare `enc:` + plaintext prefix) so the
// "plaintext never reaches the DB file" assertions are meaningful.
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

// The bundled better-sqlite3 binary is rebuilt for Electron's ABI by the
// postinstall hook, so plain-Node test workers cannot load it. Probe first;
// on ABI mismatch fall back to the Node prebuild cached by prebuild-install,
// injected through the `nativeBinding` option (node_modules stays untouched).
vi.mock('better-sqlite3', async () => {
  // better-sqlite3 uses `export =`, so the runtime ESM shape is { default: ctor }.
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
    renameSync(staging, nativePath) // atomic — safe across parallel test workers
  }
  function Wrapped(filename?: string, options?: Record<string, unknown>) {
    return new actual(filename, { ...options, nativeBinding: nativePath })
  }
  Wrapped.prototype = actual.prototype
  return { default: Wrapped as unknown as typeof actual }
})

type HostInputRaw = z.input<typeof hostInputSchema>

const input = (over: Partial<HostInputRaw> = {}) =>
  hostInputSchema.parse({
    label: 'web',
    hostname: 'example.com',
    username: 'root',
    authType: 'agent',
    // VNC-only hosts can't tunnel; default them to direct unless overridden.
    ...(over.kind === 'vnc' ? { vncMode: 'direct' as const } : {}),
    ...over,
  })

const decrypt = (b: Buffer) =>
  Buffer.from(b.toString('utf8').replace(/^enc:/, ''), 'base64').toString('utf8')

describe('hosts-repo', () => {
  let dir: string
  let dbPath: string
  let repo: typeof import('./hosts-repo')
  let groupsRepo: typeof import('./groups-repo')
  let dbMod: typeof import('./db')

  // Reading the raw ciphertext through `?.` and then calling `.equals()` on it
  // throws an opaque TypeError if the row is missing. Fail with the id instead.
  const hostEnc = (
    id: string,
    field: 'passwordEnc' | 'passphraseEnc' | 'vncPasswordEnc',
  ): Buffer => {
    const row = repo.findHostRow(id)
    if (!row) throw new Error(`expected a host row for ${id}`)
    return row[field] as Buffer
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-hosts-'))
    dbPath = join(dir, 'sshdeck.db')
    process.env.SSHDECK_DB_PATH = dbPath
    vi.resetModules()
    dbMod = await import('./db')
    repo = await import('./hosts-repo')
    groupsRepo = await import('./groups-repo')
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

  describe('createHost', () => {
    it('encrypts password, passphrase and vncPassword into prefixed blobs', () => {
      // Use kind:'both' so both SSH + VNC secrets are allowed/stored
      const host = repo.createHost(
        input({
          kind: 'both',
          authType: 'password',
          password: 'pw-plain',
          vncPassword: 'vnc-plain',
        }),
      )
      const row = repo.findHostRow(host.id)
      expect(row).not.toBeNull()
      expect(row?.passwordEnc?.toString('utf8')).toMatch(/^enc:/)
      expect(row?.vncPasswordEnc?.toString('utf8')).toMatch(/^enc:/)
      expect(decrypt(row?.passwordEnc as Buffer)).toBe('pw-plain')
      expect(decrypt(row?.vncPasswordEnc as Buffer)).toBe('vnc-plain')

      const keyHost = repo.createHost(
        input({
          kind: 'ssh',
          label: 'key host',
          authType: 'key',
          keyPath: '/k',
          passphrase: 'pp-plain',
        }),
      )
      const keyRow = repo.findHostRow(keyHost.id)
      expect(keyRow?.passphraseEnc?.toString('utf8')).toMatch(/^enc:/)
      expect(decrypt(keyRow?.passphraseEnc as Buffer)).toBe('pp-plain')
    })

    it('never writes secret plaintext into the database file bytes', () => {
      const secret = 'XyZzy-S3kr1t-Plaintext-Marker'
      repo.createHost(
        input({ kind: 'both', authType: 'password', password: secret, vncPassword: secret }),
      )
      // Flush WAL into the main file so on-disk bytes are complete.
      dbMod.getSqlite().pragma('wal_checkpoint(TRUNCATE)')
      let bytes = readFileSync(dbPath, 'latin1')
      const wal = `${dbPath}-wal`
      if (existsSync(wal)) bytes += readFileSync(wal, 'latin1')
      expect(bytes).not.toContain(secret)
      expect(bytes).toContain('enc:')
    })

    it('stores null blobs when no secrets are provided', () => {
      const host = repo.createHost(input())
      const row = repo.findHostRow(host.id)
      expect(row?.passwordEnc).toBeNull()
      expect(row?.passphraseEnc).toBeNull()
      expect(row?.vncPasswordEnc).toBeNull()
      expect(host.hasPassword).toBe(false)
      expect(host.hasPassphrase).toBe(false)
      expect(host.hasVncPassword).toBe(false)
    })

    it('applies zod defaults: port 22, vncMode tunnel, empty tags', () => {
      const host = repo.createHost(input())
      expect(host.port).toBe(22)
      expect(host.vncMode).toBe('tunnel')
      expect(host.tags).toEqual([])
      expect(host.keyPath).toBeNull()
      expect(host.proxyJump).toBeNull()
      expect(host.groupId).toBeNull()
      expect(host.vncPort).toBeNull()
      expect(host.createdAt).toBe(host.updatedAt)
    })
  })

  // Secret slots are scoped by kind + authType; createHost and updateHost must
  // enforce identical rules so a host never holds a secret for a capability it
  // doesn't have.
  describe('kind-scoped secret enforcement', () => {
    it('createHost: a VNC-only host drops SSH password and passphrase', () => {
      const pwHost = repo.createHost(
        input({ kind: 'vnc', authType: 'password', password: 'pw', vncPassword: 'v' }),
      )
      expect(repo.findHostRow(pwHost.id)?.passwordEnc).toBeNull()
      expect(pwHost.hasPassword).toBe(false)
      expect(pwHost.hasVncPassword).toBe(true)

      const keyHost = repo.createHost(
        input({ kind: 'vnc', authType: 'key', keyPath: '/k', passphrase: 'pp' }),
      )
      expect(repo.findHostRow(keyHost.id)?.passphraseEnc).toBeNull()
      expect(keyHost.hasPassphrase).toBe(false)
    })

    it('createHost: an SSH-only host drops the VNC password', () => {
      const host = repo.createHost(
        input({ kind: 'ssh', authType: 'password', password: 'pw', vncPassword: 'v' }),
      )
      expect(repo.findHostRow(host.id)?.vncPasswordEnc).toBeNull()
      expect(host.hasVncPassword).toBe(false)
      expect(host.hasPassword).toBe(true)
    })

    it('createHost: enforces authType for SSH secrets (no password under agent auth)', () => {
      // Regression: createHost previously gated SSH secrets on kind only, so a
      // password sent with a non-password authType was stored. It must be dropped,
      // identically to updateHost.
      const host = repo.createHost(input({ kind: 'ssh', authType: 'agent', password: 'sneaky' }))
      expect(repo.findHostRow(host.id)?.passwordEnc).toBeNull()
      expect(host.hasPassword).toBe(false)
    })

    it('updateHost: switching both→ssh drops the stored VNC password', () => {
      const host = repo.createHost(
        input({ kind: 'both', authType: 'password', password: 'pw', vncPassword: 'v' }),
      )
      expect(host.hasVncPassword).toBe(true)
      const updated = repo.updateHost(host.id, input({ kind: 'ssh', authType: 'password' }))
      expect(updated.hasVncPassword).toBe(false)
      expect(repo.findHostRow(host.id)?.vncPasswordEnc).toBeNull()
      // The SSH password is untouched by the kind switch.
      expect(updated.hasPassword).toBe(true)
    })

    it('updateHost: switching both→vnc drops the stored SSH password and passphrase', () => {
      const host = repo.createHost(
        input({ kind: 'both', authType: 'password', password: 'pw', vncPassword: 'v' }),
      )
      const updated = repo.updateHost(
        host.id,
        input({ kind: 'vnc', authType: 'password', vncMode: 'direct' }),
      )
      expect(updated.hasPassword).toBe(false)
      expect(repo.findHostRow(host.id)?.passwordEnc).toBeNull()
      // The VNC secret is retained — it belongs to the surviving capability.
      expect(updated.hasVncPassword).toBe(true)
    })

    it('updateHost: switching key SSH→vnc drops the stored passphrase', () => {
      const host = repo.createHost(
        input({ kind: 'ssh', authType: 'key', keyPath: '/k', passphrase: 'pp' }),
      )
      const updated = repo.updateHost(
        host.id,
        input({ kind: 'vnc', authType: 'key', vncMode: 'direct' }),
      )
      expect(updated.hasPassphrase).toBe(false)
      expect(repo.findHostRow(host.id)?.passphraseEnc).toBeNull()
    })

    it('updateHost: a freshly-provided VNC password is ignored for an SSH-only host', () => {
      const host = repo.createHost(input({ kind: 'ssh', authType: 'agent' }))
      const updated = repo.updateHost(
        host.id,
        input({ kind: 'ssh', authType: 'agent', vncPassword: 'sneaky' }),
      )
      expect(updated.hasVncPassword).toBe(false)
      expect(repo.findHostRow(host.id)?.vncPasswordEnc).toBeNull()
    })

    it('updateHost: gaining VNC (ssh→both) then supplying a VNC password stores it', () => {
      const host = repo.createHost(input({ kind: 'ssh', authType: 'agent' }))
      const updated = repo.updateHost(
        host.id,
        input({ kind: 'both', authType: 'agent', vncPassword: 'v' }),
      )
      expect(updated.hasVncPassword).toBe(true)
      expect(decrypt(repo.findHostRow(host.id)?.vncPasswordEnc as Buffer)).toBe('v')
    })

    it('round-trips the kind value through create and update', () => {
      const host = repo.createHost(input({ kind: 'both', vncMode: 'direct' }))
      expect(host.kind).toBe('both')
      expect(repo.updateHost(host.id, input({ kind: 'vnc', vncMode: 'direct' })).kind).toBe('vnc')
      expect(repo.findHost(host.id)?.kind).toBe('vnc')
    })
  })

  describe('toHost / listHosts exposure', () => {
    it('derives has* booleans and never exposes *Enc fields', () => {
      repo.createHost(input({ label: 'a', authType: 'password', password: 'pw' }))
      repo.createHost(input({ label: 'b', authType: 'key', keyPath: '/k', passphrase: 'pp' }))
      repo.createHost(input({ kind: 'vnc', label: 'c', vncPassword: 'vnc' }))

      const hosts = repo.listHosts()
      expect(hosts).toHaveLength(3)
      for (const host of hosts) {
        const keys = Object.keys(host)
        expect(keys).not.toContain('passwordEnc')
        expect(keys).not.toContain('passphraseEnc')
        expect(keys).not.toContain('vncPasswordEnc')
        expect(JSON.stringify(host)).not.toContain('enc:')
      }
      const byLabel = Object.fromEntries(hosts.map((h) => [h.label, h]))
      expect(byLabel.a).toMatchObject({
        hasPassword: true,
        hasPassphrase: false,
        hasVncPassword: false,
      })
      expect(byLabel.b).toMatchObject({
        hasPassword: false,
        hasPassphrase: true,
        hasVncPassword: false,
      })
      expect(byLabel.c).toMatchObject({
        hasPassword: false,
        hasPassphrase: false,
        hasVncPassword: true,
      })
    })

    it('lists hosts ordered by label', () => {
      repo.createHost(input({ label: 'zeta' }))
      repo.createHost(input({ label: 'alpha' }))
      repo.createHost(input({ label: 'mid' }))
      expect(repo.listHosts().map((h) => h.label)).toEqual(['alpha', 'mid', 'zeta'])
    })

    it('findHost returns null for an unknown id', () => {
      expect(repo.findHost('nope')).toBeNull()
      expect(repo.findHostRow('nope')).toBeNull()
    })
  })

  describe('updateHost secret semantics', () => {
    it('keeps the stored password when neither value nor clear flag is sent', () => {
      const host = repo.createHost(input({ authType: 'password', password: 'orig' }))
      const before = repo.findHostRow(host.id)?.passwordEnc as Buffer
      const updated = repo.updateHost(host.id, input({ authType: 'password', label: 'renamed' }))
      expect(updated.hasPassword).toBe(true)
      expect(hostEnc(host.id, 'passwordEnc').equals(before)).toBe(true)
    })

    it('replaces the password when a new value is sent', () => {
      const host = repo.createHost(input({ authType: 'password', password: 'orig' }))
      const before = repo.findHostRow(host.id)?.passwordEnc as Buffer
      repo.updateHost(host.id, input({ authType: 'password', password: 'next' }))
      const after = repo.findHostRow(host.id)?.passwordEnc as Buffer
      expect(after.equals(before)).toBe(false)
      expect(decrypt(after)).toBe('next')
    })

    it('clears the password when clearPassword is set', () => {
      const host = repo.createHost(input({ authType: 'password', password: 'orig' }))
      const updated = repo.updateHost(host.id, input({ authType: 'password', clearPassword: true }))
      expect(updated.hasPassword).toBe(false)
      expect(repo.findHostRow(host.id)?.passwordEnc).toBeNull()
    })

    it('keep/replace/clear semantics for the passphrase', () => {
      const base = { authType: 'key' as const, keyPath: '/k' }
      const host = repo.createHost(input({ ...base, passphrase: 'orig' }))
      const before = repo.findHostRow(host.id)?.passphraseEnc as Buffer

      expect(repo.updateHost(host.id, input(base)).hasPassphrase).toBe(true)
      expect(hostEnc(host.id, 'passphraseEnc').equals(before)).toBe(true)

      repo.updateHost(host.id, input({ ...base, passphrase: 'next' }))
      expect(decrypt(repo.findHostRow(host.id)?.passphraseEnc as Buffer)).toBe('next')

      expect(
        repo.updateHost(host.id, input({ ...base, clearPassphrase: true })).hasPassphrase,
      ).toBe(false)
      expect(repo.findHostRow(host.id)?.passphraseEnc).toBeNull()
    })

    it('keep/replace/clear semantics for the VNC password', () => {
      const host = repo.createHost(input({ kind: 'vnc', vncPassword: 'orig' }))
      const before = repo.findHostRow(host.id)?.vncPasswordEnc as Buffer

      expect(repo.updateHost(host.id, input({ kind: 'vnc' })).hasVncPassword).toBe(true)
      expect(hostEnc(host.id, 'vncPasswordEnc').equals(before)).toBe(true)

      repo.updateHost(host.id, input({ kind: 'vnc', vncPassword: 'next' }))
      expect(decrypt(repo.findHostRow(host.id)?.vncPasswordEnc as Buffer)).toBe('next')

      expect(
        repo.updateHost(host.id, input({ kind: 'vnc', clearVncPassword: true })).hasVncPassword,
      ).toBe(false)
      expect(repo.findHostRow(host.id)?.vncPasswordEnc).toBeNull()
    })

    it('switching authType password→agent nulls the stored password', () => {
      const host = repo.createHost(input({ authType: 'password', password: 'orig' }))
      const updated = repo.updateHost(host.id, input({ authType: 'agent' }))
      expect(updated.hasPassword).toBe(false)
      expect(repo.findHostRow(host.id)?.passwordEnc).toBeNull()
    })

    it('switching authType key→password nulls the passphrase but keeps the new password', () => {
      const host = repo.createHost(input({ authType: 'key', keyPath: '/k', passphrase: 'pp' }))
      const updated = repo.updateHost(host.id, input({ authType: 'password', password: 'pw' }))
      expect(updated.hasPassphrase).toBe(false)
      expect(updated.hasPassword).toBe(true)
      const row = repo.findHostRow(host.id)
      expect(row?.passphraseEnc).toBeNull()
      expect(decrypt(row?.passwordEnc as Buffer)).toBe('pw')
    })

    it('refuses a password sent alongside a non-password authType', () => {
      const host = repo.createHost(input())
      const updated = repo.updateHost(host.id, input({ authType: 'agent', password: 'sneaky' }))
      expect(updated.hasPassword).toBe(false)
      expect(repo.findHostRow(host.id)?.passwordEnc).toBeNull()
    })

    it('the VNC password survives an authType switch', () => {
      // kind 'both' allows VNC secret to survive SSH auth changes
      const host = repo.createHost(
        input({ kind: 'both', authType: 'password', password: 'pw', vncPassword: 'vnc' }),
      )
      const updated = repo.updateHost(host.id, input({ kind: 'both', authType: 'agent' }))
      expect(updated.hasVncPassword).toBe(true)
      expect(decrypt(repo.findHostRow(host.id)?.vncPasswordEnc as Buffer)).toBe('vnc')
    })
  })

  describe('updateHost non-secret fields', () => {
    it('full-replace semantics: omitted optional fields are reset to null/defaults', () => {
      const host = repo.createHost(
        input({
          authType: 'key',
          keyPath: '/keys/id_ed25519',
          proxyJump: 'jump@bastion',
          color: '#ff0000',
          vncPort: 5901,
          vncMode: 'direct',
          tags: ['prod', 'eu'],
          port: 2222,
        }),
      )
      const updated = repo.updateHost(host.id, input({ label: 'bare' }))
      expect(updated).toMatchObject({
        label: 'bare',
        port: 22,
        authType: 'agent',
        keyPath: null,
        proxyJump: null,
        color: null,
        vncPort: null,
        vncMode: 'tunnel',
        tags: [],
      })
    })

    it('overwrites every provided non-secret field', () => {
      const host = repo.createHost(input())
      const updated = repo.updateHost(
        host.id,
        input({
          label: 'edited',
          hostname: 'new.example.com',
          username: 'deploy',
          port: 2200,
          proxyJump: 'hop@a,hop@b',
          tags: ['x'],
          vncPort: 5900,
          vncMode: 'direct',
        }),
      )
      expect(updated).toMatchObject({
        label: 'edited',
        hostname: 'new.example.com',
        username: 'deploy',
        port: 2200,
        proxyJump: 'hop@a,hop@b',
        tags: ['x'],
        vncPort: 5900,
        vncMode: 'direct',
      })
      expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt)
    })

    it('throws for an unknown host id', () => {
      expect(() => repo.updateHost('missing', input())).toThrow('Host not found')
    })
  })

  describe('tags JSON round-trip', () => {
    it('round-trips tag arrays through the DB', () => {
      const host = repo.createHost(input({ tags: ['prod', 'db', 'eu-west'] }))
      expect(repo.findHost(host.id)?.tags).toEqual(['prod', 'db', 'eu-west'])
    })

    it('falls back to [] for corrupt or non-array tags and filters non-strings', () => {
      const host = repo.createHost(input({ tags: ['ok'] }))
      const setTags = (raw: string) =>
        dbMod.getSqlite().prepare('UPDATE hosts SET tags = ? WHERE id = ?').run(raw, host.id)

      setTags('definitely not json')
      expect(repo.findHost(host.id)?.tags).toEqual([])

      setTags('{"a":1}')
      expect(repo.findHost(host.id)?.tags).toEqual([])

      setTags('["a", 1, null, "b"]')
      expect(repo.findHost(host.id)?.tags).toEqual(['a', 'b'])
    })
  })

  describe('findHostRowByEndpoint', () => {
    it('matches on the hostname + username + port triple', () => {
      const host = repo.createHost(
        input({ hostname: 'bastion.example.com', username: 'jump', port: 2222 }),
      )
      const row = repo.findHostRowByEndpoint('bastion.example.com', 'jump', 2222)
      expect(row?.id).toBe(host.id)
    })

    it('returns null when any component differs', () => {
      repo.createHost(input({ hostname: 'bastion.example.com', username: 'jump', port: 2222 }))
      expect(repo.findHostRowByEndpoint('bastion.example.com', 'jump', 22)).toBeNull()
      expect(repo.findHostRowByEndpoint('bastion.example.com', 'root', 2222)).toBeNull()
      expect(repo.findHostRowByEndpoint('other.example.com', 'jump', 2222)).toBeNull()
    })
  })

  describe('deleteHost', () => {
    it('removes the host', () => {
      const host = repo.createHost(input())
      repo.deleteHost(host.id)
      expect(repo.findHost(host.id)).toBeNull()
      expect(repo.listHosts()).toEqual([])
    })

    it('is a no-op for an unknown id', () => {
      expect(() => repo.deleteHost('missing')).not.toThrow()
    })
  })

  describe('duplicateHost', () => {
    it('copies every setting and secret, overriding only label and hostname', () => {
      const source = repo.createHost(
        input({
          label: 'orig',
          hostname: '10.0.0.1',
          kind: 'both',
          authType: 'password',
          password: 'pw',
          vncPassword: 'vnc',
          port: 2222,
          proxyJump: 'jump@bastion',
        }),
      )
      const copy = repo.duplicateHost(source.id, 'orig copy', '10.0.0.2')

      expect(copy.id).not.toBe(source.id)
      expect(copy.label).toBe('orig copy')
      expect(copy.hostname).toBe('10.0.0.2')
      // Everything else carries over.
      expect(copy.port).toBe(2222)
      expect(copy.kind).toBe('both')
      expect(copy.proxyJump).toBe('jump@bastion')
      // Encrypted secrets are copied (not lost, not re-prompted).
      const row = repo.findHostRow(copy.id)
      expect(decrypt(row?.passwordEnc as Buffer)).toBe('pw')
      expect(decrypt(row?.vncPasswordEnc as Buffer)).toBe('vnc')
      expect(copy.hasPassword).toBe(true)
      expect(copy.hasVncPassword).toBe(true)
      // Both rows exist independently.
      expect(repo.listHosts()).toHaveLength(2)
    })

    it('copies the credential and group references', () => {
      const group = groupsRepo.createGroup({ name: 'g' })
      const source = repo.createHost(input({ groupId: group.id }))
      const copy = repo.duplicateHost(source.id, 'copy', 'h2')
      expect(copy.groupId).toBe(group.id)
    })

    it('throws for an unknown source id', () => {
      expect(() => repo.duplicateHost('missing', 'x', 'y')).toThrow('Host not found')
    })
  })

  describe('setHostGroup', () => {
    it('reassigns only the group and bumps updatedAt, leaving secrets intact', () => {
      const group = groupsRepo.createGroup({ name: 'g' })
      const host = repo.createHost(input({ authType: 'password', password: 'pw' }))
      const before = repo.findHostRow(host.id)

      const moved = repo.setHostGroup(host.id, group.id)
      expect(moved.groupId).toBe(group.id)
      expect(moved.updatedAt).toBeGreaterThanOrEqual(before?.updatedAt as number)
      // The narrow update must not touch the stored secret.
      expect(hostEnc(host.id, 'passwordEnc').equals(before?.passwordEnc as Buffer)).toBe(true)

      // null moves it back to ungrouped.
      expect(repo.setHostGroup(host.id, null).groupId).toBeNull()
    })

    it('throws for an unknown host', () => {
      expect(() => repo.setHostGroup('missing', null)).toThrow('Host not found')
    })
  })

  describe('group foreign key', () => {
    it('ON DELETE SET NULL detaches member hosts instead of deleting them', () => {
      const group = groupsRepo.createGroup({ name: 'prod' })
      const host = repo.createHost(input({ groupId: group.id }))
      expect(repo.findHost(host.id)?.groupId).toBe(group.id)

      groupsRepo.deleteGroup(group.id)
      const after = repo.findHost(host.id)
      expect(after).not.toBeNull()
      expect(after?.groupId).toBeNull()
    })

    it('rejects a groupId that references a missing group', () => {
      expect(() => repo.createHost(input({ groupId: 'ghost-group' }))).toThrow(/FOREIGN KEY/i)
    })
  })

  it('deletes a host and its orphaned saved tunnels', () => {
    const host = repo.createHost(input({ label: 'tunnelled' }))
    const sqlite = dbMod.getSqlite()
    sqlite
      .prepare(
        `INSERT INTO tunnels (id, host_id, type, listen_host, listen_port, created_at, updated_at)
         VALUES ('t1', ?, 'local', '127.0.0.1', 15432, 1, 1)`,
      )
      .run(host.id)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM tunnels').get()).toEqual({ n: 1 })

    repo.deleteHost(host.id)
    // tunnels.host_id has no FK, so nothing else would have removed this row.
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM tunnels').get()).toEqual({ n: 0 })
  })
})
