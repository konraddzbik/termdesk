import { randomUUID } from 'node:crypto'
import { type AutomationJob, type automationJobInputSchema, automationJobSchema } from '@shared/ipc'
import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { getDb } from './db'
import { listHosts } from './hosts-repo'
import { automationJobs } from './schema'

/** Fully-parsed job input (defaults applied by zod). */
export type AutomationJobInputParsed = z.output<typeof automationJobInputSchema>

type AutomationJobRow = typeof automationJobs.$inferSelect

/** Parses the JSON `host_ids` column, tolerating malformed data. */
function parseHostIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function toJob(row: AutomationJobRow, liveHostIds: ReadonlySet<string>): AutomationJob {
  // Drop host ids that no longer exist so the UI never references dead hosts.
  const hostIds = parseHostIds(row.hostIds).filter((id) => liveHostIds.has(id))
  return automationJobSchema.parse({
    id: row.id,
    name: row.name,
    command: row.command,
    snippetId: row.snippetId,
    hostIds,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

function liveHostIdSet(): Set<string> {
  return new Set(listHosts().map((h) => h.id))
}

export function listAutomationJobs(): AutomationJob[] {
  const live = liveHostIdSet()
  return getDb()
    .select()
    .from(automationJobs)
    .orderBy(asc(automationJobs.sortOrder), asc(automationJobs.name))
    .all()
    .map((row) => toJob(row, live))
}

export function createAutomationJob(input: AutomationJobInputParsed): AutomationJob {
  const now = Date.now()
  const row: typeof automationJobs.$inferInsert = {
    id: randomUUID(),
    name: input.name,
    command: input.command,
    snippetId: input.snippetId ?? null,
    hostIds: JSON.stringify(input.hostIds),
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  }
  const inserted = getDb().insert(automationJobs).values(row).returning().get()
  if (!inserted) throw new Error('Failed to create automation job')
  return toJob(inserted, liveHostIdSet())
}

export function updateAutomationJob(id: string, input: AutomationJobInputParsed): AutomationJob {
  const db = getDb()
  const existing = db.select().from(automationJobs).where(eq(automationJobs.id, id)).get()
  if (!existing) throw new Error('Automation job not found')

  const updated = db
    .update(automationJobs)
    .set({
      name: input.name,
      command: input.command,
      snippetId: input.snippetId ?? null,
      hostIds: JSON.stringify(input.hostIds),
      sortOrder: input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder,
      updatedAt: Date.now(),
    })
    .where(eq(automationJobs.id, id))
    .returning()
    .get()
  if (!updated) throw new Error('Automation job not found')
  return toJob(updated, liveHostIdSet())
}

export function deleteAutomationJob(id: string): void {
  getDb().delete(automationJobs).where(eq(automationJobs.id, id)).run()
}
