import { Button } from '@renderer/components/ui/button'
import { useVersions } from '@renderer/hooks/useVersions'
import { openLocalTerminalTab } from '@renderer/lib/local-terminal'
import { useHostsStore } from '@renderer/stores/hosts'
import { useUiStore } from '@renderer/stores/ui'
import { FolderUp, Plus, Search, SquareTerminal } from 'lucide-react'

const isMac = navigator.platform.toUpperCase().includes('MAC')
const mod = isMac ? '⌘' : 'Ctrl'

/** A single keyboard hint chip, e.g. `⌘K  Command palette`. */
function Kbd({ keys, label }: { keys: string; label: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
        {keys}
      </kbd>
      {label}
    </span>
  )
}

export function WelcomeView(): React.JSX.Element {
  const versions = useVersions()
  const loadAll = useHostsStore((s) => s.loadAll)
  const openHostDialog = useUiStore((s) => s.openHostDialog)
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen)

  const importSshConfig = (): void => {
    void window.api.sshConfig.importFromFile().then(() => loadAll())
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to TermDesk</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          SSH terminal, SFTP file transfer, secure VNC and fleet automation — in one window.
          Everything stays local on your machine. Get started:
        </p>
      </div>

      {/* Primary actions — the three fastest paths to value. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={() => openHostDialog()}>
          <Plus className="size-4" />
          Add a host
        </Button>
        <Button variant="outline" size="sm" onClick={importSshConfig}>
          <FolderUp className="size-4" />
          Import ~/.ssh/config
        </Button>
        <Button variant="outline" size="sm" onClick={() => openLocalTerminalTab()}>
          <SquareTerminal className="size-4" />
          Local terminal
        </Button>
      </div>

      {/* Discoverability: teach the command palette, the keyboard-first entry point. */}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Search className="size-4" />
        <span>Search hosts &amp; commands</span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          {mod}K
        </kbd>
      </button>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <Kbd keys={`${mod}T`} label="New session" />
        <Kbd keys={`${mod}W`} label="Close tab" />
        <Kbd keys="?" label="All shortcuts" />
      </div>

      {versions && (
        <p className="text-xs text-muted-foreground">
          Electron {versions.electron} · Chromium {versions.chrome} · Node {versions.node}
        </p>
      )}
    </div>
  )
}
