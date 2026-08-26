/**
 * The routine scheduler: a thin main-process loop over the pure functions in
 * `schedule.ts`. It ticks once a minute (like the updater's poll), finds due
 * routines, and asks the renderer to run each one (interactive runs open a
 * visible terminal, which is a renderer concern). All scheduling math lives in
 * `schedule.ts`; this file only wires timers, persistence, and the IPC nudge.
 *
 * Honest limits: routines fire only while TermDesk is running. A run missed
 * while the app was closed is caught up **once** on the next launch (its
 * `nextRunAt` is in the past → due → fire → reschedule from now).
 */

import { IPC_EVENTS } from '@shared/channels'
import type { Routine } from '@shared/ipc'
import { BrowserWindow } from 'electron'
import { computeNextRun, dueRoutines } from './schedule'
import { listRoutines, setRoutineNextRun } from './store/routines-repo'
import { getSettings } from './store/settings'

const TICK_MS = 60_000

let timer: ReturnType<typeof setInterval> | null = null

/** Send a routine to the renderer to run. Fire-and-forget to every window. */
function triggerRoutine(routine: Routine): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_EVENTS.routineTrigger, routine)
  }
}

/**
 * One scheduler pass. Exported for tests. Steps: (1) give any newly-created
 * scheduled routine a `nextRunAt`; (2) fire every due routine and reschedule it
 * from `now` (so a burst of missed intervals collapses to a single run).
 */
export function tickRoutines(now: number = Date.now()): void {
  if (!getSettings().routineSchedulerEnabled) return

  // (1) Initialise nextRunAt for scheduled routines that don't have one yet.
  for (const r of listRoutines()) {
    if (r.enabled && r.schedule.kind !== 'manual' && r.nextRunAt === null) {
      setRoutineNextRun(r.id, computeNextRun(r.schedule, now))
    }
  }

  // (2) Fire everything due, then reschedule it forward.
  for (const r of dueRoutines(listRoutines(), now)) {
    triggerRoutine(r)
    setRoutineNextRun(r.id, computeNextRun(r.schedule, now))
  }
}

/** Start the once-a-minute scheduler. Idempotent. Runs one catch-up tick now. */
export function startRoutineScheduler(): void {
  if (timer !== null) return
  // Catch-up pass on launch (missed-while-closed runs fire once here).
  try {
    tickRoutines()
  } catch {
    // A bad routine must never crash startup.
  }
  timer = setInterval(() => {
    try {
      tickRoutines()
    } catch {
      // Never let a scheduling error take down the tick loop.
    }
  }, TICK_MS)
  timer.unref?.()
}

export function stopRoutineScheduler(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}
