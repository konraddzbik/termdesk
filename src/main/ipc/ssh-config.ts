import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import {
  type Host,
  hostInputSchema,
  IPC,
  type SshConfigImportResult,
  sshConfigImportResultSchema,
} from '@shared/ipc'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { resolveSshConfigIncludes } from '../ssh/ssh-config-include'
import { parseSshConfig } from '../ssh/ssh-config-parser'
import { getSqlite } from '../store/db'
import { createHost, listHosts } from '../store/hosts-repo'

function expandTilde(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Parses OpenSSH-config-format text and imports the entries as hosts. Shared by
 * the default (~/.ssh/config) and "choose a file" paths. Runs inside a single
 * transaction so a mid-loop failure can't leave a partial import behind; hosts
 * whose label already exists are skipped (idempotent re-imports).
 */
export function importFromContent(content: string): SshConfigImportResult {
  const entries = parseSshConfig(content)

  const doImport = getSqlite().transaction((): SshConfigImportResult => {
    const existingLabels = new Set(listHosts().map((host) => host.label))
    const created: Host[] = []
    let skipped = 0

    for (const entry of entries) {
      if (existingLabels.has(entry.alias)) {
        skipped += 1
        continue
      }
      const host = createHost(
        hostInputSchema.parse({
          label: entry.alias,
          hostname: entry.hostname,
          port: entry.port,
          username: entry.username ?? userInfo().username,
          authType: entry.identityFile ? 'key' : 'agent',
          keyPath: entry.identityFile ? expandTilde(entry.identityFile) : null,
          proxyJump: entry.proxyJump,
          kind: 'ssh',
        }),
      )
      existingLabels.add(entry.alias)
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

/**
 * Import from the user's default ~/.ssh/config, following `Include` directives
 * (missing file → empty result).
 */
async function importDefaultSshConfig(): Promise<SshConfigImportResult> {
  const configPath = join(homedir(), '.ssh', 'config')

  let resolved: Awaited<ReturnType<typeof resolveSshConfigIncludes>>
  try {
    resolved = await resolveSshConfigIncludes(configPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { imported: 0, skipped: 0, hosts: [], filesRead: 0 }
    }
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown'
    throw new Error(`Could not read ~/.ssh/config (${code})`)
  }

  return { ...importFromContent(resolved.content), filesRead: resolved.filesRead }
}

const PICKER_OPTIONS: Electron.OpenDialogOptions = {
  title: 'Import hosts from an SSH config file',
  message: 'Choose a file in OpenSSH config format',
  properties: ['openFile'],
  filters: [
    { name: 'SSH config', extensions: ['config', 'conf', 'txt', 'cfg'] },
    { name: 'All files', extensions: ['*'] },
  ],
}

/** Prompt for an OpenSSH-config-format file and import its hosts. */
async function importSshConfigFromPickedFile(): Promise<SshConfigImportResult> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePaths } = await (win
    ? dialog.showOpenDialog(win, PICKER_OPTIONS)
    : dialog.showOpenDialog(PICKER_OPTIONS))
  const filePath = filePaths[0]
  if (canceled || !filePath) {
    return { imported: 0, skipped: 0, hosts: [], canceled: true }
  }

  let resolved: Awaited<ReturnType<typeof resolveSshConfigIncludes>>
  try {
    resolved = await resolveSshConfigIncludes(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown'
    throw new Error(`Could not read the selected file (${code})`)
  }

  return { ...importFromContent(resolved.content), filesRead: resolved.filesRead }
}

export function registerSshConfigIpc(): void {
  ipcMain.handle(IPC.sshConfigImport, () => importDefaultSshConfig())
  ipcMain.handle(IPC.sshConfigImportFile, () => importSshConfigFromPickedFile())
}
