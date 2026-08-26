import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { usePromptsStore } from '@renderer/stores/prompts'
import { useRoutinesStore } from '@renderer/stores/routines'
import { AI_HARNESSES } from '@shared/ai-harnesses'
import type { Routine, RoutineInput, RoutineSchedule } from '@shared/ipc'
import { parseTemplateVars } from '@shared/template'
import { FolderOpen, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'

interface RoutineFormDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  routine?: Routine | null
}

export function RoutineFormDialog({
  open,
  onOpenChange,
  routine,
}: RoutineFormDialogProps): React.JSX.Element {
  const prompts = usePromptsStore((s) => s.prompts)
  const loadPrompts = usePromptsStore((s) => s.load)
  const createRoutine = useRoutinesStore((s) => s.create)
  const updateRoutine = useRoutinesStore((s) => s.update)
  const isEdit = routine != null

  const [name, setName] = useState('')
  const [promptId, setPromptId] = useState('')
  const [harnessId, setHarnessId] = useState('claude')
  const [cwd, setCwd] = useState('')
  const [autonomy, setAutonomy] = useState(false)
  const [scheduleKind, setScheduleKind] = useState<RoutineSchedule['kind']>('manual')
  const [everyMinutes, setEveryMinutes] = useState('60')
  const [hour, setHour] = useState('9')
  const [minute, setMinute] = useState('0')
  const [cronExpr, setCronExpr] = useState('0 9 * * *')
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) void loadPrompts()
  }, [open, loadPrompts])

  useEffect(() => {
    if (!open) return
    setName(routine?.name ?? '')
    setPromptId(routine?.promptId ?? '')
    setHarnessId(routine?.harnessId ?? 'claude')
    setCwd(routine?.cwd ?? '')
    setAutonomy(routine?.autonomy ?? false)
    const sched = routine?.schedule ?? { kind: 'manual' }
    setScheduleKind(sched.kind)
    if (sched.kind === 'interval') setEveryMinutes(String(sched.everyMinutes))
    if (sched.kind === 'daily') {
      setHour(String(sched.hour))
      setMinute(String(sched.minute))
    }
    if (sched.kind === 'cron') setCronExpr(sched.expr)
    setVariables(routine?.variables ?? {})
    setError(null)
    setSubmitting(false)
  }, [open, routine])

  const selectedPrompt = prompts.find((p) => p.id === promptId)
  const vars = useMemo(
    () => (selectedPrompt ? parseTemplateVars(selectedPrompt.body) : []),
    [selectedPrompt],
  )

  function buildSchedule(): RoutineSchedule {
    if (scheduleKind === 'interval') return { kind: 'interval', everyMinutes: Number(everyMinutes) }
    if (scheduleKind === 'daily')
      return { kind: 'daily', hour: Number(hour), minute: Number(minute) }
    if (scheduleKind === 'cron') return { kind: 'cron', expr: cronExpr.trim() }
    return { kind: 'manual' }
  }

  async function browse(): Promise<void> {
    const picked = await window.api.localTerminals.pickDirectory()
    if (picked) setCwd(picked)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!name.trim() || !promptId || !cwd.trim()) {
      setError('Name, prompt and directory are required')
      return
    }
    setSubmitting(true)
    try {
      const input: RoutineInput = {
        name: name.trim(),
        promptId,
        harnessId,
        cwd: cwd.trim(),
        mode: 'interactive',
        autonomy,
        schedule: buildSchedule(),
        // Only keep values for variables the selected prompt declares.
        variables: Object.fromEntries(
          vars.map((v) => [v.name, variables[v.name] ?? v.default ?? '']),
        ),
        enabled: true,
      }
      await (routine ? updateRoutine(routine.id, input) : createRoutine(input))
      onOpenChange(false)
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby="routine-form-description">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit routine' : 'New routine'}</DialogTitle>
          <DialogDescription id="routine-form-description">
            Run a prompt through an AI agent in a directory — on demand or on a schedule.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routine-name">Name</Label>
            <Input
              id="routine-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routine-prompt">Prompt</Label>
            <select
              id="routine-prompt"
              value={promptId}
              onChange={(e) => setPromptId(e.target.value)}
              className={selectClass}
            >
              <option value="">Choose a prompt…</option>
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routine-harness">Agent</Label>
            <select
              id="routine-harness"
              value={harnessId}
              onChange={(e) => setHarnessId(e.target.value)}
              className={selectClass}
            >
              {AI_HARNESSES.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Directory</Label>
            <div className="flex items-center gap-2">
              <Input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={() => void browse()}>
                <FolderOpen className="size-4" /> Browse
              </Button>
            </div>
          </div>

          {vars.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border p-2.5">
              <span className="text-xs text-muted-foreground">
                Variable values (used for every run — scheduled runs can't prompt)
              </span>
              {vars.map((v) => (
                <div key={v.name} className="flex flex-col gap-1">
                  <Label htmlFor={`rvar-${v.name}`} className="text-xs">
                    {v.name}
                  </Label>
                  <Input
                    id={`rvar-${v.name}`}
                    value={variables[v.name] ?? ''}
                    onChange={(e) =>
                      setVariables((prev) => ({ ...prev, [v.name]: e.target.value }))
                    }
                    placeholder={v.description ?? v.default ?? ''}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routine-schedule">Schedule</Label>
            <select
              id="routine-schedule"
              value={scheduleKind}
              onChange={(e) => setScheduleKind(e.target.value as RoutineSchedule['kind'])}
              className={selectClass}
            >
              <option value="manual">Manual (run on demand)</option>
              <option value="interval">Every N minutes</option>
              <option value="daily">Daily at a time</option>
              <option value="cron">Cron expression</option>
            </select>
            {scheduleKind === 'interval' && (
              <Input
                type="number"
                min={1}
                value={everyMinutes}
                onChange={(e) => setEveryMinutes(e.target.value)}
                aria-label="Every N minutes"
              />
            )}
            {scheduleKind === 'daily' && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={hour}
                  onChange={(e) => setHour(e.target.value)}
                  aria-label="Hour"
                  className="w-20"
                />
                <span className="text-sm">:</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={minute}
                  onChange={(e) => setMinute(e.target.value)}
                  aria-label="Minute"
                  className="w-20"
                />
              </div>
            )}
            {scheduleKind === 'cron' && (
              <Input
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                aria-label="Cron expression"
                placeholder="0 9 * * *"
              />
            )}
            <span className="text-xs text-muted-foreground">
              Scheduled runs fire while TermDesk is open (missed runs catch up on next launch).
            </span>
          </div>

          <label className="flex items-start gap-2 rounded-md border border-destructive/40 p-2.5 text-sm">
            <input
              type="checkbox"
              checked={autonomy}
              onChange={(e) => setAutonomy(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Run without approval prompts (autonomy)</span>
              <span className="block text-xs text-muted-foreground">
                Passes the agent's “skip permissions” flag so it can act unattended. Only enable for
                directories you fully trust — the agent can modify files and run commands on its
                own.
              </span>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isEdit ? 'Save changes' : 'Add routine'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
