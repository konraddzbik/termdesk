/**
 * Pure scheduling math for Routines — no timers, no I/O, clock passed in. The
 * main-process scheduler loop (`routine-scheduler.ts`) is a thin wrapper around
 * these functions, so all the tricky logic is unit-testable with fixed inputs.
 *
 * Times are computed in the machine's LOCAL time (a "daily 09:00" routine means
 * 9am where the user is). `computeNextRun` returns an epoch-ms timestamp, or
 * null for a `manual` schedule (never auto-fires).
 */

import type { Routine, RoutineSchedule } from '@shared/ipc'

const MINUTE_MS = 60_000
/** Cap the cron search so a never-matching expression can't loop forever. */
const CRON_HORIZON_MINUTES = 366 * 24 * 60

/**
 * Next fire time strictly after `fromEpoch`, or null for `manual` (and for an
 * unsatisfiable cron within a year).
 */
export function computeNextRun(schedule: RoutineSchedule, fromEpoch: number): number | null {
  switch (schedule.kind) {
    case 'manual':
      return null
    case 'interval':
      return fromEpoch + schedule.everyMinutes * MINUTE_MS
    case 'daily':
      return nextDaily(schedule.hour, schedule.minute, fromEpoch)
    case 'cron':
      return nextCron(schedule.expr, fromEpoch)
  }
}

/** Next local `hour:minute` strictly after `fromEpoch`. */
function nextDaily(hour: number, minute: number, fromEpoch: number): number {
  const d = new Date(fromEpoch)
  d.setHours(hour, minute, 0, 0)
  if (d.getTime() <= fromEpoch) d.setDate(d.getDate() + 1)
  return d.getTime()
}

// --- Cron (5-field subset: min hour dom mon dow) --------------------------

/** A parsed cron field: null means `*` (matches anything). */
type CronField = Set<number> | null

/** Parse one field into a set of allowed values, or null for `*`. Throws on junk. */
function parseField(field: string, min: number, max: number): CronField {
  if (field === '*') return null
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/)
    if (stepMatch) {
      const step = Number(stepMatch[2])
      if (step <= 0) throw new Error(`bad step in cron field: ${part}`)
      let lo = min
      let hi = max
      const base = stepMatch[1] as string
      if (base !== '*') {
        const range = base.split('-').map(Number)
        lo = range[0] as number
        hi = range.length > 1 ? (range[1] as number) : max
      }
      for (let v = lo; v <= hi; v += step) out.add(v)
      continue
    }
    const range = part.split('-')
    if (range.length === 2) {
      const lo = Number(range[0])
      const hi = Number(range[1])
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`bad range: ${part}`)
      for (let v = lo; v <= hi; v++) out.add(v)
      continue
    }
    const n = Number(part)
    if (!Number.isInteger(n)) throw new Error(`bad cron value: ${part}`)
    out.add(n)
  }
  // Validate bounds.
  for (const v of out)
    if (v < min || v > max) throw new Error(`cron value ${v} out of ${min}-${max}`)
  return out
}

interface ParsedCron {
  minute: CronField
  hour: CronField
  dom: CronField
  month: CronField
  dow: CronField
}

/** Parse a 5-field cron expression, or return null if it's malformed. */
export function parseCron(expr: string): ParsedCron | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  try {
    return {
      minute: parseField(fields[0] as string, 0, 59),
      hour: parseField(fields[1] as string, 0, 23),
      dom: parseField(fields[2] as string, 1, 31),
      month: parseField(fields[3] as string, 1, 12),
      // dow: 0 and 7 both mean Sunday.
      dow: parseField(fields[4] as string, 0, 7),
    }
  } catch {
    return null
  }
}

function matches(field: CronField, value: number): boolean {
  return field === null || field.has(value)
}

function nextCron(expr: string, fromEpoch: number): number | null {
  const cron = parseCron(expr)
  if (cron === null) return null

  // Start at the next whole minute after `fromEpoch`.
  const start = new Date(Math.floor(fromEpoch / MINUTE_MS) * MINUTE_MS + MINUTE_MS)
  for (let i = 0; i < CRON_HORIZON_MINUTES; i++) {
    const t = new Date(start.getTime() + i * MINUTE_MS)
    if (!matches(cron.minute, t.getMinutes())) continue
    if (!matches(cron.hour, t.getHours())) continue
    if (!matches(cron.month, t.getMonth() + 1)) continue
    // day-of-month vs day-of-week: if both are restricted, either may match
    // (standard cron); if one is `*`, only the other constrains.
    const jsDow = t.getDay() // 0=Sun..6=Sat
    const domOk = matches(cron.dom, t.getDate())
    const dowOk = cron.dow === null || cron.dow.has(jsDow) || (jsDow === 0 && cron.dow.has(7))
    const dayOk = cron.dom !== null && cron.dow !== null ? domOk || dowOk : domOk && dowOk
    if (dayOk) return t.getTime()
  }
  return null
}

// --- Due selection --------------------------------------------------------

/**
 * Routines that should fire at `now`: enabled, non-manual, with a `nextRunAt`
 * at or before `now`. A routine whose `nextRunAt` is far in the past (missed
 * while the app was closed) is due exactly once — the caller reschedules from
 * `now` after firing, so missed intervals don't stack up.
 */
export function dueRoutines(routines: Routine[], now: number): Routine[] {
  return routines.filter(
    (r) => r.enabled && r.schedule.kind !== 'manual' && r.nextRunAt !== null && r.nextRunAt <= now,
  )
}
