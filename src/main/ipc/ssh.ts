import { IPC, IPC_SEND } from '@shared/channels'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { type DataSink, sessionManager } from '../ssh/session-manager'
import { sanitizeErrorMessage } from './hosts'

/** Renderer keystroke payload cap — defends against runaway send() loops. */
const MAX_INPUT_BYTES = 1_000_000

const sessionIdSchema = z.string().min(1)
const dimensionSchema = z.number().int().min(1).max(1000)

/** Owners we already watch for destruction, keyed by WebContents id. */
const watchedOwners = new Set<number>()

export function registerSshIpc(): void {
  ipcMain.handle(IPC.sshConnect, async (event, rawHostId: unknown) => {
    const hostId = z.string().parse(rawHostId)
    const owner = event.sender

    // Tear down this renderer's sessions when its WebContents goes away.
    if (!watchedOwners.has(owner.id)) {
      watchedOwners.add(owner.id)
      owner.once('destroyed', () => {
        watchedOwners.delete(owner.id)
        sessionManager.destroyForOwner(owner.id)
      })
    }

    try {
      // WebContents structurally satisfies DataSink (id, send, isDestroyed).
      return await sessionManager.connect(hostId, owner as DataSink)
    } catch (err) {
      // Never leak raw error internals (stacks, paths) to the renderer.
      throw new Error(sanitizeErrorMessage(err))
    }
  })

  ipcMain.handle(IPC.sshAbortConnect, (event, rawHostId: unknown) => {
    const hostId = z.string().parse(rawHostId)
    sessionManager.abortPendingConnect(hostId, event.sender.id)
  })

  ipcMain.handle(IPC.sshDisconnect, (event, rawSessionId: unknown) => {
    sessionManager.disconnect(sessionIdSchema.parse(rawSessionId), event.sender.id)
  })

  ipcMain.handle(
    IPC.sshResize,
    (event, rawSessionId: unknown, rawCols: unknown, rawRows: unknown) => {
      sessionManager.resize(
        sessionIdSchema.parse(rawSessionId),
        dimensionSchema.parse(rawCols),
        dimensionSchema.parse(rawRows),
        event.sender.id,
      )
    },
  )

  ipcMain.handle(IPC.sshHostKeyRespond, (event, rawRequestId: unknown, rawAccept: unknown) => {
    sessionManager.respondHostKey(
      z.string().parse(rawRequestId),
      z.boolean().parse(rawAccept),
      event.sender.id,
    )
  })

  // Renderer signals its terminal is subscribed; flush buffered early output.
  ipcMain.on(IPC_SEND.sshAttach, (event, rawSessionId: unknown) => {
    const sessionId = sessionIdSchema.safeParse(rawSessionId)
    if (!sessionId.success) return
    sessionManager.attach(sessionId.data, event.sender.id)
  })

  // One-way keystroke stream. Invalid payloads are dropped silently — there
  // is no reply channel and throwing would only produce console noise.
  ipcMain.on(IPC_SEND.sshInput, (event, rawSessionId: unknown, rawData: unknown) => {
    const sessionId = sessionIdSchema.safeParse(rawSessionId)
    const data = z.string().max(MAX_INPUT_BYTES).safeParse(rawData)
    if (!sessionId.success || !data.success) return
    sessionManager.write(sessionId.data, data.data, event.sender.id)
  })
}
