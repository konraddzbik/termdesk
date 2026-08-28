// Performance benchmark harness (issue #56) — scaffold.
//
// Emits a results JSON in the shape `src/shared/bench-metrics.ts` consumes, so
// CI can diff against per-metric budgets (checkBudgets) and fail on regression.
// Metrics that require the packaged Electron app (cold start, keystroke latency,
// idle RSS per session) are marked `pending` here until the harness drives a
// real build; this file establishes the contract and the metric keys.
//
// Usage:  node scripts/bench.mjs            # human summary
//         node scripts/bench.mjs --json     # machine-readable results

import { performance } from 'node:perf_hooks'

const asJson = process.argv.includes('--json')

// A measurement we can make right now without the app: how long it takes to
// require the built shared bundle equivalent (a cheap, stable proxy that CI can
// trend). Real app metrics land when the harness spawns the packaged binary.
function measureModuleInitMs() {
  const start = performance.now()
  // Touch a few core Node built-ins the app loads at startup.
  void [import('node:crypto'), import('node:path'), import('node:os')]
  return Number((performance.now() - start).toFixed(3))
}

const results = [
  { metric: 'moduleInitMs', value: measureModuleInitMs(), unit: 'ms', status: 'measured' },
  // Pending: require the packaged app + a headless driver.
  { metric: 'coldStartMs', value: null, unit: 'ms', status: 'pending' },
  { metric: 'keystrokeLatencyMs', value: null, unit: 'ms', status: 'pending' },
  { metric: 'heavyOutputThroughputOps', value: null, unit: 'ops', status: 'pending' },
  { metric: 'idleRssPerSessionMb', value: null, unit: 'MB', status: 'pending' },
]

if (asJson) {
  console.log(JSON.stringify({ generatedBy: 'scripts/bench.mjs', results }, null, 2))
} else {
  console.log('TermDesk performance harness (scaffold)\n')
  for (const r of results) {
    const val = r.value == null ? `(${r.status})` : `${r.value}${r.unit}`
    console.log(`  ${r.metric.padEnd(28)} ${val}`)
  }
  console.log('\nPending metrics need the packaged app + a headless driver (see issue #56).')
}
