import type { AiAuditEntry } from '@shared/ipc'
import { describe, expect, it } from 'vitest'
import { estimateCostUsd, estimateTokens, matchesAudit, rateFor, summarizeUsage } from './ai-usage'

function entry(over: Partial<AiAuditEntry>): AiAuditEntry {
  return {
    id: 'x',
    ts: 0,
    client: null,
    tool: 'run_command',
    hostId: null,
    hostLabel: null,
    summary: '',
    verdict: 'allow',
    outcome: 'ok',
    detail: null,
    durationMs: null,
    inBytes: null,
    outBytes: null,
    ...over,
  }
}

describe('estimateTokens', () => {
  it('is bytes/4 rounded up, 0 for null/zero/negative', () => {
    expect(estimateTokens(400)).toBe(100)
    expect(estimateTokens(401)).toBe(101)
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(null)).toBe(0)
    expect(estimateTokens(undefined)).toBe(0)
    expect(estimateTokens(-5)).toBe(0)
  })
})

describe('estimateCostUsd', () => {
  it('applies per-1M input/output rates', () => {
    const rate = { label: 't', inputPer1M: 3, outputPer1M: 15 }
    // 1M in @3 + 2M out @15 = 3 + 30 = 33
    expect(estimateCostUsd(1_000_000, 2_000_000, rate)).toBeCloseTo(33, 6)
    expect(estimateCostUsd(0, 0, rate)).toBe(0)
  })
})

describe('summarizeUsage', () => {
  it('sums estimated tokens and cost across entries', () => {
    const rate = rateFor('claude-sonnet')
    const totals = summarizeUsage(
      [entry({ inBytes: 400, outBytes: 4000 }), entry({ inBytes: 400, outBytes: null })],
      rate,
    )
    expect(totals.actions).toBe(2)
    expect(totals.inTokens).toBe(200) // (400+400)/4
    expect(totals.outTokens).toBe(1000) // 4000/4
    expect(totals.costUsd).toBeCloseTo((200 / 1e6) * 3 + (1000 / 1e6) * 15, 9)
  })
})

describe('matchesAudit', () => {
  const e = entry({
    tool: 'run_command',
    client: 'Claude Code',
    hostLabel: 'prod-eu-1',
    summary: 'systemctl restart api',
  })
  it('empty query matches everything', () => {
    expect(matchesAudit(e, '')).toBe(true)
    expect(matchesAudit(e, '   ')).toBe(true)
  })
  it('matches case-insensitively across fields', () => {
    expect(matchesAudit(e, 'PROD')).toBe(true)
    expect(matchesAudit(e, 'claude')).toBe(true)
    expect(matchesAudit(e, 'restart')).toBe(true)
    expect(matchesAudit(e, 'run_command')).toBe(true)
  })
  it('returns false when nothing matches', () => {
    expect(matchesAudit(e, 'nonexistent')).toBe(false)
  })
})
