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
import { cn } from '@renderer/lib/utils'
import { useSnippetsStore } from '@renderer/stores/snippets'
import type { Snippet } from '@shared/ipc'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

/** Strips Electron IPC wrapper prefix from error messages. */
function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

interface SnippetFormDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Snippet being edited; null/undefined means create mode. */
  snippet?: Snippet | null
}

export function SnippetFormDialog({
  open,
  onOpenChange,
  snippet,
}: SnippetFormDialogProps): React.JSX.Element {
  const createSnippet = useSnippetsStore((s) => s.create)
  const updateSnippet = useSnippetsStore((s) => s.update)
  const isEdit = snippet != null

  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [errors, setErrors] = useState<{ name?: string; command?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Reset the form every time the dialog opens.
  useEffect(() => {
    if (!open) return
    setName(snippet?.name ?? '')
    setCommand(snippet?.command ?? '')
    setErrors({})
    setFormError(null)
    setSubmitting(false)
  }, [open, snippet])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const next: { name?: string; command?: string } = {}
    if (!name.trim()) next.name = 'Name is required'
    if (!command.trim()) next.command = 'Command is required'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      const input = { name: name.trim(), command: command.trim() }
      await (snippet ? updateSnippet(snippet.id, input) : createSnippet(input))
      onOpenChange(false)
    } catch (err) {
      setFormError(toMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="snippet-form-description">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit snippet' : 'Add snippet'}</DialogTitle>
          <DialogDescription id="snippet-form-description">
            A reusable command you can run in the active terminal with one click.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snippet-name">Name</Label>
            <Input
              id="snippet-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tail syslog"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'snippet-name-error' : undefined}
              autoFocus
            />
            {errors.name && (
              <p id="snippet-name-error" className="text-xs text-destructive">
                {errors.name}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snippet-command">Command</Label>
            <textarea
              id="snippet-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="tail -f /var/log/syslog"
              rows={4}
              className={cn(
                'w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
                'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
              )}
              aria-invalid={errors.command ? true : undefined}
              aria-describedby={errors.command ? 'snippet-command-error' : undefined}
            />
            {errors.command && (
              <p id="snippet-command-error" className="text-xs text-destructive">
                {errors.command}
              </p>
            )}
          </div>
          {formError && (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isEdit ? 'Save changes' : 'Add snippet'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
