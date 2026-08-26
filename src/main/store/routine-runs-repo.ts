import { randomUUID } from 'node:crypto'
import { type RoutineRun, type RoutineRunStatus, routineRunSchema } from '@shared/ipc'
import { desc, eq, sql } from 'drizzle-orm'
import { getDb, getSqlite } from './db'
import { routineRuns } from './schema'

/**
 * Retention, matching `activity_log` and `ai_audit`. Run summaries embed the
 * composed agent command (prompt body included), so an unbounded table is both
 * a growth problem and a retention problem: anything `redactSecrets` misses
 * would otherwise be kept forever. Capped per routine so a chatty 5-minute
 * schedule can't evict another routine's history.
 */
const RUNS_PER_ROUTINE_CAP = 200
/** Hard time cap: drop runs older than this on insert (privacy hygiene). */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

type Row = typeof routineRuns.$inferSelect

function toRun(row: Row): RoutineRun {
  return routineRunSchema.parse({
    id: row.id,
    routineId: row.routineId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status,
    exitCode: row.exitCode,
    summary: row.summary,
    outBytes: row.outBytes,
  })
}

export interface RecordRunFields {
  routineId: string
  status: RoutineRunStatus
  /** Already-redacted summary (redaction happens in the IPC layer). */
  summary?: string | null
  exitCode?: number | null
  outBytes?: number | null
  finished?: boolean
}

/** Inserts one run row. A terminal status (not 'running') sets `finishedAt`. */
export function recordRun(fields: RecordRunFields): RoutineRun {
  const now = Date.now()
  const finished = fields.status !== 'running'
  const row: typeof routineRuns.$inferInsert = {
    id: randomUUID(),
    routineId: fields.routineId,
    startedAt: now,
    finishedAt: finished ? now : null,
    status: fields.status,
    exitCode: fields.exitCode ?? null,
    summary: fields.summary ?? null,
    outBytes: fields.outBytes ?? null,
  }
  const inserted = getDb().insert(routineRuns).values(row).returning().get()
  if (!inserted) throw new Error('Failed to record routine run')
  pruneRuns(fields.routineId, now)
  return toRun(inserted)
}

/** Keeps this routine's newest N runs and drops anything older than MAX_AGE_MS. */
function pruneRuns(routineId: string, now: number): void {
  const sqlite = getSqlite()
  sqlite
    .prepare(
      `DELETE FROM routine_runs WHERE routine_id = ? AND id NOT IN (
         SELECT id FROM routine_runs WHERE routine_id = ?
         ORDER BY started_at DESC, rowid DESC LIMIT ?
       )`,
    )
    .run(routineId, routineId, RUNS_PER_ROUTINE_CAP)
  sqlite.prepare('DELETE FROM routine_runs WHERE started_at < ?').run(now - MAX_AGE_MS)
}

/** Most-recent-first run history for one routine. */
export function listRoutineRuns(routineId: string, limit = 50): RoutineRun[] {
  return (
    getDb()
      .select()
      .from(routineRuns)
      .where(eq(routineRuns.routineId, routineId))
      // rowid as a stable tiebreaker so same-millisecond inserts still order by
      // insertion (newest first) deterministically.
      .orderBy(desc(routineRuns.startedAt), desc(sql`rowid`))
      .limit(limit)
      .all()
      .map(toRun)
  )
}
