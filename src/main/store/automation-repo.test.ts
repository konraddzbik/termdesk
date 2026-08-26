import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hostInputSchema } from '@shared/ipc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('automation-repo', () => {
  let dir: string
  let repo: typeof import('./automation-repo')
  let hostsRepo: typeof import('./hosts-repo')
  let dbMod: typeof import('./db')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-automation-'))
    process.env.SSHDECK_DB_PATH = join(dir, 'sshdeck.db')
    vi.resetModules()
    dbMod = await import('./db')
    repo = await import('./automation-repo')
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

  /** An agent host has no secret to encrypt, so it needs no real safeStorage. */
  function makeHost(label: string): string {
    return hostsRepo.createHost(
      hostInputSchema.parse({
        label,
        hostname: `${label}.example.com`,
        username: 'root',
        authType: 'agent',
        kind: 'ssh',
      }),
    ).id
  }

  it('creates and lists a job', () => {
    const h1 = makeHost('web')
    const job = repo.createAutomationJob({
      name: 'restart nginx',
      command: 'sudo systemctl restart nginx',
      hostIds: [h1],
    })
    expect(job.name).toBe('restart nginx')
    expect(job.hostIds).toEqual([h1])
    expect(job.snippetId).toBeNull()

    const all = repo.listAutomationJobs()
    expect(all).toHaveLength(1)
    expect(all[0]?.id).toBe(job.id)
  })

  it('updates a job', () => {
    const h1 = makeHost('web')
    const job = repo.createAutomationJob({ name: 'a', command: 'uptime', hostIds: [h1] })
    const updated = repo.updateAutomationJob(job.id, {
      name: 'b',
      command: 'uname -a',
      hostIds: [h1],
    })
    expect(updated.name).toBe('b')
    expect(updated.command).toBe('uname -a')
  })

  it('deletes a job', () => {
    const h1 = makeHost('web')
    const job = repo.createAutomationJob({ name: 'a', command: 'uptime', hostIds: [h1] })
    repo.deleteAutomationJob(job.id)
    expect(repo.listAutomationJobs()).toHaveLength(0)
  })

  it('prunes host ids that no longer exist when reading', () => {
    const h1 = makeHost('web')
    const job = repo.createAutomationJob({
      name: 'mix',
      command: 'echo hi',
      hostIds: [h1, 'deleted-host-id'],
    })
    // Stored as-is, but reads drop dead ids.
    expect(repo.listAutomationJobs()[0]?.hostIds).toEqual([h1])
    // Deleting the remaining host empties the set on the next read.
    hostsRepo.deleteHost(h1)
    expect(repo.listAutomationJobs()[0]?.hostIds).toEqual([])
    expect(job.hostIds).toEqual([h1]) // create-time return reflected the live host
  })
})
