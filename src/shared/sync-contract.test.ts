import { describe, expect, it } from 'vitest'
import {
  detectSyncConflict,
  isCompatibleContract,
  makeSyncMeta,
  resolveSync,
  SYNC_CONTRACT_VERSION,
  type SyncMeta,
} from './sync-contract'

const meta = (revision: number, deviceId = 'dev-a', updatedAt = 1000): SyncMeta => ({
  contractVersion: SYNC_CONTRACT_VERSION,
  revision,
  deviceId,
  updatedAt,
})

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
    expect(isCompatibleContract(SYNC_CONTRACT_VERSION - 1)).toBe(true)
    expect(isCompatibleContract(SYNC_CONTRACT_VERSION + 1)).toBe(false)
  })
})

describe('detectSyncConflict (#99)', () => {
  it('is in-sync when neither side moved past the last sync', () => {
    expect(detectSyncConflict(meta(4), meta(4, 'dev-b'), 4)).toBe('in-sync')
  })
  it('is local-ahead when only local advanced (safe to push)', () => {
    expect(detectSyncConflict(meta(6), meta(4, 'dev-b'), 4)).toBe('local-ahead')
  })
  it('is remote-ahead when only remote advanced (safe to pull)', () => {
    expect(detectSyncConflict(meta(4), meta(6, 'dev-b'), 4)).toBe('remote-ahead')
  })
  it('is diverged when both advanced since the last sync (conflict)', () => {
    expect(detectSyncConflict(meta(6), meta(7, 'dev-b'), 4)).toBe('diverged')
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
    const cmp = detectSyncConflict(meta(9), meta(9, 'dev-b', 2000), 4)
    expect(cmp).toBe('diverged')
    expect(resolveSync(cmp)).toBe('conflict')
  })
})
