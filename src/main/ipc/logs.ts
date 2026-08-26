import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { clearActivity, listActivity } from '../store/activity-log-repo'

export function registerLogsIpc(): void {
  ipcMain.handle(IPC.logList, () => listActivity())
  ipcMain.handle(IPC.logClear, () => {
    clearActivity()
  })
}
