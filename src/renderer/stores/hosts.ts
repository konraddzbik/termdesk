import type { Group, GroupInput, Host, HostInput } from '@shared/ipc'
import { create } from 'zustand'

interface HostsState {
  hosts: Host[]
  groups: Group[]
  query: string
  loading: boolean
  error: string | null
  loadAll(): Promise<void>
  createHost(input: HostInput): Promise<Host>
  duplicateHost(id: string, label: string, hostname: string): Promise<Host>
  updateHost(id: string, input: HostInput): Promise<Host>
  setHostGroup(id: string, groupId: string | null): Promise<void>
  deleteHost(id: string): Promise<boolean>
  createGroup(input: GroupInput): Promise<Group>
  updateGroup(id: string, input: GroupInput): Promise<Group>
  deleteGroup(id: string): Promise<boolean>
  setQuery(query: string): void
}

/** Normalises a rejection into a human-readable message, stripping Electron's IPC prefix. */
function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

export const useHostsStore = create<HostsState>((set, get) => ({
  hosts: [],
  groups: [],
  query: '',
  loading: false,
  error: null,

  async loadAll() {
    set({ loading: true, error: null })
    try {
      const [hosts, groups] = await Promise.all([window.api.hosts.list(), window.api.groups.list()])
      set({ hosts, groups, loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  async createHost(input) {
    const host = await window.api.hosts.create(input)
    set((state) => ({ hosts: [...state.hosts, host], error: null }))
    return host
  },

  async duplicateHost(id, label, hostname) {
    const host = await window.api.hosts.duplicate(id, label, hostname)
    set((state) => ({ hosts: [...state.hosts, host], error: null }))
    return host
  },

  async updateHost(id, input) {
    const host = await window.api.hosts.update(id, input)
    set((state) => ({
      hosts: state.hosts.map((h) => (h.id === id ? host : h)),
      error: null,
    }))
    return host
  },

  async setHostGroup(id, groupId) {
    const prev = get().hosts.find((h) => h.id === id)?.groupId
    if (prev === undefined || prev === groupId) return // unknown host or no-op
    // Optimistically move the host, then reconcile / roll back on failure.
    set((state) => ({
      hosts: state.hosts.map((h) => (h.id === id ? { ...h, groupId } : h)),
      error: null,
    }))
    try {
      const updated = await window.api.hosts.setGroup(id, groupId)
      set((state) => ({ hosts: state.hosts.map((h) => (h.id === id ? updated : h)) }))
    } catch (error) {
      set((state) => ({
        hosts: state.hosts.map((h) => (h.id === id ? { ...h, groupId: prev } : h)),
        error: toMessage(error),
      }))
    }
  },

  async deleteHost(id) {
    try {
      await window.api.hosts.remove(id)
      set((state) => ({ hosts: state.hosts.filter((h) => h.id !== id), error: null }))
      return true
    } catch (error) {
      set({ error: toMessage(error) })
      return false
    }
  },

  async createGroup(input) {
    const group = await window.api.groups.create(input)
    set((state) => ({ groups: [...state.groups, group], error: null }))
    return group
  },

  async updateGroup(id, input) {
    const group = await window.api.groups.update(id, input)
    set((state) => ({
      groups: state.groups.map((g) => (g.id === id ? group : g)),
      error: null,
    }))
    return group
  },

  async deleteGroup(id) {
    try {
      await window.api.groups.remove(id)
      set({ error: null })
      // Hosts may have been re-parented or cascaded in main; re-fetch to stay in sync.
      await get().loadAll()
      return true
    } catch (error) {
      set({ error: toMessage(error) })
      return false
    }
  },

  setQuery(query) {
    set({ query })
  },
}))
