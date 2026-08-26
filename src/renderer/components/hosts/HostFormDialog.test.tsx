// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useCredentialsStore } from '@renderer/stores/credentials'
import { useHostsStore } from '@renderer/stores/hosts'
import type { Credential, Group, Host, HostInput } from '@shared/ipc'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostFormDialog } from './HostFormDialog'

// ---------------------------------------------------------------------------
// jsdom polyfills required by radix-ui Dialog/Select.
// ---------------------------------------------------------------------------
beforeAll(() => {
  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    id: 'h1',
    label: 'prod-web-1',
    hostname: 'web.example.com',
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

const initialHostsState = useHostsStore.getState()
const initialCredentialsState = useCredentialsStore.getState()

let createHost: ReturnType<typeof vi.fn>
let updateHost: ReturnType<typeof vi.fn>
let loadCredentials: ReturnType<typeof vi.fn>
let user: UserEvent

beforeEach(() => {
  useHostsStore.setState(initialHostsState, true)
  useCredentialsStore.setState(initialCredentialsState, true)
  createHost = vi.fn(async (input: HostInput) => makeHost({ label: input.label }))
  updateHost = vi.fn(async (_id: string, input: HostInput) => makeHost({ label: input.label }))
  loadCredentials = vi.fn(async () => {})
  useHostsStore.setState({
    createHost: createHost as never,
    updateHost: updateHost as never,
    groups: [
      { id: 'g1', name: 'Production', color: null, parentId: null, sortOrder: 0 },
    ] satisfies Group[],
  })
  useCredentialsStore.setState({ loadAll: loadCredentials as never })
  user = userEvent.setup({ pointerEventsCheck: 0 })
})

afterEach(() => {
  cleanup()
  useHostsStore.setState(initialHostsState, true)
  useCredentialsStore.setState(initialCredentialsState, true)
})

async function fillRequired(): Promise<void> {
  await user.type(screen.getByLabelText('Label'), 'web-1')
  await user.type(screen.getByLabelText('Hostname'), 'web.example.com')
  await user.type(screen.getByLabelText('Username'), 'deploy')
}

describe('HostFormDialog — create mode', () => {
  it('submits parsed input: numeric port, null group, no secret keys when untouched', async () => {
    const onOpenChange = vi.fn()
    render(<HostFormDialog open onOpenChange={onOpenChange} />)

    await fillRequired()
    const portInput = screen.getByLabelText('Port')
    await user.clear(portInput)
    await user.type(portInput, '2222')
    await user.click(screen.getByRole('button', { name: 'Add host' }))

    await waitFor(() => expect(createHost).toHaveBeenCalledTimes(1))
    const input = createHost.mock.calls[0]?.[0] as HostInput
    expect(input).toMatchObject({
      label: 'web-1',
      hostname: 'web.example.com',
      port: 2222,
      username: 'deploy',
      authType: 'password',
      groupId: null,
      keyPath: null,
      proxyJump: null,
      defaultPath: null,
      tags: [],
      vncPort: null,
      vncMode: 'tunnel',
    })
    expect(typeof input.port).toBe('number')
    // Untouched secrets must not appear in the payload at all.
    expect('password' in input).toBe(false)
    expect('clearPassword' in input).toBe(false)
    expect('vncPassword' in input).toBe(false)
    expect('clearVncPassword' in input).toBe(false)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('sends the password only when one was typed', async () => {
    render(<HostFormDialog open onOpenChange={vi.fn()} />)

    await fillRequired()
    await user.type(screen.getByLabelText('Password'), 'hunter2')
    await user.click(screen.getByRole('button', { name: 'Add host' }))

    await waitFor(() => expect(createHost).toHaveBeenCalledTimes(1))
    const input = createHost.mock.calls[0]?.[0] as HostInput
    expect(input.password).toBe('hunter2')
    expect('clearPassword' in input).toBe(false)
  })

  it('switching auth type swaps the credential sections', async () => {
    render(<HostFormDialog open onOpenChange={vi.fn()} />)

    // Default: password auth.
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByLabelText('Key path')).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Authentication' }))
    await user.click(screen.getByRole('option', { name: 'Private key' }))
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Key path')).toBeInTheDocument()
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Authentication' }))
    await user.click(screen.getByRole('option', { name: 'SSH agent' }))
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Key path')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument()
  })

  it('key auth submits keyPath and passphrase (and no password keys)', async () => {
    render(<HostFormDialog open onOpenChange={vi.fn()} />)

    await fillRequired()
    await user.click(screen.getByRole('combobox', { name: 'Authentication' }))
    await user.click(screen.getByRole('option', { name: 'Private key' }))
    await user.type(screen.getByLabelText('Key path'), '~/.ssh/id_ed25519')
    await user.type(screen.getByLabelText('Passphrase'), 'sekret')
    await user.click(screen.getByRole('button', { name: 'Add host' }))

    await waitFor(() => expect(createHost).toHaveBeenCalledTimes(1))
    const input = createHost.mock.calls[0]?.[0] as HostInput
    expect(input.authType).toBe('key')
    expect(input.keyPath).toBe('~/.ssh/id_ed25519')
    expect(input.passphrase).toBe('sekret')
    expect('password' in input).toBe(false)
  })

  it('submits VNC port/mode/password when filled', async () => {
    render(<HostFormDialog open onOpenChange={vi.fn()} />)

    await fillRequired()
    // Enable VNC section by choosing a kind that supports it
    await user.click(screen.getByText('Both'))
    await user.type(screen.getByLabelText('VNC port'), '5901')
    await user.click(screen.getByRole('combobox', { name: 'VNC connection' }))
    await user.click(screen.getByRole('option', { name: 'Direct TCP' }))
    await user.type(screen.getByLabelText('VNC password'), 'vnc-pw')
    await user.click(screen.getByRole('button', { name: 'Add host' }))

    await waitFor(() => expect(createHost).toHaveBeenCalledTimes(1))
    const input = createHost.mock.calls[0]?.[0] as HostInput
    expect(input.vncPort).toBe(5901)
    expect(input.vncMode).toBe('direct')
    expect(input.vncPassword).toBe('vnc-pw')
  })

  it('shows validation errors for empty label and bad port and blocks submit', async () => {
    render(<HostFormDialog open onOpenChange={vi.fn()} />)

    await user.type(screen.getByLabelText('Hostname'), 'web.example.com')
    await user.type(screen.getByLabelText('Username'), 'root')
    // An empty port passes native number-input constraints but fails the form's own check.
    await user.clear(screen.getByLabelText('Port'))
    await user.click(screen.getByRole('button', { name: 'Add host' }))

    expect(await screen.findByText('Label is required')).toBeInTheDocument()
    expect(screen.getByText('Port must be between 1 and 65535')).toBeInTheDocument()
    expect(screen.getByLabelText('Label')).toHaveAttribute('aria-invalid', 'true')
    expect(createHost).not.toHaveBeenCalled()
  })

  it('renders the error inline and keeps the dialog open when the store rejects', async () => {
    createHost.mockRejectedValue(
      new Error("Error invoking remote method 'hosts:create': Error: label already exists"),
    )
    const onOpenChange = vi.fn()
    render(<HostFormDialog open onOpenChange={onOpenChange} />)

    await fillRequired()
    await user.click(screen.getByRole('button', { name: 'Add host' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('label already exists')
    // IPC wrapper prefix stripped.
    expect(alert).not.toHaveTextContent('remote method')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add host' })).toBeEnabled()
  })

  it('clears typed secrets when the dialog closes and reopens', async () => {
    const { rerender } = render(<HostFormDialog open onOpenChange={vi.fn()} />)

    await user.type(screen.getByLabelText('Password'), 'topsecret')
    // Enable VNC fields
    await user.click(screen.getByText('Both'))
    await user.type(screen.getByLabelText('VNC password'), 'vnc-secret')

    rerender(<HostFormDialog open={false} onOpenChange={vi.fn()} />)
    rerender(<HostFormDialog open onOpenChange={vi.fn()} />)

    // Re-enable VNC section after reopen (create mode defaults to ssh kind)
    await user.click(screen.getByText('Both'))

    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('VNC password')).toHaveValue('')
  })
})

describe('HostFormDialog — edit mode', () => {
  const savedHost = makeHost({
    id: 'h7',
    label: 'db-1',
    hostname: 'db.internal',
    port: 2200,
    username: 'admin',
    kind: 'both',
    vncMode: 'direct',
    hasPassword: true,
    hasVncPassword: true,
    rdpPort: null,
    rdpMode: 'direct',
    domain: null,
    hasRdpPassword: false,
  })

  it('prefills fields, shows the unchanged placeholder and omits the password when untouched', async () => {
    render(<HostFormDialog open onOpenChange={vi.fn()} host={savedHost} />)

    await waitFor(() => expect(loadCredentials).toHaveBeenCalled())
    expect(await screen.findByLabelText('Label')).toHaveValue('db-1')
    expect(screen.getByLabelText('Port')).toHaveValue(2200)
    const passwordInput = screen.getByLabelText('Password')
    expect(passwordInput).toHaveAttribute('placeholder', '••• unchanged')
    expect(passwordInput).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateHost).toHaveBeenCalledTimes(1))
    expect(updateHost.mock.calls[0]?.[0]).toBe('h7')
    const input = updateHost.mock.calls[0]?.[1] as HostInput
    expect('password' in input).toBe(false)
    expect('clearPassword' in input).toBe(false)
    expect(createHost).not.toHaveBeenCalled()
  })

  it('"Clear saved password" sends clearPassword and disables the input', async () => {
    render(<HostFormDialog open onOpenChange={vi.fn()} host={savedHost} />)

    await user.click(screen.getByLabelText('Clear saved password'))
    expect(screen.getByLabelText('Password')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateHost).toHaveBeenCalledTimes(1))
    const input = updateHost.mock.calls[0]?.[1] as HostInput
    expect(input.clearPassword).toBe(true)
    expect('password' in input).toBe(false)
  })

  it('typing a new password replaces it instead of clearing', async () => {
    render(<HostFormDialog open onOpenChange={vi.fn()} host={savedHost} />)

    await user.type(screen.getByLabelText('Password'), 'new-pass')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateHost).toHaveBeenCalledTimes(1))
    const input = updateHost.mock.calls[0]?.[1] as HostInput
    expect(input.password).toBe('new-pass')
    expect('clearPassword' in input).toBe(false)
  })

  it('shows the saved managed VNC credential in the dropdown after reopen', async () => {
    const vncCred: Credential = {
      id: 'cred-vnc-1',
      label: 'RealVNC login',
      type: 'vnc',
      username: 'vncuser',
      authType: 'password',
      keyPath: null,
      hasPassword: true,
      hasPassphrase: false,
      createdAt: 0,
      updatedAt: 0,
    }
    const loadAll = vi.fn(async () => {})
    useCredentialsStore.setState({
      credentials: [vncCred],
      loadAll: loadAll as never,
    })
    const hostWithCred = makeHost({
      kind: 'vnc',
      vncMode: 'direct',
      credentialId: vncCred.id,
      username: '',
    })

    const { rerender } = render(<HostFormDialog open onOpenChange={vi.fn()} host={hostWithCred} />)
    await waitFor(() => expect(loadAll).toHaveBeenCalled())
    expect(screen.getByRole('combobox', { name: 'VNC credential' })).toHaveTextContent(
      'RealVNC login',
    )

    rerender(<HostFormDialog open={false} onOpenChange={vi.fn()} host={hostWithCred} />)
    rerender(<HostFormDialog open onOpenChange={vi.fn()} host={hostWithCred} />)
    await waitFor(() => expect(loadAll).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('combobox', { name: 'VNC credential' })).toHaveTextContent(
      'RealVNC login',
    )
  })

  it('VNC password clear semantics mirror the SSH password ones', async () => {
    render(<HostFormDialog open onOpenChange={vi.fn()} host={savedHost} />)

    await waitFor(() => expect(loadCredentials).toHaveBeenCalled())
    const vncInput = await screen.findByLabelText('VNC password')
    expect(vncInput).toHaveAttribute('placeholder', '••• unchanged')
    await user.click(screen.getByLabelText('Clear saved VNC password'))
    expect(vncInput).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateHost).toHaveBeenCalledTimes(1))
    const input = updateHost.mock.calls[0]?.[1] as HostInput
    expect(input.clearVncPassword).toBe(true)
    expect('vncPassword' in input).toBe(false)
  })
})
