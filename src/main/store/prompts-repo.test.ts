import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promptInputSchema } from '@shared/ipc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

// Same better-sqlite3 ABI shim as the other store tests.
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

type PromptInputRaw = z.input<typeof promptInputSchema>

const input = (over: Partial<PromptInputRaw> = {}) =>
  promptInputSchema.parse({ title: 'Review', body: 'Review {{path}}', ...over })

describe('prompts-repo', () => {
  let dir: string
  let repo: typeof import('./prompts-repo')
  let dbMod: typeof import('./db')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-prompts-'))
    process.env.SSHDECK_DB_PATH = join(dir, 'sshdeck.db')
    vi.resetModules()
    dbMod = await import('./db')
    repo = await import('./prompts-repo')
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

  it('creates a prompt with defaults (empty tags, null description/harness)', () => {
    const p = repo.createPrompt(input())
    expect(p).toMatchObject({
      title: 'Review',
      body: 'Review {{path}}',
      tags: [],
      description: null,
      defaultHarnessId: null,
      sortOrder: 0,
    })
    expect(p.id).toBeTruthy()
    expect(p.createdAt).toBeGreaterThan(0)
  })

  it('round-trips tags, description and defaultHarnessId', () => {
    const p = repo.createPrompt(
      input({ tags: ['review', 'ci'], description: 'a desc', defaultHarnessId: 'claude' }),
    )
    const fetched = repo.getPrompt(p.id)
    expect(fetched).toMatchObject({
      tags: ['review', 'ci'],
      description: 'a desc',
      defaultHarnessId: 'claude',
    })
  })

  it('lists prompts ordered by sortOrder then title', () => {
    repo.createPrompt(input({ title: 'zz', sortOrder: 2 }))
    repo.createPrompt(input({ title: 'beta', sortOrder: 1 }))
    repo.createPrompt(input({ title: 'alpha', sortOrder: 1 }))
    repo.createPrompt(input({ title: 'first', sortOrder: 0 }))
    expect(repo.listPrompts().map((p) => p.title)).toEqual(['first', 'alpha', 'beta', 'zz'])
  })

  it('updates fields, keeping sortOrder when omitted', () => {
    const p = repo.createPrompt(input({ sortOrder: 3 }))
    const updated = repo.updatePrompt(p.id, input({ title: 'New', body: 'x', tags: ['t'] }))
    expect(updated).toMatchObject({ id: p.id, title: 'New', body: 'x', tags: ['t'], sortOrder: 3 })
  })

  it('throws when updating a missing prompt', () => {
    expect(() => repo.updatePrompt('missing', input())).toThrow('Prompt not found')
  })

  it('deletes a prompt and tolerates deleting a missing id', () => {
    const p = repo.createPrompt(input())
    repo.deletePrompt(p.id)
    expect(repo.listPrompts()).toEqual([])
    expect(() => repo.deletePrompt('missing')).not.toThrow()
  })

  it('reorders prompts by the given id order', () => {
    const a = repo.createPrompt(input({ title: 'a' }))
    const b = repo.createPrompt(input({ title: 'b' }))
    const c = repo.createPrompt(input({ title: 'c' }))
    const reordered = repo.reorderPrompts([c.id, a.id, b.id])
    expect(reordered.map((p) => p.title)).toEqual(['c', 'a', 'b'])
  })

  it('tolerates a corrupt tags column, yielding an empty array', () => {
    const p = repo.createPrompt(input())
    dbMod.getSqlite().prepare('UPDATE prompts SET tags = ? WHERE id = ?').run('not json', p.id)
    expect(repo.getPrompt(p.id)?.tags).toEqual([])
  })
})
