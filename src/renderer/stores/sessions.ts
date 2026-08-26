import { create } from 'zustand'

export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface SessionEntry {
  sessionId: string | null
  status: SessionStatus
  error?: string
}

interface SessionsState {
  /** Keyed by tab id, not SSH session id — a tab keeps its slot across reconnects. */
  sessions: Record<string, SessionEntry>
  setSession(tabId: string, sessionId: string | null): void
  setStatus(tabId: string, status: SessionStatus, error?: string): void
  clear(tabId: string): void
}

const idleEntry: SessionEntry = { sessionId: null, status: 'idle' }

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: {},

  setSession: (tabId, sessionId) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [tabId]: { ...(state.sessions[tabId] ?? idleEntry), sessionId },
      },
    })),

  setStatus: (tabId, status, error) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [tabId]: { ...(state.sessions[tabId] ?? idleEntry), status, error },
      },
    })),

  clear: (tabId) =>
    set((state) => {
      const { [tabId]: _removed, ...sessions } = state.sessions
      return { sessions }
    }),
}))
