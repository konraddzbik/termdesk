import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { openRdp } from '../rdp/rdp-manager'
import { logActivity } from '../store/activity-logger'
import { sanitizeErrorMessage } from './hosts'

export function registerRdpIpc(): void {
  ipcMain.handle(IPC.rdpOpen, async (_event, rawHostId: unknown) => {
    try {
      const hostId = z.string().min(1).parse(rawHostId)
      const result = await openRdp(hostId)
      logActivity({ action: 'rdp-open', kind: 'rdp', hostId })
      return result
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err))
    }
  })
}
