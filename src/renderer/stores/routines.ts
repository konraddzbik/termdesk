import type { Routine, RoutineInput } from '@shared/ipc'
import { create } from 'zustand'

interface RoutinesState {
  routines: Routine[]
  loading: boolean
  error: string | null
  load(): Promise<void>
  create(input: RoutineInput): Promise<Routine>
  update(id: string, input: RoutineInput): Promise<Routine>
  remove(id: string): Promise<boolean>
  /** Reflect a just-recorded run's lastRunAt without a full reload. */
  markRan(id: string, at: number): void
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

function byName(a: Routine, b: Routine): number {
  return a.name.localeCompare(b.name)
}

export const useRoutinesStore = create<RoutinesState>((set) => ({
  routines: [],
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null })
    try {
      const routines = await window.api.routines.list()
      set({ routines: [...routines].sort(byName), loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  async create(input) {
    const routine = await window.api.routines.create(input)
    set((state) => ({ routines: [...state.routines, routine].sort(byName), error: null }))
    return routine
  },

  async update(id, input) {
    const routine = await window.api.routines.update(id, input)
    set((state) => ({
      routines: state.routines.map((r) => (r.id === id ? routine : r)).sort(byName),
      error: null,
    }))
    return routine
  },

  async remove(id) {
    try {
      await window.api.routines.remove(id)
      set((state) => ({ routines: state.routines.filter((r) => r.id !== id), error: null }))
      return true
    } catch (error) {
      set({ error: toMessage(error) })
      return false
    }
  },

  markRan(id, at) {
    set((state) => ({
      routines: state.routines.map((r) => (r.id === id ? { ...r, lastRunAt: at } : r)),
    }))
  },
}))
