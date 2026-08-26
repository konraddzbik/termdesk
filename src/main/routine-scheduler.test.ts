import type { Routine } from '@shared/ipc'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.fn()
const listRoutines = vi.fn<() => Routine[]>()
const setRoutineNextRun = vi.fn()
let schedulerEnabled = true

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send } }] },
}))
vi.mock('./store/routines-repo', () => ({
  listRoutines: () => listRoutines(),
  setRoutineNextRun: (id: string, next: number | null) => setRoutineNextRun(id, next),
}))
vi.mock('./store/settings', () => ({
  getSettings: () => ({ routineSchedulerEnabled: schedulerEnabled }),
}))

import { IPC_EVENTS } from '@shared/channels'
import { tickRoutines } from './routine-scheduler'

function routine(over: Partial<Routine>): Routine {
  return {
    id: 'r',
    name: 'r',
    promptId: 'p',
    harnessId: 'claude',
    cwd: '/x',
    mode: 'interactive',
    autonomy: false,
    schedule: { kind: 'interval', everyMinutes: 5 },
    variables: {},
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

beforeEach(() => {
  send.mockReset()
  listRoutines.mockReset()
  setRoutineNextRun.mockReset()
  schedulerEnabled = true
})

describe('tickRoutines', () => {
  const now = 10_000_000

  it('initialises nextRunAt for a scheduled routine that has none', () => {
    listRoutines.mockReturnValue([routine({ id: 'a', nextRunAt: null })])
    tickRoutines(now)
    // First pass sets nextRunAt to now + 5min; it is not yet due, so no trigger.
    expect(setRoutineNextRun).toHaveBeenCalledWith('a', now + 5 * 60_000)
    expect(send).not.toHaveBeenCalled()
  })

  it('triggers a due routine and reschedules it forward', () => {
    listRoutines.mockReturnValue([routine({ id: 'due', nextRunAt: now - 1 })])
    tickRoutines(now)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      IPC_EVENTS.routineTrigger,
      expect.objectContaining({ id: 'due' }),
    )
    expect(setRoutineNextRun).toHaveBeenCalledWith('due', now + 5 * 60_000)
  })

  it('does nothing when the scheduler is disabled', () => {
    schedulerEnabled = false
    listRoutines.mockReturnValue([routine({ id: 'due', nextRunAt: now - 1 })])
    tickRoutines(now)
    expect(send).not.toHaveBeenCalled()
    expect(setRoutineNextRun).not.toHaveBeenCalled()
  })

  it('never triggers a disabled routine', () => {
    listRoutines.mockReturnValue([routine({ id: 'off', enabled: false, nextRunAt: now - 1 })])
    tickRoutines(now)
    expect(send).not.toHaveBeenCalled()
  })
})
