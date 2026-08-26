// @vitest-environment jsdom
import type { Group, Host } from '@shared/ipc'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useHostsStore } from './hosts'

function makeHost(id: string, label = id): Host {
  return {
    id,
    label,
    hostname: `${id}.example.com`,
    port: 22,
    username: 'root',
    authType: 'password',
    keyPath: null,
    proxyJump: null,
    defaultPath: null,
    groupId: null,
    credentialId: null,
    tags: [],
    color: null,
    vncPort: null,
    vncMode: 'tunnel',
    kind: 'ssh',
    hasPassword: true,
    hasPassphrase: false,
    hasVncPassword: false,
    rdpPort: null,
    rdpMode: 'direct',
    domain: null,
    hasRdpPassword: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

const group: Group = { id: 'g1', name: 'Prod', color: null, parentId: null, sortOrder: 0 }

const api = {
  hosts: {
    list: vi.fn(),
    create: vi.fn(),
    duplicate: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setGroup: vi.fn(),
    test: vi.fn(),
  },
  groups: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', { value: api, configurable: true })
  useHostsStore.setState({ hosts: [], groups: [], query: '', loading: false, error: null })
})

describe('loadAll', () => {
  it('populates hosts and groups on success', async () => {
    const hosts = [makeHost('h1'), makeHost('h2')]
    api.hosts.list.mockResolvedValue(hosts)
    api.groups.list.mockResolvedValue([group])
    await useHostsStore.getState().loadAll()
    const state = useHostsStore.getState()
    expect(state.hosts).toEqual(hosts)
    expect(state.groups).toEqual([group])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('sets error (stripped of the IPC prefix) on failure', async () => {
    api.hosts.list.mockRejectedValue(
      new Error("Error invoking remote method 'hosts:list': Error: vault locked"),
    )
    api.groups.list.mockResolvedValue([])
    await useHostsStore.getState().loadAll()
    const state = useHostsStore.getState()
    expect(state.error).toBe('vault locked')
    expect(state.loading).toBe(false)
    expect(state.hosts).toEqual([])
  })
})

describe('createHost', () => {
  it('appends the created host on success', async () => {
    const created = makeHost('h9')
    api.hosts.create.mockResolvedValue(created)
    const result = await useHostsStore.getState().createHost({
      label: 'h9',
      hostname: 'h9.example.com',
      username: 'root',
      authType: 'password',
    })
    expect(result).toBe(created)
    expect(useHostsStore.getState().hosts).toEqual([created])
    expect(useHostsStore.getState().error).toBeNull()
  })

  it('rethrows on failure and does NOT write error to the store', async () => {
    api.hosts.create.mockRejectedValue(new Error('label taken'))
    await expect(
      useHostsStore.getState().createHost({
        label: 'dup',
        hostname: 'dup.example.com',
        username: 'root',
        authType: 'password',
      }),
    ).rejects.toThrow('label taken')
    const state = useHostsStore.getState()
    expect(state.error).toBeNull()
    expect(state.hosts).toEqual([])
  })
})

describe('updateHost', () => {
  it('replaces the matching host on success', async () => {
    useHostsStore.setState({ hosts: [makeHost('h1'), makeHost('h2')] })
    const updated = makeHost('h1', 'renamed')
    api.hosts.update.mockResolvedValue(updated)
    await useHostsStore.getState().updateHost('h1', {
      label: 'renamed',
      hostname: 'h1.example.com',
      username: 'root',
      authType: 'password',
    })
    const labels = useHostsStore.getState().hosts.map((h) => h.label)
    expect(labels).toEqual(['renamed', 'h2'])
  })

  it('rethrows on failure and does NOT write error to the store', async () => {
    useHostsStore.setState({ hosts: [makeHost('h1')] })
    api.hosts.update.mockRejectedValue(new Error('boom'))
    await expect(
      useHostsStore.getState().updateHost('h1', {
        label: 'x',
        hostname: 'x.example.com',
        username: 'root',
        authType: 'password',
      }),
    ).rejects.toThrow('boom')
    const state = useHostsStore.getState()
    expect(state.error).toBeNull()
    expect(state.hosts.map((h) => h.id)).toEqual(['h1'])
  })
})

describe('deleteHost', () => {
  it('removes the host and returns true on success', async () => {
    useHostsStore.setState({ hosts: [makeHost('h1'), makeHost('h2')] })
    api.hosts.remove.mockResolvedValue(undefined)
    const ok = await useHostsStore.getState().deleteHost('h1')
    expect(ok).toBe(true)
    expect(useHostsStore.getState().hosts.map((h) => h.id)).toEqual(['h2'])
  })

  it('keeps the host, sets error and returns false on failure', async () => {
    useHostsStore.setState({ hosts: [makeHost('h1')] })
    api.hosts.remove.mockRejectedValue(new Error('in use'))
    const ok = await useHostsStore.getState().deleteHost('h1')
    expect(ok).toBe(false)
    expect(useHostsStore.getState().hosts.map((h) => h.id)).toEqual(['h1'])
    expect(useHostsStore.getState().error).toBe('in use')
  })
})

describe('setHostGroup', () => {
  it('optimistically moves the host and reconciles with the server result', async () => {
    useHostsStore.setState({ hosts: [makeHost('h1')] })
    api.hosts.setGroup.mockResolvedValue({ ...makeHost('h1'), groupId: 'g1', updatedAt: 2 })
    await useHostsStore.getState().setHostGroup('h1', 'g1')
    expect(api.hosts.setGroup).toHaveBeenCalledWith('h1', 'g1')
    const h = useHostsStore.getState().hosts[0]
    expect(h?.groupId).toBe('g1')
    expect(h?.updatedAt).toBe(2)
  })

  it('is a no-op when the target group equals the current group', async () => {
    useHostsStore.setState({ hosts: [{ ...makeHost('h1'), groupId: 'g1' }] })
    await useHostsStore.getState().setHostGroup('h1', 'g1')
    expect(api.hosts.setGroup).not.toHaveBeenCalled()
  })

  it('rolls back the host and sets error when the IPC rejects', async () => {
    useHostsStore.setState({ hosts: [{ ...makeHost('h1'), groupId: null }] })
    api.hosts.setGroup.mockRejectedValue(new Error('group gone'))
    await useHostsStore.getState().setHostGroup('h1', 'g1')
    const state = useHostsStore.getState()
    expect(state.hosts[0]?.groupId).toBeNull() // rolled back
    expect(state.error).toBe('group gone')
  })
})

describe('setQuery', () => {
  it('stores the search query', () => {
    useHostsStore.getState().setQuery('prod')
    expect(useHostsStore.getState().query).toBe('prod')
  })
})
