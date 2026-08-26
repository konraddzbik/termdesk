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
import { usePromptsStore } from '@renderer/stores/prompts'
import type { Prompt } from '@shared/ipc'
import { parseTemplateVars } from '@shared/template'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

interface PromptFormDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Prompt being edited; null/undefined means create mode. */
  prompt?: Prompt | null
}

const textareaClass = cn(
  'w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
)

export function PromptFormDialog({
  open,
  onOpenChange,
  prompt,
}: PromptFormDialogProps): React.JSX.Element {
  const createPrompt = usePromptsStore((s) => s.create)
  const updatePrompt = usePromptsStore((s) => s.update)
  const isEdit = prompt != null

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(prompt?.title ?? '')
    setBody(prompt?.body ?? '')
    setDescription(prompt?.description ?? '')
    setTags((prompt?.tags ?? []).join(', '))
    setErrors({})
    setFormError(null)
    setSubmitting(false)
  }, [open, prompt])

  // Live preview of the variables the template declares.
  const vars = useMemo(() => parseTemplateVars(body), [body])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const next: { title?: string; body?: string } = {}
    if (!title.trim()) next.title = 'Title is required'
    if (!body.trim()) next.body = 'Prompt body is required'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      const input = {
        title: title.trim(),
        body,
        description: description.trim() || null,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== ''),
      }
      await (prompt ? updatePrompt(prompt.id, input) : createPrompt(input))
      onOpenChange(false)
    } catch (err) {
      setFormError(toMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby="prompt-form-description">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit prompt' : 'New prompt'}</DialogTitle>
          <DialogDescription id="prompt-form-description">
            A reusable prompt. Use <code>{'{{variable}}'}</code> placeholders (optionally{' '}
            <code>{'{{name:default}}'}</code>) and fill them in when you run it. Avoid putting
            secrets in prompts.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prompt-title">Title</Label>
            <Input
              id="prompt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Review the diff"
              aria-invalid={errors.title ? true : undefined}
              autoFocus
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prompt-body">Prompt</Label>
            <textarea
              id="prompt-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'Review the changes in {{path:.}} and list risks.'}
              rows={6}
              className={textareaClass}
              aria-invalid={errors.body ? true : undefined}
            />
            {errors.body && <p className="text-xs text-destructive">{errors.body}</p>}
            {vars.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Variables: {vars.map((v) => v.name).join(', ')}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prompt-description">Description (optional)</Label>
            <Input
              id="prompt-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When to use this prompt"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prompt-tags">Tags (optional, comma-separated)</Label>
            <Input
              id="prompt-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="review, ci"
            />
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
              {isEdit ? 'Save changes' : 'Add prompt'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
