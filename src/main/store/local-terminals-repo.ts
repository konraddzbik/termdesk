import { randomUUID } from 'node:crypto'
import {
  type SavedLocalTerminal,
  type savedLocalTerminalInputSchema,
  savedLocalTerminalSchema,
} from '@shared/ipc'
import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { getDb } from './db'
import { localTerminals } from './schema'

export type SavedLocalTerminalInputParsed = z.output<typeof savedLocalTerminalInputSchema>

type Row = typeof localTerminals.$inferSelect

function toSaved(row: Row): SavedLocalTerminal {
  return savedLocalTerminalSchema.parse({
    id: row.id,
    name: row.name,
    path: row.path,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export function listLocalTerminals(): SavedLocalTerminal[] {
  return getDb()
    .select()
    .from(localTerminals)
    .orderBy(asc(localTerminals.sortOrder), asc(localTerminals.path))
    .all()
    .map(toSaved)
}

export function createLocalTerminal(input: SavedLocalTerminalInputParsed): SavedLocalTerminal {
  const now = Date.now()
  const row: typeof localTerminals.$inferInsert = {
    id: randomUUID(),
    name: input.name ?? null,
    path: input.path,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  }
  const inserted = getDb().insert(localTerminals).values(row).returning().get()
  if (!inserted) throw new Error('Failed to save local terminal')
  return toSaved(inserted)
}

export function updateLocalTerminal(
  id: string,
  input: SavedLocalTerminalInputParsed,
): SavedLocalTerminal {
  const db = getDb()
  const existing = db.select().from(localTerminals).where(eq(localTerminals.id, id)).get()
  if (!existing) throw new Error('Local terminal not found')
  const updated = db
    .update(localTerminals)
    .set({
      name: input.name ?? null,
      path: input.path,
      sortOrder: input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder,
      updatedAt: Date.now(),
    })
    .where(eq(localTerminals.id, id))
    .returning()
    .get()
  if (!updated) throw new Error('Local terminal not found')
  return toSaved(updated)
}

export function deleteLocalTerminal(id: string): void {
  getDb().delete(localTerminals).where(eq(localTerminals.id, id)).run()
}

/**
 * Persist a new ordering: each id gets `sortOrder = its index` in `orderedIds`,
 * so the sidebar's top-to-bottom order round-trips. Unknown ids are no-ops;
 * entries absent from the list keep their prior `sortOrder` (they sink below the
 * reordered ones, which is fine since callers pass the full current list). All
 * writes run in one transaction so a partial failure can't leave a mixed order.
 */
export function reorderLocalTerminals(orderedIds: string[]): SavedLocalTerminal[] {
  const db = getDb()
  db.transaction((tx) => {
    orderedIds.forEach((id, index) => {
      tx.update(localTerminals).set({ sortOrder: index }).where(eq(localTerminals.id, id)).run()
    })
  })
  return listLocalTerminals()
}
