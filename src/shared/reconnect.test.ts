import { describe, expect, it } from 'vitest'
import {
  describeReconnect,
  initialReconnectState,
  isRetrying,
  nextBackoff,
  type ReconnectState,
  reduceReconnect,
  shouldGiveUp,
} from './reconnect'

const opts = { baseDelayMs: 1000, factor: 2, maxDelayMs: 30_000 }

describe('nextBackoff', () => {
  it('is exponential from the base and capped at maxDelayMs', () => {
    expect(nextBackoff(1, opts)).toBe(1000)
    expect(nextBackoff(2, opts)).toBe(2000)
    expect(nextBackoff(3, opts)).toBe(4000)
    expect(nextBackoff(6, opts)).toBe(30_000) // 32000 capped
    expect(nextBackoff(100, opts)).toBe(30_000)
  })
  it('is 0 for non-positive attempts', () => {
    expect(nextBackoff(0, opts)).toBe(0)
    expect(nextBackoff(-1, opts)).toBe(0)
  })
})

describe('shouldGiveUp', () => {
  it('trips at the retry ceiling', () => {
    expect(shouldGiveUp(2, 3)).toBe(false)
    expect(shouldGiveUp(3, 3)).toBe(true)
    expect(shouldGiveUp(1, Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('reduceReconnect', () => {
  it('starts connected and enters reconnecting on drop', () => {
    const s0 = initialReconnectState()
    expect(s0.status).toBe('connected')
    const s1 = reduceReconnect(s0, { type: 'drop' }, opts)
    expect(s1).toEqual({ status: 'reconnecting', attempt: 1, nextDelayMs: 1000 })
    expect(isRetrying(s1)).toBe(true)
  })

  it('backs off on each failed attempt', () => {
    let s = reduceReconnect(initialReconnectState(), { type: 'drop' }, opts)
    s = reduceReconnect(s, { type: 'attempt-failed' }, opts)
    expect(s).toEqual({ status: 'reconnecting', attempt: 2, nextDelayMs: 2000 })
    s = reduceReconnect(s, { type: 'attempt-failed' }, opts)
    expect(s).toEqual({ status: 'reconnecting', attempt: 3, nextDelayMs: 4000 })
  })

  it('returns to connected on success and resets the attempt counter', () => {
    let s = reduceReconnect(initialReconnectState(), { type: 'drop' }, opts)
    s = reduceReconnect(s, { type: 'attempt-failed' }, opts)
    s = reduceReconnect(s, { type: 'success' }, opts)
    expect(s).toEqual({ status: 'connected', attempt: 0, nextDelayMs: 0 })
  })

  it('gives up at maxRetries', () => {
    const limited = { ...opts, maxRetries: 3 }
    let s = reduceReconnect(initialReconnectState(), { type: 'drop' }, limited) // attempt 1
    s = reduceReconnect(s, { type: 'attempt-failed' }, limited) // attempt 2
    expect(s.status).toBe('reconnecting')
    s = reduceReconnect(s, { type: 'attempt-failed' }, limited) // would be attempt 3 → ceiling
    expect(s.status).toBe('failed')
    expect(isRetrying(s)).toBe(false)
  })

  it('fails immediately on drop when maxRetries is 1', () => {
    const s = reduceReconnect(initialReconnectState(), { type: 'drop' }, { ...opts, maxRetries: 1 })
    expect(s.status).toBe('failed')
  })

  it('revives a failed session on manual-retry', () => {
    const failed: ReconnectState = { status: 'failed', attempt: 5, nextDelayMs: 0 }
    const s = reduceReconnect(failed, { type: 'manual-retry' }, opts)
    expect(s).toEqual({ status: 'reconnecting', attempt: 1, nextDelayMs: 1000 })
  })

  it('give-up forces failed from any state', () => {
    const reconnecting: ReconnectState = { status: 'reconnecting', attempt: 2, nextDelayMs: 2000 }
    expect(reduceReconnect(reconnecting, { type: 'give-up' }, opts).status).toBe('failed')
  })

  it('ignores a redundant drop while already reconnecting', () => {
    const s1 = reduceReconnect(initialReconnectState(), { type: 'drop' }, opts)
    const s2 = reduceReconnect(s1, { type: 'drop' }, opts)
    expect(s2).toBe(s1)
  })

  it('ignores attempt-failed while connected', () => {
    const s0 = initialReconnectState()
    expect(reduceReconnect(s0, { type: 'attempt-failed' }, opts)).toBe(s0)
  })
})

describe('describeReconnect', () => {
  it('labels each status; counts attempts after the first', () => {
    expect(describeReconnect({ status: 'connected', attempt: 0, nextDelayMs: 0 })).toBe('Connected')
    expect(describeReconnect({ status: 'failed', attempt: 3, nextDelayMs: 0 })).toBe('Disconnected')
    expect(describeReconnect({ status: 'reconnecting', attempt: 1, nextDelayMs: 1000 })).toBe(
      'Reconnecting…',
    )
    expect(describeReconnect({ status: 'reconnecting', attempt: 4, nextDelayMs: 8000 })).toBe(
      'Reconnecting… (attempt 4)',
    )
  })
})
