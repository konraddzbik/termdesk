import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip'
import { openLocalTerminalsSideBySide } from '@renderer/lib/local-terminal'
import { cn } from '@renderer/lib/utils'
import { useSettingsStore } from '@renderer/stores/settings'
import type { TerminalWorkspace } from '@shared/ipc'
import { ChevronDown, ChevronRight, Columns2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { WorkspaceDialog } from './WorkspaceDialog'

export function WorkspacesPanel(): React.JSX.Element {
  const workspaces = useSettingsStore((s) => s.settings.terminalWorkspaces)
  const update = useSettingsStore((s) => s.update)

  const [collapsed, setCollapsed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TerminalWorkspace | null>(null)

  function openAdd(): void {
    setEditing(null)
    setDialogOpen(true)
  }
  function openEdit(ws: TerminalWorkspace): void {
    setEditing(ws)
    setDialogOpen(true)
  }
  function remove(id: string): void {
    void update({ terminalWorkspaces: workspaces.filter((w) => w.id !== id) })
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
          Workspaces
        </button>
        <button
          type="button"
          onClick={openAdd}
          aria-label="New workspace"
          title="New workspace"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {!collapsed && (
        <div className="max-h-40 overflow-y-auto px-1 pb-2">
          {workspaces.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              Save a set of directories to open them side by side in one click.
            </p>
          ) : (
            <TooltipProvider delayDuration={400}>
              {workspaces.map((ws) => (
                <div
                  key={ws.id}
                  className="group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent/60"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                        onClick={() => openLocalTerminalsSideBySide(ws.dirs)}
                      >
                        <Columns2 className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{ws.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {ws.dirs.length}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-80 font-mono text-xs">
                      {ws.dirs
                        .map((d) => (d.command ? `${d.path} → ${d.command}` : d.path))
                        .join('  ·  ')}
                    </TooltipContent>
                  </Tooltip>
                  <button
                    type="button"
                    className={cn(
                      'rounded p-0.5 text-muted-foreground hover:text-foreground',
                      'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                    )}
                    title="Edit"
                    onClick={() => openEdit(ws)}
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
                    onClick={() => remove(ws.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </TooltipProvider>
          )}
        </div>
      )}

      <WorkspaceDialog open={dialogOpen} onOpenChange={setDialogOpen} workspace={editing} />
    </div>
  )
}
