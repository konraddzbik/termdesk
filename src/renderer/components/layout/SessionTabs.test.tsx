// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { type SessionTab, useTabsStore } from '@renderer/stores/tabs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTabs } from './SessionTabs'

// Canvas-heavy session views are exercised by e2e smokes; stub them out here.
vi.mock('@renderer/components/terminal/TerminalTab', () => ({
  TerminalTab: ({ tab }: { tab: SessionTab }) => <div>terminal-view:{tab.hostId}</div>,
}))
vi.mock('@renderer/components/sftp/SftpTab', () => ({
  SftpTab: ({ tab }: { tab: SessionTab }) => <div>sftp-view:{tab.hostId}</div>,
}))
vi.mock('@renderer/components/vnc/VncTab', () => ({
  VncTab: ({ tab }: { tab: SessionTab }) => <div>vnc-view:{tab.hostId}</div>,
}))
vi.mock('./WelcomeView', () => ({
  WelcomeView: () => <div>welcome-view</div>,
}))

// A non-closable tab, to verify the close button is hidden for closable: false.
const pinnedTab: SessionTab = { id: 'pinned', kind: 'terminal', title: 'Pinned', closable: false }
const termTab: SessionTab = {
  id: 't1',
  kind: 'terminal',
  title: 'prod-web-1',
  closable: true,
  hostId: 'h1',
}
const sftpTab: SessionTab = {
  id: 't2',
  kind: 'sftp',
  title: 'prod-web-1 — files',
  closable: true,
  hostId: 'h1',
}
const vncTab: SessionTab = {
  id: 't3',
  kind: 'vnc',
  title: 'prod-web-1 — vnc',
  closable: true,
  hostId: 'h2',
}

afterEach(cleanup)

beforeEach(() => {
  useTabsStore.setState({
    tabs: [],
    activeTabId: null,
    secondaryTabId: null,
    splitDirection: null,
    splitRatio: 0.5,
    focusedPane: 'primary',
  })
})

describe('SessionTabs', () => {
  it('renders the Welcome view as a background empty state when there are no tabs', () => {
    render(<SessionTabs />)

    expect(screen.getByText('welcome-view')).toBeInTheDocument()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('renders one tab per store entry inside a labelled tablist', () => {
    useTabsStore.setState({ tabs: [termTab, sftpTab], activeTabId: 't1' })
    render(<SessionTabs />)

    const tablist = screen.getByRole('tablist', { name: 'Sessions' })
    expect(tablist).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['prod-web-1', 'prod-web-1 — files'])
  })

  it('wires tab ↔ panel ARIA attributes and marks only the active tab selected', () => {
    useTabsStore.setState({ tabs: [termTab, sftpTab], activeTabId: 't1' })
    render(<SessionTabs />)

    const active = screen.getByRole('tab', { name: /prod-web-1$/ })
    const inactive = screen.getByRole('tab', { name: /files/ })
    expect(active).toHaveAttribute('aria-selected', 'true')
    expect(active).toHaveAttribute('aria-controls', 'panel-t1')
    expect(active).toHaveAttribute('id', 'tab-t1')
    expect(inactive).toHaveAttribute('aria-selected', 'false')

    // Every tab now renders its own (kept-mounted) panel so sessions survive
    // tab switches; only the active one is visible (others hidden via CSS).
    const panels = screen.getAllByRole('tabpanel', { hidden: true })
    expect(panels).toHaveLength(2)
    const activePanel = panels.find((p) => p.id === 'panel-t1')
    expect(activePanel).toHaveAttribute('aria-labelledby', 'tab-t1')
    expect(screen.getByText('terminal-view:h1')).toBeInTheDocument()
  })

  it('activates a tab on click', async () => {
    const user = userEvent.setup()
    useTabsStore.setState({ tabs: [termTab, sftpTab], activeTabId: 't2' })
    render(<SessionTabs />)

    await user.click(screen.getByRole('tab', { name: /prod-web-1$/ }))

    expect(useTabsStore.getState().activeTabId).toBe('t1')
    expect(screen.getByRole('tab', { name: /prod-web-1$/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('activates a tab with Enter and with Space', () => {
    useTabsStore.setState({ tabs: [termTab, sftpTab], activeTabId: 't2' })
    render(<SessionTabs />)

    fireEvent.keyDown(screen.getByRole('tab', { name: /prod-web-1$/ }), { key: 'Enter' })
    expect(useTabsStore.getState().activeTabId).toBe('t1')

    fireEvent.keyDown(screen.getByRole('tab', { name: /files/ }), { key: ' ' })
    expect(useTabsStore.getState().activeTabId).toBe('t2')
  })

  it('hides the close button for a non-closable tab but shows it for closable tabs', () => {
    useTabsStore.setState({ tabs: [pinnedTab, termTab], activeTabId: 'pinned' })
    render(<SessionTabs />)

    expect(screen.queryByRole('button', { name: 'Close Pinned' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close prod-web-1' })).toBeInTheDocument()
  })

  it('close click removes the tab without activating it first', async () => {
    const user = userEvent.setup()
    useTabsStore.setState({ tabs: [sftpTab, termTab], activeTabId: 't2' })
    render(<SessionTabs />)

    await user.click(screen.getByRole('button', { name: 'Close prod-web-1' }))

    const state = useTabsStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['t2'])
    // stopPropagation: closing an inactive tab must not steal activation.
    expect(state.activeTabId).toBe('t2')
    expect(screen.queryByRole('tab', { name: /prod-web-1$/ })).not.toBeInTheDocument()
  })

  it('shows both panes when split horizontally', async () => {
    const user = userEvent.setup()
    useTabsStore.setState({
      tabs: [termTab, vncTab],
      activeTabId: 't1',
      secondaryTabId: null,
      splitDirection: null,
      splitRatio: 0.5,
      focusedPane: 'primary',
    })
    render(<SessionTabs />)

    await user.click(screen.getByRole('button', { name: 'Split side by side' }))

    const state = useTabsStore.getState()
    expect(state.splitDirection).toBe('horizontal')
    expect(state.secondaryTabId).toBe('t3')
    expect(screen.getByText('terminal-view:h1')).toBeInTheDocument()
    expect(screen.getByText('vnc-view:h2')).toBeInTheDocument()
  })
})
