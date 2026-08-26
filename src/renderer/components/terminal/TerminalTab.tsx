import { Button } from '@renderer/components/ui/button'
import { useSshSession } from '@renderer/hooks/useSshSession'
import { cn } from '@renderer/lib/utils'
import { useHostsStore } from '@renderer/stores/hosts'
import type { SessionTab } from '@renderer/stores/tabs'
import { TerminalView } from './TerminalView'

const statusDotClass: Record<string, string> = {
  idle: 'bg-muted-foreground',
  connecting: 'bg-yellow-500 animate-pulse',
  connected: 'bg-green-500',
  disconnected: 'bg-zinc-500',
  error: 'bg-red-500',
}

const statusText: Record<string, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection error',
}

interface TerminalTabProps {
  tab: SessionTab
}

/** Status bar + terminal surface for one SSH terminal tab. */
export function TerminalTab({ tab }: TerminalTabProps): React.JSX.Element {
  // Select just this tab's host so host CRUD elsewhere doesn't re-render the tab.
  const host = useHostsStore((s) => s.hosts.find((h) => h.id === tab.hostId))
  const supportsSsh = host?.kind !== 'vnc'

  const {
    sessionId,
    status,
    error,
    reconnect,
    abortConnect,
    disconnect,
    autoReconnect,
    setAutoReconnect,
  } = useSshSession(tab.id, tab.hostId ?? '')

  if (!supportsSsh) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-destructive">
        This host is configured as VNC-only and does not support SSH terminal sessions.
        <br />
        Edit the host and choose "SSH only" or "Both" to enable terminal access.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-card/30 px-3 text-xs">
        <span
          className={cn('size-2 shrink-0 rounded-full', statusDotClass[status])}
          aria-hidden="true"
        />
        <span className="sr-only">{statusText[status]}</span>
        <span className="font-medium text-foreground">{tab.title}</span>
        {error && (
          <span className="min-w-0 truncate text-destructive" title={error}>
            {error}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-muted-foreground">
            <input
              type="checkbox"
              checked={autoReconnect}
              onChange={(event) => setAutoReconnect(event.target.checked)}
              className="size-3.5 accent-primary"
            />
            Auto-reconnect
          </label>
          {(status === 'disconnected' || status === 'error') && (
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={reconnect}>
              Reconnect
            </Button>
          )}
          {status === 'connecting' && (
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={abortConnect}>
              Abort
            </Button>
          )}
          {status === 'connected' && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={disconnect}>
              Disconnect
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {sessionId && status === 'connected' ? (
          <TerminalView sessionId={sessionId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {status === 'error' ? (error ?? 'Connection error') : statusText[status]}
          </div>
        )}
      </div>
    </div>
  )
}
