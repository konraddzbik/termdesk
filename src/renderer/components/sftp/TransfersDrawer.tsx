import { Button } from '@renderer/components/ui/button'
import { formatBytes, formatEta, formatRate } from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'
import { initTransfersSubscription, useTransfersStore } from '@renderer/stores/transfers'
import type { Transfer } from '@shared/ipc'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'

/** Bottom drawer with per-transfer and aggregate progress. */
export function TransfersDrawer(): React.JSX.Element | null {
  const transfers = useTransfersStore((s) => s.transfers)
  const order = useTransfersStore((s) => s.order)
  const clearFinished = useTransfersStore((s) => s.clearFinished)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => initTransfersSubscription(), [])

  const items = order.map((id) => transfers[id]).filter((t): t is Transfer => t !== undefined)
  if (items.length === 0) return null

  const activeOrQueued = items.filter((t) => t.status === 'active' || t.status === 'queued')
  const totalKnown = items.filter((t) => t.totalBytes !== null)
  const aggregateTotal = totalKnown.reduce((sum, t) => sum + (t.totalBytes ?? 0), 0)
  const aggregateDone = totalKnown.reduce(
    (sum, t) => sum + Math.min(t.doneBytes, t.totalBytes ?? t.doneBytes),
    0,
  )
  const aggregatePct = aggregateTotal > 0 ? Math.round((aggregateDone / aggregateTotal) * 100) : 0

  return (
    <div className="shrink-0 border-t bg-card/60">
      <div className="flex h-8 items-center gap-3 px-3 text-xs">
        <button
          type="button"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          Transfers
        </button>
        <span className="text-muted-foreground">
          {activeOrQueued.length > 0
            ? `${activeOrQueued.length} in progress — ${aggregatePct}% of ${formatBytes(aggregateTotal)}`
            : 'all finished'}
        </span>
        <div className="h-1.5 w-40 overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${aggregatePct}%` }} />
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clearFinished}>
          <Trash2 className="size-3" /> Clear finished
        </Button>
      </div>
      {!collapsed && (
        <div className="max-h-44 overflow-auto border-t">
          {items.map((t) => (
            <TransferRow key={t.id} transfer={t} />
          ))}
        </div>
      )}
    </div>
  )
}

function TransferRow({ transfer }: { transfer: Transfer }): React.JSX.Element {
  const pct =
    transfer.totalBytes !== null && transfer.totalBytes > 0
      ? Math.min(100, Math.round((transfer.doneBytes / transfer.totalBytes) * 100))
      : null

  return (
    <div className="flex items-center gap-3 border-b border-border/40 px-3 py-1.5 text-xs">
      {transfer.kind === 'upload' ? (
        <ArrowUpFromLine className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ArrowDownToLine className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="w-48 truncate" title={transfer.remotePath}>
        {transfer.label}
      </span>
      <div className="h-1.5 w-36 shrink-0 overflow-hidden rounded bg-muted">
        <div
          className={cn(
            'h-full transition-all',
            transfer.status === 'error'
              ? 'bg-destructive'
              : transfer.status === 'done'
                ? 'bg-green-500'
                : 'bg-primary',
          )}
          style={{ width: `${pct ?? (transfer.status === 'done' ? 100 : 0)}%` }}
        />
      </div>
      <span className="w-40 shrink-0 text-muted-foreground">
        {transfer.status === 'active' && (
          <>
            {formatBytes(transfer.doneBytes)}
            {transfer.totalBytes !== null && <> / {formatBytes(transfer.totalBytes)}</>}
            {transfer.rate > 0 && <> · {formatRate(transfer.rate)}</>}
          </>
        )}
        {transfer.status === 'queued' && 'queued'}
        {transfer.status === 'done' && `done · ${formatBytes(transfer.doneBytes)}`}
        {transfer.status === 'cancelled' && 'cancelled'}
        {transfer.status === 'error' && (
          <span className="text-destructive" title={transfer.error}>
            {transfer.error ?? 'failed'}
          </span>
        )}
      </span>
      <span className="w-16 shrink-0 text-muted-foreground">
        {transfer.status === 'active' && transfer.etaSec !== null && formatEta(transfer.etaSec)}
      </span>
      <div className="flex flex-1 items-center justify-end gap-1">
        {(transfer.status === 'error' || transfer.status === 'cancelled') && (
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => void window.api.sftp.retryTransfer(transfer.id)}
            aria-label={`Retry ${transfer.label}`}
            title="Retry"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
        {(transfer.status === 'active' || transfer.status === 'queued') && (
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => void window.api.sftp.cancelTransfer(transfer.id)}
            aria-label={`Cancel ${transfer.label}`}
            title="Cancel"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
