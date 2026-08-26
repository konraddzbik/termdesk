import type { UserInteraction } from '@devolutions/iron-remote-desktop'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useSessionsStore } from '@renderer/stores/sessions'
import type { SessionTab } from '@renderer/stores/tabs'
import { Expand, Keyboard, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * Embedded RDP viewer backed by Devolutions IronRDP's WASM web component. The
 * main process provisions a one-time RDCleanPath proxy (window.api.rdp.open);
 * the `<iron-remote-desktop>` element speaks RDP/CredSSP in WASM over that proxy
 * and paints to its own canvas, so this component only wires lifecycle + a small
 * toolbar (mirroring VncTab).
 *
 * NOTE: the RDP/CredSSP handshake needs a live Windows target, so the connect
 * path here is verified against a real host as a manual step; the wiring follows
 * the installed @devolutions/iron-remote-desktop API surface.
 */

type RdpStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

/** The custom element exposes a `module` sink for the WASM backend + a `ready` event. */
interface IronRemoteDesktopElement extends HTMLElement {
  module: unknown
}
interface ReadyDetail {
  irgUserInteraction: UserInteraction
}

interface RdpTabProps {
  tab: SessionTab
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

export function RdpTab({ tab }: RdpTabProps): React.JSX.Element {
  const hostId = tab.hostId ?? ''
  const setSessionStatus = useSessionsStore((s) => s.setStatus)
  const clearSession = useSessionsStore((s) => s.clear)

  const containerRef = useRef<HTMLDivElement>(null)
  const elementRef = useRef<IronRemoteDesktopElement | null>(null)
  const uiRef = useRef<UserInteraction | null>(null)
  const aliveRef = useRef(false)
  const startedRef = useRef(false)
  const [status, setStatus] = useState<RdpStatus>('connecting')
  const [reason, setReason] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const reconnect = (): void => setAttempt((n) => n + 1)

  useEffect(() => {
    aliveRef.current = true
    const container = containerRef.current
    if (!container) return

    const teardown = (): void => {
      try {
        uiRef.current?.shutdown()
      } catch {
        /* best-effort */
      }
      uiRef.current = null
      if (elementRef.current) {
        elementRef.current.remove()
        elementRef.current = null
      }
    }

    const connect = async (): Promise<void> => {
      setStatus('connecting')
      setReason(null)
      setSessionStatus(tab.id, 'connecting')
      try {
        const { wsUrl, authToken, destination, username, domain, password } =
          await window.api.rdp.open(hostId)
        if (!aliveRef.current) return

        // Lazy-load the ~6 MB WASM only when an RDP tab actually opens (code-split).
        const [rdp] = await Promise.all([
          import('@devolutions/iron-remote-desktop-rdp'),
          import('@devolutions/iron-remote-desktop'), // side-effect: defines <iron-remote-desktop>
        ])
        if (!aliveRef.current) return

        const el = document.createElement('iron-remote-desktop') as IronRemoteDesktopElement
        el.style.width = '100%'
        el.style.height = '100%'
        // Inject the RDP WASM backend (the element's `set module` initializes the bridge).
        el.module = rdp.Backend
        elementRef.current = el
        container.appendChild(el)

        el.addEventListener('ready', (event) => {
          const ui = (event as CustomEvent<ReadyDetail>).detail.irgUserInteraction
          uiRef.current = ui
          const config = ui
            .configBuilder()
            .withUsername(username)
            .withPassword(password ?? '')
            .withDestination(destination)
            .withProxyAddress(wsUrl)
            .withAuthToken(authToken)
            .withServerDomain(domain ?? '')
            .build()
          ui.connect(config)
            .then((info) => {
              if (!aliveRef.current) return
              setStatus('connected')
              setSessionStatus(tab.id, 'connected')
              return info.run()
            })
            .then(() => {
              if (!aliveRef.current) return
              setStatus((prev) => (prev === 'error' ? prev : 'disconnected'))
              setSessionStatus(tab.id, 'disconnected')
            })
            .catch((err) => {
              if (!aliveRef.current) return
              setStatus('error')
              setReason(toMessage(err))
              setSessionStatus(tab.id, 'error')
            })
        })
      } catch (error) {
        if (!aliveRef.current) return
        setStatus('error')
        setReason(toMessage(error))
        setSessionStatus(tab.id, 'error')
      }
    }

    if (!startedRef.current || attempt > 0) {
      startedRef.current = true
      void connect()
    }

    return () => {
      aliveRef.current = false
      setTimeout(() => {
        if (aliveRef.current) return // StrictMode remount
        teardown()
        clearSession(tab.id)
        startedRef.current = false
      }, 0)
    }
  }, [hostId, attempt, tab.id, setSessionStatus, clearSession])

  const fullscreen = (): void => {
    void containerRef.current?.requestFullscreen?.()
  }

  return (
    <div className="flex h-full flex-col bg-[#18181b]">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-card/40 px-2 text-xs">
        <span
          className={cn(
            'size-2 rounded-full',
            status === 'connected' && 'bg-emerald-500',
            status === 'connecting' && 'bg-yellow-500',
            (status === 'disconnected' || status === 'error') && 'bg-red-500',
          )}
        />
        <span className="mr-2 text-muted-foreground">
          {status === 'connecting' && 'Connecting…'}
          {status === 'connected' && tab.title}
          {status === 'disconnected' && 'Disconnected'}
          {status === 'error' && 'Error'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => uiRef.current?.ctrlAltDel()}
          disabled={status !== 'connected'}
          title="Send Ctrl+Alt+Del"
        >
          <Keyboard className="size-3.5" /> Ctrl+Alt+Del
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={fullscreen}
          disabled={status !== 'connected'}
          title="Fullscreen"
        >
          <Expand className="size-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={reconnect} title="Reconnect">
          <RefreshCw className="size-3.5" /> Reconnect
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 overflow-hidden" />
        {status !== 'connected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm">
            {status === 'connecting' ? (
              <>
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Opening RDP session…</span>
              </>
            ) : (
              <>
                <Unplug className="size-6 text-muted-foreground" />
                <span className="max-w-md text-center text-muted-foreground">
                  {reason ?? 'The RDP session ended.'}
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
