import { beforeEach, describe, expect, it } from 'vitest'
import { type SessionTab, useTabsStore } from './tabs'

/** A non-closable tab, to exercise the closable-guard paths (no built-in one exists anymore). */
const pinned: SessionTab = { id: 'pinned', kind: 'terminal', title: 'Pinned', closable: false }

function tab(id: string): SessionTab {
  return { id, kind: 'terminal', title: id, closable: true, hostId: `host-${id}` }
}

function resetTabs(): void {
  useTabsStore.setState({
    tabs: [],
    activeTabId: null,
    secondaryTabId: null,
    splitDirection: null,
    splitRatio: 0.5,
    focusedPane: 'primary',
  })
}

beforeEach(() => {
  resetTabs()
})

describe('initial state', () => {
  it('starts with no tabs (Welcome renders as a background empty state)', () => {
    const state = useTabsStore.getState()
    expect(state.tabs).toHaveLength(0)
    expect(state.activeTabId).toBeNull()
    expect(state.secondaryTabId).toBeNull()
  })
})

describe('openTab', () => {
  it('appends a new tab and activates it', () => {
    useTabsStore.getState().openTab(tab('a'))
    const state = useTabsStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['a'])
    expect(state.activeTabId).toBe('a')
  })

  it('dedups by id: re-opening an existing tab only activates it', () => {
    useTabsStore.getState().openTab(tab('a'))
    useTabsStore.getState().openTab(tab('b'))
    useTabsStore.getState().openTab(tab('a'))
    const state = useTabsStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(state.activeTabId).toBe('a')
  })

  it('closing the last tab leaves none, and activeTabId becomes null', () => {
    useTabsStore.getState().openTab(tab('a'))
    useTabsStore.getState().closeTab('a')
    const state = useTabsStore.getState()
    expect(state.tabs).toHaveLength(0)
    expect(state.activeTabId).toBeNull()
  })
})

describe('renameTab', () => {
  it('renames only the target tab and trims whitespace', () => {
    useTabsStore.getState().openTab(tab('a'))
    useTabsStore.getState().openTab(tab('b'))
    useTabsStore.getState().renameTab('a', '  deploy box  ')
    const tabs = useTabsStore.getState().tabs
    expect(tabs.find((t) => t.id === 'a')?.title).toBe('deploy box')
    expect(tabs.find((t) => t.id === 'b')?.title).toBe('b')
  })

  it('ignores an empty/whitespace title', () => {
    useTabsStore.getState().openTab(tab('a'))
    useTabsStore.getState().renameTab('a', '   ')
    expect(useTabsStore.getState().tabs.find((t) => t.id === 'a')?.title).toBe('a')
  })
})

