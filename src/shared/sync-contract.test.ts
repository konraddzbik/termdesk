import { describe, expect, it } from 'vitest'
import {
  detectSyncConflict,
  isCompatibleContract,
  isValidSyncMeta,
  makeSyncMeta,
  resolveSync,
  SYNC_CONTRACT_VERSION,
  type SyncMeta,
  syncBaselineOf,
} from './sync-contract'

const meta = (revision: number, deviceId = 'dev-a', updatedAt = 1000): SyncMeta => ({
  contractVersion: SYNC_CONTRACT_VERSION,
  revision,
  deviceId,
  updatedAt,
})

const base = (revision: number, deviceId = 'dev-b') => ({ revision, deviceId })

describe('makeSyncMeta (#99)', () => {
  it('starts at revision 1 with no previous meta', () => {
    const m = makeSyncMeta(null, { deviceId: 'dev-a', now: 5000 })
    expect(m).toEqual({
      contractVersion: SYNC_CONTRACT_VERSION,
      revision: 1,
      deviceId: 'dev-a',
      updatedAt: 5000,
    })
  })
  it('increments the previous revision by one', () => {
    const m = makeSyncMeta(meta(7), { deviceId: 'dev-b', now: 9000 })
    expect(m.revision).toBe(8)
    expect(m.deviceId).toBe('dev-b')
    expect(m.updatedAt).toBe(9000)
  })
})

describe('isCompatibleContract (#99)', () => {
  it('accepts the current and older versions, refuses a newer one', () => {
    expect(isCompatibleContract(SYNC_CONTRACT_VERSION)).toBe(true)
    expect(isCompatibleContract(SYNC_CONTRACT_VERSION + 1)).toBe(false)
  })
  it('refuses malformed versions (0, negative, fractional, NaN)', () => {
    for (const v of [0, -1, 0.5, Number.NaN]) expect(isCompatibleContract(v)).toBe(false)
  })
})

describe('isValidSyncMeta (#99)', () => {
  it('accepts a well-formed meta', () => {
    expect(isValidSyncMeta(meta(0))).toBe(true)
    expect(isValidSyncMeta(meta(12))).toBe(true)
  })
  it('rejects malformed meta from user-supplied storage', () => {
    for (const bad of [
      null,
      'meta',
      {},
      { ...meta(3), revision: Number.NaN },
      { ...meta(3), revision: -1 },
      { ...meta(3), revision: 1.5 },
      { ...meta(3), revision: '3' },
      { ...meta(3), deviceId: '' },
      { ...meta(3), deviceId: 7 },
      { ...meta(3), contractVersion: 0 },
      { ...meta(3), updatedAt: Number.POSITIVE_INFINITY },
    ]) {
      expect(isValidSyncMeta(bad)).toBe(false)
    }
  })
})

describe('detectSyncConflict (#99)', () => {
  it('is in-sync when neither side moved past the last sync', () => {
    expect(detectSyncConflict(meta(4), meta(4, 'dev-b'), base(4))).toBe('in-sync')
  })
  it('is local-ahead when only local advanced (safe to push)', () => {
    expect(detectSyncConflict(meta(6), meta(4, 'dev-b'), base(4))).toBe('local-ahead')
  })
  it('is remote-ahead when only remote advanced (safe to pull)', () => {
    expect(detectSyncConflict(meta(4), meta(6, 'dev-b'), base(4))).toBe('remote-ahead')
  })
  it('is diverged when both advanced since the last sync (conflict)', () => {
    expect(detectSyncConflict(meta(6), meta(7, 'dev-b'), base(4))).toBe('diverged')
  })
  it('is diverged when two devices raced from the same baseline to the same revision', () => {
    expect(detectSyncConflict(meta(5, 'dev-a'), meta(5, 'dev-b'), base(4, 'dev-a'))).toBe(
      'diverged',
    )
  })
  it('flags a remote rolled back below the baseline as a conflict, never in-sync or push', () => {
    // Restored backup / fresh install re-created the remote at a lower revision.
    expect(detectSyncConflict(meta(4), meta(4, 'dev-b'), base(10))).toBe('diverged')
    expect(detectSyncConflict(meta(11), meta(1, 'dev-c'), base(10))).toBe('diverged')
  })
  it('flags a remote replaced at the same revision by another device as a conflict', () => {
    expect(detectSyncConflict(meta(4), meta(6, 'dev-c'), base(6, 'dev-b'))).toBe('diverged')
    expect(detectSyncConflict(meta(7), meta(6, 'dev-c'), base(6, 'dev-b'))).toBe('diverged')
  })
  it('is in-sync when the remote is exactly the baseline we recorded', () => {
    expect(detectSyncConflict(meta(4), meta(6, 'dev-b'), base(6, 'dev-b'))).toBe('in-sync')
  })
  it('treats malformed remote meta as a conflict, never a push', () => {
    const bad = { ...meta(4, 'dev-b'), revision: Number.NaN }
    expect(detectSyncConflict(meta(6), bad, base(4))).toBe('diverged')
  })
  it('still catches a rollback with a legacy numeric baseline', () => {
    expect(detectSyncConflict(meta(4), meta(6, 'dev-b'), 4)).toBe('remote-ahead')
    expect(detectSyncConflict(meta(11), meta(3, 'dev-b'), 10)).toBe('diverged')
  })
  it('records a baseline from the synced meta', () => {
    expect(syncBaselineOf(meta(9, 'dev-z'))).toEqual({ revision: 9, deviceId: 'dev-z' })
  })
})

describe('resolveSync (#99)', () => {
  it('maps each comparison to a client action', () => {
    expect(resolveSync('in-sync')).toBe('none')
    expect(resolveSync('local-ahead')).toBe('push')
    expect(resolveSync('remote-ahead')).toBe('pull')
    expect(resolveSync('diverged')).toBe('conflict')
  })
  it('never silently overwrites: a divergence is always a conflict, not a push/pull', () => {
    const cmp = detectSyncConflict(meta(9), meta(9, 'dev-b', 2000), base(4, 'dev-a'))
    expect(cmp).toBe('diverged')
    expect(resolveSync(cmp)).toBe('conflict')
  })
})
