import { IPC } from '@shared/channels'
import { promptInputSchema } from '@shared/ipc'
import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  createPrompt,
  deletePrompt,
  listPrompts,
  reorderPrompts,
  updatePrompt,
} from '../store/prompts-repo'

export function registerPromptsIpc(): void {
  ipcMain.handle(IPC.promptsList, () => listPrompts())

  ipcMain.handle(IPC.promptsCreate, (_event, rawInput: unknown) =>
    createPrompt(promptInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.promptsUpdate, (_event, rawId: unknown, rawInput: unknown) =>
    updatePrompt(z.string().parse(rawId), promptInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.promptsDelete, (_event, rawId: unknown) => {
    deletePrompt(z.string().parse(rawId))
  })

  ipcMain.handle(IPC.promptsReorder, (_event, rawIds: unknown) =>
    reorderPrompts(z.array(z.string()).parse(rawIds)),
  )
}
