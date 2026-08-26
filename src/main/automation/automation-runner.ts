import { randomUUID } from 'node:crypto'
import type { AutomationEvent } from '@shared/ipc'
import { runCommand } from '../ssh/command-runner'
import type { DataSink } from '../ssh/session-manager'

/** Max hosts executing at once per run, to avoid resource storms on big fleets. */
const MAX_CONCURRENT = 8

type Emit = (event: AutomationEvent) => void

/**
 * Fans a single command out across many hosts concurrently (bounded), tagging
 * every streamed event with its `runId` + `hostId`. Runs are cancellable by id.
 * IPC-agnostic: the caller supplies `emit` (and gets it back to the renderer).
 */
class AutomationRunner {
  private readonly active = new Map<string, { controller: AbortController; ownerId: number }>()

  /** Starts a run and returns its id immediately; events stream via `emit`. */
  start(owner: DataSink, hostIds: string[], command: string, emit: Emit): string {
    const runId = randomUUID()
    const controller = new AbortController()
    this.active.set(runId, { controller, ownerId: owner.id })
    void this.run(runId, owner, hostIds, command, controller.signal, emit).finally(() => {
      this.active.delete(runId)
    })
    return runId
  }

  /**
   * Cancels every in-flight host of a run. No-op for unknown/finished runs, or
   * if the run belongs to a different owner (window) — a window can only cancel
   * its own runs.
   */
  cancel(runId: string, ownerId: number): void {
    const entry = this.active.get(runId)
    if (entry && entry.ownerId === ownerId) entry.controller.abort()
  }

  private async run(
    runId: string,
    owner: DataSink,
    hostIds: string[],
    command: string,
    signal: AbortSignal,
    emit: Emit,
  ): Promise<void> {
    const queue = [...hostIds]
    const worker = async (): Promise<void> => {
      for (;;) {
        const hostId = queue.shift()
        if (hostId === undefined) return
        await this.runOne(runId, owner, hostId, command, signal, emit)
      }
    }
    const lanes = Math.min(MAX_CONCURRENT, queue.length)
    await Promise.all(Array.from({ length: lanes }, () => worker()))
  }

  private async runOne(
    runId: string,
    owner: DataSink,
    hostId: string,
    command: string,
    signal: AbortSignal,
    emit: Emit,
  ): Promise<void> {
    if (owner.isDestroyed()) return
    emit({ runId, hostId, type: 'started' })
    if (signal.aborted) {
      emit({ runId, hostId, type: 'error', message: 'Run cancelled' })
      return
    }
    try {
      const result = await runCommand(
        hostId,
        owner,
        command,
        {
          onStdout: (chunk) => emit({ runId, hostId, type: 'stdout', chunk }),
          onStderr: (chunk) => emit({ runId, hostId, type: 'stderr', chunk }),
        },
        signal,
      )
      emit({ runId, hostId, type: 'exit', exitCode: result.exitCode })
    } catch (err) {
      emit({
        runId,
        hostId,
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

export const automationRunner = new AutomationRunner()
