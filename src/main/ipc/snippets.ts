import { IPC, snippetInputSchema } from '@shared/ipc'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { createSnippet, deleteSnippet, listSnippets, updateSnippet } from '../store/snippets-repo'

export function registerSnippetsIpc(): void {
  ipcMain.handle(IPC.snippetsList, () => listSnippets())

  ipcMain.handle(IPC.snippetsCreate, (_event, rawInput: unknown) =>
    createSnippet(snippetInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.snippetsUpdate, (_event, rawId: unknown, rawInput: unknown) =>
    updateSnippet(z.string().parse(rawId), snippetInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.snippetsDelete, (_event, rawId: unknown) => {
    deleteSnippet(z.string().parse(rawId))
  })
}
