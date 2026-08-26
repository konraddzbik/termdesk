import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snippetInputSchema } from '@shared/ipc'
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

type SnippetInputRaw = z.input<typeof snippetInputSchema>

const input = (over: Partial<SnippetInputRaw> = {}) =>
  snippetInputSchema.parse({ name: 'uptime', command: 'uptime -p', ...over })

describe('snippets-repo', () => {
  let dir: string
  let repo: typeof import('./snippets-repo')
  let dbMod: typeof import('./db')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-snippets-'))
    process.env.SSHDECK_DB_PATH = join(dir, 'sshdeck.db')
    vi.resetModules()
    dbMod = await import('./db')
    repo = await import('./snippets-repo')
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

  it('creates a snippet with sortOrder defaulting to 0', () => {
    const snippet = repo.createSnippet(input())
    expect(snippet).toMatchObject({ name: 'uptime', command: 'uptime -p', sortOrder: 0 })
    expect(snippet.id).toBeTruthy()
  })

  it('creates a snippet with an explicit sortOrder', () => {
    expect(repo.createSnippet(input({ sortOrder: 7 })).sortOrder).toBe(7)
  })

  it('lists snippets ordered by sortOrder, then name for ties', () => {
    repo.createSnippet(input({ name: 'zz-last', sortOrder: 2 }))
    repo.createSnippet(input({ name: 'beta', sortOrder: 1 }))
    repo.createSnippet(input({ name: 'alpha', sortOrder: 1 }))
    repo.createSnippet(input({ name: 'first', sortOrder: 0 }))
    expect(repo.listSnippets().map((s) => s.name)).toEqual(['first', 'alpha', 'beta', 'zz-last'])
  })

  it('updates name and command, keeping sortOrder when omitted', () => {
    const snippet = repo.createSnippet(input({ sortOrder: 3 }))
    const updated = repo.updateSnippet(snippet.id, input({ name: 'disk', command: 'df -h' }))
    expect(updated).toMatchObject({ id: snippet.id, name: 'disk', command: 'df -h', sortOrder: 3 })
  })

  it('updates sortOrder when provided, including back to 0', () => {
    const snippet = repo.createSnippet(input({ sortOrder: 5 }))
    expect(repo.updateSnippet(snippet.id, input({ sortOrder: 0 })).sortOrder).toBe(0)
  })

  it('persists updates (visible through listSnippets)', () => {
    const snippet = repo.createSnippet(input())
    repo.updateSnippet(snippet.id, input({ name: 'mem', command: 'free -m' }))
    expect(repo.listSnippets()).toEqual([
      expect.objectContaining({ id: snippet.id, name: 'mem', command: 'free -m' }),
    ])
  })

  it('throws when updating a missing snippet', () => {
    expect(() => repo.updateSnippet('missing', input())).toThrow('Snippet not found')
  })

  it('deletes a snippet and tolerates deleting a missing id', () => {
    const snippet = repo.createSnippet(input())
    repo.deleteSnippet(snippet.id)
    expect(repo.listSnippets()).toEqual([])
    expect(() => repo.deleteSnippet('missing')).not.toThrow()
  })
})
