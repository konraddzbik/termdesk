import { IPC } from '@shared/channels'
import { savedTunnelInputSchema } from '@shared/ipc'
import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DataSink } from '../ssh/session-manager'
import { tunnelManager } from '../ssh/tunnel-manager'
import { logActivity } from '../store/activity-logger'
import {
  createTunnel,
  deleteTunnel,
  findTunnel,
  listTunnels,
  updateTunnel,
} from '../store/tunnels-repo'
import { sanitizeErrorMessage } from './hosts'

const idSchema = z.string().min(1)

/** Owners we already watch for destruction, keyed by WebContents id. */
const watchedOwners = new Set<number>()

function watchOwner(owner: Electron.WebContents): void {
  if (watchedOwners.has(owner.id)) return
  watchedOwners.add(owner.id)
  owner.once('destroyed', () => {
    watchedOwners.delete(owner.id)
    tunnelManager.destroyForOwner(owner.id)
  })
}

function safe<T extends unknown[], R>(fn: (...args: T) => R | Promise<R>) {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args)
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err))
    }
  }
}

function summary(type: string, listenPort: number): string {
  return `${type} forward on :${listenPort}`
}

export function registerTunnelsIpc(): void {
  // --- Persistence (CRUD) ---
  ipcMain.handle(IPC.tunnelsList, () => listTunnels())

  ipcMain.handle(
    IPC.tunnelsCreate,
    safe((_e: Electron.IpcMainInvokeEvent, rawInput: unknown) =>
      createTunnel(savedTunnelInputSchema.parse(rawInput)),
    ),
  )

  ipcMain.handle(
    IPC.tunnelsUpdate,
    safe((_e: Electron.IpcMainInvokeEvent, rawId: unknown, rawInput: unknown) =>
      updateTunnel(idSchema.parse(rawId), savedTunnelInputSchema.parse(rawInput)),
    ),
  )

  ipcMain.handle(IPC.tunnelsDelete, (event, rawId: unknown) => {
    const id = idSchema.parse(rawId)
    // Stop a running instance for this window before removing the definition.
    tunnelManager.stop(id, event.sender.id)
    deleteTunnel(id)
  })

  // --- Runtime ---
  ipcMain.handle(
    IPC.tunnelStart,
    safe(async (event: Electron.IpcMainInvokeEvent, rawId: unknown) => {
      const id = idSchema.parse(rawId)
      watchOwner(event.sender)
      const status = await tunnelManager.start(id, event.sender as unknown as DataSink)
      const saved = findTunnel(id)
      if (saved) {
        logActivity({
          action: 'tunnel-open',
          kind: 'tunnel',
          hostId: saved.hostId,
          detail: summary(saved.type, saved.listenPort),
        })
      }
      return status
    }),
  )

  ipcMain.handle(IPC.tunnelStop, (event, rawId: unknown) => {
    const id = idSchema.parse(rawId)
    const saved = findTunnel(id)
    tunnelManager.stop(id, event.sender.id)
    if (saved) {
      logActivity({
        action: 'tunnel-close',
        kind: 'tunnel',
        hostId: saved.hostId,
        detail: summary(saved.type, saved.listenPort),
      })
    }
  })

  ipcMain.handle(IPC.tunnelStatus, (event) => tunnelManager.list(event.sender.id))
}
