import { localTermDataChannel } from '@shared/channels'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataSink } from '../ssh/session-manager'

/** Minimal controllable fake of an IPty. */
class FakePty {
  dataCb?: (d: string) => void
  exitCb?: (e: { exitCode: number; signal?: number }) => void
  written: string[] = []
  resized: Array<[number, number]> = []
  killed = false
  onData(cb: (d: string) => void) {
    this.dataCb = cb
  }
  onExit(cb: (e: { exitCode: number }) => void) {
    this.exitCb = cb
  }
  write(d: string) {
    this.written.push(d)
  }
  resize(c: number, r: number) {
    this.resized.push([c, r])
  }
  kill() {
    this.killed = true
  }
}

const ptys: FakePty[] = []
const spawnOpts: Array<{ cwd?: string }> = []
vi.mock('node-pty', () => ({
  spawn: vi.fn((_shell: string, _args: string[], opts: { cwd?: string }) => {
    spawnOpts.push(opts)
    const p = new FakePty()
    ptys.push(p)
    return p
  }),
}))

function makeOwner(id = 1): DataSink & { sent: Array<[string, unknown]> } {
  const sent: Array<[string, unknown]> = []
  return {
    id,
    sent,
    send: (channel: string, ...args: unknown[]) => sent.push([channel, args[0]]),
    isDestroyed: () => false,
  }
}

describe('local-terminal-manager', () => {
  let mgr: typeof import('./local-terminal-manager').localTerminalManager

  beforeEach(async () => {
    ptys.length = 0
    spawnOpts.length = 0
    process.env.SHELL = '/bin/zsh'
    vi.resetModules()
    mgr = (await import('./local-terminal-manager')).localTerminalManager
  })

  afterEach(() => vi.restoreAllMocks())

  it('opens in the requested cwd', async () => {
    const { tmpdir } = await import('node:os')
    const owner = makeOwner()
    mgr.open(owner, { cwd: tmpdir() })
    expect(spawnOpts[0]?.cwd).toBe(tmpdir())
  })

  it('opens in $HOME only when no cwd was requested', async () => {
    const { homedir } = await import('node:os')
    const owner = makeOwner()
    mgr.open(owner)
    expect(spawnOpts[0]?.cwd).toBe(homedir())
  })

  it('refuses a requested cwd that no longer exists instead of silently using $HOME', () => {
    // A routine scoped to an unmounted volume must NOT run its agent in $HOME —
    // with autonomy on that means an unapproved agent in the user's home dir.
    const owner = makeOwner()
    expect(() => mgr.open(owner, { cwd: '/no/such/dir/xyz' })).toThrow(
      /Cannot open a terminal in "\/no\/such\/dir\/xyz"/,
    )
    expect(spawnOpts).toHaveLength(0)
  })

  it('spawns a shell and returns its basename', () => {
    const owner = makeOwner()
    const { sessionId, shell } = mgr.open(owner)
    expect(sessionId).toBeTruthy()
    expect(shell).toBe('zsh')
    expect(ptys).toHaveLength(1)
  })

  it('buffers output before attach, then flushes and streams live', () => {
    const owner = makeOwner()
    const { sessionId } = mgr.open(owner)
    const pty = ptys[0]
    if (!pty) throw new Error('expected a spawned pty')

    // Output before attach is buffered (not sent yet).
    pty.dataCb?.('prompt$ ')
    expect(owner.sent).toHaveLength(0)

    mgr.attach(sessionId, owner.id)
    expect(owner.sent).toEqual([[localTermDataChannel(sessionId), 'prompt$ ']])

    // Subsequent output streams immediately.
    pty.dataCb?.('ls\n')
    expect(owner.sent.at(-1)).toEqual([localTermDataChannel(sessionId), 'ls\n'])
  })

  it('forwards write and resize to the pty', () => {
    const owner = makeOwner()
    const { sessionId } = mgr.open(owner)
    mgr.write(sessionId, owner.id, 'echo hi\n')
    mgr.resize(sessionId, owner.id, 120, 40)
    expect(ptys[0]?.written).toEqual(['echo hi\n'])
    expect(ptys[0]?.resized).toEqual([[120, 40]])
  })

  it('emits an exit event and drops the session', () => {
    const owner = makeOwner()
    const { sessionId } = mgr.open(owner)
    ptys[0]?.exitCb?.({ exitCode: 0 })
    // exit event delivered…
    expect(owner.sent.some(([ch]) => ch === 'local-term:exit')).toBe(true)
    // …and the session is gone (writes no longer reach a pty).
    mgr.write(sessionId, owner.id, 'x')
    expect(ptys[0]?.written).toEqual([])
  })

  it('ignores operations from a different owner', () => {
    const owner = makeOwner(1)
    const { sessionId } = mgr.open(owner)
    mgr.write(sessionId, 999, 'nope')
    mgr.close(sessionId, 999)
    expect(ptys[0]?.written).toEqual([])
    expect(ptys[0]?.killed).toBe(false)
  })

  it('kills the pty on close', () => {
    const owner = makeOwner()
    const { sessionId } = mgr.open(owner)
    mgr.close(sessionId, owner.id)
    expect(ptys[0]?.killed).toBe(true)
  })
})
