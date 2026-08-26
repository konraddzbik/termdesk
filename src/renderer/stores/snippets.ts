import type { Snippet, SnippetInput } from '@shared/ipc'
import { create } from 'zustand'

interface SnippetsState {
  snippets: Snippet[]
  loading: boolean
  error: string | null
  load(): Promise<void>
  create(input: SnippetInput): Promise<Snippet>
  update(id: string, input: SnippetInput): Promise<Snippet>
  remove(id: string): Promise<boolean>
}

/** Normalises a rejection into a human-readable message, stripping Electron's IPC prefix. */
function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

function bySortOrder(a: Snippet, b: Snippet): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
}

export const useSnippetsStore = create<SnippetsState>((set) => ({
  snippets: [],
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null })
    try {
      const snippets = await window.api.snippets.list()
      set({ snippets: [...snippets].sort(bySortOrder), loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  async create(input) {
    const snippet = await window.api.snippets.create(input)
    set((state) => ({
      snippets: [...state.snippets, snippet].sort(bySortOrder),
      error: null,
    }))
    return snippet
  },

  async update(id, input) {
    const snippet = await window.api.snippets.update(id, input)
    set((state) => ({
      snippets: state.snippets.map((s) => (s.id === id ? snippet : s)).sort(bySortOrder),
      error: null,
    }))
    return snippet
  },

  async remove(id) {
    try {
      await window.api.snippets.remove(id)
      set((state) => ({
        snippets: state.snippets.filter((s) => s.id !== id),
        error: null,
      }))
      return true
    } catch (error) {
      set({ error: toMessage(error) })
      return false
    }
  },
}))
