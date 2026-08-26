import { RoutineFormDialog } from '@renderer/components/routines/RoutineFormDialog'
import { RunHistoryDialog } from '@renderer/components/routines/RunHistoryDialog'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { runRoutineInteractive } from '@renderer/lib/run-routine'
import { cn } from '@renderer/lib/utils'
import { usePromptsStore } from '@renderer/stores/prompts'
import { useRoutinesStore } from '@renderer/stores/routines'
import type { Routine, RoutineSchedule } from '@shared/ipc'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'

function IconButton({
  label,
  className,
  ...props
}: React.ComponentProps<'button'> & { label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function scheduleLabel(s: RoutineSchedule): string {
  switch (s.kind) {
    case 'interval':
      return `every ${s.everyMinutes}m`
    case 'daily':
      return `daily ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
    case 'cron':
      return `cron: ${s.expr}`
    default:
      return 'manual'
  }
}

export function RoutinesPanel(): React.JSX.Element {
  const routines = useRoutinesStore((s) => s.routines)
  const error = useRoutinesStore((s) => s.error)
  const load = useRoutinesStore((s) => s.load)
  const remove = useRoutinesStore((s) => s.remove)
  const markRan = useRoutinesStore((s) => s.markRan)
  const prompts = usePromptsStore((s) => s.prompts)
  const loadPrompts = usePromptsStore((s) => s.load)

  const [expanded, setExpanded] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Routine | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRoutine, setHistoryRoutine] = useState<Routine | null>(null)

  useEffect(() => {
    void load()
    void loadPrompts()
  }, [load, loadPrompts])

  function runNow(routine: Routine): void {
    const prompt = prompts.find((p) => p.id === routine.promptId)
    if (!prompt) return
    runRoutineInteractive(routine, prompt)
    markRan(routine.id, Date.now())
  }

  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <section aria-label="Routines" className="shrink-0 border-t">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="routines-list"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left',
            'text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
            'transition-colors hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <Chevron className="size-3.5 shrink-0" aria-hidden="true" />
          Routines
          {routines.length > 0 && <span className="font-normal">({routines.length})</span>}
        </button>
        <IconButton
          label="Add routine"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <Plus className="size-3.5" />
        </IconButton>
      </div>
      {expanded && (
        <div id="routines-list">
          {error && (
            <p
              role="alert"
              title={error}
              className="truncate px-3 pb-1 text-[10px] text-destructive"
            >
              {error}
            </p>
          )}
          {routines.length === 0 ? (
            <p className="px-3 pb-2 text-xs text-muted-foreground/70">No routines yet</p>
          ) : (
            <ScrollArea className="max-h-48">
              <ul className="flex flex-col gap-px px-1 pb-2">
                {routines.map((routine) => (
                  <li
                    key={routine.id}
                    className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm leading-tight">{routine.name}</p>
                      <p className="flex items-center gap-1 truncate text-[11px] leading-tight text-muted-foreground">
                        <Clock className="size-3" aria-hidden="true" />
                        {scheduleLabel(routine.schedule)}
                        {routine.autonomy && <span className="text-destructive">· autonomy</span>}
                      </p>
                    </div>
                    <div
                      className={cn(
                        'shrink-0 items-center gap-0.5',
                        confirmingId === routine.id
                          ? 'flex'
                          : 'hidden group-focus-within:flex group-hover:flex',
                      )}
                    >
                      {confirmingId === routine.id ? (
                        <>
                          <span className="text-xs text-destructive">Delete?</span>
                          <IconButton
                            label={`Confirm delete ${routine.name}`}
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              setConfirmingId(null)
                              void remove(routine.id)
                            }}
                          >
                            <Check className="size-3.5" />
                          </IconButton>
                          <IconButton label="Cancel delete" onClick={() => setConfirmingId(null)}>
                            <X className="size-3.5" />
                          </IconButton>
                        </>
                      ) : (
                        <>
                          <IconButton
                            label={`Run ${routine.name} now`}
                            onClick={() => runNow(routine)}
                          >
                            <Play className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label={`History for ${routine.name}`}
                            onClick={() => {
                              setHistoryRoutine(routine)
                              setHistoryOpen(true)
                            }}
                          >
                            <History className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label={`Edit ${routine.name}`}
                            onClick={() => {
                              setEditing(routine)
                              setFormOpen(true)
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label={`Delete ${routine.name}`}
                            onClick={() => setConfirmingId(routine.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </IconButton>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
      )}
      <RoutineFormDialog open={formOpen} onOpenChange={setFormOpen} routine={editing} />
      <RunHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} routine={historyRoutine} />
    </section>
  )
}
