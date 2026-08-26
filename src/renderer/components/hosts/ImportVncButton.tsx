import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useHostsStore } from '@renderer/stores/hosts'
import { Loader2, MonitorDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const MESSAGE_TTL_MS = 4000

/**
 * Imports VNC Viewer `.vnc` connection files as VNC hosts. Mirrors
 * ImportSshConfigButton: pick one or more files in main, then reload the vault.
 */
export function ImportVncButton(): React.JSX.Element {
  const loadAll = useHostsStore((s) => s.loadAll)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  async function runImport(): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.api.vnc.importConnections()
      await loadAll()
      setIsError(false)
      if (result.canceled) {
        setMessage(null)
        return
      }
      setMessage(`Imported ${result.imported} (skipped ${result.skipped})`)
    } catch (error) {
      setIsError(true)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setMessage(null), MESSAGE_TTL_MS)
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => void runImport()}
        disabled={busy}
        aria-label="Import VNC connections from .vnc files"
        title="Import VNC connections (.vnc)…"
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MonitorDown />}
      </Button>
      {message && (
        <p
          role="status"
          title={message}
          className={cn(
            'max-w-full truncate text-[10px]',
            isError ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {message}
        </p>
      )}
    </div>
  )
}
