import { type SessionStatus, useSessionsStore } from '@renderer/stores/sessions'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseLocalTerminalResult {
  sessionId: string | null
  status: SessionStatus
  shell: string | null
  /** Spawn a fresh shell after the previous one exited. */
  restart(): void
}

/**
 * Owns one local-terminal tab's PTY lifecycle: spawns a shell on mount, mirrors
 * its session id + exit into the sessions store, and kills the PTY on real
 * unmount (StrictMode-safe, mirroring useSshSession's guards).
 */
export function useLocalTerminalSession(tabId: string, cwd?: string): UseLocalTerminalResult {
  const entry = useSessionsStore((s) => s.sessions[tabId])
  const setSession = useSessionsStore((s) => s.setSession)
  const setStatus = useSessionsStore((s) => s.setStatus)
  const clear = useSessionsStore((s) => s.clear)

  const [shell, setShell] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const openingRef = useRef(false)
  const startedRef = useRef(false)
  const aliveRef = useRef(false)

  const open = useCallback(async (): Promise<void> => {
    if (openingRef.current || !aliveRef.current) return
    openingRef.current = true
    setStatus(tabId, 'connecting')
    try {
      const result = await window.api.localTerm.open(cwd ? { cwd } : undefined)
      if (!aliveRef.current) {
        void window.api.localTerm.close(result.sessionId).catch(() => {})
        return
      }
      sessionIdRef.current = result.sessionId
      setShell(result.shell)
      setSession(tabId, result.sessionId)
      setStatus(tabId, 'connected')
    } catch (error) {
      if (aliveRef.current) {
        setStatus(tabId, 'error', error instanceof Error ? error.message : String(error))
      }
    } finally {
      openingRef.current = false
    }
  }, [tabId, cwd, setSession, setStatus])

  const restart = useCallback(() => {
    sessionIdRef.current = null
    void open()
  }, [open])

  // Shell-exit events for this tab's current session.
  useEffect(() => {
    return window.api.localTerm.onExit((event) => {
      if (event.sessionId !== sessionIdRef.current) return
      sessionIdRef.current = null
      setSession(tabId, null)
      setStatus(tabId, 'disconnected', `Shell exited (code ${event.exitCode})`)
    })
  }, [tabId, setSession, setStatus])

  // Mount/unmount: open once per mount cycle, kill only on real unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open-on-mount only; deps are stable
  useEffect(() => {
    aliveRef.current = true
    if (!startedRef.current) {
      startedRef.current = true
      void open()
    }
    return () => {
      aliveRef.current = false
      setTimeout(() => {
        if (aliveRef.current) return // StrictMode remount — keep the PTY
        const sessionId = sessionIdRef.current
        sessionIdRef.current = null
        if (sessionId) void window.api.localTerm.close(sessionId).catch(() => {})
        clear(tabId)
      }, 0)
    }
  }, [])

  return {
    sessionId: entry?.sessionId ?? null,
    status: entry?.status ?? 'idle',
    shell,
    restart,
  }
}
