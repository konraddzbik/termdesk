import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useHostsStore } from '@renderer/stores/hosts'
import type { SshConfigImportResult } from '@shared/ipc'
import { FileDown, FolderOpen, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const MESSAGE_TTL_MS = 4000

type ImportKind = 'default' | 'file'

export function ImportSshConfigButton(): React.JSX.Element {
  const loadAll = useHostsStore((s) => s.loadAll)
  const [busy, setBusy] = useState<ImportKind | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  async function runImport(
    kind: ImportKind,
    importer: () => Promise<SshConfigImportResult>,
  ): Promise<void> {
    setBusy(kind)
    setMessage(null)
    try {
      const result = await importer()
      await loadAll()
      setIsError(false)
      if (result.canceled) {
        setMessage(null)
        return
      }
      const fromFiles =
        result.filesRead && result.filesRead > 1 ? ` from ${result.filesRead} files` : ''
      setMessage(`Imported ${result.imported} (skipped ${result.skipped})${fromFiles}`)
    } catch (error) {
      setIsError(true)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setMessage(null), MESSAGE_TTL_MS)
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-0.5">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => void runImport('default', () => window.api.sshConfig.importFromFile())}
          disabled={busy !== null}
          aria-label="Import hosts from ~/.ssh/config"
          title="Import from ~/.ssh/config"
        >
          {busy === 'default' ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <FileDown />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => void runImport('file', () => window.api.sshConfig.importFromPickedFile())}
          disabled={busy !== null}
          aria-label="Import hosts from an SSH config file"
          title="Import from an SSH config file…"
        >
          {busy === 'file' ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <FolderOpen />
          )}
        </Button>
      </div>
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
