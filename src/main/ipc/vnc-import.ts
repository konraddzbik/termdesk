import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  type Host,
  hostInputSchema,
  IPC,
  type SshConfigImportResult,
  sshConfigImportResultSchema,
} from '@shared/ipc'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { getSqlite } from '../store/db'
import { createHost, listHosts } from '../store/hosts-repo'
import { parseVncConnection } from '../vnc/vnc-connection-parser'

/** Label fallback for a `.vnc` file that carries no connection name. */
function labelFromPath(filePath: string): string {
  return basename(filePath, extname(filePath))
}

/**
 * Imports VNC Viewer `.vnc` connection files as VNC-only hosts. Pure-VNC hosts
 * cannot tunnel (no SSH credentials), so each is created with `kind: 'vnc'` and
 * `vncMode: 'direct'`. Runs in a single transaction; hosts whose label already
 * exists are skipped so re-imports stay idempotent.
 */
export function importVncFromFiles(
  files: Array<{ path: string; content: string }>,
): SshConfigImportResult {
  const doImport = getSqlite().transaction((): SshConfigImportResult => {
    const existingLabels = new Set(listHosts().map((host) => host.label))
    const created: Host[] = []
    let skipped = 0

    for (const file of files) {
      const entry = parseVncConnection(file.content, labelFromPath(file.path))
      if (!entry || existingLabels.has(entry.name)) {
        skipped += 1
        continue
      }
      const host = createHost(
        hostInputSchema.parse({
          label: entry.name,
          hostname: entry.hostname,
          // SSH fields are unused for a VNC-only host; agent auth carries no secret.
          username: entry.username ?? '',
          authType: 'agent',
          kind: 'vnc',
          vncPort: entry.vncPort,
          vncMode: 'direct',
        }),
      )
      existingLabels.add(entry.name)
      created.push(host)
    }

    return sshConfigImportResultSchema.parse({
      imported: created.length,
      skipped,
      hosts: created,
    })
  })

  return doImport()
}

const PICKER_OPTIONS: Electron.OpenDialogOptions = {
  title: 'Import VNC connections',
  message: 'Choose one or more VNC Viewer .vnc connection files',
  properties: ['openFile', 'multiSelections'],
  filters: [
    { name: 'VNC connections', extensions: ['vnc'] },
    { name: 'All files', extensions: ['*'] },
  ],
}

/** Prompt for `.vnc` files and import them as VNC hosts. */
async function importVncFromPickedFiles(): Promise<SshConfigImportResult> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePaths } = await (win
    ? dialog.showOpenDialog(win, PICKER_OPTIONS)
    : dialog.showOpenDialog(PICKER_OPTIONS))
  if (canceled || filePaths.length === 0) {
    return { imported: 0, skipped: 0, hosts: [], canceled: true }
  }

  const files: Array<{ path: string; content: string }> = []
  for (const filePath of filePaths) {
    try {
      files.push({ path: filePath, content: await readFile(filePath, 'utf8') })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'unknown'
      throw new Error(`Could not read ${basename(filePath)} (${code})`)
    }
  }

  return importVncFromFiles(files)
}

export function registerVncImportIpc(): void {
  ipcMain.handle(IPC.vncImportFile, () => importVncFromPickedFiles())
}
