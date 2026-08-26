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
import { lastTwoSegments } from '@renderer/lib/path-label'
import { useLocalTerminalsStore } from '@renderer/stores/localTerminals'
import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

interface LocalTerminalDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Present when editing an existing saved directory. */
  id?: string
  initialName?: string
  initialPath?: string
}

/** Create or edit a saved local-terminal directory (name optional, path required). */
export function LocalTerminalDialog({
  open,
  onOpenChange,
  id,
  initialName,
  initialPath,
}: LocalTerminalDialogProps): React.JSX.Element {
  const create = useLocalTerminalsStore((s) => s.create)
  const update = useLocalTerminalsStore((s) => s.update)

  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(initialName ?? '')
    setPath(initialPath ?? '')
    setError(null)
  }, [open, initialName, initialPath])

  async function browse(): Promise<void> {
    const picked = await window.api.localTerminals.pickDirectory()
    if (picked) setPath(picked)
  }

  async function save(): Promise<void> {
    const trimmedPath = path.trim()
    if (!trimmedPath) {
      setError('A directory path is required.')
      return
    }
    const input = { name: name.trim() || null, path: trimmedPath }
    try {
      if (id) await update(id, input)
      else await create(input)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="local-term-desc">
        <DialogHeader>
          <DialogTitle>{id ? 'Edit saved directory' : 'Save directory'}</DialogTitle>
          <DialogDescription id="local-term-desc">
            Clicking it later opens a local terminal in this directory.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="local-term-path">Directory</Label>
            <div className="flex items-center gap-2">
              <Input
                id="local-term-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/Users/you/projects/app"
                className="font-mono text-xs"
              />
              <Button variant="outline" size="icon" onClick={() => void browse()} title="Browse…">
                <FolderOpen className="size-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="local-term-name">Name (optional)</Label>
            <Input
              id="local-term-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={path ? lastTwoSegments(path) : 'Defaults to the last two folders'}
            />
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
          <Button onClick={() => void save()}>{id ? 'Save' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
