import { type SessionStatus, useSessionsStore } from '@renderer/stores/sessions'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Reconnect backoff schedule in milliseconds; the last value repeats (cap). */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const

/** Normalises a rejection into a human-readable message, stripping Electron's IPC prefix. */
function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

export interface UseSshSessionResult {
  sessionId: string | null
  status: SessionStatus
  error: string | undefined
  reconnect(): void
  abortConnect(): void
  disconnect(): void
  autoReconnect: boolean
  setAutoReconnect(enabled: boolean): void
}

/**
 * Owns the SSH session lifecycle for one terminal tab: connects on mount,
 * mirrors lifecycle events into the sessions store, optionally auto-reconnects
 * with backoff, and tears the session down on real unmount (StrictMode-safe).
 */
export function useSshSession(tabId: string, hostId: string): UseSshSessionResult {
  const entry = useSessionsStore((s) => s.sessions[tabId])
  const setSession = useSessionsStore((s) => s.setSession)
  const setStatus = useSessionsStore((s) => s.setStatus)
  const clear = useSessionsStore((s) => s.clear)

  const [autoReconnect, setAutoReconnectState] = useState(false)

  const sessionIdRef = useRef<string | null>(null)
  const connectingRef = useRef(false)
  /** True after the user explicitly disconnected (or the tab unmounted). */
  const userDisconnectedRef = useRef(false)
  const autoReconnectRef = useRef(false)
  const attemptRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** StrictMode guards: connect once per mount cycle, tear down only on real unmount. */
  const startedRef = useRef(false)
  const aliveRef = useRef(false)

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  const connect = useCallback(async (): Promise<void> => {
    if (connectingRef.current || !aliveRef.current) return
    connectingRef.current = true
    userDisconnectedRef.current = false
    setStatus(tabId, 'connecting')
    try {
      const result = await window.api.ssh.connect(hostId)
      if (!aliveRef.current || userDisconnectedRef.current) {
        // Tab closed or aborted while connecting; don't leak the session in main.
        void window.api.ssh.disconnect(result.sessionId).catch(() => {})
        return
      }
      sessionIdRef.current = result.sessionId
      setSession(tabId, result.sessionId)
      // Main resolves connect once the shell is up; later transitions arrive
      // via onEvent (filtered by sessionId).
      attemptRef.current = 0
      setStatus(tabId, 'connected')
    } catch (error) {
      if (!aliveRef.current) return
      const message = toMessage(error)
      if (message === 'Connection aborted') setStatus(tabId, 'disconnected', message)
      else setStatus(tabId, 'error', message)
    } finally {
      connectingRef.current = false
    }
  }, [tabId, hostId, setSession, setStatus])

  const scheduleReconnect = useCallback(() => {
    if (!autoReconnectRef.current || userDisconnectedRef.current || !aliveRef.current) return
    if (retryTimerRef.current !== null) return
    const delay = BACKOFF_MS[Math.min(attemptRef.current, BACKOFF_MS.length - 1)] ?? 15_000
    attemptRef.current += 1
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      void connect()
    }, delay)
  }, [connect])

  const reconnect = useCallback(() => {
    clearRetryTimer()
    attemptRef.current = 0
    void connect()
  }, [connect, clearRetryTimer])

  const abortConnect = useCallback(() => {
    userDisconnectedRef.current = true
    clearRetryTimer()
    void window.api.ssh.abortConnect(hostId).catch(() => {})
    connectingRef.current = false
    sessionIdRef.current = null
    setSession(tabId, null)
    setStatus(tabId, 'disconnected', 'Connection aborted')
  }, [tabId, hostId, setSession, setStatus, clearRetryTimer])

  const disconnect = useCallback(() => {
    userDisconnectedRef.current = true
    clearRetryTimer()
    const sessionId = sessionIdRef.current
    sessionIdRef.current = null
    if (sessionId) {
      void window.api.ssh.disconnect(sessionId).catch(() => {})
      setSession(tabId, null)
    } else if (connectingRef.current) {
      void window.api.ssh.abortConnect(hostId).catch(() => {})
      connectingRef.current = false
    }
    setStatus(tabId, 'disconnected')
  }, [tabId, hostId, setSession, setStatus, clearRetryTimer])

  const setAutoReconnect = useCallback(
    (enabled: boolean) => {
      autoReconnectRef.current = enabled
      setAutoReconnectState(enabled)
      if (!enabled) clearRetryTimer()
    },
    [clearRetryTimer],
  )

  // Lifecycle events for this tab's current session.
  useEffect(() => {
    return window.api.ssh.onEvent((event) => {
      if (event.sessionId !== sessionIdRef.current) return
      switch (event.type) {
        case 'connecting':
          setStatus(tabId, 'connecting')
          break
        case 'connected':
          attemptRef.current = 0
          setStatus(tabId, 'connected')
          break
        case 'disconnected':
          setStatus(tabId, 'disconnected', event.message)
          if (!userDisconnectedRef.current) scheduleReconnect()
          break
        case 'error':
          setStatus(tabId, 'error', event.message ?? 'Connection error')
          break
        case 'hostkey-mismatch':
          setStatus(
            tabId,
            'error',
            event.message ?? 'Host key mismatch — possible man-in-the-middle attack',
          )
          break
      }
    })
  }, [tabId, setStatus, scheduleReconnect])

  // Mount/unmount: connect once per mount cycle, tear down only on real unmount.
  // StrictMode runs setup → cleanup → setup synchronously; the deferred check
  // distinguishes the simulated remount (aliveRef flips back) from a real one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: connect-on-mount only; deps are stable refs/callbacks
  useEffect(() => {
    aliveRef.current = true
    if (!startedRef.current) {
      startedRef.current = true
      void connect()
    }
    return () => {
      aliveRef.current = false
      setTimeout(() => {
        if (aliveRef.current) return // StrictMode remount, keep the session
        userDisconnectedRef.current = true
        clearRetryTimer()
        const sessionId = sessionIdRef.current
        sessionIdRef.current = null
        if (sessionId) void window.api.ssh.disconnect(sessionId).catch(() => {})
        clear(tabId)
      }, 0)
    }
  }, [])

  return {
    sessionId: entry?.sessionId ?? null,
    status: entry?.status ?? 'idle',
    error: entry?.error,
    reconnect,
    abortConnect,
    disconnect,
    autoReconnect,
    setAutoReconnect,
  }
}
