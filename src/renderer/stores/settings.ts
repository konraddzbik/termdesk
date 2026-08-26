import type { Settings, SettingsPatch } from '@shared/ipc'
import { create } from 'zustand'

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

interface SettingsState {
  settings: Settings
  loaded: boolean
  load(): Promise<void>
  update(patch: SettingsPatch): Promise<void>
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(theme: Settings['theme']): void {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULTS,
  loaded: false,

  load: async () => {
    try {
      const settings = await window.api.settings.get()
      applyTheme(settings.theme)
      set({ settings, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  update: async (patch) => {
    const settings = await window.api.settings.set(patch)
    applyTheme(settings.theme)
    set({ settings })
  },
}))

// When following the OS ("system"), re-apply live as the OS light/dark preference flips.
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useSettingsStore.getState().settings.theme === 'system') applyTheme('system')
  })
}
