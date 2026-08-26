import { SnippetFormDialog } from '@renderer/components/snippets/SnippetFormDialog'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useSessionsStore } from '@renderer/stores/sessions'
import { useSnippetsStore } from '@renderer/stores/snippets'
import { useTabsStore } from '@renderer/stores/tabs'
import type { Snippet } from '@shared/ipc'
import { Check, ChevronDown, ChevronRight, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
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

interface SnippetRowProps {
  snippet: Snippet
  canRun: boolean
  confirming: boolean
  onRun(): void
  onEdit(): void
  onDeleteRequest(): void
  onDeleteConfirm(): void
  onDeleteCancel(): void
}

function SnippetRow({
  snippet,
  canRun,
  confirming,
  onRun,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: SnippetRowProps): React.JSX.Element {
  return (
    <li className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/60">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-tight">{snippet.name}</p>
        <p className="truncate font-mono text-[11px] leading-tight text-muted-foreground">
          {snippet.command}
        </p>
      </div>
      <div
        className={cn(
          'shrink-0 items-center gap-0.5',
          confirming ? 'flex' : 'hidden group-focus-within:flex group-hover:flex',
        )}
      >
        {confirming ? (
          <>
            <span className="text-xs text-destructive">Delete?</span>
            <IconButton
              label={`Confirm delete ${snippet.name}`}
              className="text-destructive hover:text-destructive"
              onClick={onDeleteConfirm}
            >
              <Check className="size-3.5" />
            </IconButton>
            <IconButton label="Cancel delete" onClick={onDeleteCancel}>
              <X className="size-3.5" />
            </IconButton>
          </>
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* span keeps the tooltip working while the button is disabled */}
                <span>
                  <IconButton label={`Run ${snippet.name}`} disabled={!canRun} onClick={onRun}>
                    <Play className="size-3.5" />
                  </IconButton>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {canRun ? 'Run in active terminal' : 'No connected terminal'}
              </TooltipContent>
            </Tooltip>
            <IconButton label={`Edit ${snippet.name}`} onClick={onEdit}>
              <Pencil className="size-3.5" />
            </IconButton>
            <IconButton label={`Delete ${snippet.name}`} onClick={onDeleteRequest}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </>
        )}
      </div>
    </li>
  )
}

export function SnippetsPanel(): React.JSX.Element {
  const snippets = useSnippetsStore((s) => s.snippets)
  const error = useSnippetsStore((s) => s.error)
  const load = useSnippetsStore((s) => s.load)
  const remove = useSnippetsStore((s) => s.remove)

  const activeTabId = useTabsStore((s) => s.activeTabId)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const session = useSessionsStore((s) =>
    activeTabId != null ? s.sessions[activeTabId] : undefined,
  )

  const activeSessionId =
    activeTab?.kind === 'terminal' && session?.status === 'connected' ? session.sessionId : null
  const canRun = activeSessionId != null

  const [expanded, setExpanded] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  function openCreate(): void {
    setEditingSnippet(null)
    setDialogOpen(true)
  }

  function openEdit(snippet: Snippet): void {
    setEditingSnippet(snippet)
    setDialogOpen(true)
  }

  function runSnippet(snippet: Snippet): void {
    if (activeSessionId == null) return
    window.api.ssh.write(activeSessionId, `${snippet.command}\n`)
  }

  async function confirmDelete(id: string): Promise<void> {
    setConfirmingId(null)
    await remove(id)
  }

  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <section aria-label="Snippets" className="shrink-0 border-t">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="snippets-list"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left',
            'text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
            'transition-colors hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <Chevron className="size-3.5 shrink-0" aria-hidden="true" />
          Snippets
          {snippets.length > 0 && <span className="font-normal">({snippets.length})</span>}
        </button>
        <IconButton label="Add snippet" onClick={openCreate}>
          <Plus className="size-3.5" />
        </IconButton>
      </div>
      {expanded && (
        <div id="snippets-list">
          {error && (
            <p
              role="alert"
              title={error}
              className="truncate px-3 pb-1 text-[10px] text-destructive"
            >
              {error}
            </p>
          )}
          {snippets.length === 0 ? (
            <p className="px-3 pb-2 text-xs text-muted-foreground/70">No snippets yet</p>
          ) : (
            <ScrollArea className="max-h-48">
              <TooltipProvider delayDuration={200}>
                <ul className="flex flex-col gap-px px-1 pb-2">
                  {snippets.map((snippet) => (
                    <SnippetRow
                      key={snippet.id}
                      snippet={snippet}
                      canRun={canRun}
                      confirming={confirmingId === snippet.id}
                      onRun={() => runSnippet(snippet)}
                      onEdit={() => openEdit(snippet)}
                      onDeleteRequest={() => setConfirmingId(snippet.id)}
                      onDeleteConfirm={() => void confirmDelete(snippet.id)}
                      onDeleteCancel={() => setConfirmingId(null)}
                    />
                  ))}
                </ul>
              </TooltipProvider>
            </ScrollArea>
          )}
        </div>
      )}
      <SnippetFormDialog open={dialogOpen} onOpenChange={setDialogOpen} snippet={editingSnippet} />
    </section>
  )
}
