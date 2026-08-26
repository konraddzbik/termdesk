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
import { useSettingsStore } from '@renderer/stores/settings'
import type { TerminalWorkspace, WorkspaceDir } from '@shared/ipc'
import { FolderOpen, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface WorkspaceDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Present when editing an existing workspace. */
  workspace?: TerminalWorkspace | null
}

type DirRow = { path: string; command: string }

/** Create or edit a terminal workspace: a name + directories (each with an
 *  optional command to auto-run, e.g. `claude`/`grok`) opened side by side. */
export function WorkspaceDialog({
  open,
  onOpenChange,
  workspace,
}: WorkspaceDialogProps): React.JSX.Element {
  const workspaces = useSettingsStore((s) => s.settings.terminalWorkspaces)
  const update = useSettingsStore((s) => s.update)

  const [name, setName] = useState('')
  const [dirs, setDirs] = useState<DirRow[]>([
    { path: '', command: '' },
    { path: '', command: '' },
  ])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(workspace?.name ?? '')
    setDirs(
      workspace && workspace.dirs.length > 0
        ? workspace.dirs.map((d) => ({ path: d.path, command: d.command ?? '' }))
        : [
            { path: '', command: '' },
            { path: '', command: '' },
          ],
    )
    setError(null)
  }, [open, workspace])

  function setRow(index: number, patch: Partial<DirRow>): void {
    setDirs((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }
  async function pick(index: number): Promise<void> {
    const picked = await window.api.localTerminals.pickDirectory()
    if (picked) setRow(index, { path: picked })
  }

  async function save(): Promise<void> {
    const cleanDirs: WorkspaceDir[] = dirs
      .filter((d) => d.path.trim().length > 0)
      .map((d) => ({ path: d.path.trim(), command: d.command.trim() || undefined }))
    const trimmedName = name.trim()
    if (!trimmedName) return setError('A name is required.')
    if (cleanDirs.length === 0) return setError('Add at least one directory.')
    const entry: TerminalWorkspace = {
      id: workspace?.id ?? crypto.randomUUID(),
      name: trimmedName,
      dirs: cleanDirs,
    }
    const next = workspace
      ? workspaces.map((w) => (w.id === workspace.id ? entry : w))
      : [...workspaces, entry]
    try {
      await update({ terminalWorkspaces: next })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby="workspace-desc">
        <DialogHeader>
          <DialogTitle>{workspace ? 'Edit workspace' : 'New workspace'}</DialogTitle>
          <DialogDescription id="workspace-desc">
            Opening it launches a local terminal in each directory (first two side by side). An
            optional command runs automatically when each shell connects — e.g. `claude` or `grok`.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. frontend + backend"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Directories</Label>
            {dirs.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional rows, reorder only on add/remove
              <div key={i} className="flex flex-col gap-1 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={row.path}
                    onChange={(e) => setRow(i, { path: e.target.value })}
                    placeholder="/Users/you/projects/app"
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => void pick(i)}
                    title="Browse…"
                  >
                    <FolderOpen className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDirs((prev) => prev.filter((_, j) => j !== i))}
                    disabled={dirs.length <= 1}
                    title="Remove"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <Input
                  value={row.command}
                  onChange={(e) => setRow(i, { command: e.target.value })}
                  placeholder="command to run on open (optional) — e.g. claude"
                  className="font-mono text-xs"
                />
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setDirs((prev) => [...prev, { path: '', command: '' }])}
            >
              <Plus className="size-4" /> Add directory
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>{workspace ? 'Save' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
