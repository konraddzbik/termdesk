import { groupInputSchema, IPC } from '@shared/ipc'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { createGroup, deleteGroup, listGroups, updateGroup } from '../store/groups-repo'

export function registerGroupsIpc(): void {
  ipcMain.handle(IPC.groupsList, () => listGroups())

  ipcMain.handle(IPC.groupsCreate, (_event, rawInput: unknown) =>
    createGroup(groupInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.groupsUpdate, (_event, rawId: unknown, rawInput: unknown) =>
    updateGroup(z.string().parse(rawId), groupInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.groupsDelete, (_event, rawId: unknown) => {
    deleteGroup(z.string().parse(rawId))
  })
}
