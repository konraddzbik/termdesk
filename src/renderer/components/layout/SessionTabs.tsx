import { AiActivityTab } from '@renderer/components/ai/AiActivityTab'
import { AutomationTab } from '@renderer/components/automation/AutomationTab'
import { LogsTab } from '@renderer/components/logs/LogsTab'
import { RdpTab } from '@renderer/components/rdp/RdpTab'
import { SftpTab } from '@renderer/components/sftp/SftpTab'
import { LocalTerminalTab } from '@renderer/components/terminal/LocalTerminalTab'
import { TerminalTab } from '@renderer/components/terminal/TerminalTab'
import { VncTab } from '@renderer/components/vnc/VncTab'
import { openLocalTerminalTab } from '@renderer/lib/local-terminal'
import { cn } from '@renderer/lib/utils'
import { type SessionTab, useTabsStore } from '@renderer/stores/tabs'
import { Columns2, PanelRightClose, Plus, Rows2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { WelcomeView } from './WelcomeView'

function TabPanelContent({ tab }: { tab: SessionTab }): React.JSX.Element {
  switch (tab.kind) {
    case 'terminal':
      return <TerminalTab tab={tab} />
    case 'sftp':
      return <SftpTab tab={tab} />
    case 'vnc':
      return <VncTab tab={tab} />
    case 'rdp':
      return <RdpTab tab={tab} />
    case 'automation':
      return <AutomationTab />
    case 'logs':
      return <LogsTab />
    case 'ai-activity':
      return <AiActivityTab />
    case 'local-terminal':
      return <LocalTerminalTab tab={tab} />
    default:
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Session views arrive in later phases
        </div>
      )
  }
}

function SplitResizeHandle({
  direction,
  onResize,
  className,
}: {
  direction: 'horizontal' | 'vertical'
  onResize(deltaRatio: number): void
  className?: string
}): React.JSX.Element {
  const dragging = useRef(false)
  const startPos = useRef(0)
  const containerSize = useRef(1)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragging.current = true
      startPos.current = direction === 'horizontal' ? event.clientX : event.clientY
      const pane = event.currentTarget.parentElement
      if (pane) {
        const rect = pane.getBoundingClientRect()
        containerSize.current = direction === 'horizontal' ? rect.width : rect.height
      }
      event.currentTarget.setPointerCapture(event.pointerId)

      const onMove = (ev: PointerEvent): void => {
        if (!dragging.current) return
        const pos = direction === 'horizontal' ? ev.clientX : ev.clientY
        const delta = (pos - startPos.current) / containerSize.current
        startPos.current = pos
        onResize(delta)
      }
      const onUp = (): void => {
        dragging.current = false
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [direction, onResize],
  )

  return (
    <div
      title="Resize split panes"
      onPointerDown={onPointerDown}
      className={cn(
        'shrink-0 bg-border transition-colors hover:bg-primary/40',
        direction === 'horizontal' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
        className,
      )}
    />
  )
}

function SessionPane({
  tab,
  onFocus,
}: {
  tab: SessionTab | undefined
  onFocus(): void
}): React.JSX.Element {
  const paneClass = 'relative h-full min-h-0 min-w-0 overflow-hidden'

  if (!tab) {
    return (
      <div className={paneClass} onPointerDown={onFocus}>
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Open another session tab, then split or Alt-click a tab to show it here.
        </div>
      </div>
    )
  }

  return (
    <div
      role="tabpanel"
      id={`panel-${tab.id}`}
      aria-labelledby={`tab-${tab.id}`}
      className={paneClass}
      onPointerDown={onFocus}
    >
      <TabPanelContent tab={tab} />
    </div>
  )
}

