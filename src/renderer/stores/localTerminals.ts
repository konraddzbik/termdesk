import type { SavedLocalTerminal, SavedLocalTerminalInput } from '@shared/ipc'
import { create } from 'zustand'

interface LocalTerminalsState {
  saved: SavedLocalTerminal[]
  load(): Promise<void>
  create(input: SavedLocalTerminalInput): Promise<void>
  update(id: string, input: SavedLocalTerminalInput): Promise<void>
  remove(id: string): Promise<void>
  /** Move an entry one slot up (dir -1) or down (dir +1) and persist the order. */
  move(id: string, dir: -1 | 1): Promise<void>
}

export const useLocalTerminalsStore = create<LocalTerminalsState>((set, get) => ({
  saved: [],
  load: async () => {
    try {
      set({ saved: await window.api.localTerminals.list() })
    } catch {
      // leave previous state
    }
  },
  create: async (input) => {
    await window.api.localTerminals.create(input)
    await get().load()
  },
  update: async (id, input) => {
    await window.api.localTerminals.update(id, input)
    await get().load()
  },
  remove: async (id) => {
    await window.api.localTerminals.remove(id)
    await get().load()
  },
  move: async (id, dir) => {
    const current = get().saved
    const from = current.findIndex((e) => e.id === id)
    const to = from + dir
    if (from < 0 || to < 0 || to >= current.length) return
    const next = [...current]
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    set({ saved: next }) // optimistic: reflect the new order immediately
    try {
      set({ saved: await window.api.localTerminals.reorder(next.map((e) => e.id)) })
    } catch {
      set({ saved: current }) // revert on failure
    }
  },
}))
