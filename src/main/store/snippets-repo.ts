import { randomUUID } from 'node:crypto'
import { type Snippet, type snippetInputSchema, snippetSchema } from '@shared/ipc'
import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { getDb } from './db'
import { snippets } from './schema'

/** Fully-parsed snippet input (defaults applied by zod). */
export type SnippetInputParsed = z.output<typeof snippetInputSchema>

type SnippetRow = typeof snippets.$inferSelect

function toSnippet(row: SnippetRow): Snippet {
  return snippetSchema.parse({
    id: row.id,
    name: row.name,
    command: row.command,
    sortOrder: row.sortOrder,
  })
}

export function listSnippets(): Snippet[] {
  return getDb()
    .select()
    .from(snippets)
    .orderBy(asc(snippets.sortOrder), asc(snippets.name))
    .all()
    .map(toSnippet)
}

export function createSnippet(input: SnippetInputParsed): Snippet {
  const row: typeof snippets.$inferInsert = {
    id: randomUUID(),
    name: input.name,
    command: input.command,
    sortOrder: input.sortOrder ?? 0,
  }
  const inserted = getDb().insert(snippets).values(row).returning().get()
  if (!inserted) throw new Error('Failed to create snippet')
  return toSnippet(inserted)
}

export function updateSnippet(id: string, input: SnippetInputParsed): Snippet {
  const db = getDb()
  const existing = db.select().from(snippets).where(eq(snippets.id, id)).get()
  if (!existing) throw new Error('Snippet not found')

  const updated = db
    .update(snippets)
    .set({
      name: input.name,
      command: input.command,
      sortOrder: input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder,
    })
    .where(eq(snippets.id, id))
    .returning()
    .get()
  if (!updated) throw new Error('Snippet not found')
  return toSnippet(updated)
}

export function deleteSnippet(id: string): void {
  getDb().delete(snippets).where(eq(snippets.id, id)).run()
}
