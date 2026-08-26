import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { previewCommand } from '@renderer/lib/command-preview'
import type { McpApprovalRequest } from '@shared/ipc'
import { ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Global modal that surfaces agent actions awaiting approval. Shows the exact
 * (redacted) command + host; Allow/Deny resolve the in-flight tool call.
 *
 * "Exact" is load-bearing: the main process sends the whole redacted command,
 * never a display slice, and `previewCommand` makes whitespace padding visible
 * so a payload cannot be hidden past the right edge or below the fold.
 */
export function McpApprovalDialog(): React.JSX.Element {
  const [queue, setQueue] = useState<McpApprovalRequest[]>([])

  useEffect(() => {
    return window.api.mcp.onApproval((ev) => {
      setQueue((q) => {
        if (ev.type === 'request') {
          return q.some((r) => r.id === ev.request.id) ? q : [...q, ev.request]
        }
        return q.filter((r) => r.id !== ev.request.id)
      })
    })
  }, [])

  const current = queue[0]
  const preview = current ? previewCommand(current.summary) : null

  const resolve = (approve: boolean): void => {
    if (!current) return
    void window.api.mcp.approve(current.id, approve)
    setQueue((q) => q.filter((r) => r.id !== current.id))
  }

  return (
    <Dialog open={Boolean(current)} onOpenChange={(open) => !open && resolve(false)}>
      <DialogContent className="sm:max-w-md" aria-describedby="mcp-approval-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-amber-400" />
            Approve AI action?
          </DialogTitle>
          <DialogDescription id="mcp-approval-desc">
            An AI agent{current?.client ? ` (${current.client})` : ''} wants to run a command
            {current?.hostLabel ? ` on ${current.hostLabel}` : ''}. Review it before allowing.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-64 overflow-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap break-words">
          {preview?.text}
        </pre>
        <p className="text-xs text-muted-foreground">
          {preview ? `${preview.chars} characters` : ''}
          {preview && preview.lines > 1 ? ` over ${preview.lines} lines` : ''}
          {preview?.collapsed ? ' · padding shown as ␣×n / ⏎×n' : ''}
          {preview ? ' · ' : ''}
          Secrets are redacted in this preview. Only allow commands you understand.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => resolve(false)}>
            Deny
          </Button>
          <Button onClick={() => resolve(true)}>Allow once</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
