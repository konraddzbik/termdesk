import { create } from 'zustand'

export type TabKind =
  | 'terminal'
  | 'sftp'
  | 'vnc'
  | 'rdp'
  | 'automation'
  | 'logs'
  | 'local-terminal'
  | 'ai-activity'
export type SplitDirection = 'horizontal' | 'vertical'
export type FocusedPane = 'primary' | 'secondary'

export interface SessionTab {
  id: string
  kind: TabKind
  title: string
  closable: boolean
  /** Vault host backing this tab (terminal/sftp/vnc kinds). */
  hostId?: string
  /** Working directory for a local-terminal tab (defaults to home). */
  cwd?: string
  /** Command to run once, automatically, after the local shell connects
   *  (e.g. `claude` / `grok`). */
  runOnOpen?: string
}

interface TabsState {
  tabs: SessionTab[]
  activeTabId: string | null
  /** Second pane when split; must differ from activeTabId. */
  secondaryTabId: string | null
  splitDirection: SplitDirection | null
  /** Primary pane size share (0.2–0.8). */
  splitRatio: number
  focusedPane: FocusedPane
  openTab(tab: SessionTab): void
  closeTab(id: string): void
  setActiveTab(id: string): void
  /** Rename a tab's title (e.g. inline-rename a local terminal). */
  renameTab(id: string, title: string): void
  /** Put `tabId` in the secondary pane (ssh+vnc, ssh+ssh, …). */
  splitWithTab(tabId: string, direction?: SplitDirection): void
  /** Toggle split using the next open session tab as secondary. */
  toggleSplit(direction: SplitDirection): void
  closeSplit(): void
  setFocusedPane(pane: FocusedPane): void
  setSplitRatio(ratio: number): void
}

function clampSplitRatio(ratio: number): number {
  return Math.min(0.8, Math.max(0.2, ratio))
}

function pickSecondaryTab(tabs: SessionTab[], primaryId: string | null): string | null {
  return tabs.find((t) => t.closable && t.id !== primaryId)?.id ?? null
}

export const useTabsStore = create<TabsState>((set) => ({
  // No built-in tab: when there are zero tabs, the UI shows the Welcome view as
  // a background empty state rather than as a (non-closable) tab.
  tabs: [],
  activeTabId: null,
  secondaryTabId: null,
  splitDirection: null,
  splitRatio: 0.5,
  focusedPane: 'primary',

  openTab: (tab) =>
    set((state) => ({
      tabs: state.tabs.some((t) => t.id === tab.id) ? state.tabs : [...state.tabs, tab],
      activeTabId: tab.id,
      focusedPane: 'primary',
    })),

  renameTab: (id, title) =>
    set((state) => {
      const trimmed = title.trim()
      if (!trimmed) return state
      return {
        tabs: state.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
      }
    }),

  closeTab: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id)
      const closed = state.tabs[index]
      if (!closed?.closable) return state

      let activeTabId = state.activeTabId
      let secondaryTabId = state.secondaryTabId
      let splitDirection = state.splitDirection
      let focusedPane = state.focusedPane

      if (id === secondaryTabId) {
        secondaryTabId = null
        splitDirection = null
        focusedPane = 'primary'
      }

      if (id === activeTabId) {
        if (secondaryTabId) {
          activeTabId = secondaryTabId
          secondaryTabId = null
          splitDirection = null
          focusedPane = 'primary'
        } else {
          const tabsAfter = state.tabs.filter((t) => t.id !== id)
          activeTabId = tabsAfter[Math.min(index, tabsAfter.length - 1)]?.id ?? null
        }
      }

      const tabs = state.tabs.filter((t) => t.id !== id)

      if (secondaryTabId && !tabs.some((t) => t.id === secondaryTabId)) {
        secondaryTabId = null
        splitDirection = null
        focusedPane = 'primary'
      }
      if (activeTabId && !tabs.some((t) => t.id === activeTabId)) {
        activeTabId = tabs[tabs.length - 1]?.id ?? null
      }

      return { tabs, activeTabId, secondaryTabId, splitDirection, focusedPane }
    }),

  setActiveTab: (id) =>
    set((state) => {
      if (state.secondaryTabId === id && state.activeTabId) {
        return {
          activeTabId: id,
          secondaryTabId: state.activeTabId,
          focusedPane: 'primary',
        }
      }
      return { activeTabId: id, focusedPane: 'primary' }
    }),

  splitWithTab: (tabId, direction = 'horizontal') =>
    set((state) => {
      if (tabId === state.activeTabId) return state
      const tab = state.tabs.find((t) => t.id === tabId)
      if (!tab?.closable) return state
      return {
        splitDirection: direction,
        secondaryTabId: tabId,
        focusedPane: 'primary',
      }
    }),

  toggleSplit: (direction) =>
    set((state) => {
      if (state.splitDirection === direction) {
        return { splitDirection: null, secondaryTabId: null, focusedPane: 'primary' }
      }
      const secondary = pickSecondaryTab(state.tabs, state.activeTabId)
      if (!secondary) return state
      return {
        splitDirection: direction,
        secondaryTabId: secondary,
        focusedPane: 'primary',
      }
    }),

  closeSplit: () => set({ splitDirection: null, secondaryTabId: null, focusedPane: 'primary' }),

  setFocusedPane: (pane) => set({ focusedPane: pane }),

  setSplitRatio: (ratio) => set({ splitRatio: clampSplitRatio(ratio) }),
}))
