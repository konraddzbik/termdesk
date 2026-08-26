import type { AiAuditEntry } from '@shared/ipc'

/**
 * APPROXIMATE usage accounting for AI-agent activity.
 *
 * TermDesk is an MCP *server* — the LLM runs in the external client, so the
 * provider's real token usage and cost never reach us. Everything here is a
 * local estimate derived from the byte size of the command + output that passed
 * THROUGH TermDesk, times a user-picked model rate. It is a directional signal
 * ("how much data did the agent push through my machine"), never a bill. The UI
 * must label it as approximate.
 */

export interface ModelRate {
  label: string
  /** USD per 1M input tokens (illustrative list price; adjust as needed). */
  inputPer1M: number
  /** USD per 1M output tokens. */
  outputPer1M: number
}

/** A small, editable set of well-known model rates. Approximate list prices. */
export const MODEL_RATES: Record<string, ModelRate> = {
  'claude-opus': { label: 'Claude Opus', inputPer1M: 15, outputPer1M: 75 },
  'claude-sonnet': { label: 'Claude Sonnet', inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku': { label: 'Claude Haiku', inputPer1M: 0.8, outputPer1M: 4 },
  grok: { label: 'Grok', inputPer1M: 3, outputPer1M: 15 },
  'gpt-4o': { label: 'GPT-4o', inputPer1M: 2.5, outputPer1M: 10 },
}

export const DEFAULT_MODEL = 'claude-sonnet'

/** Resolve a model key to a rate, always returning a defined rate. */
export function rateFor(model: string): ModelRate {
  return (
    MODEL_RATES[model] ??
    MODEL_RATES[DEFAULT_MODEL] ?? { label: 'model', inputPer1M: 0, outputPer1M: 0 }
  )
}

/** Rough bytes-per-token for English-ish text. Estimate only. */
export const BYTES_PER_TOKEN = 4

export function estimateTokens(bytes: number | null | undefined): number {
  return typeof bytes === 'number' && bytes > 0 ? Math.ceil(bytes / BYTES_PER_TOKEN) : 0
}

export function estimateCostUsd(inTokens: number, outTokens: number, rate: ModelRate): number {
  return (inTokens / 1_000_000) * rate.inputPer1M + (outTokens / 1_000_000) * rate.outputPer1M
}

export interface UsageTotals {
  actions: number
  inTokens: number
  outTokens: number
  costUsd: number
}

/** Sum estimated tokens (and cost, at `rate`) across the given audit entries. */
export function summarizeUsage(entries: readonly AiAuditEntry[], rate: ModelRate): UsageTotals {
  let inTokens = 0
  let outTokens = 0
  for (const e of entries) {
    inTokens += estimateTokens(e.inBytes)
    outTokens += estimateTokens(e.outBytes)
  }
  return {
    actions: entries.length,
    inTokens,
    outTokens,
    costUsd: estimateCostUsd(inTokens, outTokens, rate),
  }
}

/** Case-insensitive substring match across an entry's searchable text fields. */
export function matchesAudit(entry: AiAuditEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return [entry.tool, entry.client, entry.hostLabel, entry.summary, entry.detail].some(
    (v) => typeof v === 'string' && v.toLowerCase().includes(q),
  )
}
