import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'

const isMac = navigator.platform.toUpperCase().includes('MAC')
const mod = isMac ? '⌘' : 'Ctrl'

const SHORTCUTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: `${mod}K`, label: 'Command palette (search hosts & commands)' },
  { keys: `${mod}T`, label: 'New session (command palette)' },
  { keys: `${mod}W`, label: 'Close active tab' },
  { keys: `${mod}1–9`, label: 'Switch to tab by number (9 = last)' },
  { keys: 'Ctrl+Tab', label: 'Next tab (Ctrl+⇧Tab: previous)' },
  { keys: `${mod}F`, label: 'Search in terminal' },
  { keys: `${mod}⇧C`, label: 'Copy selection (terminal)' },
  { keys: `${mod}⇧V`, label: 'Paste (terminal)' },
  { keys: 'Alt+click tab', label: 'Open tab in a split pane' },
  { keys: 'Double-click tab', label: 'Rename tab' },
  { keys: '?', label: 'Show this shortcuts cheat-sheet' },
]

interface ShortcutsOverlayProps {
  open: boolean
  onOpenChange(open: boolean): void
}

/** A `?`-triggered keyboard cheat-sheet so shortcuts are discoverable. */
export function ShortcutsOverlay({ open, onOpenChange }: ShortcutsOverlayProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="shortcuts-description">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription id="shortcuts-description">
            Press <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">?</kbd> any
            time to open this.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1.5">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{s.label}</span>
              <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
