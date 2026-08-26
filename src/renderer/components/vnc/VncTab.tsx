import RFB from '@novnc/novnc'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useSessionsStore } from '@renderer/stores/sessions'
import type { SessionTab } from '@renderer/stores/tabs'
import {
  ClipboardCopy,
  ClipboardPaste,
  Expand,
  Keyboard,
  Loader2,
  MonitorX,
  RefreshCw,
  Scaling,
  Unplug,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

type VncStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

interface VncTabProps {
  tab: SessionTab
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

/** Base64-encode raw bytes (RA2 server key) without blowing the call stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0)
  return btoa(binary)
}

/** Log to the renderer console AND the main-process VNC debug file. */
function vlog(message: string): void {
  console.log(`[vnc-ui] ${message}`)
  try {
    window.api.vnc.debugLog(message)
  } catch {
    // diagnostics only
  }
}

/**
 * Embedded VNC viewer. Each (re)connect asks main for a fresh one-time bridge
 * URL (and, when stored, the VNC password — used once for the credentials
 * handshake and kept only in this mount's closure).
 */
export function VncTab({ tab }: VncTabProps): React.JSX.Element {
  const hostId = tab.hostId ?? ''
  // Mirror VNC connection status into the shared sessions store (keyed by tab id,
  // like SSH) so the host list can show a live "connected" dot.
  const setSessionStatus = useSessionsStore((s) => s.setStatus)
  const clearSession = useSessionsStore((s) => s.clear)
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  /** StrictMode: distinguish simulated remount from real tab close. */
  const aliveRef = useRef(false)
  const startedRef = useRef(false)
  const abortedRef = useRef(false)

  const [status, setStatus] = useState<VncStatus>('connecting')
  const [reason, setReason] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [scaleViewport, setScaleViewport] = useState(true)
  const [resizeSession, setResizeSession] = useState(true)
  /** Latest remote clipboard, buffered — never auto-written to the OS clipboard. */
  const remoteClipboardRef = useRef('')
  const [hasRemoteClipboard, setHasRemoteClipboard] = useState(false)

  const disconnectRfb = useCallback((): void => {
    const rfb = rfbRef.current
    rfbRef.current = null
    if (rfb) {
      try {
        rfb.disconnect()
      } catch {
        // already gone
      }
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: connect per mount/attempt; option toggles are applied via the other effect
  useEffect(() => {
    aliveRef.current = true
    abortedRef.current = false
    const container = containerRef.current
    if (!container) return

    const connect = async (): Promise<void> => {
      setStatus('connecting')
      setReason(null)
      try {
        const { wsUrl, username, password } = await window.api.vnc.open(hostId)
        vlog(
          `bridge URL received: ${wsUrl} (username: ${username !== null}, password: ${password !== null})`,
        )
        if (!aliveRef.current || abortedRef.current) return
        const credentials =
          username !== null || password !== null
            ? {
                ...(username !== null ? { username } : {}),
                ...(password !== null ? { password } : {}),
              }
            : undefined
        const rfb = new RFB(container, wsUrl, { credentials })
        rfbRef.current = rfb
        rfb.scaleViewport = scaleViewport
        rfb.resizeSession = resizeSession
        rfb.background = '#18181b'

        // The bridge can connect to the target while the RFB handshake never
        // completes (wrong port, not a VNC server, firewall accept-then-drop).
        // Without this the viewer spins on "Connecting…" forever; surface it.
        let watchdog: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          watchdog = null
          if (!aliveRef.current || rfbRef.current !== rfb) return
          vlog('RFB handshake did not complete within 10s — server not responding')
          setStatus('error')
          setReason(
            'Connected to the host but it isn’t responding to VNC (no RFB handshake within 10s). ' +
              'Check the VNC port and that a VNC server is actually listening there.',
          )
          disconnectRfb()
        }, 10_000)
        const clearWatchdog = (): void => {
          if (watchdog) {
            clearTimeout(watchdog)
            watchdog = null
          }
        }

        rfb.addEventListener('connect', () => {
          vlog('RFB connect (handshake complete)')
          clearWatchdog()
          if (aliveRef.current) setStatus('connected')
        })
        rfb.addEventListener('disconnect', (event) => {
          vlog(`RFB disconnect (clean=${event.detail.clean})`)
          clearWatchdog()
          if (!aliveRef.current) return
          rfbRef.current = null
          setStatus((prev) => (prev === 'error' ? prev : 'disconnected'))
          if (!event.detail.clean) {
            setReason((prev) => prev ?? 'Connection lost (tunnel or server closed unexpectedly)')
          }
        })
        rfb.addEventListener('securityfailure', (event) => {
          vlog(`RFB securityfailure: ${event.detail.reason} (${event.detail.status})`)
          clearWatchdog()
          if (!aliveRef.current) return
          setStatus('error')
          setReason(`VNC authentication failed: ${event.detail.reason} (${event.detail.status})`)
        })
        rfb.addEventListener('rfberror', (event) => {
          vlog(`RFB error: ${event.detail.message}`)
          clearWatchdog()
          if (!aliveRef.current) return
          setStatus('error')
          setReason(event.detail.message)
        })
        rfb.addEventListener('securitytype', (event) => {
          vlog(`RFB security type selected: ${event.detail.type}`)
        })
        rfb.addEventListener('credentialsrequired', (event) => {
          const types = event.detail.types
          vlog(`RFB credentialsrequired (${types.join(', ')})`)
          // Credentials may arrive on the next tick via sendCredentials — only
          // surface an error when we truly have nothing to send.
          if (credentials) {
            rfb.sendCredentials(credentials)
            return
          }
          clearWatchdog()
          if (!aliveRef.current) return
          setStatus('error')
          if (types.includes('username')) {
            setReason(
              'RealVNC needs a username and password. Open Settings → Credentials, add a VNC credential with both, then assign it to this host.',
            )
          } else {
            setReason(
              'The VNC server requires a password — set it on the host or use a managed VNC credential.',
            )
          }
        })
        // RealVNC RSA-AES asks the client to verify the server key before auth.
        // Pin it trust-on-first-use (decided in main): approve a matching/new
        // key, refuse a changed one (possible MITM) instead of blindly trusting.
        rfb.addEventListener('serververification', (event) => {
          void (async () => {
            try {
              const verdict = await window.api.vnc.verifyServerKey(
                hostId,
                toBase64(event.detail.publickey),
              )
              if (rfbRef.current !== rfb) return
              if (verdict.ok) {
                vlog('RFB serververification — server key verified, approving')
                rfb.approveServer()
                return
              }
              vlog(`RFB serververification — REFUSED: ${verdict.reason ?? 'key not trusted'}`)
              clearWatchdog()
              if (!aliveRef.current) return
              setStatus('error')
              setReason(verdict.reason ?? 'The VNC server key could not be verified.')
              disconnectRfb()
            } catch (err) {
              vlog(`RFB serververification — verify failed: ${toMessage(err)}`)
              clearWatchdog()
              if (!aliveRef.current) return
              setStatus('error')
              setReason('Could not verify the VNC server key — connection refused.')
              disconnectRfb()
            }
          })()
        })
        rfb.addEventListener('ra2phase', (event) => {
          vlog(`RFB ra2: ${event.detail.phase}`)
        })
        rfb.addEventListener('clipboard', (event) => {
          // Buffer the remote clipboard; do NOT auto-write it to the OS
          // clipboard. A malicious server can change its clipboard at will, and
          // a silent sync would let it poison what the user pastes elsewhere
          // (pastejacking). The user pulls it explicitly via the toolbar.
          remoteClipboardRef.current = event.detail.text
          if (aliveRef.current) setHasRemoteClipboard(Boolean(event.detail.text))
        })
      } catch (error) {
        vlog(`vnc.open failed: ${toMessage(error)}`)
        if (!aliveRef.current || abortedRef.current) return
        const message = toMessage(error)
        if (message === 'Connection aborted') {
          setStatus('disconnected')
          setReason(message)
        } else {
          setStatus('error')
          setReason(message)
        }
      }
    }
    // StrictMode runs setup → cleanup → setup; the first async connect may
    // resume after the simulated unmount, so use aliveRef (not a closure flag).
    if (!startedRef.current || attempt > 0) {
      startedRef.current = true
      void connect()
    }

    return () => {
      aliveRef.current = false
      setTimeout(() => {
        if (aliveRef.current) return // StrictMode remount
        disconnectRfb()
        startedRef.current = false
      }, 0)
    }
  }, [hostId, attempt])

  // Apply scaling toggles to a live connection.
  useEffect(() => {
    const rfb = rfbRef.current
    if (rfb) {
      rfb.scaleViewport = scaleViewport
      rfb.resizeSession = resizeSession
    }
  }, [scaleViewport, resizeSession])

  // Publish status to the sessions store so HostList can show a live dot, and
  // release the slot when this VNC tab is closed.
  useEffect(() => {
    setSessionStatus(tab.id, status)
  }, [status, tab.id, setSessionStatus])
  useEffect(() => () => clearSession(tab.id), [tab.id, clearSession])

  const abortConnect = (): void => {
    abortedRef.current = true
    void window.api.ssh.abortConnect(hostId).catch(() => {})
    disconnectRfb()
    setStatus('disconnected')
    setReason('Connection aborted')
  }

  const reconnect = (): void => {
    disconnectRfb()
    setAttempt((n) => n + 1)
  }

  const pasteClipboard = async (): Promise<void> => {
    const text = await navigator.clipboard.readText().catch(() => '')
    if (text) rfbRef.current?.clipboardPasteFrom(text)
  }

  const fullscreen = (): void => {
    void wrapperRef.current?.requestFullscreen().catch(() => {})
  }

  return (
    <div ref={wrapperRef} className="flex h-full flex-col bg-[#18181b]">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-card/40 px-2 text-xs">
        <span
          className={cn(
            'size-2 rounded-full',
            status === 'connected' && 'bg-emerald-500',
            status === 'connecting' && 'bg-yellow-500',
            (status === 'disconnected' || status === 'error') && 'bg-red-500',
          )}
          aria-hidden="true"
        />
        <span className="text-muted-foreground">
          {status === 'connecting' && 'Connecting…'}
          {status === 'connected' && tab.title}
          {status === 'disconnected' && 'Disconnected'}
          {status === 'error' && 'Error'}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setScaleViewport((v) => !v)}
          title="Scale the remote desktop to fit this window (local scaling)"
        >
          <Scaling className={cn('size-3.5', scaleViewport && 'text-emerald-400')} />
          Scale
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setResizeSession((v) => !v)}
          title="Ask the server to resize its desktop to this window (remote resize)"
        >
          <MonitorX className={cn('size-3.5', resizeSession && 'text-emerald-400')} />
          Remote resize
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => void pasteClipboard()}
          disabled={status !== 'connected'}
          title="Send local clipboard to the remote machine"
        >
          <ClipboardPaste className="size-3.5" />
          Paste
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => {
            const text = remoteClipboardRef.current
            if (text) void navigator.clipboard.writeText(text).catch(() => {})
          }}
          disabled={status !== 'connected' || !hasRemoteClipboard}
          title="Copy the remote machine's clipboard to your local clipboard"
        >
          <ClipboardCopy className="size-3.5" />
          Copy from remote
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => rfbRef.current?.sendCtrlAltDel()}
          disabled={status !== 'connected'}
          title="Send Ctrl+Alt+Del"
        >
          <Keyboard className="size-3.5" />
          Ctrl+Alt+Del
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={fullscreen}
          disabled={status !== 'connected'}
          title="Fullscreen"
        >
          <Expand className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={reconnect}
          title="Reconnect"
        >
          <RefreshCw className="size-3.5" />
          Reconnect
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 overflow-hidden" />
        {status !== 'connected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#18181b]/90 text-sm">
            {status === 'connecting' ? (
              <>
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Opening VNC session…</span>
                <Button variant="outline" size="sm" onClick={abortConnect}>
                  Abort
                </Button>
              </>
            ) : (
              <>
                <Unplug className="size-6 text-muted-foreground" />
                <span className="max-w-md text-center text-muted-foreground">
                  {reason ?? 'The VNC session ended.'}
                </span>
                <Button variant="secondary" size="sm" onClick={reconnect}>
                  Reconnect
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
