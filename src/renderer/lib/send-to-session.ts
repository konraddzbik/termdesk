import { useSessionsStore } from '@renderer/stores/sessions'
import { useTabsStore } from '@renderer/stores/tabs'

export interface ActiveSession {
  sessionId: string
  /** Which transport to write through. */
  kind: 'terminal' | 'local-terminal'
}

/**
 * The active tab's live session, but only when it is a *connected* SSH terminal
 * or local terminal — the two kinds that accept typed input. Returns null
 * otherwise (no active tab, wrong kind, or not connected).
 */
export function getActiveSession(): ActiveSession | null {
  const { activeTabId, tabs } = useTabsStore.getState()
  if (activeTabId == null) return null
  const tab = tabs.find((t) => t.id === activeTabId)
  if (!tab || (tab.kind !== 'terminal' && tab.kind !== 'local-terminal')) return null
  const session = useSessionsStore.getState().sessions[activeTabId]
  if (session?.status !== 'connected' || session.sessionId == null) return null
  return { sessionId: session.sessionId, kind: tab.kind }
}

/**
 * Write text into the active terminal, dispatching to the right transport (SSH
 * vs local PTY). Returns false when there is no connected terminal to write to.
 * Callers pass the exact bytes to write (append a trailing newline to submit).
 */
export function sendToActiveSession(text: string): boolean {
  const active = getActiveSession()
  if (active === null) return false
  if (active.kind === 'terminal') {
    window.api.ssh.write(active.sessionId, text)
  } else {
    window.api.localTerm.write(active.sessionId, text)
  }
  return true
}
