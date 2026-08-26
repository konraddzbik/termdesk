import { IPC } from '@shared/channels'
import { settingsPatchSchema } from '@shared/ipc'
import { ipcMain } from 'electron'
import { getSettings, updateSettings } from '../store/settings'

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSet, (_event, rawPatch: unknown) =>
    updateSettings(settingsPatchSchema.parse(rawPatch)),
  )
}
