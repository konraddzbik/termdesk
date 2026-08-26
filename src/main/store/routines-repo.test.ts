import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { routineInputSchema } from '@shared/ipc'
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

type RoutineInputRaw = z.input<typeof routineInputSchema>

const input = (over: Partial<RoutineInputRaw> = {}) =>
  routineInputSchema.parse({
    name: 'Daily review',
    promptId: 'p1',
    harnessId: 'claude',
    cwd: '/work/app',
    ...over,
  })

describe('routines-repo + routine-runs-repo', () => {
  let dir: string
  let repo: typeof import('./routines-repo')
  let runsRepo: typeof import('./routine-runs-repo')
  let dbMod: typeof import('./db')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-routines-'))
    process.env.SSHDECK_DB_PATH = join(dir, 'sshdeck.db')
    vi.resetModules()
    dbMod = await import('./db')
    repo = await import('./routines-repo')
    runsRepo = await import('./routine-runs-repo')
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

  it('creates a routine with sane defaults (manual, interactive, disabled autonomy)', () => {
    const r = repo.createRoutine(input())
    expect(r).toMatchObject({
      name: 'Daily review',
      promptId: 'p1',
      harnessId: 'claude',
      cwd: '/work/app',
      mode: 'interactive',
      autonomy: false,
      enabled: true,
      schedule: { kind: 'manual' },
      variables: {},
      lastRunAt: null,
    })
  })

  it('round-trips schedule + variables + autonomy through JSON columns', () => {
    const r = repo.createRoutine(
      input({
        schedule: { kind: 'daily', hour: 9, minute: 30 },
        variables: { path: 'src', focus: 'security' },
        autonomy: true,
      }),
    )
    const fetched = repo.getRoutine(r.id)
    expect(fetched?.schedule).toEqual({ kind: 'daily', hour: 9, minute: 30 })
    expect(fetched?.variables).toEqual({ path: 'src', focus: 'security' })
    expect(fetched?.autonomy).toBe(true)
  })

  it('falls back to a manual schedule / empty vars on corrupt JSON', () => {
    const r = repo.createRoutine(input())
    const sql = dbMod.getSqlite()
    sql
      .prepare('UPDATE routines SET schedule = ?, variables = ? WHERE id = ?')
      .run('not json', 'also not json', r.id)
    const fetched = repo.getRoutine(r.id)
    expect(fetched?.schedule).toEqual({ kind: 'manual' })
    expect(fetched?.variables).toEqual({})
  })

  it('updates a routine and throws for a missing id', () => {
    const r = repo.createRoutine(input())
    const updated = repo.updateRoutine(r.id, input({ name: 'Renamed', enabled: false }))
    expect(updated).toMatchObject({ name: 'Renamed', enabled: false })
    expect(() => repo.updateRoutine('missing', input())).toThrow('Routine not found')
  })

  it('records runs and lists them most-recent-first', () => {
    const r = repo.createRoutine(input())
    runsRepo.recordRun({ routineId: r.id, status: 'launched', summary: 'claude -p …' })
    runsRepo.recordRun({ routineId: r.id, status: 'error', summary: 'boom', exitCode: 1 })
    const runs = runsRepo.listRoutineRuns(r.id)
    expect(runs).toHaveLength(2)
    expect(runs[0]?.status).toBe('error')
    expect(runs[0]?.finishedAt).not.toBeNull() // terminal status sets finishedAt
    expect(runs[1]?.status).toBe('launched')
  })

  it('deletes a routine and cascades its run history', () => {
    const r = repo.createRoutine(input())
    runsRepo.recordRun({ routineId: r.id, status: 'ok' })
    repo.deleteRoutine(r.id)
    expect(repo.getRoutine(r.id)).toBeNull()
    expect(runsRepo.listRoutineRuns(r.id)).toEqual([])
  })
})
