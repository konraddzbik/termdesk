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
import type { Prompt } from '@shared/ipc'
import { parseTemplateVars, renderTemplate } from '@shared/template'
import { useEffect, useMemo, useState } from 'react'

interface FillVariablesDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  prompt: Prompt | null
  /** Called with the fully rendered prompt text when the user confirms. */
  onSubmit(rendered: string): void
  /** Verb for the confirm button (e.g. "Send", "Run"). */
  confirmLabel?: string
}

/**
 * Collects values for a prompt's `{{variables}}` and renders the final text.
 * When a prompt has no variables the caller can skip this dialog entirely; it
 * still renders correctly (empty form → the body verbatim).
 */
export function FillVariablesDialog({
  open,
  onOpenChange,
  prompt,
  onSubmit,
  confirmLabel = 'Send',
}: FillVariablesDialogProps): React.JSX.Element {
  const vars = useMemo(() => (prompt ? parseTemplateVars(prompt.body) : []), [prompt])
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    // Seed each field with its declared default.
    const seed: Record<string, string> = {}
    for (const v of vars) seed[v.name] = v.default ?? ''
    setValues(seed)
  }, [open, vars])

  const preview = useMemo(
    () => (prompt ? renderTemplate(prompt.body, values) : ''),
    [prompt, values],
  )

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    onSubmit(preview)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby="fill-vars-description">
        <DialogHeader>
          <DialogTitle>Fill in “{prompt?.title ?? 'prompt'}”</DialogTitle>
          <DialogDescription id="fill-vars-description">
            Provide values for this prompt's variables, then {confirmLabel.toLowerCase()} it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {vars.length === 0 ? (
            <p className="text-sm text-muted-foreground">This prompt has no variables.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {vars.map((v) => (
                <div key={v.name} className="flex flex-col gap-1.5">
                  <Label htmlFor={`var-${v.name}`}>{v.name}</Label>
                  <Input
                    id={`var-${v.name}`}
                    value={values[v.name] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                    placeholder={v.description ?? v.default ?? ''}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Preview</Label>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-mono text-xs">
              {preview}
            </pre>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
