import { createWriteStream, watch } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shell } from 'electron'
import type { DataSink } from '../ssh/session-manager'
import { sftpManager } from './sftp-manager'
import { safeLocalName } from './sftp-name-safety'
import { transferManager } from './transfer-manager'

/**
 * Edit-in-place: download the remote file to a private temp dir, open it with
 * the OS default editor, and auto-upload (as a queued transfer with progress)
 * whenever the local copy is saved.
 */

const SAVE_DEBOUNCE_MS = 500

interface EditWatch {
  readonly sftpId: string
  readonly ownerId: number
  close(): void
}

const watches = new Map<string, EditWatch>() // key: `${sftpId}:${remotePath}`

/** Temp dirs created by edit-in-place, so a sweep can recognize its own. */
const EDIT_DIR_PREFIX = 'termdesk-edit-'

/**
 * Deletes edit-in-place temp dirs left behind by a PREVIOUS run of the app.
 *
 * `closeAllEdits()` is wired to `before-quit`, which does not fire on a crash,
 * an OOM kill, a forced logout or SIGKILL — so a plaintext copy of whatever the
 * user was editing (an `.env`, a private key, an Ansible vault password) could
 * sit in the system temp dir indefinitely. No live watch can reference a
 * directory created by an earlier process, so sweeping at startup is safe.
 * Best-effort: any failure here must not stop the app from starting.
 */
export async function sweepOrphanedEditDirs(): Promise<void> {
  try {
    const base = tmpdir()
    const entries = await readdir(base)
    await Promise.all(
      entries
        .filter((name) => name.startsWith(EDIT_DIR_PREFIX))
        .map((name) => rm(join(base, name), { recursive: true, force: true }).catch(() => {})),
    )
  } catch {
    // temp dir unreadable — nothing to sweep
  }
}

export async function editOpen(sftpId: string, remotePath: string, owner: DataSink): Promise<void> {
  const session = sftpManager.get(sftpId, owner.id)
  const key = `${sftpId}:${remotePath}`
  if (watches.has(key)) return // already being edited; the editor is open

  const localName = safeLocalName(remotePath)
  if (!localName) throw new Error('Cannot edit a file with an unsafe name')

  const dir = await mkdtemp(join(tmpdir(), EDIT_DIR_PREFIX))
  const localPath = join(dir, localName)

  let dirCleaned = false
  const cleanupDir = (): void => {
    if (dirCleaned) return
    dirCleaned = true
    void rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    // Direct (unqueued) download so the editor opens promptly.
    await new Promise<void>((resolve, reject) => {
      const source = session.sftp.createReadStream(remotePath)
      const sink = createWriteStream(localPath)
      source.on('error', reject)
      sink.on('error', reject)
      sink.on('close', () => resolve())
      source.pipe(sink)
    })

    const openError = await shell.openPath(localPath)
    if (openError) throw new Error(`Could not open editor: ${openError}`)
  } catch (err) {
    cleanupDir()
    throw err
  }

  let debounce: ReturnType<typeof setTimeout> | null = null
  let teardown: (() => void) | null = null

  // Watch the containing temp DIR, not the file: editors commonly save via
  // atomic rename-replace, which silently detaches a file-path fs.watch. The dir
  // only holds our one file, so filter events by basename.
  const watcher = watch(dir, (_evt, fname) => {
    if (fname !== null && fname !== localName) return
    if (debounce !== null) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      // Re-upload through the queue (progress in the drawer), to the ORIGINAL
      // remote path. Surface failures and stop watching if the session is gone,
      // instead of voiding the promise and swallowing the rejection.
      transferManager.enqueueUploadAs(sftpId, localPath, remotePath, owner).catch((uErr) => {
        console.error(
          '[edit-watch] re-upload failed:',
          uErr instanceof Error ? uErr.message : String(uErr),
        )
        teardown?.()
      })
    }, SAVE_DEBOUNCE_MS)
  })

  teardown = (): void => {
    if (debounce !== null) clearTimeout(debounce)
    watcher.close()
    watches.delete(key)
    cleanupDir()
  }

  watches.set(key, { sftpId, ownerId: owner.id, close: teardown })
}

export function closeEditsForSftp(sftpId: string): void {
  for (const [key, w] of watches) {
    if (w.sftpId === sftpId) {
      w.close()
      watches.delete(key)
    }
  }
}

export function closeEditsForOwner(ownerId: number): void {
  for (const [key, w] of watches) {
    if (w.ownerId === ownerId) {
      w.close()
      watches.delete(key)
    }
  }
}

/** Close every edit watch regardless of owner (app quit), removing the temp
 *  dirs that would otherwise be orphaned under os.tmpdir()/termdesk-edit-*. */
export function closeAllEdits(): void {
  for (const [key, w] of watches) {
    w.close()
    watches.delete(key)
  }
}
