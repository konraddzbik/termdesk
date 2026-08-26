import { randomUUID } from 'node:crypto'
import { type ActivityEntry, activityEntrySchema } from '@shared/ipc'
import { desc } from 'drizzle-orm'
import { getDb, getSqlite } from './db'
import { activityLog } from './schema'

/** Keep the newest N entries; older ones are pruned on insert. */
const LOG_CAP = 2000
/** Hard time cap: drop entries older than this on insert (privacy hygiene). */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
/** Default page size for the renderer. */
const DEFAULT_LIMIT = 500

type ActivityRow = typeof activityLog.$inferSelect

function toEntry(row: ActivityRow): ActivityEntry {
  return activityEntrySchema.parse({
    id: row.id,
    ts: row.ts,
    action: row.action,
    kind: row.kind,
    hostId: row.hostId,
    hostLabel: row.hostLabel,
    hostSubtitle: row.hostSubtitle,
    detail: row.detail,
    user: row.user,
    device: row.device,
  })
}

/** What `recordActivity` accepts; id/ts are stamped here. */
export interface ActivityInput {
  ts: number
  action: ActivityEntry['action']
  kind: ActivityEntry['kind']
  hostId: string | null
  hostLabel: string
  hostSubtitle: string | null
  detail: string | null
  user: string | null
  device: string | null
}

export function recordActivity(input: ActivityInput): ActivityEntry {
  const row: typeof activityLog.$inferInsert = { id: randomUUID(), ...input }
  const inserted = getDb().insert(activityLog).values(row).returning().get()
  if (!inserted) throw new Error('Failed to record activity')
  // Prune anything beyond the newest LOG_CAP rows.
  getSqlite()
    .prepare(
      `DELETE FROM activity_log WHERE id NOT IN (
         SELECT id FROM activity_log ORDER BY ts DESC, id DESC LIMIT ?
       )`,
    )
    .run(LOG_CAP)
  // Time-based purge: drop entries older than MAX_AGE_MS so the log doesn't
  // retain command/host history indefinitely.
  getSqlite()
    .prepare('DELETE FROM activity_log WHERE ts < ?')
    .run(input.ts - MAX_AGE_MS)
  return toEntry(inserted)
}

export function listActivity(limit = DEFAULT_LIMIT): ActivityEntry[] {
  return getDb()
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.ts))
    .limit(limit)
    .all()
    .map(toEntry)
}

export function clearActivity(): void {
  getSqlite().prepare('DELETE FROM activity_log').run()
}
