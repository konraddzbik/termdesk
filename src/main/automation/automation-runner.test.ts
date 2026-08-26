import type { AutomationEvent } from '@shared/ipc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataSink } from '../ssh/session-manager'

const runCommand = vi.fn()
vi.mock('../ssh/command-runner', () => ({
  runCommand: (...args: unknown[]) => runCommand(...args),
}))

const owner: DataSink = { id: 1, send: vi.fn(), isDestroyed: () => false }

describe('automationRunner', () => {
  let automationRunner: typeof import('./automation-runner').automationRunner

  beforeEach(async () => {
    vi.resetModules()
    runCommand.mockReset()
    automationRunner = (await import('./automation-runner')).automationRunner
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Resolves once `count` terminal (exit|error) events have been seen. */
  function collectUntilDone(
    hostIds: string[],
    command: string,
    onEach?: (runId: string) => void,
  ): Promise<{ runId: string; events: AutomationEvent[] }> {
    return new Promise((resolve) => {
      const events: AutomationEvent[] = []
      let terminal = 0
      const runId = automationRunner.start(owner, hostIds, command, (e) => {
        events.push(e)
        if (e.type === 'exit' || e.type === 'error') {
          terminal += 1
          if (terminal === hostIds.length) resolve({ runId, events })
        }
      })
      onEach?.(runId)
    })
  }

  it('runs the command on every host and tags events with runId + hostId', async () => {
    runCommand.mockImplementation(
      async (hostId: string, _o: unknown, _c: unknown, cbs: { onStdout(s: string): void }) => {
        cbs.onStdout(`hello from ${hostId}`)
        return { exitCode: 0 }
      },
    )

    const { runId, events } = await collectUntilDone(['a', 'b', 'c'], 'echo hi')

    expect(runCommand).toHaveBeenCalledTimes(3)
    expect(events.every((e) => e.runId === runId)).toBe(true)
    for (const hostId of ['a', 'b', 'c']) {
      const forHost = events.filter((e) => e.hostId === hostId)
      expect(forHost.map((e) => e.type)).toEqual(['started', 'stdout', 'exit'])
      expect(forHost.find((e) => e.type === 'exit')?.exitCode).toBe(0)
    }
  })

  it('reports a non-zero exit and surfaces runCommand errors', async () => {
    runCommand.mockImplementation(async (hostId: string) => {
      if (hostId === 'bad') throw new Error('connect failed')
      return { exitCode: 7 }
    })

    const { events } = await collectUntilDone(['ok', 'bad'], 'do thing')

    expect(events.find((e) => e.hostId === 'ok' && e.type === 'exit')?.exitCode).toBe(7)
    const errEvent = events.find((e) => e.hostId === 'bad' && e.type === 'error')
    expect(errEvent?.message).toBe('connect failed')
  })

  it('completes all hosts even beyond the concurrency cap', async () => {
    runCommand.mockResolvedValue({ exitCode: 0 })
    const hostIds = Array.from({ length: 20 }, (_v, i) => `h${i}`)

    const { events } = await collectUntilDone(hostIds, 'uptime')

    expect(runCommand).toHaveBeenCalledTimes(20)
    expect(events.filter((e) => e.type === 'exit')).toHaveLength(20)
  })

  it('cancel aborts in-flight hosts via the AbortSignal', async () => {
    runCommand.mockImplementation(
      (_h: string, _o: unknown, _c: unknown, _cbs: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) return reject(new Error('Run cancelled'))
          signal.addEventListener('abort', () => reject(new Error('Run cancelled')), { once: true })
        }),
    )

    const { events } = await collectUntilDone(['a', 'b'], 'sleep 999', (runId) => {
      setTimeout(() => automationRunner.cancel(runId, owner.id), 0)
    })

    const errors = events.filter((e) => e.type === 'error')
    expect(errors).toHaveLength(2)
    expect(errors.every((e) => e.message?.toLowerCase().includes('cancel'))).toBe(true)
  })
})
