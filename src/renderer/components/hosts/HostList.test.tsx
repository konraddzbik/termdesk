// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useHostsStore } from '@renderer/stores/hosts'
import { useTabsStore } from '@renderer/stores/tabs'
import type { Group, Host } from '@shared/ipc'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostList } from './HostList'

function makeHost(overrides: Partial<Host> & { id: string; label: string }): Host {
  return {
    hostname: `${overrides.label}.example.com`,
    port: 22,
    username: 'root',
    authType: 'password',
    keyPath: null,
    proxyJump: null,
    defaultPath: null,
    groupId: null,
    credentialId: null,
    tags: [],
    color: null,
    vncPort: null,
    vncMode: 'tunnel',
    kind: 'ssh',
    hasPassword: false,
    hasPassphrase: false,
    hasVncPassword: false,
    rdpPort: null,
    rdpMode: 'direct',
    domain: null,
    hasRdpPassword: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const prodGroup: Group = {
  id: 'g1',
  name: 'Production',
  color: '#ff0000',
  parentId: null,
  sortOrder: 0,
}
const apiHost = makeHost({ id: 'h1', label: 'api-1', groupId: 'g1', tags: ['web'], kind: 'both' })
const dbHost = makeHost({ id: 'h2', label: 'db-1', hostname: 'db.internal', tags: ['database'] })

const initialHostsState = useHostsStore.getState()

let deleteHost: ReturnType<typeof vi.fn>

beforeEach(() => {
  useHostsStore.setState(initialHostsState, true)
  deleteHost = vi.fn(async () => true)
  useHostsStore.setState({
    hosts: [apiHost, dbHost],
    groups: [prodGroup],
    query: '',
    loading: false,
    deleteHost: deleteHost as never,
  })
  useTabsStore.setState({ tabs: [], activeTabId: null })
})

afterEach(() => {
  cleanup()
  useHostsStore.setState(initialHostsState, true)
})

function renderList(): {
  onAddHost: ReturnType<typeof vi.fn>
  onEditHost: ReturnType<typeof vi.fn>
  onDuplicateHost: ReturnType<typeof vi.fn>
} {
  const onAddHost = vi.fn()
  const onEditHost = vi.fn()
  const onDuplicateHost = vi.fn()
  render(
    <HostList onAddHost={onAddHost} onEditHost={onEditHost} onDuplicateHost={onDuplicateHost} />,
  )
  return { onAddHost, onEditHost, onDuplicateHost }
}

describe('HostList rendering', () => {
  it('renders grouped hosts under their group header and the rest under Ungrouped', () => {
    renderList()

    // Both group headers and both hosts render in the flattened tree.
    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.getByText('Ungrouped')).toBeInTheDocument()
    expect(screen.getByText('api-1')).toBeInTheDocument()
    expect(screen.getByText('db-1')).toBeInTheDocument()
    expect(screen.getByText('root@db.internal:22')).toBeInTheDocument()

    // api-1 sits in the Production section: it appears after the Production
    // header and before the Ungrouped header in document order.
    const prodHeader = screen.getByText('Production')
    const api = screen.getByText('api-1')
    const ungroupedHeader = screen.getByText('Ungrouped')
    const isBefore = (a: Element, b: Element): boolean =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(isBefore(prodHeader, api)).toBe(true)
    expect(isBefore(api, ungroupedHeader)).toBe(true)
  })

  it('collapses and expands a group when its header is clicked', async () => {
    const user = userEvent.setup()
    renderList()

    expect(screen.getByText('api-1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Production/ }))
    expect(screen.queryByText('api-1')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Production/ }))
    expect(screen.getByText('api-1')).toBeInTheDocument()
  })

  it('shows the empty state with a working add button when there are no hosts', async () => {
    const user = userEvent.setup()
    useHostsStore.setState({ hosts: [] })
    const { onAddHost } = renderList()

    expect(screen.getByText('No hosts yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Add your first host/ }))
    expect(onAddHost).toHaveBeenCalledTimes(1)
  })
})

describe('HostList filtering', () => {
  it('filters by label and hides groups without matches', () => {
    useHostsStore.setState({ query: 'db-' })
    renderList()

    expect(screen.getByText('db-1')).toBeInTheDocument()
    expect(screen.queryByText('api-1')).not.toBeInTheDocument()
    // The Production branch has no matches, so it is pruned entirely.
    expect(screen.queryByText('Production')).not.toBeInTheDocument()
  })

  it('filters by hostname', () => {
    useHostsStore.setState({ query: 'db.internal' })
    renderList()

    expect(screen.getByText('db-1')).toBeInTheDocument()
    expect(screen.queryByText('api-1')).not.toBeInTheDocument()
  })

  it('filters by tag', () => {
    useHostsStore.setState({ query: 'WEB' })
    renderList()

    expect(screen.getByText('api-1')).toBeInTheDocument()
    expect(screen.queryByText('db-1')).not.toBeInTheDocument()
  })

  it('shows the no-match state when the query matches nothing', () => {
    useHostsStore.setState({ query: 'zzz-nothing' })
    renderList()

    expect(screen.getByText('No hosts match')).toBeInTheDocument()
    expect(screen.queryByText('api-1')).not.toBeInTheDocument()
  })
})

describe('HostList actions', () => {
  it('connect opens a terminal tab for the host and activates it', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: 'Connect to api-1' }))

    const { tabs, activeTabId } = useTabsStore.getState()
    expect(tabs).toHaveLength(1)
    const opened = tabs[0]
    expect(opened).toMatchObject({
      kind: 'terminal',
      title: 'api-1',
      hostId: 'h1',
      closable: true,
    })
    expect(activeTabId).toBe(opened?.id)
  })

  it('clicking the host row itself also opens a terminal tab', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: 'Open terminal for db-1' }))

    expect(useTabsStore.getState().tabs[0]).toMatchObject({ kind: 'terminal', hostId: 'h2' })
  })

  it('sftp action opens an sftp tab', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: 'Browse files on api-1' }))

    expect(useTabsStore.getState().tabs[0]).toMatchObject({
      kind: 'sftp',
      title: 'api-1 — files',
      hostId: 'h1',
    })
  })

  it('vnc action opens a vnc tab', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: 'Open VNC desktop for api-1' }))

    expect(useTabsStore.getState().tabs[0]).toMatchObject({
      kind: 'vnc',
      title: 'api-1 — vnc',
      hostId: 'h1',
    })
  })

  it('edit action passes the host to onEditHost', async () => {
    const user = userEvent.setup()
    const { onEditHost } = renderList()

    await user.click(screen.getByRole('button', { name: 'Edit db-1' }))

    expect(onEditHost).toHaveBeenCalledWith(dbHost)
  })

  it('delete requires confirmation before calling the store', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: 'Delete api-1' }))
    expect(deleteHost).not.toHaveBeenCalled()
    expect(screen.getByText('Delete?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm delete api-1' }))
    expect(deleteHost).toHaveBeenCalledWith('h1')
  })

  it('cancelling the delete confirmation keeps the host', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: 'Delete api-1' }))
    await user.click(screen.getByRole('button', { name: 'Cancel delete' }))

    expect(deleteHost).not.toHaveBeenCalled()
    expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
    expect(screen.getByText('api-1')).toBeInTheDocument()
  })
})
