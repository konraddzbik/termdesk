import { IPC } from '@shared/channels'
import { savedLocalTerminalInputSchema } from '@shared/ipc'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import {
  createLocalTerminal,
  deleteLocalTerminal,
  listLocalTerminals,
  reorderLocalTerminals,
  updateLocalTerminal,
} from '../store/local-terminals-repo'

export function registerLocalTerminalsIpc(): void {
  ipcMain.handle(IPC.localTerminalsList, () => listLocalTerminals())

  ipcMain.handle(IPC.localTerminalsCreate, (_event, rawInput: unknown) =>
    createLocalTerminal(savedLocalTerminalInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.localTerminalsUpdate, (_event, rawId: unknown, rawInput: unknown) =>
    updateLocalTerminal(z.string().parse(rawId), savedLocalTerminalInputSchema.parse(rawInput)),
  )

  ipcMain.handle(IPC.localTerminalsDelete, (_event, rawId: unknown) => {
    deleteLocalTerminal(z.string().parse(rawId))
  })

  ipcMain.handle(IPC.localTerminalsReorder, (_event, rawIds: unknown) =>
    reorderLocalTerminals(z.array(z.string()).parse(rawIds)),
  )

  // Folder picker for "Browse…" when saving/editing a directory.
  ipcMain.handle(IPC.localTerminalsPick, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a directory',
      properties: ['openDirectory', 'createDirectory'],
    }
    const { canceled, filePaths } = await (win
      ? dialog.showOpenDialog(win, opts)
      : dialog.showOpenDialog(opts))
    return canceled || filePaths.length === 0 ? null : (filePaths[0] ?? null)
  })
}
