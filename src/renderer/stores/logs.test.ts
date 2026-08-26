import type { ActivityEntry } from '@shared/ipc'
import { beforeEach, describe, expect, it } from 'vitest'
import { groupByDay, useLogsStore } from './logs'

function entry(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: Math.random().toString(36).slice(2),
    ts: Date.UTC(2026, 0, 1, 12, 0, 0),
    action: 'connected',
    kind: 'ssh',
    hostId: 'h1',
    hostLabel: 'web',
    hostSubtitle: 'ssh',
    detail: null,
    user: 'a@b.com',
    device: 'Mac',
    ...over,
  }
}

describe('logs store', () => {
  beforeEach(() => useLogsStore.setState({ entries: [] }))

  it('prepends new entries (newest-first)', () => {
    const s = useLogsStore.getState()
    s.applyEvent(entry({ id: 'a' }))
    s.applyEvent(entry({ id: 'b' }))
    expect(useLogsStore.getState().entries.map((e) => e.id)).toEqual(['b', 'a'])
  })
})

describe('groupByDay', () => {
  it('buckets consecutive entries from the same day together', () => {
    const groups = groupByDay([
      entry({ id: '1', ts: Date.UTC(2026, 0, 3, 12) }),
      entry({ id: '2', ts: Date.UTC(2026, 0, 3, 13) }),
      entry({ id: '3', ts: Date.UTC(2026, 0, 1, 12) }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]?.items.map((e) => e.id)).toEqual(['1', '2'])
    expect(groups[1]?.items.map((e) => e.id)).toEqual(['3'])
  })
})
