import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'
import { openOrFocusLocalTerminalTab } from '@renderer/lib/local-terminal'
import { lastTwoSegments } from '@renderer/lib/path-label'
import { cn } from '@renderer/lib/utils'
import { useLocalTerminalsStore } from '@renderer/stores/localTerminals'
import type { SavedLocalTerminal } from '@shared/ipc'
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Pencil,
  Plus,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { LocalTerminalDialog } from './LocalTerminalDialog'

export function LocalTerminalsPanel(): React.JSX.Element {
  const saved = useLocalTerminalsStore((s) => s.saved)
  const load = useLocalTerminalsStore((s) => s.load)
  const remove = useLocalTerminalsStore((s) => s.remove)
  const move = useLocalTerminalsStore((s) => s.move)

  const [collapsed, setCollapsed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SavedLocalTerminal | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  function openAdd(): void {
    setEditing(null)
    setDialogOpen(true)
  }
  function openEdit(entry: SavedLocalTerminal): void {
    setEditing(entry)
    setDialogOpen(true)
  }

  return (
    <div className="shrink-0 border-t">
      <div className="flex items-center justify-between px-2 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          Local terminals
        </button>
        <button
          type="button"
          onClick={openAdd}
          aria-label="Save a directory"
          title="Save a directory"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {!collapsed && (
        <div className="max-h-40 overflow-y-auto px-1 pb-2">
          {saved.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              Save a terminal's directory to reopen it here.
            </p>
          ) : (
            <TooltipProvider delayDuration={400}>
              {saved.map((entry, index) => (
                <div
                  key={entry.id}
                  className="group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent/60"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                        onClick={() =>
                          openOrFocusLocalTerminalTab({
                            cwd: entry.path,
                            title: entry.name ?? lastTwoSegments(entry.path),
                          })
                        }
                      >
                        <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {entry.name ?? lastTwoSegments(entry.path)}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="font-mono text-xs">{entry.path}</TooltipContent>
                  </Tooltip>
                  <button
                    type="button"
                    className={cn(
                      'rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground',
                      'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                    )}
                    title="Move up"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => void move(entry.id, -1)}
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground',
                      'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                    )}
                    title="Move down"
                    aria-label="Move down"
                    disabled={index === saved.length - 1}
                    onClick={() => void move(entry.id, 1)}
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded p-0.5 text-muted-foreground hover:text-foreground',
                      'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                    )}
                    title="Edit"
                    onClick={() => openEdit(entry)}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded p-0.5 text-muted-foreground hover:text-destructive',
                      'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                    )}
                    title="Delete"
                    onClick={() => void remove(entry.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </TooltipProvider>
          )}
        </div>
      )}

      <LocalTerminalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        id={editing?.id}
        initialName={editing?.name ?? undefined}
        initialPath={editing?.path}
      />
    </div>
  )
}
