import type { Prompt, PromptInput } from '@shared/ipc'
import { create } from 'zustand'

interface PromptsState {
  prompts: Prompt[]
  loading: boolean
  error: string | null
  load(): Promise<void>
  create(input: PromptInput): Promise<Prompt>
  update(id: string, input: PromptInput): Promise<Prompt>
  remove(id: string): Promise<boolean>
}

/** Normalises a rejection into a human-readable message, stripping Electron's IPC prefix. */
function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

function bySortOrder(a: Prompt, b: Prompt): number {
  return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)
}

export const usePromptsStore = create<PromptsState>((set) => ({
  prompts: [],
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null })
    try {
      const prompts = await window.api.prompts.list()
      set({ prompts: [...prompts].sort(bySortOrder), loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  async create(input) {
    const prompt = await window.api.prompts.create(input)
    set((state) => ({ prompts: [...state.prompts, prompt].sort(bySortOrder), error: null }))
    return prompt
  },

  async update(id, input) {
    const prompt = await window.api.prompts.update(id, input)
    set((state) => ({
      prompts: state.prompts.map((p) => (p.id === id ? prompt : p)).sort(bySortOrder),
      error: null,
    }))
    return prompt
  },

  async remove(id) {
    try {
      await window.api.prompts.remove(id)
      set((state) => ({ prompts: state.prompts.filter((p) => p.id !== id), error: null }))
      return true
    } catch (error) {
      set({ error: toMessage(error) })
      return false
    }
  },
}))
