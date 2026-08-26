// @vitest-environment jsdom
import type { Settings } from '@shared/ipc'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from './settings'

const DEFAULTS: Settings = {
  theme: 'dark',
  terminalFontSize: 13,
  terminalFontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  keepaliveSeconds: 15,
  terminalColorScheme: 'default',
  terminalRightClickPaste: false,
  mcpEnabled: false,
  mcpApprovalMode: 'always',
  mcpReadHostIds: [],
  mcpExecHostIds: [],
  mcpAllowPatterns: [],
  hasSeenWelcome: false,
  updateChannel: 'stable',
  tmuxEnabled: false,
  terminalProgram: 'default',
  externalTerminal: '',
  defaultHarnessId: '',
  routineSchedulerEnabled: true,
  terminalWorkspaces: [],
  sidebarSections: {
    hosts: true,
    localTerminals: true,
    workspaces: true,
    tunnels: true,
    snippets: true,
    promptBook: true,
    routines: true,
  },
}

const api = {
  settings: {
    get: vi.fn(),
    set: vi.fn(),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', { value: api, configurable: true })
  useSettingsStore.setState({ settings: DEFAULTS, loaded: false })
  document.documentElement.classList.remove('dark')
})

describe('load', () => {
  it('applies the dark theme class on documentElement and stores settings', async () => {
    api.settings.get.mockResolvedValue({ ...DEFAULTS, terminalFontSize: 16 })
    await useSettingsStore.getState().load()
    const state = useSettingsStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.settings.terminalFontSize).toBe(16)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes the dark class for the light theme', async () => {
    document.documentElement.classList.add('dark')
    api.settings.get.mockResolvedValue({ ...DEFAULTS, theme: 'light' })
    await useSettingsStore.getState().load()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(useSettingsStore.getState().settings.theme).toBe('light')
  })

  it('marks loaded even when the IPC call fails, keeping defaults', async () => {
    api.settings.get.mockRejectedValue(new Error('ipc down'))
    await useSettingsStore.getState().load()
    const state = useSettingsStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.settings).toEqual(DEFAULTS)
  })
})

describe('update', () => {
  it('round-trips the patch through the API and applies the result', async () => {
    api.settings.set.mockImplementation(async (patch) => ({ ...DEFAULTS, ...patch }))
    await useSettingsStore.getState().update({ theme: 'light', terminalFontSize: 14 })
    expect(api.settings.set).toHaveBeenCalledWith({ theme: 'light', terminalFontSize: 14 })
    const state = useSettingsStore.getState()
    expect(state.settings.theme).toBe('light')
    expect(state.settings.terminalFontSize).toBe(14)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('switching back to dark re-adds the class', async () => {
    api.settings.set.mockImplementation(async (patch) => ({ ...DEFAULTS, ...patch }))
    await useSettingsStore.getState().update({ theme: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

describe('system theme', () => {
  it('follows prefers-color-scheme: dark when theme is "system"', async () => {
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() }),
      configurable: true,
    })
    api.settings.set.mockImplementation(async (patch) => ({ ...DEFAULTS, ...patch }))
    await useSettingsStore.getState().update({ theme: 'system' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('uses light when the OS prefers light and theme is "system"', async () => {
    document.documentElement.classList.add('dark')
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }),
      configurable: true,
    })
    api.settings.set.mockImplementation(async (patch) => ({ ...DEFAULTS, ...patch }))
    await useSettingsStore.getState().update({ theme: 'system' })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    delete (window as { matchMedia?: unknown }).matchMedia
  })
})
