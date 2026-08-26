import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import type { HostKeyPrompt } from '@shared/ipc'
import { ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Singleton dialog (mounted once in AppLayout) that surfaces host-key
 * approval prompts pushed from main. Prompts queue up and are answered
 * one at a time; the dialog cannot be dismissed without an explicit
 * Reject/Accept choice.
 */
export function HostKeyDialog(): React.JSX.Element {
  const [queue, setQueue] = useState<HostKeyPrompt[]>([])
  const [responding, setResponding] = useState(false)

  useEffect(() => {
    return window.api.ssh.onHostKeyPrompt((prompt) => {
      setQueue((prev) =>
        prev.some((p) => p.requestId === prompt.requestId) ? prev : [...prev, prompt],
      )
    })
  }, [])

  const current = queue[0]
  // A key on an already-known host that we've never trusted here — treat as a
  // possible MITM downgrade and warn loudly, not as a routine first contact.
  const danger = current?.previouslyKnown === true

  async function respond(accept: boolean): Promise<void> {
    if (!current || responding) return
    setResponding(true)
    try {
      await window.api.ssh.respondHostKey(current.requestId, accept)
    } finally {
      setQueue((prev) => prev.slice(1))
      setResponding(false)
    }
  }

  return (
    <Dialog open={current != null}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        aria-describedby="hostkey-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert
              className={danger ? 'size-5 text-destructive' : 'size-5 text-amber-500'}
              aria-hidden="true"
            />
            {danger ? 'Warning: host key not recognized' : 'Unknown host key'}
          </DialogTitle>
          <DialogDescription id="hostkey-description">
            {danger
              ? "You've connected to this host before, but it just presented a key you've never trusted here. This can happen if the server legitimately added a new key — or if someone is intercepting the connection (man-in-the-middle). Do not accept unless you can confirm this change out of band."
              : "The authenticity of this host can't be established. Verify this fingerprint out of band (e.g. with the server administrator) before accepting."}
          </DialogDescription>
        </DialogHeader>
        {current && (
          <dl className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-xs text-muted-foreground">Host</dt>
              <dd className="truncate font-mono text-xs">
                {current.host}:{current.port}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-xs text-muted-foreground">Key type</dt>
              <dd className="font-mono text-xs">{current.keyType}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">SHA256 fingerprint</dt>
              <dd className="break-all font-mono text-xs">{current.fingerprint}</dd>
            </div>
          </dl>
        )}
        {queue.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {queue.length - 1} more prompt{queue.length > 2 ? 's' : ''} waiting
          </p>
        )}
        <DialogFooter>
          <Button
            variant={danger ? 'default' : 'secondary'}
            autoFocus
            disabled={responding}
            onClick={() => void respond(false)}
          >
            Reject
          </Button>
          <Button
            variant={danger ? 'destructive' : 'default'}
            disabled={responding}
            onClick={() => void respond(true)}
          >
            {danger ? 'Accept anyway' : 'Accept & remember'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
