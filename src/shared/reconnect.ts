/**
 * Resilient-session reconnect state machine (Milestone M11: issue #91, the
 * anchor; reused by #93 self-healing tunnels and #94 resumable SFTP).
 *
 * Sessions that survive IP roaming, laptop-sleep and flaky Wi-Fi are beloved but
 * CLI-only today (mosh, Eternal Terminal, shared tmux). M7 #57 hardened against
 * *hangs* (backpressure); this is the missing half — *reconnect*. The transport
 * (SSH/PTY, a tunnel, an SFTP transfer) drives this machine with events and reads
 * `nextDelayMs` to schedule the next attempt; the machine itself is pure and
 * deterministic (no timers, no clock, no randomness) so backoff and the
 * give-up ceiling are unit-tested in isolation.
 *
 * The same machine is shared across features: a terminal session, a `-L`/`-D`
 * tunnel, and an in-flight SFTP transfer all reconnect with identical semantics.
 *
 * Events carry no attempt ID, so the machine cannot tell a late `success` or
 * `attempt-failed` from an abandoned dial apart from a current one. The transport
 * must cancel any in-flight dial before dispatching `give-up` (or `manual-retry`),
 * otherwise a stale `success` would revive a session the user stopped.
 */

export type ReconnectStatus = 'connected' | 'reconnecting' | 'failed'

export interface ReconnectState {
  status: ReconnectStatus
  /** Attempt counter: 0 while connected, 1 on the first retry after a drop. */
  attempt: number
  /** Milliseconds the caller should wait before the next attempt (0 when connected/failed). */
  nextDelayMs: number
}

export type ReconnectEvent =
  | { type: 'drop' } // transport dropped (network change, sleep, remote close)
  | { type: 'attempt-failed' } // a reconnection attempt did not succeed
  | { type: 'success' } // a reconnection attempt (or the initial connect) succeeded
  | { type: 'manual-retry' } // user asked to retry now (also revives a failed session)
  | { type: 'give-up' } // user asked to stop retrying

export interface ReconnectOptions {
  /** First retry delay, ms. Default 1000. */
  baseDelayMs?: number
  /** Backoff multiplier per attempt. Default 2. */
  factor?: number
  /** Delay ceiling, ms. Default 30_000. */
  maxDelayMs?: number
  /**
   * Max reconnect attempts before giving up (entering `failed`): `maxRetries: N`
   * dials exactly N times; `0` fails on drop without dialing. Default `Infinity` —
   * keep trying until the user gives up or connectivity returns.
   */
  maxRetries?: number
}

interface ResolvedOptions {
  baseDelayMs: number
  factor: number
  maxDelayMs: number
  maxRetries: number
}

function resolve(opts: ReconnectOptions): ResolvedOptions {
  const o = {
    baseDelayMs: opts.baseDelayMs ?? 1000,
    factor: opts.factor ?? 2,
    maxDelayMs: opts.maxDelayMs ?? 30_000,
    maxRetries: opts.maxRetries ?? Number.POSITIVE_INFINITY,
  }
  // `!(x >= 0)` also rejects NaN.
  if (!(o.baseDelayMs >= 0)) throw new RangeError(`baseDelayMs must be >= 0, got ${o.baseDelayMs}`)
  if (!(o.maxDelayMs >= 0)) throw new RangeError(`maxDelayMs must be >= 0, got ${o.maxDelayMs}`)
  if (!(o.factor >= 1)) throw new RangeError(`factor must be >= 1, got ${o.factor}`)
  if (!(o.maxRetries >= 0)) throw new RangeError(`maxRetries must be >= 0, got ${o.maxRetries}`)
  return o
}

/**
 * Delay before the given 1-based attempt: `base * factor^(attempt-1)`, capped at
 * `maxDelayMs`. Attempt 1 is `baseDelayMs`. Deterministic (no jitter) so it is
 * testable; a caller may add jitter on top of the returned value.
 */
export function nextBackoff(attempt: number, opts: ReconnectOptions = {}): number {
  const o = resolve(opts)
  if (attempt <= 0) return 0
  const raw = o.baseDelayMs * o.factor ** (attempt - 1)
  return Math.min(Math.round(raw), o.maxDelayMs)
}

/** The initial state for a freshly-connected session. */
export function initialReconnectState(): ReconnectState {
  return { status: 'connected', attempt: 0, nextDelayMs: 0 }
}

/** True when dialing `attempt` (1-based) would exceed the retry ceiling. */
export function shouldGiveUp(attempt: number, maxRetries: number): boolean {
  return attempt > maxRetries
}

/**
 * Advance the reconnect state machine. Pure: given the same `(state, event, opts)`
 * it always returns the same next state.
 *
 * Transitions:
 *  - `connected` + `drop` → `reconnecting` (attempt 1, delay = backoff(1))
 *  - `reconnecting` + `success` → `connected`
 *  - `reconnecting` + `attempt-failed` → next attempt, or `failed` at the ceiling
 *  - `reconnecting`/`failed` + `manual-retry` → `reconnecting` (attempt 1, no delay)
 *    — revives a `failed` session; a no-op while `connected`
 *  - any + `give-up` → `failed`
 *  - `success` while `connected` is idempotent
 */
export function reduceReconnect(
  state: ReconnectState,
  event: ReconnectEvent,
  opts: ReconnectOptions = {},
): ReconnectState {
  const o = resolve(opts)
  switch (event.type) {
    case 'give-up':
      return { status: 'failed', attempt: state.attempt, nextDelayMs: 0 }

    case 'manual-retry':
      // A healthy link must not be re-dialed; "retry now" means now.
      if (state.status === 'connected') return state
      return { status: 'reconnecting', attempt: 1, nextDelayMs: 0 }

    case 'success':
      return { status: 'connected', attempt: 0, nextDelayMs: 0 }

    case 'drop': {
      // Ignore a redundant drop while already reconnecting/failed.
      if (state.status !== 'connected') return state
      if (shouldGiveUp(1, o.maxRetries)) {
        return { status: 'failed', attempt: 0, nextDelayMs: 0 }
      }
      return { status: 'reconnecting', attempt: 1, nextDelayMs: nextBackoff(1, o) }
    }

    case 'attempt-failed': {
      if (state.status !== 'reconnecting') return state
      const next = state.attempt + 1
      if (shouldGiveUp(next, o.maxRetries)) {
        return { status: 'failed', attempt: state.attempt, nextDelayMs: 0 }
      }
      return { status: 'reconnecting', attempt: next, nextDelayMs: nextBackoff(next, o) }
    }

    default: {
      const unhandled: never = event
      return unhandled
    }
  }
}

/** Whether the caller should schedule another attempt (i.e. keep the timer running). */
export function isRetrying(state: ReconnectState): boolean {
  return state.status === 'reconnecting'
}

/** A short human status label for the UI (status dot / tab badge). */
export function describeReconnect(state: ReconnectState): string {
  switch (state.status) {
    case 'connected':
      return 'Connected'
    case 'failed':
      return 'Disconnected'
    default:
      return state.attempt <= 1 ? 'Reconnecting…' : `Reconnecting… (attempt ${state.attempt})`
  }
}
