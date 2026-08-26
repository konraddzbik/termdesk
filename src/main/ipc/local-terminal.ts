import { IPC, IPC_SEND } from '@shared/channels'
import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DataSink } from '../ssh/session-manager'
import { localTerminalManager } from '../terminal/local-terminal-manager'

const idSchema = z.string().min(1)
const dimSchema = z.number().int().min(1).max(2000)
const openOptsSchema = z.object({ cwd: z.string().min(1).max(4096).optional() }).optional()
/** Bound a single keystroke/paste payload, mirroring the SSH input handler. */
const MAX_INPUT_BYTES = 1_000_000
const inputSchema = z.string().max(MAX_INPUT_BYTES)

/** Kill an owner's PTYs when its window is gone — not only on full app quit. */
const watchedOwners = new Set<number>()

function watchOwner(owner: Electron.WebContents): void {
  if (watchedOwners.has(owner.id)) return
  watchedOwners.add(owner.id)
  owner.once('destroyed', () => {
    watchedOwners.delete(owner.id)
    localTerminalManager.destroyAll(owner.id)
  })
}

export function registerLocalTerminalIpc(): void {
  ipcMain.handle(IPC.localTermOpen, (event, rawOpts: unknown) => {
    watchOwner(event.sender)
    // WebContents structurally satisfies DataSink (id, send, isDestroyed).
    return localTerminalManager.open(
      event.sender as unknown as DataSink,
      openOptsSchema.parse(rawOpts),
    )
  })

  ipcMain.handle(IPC.localTermCwd, (event, rawId: unknown) =>
    localTerminalManager.cwd(idSchema.parse(rawId), event.sender.id),
  )

  ipcMain.handle(
    IPC.localTermResize,
    (event, rawId: unknown, rawCols: unknown, rawRows: unknown) => {
      localTerminalManager.resize(
        idSchema.parse(rawId),
        event.sender.id,
        dimSchema.parse(rawCols),
        dimSchema.parse(rawRows),
      )
    },
  )

  ipcMain.handle(IPC.localTermClose, (event, rawId: unknown) => {
    localTerminalManager.close(idSchema.parse(rawId), event.sender.id)
  })

  // One-way streams (no response).
  ipcMain.on(IPC_SEND.localTermInput, (event, rawId: unknown, rawData: unknown) => {
    const id = idSchema.safeParse(rawId)
    const data = inputSchema.safeParse(rawData)
    if (id.success && data.success) {
      localTerminalManager.write(id.data, event.sender.id, data.data)
    }
  })

  ipcMain.on(IPC_SEND.localTermAttach, (event, rawId: unknown) => {
    const id = idSchema.safeParse(rawId)
    if (id.success) localTerminalManager.attach(id.data, event.sender.id)
  })
}
