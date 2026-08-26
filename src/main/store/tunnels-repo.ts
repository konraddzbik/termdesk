import { randomUUID } from 'node:crypto'
import { type SavedTunnel, type savedTunnelInputSchema, savedTunnelSchema } from '@shared/ipc'
import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { getDb } from './db'
import { tunnels } from './schema'

export type SavedTunnelInputParsed = z.output<typeof savedTunnelInputSchema>

type Row = typeof tunnels.$inferSelect

function toSaved(row: Row): SavedTunnel {
  return savedTunnelSchema.parse({
    id: row.id,
    hostId: row.hostId,
    type: row.type,
    listenHost: row.listenHost,
    listenPort: row.listenPort,
    dstHost: row.dstHost,
    dstPort: row.dstPort,
    name: row.name,
    autoStart: row.autoStart,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export function listTunnels(): SavedTunnel[] {
  return getDb()
    .select()
    .from(tunnels)
    .orderBy(asc(tunnels.sortOrder), asc(tunnels.listenPort))
    .all()
    .map(toSaved)
}

export function findTunnel(id: string): SavedTunnel | null {
  const row = getDb().select().from(tunnels).where(eq(tunnels.id, id)).get()
  return row ? toSaved(row) : null
}

export function createTunnel(input: SavedTunnelInputParsed): SavedTunnel {
  const now = Date.now()
  const row: typeof tunnels.$inferInsert = {
    id: randomUUID(),
    hostId: input.hostId,
    type: input.type,
    listenHost: input.listenHost,
    listenPort: input.listenPort,
    // Dynamic (SOCKS) tunnels never carry a fixed destination.
    dstHost: input.type === 'dynamic' ? null : (input.dstHost ?? null),
    dstPort: input.type === 'dynamic' ? null : (input.dstPort ?? null),
    name: input.name ?? null,
    autoStart: input.autoStart ?? false,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  }
  const inserted = getDb().insert(tunnels).values(row).returning().get()
  if (!inserted) throw new Error('Failed to save tunnel')
  return toSaved(inserted)
}

export function updateTunnel(id: string, input: SavedTunnelInputParsed): SavedTunnel {
  const db = getDb()
  const existing = db.select().from(tunnels).where(eq(tunnels.id, id)).get()
  if (!existing) throw new Error('Tunnel not found')
  const updated = db
    .update(tunnels)
    .set({
      hostId: input.hostId,
      type: input.type,
      listenHost: input.listenHost,
      listenPort: input.listenPort,
      dstHost: input.type === 'dynamic' ? null : (input.dstHost ?? null),
      dstPort: input.type === 'dynamic' ? null : (input.dstPort ?? null),
      name: input.name ?? null,
      autoStart: input.autoStart ?? existing.autoStart,
      sortOrder: input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder,
      updatedAt: Date.now(),
    })
    .where(eq(tunnels.id, id))
    .returning()
    .get()
  if (!updated) throw new Error('Tunnel not found')
  return toSaved(updated)
}

export function deleteTunnel(id: string): void {
  getDb().delete(tunnels).where(eq(tunnels.id, id)).run()
}
