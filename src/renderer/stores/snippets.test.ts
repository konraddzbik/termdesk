// @vitest-environment jsdom
import type { Snippet } from '@shared/ipc'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSnippetsStore } from './snippets'

function makeSnippet(id: string, name: string, sortOrder = 0): Snippet {
  return { id, name, command: `echo ${name}`, sortOrder }
}

const api = {
  snippets: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', { value: api, configurable: true })
  useSnippetsStore.setState({ snippets: [], loading: false, error: null })
})

describe('load', () => {
  it('loads and sorts snippets by sortOrder then name', async () => {
    api.snippets.list.mockResolvedValue([
      makeSnippet('s1', 'zeta', 1),
      makeSnippet('s2', 'alpha', 1),
      makeSnippet('s3', 'last', 5),
      makeSnippet('s4', 'first', 0),
    ])
    await useSnippetsStore.getState().load()
    const state = useSnippetsStore.getState()
    expect(state.snippets.map((s) => s.name)).toEqual(['first', 'alpha', 'zeta', 'last'])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('sets error on failure', async () => {
    api.snippets.list.mockRejectedValue(
      new Error("Error invoking remote method 'snippets:list': Error: db locked"),
    )
    await useSnippetsStore.getState().load()
    const state = useSnippetsStore.getState()
    expect(state.error).toBe('db locked')
    expect(state.loading).toBe(false)
    expect(state.snippets).toEqual([])
  })
})

describe('create', () => {
  it('passes the input through and inserts the result in sorted position', async () => {
    useSnippetsStore.setState({
      snippets: [makeSnippet('s1', 'aaa', 0), makeSnippet('s2', 'zzz', 2)],
    })
    const created = makeSnippet('s3', 'mid', 1)
    api.snippets.create.mockResolvedValue(created)
    const result = await useSnippetsStore.getState().create({ name: 'mid', command: 'echo mid' })
    expect(api.snippets.create).toHaveBeenCalledWith({ name: 'mid', command: 'echo mid' })
    expect(result).toBe(created)
    expect(useSnippetsStore.getState().snippets.map((s) => s.id)).toEqual(['s1', 's3', 's2'])
  })

  it('rethrows on failure without touching the list', async () => {
    api.snippets.create.mockRejectedValue(new Error('invalid'))
    await expect(
      useSnippetsStore.getState().create({ name: 'x', command: 'echo x' }),
    ).rejects.toThrow('invalid')
    expect(useSnippetsStore.getState().snippets).toEqual([])
  })
})

describe('update', () => {
  it('replaces the matching snippet and re-sorts', async () => {
    useSnippetsStore.setState({
      snippets: [makeSnippet('s1', 'aaa', 0), makeSnippet('s2', 'bbb', 1)],
    })
    const updated = makeSnippet('s1', 'moved', 9)
    api.snippets.update.mockResolvedValue(updated)
    await useSnippetsStore.getState().update('s1', { name: 'moved', command: 'echo moved' })
    expect(api.snippets.update).toHaveBeenCalledWith('s1', { name: 'moved', command: 'echo moved' })
    expect(useSnippetsStore.getState().snippets.map((s) => s.id)).toEqual(['s2', 's1'])
  })
})

describe('remove', () => {
  it('deletes the snippet and returns true', async () => {
    useSnippetsStore.setState({ snippets: [makeSnippet('s1', 'a'), makeSnippet('s2', 'b')] })
    api.snippets.remove.mockResolvedValue(undefined)
    const ok = await useSnippetsStore.getState().remove('s1')
    expect(ok).toBe(true)
    expect(useSnippetsStore.getState().snippets.map((s) => s.id)).toEqual(['s2'])
  })

  it('keeps the snippet, sets error and returns false on failure', async () => {
    useSnippetsStore.setState({ snippets: [makeSnippet('s1', 'a')] })
    api.snippets.remove.mockRejectedValue(new Error('nope'))
    const ok = await useSnippetsStore.getState().remove('s1')
    expect(ok).toBe(false)
    expect(useSnippetsStore.getState().snippets.map((s) => s.id)).toEqual(['s1'])
    expect(useSnippetsStore.getState().error).toBe('nope')
  })
})
