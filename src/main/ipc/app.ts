import { externalTerminalOpenSchema, IPC, versionsSchema } from '@shared/ipc'
import { app, ipcMain } from 'electron'
import { getSettings } from '../store/settings'
import { detectAiHarnesses } from '../terminal/ai-harness-detect'
import {
  detectExternalTerminals,
  openExternalTerminal,
  prewarmExternalTerminals,
} from '../terminal/external-terminals'
import { detectTerminalPrograms, prewarmTerminalPrograms } from '../terminal/terminal-programs'

export function registerAppIpc(): void {
  // Probe installed terminal programs early so the synchronous local-terminal
  // open path has a populated availability cache by the first terminal.
  prewarmTerminalPrograms()
  prewarmExternalTerminals()

  ipcMain.handle(IPC.appGetVersions, () =>
    versionsSchema.parse({
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    }),
  )

  ipcMain.handle(IPC.terminalsDetect, () => detectTerminalPrograms())

  ipcMain.handle(IPC.externalTerminalsDetect, () => detectExternalTerminals())

  ipcMain.handle(IPC.harnessesDetect, () => detectAiHarnesses())

  ipcMain.handle(IPC.externalTerminalOpen, (_event, rawInput) => {
    const input = externalTerminalOpenSchema.parse(rawInput)
    return openExternalTerminal({
      cwd: input.cwd,
      id: input.id,
      savedPreference: getSettings().externalTerminal,
    })
  })
}
