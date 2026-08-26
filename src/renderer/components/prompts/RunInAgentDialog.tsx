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
import { openLocalTerminalTab } from '@renderer/lib/local-terminal'
import { cn } from '@renderer/lib/utils'
import { useSettingsStore } from '@renderer/stores/settings'
import { AI_HARNESSES, composeInteractiveCommand, findHarness } from '@shared/ai-harnesses'
import type { Prompt } from '@shared/ipc'
import { parseTemplateVars, renderTemplate } from '@shared/template'
import { FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

interface RunInAgentDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  prompt: Prompt | null
}

/**
 * Runs a prompt through an AI harness in a chosen directory: pick harness +
 * folder, fill any variables, then open a local terminal there whose
 * `runOnOpen` is the composed (POSIX-quoted) harness command. Interactive and
 * visible — the agent runs in a terminal the user can watch and stop. Autonomy
 * (auto-approve flags) is NOT enabled here; that's a Routines opt-in.
 */
export function RunInAgentDialog({
  open,
  onOpenChange,
  prompt,
}: RunInAgentDialogProps): React.JSX.Element {
  const defaultHarnessId = useSettingsStore((s) => s.settings.defaultHarnessId)
  const vars = useMemo(() => (prompt ? parseTemplateVars(prompt.body) : []), [prompt])

  const [harnessId, setHarnessId] = useState('claude')
  const [values, setValues] = useState<Record<string, string>>({})
  const [cwd, setCwd] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setHarnessId(defaultHarnessId || prompt?.defaultHarnessId || 'claude')
    const seed: Record<string, string> = {}
    for (const v of vars) seed[v.name] = v.default ?? ''
    setValues(seed)
    setCwd(null)
  }, [open, vars, defaultHarnessId, prompt])

  const harness = findHarness(harnessId) ?? findHarness('claude')
  const rendered = prompt ? renderTemplate(prompt.body, values) : ''
  const command = harness ? composeInteractiveCommand(harness, rendered) : ''

  async function browse(): Promise<void> {
    const picked = await window.api.localTerminals.pickDirectory()
    if (picked) setCwd(picked)
  }

  function handleRun(): void {
    if (!cwd || !harness) return
    openLocalTerminalTab({ cwd, runOnOpen: command })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby="run-agent-description">
        <DialogHeader>
          <DialogTitle>Run “{prompt?.title ?? 'prompt'}” in an agent</DialogTitle>
          <DialogDescription id="run-agent-description">
            Opens a local terminal in the chosen directory and runs your prompt through the selected
            agent. It runs interactively — you can watch and stop it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-harness">Agent</Label>
            <select
              id="agent-harness"
              value={harnessId}
              onChange={(e) => setHarnessId(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {AI_HARNESSES.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>

          {vars.map((v) => (
            <div key={v.name} className="flex flex-col gap-1.5">
              <Label htmlFor={`agent-var-${v.name}`}>{v.name}</Label>
              <Input
                id={`agent-var-${v.name}`}
                value={values[v.name] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                placeholder={v.description ?? v.default ?? ''}
              />
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <Label>Directory</Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={cwd ?? ''}
                placeholder="Choose a directory…"
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={() => void browse()}>
                <FolderOpen className="size-4" /> Browse
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Command</Label>
            <pre
              className={cn(
                'max-h-32 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-mono text-xs',
              )}
            >
              {command}
            </pre>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!cwd} onClick={handleRun}>
            Run in agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
