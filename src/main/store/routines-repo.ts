import { randomUUID } from 'node:crypto'
import {
  type Routine,
  type routineInputSchema,
  routineScheduleSchema,
  routineSchema,
} from '@shared/ipc'
import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { getDb } from './db'
import { routineRuns, routines } from './schema'

export type RoutineInputParsed = z.output<typeof routineInputSchema>

type Row = typeof routines.$inferSelect

/** Parse the JSON schedule column, falling back to manual on bad data. */
function parseSchedule(raw: string): Routine['schedule'] {
  try {
    return routineScheduleSchema.parse(JSON.parse(raw))
  } catch {
    return { kind: 'manual' }
  }
}

/** Parse the JSON variables column, tolerating bad data. */
function parseVariables(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v
    return out
  } catch {
    return {}
  }
}

function toRoutine(row: Row): Routine {
  return routineSchema.parse({
    id: row.id,
    name: row.name,
    promptId: row.promptId,
    harnessId: row.harnessId,
    cwd: row.cwd,
    mode: row.mode,
    autonomy: row.autonomy === 1,
    schedule: parseSchedule(row.schedule),
    variables: parseVariables(row.variables),
    enabled: row.enabled === 1,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export function listRoutines(): Routine[] {
  return getDb().select().from(routines).orderBy(asc(routines.name)).all().map(toRoutine)
}

export function getRoutine(id: string): Routine | null {
  const row = getDb().select().from(routines).where(eq(routines.id, id)).get()
  return row ? toRoutine(row) : null
}

export function createRoutine(input: RoutineInputParsed): Routine {
  const now = Date.now()
  const row: typeof routines.$inferInsert = {
    id: randomUUID(),
    name: input.name,
    promptId: input.promptId,
    harnessId: input.harnessId,
    cwd: input.cwd,
    mode: input.mode,
    autonomy: input.autonomy ? 1 : 0,
    schedule: JSON.stringify(input.schedule),
    variables: JSON.stringify(input.variables),
    enabled: input.enabled ? 1 : 0,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const inserted = getDb().insert(routines).values(row).returning().get()
  if (!inserted) throw new Error('Failed to save routine')
  return toRoutine(inserted)
}

export function updateRoutine(id: string, input: RoutineInputParsed): Routine {
  const db = getDb()
  const existing = db.select().from(routines).where(eq(routines.id, id)).get()
  if (!existing) throw new Error('Routine not found')
  const updated = db
    .update(routines)
    .set({
      name: input.name,
      promptId: input.promptId,
      harnessId: input.harnessId,
      cwd: input.cwd,
      mode: input.mode,
      autonomy: input.autonomy ? 1 : 0,
      schedule: JSON.stringify(input.schedule),
      variables: JSON.stringify(input.variables),
      enabled: input.enabled ? 1 : 0,
      // Reset scheduler bookkeeping so a changed schedule reschedules from now.
      nextRunAt: null,
      updatedAt: Date.now(),
    })
    .where(eq(routines.id, id))
    .returning()
    .get()
  if (!updated) throw new Error('Routine not found')
  return toRoutine(updated)
}

/** Deletes a routine and, in the same transaction, its run history. */
export function deleteRoutine(id: string): void {
  const db = getDb()
  db.transaction((tx) => {
    tx.delete(routineRuns).where(eq(routineRuns.routineId, id)).run()
    tx.delete(routines).where(eq(routines.id, id)).run()
  })
}

/** Update only `lastRunAt` (used when recording a run; leaves nextRunAt alone). */
export function setRoutineLastRun(id: string, lastRunAt: number): void {
  getDb().update(routines).set({ lastRunAt }).where(eq(routines.id, id)).run()
}

/** Update only `nextRunAt` (owned by the scheduler). */
export function setRoutineNextRun(id: string, nextRunAt: number | null): void {
  getDb().update(routines).set({ nextRunAt }).where(eq(routines.id, id)).run()
}
