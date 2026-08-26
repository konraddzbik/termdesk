import { randomUUID } from 'node:crypto'
import { IPC_EVENTS } from '@shared/channels'
import { type AiAuditEntry, aiAuditEntrySchema } from '@shared/ipc'
import { desc } from 'drizzle-orm'
import { BrowserWindow } from 'electron'
import { getDb, getSqlite } from './db'
import { aiAudit } from './schema'

/** Keep the newest N entries; older ones are pruned on insert. */
const LOG_CAP = 5000
/** Drop entries older than this on insert. */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const DEFAULT_LIMIT = 500

type AiAuditRow = typeof aiAudit.$inferSelect

function toEntry(row: AiAuditRow): AiAuditEntry {
  return aiAuditEntrySchema.parse({
    id: row.id,
    ts: row.ts,
    client: row.client,
    tool: row.tool,
    hostId: row.hostId,
    hostLabel: row.hostLabel,
    summary: row.summary,
    verdict: row.verdict,
    outcome: row.outcome,
    detail: row.detail,
    durationMs: row.durationMs,
    inBytes: row.inBytes,
    outBytes: row.outBytes,
  })
}

/** Fields a caller supplies; id/ts are stamped here. */
export interface AiAuditInput {
  ts?: number
  client: string | null
  tool: string
  hostId: string | null
  hostLabel: string | null
  summary: string
  verdict: AiAuditEntry['verdict']
  outcome: AiAuditEntry['outcome']
  detail: string | null
  durationMs: number | null
  inBytes?: number | null
  outBytes?: number | null
}

function broadcast(entry: AiAuditEntry): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.aiAuditEvent, entry)
  }
}

/**
 * Records one AI-audit row, prunes, and broadcasts it live to open windows.
 * Best-effort: auditing must never throw into a tool call (callers still get
 * their result), but a missing audit row would be a security gap, so callers
 * should treat a thrown error as a reason to refuse the action.
 */
export function recordAiAudit(input: AiAuditInput): AiAuditEntry {
  const ts = input.ts ?? Date.now()
  const row: typeof aiAudit.$inferInsert = {
    id: randomUUID(),
    ts,
    client: input.client,
    tool: input.tool,
    hostId: input.hostId,
    hostLabel: input.hostLabel,
    summary: input.summary,
    verdict: input.verdict,
    outcome: input.outcome,
    detail: input.detail,
    durationMs: input.durationMs,
    inBytes: input.inBytes ?? null,
    outBytes: input.outBytes ?? null,
  }
  const inserted = getDb().insert(aiAudit).values(row).returning().get()
  if (!inserted) throw new Error('Failed to record AI audit entry')
  getSqlite()
    .prepare(
      `DELETE FROM ai_audit WHERE id NOT IN (
         SELECT id FROM ai_audit ORDER BY ts DESC, id DESC LIMIT ?
       )`,
    )
    .run(LOG_CAP)
  getSqlite()
    .prepare('DELETE FROM ai_audit WHERE ts < ?')
    .run(ts - MAX_AGE_MS)
  const entry = toEntry(inserted)
  broadcast(entry)
  return entry
}

export function listAiAudit(limit = DEFAULT_LIMIT): AiAuditEntry[] {
  return getDb().select().from(aiAudit).orderBy(desc(aiAudit.ts)).limit(limit).all().map(toEntry)
}

export function clearAiAudit(): void {
  getSqlite().prepare('DELETE FROM ai_audit').run()
}
