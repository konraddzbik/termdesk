import type { SavedTunnel, SavedTunnelInput, TunnelStatus } from '@shared/ipc'
import { create } from 'zustand'

interface TunnelsState {
  saved: SavedTunnel[]
  /** Runtime status keyed by saved tunnel id. */
  status: Record<string, TunnelStatus>
  load(): Promise<void>
  create(input: SavedTunnelInput): Promise<void>
  update(id: string, input: SavedTunnelInput): Promise<void>
  remove(id: string): Promise<void>
  start(id: string): Promise<void>
  stop(id: string): Promise<void>
  applyStatus(status: TunnelStatus): void
}

export const useTunnelsStore = create<TunnelsState>((set, get) => ({
  saved: [],
  status: {},

  load: async () => {
    const [saved, statuses] = await Promise.all([
      window.api.tunnels.list(),
      window.api.tunnels.status(),
    ])
    const status: Record<string, TunnelStatus> = {}
    for (const s of statuses) status[s.savedId] = s
    set({ saved, status })
  },

  create: async (input) => {
    await window.api.tunnels.create(input)
    set({ saved: await window.api.tunnels.list() })
  },

  update: async (id, input) => {
    await window.api.tunnels.update(id, input)
    set({ saved: await window.api.tunnels.list() })
  },

  remove: async (id) => {
    await window.api.tunnels.remove(id)
    const status = { ...get().status }
    delete status[id]
    set({ saved: await window.api.tunnels.list(), status })
  },

  start: async (id) => {
    try {
      get().applyStatus(await window.api.tunnels.start(id))
    } catch (err) {
      get().applyStatus({
        savedId: id,
        running: false,
        error: err instanceof Error ? err.message : 'Failed to start tunnel',
        bytesUp: 0,
        bytesDown: 0,
        connections: 0,
      })
    }
  },

  stop: async (id) => {
    await window.api.tunnels.stop(id)
    // The main process emits the final 'stopped' status via the event stream;
    // optimistically mark not-running so the toggle flips immediately.
    const current = get().status[id]
    if (current) get().applyStatus({ ...current, running: false, connections: 0 })
  },

  applyStatus: (status) =>
    set((state) => ({ status: { ...state.status, [status.savedId]: status } })),
}))

/** Wire live tunnel status updates into the store (call once at app start). */
export function initTunnelsSubscription(): () => void {
  return window.api.tunnels.onEvent((status) => {
    useTunnelsStore.getState().applyStatus(status)
  })
}
