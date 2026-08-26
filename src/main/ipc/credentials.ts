import { credentialInputSchema, IPC } from '@shared/ipc'
import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  createCredential,
  deleteCredential,
  listCredentials,
  updateCredential,
} from '../store/credentials-repo'

export function registerCredentialsIpc(): void {
  ipcMain.handle(IPC.credentialsList, () => listCredentials())

  ipcMain.handle(IPC.credentialsCreate, (_event, rawInput: unknown) =>
    createCredential(credentialInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.credentialsUpdate, (_event, rawId: unknown, rawInput: unknown) =>
    updateCredential(z.string().parse(rawId), credentialInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.credentialsDelete, (_event, rawId: unknown) => {
    deleteCredential(z.string().parse(rawId))
  })
}