export function SessionTabs(): React.JSX.Element {
  // Shallow-selected slice instead of subscribing to the entire store, so this
  // component only re-renders when a field it actually uses changes.
  const {
    tabs,
    activeTabId,
    secondaryTabId,
    splitDirection,
    splitRatio,
    focusedPane,
    setActiveTab,
    closeTab,
    splitWithTab,
    toggleSplit,
    closeSplit,
    setFocusedPane,
    setSplitRatio,
    renameTab,
  } = useTabsStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      secondaryTabId: s.secondaryTabId,
      splitDirection: s.splitDirection,
      splitRatio: s.splitRatio,
      focusedPane: s.focusedPane,
      setActiveTab: s.setActiveTab,
      closeTab: s.closeTab,
      splitWithTab: s.splitWithTab,
      toggleSplit: s.toggleSplit,
      closeSplit: s.closeSplit,
      setFocusedPane: s.setFocusedPane,
      setSplitRatio: s.setSplitRatio,
      renameTab: s.renameTab,
    })),
  )

  // Keep the active tab scrolled into view when it changes (e.g. via the
  // Cmd/Ctrl+1–9 and Ctrl+Tab shortcuts) and the strip has overflowed.
  const activeTabRef = useRef<HTMLDivElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTabId is the trigger — re-run to scroll the newly-active tab into view, even though the body only reads the ref
  useEffect(() => {
    // Optional-chain the method too: jsdom (tests) doesn't implement it.
    activeTabRef.current?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [activeTabId])

  // Inline tab-title rename (double-click a closable tab).
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const startRename = (tab: SessionTab): void => {
    if (!tab.closable) return
    setDraft(tab.title)
    setRenamingId(tab.id)
  }
  const commitRename = (): void => {
    if (renamingId) renameTab(renamingId, draft)
    setRenamingId(null)
  }

  const splitActive = splitDirection !== null && secondaryTabId !== null
  const canSplit = tabs.filter((t) => t.closable).length >= 2

  function tabClass(tab: SessionTab): string {
    const focusedTabId =
      splitActive && focusedPane === 'secondary' && secondaryTabId ? secondaryTabId : activeTabId
    const isActiveTab = tab.id === focusedTabId
    return cn(
      'group flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-t-md border border-b-0 px-3 text-sm',
      isActiveTab && 'bg-background text-foreground',
      !isActiveTab && 'bg-transparent text-muted-foreground hover:bg-accent/50',
    )
  }

  function handleTabActivate(tab: SessionTab, event: React.MouseEvent): void {
    if (event.altKey && tab.closable) {
      splitWithTab(tab.id, splitDirection ?? 'horizontal')
      return
    }
    setActiveTab(tab.id)
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Sessions"
        className="flex h-12 shrink-0 items-end border-b bg-card/30 px-2"
      >
        <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto pb-px [scrollbar-width:thin]">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              ref={tab.id === activeTabId ? activeTabRef : undefined}
              id={`tab-${tab.id}`}
              className={tabClass(tab)}
              onClick={(e) => handleTabActivate(tab, e)}
              onDoubleClick={() => startRename(tab)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  if (e.altKey && tab.closable) {
                    splitWithTab(tab.id, splitDirection ?? 'horizontal')
                  } else {
                    setActiveTab(tab.id)
                  }
                }
              }}
              role="tab"
              tabIndex={0}
              aria-selected={tab.id === activeTabId || tab.id === secondaryTabId}
              aria-controls={`panel-${tab.id}`}
              title={tab.closable ? 'Alt+click to open in split pane' : undefined}
            >
              {renamingId === tab.id ? (
                <input
                  // biome-ignore lint/a11y/noAutofocus: focusing the rename field is the intent
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') setRenamingId(null)
                  }}
                  className="w-24 rounded-sm bg-background px-1 text-sm outline-none ring-1 ring-ring"
                />
              ) : (
                <span className="max-w-[12rem] truncate">{tab.title}</span>
              )}
              {splitActive && tab.id === secondaryTabId && (
                <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">2</span>
              )}
              {tab.closable && (
                <button
                  type="button"
                  className="rounded p-0.5 opacity-0 hover:bg-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }}
                  aria-label={`Close ${tab.title}`}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            title="New local terminal"
            aria-label="New local terminal"
            onClick={() => openLocalTerminalTab()}
            className="mb-1 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="mb-1 flex shrink-0 items-center gap-0.5 pl-1">
          <button
            type="button"
            title="Split side by side (Alt+click a tab)"
            aria-label="Split side by side"
            disabled={!canSplit}
            onClick={() => toggleSplit('horizontal')}
            className={cn(
              'rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground',
              'disabled:pointer-events-none disabled:opacity-40',
              splitDirection === 'horizontal' && 'bg-accent text-foreground',
            )}
          >
            <Columns2 className="size-4" />
          </button>
          <button
            type="button"
            title="Split stacked"
            aria-label="Split stacked"
            disabled={!canSplit}
            onClick={() => toggleSplit('vertical')}
            className={cn(
              'rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground',
              'disabled:pointer-events-none disabled:opacity-40',
              splitDirection === 'vertical' && 'bg-accent text-foreground',
            )}
          >
            <Rows2 className="size-4" />
          </button>
          {splitActive && (
            <button
              type="button"
              title="Close split"
              aria-label="Close split"
              onClick={() => closeSplit()}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PanelRightClose className="size-4" />
            </button>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* With no tabs open, the Welcome view fills the area as a background
            empty state (it is not a tab and can't be "closed" — it simply
            reappears whenever the last tab is closed). */}
        {tabs.length === 0 && <WelcomeView />}
        {/* Every tab is rendered exactly once and kept mounted, keyed by id, so
            each session keeps a stable instance for its whole life (survives tab
            switches) and instances are never reused across tabs. Visibility +
            split layout are pure CSS; flex `order` puts primary/handle/secondary
            in the right places regardless of array order. */}
        <div
          className={cn(
            'flex h-full',
            splitActive && splitDirection === 'vertical' ? 'flex-col' : 'flex-row',
          )}
        >
          {tabs.map((tab) => {
            const isPrimary = tab.id === activeTabId
            const isSecondary = splitActive && tab.id === secondaryTabId
            const visible = isPrimary || isSecondary
            const style: React.CSSProperties = !visible
              ? {}
              : splitActive
                ? { flex: `${isPrimary ? splitRatio : 1 - splitRatio} 1 0%` }
                : { flex: '1 1 0%' }
            return (
              <div
                key={tab.id}
                className={cn(
                  'min-h-0 min-w-0',
                  !visible && 'hidden',
                  isPrimary ? 'order-1' : isSecondary ? 'order-3' : '',
                )}
                style={style}
              >
                <SessionPane
                  tab={tab}
                  onFocus={() => setFocusedPane(isSecondary ? 'secondary' : 'primary')}
                />
              </div>
            )
          })}
          {splitActive && (
            <SplitResizeHandle
              direction={splitDirection}
              onResize={(delta) => setSplitRatio(splitRatio + delta)}
              className="order-2"
            />
          )}
        </div>
      </div>
    </>
  )
}
