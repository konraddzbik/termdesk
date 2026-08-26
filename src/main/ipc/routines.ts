import { IPC } from '@shared/channels'
import { recordRunInputSchema, routineInputSchema } from '@shared/ipc'
import { redactSecrets } from '@shared/redact'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { listRoutineRuns, recordRun } from '../store/routine-runs-repo'
import {
  createRoutine,
  deleteRoutine,
  listRoutines,
  setRoutineLastRun,
  updateRoutine,
} from '../store/routines-repo'

/** Cap the stored summary so a huge composed command can't bloat the DB. */
const SUMMARY_CAP = 500

export function registerRoutinesIpc(): void {
  ipcMain.handle(IPC.routinesList, () => listRoutines())

  ipcMain.handle(IPC.routinesCreate, (_event, rawInput: unknown) =>
    createRoutine(routineInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.routinesUpdate, (_event, rawId: unknown, rawInput: unknown) =>
    updateRoutine(z.string().parse(rawId), routineInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.routinesDelete, (_event, rawId: unknown) => {
    deleteRoutine(z.string().parse(rawId))
  })

  // Record one execution. The raw command is redacted here (never persisted with
  // secret-bearing tokens), and the routine's lastRunAt is bumped.
  ipcMain.handle(IPC.routinesRecordRun, (_event, rawInput: unknown) => {
    const input = recordRunInputSchema.parse(rawInput)
    const summary =
      input.command !== undefined ? redactSecrets(input.command).slice(0, SUMMARY_CAP) : null
    const run = recordRun({
      routineId: input.routineId,
      status: input.status,
      summary,
      exitCode: input.exitCode ?? null,
    })
    setRoutineLastRun(input.routineId, run.startedAt)
    return run
  })

  ipcMain.handle(IPC.routineRunsList, (_event, rawId: unknown) =>
    listRoutineRuns(z.string().parse(rawId)),
  )
}
