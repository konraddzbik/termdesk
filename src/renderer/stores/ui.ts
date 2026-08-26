import type { Host } from '@shared/ipc'
import { create } from 'zustand'

/** Cross-cutting UI state: dialogs and the command palette. */
interface UiState {
  hostDialogOpen: boolean
  editingHost: Host | null
  duplicatingHost: Host | null
  settingsOpen: boolean
  credentialsOpen: boolean
  groupsOpen: boolean
  tunnelDialogOpen: boolean
  promptCreateOpen: boolean
  paletteOpen: boolean
  openHostDialog(host?: Host | null): void
  setHostDialogOpen(open: boolean): void
  openDuplicateHost(host: Host): void
  closeDuplicateHost(): void
  setSettingsOpen(open: boolean): void
  setCredentialsOpen(open: boolean): void
  setGroupsOpen(open: boolean): void
  setTunnelDialogOpen(open: boolean): void
  setPromptCreateOpen(open: boolean): void
  setPaletteOpen(open: boolean): void
}

export const useUiStore = create<UiState>((set) => ({
  hostDialogOpen: false,
  editingHost: null,
  duplicatingHost: null,
  settingsOpen: false,
  credentialsOpen: false,
  groupsOpen: false,
  tunnelDialogOpen: false,
  promptCreateOpen: false,
  paletteOpen: false,
  openHostDialog: (host = null) => set({ hostDialogOpen: true, editingHost: host }),
  setHostDialogOpen: (open) =>
    set((s) => ({ hostDialogOpen: open, editingHost: open ? s.editingHost : null })),
  openDuplicateHost: (host) => set({ duplicatingHost: host }),
  closeDuplicateHost: () => set({ duplicatingHost: null }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setCredentialsOpen: (open) => set({ credentialsOpen: open }),
  setGroupsOpen: (open) => set({ groupsOpen: open }),
  setTunnelDialogOpen: (open) => set({ tunnelDialogOpen: open }),
  setPromptCreateOpen: (open) => set({ promptCreateOpen: open }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
}))
