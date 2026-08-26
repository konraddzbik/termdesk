import type { Routine } from '@shared/ipc'
import { describe, expect, it } from 'vitest'
import { computeNextRun, dueRoutines, parseCron } from './schedule'

const MIN = 60_000

describe('computeNextRun', () => {
  it('returns null for a manual schedule', () => {
    expect(computeNextRun({ kind: 'manual' }, 1_000)).toBeNull()
  })

  it('adds the interval for an interval schedule', () => {
    expect(computeNextRun({ kind: 'interval', everyMinutes: 15 }, 1_000_000)).toBe(
      1_000_000 + 15 * MIN,
    )
  })

  it('daily: returns a future time whose LOCAL hour:minute matches the target', () => {
    const from = Date.now()
    const next = computeNextRun({ kind: 'daily', hour: 9, minute: 30 }, from)
    expect(next).not.toBeNull()
    const d = new Date(next as number)
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(30)
    expect(next as number).toBeGreaterThan(from)
    // Within the next 24h.
    expect((next as number) - from).toBeLessThanOrEqual(24 * 60 * MIN)
  })

  it('daily: if the target time already passed today, schedules tomorrow', () => {
    // Build "today at 08:00 local", then ask for a 07:00 daily → must be tomorrow.
    const base = new Date()
    base.setHours(8, 0, 0, 0)
    const next = computeNextRun({ kind: 'daily', hour: 7, minute: 0 }, base.getTime())
    const d = new Date(next as number)
    expect(d.getHours()).toBe(7)
    expect(next as number).toBeGreaterThan(base.getTime())
    expect((next as number) - base.getTime()).toBeGreaterThan(20 * 60 * MIN)
  })

  it('cron: next matching minute has the expected local fields', () => {
    const from = Date.now()
    const next = computeNextRun({ kind: 'cron', expr: '30 9 * * *' }, from)
    const d = new Date(next as number)
    expect(d.getMinutes()).toBe(30)
    expect(d.getHours()).toBe(9)
    expect(next as number).toBeGreaterThan(from)
  })

  it('cron: */15 lands on a quarter-hour boundary in the future', () => {
    const from = Date.now()
    const next = computeNextRun({ kind: 'cron', expr: '*/15 * * * *' }, from)
    const d = new Date(next as number)
    expect(d.getMinutes() % 15).toBe(0)
    expect(next as number).toBeGreaterThan(from)
    expect((next as number) - from).toBeLessThanOrEqual(15 * MIN)
  })

  it('cron: returns null for a malformed expression', () => {
    expect(computeNextRun({ kind: 'cron', expr: 'not a cron' }, 0)).toBeNull()
    expect(computeNextRun({ kind: 'cron', expr: '99 * * * *' }, 0)).toBeNull()
  })
})

describe('parseCron', () => {
  it('parses * to null (any) and ranges/lists/steps to sets', () => {
    const c = parseCron('0,30 9-17 * * 1-5')
    expect(c?.minute).toEqual(new Set([0, 30]))
    expect(c?.hour).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]))
    expect(c?.dom).toBeNull()
    expect(c?.dow).toEqual(new Set([1, 2, 3, 4, 5]))
  })

  it('rejects wrong field counts and out-of-range values', () => {
    expect(parseCron('* * * *')).toBeNull()
    expect(parseCron('* * * * * *')).toBeNull()
    expect(parseCron('60 * * * *')).toBeNull()
  })
})

function routine(over: Partial<Routine>): Routine {
  return {
    id: 'r',
    name: 'r',
    promptId: 'p',
    harnessId: 'claude',
    cwd: '/x',
    mode: 'interactive',
    autonomy: false,
    schedule: { kind: 'interval', everyMinutes: 5 },
    variables: {},
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('dueRoutines', () => {
  const now = 1_000_000

  it('includes enabled, non-manual routines whose nextRunAt has passed', () => {
    const due = dueRoutines(
      [routine({ id: 'a', nextRunAt: now - 1 }), routine({ id: 'b', nextRunAt: now + MIN })],
      now,
    )
    expect(due.map((r) => r.id)).toEqual(['a'])
  })

  it('excludes disabled, manual, and not-yet-scheduled routines', () => {
    const due = dueRoutines(
      [
        routine({ id: 'disabled', enabled: false, nextRunAt: now - 1 }),
        routine({ id: 'manual', schedule: { kind: 'manual' }, nextRunAt: now - 1 }),
        routine({ id: 'unscheduled', nextRunAt: null }),
      ],
      now,
    )
    expect(due).toEqual([])
  })

  it('a long-missed routine is due once (caller reschedules from now)', () => {
    const missed = routine({ id: 'm', nextRunAt: now - 10 * 24 * 60 * MIN })
    expect(dueRoutines([missed], now).map((r) => r.id)).toEqual(['m'])
  })
})
