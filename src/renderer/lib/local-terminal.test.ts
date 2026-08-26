import { useTabsStore } from '@renderer/stores/tabs'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  localTerminalTitle,
  openLocalTerminalsSideBySide,
  openOrFocusLocalTerminalTab,
} from './local-terminal'

function resetTabs(): void {
  useTabsStore.setState({
    tabs: [],
    activeTabId: null,
    secondaryTabId: null,
    splitDirection: null,
    focusedPane: 'primary',
  })
}

describe('localTerminalTitle', () => {
  it('prefers an explicit title', () => {
    expect(localTerminalTitle({ title: 'Frontend', cwd: '/a/b/c' })).toBe('Frontend')
  })
  it('falls back to the last two path segments of the cwd', () => {
    expect(localTerminalTitle({ cwd: '/Users/me/work/api-service' })).toBe('work/api-service')
  })
  it('returns undefined when neither title nor cwd is given (caller numbers it)', () => {
    expect(localTerminalTitle()).toBeUndefined()
    expect(localTerminalTitle({})).toBeUndefined()
  })
})

describe('openOrFocusLocalTerminalTab', () => {
  beforeEach(resetTabs)

  it('opens a new tab when none exists for the directory', () => {
    openOrFocusLocalTerminalTab({ cwd: '/a/one' })
    expect(useTabsStore.getState().tabs).toHaveLength(1)
    expect(useTabsStore.getState().tabs[0]?.cwd).toBe('/a/one')
  })

  it('focuses the existing tab for the same directory instead of duplicating', () => {
    openOrFocusLocalTerminalTab({ cwd: '/a/one' })
    const firstId = useTabsStore.getState().tabs[0]?.id
    // Focus a different tab so we can prove the click re-activates the first.
    openOrFocusLocalTerminalTab({ cwd: '/b/two' })
    expect(useTabsStore.getState().activeTabId).not.toBe(firstId)

    openOrFocusLocalTerminalTab({ cwd: '/a/one' })
    expect(useTabsStore.getState().tabs).toHaveLength(2) // no duplicate
    expect(useTabsStore.getState().activeTabId).toBe(firstId)
  })

  it('always opens a fresh tab when no cwd is given (nothing to match on)', () => {
    openOrFocusLocalTerminalTab()
    openOrFocusLocalTerminalTab()
    expect(useTabsStore.getState().tabs).toHaveLength(2)
  })
})

describe('openLocalTerminalsSideBySide', () => {
  beforeEach(resetTabs)

  it('opens two terminals and splits them with the first directory as primary', () => {
    openLocalTerminalsSideBySide(['/a/one', '/b/two'])
    const s = useTabsStore.getState()
    expect(s.tabs).toHaveLength(2)
    expect(s.tabs[0]?.cwd).toBe('/a/one')
    expect(s.tabs[1]?.cwd).toBe('/b/two')
    expect(s.splitDirection).toBe('horizontal')
    expect(s.activeTabId).toBe(s.tabs[0]?.id)
    expect(s.secondaryTabId).toBe(s.tabs[1]?.id)
  })

  it('ignores empty/whitespace-only directories', () => {
    openLocalTerminalsSideBySide(['', '   '])
    expect(useTabsStore.getState().tabs).toHaveLength(0)
  })

  it('maps a per-directory command to the tab runOnOpen', () => {
    openLocalTerminalsSideBySide([
      { path: '/a', command: 'claude' },
      { path: '/b', command: 'grok' },
    ])
    const s = useTabsStore.getState()
    expect(s.tabs[0]?.runOnOpen).toBe('claude')
    expect(s.tabs[1]?.runOnOpen).toBe('grok')
  })
})