describe('closeTab', () => {
  it('closing the active 2nd of 5 tabs activates the 3rd', () => {
    useTabsStore.setState({
      tabs: [tab('a'), tab('b'), tab('c'), tab('d'), tab('e')],
      activeTabId: 'b',
      secondaryTabId: null,
      splitDirection: null,
      splitRatio: 0.5,
      focusedPane: 'primary',
    })
    useTabsStore.getState().closeTab('b')
    const state = useTabsStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'c', 'd', 'e'])
    expect(state.activeTabId).toBe('c')
  })

  it('closing the active last tab falls back to the new last tab', () => {
    useTabsStore.setState({
      tabs: [tab('a'), tab('b'), tab('c')],
      activeTabId: 'c',
      secondaryTabId: null,
      splitDirection: null,
      splitRatio: 0.5,
      focusedPane: 'primary',
    })
    useTabsStore.getState().closeTab('c')
    const state = useTabsStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(state.activeTabId).toBe('b')
  })

  it('a non-closable tab survives closeTab', () => {
    useTabsStore.setState({
      tabs: [pinned],
      activeTabId: 'pinned',
      secondaryTabId: null,
      splitDirection: null,
      splitRatio: 0.5,
      focusedPane: 'primary',
    })
    useTabsStore.getState().closeTab('pinned')
    const state = useTabsStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['pinned'])
    expect(state.activeTabId).toBe('pinned')
  })

  it('closing an inactive tab keeps the active tab unchanged', () => {
    useTabsStore.setState({
      tabs: [pinned, tab('a'), tab('b')],
      activeTabId: 'b',
      secondaryTabId: null,
      splitDirection: null,
      splitRatio: 0.5,
      focusedPane: 'primary',
    })
    useTabsStore.getState().closeTab('a')
    const state = useTabsStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['pinned', 'b'])
    expect(state.activeTabId).toBe('b')
  })

  it('closing the secondary pane tab ends split mode', () => {
    useTabsStore.setState({
      tabs: [pinned, tab('a'), tab('b')],
      activeTabId: 'a',
      secondaryTabId: 'b',
      splitDirection: 'horizontal',
      splitRatio: 0.5,
      focusedPane: 'secondary',
    })
    useTabsStore.getState().closeTab('b')
    const state = useTabsStore.getState()
    expect(state.secondaryTabId).toBeNull()
    expect(state.splitDirection).toBeNull()
    expect(state.activeTabId).toBe('a')
  })

  it('closing the primary pane tab promotes the secondary tab', () => {
    useTabsStore.setState({
      tabs: [pinned, tab('a'), tab('b')],
      activeTabId: 'a',
      secondaryTabId: 'b',
      splitDirection: 'horizontal',
      splitRatio: 0.5,
      focusedPane: 'primary',
    })
    useTabsStore.getState().closeTab('a')
    const state = useTabsStore.getState()
    expect(state.activeTabId).toBe('b')
    expect(state.secondaryTabId).toBeNull()
    expect(state.splitDirection).toBeNull()
  })
})

describe('setActiveTab', () => {
  it('switches the active tab', () => {
    useTabsStore.setState({
      tabs: [pinned, tab('a')],
      activeTabId: 'a',
      secondaryTabId: null,
      splitDirection: null,
      splitRatio: 0.5,
      focusedPane: 'primary',
    })
    useTabsStore.getState().setActiveTab('pinned')
    expect(useTabsStore.getState().activeTabId).toBe('pinned')
  })

  it('clicking the secondary tab swaps panes', () => {
    useTabsStore.setState({
      tabs: [pinned, tab('a'), tab('b')],
      activeTabId: 'a',
      secondaryTabId: 'b',
      splitDirection: 'horizontal',
      splitRatio: 0.5,
      focusedPane: 'primary',
    })
    useTabsStore.getState().setActiveTab('b')
    const state = useTabsStore.getState()
    expect(state.activeTabId).toBe('b')
    expect(state.secondaryTabId).toBe('a')
  })
})

describe('split', () => {
  it('toggleSplit opens horizontal split with another session tab', () => {
    useTabsStore.setState({
      tabs: [pinned, tab('a'), tab('b')],
      activeTabId: 'a',
      secondaryTabId: null,
      splitDirection: null,
      splitRatio: 0.5,
      focusedPane: 'primary',
    })
    useTabsStore.getState().toggleSplit('horizontal')
    const state = useTabsStore.getState()
    expect(state.splitDirection).toBe('horizontal')
    expect(state.secondaryTabId).toBe('b')
  })

  it('toggleSplit again closes split', () => {
    useTabsStore.setState({
      tabs: [pinned, tab('a'), tab('b')],
      activeTabId: 'a',
      secondaryTabId: 'b',
      splitDirection: 'horizontal',
      splitRatio: 0.5,
      focusedPane: 'primary',
    })
    useTabsStore.getState().toggleSplit('horizontal')
    const state = useTabsStore.getState()
    expect(state.splitDirection).toBeNull()
    expect(state.secondaryTabId).toBeNull()
  })

  it('splitWithTab assigns a specific tab to the secondary pane', () => {
    useTabsStore.setState({
      tabs: [pinned, tab('a'), tab('b')],
      activeTabId: 'a',
      secondaryTabId: null,
      splitDirection: null,
      splitRatio: 0.5,
      focusedPane: 'primary',
    })
    useTabsStore.getState().splitWithTab('b', 'vertical')
    const state = useTabsStore.getState()
    expect(state.splitDirection).toBe('vertical')
    expect(state.secondaryTabId).toBe('b')
  })
})
