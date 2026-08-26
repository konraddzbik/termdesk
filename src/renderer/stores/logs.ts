import type { ActivityEntry } from '@shared/ipc'
import { create } from 'zustand'

interface LogsState {
  entries: ActivityEntry[]
  loading: boolean
  load(): Promise<void>
  clear(): Promise<void>
  applyEvent(entry: ActivityEntry): void
}

export const useLogsStore = create<LogsState>((set) => ({
  entries: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      set({ entries: await window.api.logs.list(), loading: false })
    } catch {
      set({ loading: false })
    }
  },

  clear: async () => {
    await window.api.logs.clear()
    set({ entries: [] })
  },

  // New entries arrive newest-first; prepend.
  applyEvent: (entry) => set((state) => ({ entries: [entry, ...state.entries] })),
}))

/** Wire the global activity-log event stream into the store (call once at app start). */
export function initLogsSubscription(): () => void {
  return window.api.logs.onEvent((entry) => {
    useLogsStore.getState().applyEvent(entry)
  })
}

/** Groups entries (already newest-first) by local calendar day, preserving order. */
export function groupByDay(
  entries: ActivityEntry[],
): Array<{ day: string; items: ActivityEntry[] }> {
  const groups: Array<{ day: string; items: ActivityEntry[] }> = []
  for (const entry of entries) {
    const day = new Date(entry.ts).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    const last = groups.at(-1)
    if (last && last.day === day) last.items.push(entry)
    else groups.push({ day, items: [entry] })
  }
  return groups
}
