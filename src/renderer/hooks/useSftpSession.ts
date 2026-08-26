import { useEffect, useRef, useState } from 'react'

export interface UseSftpSessionResult {
  sftpId: string | null
  homeDir: string | null
  /** Directory to open the browser at (host default path, else home). */
  startDir: string | null
  status: 'connecting' | 'ready' | 'error' | 'aborted'
  error: string | undefined
  reconnect(): void
  abortConnect(): void
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

/**
 * Owns one SFTP browser session: opens on mount (StrictMode-safe), closes on
 * real unmount.
 */
type SftpSessionState = Pick<
  UseSftpSessionResult,
  'sftpId' | 'homeDir' | 'startDir' | 'status' | 'error'
>

export function useSftpSession(hostId: string): UseSftpSessionResult {
  const [state, setState] = useState<SftpSessionState>({
    sftpId: null,
    homeDir: null,
    startDir: null,
    status: 'connecting',
    error: undefined,
  })
  const sftpIdRef = useRef<string | null>(null)
  const aliveRef = useRef(false)
  const startedRef = useRef(false)
  const abortedRef = useRef(false)
  const [attempt, setAttempt] = useState(0)

  const abortConnect = (): void => {
    abortedRef.current = true
    void window.api.ssh.abortConnect(hostId).catch(() => {})
    sftpIdRef.current = null
    setState({
      sftpId: null,
      homeDir: null,
      startDir: null,
      status: 'aborted',
      error: 'Connection aborted',
    })
  }

  useEffect(() => {
    aliveRef.current = true
    abortedRef.current = false
    const open = async (): Promise<void> => {
      setState({
        sftpId: null,
        homeDir: null,
        startDir: null,
        status: 'connecting',
        error: undefined,
      })
      try {
        const result = await window.api.sftp.open(hostId)
        if (!aliveRef.current || abortedRef.current) {
          void window.api.sftp.close(result.sftpId).catch(() => {})
          return
        }
        sftpIdRef.current = result.sftpId
        setState({
          sftpId: result.sftpId,
          homeDir: result.homeDir,
          startDir: result.startDir,
          status: 'ready',
          error: undefined,
        })
      } catch (error) {
        if (!aliveRef.current || abortedRef.current) return
        const message = toMessage(error)
        if (message === 'Connection aborted') {
          setState({
            sftpId: null,
            homeDir: null,
            startDir: null,
            status: 'aborted',
            error: message,
          })
        } else {
          setState({ sftpId: null, homeDir: null, startDir: null, status: 'error', error: message })
        }
      }
    }
    if (!startedRef.current || attempt > 0) {
      startedRef.current = true
      void open()
    }
    return () => {
      aliveRef.current = false
      setTimeout(() => {
        if (aliveRef.current) return // StrictMode remount
        const sftpId = sftpIdRef.current
        sftpIdRef.current = null
        if (sftpId) void window.api.sftp.close(sftpId).catch(() => {})
      }, 0)
    }
  }, [hostId, attempt])

  return { ...state, reconnect: () => setAttempt((n) => n + 1), abortConnect }
}
