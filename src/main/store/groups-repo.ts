import { randomUUID } from 'node:crypto'
import { type Group, type groupInputSchema, groupSchema } from '@shared/ipc'
import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { getDb } from './db'
import { groups } from './schema'

/** Fully-parsed group input (defaults applied by zod). */
export type GroupInputParsed = z.output<typeof groupInputSchema>

type GroupRow = typeof groups.$inferSelect

function toGroup(row: GroupRow): Group {
  return groupSchema.parse({
    id: row.id,
    name: row.name,
    color: row.color,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
  })
}

export function listGroups(): Group[] {
  return getDb()
    .select()
    .from(groups)
    .orderBy(asc(groups.sortOrder), asc(groups.name))
    .all()
    .map(toGroup)
}

/**
 * Would setting `groupId`'s parent to `parentId` create a cycle? True if
 * `parentId` is the group itself or one of its descendants. Walks up from the
 * proposed parent toward the root using the current parent links.
 */
function wouldCycle(groupId: string, parentId: string | null): boolean {
  if (!parentId) return false
  if (parentId === groupId) return true
  const parentOf = new Map(
    getDb()
      .select()
      .from(groups)
      .all()
      .map((g) => [g.id, g.parentId] as const),
  )
  let cursor: string | null | undefined = parentId
  const seen = new Set<string>()
  while (cursor) {
    if (cursor === groupId) return true
    if (seen.has(cursor)) break // defensive: pre-existing cycle, don't spin forever
    seen.add(cursor)
    cursor = parentOf.get(cursor) ?? null
  }
  return false
}

export function createGroup(input: GroupInputParsed): Group {
  if (input.parentId != null) {
    const parent = getDb().select().from(groups).where(eq(groups.id, input.parentId)).get()
    if (!parent) throw new Error('Parent group not found')
  }
  const row: typeof groups.$inferInsert = {
    id: randomUUID(),
    name: input.name,
    color: input.color ?? null,
    parentId: input.parentId ?? null,
    sortOrder: input.sortOrder ?? 0,
  }
  const inserted = getDb().insert(groups).values(row).returning().get()
  if (!inserted) throw new Error('Failed to create group')
  return toGroup(inserted)
}

export function updateGroup(id: string, input: GroupInputParsed): Group {
  const db = getDb()
  const existing = db.select().from(groups).where(eq(groups.id, id)).get()
  if (!existing) throw new Error('Group not found')

  const parentId = input.parentId !== undefined ? (input.parentId ?? null) : existing.parentId
  if (wouldCycle(id, parentId)) {
    throw new Error('A group cannot be nested inside itself or one of its subgroups')
  }

  const updated = db
    .update(groups)
    .set({
      name: input.name,
      color: input.color !== undefined ? input.color : existing.color,
      parentId,
      sortOrder: input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder,
    })
    .where(eq(groups.id, id))
    .returning()
    .get()
  if (!updated) throw new Error('Group not found')
  return toGroup(updated)
}

export function deleteGroup(id: string): void {
  // hosts.group_id and groups.parent_id are both ON DELETE SET NULL, so member
  // hosts are detached and child groups become top-level — nothing is deleted.
  getDb().delete(groups).where(eq(groups.id, id)).run()
}
