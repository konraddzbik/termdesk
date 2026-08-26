// @vitest-environment jsdom
import type { SavedLocalTerminal } from '@shared/ipc'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalTerminalsStore } from './localTerminals'

function make(id: string, path: string, sortOrder = 0): SavedLocalTerminal {
  return { id, name: null, path, sortOrder, createdAt: 0, updatedAt: 0 }
}

const api = {
  localTerminals: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', { value: api, configurable: true })
  useLocalTerminalsStore.setState({
    saved: [make('a', '/a'), make('b', '/b'), make('c', '/c')],
  })
})

describe('move', () => {
  it('moves an entry down and persists the new id order', async () => {
    // Server echoes back the order it was asked to persist.
    api.localTerminals.reorder.mockImplementation(async (ids: string[]) =>
      ids.map((id, i) => make(id, `/${id}`, i)),
    )
    await useLocalTerminalsStore.getState().move('a', 1)
    expect(api.localTerminals.reorder).toHaveBeenCalledWith(['b', 'a', 'c'])
    expect(useLocalTerminalsStore.getState().saved.map((e) => e.id)).toEqual(['b', 'a', 'c'])
  })

  it('moves an entry up', async () => {
    api.localTerminals.reorder.mockImplementation(async (ids: string[]) =>
      ids.map((id, i) => make(id, `/${id}`, i)),
    )
    await useLocalTerminalsStore.getState().move('c', -1)
    expect(api.localTerminals.reorder).toHaveBeenCalledWith(['a', 'c', 'b'])
  })

  it('is a no-op at the top edge', async () => {
    await useLocalTerminalsStore.getState().move('a', -1)
    expect(api.localTerminals.reorder).not.toHaveBeenCalled()
    expect(useLocalTerminalsStore.getState().saved.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('is a no-op at the bottom edge', async () => {
    await useLocalTerminalsStore.getState().move('c', 1)
    expect(api.localTerminals.reorder).not.toHaveBeenCalled()
  })

  it('reverts the optimistic order when persistence fails', async () => {
    api.localTerminals.reorder.mockRejectedValue(new Error('db down'))
    await useLocalTerminalsStore.getState().move('a', 1)
    expect(useLocalTerminalsStore.getState().saved.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})
