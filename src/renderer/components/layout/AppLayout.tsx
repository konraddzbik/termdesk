import { McpApprovalDialog } from '@renderer/components/ai/McpApprovalDialog'
import { WelcomeTour } from '@renderer/components/onboarding/WelcomeTour'
import { RoutineTriggerListener } from '@renderer/components/routines/RoutineTriggerListener'
import { TransfersDrawer } from '@renderer/components/sftp/TransfersDrawer'
import { HostKeyDialog } from '@renderer/components/terminal/HostKeyDialog'
import { TunnelDialog } from '@renderer/components/tunnels/TunnelDialog'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'
import { useUpdatesStore } from '@renderer/stores/updates'
import { useEffect, useState } from 'react'
import { CommandPalette } from './CommandPalette'
import { SessionTabs } from './SessionTabs'
import { SettingsDialog } from './SettingsDialog'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { Sidebar } from './Sidebar'
import { UpdateBanner } from './UpdateBanner'

const isMac = navigator.platform.toUpperCase().includes('MAC')

/** True when focus is in a text field / terminal, where '?' is literal input. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // xterm's helper textarea lives inside .xterm
  return Boolean(el.closest('.xterm'))
}

export function AppLayout(): React.JSX.Element {
  const paletteOpen = useUiStore((s) => s.paletteOpen)
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const openHostDialog = useUiStore((s) => s.openHostDialog)
  const tunnelDialogOpen = useUiStore((s) => s.tunnelDialogOpen)
  const setTunnelDialogOpen = useUiStore((s) => s.setTunnelDialogOpen)
  const loadSettings = useSettingsStore((s) => s.load)
  const initUpdates = useUpdatesStore((s) => s.init)
  const updateSettings = useSettingsStore((s) => s.update)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const hasSeenWelcome = useSettingsStore((s) => s.settings.hasSeenWelcome)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)

  useEffect(() => {
    void loadSettings()
    initUpdates()
  }, [loadSettings, initUpdates])

  // Global shortcuts. Capture phase so they win over xterm's key handling.
  useEffect(() => {
    const selectTabByIndex = (index: number): void => {
      const { tabs, setActiveTab } = useTabsStore.getState()
      // index === -1 → last tab (Cmd/Ctrl+9 convention).
      const target = index < 0 ? tabs[tabs.length - 1] : tabs[index]
      if (target) setActiveTab(target.id)
    }
    const cycleTab = (dir: 1 | -1): void => {
      const { tabs, activeTabId, setActiveTab } = useTabsStore.getState()
      if (tabs.length === 0) return
      const i = tabs.findIndex((t) => t.id === activeTabId)
      const target = tabs[((((i < 0 ? 0 : i) + dir) % tabs.length) + tabs.length) % tabs.length]
      if (target) setActiveTab(target.id)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      // Ctrl+Tab / Ctrl+Shift+Tab cycles tabs on every platform (always Ctrl,
      // not the platform mod, matching browser/editor convention).
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        cycleTab(event.shiftKey ? -1 : 1)
        return
      }

      const mod = isMac ? event.metaKey : event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 'k' || key === 't') {
        // Ctrl/Cmd+K — palette; Ctrl/Cmd+T — new session via the palette.
        event.preventDefault()
        event.stopPropagation()
        useUiStore.getState().setPaletteOpen(!useUiStore.getState().paletteOpen)
      } else if (key === 'w') {
        event.preventDefault()
        event.stopPropagation()
        const { tabs, activeTabId, closeTab } = useTabsStore.getState()
        const active = tabs.find((t) => t.id === activeTabId)
        if (active?.closable) closeTab(active.id)
      } else if (key >= '1' && key <= '9') {
        // Cmd/Ctrl+1–8 jump to that tab; Cmd/Ctrl+9 jumps to the last tab.
        event.preventDefault()
        event.stopPropagation()
        selectTabByIndex(key === '9' ? -1 : Number(key) - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  const closeWelcome = (): void => {
    setWelcomeDismissed(true)
    void updateSettings({ hasSeenWelcome: true })
  }

  // '?' opens the shortcuts cheat-sheet (unless typing in a field/terminal).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      setShortcutsOpen((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex h-screen w-screen">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <SessionTabs />
        <TransfersDrawer />
      </main>
      <HostKeyDialog />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onAddHost={() => openHostDialog()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <TunnelDialog open={tunnelDialogOpen} onOpenChange={setTunnelDialogOpen} />
      <McpApprovalDialog />
      <RoutineTriggerListener />
      <UpdateBanner />
      <WelcomeTour
        open={settingsLoaded && !hasSeenWelcome && !welcomeDismissed}
        onClose={closeWelcome}
      />
    </div>
  )
}
