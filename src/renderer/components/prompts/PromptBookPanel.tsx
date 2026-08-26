import { FillVariablesDialog } from '@renderer/components/prompts/FillVariablesDialog'
import { PromptFormDialog } from '@renderer/components/prompts/PromptFormDialog'
import { RunInAgentDialog } from '@renderer/components/prompts/RunInAgentDialog'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'
import { sendToActiveSession } from '@renderer/lib/send-to-session'
import { cn } from '@renderer/lib/utils'
import { usePromptsStore } from '@renderer/stores/prompts'
import { useSessionsStore } from '@renderer/stores/sessions'
import { useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'
import type { Prompt } from '@shared/ipc'
import { parseTemplateVars, renderTemplate } from '@shared/template'
import { Bot, Check, ChevronDown, ChevronRight, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
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

export function PromptBookPanel(): React.JSX.Element {
  const prompts = usePromptsStore((s) => s.prompts)
  const error = usePromptsStore((s) => s.error)
  const load = usePromptsStore((s) => s.load)
  const remove = usePromptsStore((s) => s.remove)

  // Subscribe to tab/session changes so "can run" stays reactive.
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const session = useSessionsStore((s) =>
    activeTabId != null ? s.sessions[activeTabId] : undefined,
  )
  const canRun =
    (activeTab?.kind === 'terminal' || activeTab?.kind === 'local-terminal') &&
    session?.status === 'connected'

  const [expanded, setExpanded] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Prompt | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [fillOpen, setFillOpen] = useState(false)
  const [running, setRunning] = useState<Prompt | null>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentPrompt, setAgentPrompt] = useState<Prompt | null>(null)

  // Lets the command palette ("New prompt") open the create dialog from anywhere.
  const promptCreateOpen = useUiStore((s) => s.promptCreateOpen)
  const setPromptCreateOpen = useUiStore((s) => s.setPromptCreateOpen)

  useEffect(() => {
    void load()
  }, [load])

  function openCreate(): void {
    setEditing(null)
    setFormOpen(true)
  }

  useEffect(() => {
    if (!promptCreateOpen) return
    setEditing(null)
    setFormOpen(true)
    setExpanded(true)
    setPromptCreateOpen(false)
  }, [promptCreateOpen, setPromptCreateOpen])

  function runPrompt(prompt: Prompt): void {
    // No variables → render and send immediately; otherwise collect values first.
    if (parseTemplateVars(prompt.body).length === 0) {
      sendToActiveSession(`${renderTemplate(prompt.body)}\n`)
      return
    }
    setRunning(prompt)
    setFillOpen(true)
  }

  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <section aria-label="Prompt Book" className="shrink-0 border-t">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="prompt-book-list"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left',
            'text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
            'transition-colors hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <Chevron className="size-3.5 shrink-0" aria-hidden="true" />
          Prompt Book
          {prompts.length > 0 && <span className="font-normal">({prompts.length})</span>}
        </button>
        <IconButton label="Add prompt" onClick={openCreate}>
          <Plus className="size-3.5" />
        </IconButton>
      </div>
      {expanded && (
        <div id="prompt-book-list">
          {error && (
            <p
              role="alert"
              title={error}
              className="truncate px-3 pb-1 text-[10px] text-destructive"
            >
              {error}
            </p>
          )}
          {prompts.length === 0 ? (
            <p className="px-3 pb-2 text-xs text-muted-foreground/70">No prompts yet</p>
          ) : (
            <ScrollArea className="max-h-48">
              <TooltipProvider delayDuration={200}>
                <ul className="flex flex-col gap-px px-1 pb-2">
                  {prompts.map((prompt) => (
                    <li
                      key={prompt.id}
                      className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm leading-tight">{prompt.title}</p>
                        <p className="truncate font-mono text-[11px] leading-tight text-muted-foreground">
                          {prompt.body}
                        </p>
                      </div>
                      <div
                        className={cn(
                          'shrink-0 items-center gap-0.5',
                          confirmingId === prompt.id
                            ? 'flex'
                            : 'hidden group-focus-within:flex group-hover:flex',
                        )}
                      >
                        {confirmingId === prompt.id ? (
                          <>
                            <span className="text-xs text-destructive">Delete?</span>
                            <IconButton
                              label={`Confirm delete ${prompt.title}`}
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                setConfirmingId(null)
                                void remove(prompt.id)
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
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <IconButton
                                    label={`Run ${prompt.title}`}
                                    disabled={!canRun}
                                    onClick={() => runPrompt(prompt)}
                                  >
                                    <Play className="size-3.5" />
                                  </IconButton>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {canRun ? 'Send to active terminal' : 'No connected terminal'}
                              </TooltipContent>
                            </Tooltip>
                            <IconButton
                              label={`Run ${prompt.title} in an agent`}
                              onClick={() => {
                                setAgentPrompt(prompt)
                                setAgentOpen(true)
                              }}
                            >
                              <Bot className="size-3.5" />
                            </IconButton>
                            <IconButton
                              label={`Edit ${prompt.title}`}
                              onClick={() => {
                                setEditing(prompt)
                                setFormOpen(true)
                              }}
                            >
                              <Pencil className="size-3.5" />
                            </IconButton>
                            <IconButton
                              label={`Delete ${prompt.title}`}
                              onClick={() => setConfirmingId(prompt.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </TooltipProvider>
            </ScrollArea>
          )}
        </div>
      )}
      <PromptFormDialog open={formOpen} onOpenChange={setFormOpen} prompt={editing} />
      <FillVariablesDialog
        open={fillOpen}
        onOpenChange={setFillOpen}
        prompt={running}
        confirmLabel="Send"
        onSubmit={(rendered) => sendToActiveSession(`${rendered}\n`)}
      />
      <RunInAgentDialog open={agentOpen} onOpenChange={setAgentOpen} prompt={agentPrompt} />
    </section>
  )
}
