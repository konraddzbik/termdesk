/**
 * Performance budget checking (issue #56).
 *
 * "Electron is slow" is the stick used to beat every app in this category, and
 * the way to neutralize it is to MEASURE and enforce — cold-start, keystroke
 * latency, heavy-output throughput, idle RAM per session — with budgets that
 * fail CI on regression. This is the pure comparison core: given measured
 * results and budgets, decide pass/fail with legible messages. The actual
 * measurement harness (`scripts/bench.mjs`) and the CI wiring layer on top.
 */

export type MetricUnit = 'ms' | 'MB' | 'ops'

/** The metrics the benchmark harness is expected to emit. */
export const METRICS = {
  coldStartMs: 'coldStartMs',
  keystrokeLatencyMs: 'keystrokeLatencyMs',
  heavyOutputThroughputOps: 'heavyOutputThroughputOps',
  idleRssPerSessionMb: 'idleRssPerSessionMb',
} as const

export interface BenchResult {
  metric: string
  value: number
  unit: MetricUnit
}

export interface Budget {
  metric: string
  /** For latency/RAM: an upper bound (value must be ≤ max). */
  max?: number
  /** For throughput: a lower bound (value must be ≥ min). */
  min?: number
}

export interface BudgetFailure {
  metric: string
  message: string
}

export interface BudgetReport {
  passed: boolean
  failures: BudgetFailure[]
  /** Budgets that had no matching measurement — cannot be verified, treated as a failure. */
  missing: string[]
}

/**
 * Check measured `results` against `budgets`. A budget with `max` must not be
 * exceeded; a budget with `min` must be met. A budget with no matching result is
 * "missing" and fails the report (an unverifiable budget is not a pass).
 */
export function checkBudgets(
  results: readonly BenchResult[],
  budgets: readonly Budget[],
): BudgetReport {
  const byMetric = new Map(results.map((r) => [r.metric, r]))
  const failures: BudgetFailure[] = []
  const missing: string[] = []

  for (const budget of budgets) {
    const result = byMetric.get(budget.metric)
    if (!result) {
      missing.push(budget.metric)
      continue
    }
    if (budget.max != null && result.value > budget.max) {
      failures.push({
        metric: budget.metric,
        message: `${budget.metric} ${result.value}${result.unit} exceeds budget ${budget.max}${result.unit}`,
      })
    }
    if (budget.min != null && result.value < budget.min) {
      failures.push({
        metric: budget.metric,
        message: `${budget.metric} ${result.value}${result.unit} is below required ${budget.min}${result.unit}`,
      })
    }
  }

  return { passed: failures.length === 0 && missing.length === 0, failures, missing }
}

/** Render a report as human-readable lines (for CI logs). */
export function formatBudgetReport(report: BudgetReport): string {
  if (report.passed) return '✓ all performance budgets met'
  const lines = report.failures.map((f) => `✗ ${f.message}`)
  for (const m of report.missing) lines.push(`✗ ${m}: no measurement (budget cannot be verified)`)
  return lines.join('\n')
}
