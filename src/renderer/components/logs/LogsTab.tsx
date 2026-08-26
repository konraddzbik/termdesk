import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { cn } from '@renderer/lib/utils'
import { groupByDay, useLogsStore } from '@renderer/stores/logs'
import type { ActivityAction, ActivityEntry } from '@shared/ipc'
import {
  FolderOpen,
  Laptop,
  MonitorPlay,
  Network,
  Plug,
  Trash2,
  Unplug,
  XCircle,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo } from 'react'

const GRID = 'grid grid-cols-[1.6fr_1fr_1.6fr_0.7fr_0.8fr] gap-3'

const ACTION_META: Record<ActivityAction, { label: string; Icon: typeof Plug; className: string }> =
  {
    connected: { label: 'Connected', Icon: Plug, className: 'text-emerald-400' },
    disconnected: { label: 'Disconnected', Icon: Unplug, className: 'text-muted-foreground' },
    failed: { label: 'Failed', Icon: XCircle, className: 'text-destructive' },
    'sftp-open': { label: 'SFTP', Icon: FolderOpen, className: 'text-blue-400' },
    'vnc-open': { label: 'VNC', Icon: MonitorPlay, className: 'text-violet-400' },
    'rdp-open': { label: 'RDP', Icon: MonitorPlay, className: 'text-sky-400' },
    automation: { label: 'Automation', Icon: Zap, className: 'text-amber-400' },
    'tunnel-open': { label: 'Tunnel up', Icon: Network, className: 'text-emerald-400' },
    'tunnel-close': { label: 'Tunnel down', Icon: Network, className: 'text-muted-foreground' },
  }

function relativeTime(ms: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function initials(user: string | null): string {
  if (!user) return '?'
  const name = user.split('@')[0] ?? user
  const parts = name.split(/[._\- ]+/).filter(Boolean)
  const chars =
    parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)
  return chars.toUpperCase()
}

function LogRow({ entry }: { entry: ActivityEntry }): React.JSX.Element {
  const meta = ACTION_META[entry.action]
  const time = new Date(entry.ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <div className={cn(GRID, 'items-center rounded-md px-3 py-2 text-sm hover:bg-accent/40')}>
      {/* User */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-[10px] font-semibold text-primary">
          {initials(entry.user)}
        </span>
        <span className="truncate">{entry.user ?? 'local'}</span>
      </div>
      {/* Action */}
      <div className={cn('flex items-center gap-1.5', meta.className)}>
        <meta.Icon className="size-4 shrink-0" />
        <span className="truncate text-foreground">{meta.label}</span>
      </div>
      {/* Host */}
      <div className="min-w-0">
        <p className="truncate">{entry.hostLabel}</p>
        {(entry.hostSubtitle || entry.detail) && (
          <p className="truncate text-xs text-muted-foreground">
            {entry.hostSubtitle ?? entry.detail}
          </p>
        )}
      </div>
      {/* Time */}
      <div className="min-w-0">
        <p className="truncate tabular-nums">{time}</p>
        <p className="truncate text-xs text-muted-foreground">{relativeTime(entry.ts)}</p>
      </div>
      {/* Device */}
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <Laptop className="size-4 shrink-0" />
        <span className="truncate text-foreground">{entry.device ?? '—'}</span>
      </div>
    </div>
  )
}

export function LogsTab(): React.JSX.Element {
  const entries = useLogsStore((s) => s.entries)
  const load = useLogsStore((s) => s.load)
  const clear = useLogsStore((s) => s.clear)

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => groupByDay(entries), [entries])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">Logs</span>
          <span className="text-xs text-muted-foreground">{entries.length} events</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void clear()}
          disabled={entries.length === 0}
        >
          <Trash2 className="size-3.5" />
          Clear
        </Button>
      </div>

      {/* Column header */}
      <div
        className={cn(
          GRID,
          'shrink-0 border-b px-3 py-2 text-xs font-medium text-muted-foreground',
        )}
      >
        <span>User</span>
        <span>Action</span>
        <span>Host</span>
        <span>Time</span>
        <span>Device</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No activity yet. Connect to a host, open SFTP/VNC, or run automation — events show up
            here.
          </p>
        ) : (
          <div className="px-1 py-1">
            {groups.map((group) => (
              <div key={group.day}>
                <div className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                  {group.day}
                </div>
                {group.items.map((entry) => (
                  <LogRow key={entry.id} entry={entry} />
                ))}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
