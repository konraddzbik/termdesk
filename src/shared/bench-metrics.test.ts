import { describe, expect, it } from 'vitest'
import {
  type BenchResult,
  type Budget,
  checkBudgets,
  formatBudgetReport,
  METRICS,
} from './bench-metrics'

const results: BenchResult[] = [
  { metric: METRICS.coldStartMs, value: 850, unit: 'ms' },
  { metric: METRICS.keystrokeLatencyMs, value: 12, unit: 'ms' },
  { metric: METRICS.heavyOutputThroughputOps, value: 5000, unit: 'ops' },
  { metric: METRICS.idleRssPerSessionMb, value: 40, unit: 'MB' },
]

describe('checkBudgets', () => {
  it('passes when every budget is met', () => {
    const budgets: Budget[] = [
      { metric: METRICS.coldStartMs, max: 1000 },
      { metric: METRICS.idleRssPerSessionMb, max: 60 },
      { metric: METRICS.heavyOutputThroughputOps, min: 1000 },
    ]
    const report = checkBudgets(results, budgets)
    expect(report.passed).toBe(true)
    expect(report.failures).toEqual([])
    expect(report.missing).toEqual([])
  })

  it('fails a max budget that is exceeded', () => {
    const report = checkBudgets(results, [{ metric: METRICS.coldStartMs, max: 500 }])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.message).toMatch(/coldStartMs 850ms exceeds budget 500ms/)
  })

  it('fails a min budget that is not met', () => {
    const report = checkBudgets(results, [{ metric: METRICS.heavyOutputThroughputOps, min: 9000 }])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.message).toMatch(/below required 9000ops/)
  })

  it('treats a budget with no measurement as a failure (unverifiable)', () => {
    const report = checkBudgets([], [{ metric: METRICS.coldStartMs, max: 1000 }])
    expect(report.passed).toBe(false)
    expect(report.missing).toEqual([METRICS.coldStartMs])
  })
})

describe('formatBudgetReport', () => {
  it('summarizes a pass', () => {
    expect(formatBudgetReport({ passed: true, failures: [], missing: [] })).toMatch(
      /all .* budgets met/,
    )
  })

  it('lists failures and missing metrics', () => {
    const text = formatBudgetReport({
      passed: false,
      failures: [{ metric: 'coldStartMs', message: 'coldStartMs 850ms exceeds budget 500ms' }],
      missing: ['idleRssPerSessionMb'],
    })
    expect(text).toContain('✗ coldStartMs 850ms exceeds budget 500ms')
    expect(text).toContain('✗ idleRssPerSessionMb: no measurement')
  })
})
