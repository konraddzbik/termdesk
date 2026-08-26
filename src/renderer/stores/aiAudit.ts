import type { AiAuditEntry } from '@shared/ipc'
import { create } from 'zustand'

interface AiAuditState {
  entries: AiAuditEntry[]
  loading: boolean
  load(): Promise<void>
  clear(): Promise<void>
  applyEvent(entry: AiAuditEntry): void
}

export const useAiAuditStore = create<AiAuditState>((set) => ({
  entries: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      set({ entries: await window.api.mcp.auditList(), loading: false })
    } catch {
      set({ loading: false })
    }
  },

  clear: async () => {
    await window.api.mcp.auditClear()
    set({ entries: [] })
  },

  applyEvent: (entry) => set((state) => ({ entries: [entry, ...state.entries] })),
}))

/** Wire the live AI-audit event stream into the store (call once at app start). */
export function initAiAuditSubscription(): () => void {
  return window.api.mcp.onAudit((entry) => {
    useAiAuditStore.getState().applyEvent(entry)
  })
}
