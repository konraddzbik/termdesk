import { randomUUID } from 'node:crypto'
import { type Prompt, type promptInputSchema, promptSchema } from '@shared/ipc'
import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { getDb } from './db'
import { prompts } from './schema'

export type PromptInputParsed = z.output<typeof promptInputSchema>

type Row = typeof prompts.$inferSelect

/** Parse the JSON `tags` column back to a string[], tolerating bad data. */
function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function toPrompt(row: Row): Prompt {
  return promptSchema.parse({
    id: row.id,
    title: row.title,
    body: row.body,
    description: row.description,
    tags: parseTags(row.tags),
    defaultHarnessId: row.defaultHarnessId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export function listPrompts(): Prompt[] {
  return getDb()
    .select()
    .from(prompts)
    .orderBy(asc(prompts.sortOrder), asc(prompts.title))
    .all()
    .map(toPrompt)
}

export function getPrompt(id: string): Prompt | null {
  const row = getDb().select().from(prompts).where(eq(prompts.id, id)).get()
  return row ? toPrompt(row) : null
}

export function createPrompt(input: PromptInputParsed): Prompt {
  const now = Date.now()
  const row: typeof prompts.$inferInsert = {
    id: randomUUID(),
    title: input.title,
    body: input.body,
    description: input.description ?? null,
    tags: JSON.stringify(input.tags),
    defaultHarnessId: input.defaultHarnessId ?? null,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  }
  const inserted = getDb().insert(prompts).values(row).returning().get()
  if (!inserted) throw new Error('Failed to save prompt')
  return toPrompt(inserted)
}

export function updatePrompt(id: string, input: PromptInputParsed): Prompt {
  const db = getDb()
  const existing = db.select().from(prompts).where(eq(prompts.id, id)).get()
  if (!existing) throw new Error('Prompt not found')
  const updated = db
    .update(prompts)
    .set({
      title: input.title,
      body: input.body,
      description: input.description ?? null,
      tags: JSON.stringify(input.tags),
      defaultHarnessId: input.defaultHarnessId ?? null,
      sortOrder: input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder,
      updatedAt: Date.now(),
    })
    .where(eq(prompts.id, id))
    .returning()
    .get()
  if (!updated) throw new Error('Prompt not found')
  return toPrompt(updated)
}

export function deletePrompt(id: string): void {
  getDb().delete(prompts).where(eq(prompts.id, id)).run()
}

/**
 * Persist a new ordering: each id gets `sortOrder = its index` in `orderedIds`.
 * Runs in one transaction so a partial failure can't leave a mixed order.
 */
export function reorderPrompts(orderedIds: string[]): Prompt[] {
  const db = getDb()
  db.transaction((tx) => {
    orderedIds.forEach((id, index) => {
      tx.update(prompts).set({ sortOrder: index }).where(eq(prompts.id, id)).run()
    })
  })
  return listPrompts()
}
