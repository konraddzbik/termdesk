import { posix } from 'node:path'
import { IPC } from '@shared/channels'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { closeEditsForOwner, closeEditsForSftp, editOpen } from '../sftp/edit-watch'
import { sftpManager } from '../sftp/sftp-manager'
import { transferManager } from '../sftp/transfer-manager'
import type { DataSink } from '../ssh/session-manager'
import { logActivity } from '../store/activity-logger'
import { sanitizeErrorMessage } from './hosts'

const idSchema = z.string().min(1)
const remotePathSchema = z.string().min(1).max(4096)
const localPathSchema = z.string().min(1).max(4096)
const modeSchema = z.number().int().min(0).max(0o7777)
const localPathsSchema = z.array(localPathSchema).min(1).max(10_000)

/** Owners we already watch for destruction, keyed by WebContents id. */
const watchedOwners = new Set<number>()

function watchOwner(owner: Electron.WebContents): void {
  if (watchedOwners.has(owner.id)) return
  watchedOwners.add(owner.id)
  owner.once('destroyed', () => {
    watchedOwners.delete(owner.id)
    transferManager.cancelForOwner(owner.id)
    closeEditsForOwner(owner.id)
    sftpManager.closeForOwner(owner.id)
  })
}

/** Wraps a handler so renderer-visible failures never carry raw internals. */
function safe<T extends unknown[], R>(fn: (...args: T) => R | Promise<R>) {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args)
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err))
    }
  }
}

export function registerSftpIpc(): void {
  ipcMain.handle(
    IPC.sftpOpen,
    safe(async (event: Electron.IpcMainInvokeEvent, rawHostId: unknown) => {
      const hostId = idSchema.parse(rawHostId)
      watchOwner(event.sender)
      const result = await sftpManager.open(hostId, event.sender as DataSink)
      logActivity({ action: 'sftp-open', kind: 'sftp', hostId })
      return result
    }),
  )

  ipcMain.handle(
    IPC.sftpClose,
    safe((event: Electron.IpcMainInvokeEvent, rawSftpId: unknown) => {
      const sftpId = idSchema.parse(rawSftpId)
      closeEditsForSftp(sftpId)
      sftpManager.close(sftpId, event.sender.id)
    }),
  )

  ipcMain.handle(
    IPC.sftpList,
    safe((event: Electron.IpcMainInvokeEvent, rawSftpId: unknown, rawPath: unknown) =>
      sftpManager.list(idSchema.parse(rawSftpId), remotePathSchema.parse(rawPath), event.sender.id),
    ),
  )

  ipcMain.handle(
    IPC.sftpMkdir,
    safe((event: Electron.IpcMainInvokeEvent, rawSftpId: unknown, rawPath: unknown) =>
      sftpManager.mkdir(
        idSchema.parse(rawSftpId),
        remotePathSchema.parse(rawPath),
        event.sender.id,
      ),
    ),
  )

  ipcMain.handle(
    IPC.sftpRename,
    safe(
      (event: Electron.IpcMainInvokeEvent, rawSftpId: unknown, rawFrom: unknown, rawTo: unknown) =>
        sftpManager.rename(
          idSchema.parse(rawSftpId),
          remotePathSchema.parse(rawFrom),
          remotePathSchema.parse(rawTo),
          event.sender.id,
        ),
    ),
  )

  ipcMain.handle(
    IPC.sftpDelete,
    safe((event: Electron.IpcMainInvokeEvent, rawSftpId: unknown, rawPath: unknown) =>
      sftpManager.remove(
        idSchema.parse(rawSftpId),
        remotePathSchema.parse(rawPath),
        event.sender.id,
      ),
    ),
  )

  ipcMain.handle(
    IPC.sftpChmod,
    safe(
      (
        event: Electron.IpcMainInvokeEvent,
        rawSftpId: unknown,
        rawPath: unknown,
        rawMode: unknown,
      ) =>
        sftpManager.chmod(
          idSchema.parse(rawSftpId),
          remotePathSchema.parse(rawPath),
          modeSchema.parse(rawMode),
          event.sender.id,
        ),
    ),
  )

  ipcMain.handle(
    IPC.sftpDownload,
    safe(async (event: Electron.IpcMainInvokeEvent, rawSftpId: unknown, rawPath: unknown) => {
      const sftpId = idSchema.parse(rawSftpId)
      const remotePath = remotePathSchema.parse(rawPath)
      sftpManager.get(sftpId, event.sender.id)

      const window = BrowserWindow.fromWebContents(event.sender)
      const options = { defaultPath: posix.basename(remotePath) }
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      return transferManager.enqueueDownload(
        sftpId,
        remotePath,
        result.filePath,
        event.sender as DataSink,
        null,
      )
    }),
  )

  ipcMain.handle(
    IPC.sftpUpload,
    safe(
      (
        event: Electron.IpcMainInvokeEvent,
        rawSftpId: unknown,
        rawLocalPaths: unknown,
        rawRemoteDir: unknown,
      ) =>
        transferManager.enqueueUploads(
          idSchema.parse(rawSftpId),
          localPathsSchema.parse(rawLocalPaths),
          remotePathSchema.parse(rawRemoteDir),
          event.sender as DataSink,
        ),
    ),
  )

  ipcMain.handle(
    IPC.sftpTransferCancel,
    safe((event: Electron.IpcMainInvokeEvent, rawId: unknown) =>
      transferManager.cancel(idSchema.parse(rawId), event.sender.id),
    ),
  )

  ipcMain.handle(
    IPC.sftpTransferRetry,
    safe((event: Electron.IpcMainInvokeEvent, rawId: unknown) =>
      transferManager.retry(idSchema.parse(rawId), event.sender.id),
    ),
  )

  ipcMain.handle(IPC.sftpTransfersList, (event) => transferManager.list(event.sender.id))

  ipcMain.handle(
    IPC.sftpEditOpen,
    safe((event: Electron.IpcMainInvokeEvent, rawSftpId: unknown, rawPath: unknown) =>
      editOpen(
        idSchema.parse(rawSftpId),
        remotePathSchema.parse(rawPath),
        event.sender as DataSink,
      ),
    ),
  )
}
