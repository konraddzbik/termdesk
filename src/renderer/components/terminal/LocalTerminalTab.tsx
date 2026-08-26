import { useLocalTerminalSession } from '@renderer/hooks/useLocalTerminalSession'
import type { SessionTab } from '@renderer/stores/tabs'
import { ExternalLink, RotateCw, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { LocalTerminalDialog } from './LocalTerminalDialog'
import { type TerminalTransport, TerminalView } from './TerminalView'

/** Stable module-level transport bound to the local-PTY IPC namespace. */
const localTransport: TerminalTransport = {
  write: (id, data) => window.api.localTerm.write(id, data),
  onData: (id, cb) => window.api.localTerm.onData(id, cb),
  attach: (id) => window.api.localTerm.attach(id),
  resize: (id, cols, rows) => {
    void window.api.localTerm.resize(id, cols, rows).catch(() => {})
  },
}

export function LocalTerminalTab({ tab }: { tab: SessionTab }): React.JSX.Element {
  const { sessionId, status, shell, restart } = useLocalTerminalSession(tab.id, tab.cwd)
  const [saveOpen, setSaveOpen] = useState(false)
  const [detectedPath, setDetectedPath] = useState('')

  // Auto-run the workspace command once, after the shell connects (e.g. `claude`).
  const ranRef = useRef(false)
  useEffect(() => {
    if (!tab.runOnOpen || !sessionId || status !== 'connected' || ranRef.current) return
    ranRef.current = true
    const cmd = tab.runOnOpen
    // Let the shell finish its rc init before injecting the command.
    const t = setTimeout(() => {
      void window.api.localTerm.write(sessionId, `${cmd}\n`)
    }, 400)
    return () => clearTimeout(t)
  }, [tab.runOnOpen, sessionId, status])

  async function openSave(): Promise<void> {
    const cwd = sessionId ? await window.api.localTerm.cwd(sessionId) : null
    setDetectedPath(cwd ?? tab.cwd ?? '')
    setSaveOpen(true)
  }

  async function openExternally(): Promise<void> {
    const cwd = (sessionId ? await window.api.localTerm.cwd(sessionId) : null) ?? tab.cwd
    await window.api.openExternalTerminal({ cwd })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-card/30 px-3 py-1 text-xs">
        <span className="truncate text-muted-foreground">{shell ?? 'shell'}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void openExternally()}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Open this directory in your external terminal (Ghostty, Warp, iTerm2, …)"
          >
            <ExternalLink className="size-3.5" />
            Open externally
          </button>
          <button
            type="button"
            onClick={() => void openSave()}
            disabled={!sessionId}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Save this directory for later"
          >
            <Save className="size-3.5" />
            Save path
          </button>
        </div>
      </div>
      {status === 'disconnected' && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Shell exited</span>
          <button
            type="button"
            onClick={restart}
            className="flex items-center gap-1 rounded px-2 py-0.5 font-medium text-foreground hover:bg-accent"
          >
            <RotateCw className="size-3.5" />
            Restart
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {sessionId ? (
          <TerminalView sessionId={sessionId} transport={localTransport} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {status === 'error' ? 'Failed to start shell' : `Starting ${shell ?? 'shell'}…`}
          </div>
        )}
      </div>
      <LocalTerminalDialog open={saveOpen} onOpenChange={setSaveOpen} initialPath={detectedPath} />
    </div>
  )
}
