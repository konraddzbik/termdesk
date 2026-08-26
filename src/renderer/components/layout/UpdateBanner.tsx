import { Button } from '@renderer/components/ui/button'
import { useUpdatesStore } from '@renderer/stores/updates'
import { ArrowDownToLine, Download, RotateCw, X } from 'lucide-react'

/**
 * Non-modal, bottom-right update banner (VS Code style). It mirrors the
 * main-process updater: a downloaded update prompts a restart; on unsigned
 * macOS, an available update links to the download page instead.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const update = useUpdatesStore((s) => s.update)
  const dismissed = useUpdatesStore((s) => s.dismissed)
  const install = useUpdatesStore((s) => s.install)
  const download = useUpdatesStore((s) => s.download)
  const dismiss = useUpdatesStore((s) => s.dismiss)

  const { status, version, percent } = update
  const visible =
    !dismissed && (status === 'available' || status === 'downloading' || status === 'downloaded')
  if (!visible) return null

  const v = version ? `TermDesk ${version}` : 'A new version'

  return (
    <div className="fixed right-4 bottom-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-card text-card-foreground shadow-lg">
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {status === 'downloaded' ? (
            <RotateCw className="size-4" />
          ) : (
            <ArrowDownToLine className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {status === 'downloaded' ? (
            <>
              <p className="text-sm font-medium">Update ready</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {v} has been downloaded. Restart to apply it.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={install}>
                  <RotateCw className="size-3.5" />
                  Restart now
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={dismiss}>
                  Later
                </Button>
              </div>
            </>
          ) : status === 'downloading' ? (
            <>
              <p className="text-sm font-medium">Downloading update…</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${percent ?? 0}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {v} · {percent ?? 0}%
              </p>
            </>
          ) : (
            // 'available' — user opts in to the download (autoDownload is off).
            <>
              <p className="text-sm font-medium">Update available</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{v} is available to download.</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={download}>
                  <Download className="size-3.5" />
                  Download
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={dismiss}>
                  Later
                </Button>
              </div>
            </>
          )}
        </div>
        {status !== 'downloading' && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
