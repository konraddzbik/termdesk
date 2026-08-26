import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useTunnelsStore } from '@renderer/stores/tunnels'
import type { SavedTunnel } from '@shared/ipc'
import { ChevronDown, ChevronRight, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TunnelDialog } from './TunnelDialog'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function describe(t: SavedTunnel): string {
  if (t.type === 'dynamic') return `SOCKS :${t.listenPort}`
  return `:${t.listenPort} → ${t.dstHost}:${t.dstPort}`
}

export function TunnelsPanel(): React.JSX.Element {
  const saved = useTunnelsStore((s) => s.saved)
  const status = useTunnelsStore((s) => s.status)
  const load = useTunnelsStore((s) => s.load)
  const start = useTunnelsStore((s) => s.start)
  const stop = useTunnelsStore((s) => s.stop)
  const remove = useTunnelsStore((s) => s.remove)

  const [collapsed, setCollapsed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SavedTunnel | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="shrink-0 border-t">
      <div className="flex items-center justify-between px-2 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          Tunnels
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          aria-label="New tunnel"
          title="New SSH tunnel / port forward"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {!collapsed && (
        <div className="max-h-40 overflow-y-auto px-1 pb-2">
          {saved.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              Forward a local port over SSH (DB, dashboard, SOCKS proxy).
            </p>
          ) : (
            <TooltipProvider delayDuration={400}>
              {saved.map((t) => {
                const st = status[t.id]
                const running = st?.running ?? false
                const dotClass = st?.error
                  ? 'bg-destructive'
                  : running
                    ? 'bg-emerald-400'
                    : 'bg-muted-foreground/40'
                return (
                  <div
                    key={t.id}
                    className="group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent/60"
                  >
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                      title={running ? 'Stop' : 'Start'}
                      aria-label={running ? `Stop ${describe(t)}` : `Start ${describe(t)}`}
                      onClick={() => void (running ? stop(t.id) : start(t.id))}
                    >
                      {running ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
                          <span className={cn('size-2 shrink-0 rounded-full', dotClass)} />
                          <span className="truncate">{t.name ?? describe(t)}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        <div className="font-mono">{describe(t)}</div>
                        {st?.error ? (
                          <div className="text-destructive">{st.error}</div>
                        ) : running ? (
                          <div className="text-muted-foreground">
                            {st?.connections ?? 0} conn · ↑{fmtBytes(st?.bytesUp ?? 0)} ↓
                            {fmtBytes(st?.bytesDown ?? 0)}
                          </div>
                        ) : (
                          <div className="text-muted-foreground">stopped</div>
                        )}
                      </TooltipContent>
                    </Tooltip>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
                      title="Edit"
                      onClick={() => {
                        setEditing(t)
                        setDialogOpen(true)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
                      title="Delete"
                      onClick={() => void remove(t.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )
              })}
            </TooltipProvider>
          )}
        </div>
      )}

      <TunnelDialog open={dialogOpen} onOpenChange={setDialogOpen} tunnel={editing} />
    </div>
  )
}
