import { IPC, IPC_SEND } from '@shared/channels'
import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DataSink } from '../ssh/session-manager'
import { logActivity } from '../store/activity-logger'
import { verifyVncServerKey } from '../vnc/vnc-known-keys'
import { vncLog } from '../vnc/vnc-log'
import { openVnc } from '../vnc/vnc-manager'
import { sanitizeErrorMessage } from './hosts'

export function registerVncIpc(): void {
  ipcMain.handle(IPC.vncOpen, async (event, rawHostId: unknown) => {
    try {
      const hostId = z.string().min(1).parse(rawHostId)
      const result = await openVnc(hostId, event.sender as DataSink)
      logActivity({ action: 'vnc-open', kind: 'vnc', hostId })
      return result
    } catch (err) {
      vncLog(`openVnc REJECTED: ${sanitizeErrorMessage(err)}`)
      throw new Error(sanitizeErrorMessage(err))
    }
  })

  // Trust-on-first-use verification of a RealVNC RA2 server key. The renderer
  // forwards the server public key (base64) here so the verdict is decided in
  // main against the persisted pin store — the renderer can't be the sole
  // arbiter, and the key never has to round-trip through anything else.
  ipcMain.handle(IPC.vncVerifyServerKey, (_event, rawHostId: unknown, rawKeyB64: unknown) => {
    try {
      const hostId = z.string().min(1).parse(rawHostId)
      const keyB64 = z.string().min(1).max(20_000).parse(rawKeyB64)
      return verifyVncServerKey(hostId, Buffer.from(keyB64, 'base64'))
    } catch (err) {
      vncLog(`verifyVncServerKey REJECTED: ${sanitizeErrorMessage(err)}`)
      return { ok: false, reason: sanitizeErrorMessage(err) }
    }
  })

  // Renderer (VncTab) forwards viewer-side events here so the whole VNC trace —
  // client and server — lands in one debug log.
  ipcMain.on(IPC_SEND.vncDebugLog, (_event, message: unknown) => {
    // Bound the one renderer→main string path that otherwise skipped the
    // length cap every other channel applies.
    const parsed = z.string().max(4096).safeParse(message)
    if (parsed.success) vncLog(`ui: ${parsed.data}`)
  })
}
