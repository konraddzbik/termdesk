import { type SessionTab, useTabsStore } from '@renderer/stores/tabs'
import { lastTwoSegments } from './path-label'

let counter = 0

/**
 * Deterministic tab title from the caller's options: an explicit title wins,
 * else the last two path segments of the cwd. Returns undefined when neither is
 * given, so the caller can apply its numbered "Local"/"Local N" fallback.
 */
export function localTerminalTitle(opts?: { cwd?: string; title?: string }): string | undefined {
  if (opts?.title) return opts.title
  if (opts?.cwd) return lastTwoSegments(opts.cwd)
  return undefined
}

/**
 * Opens a new, renameable local-shell tab. With a `cwd`, the shell starts in
 * that directory and the tab is titled by its last two path segments.
 */
export function openLocalTerminalTab(opts?: {
  cwd?: string
  title?: string
  runOnOpen?: string
}): void {
  const title = localTerminalTitle(opts) ?? (++counter === 1 ? 'Local' : `Local ${counter}`)
  useTabsStore.getState().openTab({
    id: crypto.randomUUID(),
    kind: 'local-terminal',
    title,
    closable: true,
    cwd: opts?.cwd,
    runOnOpen: opts?.runOnOpen,
  })
}

/**
 * Open a local terminal for `opts`, but first focus an already-open tab for the
 * same directory instead of spawning a duplicate. Used by the sidebar's saved
 * entries so clicking one repeatedly re-focuses its tab; the `+`, duplicate and
 * side-by-side flows keep `openLocalTerminalTab`'s always-new behavior.
 *
 * Matches on `cwd` — the saved entry's identity. Without a `cwd` there's nothing
 * to match on, so it always opens a fresh tab.
 */
export function openOrFocusLocalTerminalTab(opts?: {
  cwd?: string
  title?: string
  runOnOpen?: string
}): void {
  const cwd = opts?.cwd
  if (cwd) {
    const existing = useTabsStore
      .getState()
      .tabs.find((t) => t.kind === 'local-terminal' && t.cwd === cwd)
    if (existing) {
      useTabsStore.getState().setActiveTab(existing.id)
      return
    }
  }
  openLocalTerminalTab(opts)
}

/** A directory to open, optionally with a command to auto-run when it connects. */
export type SideBySideDir = string | { path: string; command?: string }

function normDir(d: SideBySideDir): { path: string; command?: string } {
  return typeof d === 'string' ? { path: d } : d
}

/** Pick a directory and open a local terminal there — no need to save it first. */
export async function openLocalTerminalInFolder(): Promise<void> {
  const dir = await window.api.localTerminals.pickDirectory()
  if (dir) openLocalTerminalTab({ cwd: dir })
}

/** Open another local terminal in the same starting directory as `tab`. */
export function duplicateLocalTerminal(tab: SessionTab): void {
  if (tab.kind !== 'local-terminal') return
  openLocalTerminalTab({ cwd: tab.cwd, title: tab.cwd ? undefined : tab.title })
}

/**
 * Open one local terminal per directory and place the first two side by side
 * (the rest open as extra tabs). This is the "two directories at once" action.
 */
export function openLocalTerminalsSideBySide(dirs: ReadonlyArray<SideBySideDir>): void {
  const specs = dirs.map(normDir).filter((d) => (d.path ?? '').trim().length > 0)
  if (specs.length === 0) return
  openLocalTerminalTab({ cwd: specs[0]?.path, runOnOpen: specs[0]?.command })
  const primaryId = useTabsStore.getState().activeTabId
  let secondaryId: string | null = null
  for (let i = 1; i < specs.length; i++) {
    openLocalTerminalTab({ cwd: specs[i]?.path, runOnOpen: specs[i]?.command })
    if (i === 1) secondaryId = useTabsStore.getState().activeTabId
  }
  if (primaryId && secondaryId && primaryId !== secondaryId) {
    useTabsStore.getState().setActiveTab(primaryId)
    useTabsStore.getState().splitWithTab(secondaryId, 'horizontal')
  }
}
