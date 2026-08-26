import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import type { Routine, RoutineRun } from '@shared/ipc'
import { useEffect, useState } from 'react'

interface RunHistoryDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  routine: Routine | null
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleString()
}

export function RunHistoryDialog({
  open,
  onOpenChange,
  routine,
}: RunHistoryDialogProps): React.JSX.Element {
  const [runs, setRuns] = useState<RoutineRun[]>([])

  useEffect(() => {
    if (!open || !routine) return
    let cancelled = false
    void window.api.routines.listRuns(routine.id).then((list) => {
      if (!cancelled) setRuns(list)
    })
    return () => {
      cancelled = true
    }
  }, [open, routine])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby="run-history-description">
        <DialogHeader>
          <DialogTitle>Run history — {routine?.name ?? ''}</DialogTitle>
          <DialogDescription id="run-history-description">
            Recent executions of this routine (metadata only; secrets redacted).
          </DialogDescription>
        </DialogHeader>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {runs.map((run) => (
              <li key={run.id} className="rounded-md border px-2.5 py-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">{run.status}</span>
                  <span className="text-xs text-muted-foreground">{fmt(run.startedAt)}</span>
                </div>
                {run.summary && (
                  <p
                    className="truncate font-mono text-[11px] text-muted-foreground"
                    title={run.summary}
                  >
                    {run.summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
