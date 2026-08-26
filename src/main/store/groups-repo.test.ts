import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { groupInputSchema, hostInputSchema } from '@shared/ipc'
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

const groupInput = (over: Partial<z.input<typeof groupInputSchema>> = {}) =>
  groupInputSchema.parse({ name: 'group', ...over })

const hostInput = (over: Partial<z.input<typeof hostInputSchema>> = {}) =>
  hostInputSchema.parse({
    label: 'web',
    hostname: 'example.com',
    username: 'root',
    authType: 'agent',
    ...over,
  })

describe('groups-repo subgroups', () => {
  let dir: string
  let repo: typeof import('./groups-repo')
  let hostsRepo: typeof import('./hosts-repo')
  let dbMod: typeof import('./db')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-groups-'))
    process.env.SSHDECK_DB_PATH = join(dir, 'sshdeck.db')
    vi.resetModules()
    dbMod = await import('./db')
    repo = await import('./groups-repo')
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

  it('creates a subgroup under a parent', () => {
    const parent = repo.createGroup(groupInput({ name: 'prod' }))
    const child = repo.createGroup(groupInput({ name: 'eu', parentId: parent.id }))
    expect(child.parentId).toBe(parent.id)
    expect(repo.listGroups().find((g) => g.id === child.id)?.parentId).toBe(parent.id)
  })

  it('rejects creating a subgroup under a non-existent parent', () => {
    expect(() => repo.createGroup(groupInput({ name: 'x', parentId: 'nope' }))).toThrow(
      /parent group not found/i,
    )
  })

  it('re-parents a group on update', () => {
    const a = repo.createGroup(groupInput({ name: 'a' }))
    const b = repo.createGroup(groupInput({ name: 'b' }))
    const updated = repo.updateGroup(b.id, groupInput({ name: 'b', parentId: a.id }))
    expect(updated.parentId).toBe(a.id)
  })

  it('refuses to nest a group inside itself', () => {
    const a = repo.createGroup(groupInput({ name: 'a' }))
    expect(() => repo.updateGroup(a.id, groupInput({ name: 'a', parentId: a.id }))).toThrow(
      /cannot be nested/i,
    )
  })

  it('refuses to nest a group inside one of its own descendants (cycle)', () => {
    const a = repo.createGroup(groupInput({ name: 'a' }))
    const b = repo.createGroup(groupInput({ name: 'b', parentId: a.id }))
    const c = repo.createGroup(groupInput({ name: 'c', parentId: b.id }))
    // Making a a child of c would create a → b → c → a.
    expect(() => repo.updateGroup(a.id, groupInput({ name: 'a', parentId: c.id }))).toThrow(
      /cannot be nested/i,
    )
  })

  it('deleting a parent promotes its subgroups to top level (parentId set null)', () => {
    const parent = repo.createGroup(groupInput({ name: 'prod' }))
    const child = repo.createGroup(groupInput({ name: 'eu', parentId: parent.id }))
    repo.deleteGroup(parent.id)
    const survivors = repo.listGroups()
    expect(survivors.find((g) => g.id === parent.id)).toBeUndefined()
    expect(survivors.find((g) => g.id === child.id)?.parentId).toBeNull()
  })

  it('deleting a group detaches its member hosts (group_id set null)', () => {
    const group = repo.createGroup(groupInput({ name: 'prod' }))
    const host = hostsRepo.createHost(hostInput({ groupId: group.id }))
    expect(hostsRepo.findHost(host.id)?.groupId).toBe(group.id)
    repo.deleteGroup(group.id)
    expect(hostsRepo.findHost(host.id)?.groupId).toBeNull()
  })
})
