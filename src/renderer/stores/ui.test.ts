import type { Host } from '@shared/ipc'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from './ui'

const host: Host = {
  id: 'h1',
  label: 'web',
  hostname: 'example.com',
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
  hasPassword: true,
  hasPassphrase: false,
  hasVncPassword: false,
  rdpPort: null,
  rdpMode: 'direct',
  domain: null,
  hasRdpPassword: false,
  createdAt: 1,
  updatedAt: 1,
}

beforeEach(() => {
  useUiStore.setState({
    hostDialogOpen: false,
    editingHost: null,
    settingsOpen: false,
    paletteOpen: false,
  })
})

describe('openHostDialog', () => {
  it('opens in create mode without a host (editingHost null)', () => {
    useUiStore.getState().openHostDialog()
    const state = useUiStore.getState()
    expect(state.hostDialogOpen).toBe(true)
    expect(state.editingHost).toBeNull()
  })

  it('opens in edit mode with the given host', () => {
    useUiStore.getState().openHostDialog(host)
    const state = useUiStore.getState()
    expect(state.hostDialogOpen).toBe(true)
    expect(state.editingHost).toBe(host)
  })

  it('re-opening without a host clears a previously edited host', () => {
    useUiStore.getState().openHostDialog(host)
    useUiStore.getState().openHostDialog()
    expect(useUiStore.getState().editingHost).toBeNull()
  })
})

describe('flags', () => {
  it('setHostDialogOpen toggles the dialog', () => {
    useUiStore.getState().setHostDialogOpen(true)
    expect(useUiStore.getState().hostDialogOpen).toBe(true)
    useUiStore.getState().setHostDialogOpen(false)
    expect(useUiStore.getState().hostDialogOpen).toBe(false)
  })

  it('setHostDialogOpen(false) clears editingHost', () => {
    useUiStore.getState().openHostDialog(host)
    useUiStore.getState().setHostDialogOpen(false)
    expect(useUiStore.getState().editingHost).toBeNull()
  })

  it('setSettingsOpen and setPaletteOpen are independent', () => {
    useUiStore.getState().setSettingsOpen(true)
    useUiStore.getState().setPaletteOpen(true)
    expect(useUiStore.getState().settingsOpen).toBe(true)
    expect(useUiStore.getState().paletteOpen).toBe(true)
    useUiStore.getState().setSettingsOpen(false)
    expect(useUiStore.getState().settingsOpen).toBe(false)
    expect(useUiStore.getState().paletteOpen).toBe(true)
  })
})
