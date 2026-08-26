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
import { useHostsStore } from '@renderer/stores/hosts'
import { useUiStore } from '@renderer/stores/ui'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

/**
 * Quick "duplicate this host" popup: copies every setting (auth, secrets,
 * credential, group, VNC) from the source and only asks for a new label + IP.
 */
export function DuplicateHostDialog(): React.JSX.Element {
  const source = useUiStore((s) => s.duplicatingHost)
  const close = useUiStore((s) => s.closeDuplicateHost)
  const duplicateHost = useHostsStore((s) => s.duplicateHost)

  const [label, setLabel] = useState('')
  const [hostname, setHostname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Prefill from the source each time a new host is targeted.
  useEffect(() => {
    if (source) {
      setLabel(`${source.label} copy`)
      setHostname(source.hostname)
      setError(null)
      setSubmitting(false)
    }
  }, [source])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!source) return
    if (!label.trim() || !hostname.trim()) {
      setError('Name and address are required')
      return
    }
    setSubmitting(true)
    try {
      await duplicateHost(source.id, label.trim(), hostname.trim())
      close()
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={source != null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-sm" aria-describedby="duplicate-host-description">
        <DialogHeader>
          <DialogTitle>Duplicate host</DialogTitle>
          <DialogDescription id="duplicate-host-description">
            {source
              ? `Copies all settings from “${source.label}”. Only the name and address change.`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dup-label">Name</Label>
            <Input
              id="dup-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="prod-web-2"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dup-hostname">Hostname / IP</Label>
            <Input
              id="dup-hostname"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="10.0.0.2"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              Duplicate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
