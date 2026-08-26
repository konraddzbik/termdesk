import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
import { IPC_EVENTS } from '@shared/channels'
import { type Transfer, transferSchema } from '@shared/ipc'
import type { SFTPWrapper } from 'ssh2'
import { sanitizeErrorMessage } from '../ipc/hosts'
import type { DataSink } from '../ssh/session-manager'
import { sftpManager } from './sftp-manager'

/**
 * SFTP transfer queue. Transfers stream chunk-by-chunk (constant memory) via
 * sftp.createReadStream / createWriteStream, which — unlike fastGet/fastPut —
 * can be cancelled mid-flight by destroying the streams. Progress events are
 * throttled and sent to the owning window only.
 *
 * Writes go to a sibling temp path first and are promoted to the real
 * destination only after the stream completes AND the byte count matches the
 * expected size. A cancelled or failed transfer therefore never truncates or
 * partially overwrites the real file — the temp file is removed instead. This
 * matters most for edit-in-place re-uploads, where the destination is a live
 * file the user is editing.
 */

const MAX_ACTIVE_TRANSFERS = 2
const EVENT_THROTTLE_MS = 250
const STREAM_CHUNK = 64 * 1024

interface TransferRec {
  readonly id: string
  readonly sftpId: string
  readonly kind: 'upload' | 'download'
  readonly label: string
  readonly localPath: string
  readonly remotePath: string
  readonly owner: DataSink
  totalBytes: number | null
  doneBytes: number
  rate: number
  status: Transfer['status']
  error?: string
  /** Set while active; calling it destroys the live streams. */
  abort: (() => void) | null
  lastEmit: number
  lastTickAt: number
  lastTickBytes: number
}

class TransferManager {
  private readonly transfers = new Map<string, TransferRec>()
  private active = 0

  list(ownerId: number): Transfer[] {
    return [...this.transfers.values()].filter((t) => t.owner.id === ownerId).map(toTransfer)
  }

  /**
   * Enqueues an upload of local files and/or directories (walked recursively,
   * structure preserved). Returns the ids of all created file transfers.
   */
  async enqueueUploads(
    sftpId: string,
    localPaths: string[],
    remoteDir: string,
    owner: DataSink,
  ): Promise<string[]> {
    // Validate session ownership up front.
    sftpManager.get(sftpId, owner.id)
    const ids: string[] = []
    for (const localPath of localPaths) {
      const info = await stat(localPath)
      if (info.isDirectory()) {
        const baseRemote = posix.join(remoteDir, basename(localPath))
        await this.walkUpload(sftpId, localPath, baseRemote, owner, ids)
      } else if (info.isFile()) {
        ids.push(
          this.enqueue({
            sftpId,
            kind: 'upload',
            localPath,
            remotePath: posix.join(remoteDir, basename(localPath)),
            owner,
            totalBytes: info.size,
          }),
        )
      }
    }
    this.pump()
    return ids
  }

  /**
   * Uploads a single local file to an EXPLICIT remote path. Used by edit-in-place,
   * where the local temp file is deliberately renamed (safe extension) and so its
   * basename must not dictate the remote name — the original remote path is kept.
   */
  async enqueueUploadAs(
    sftpId: string,
    localPath: string,
    remotePath: string,
    owner: DataSink,
  ): Promise<string> {
    sftpManager.get(sftpId, owner.id)
    const info = await stat(localPath)
    const id = this.enqueue({
      sftpId,
      kind: 'upload',
      localPath,
      remotePath,
      owner,
      totalBytes: info.size,
    })
    this.pump()
    return id
  }

  private async walkUpload(
    sftpId: string,
    localDir: string,
    remoteDir: string,
    owner: DataSink,
    ids: string[],
  ): Promise<void> {
    await sftpManager.mkdirp(sftpId, remoteDir, owner.id)
    const entries = await readdir(localDir, { withFileTypes: true })
    for (const entry of entries) {
      const localPath = join(localDir, entry.name)
      if (entry.isDirectory()) {
        await this.walkUpload(sftpId, localPath, posix.join(remoteDir, entry.name), owner, ids)
      } else if (entry.isFile()) {
        const info = await stat(localPath)
        ids.push(
          this.enqueue({
            sftpId,
            kind: 'upload',
            localPath,
            remotePath: posix.join(remoteDir, entry.name),
            owner,
            totalBytes: info.size,
          }),
        )
      }
    }
  }

  enqueueDownload(
    sftpId: string,
    remotePath: string,
    localPath: string,
    owner: DataSink,
    totalBytes: number | null,
  ): string {
    sftpManager.get(sftpId, owner.id)
    const id = this.enqueue({
      sftpId,
      kind: 'download',
      localPath,
      remotePath,
      owner,
      totalBytes,
    })
    this.pump()
    return id
  }

  private enqueue(input: {
    sftpId: string
    kind: 'upload' | 'download'
    localPath: string
    remotePath: string
    owner: DataSink
    totalBytes: number | null
  }): string {
    const rec: TransferRec = {
      id: randomUUID(),
      sftpId: input.sftpId,
      kind: input.kind,
      label: input.kind === 'upload' ? basename(input.localPath) : posix.basename(input.remotePath),
      localPath: input.localPath,
      remotePath: input.remotePath,
      owner: input.owner,
      totalBytes: input.totalBytes,
      doneBytes: 0,
      rate: 0,
      status: 'queued',
      abort: null,
      lastEmit: 0,
      lastTickAt: 0,
      lastTickBytes: 0,
    }
    this.transfers.set(rec.id, rec)
    this.emit(rec, true)
    return rec.id
  }

  cancel(transferId: string, ownerId: number): void {
    const rec = this.transfers.get(transferId)
    if (!rec || rec.owner.id !== ownerId) return
    if (rec.status === 'queued') {
      rec.status = 'cancelled'
      this.emit(rec, true)
    } else if (rec.status === 'active') {
      rec.status = 'cancelled'
      rec.abort?.()
      this.emit(rec, true)
    }
  }

  retry(transferId: string, ownerId: number): void {
    const rec = this.transfers.get(transferId)
    if (!rec || rec.owner.id !== ownerId) return
    if (rec.status !== 'error' && rec.status !== 'cancelled') return
    rec.status = 'queued'
    rec.doneBytes = 0
    rec.rate = 0
    rec.error = undefined
    this.emit(rec, true)
    this.pump()
  }

  cancelForOwner(ownerId: number): void {
    for (const rec of this.transfers.values()) {
      if (rec.owner.id !== ownerId) continue
      if (rec.status === 'queued' || rec.status === 'active') {
        rec.status = 'cancelled'
        rec.abort?.()
      }
    }
  }

  /** Cancel every in-flight transfer regardless of owner (app quit) so no
   *  `.termdesk-part-*` temp file is left mid-write. */
  cancelAll(): void {
    for (const rec of this.transfers.values()) {
      if (rec.status === 'queued' || rec.status === 'active') {
        rec.status = 'cancelled'
        rec.abort?.()
      }
    }
  }

  private pump(): void {
    if (this.active >= MAX_ACTIVE_TRANSFERS) return
    const next = [...this.transfers.values()].find((t) => t.status === 'queued')
    if (!next) return
    this.active += 1
    next.status = 'active'
    next.lastTickAt = Date.now()
    next.lastTickBytes = 0
    this.emit(next, true)
    void this.run(next)
      .then(() => {
        if (next.status === 'active') next.status = 'done'
      })
      .catch((err) => {
        if (next.status === 'active') {
          next.status = 'error'
          next.error = sanitizeErrorMessage(err)
        }
      })
      .finally(() => {
        next.abort = null
        this.active -= 1
        this.emit(next, true)
        this.pump()
      })
  }

  private async run(rec: TransferRec): Promise<void> {
    const session = sftpManager.get(rec.sftpId, rec.owner.id)
    const sftp = session.sftp

    if (rec.kind === 'download' && rec.totalBytes === null) {
      rec.totalBytes = await new Promise<number | null>((resolve) => {
        sftp.stat(rec.remotePath, (err, stats) => resolve(err ? null : (stats.size ?? null)))
      })
    }
    if (rec.kind === 'download') {
      await mkdir(join(rec.localPath, '..'), { recursive: true })
    }

    // Stream into a sibling temp path; promote it only on a verified-complete
    // transfer. Keeps the real destination intact on cancel/error.
    const tempRemote =
      rec.kind === 'upload' ? partialRemotePath(rec.remotePath, rec.id) : rec.remotePath
    const tempLocal =
      rec.kind === 'download' ? partialLocalPath(rec.localPath, rec.id) : rec.localPath

    const source =
      rec.kind === 'upload'
        ? createReadStream(rec.localPath, { highWaterMark: STREAM_CHUNK })
        : sftp.createReadStream(rec.remotePath, { highWaterMark: STREAM_CHUNK })
    const sink =
      rec.kind === 'upload' ? sftp.createWriteStream(tempRemote) : createWriteStream(tempLocal)

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const fail = (err: unknown): void => {
          if (settled) return
          settled = true
          source.destroy()
          sink.destroy()
          reject(err instanceof Error ? err : new Error(String(err)))
        }
        rec.abort = () => fail(new Error('Transfer cancelled'))

        source.on('data', (chunk: Buffer | string) => {
          const len = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
          rec.doneBytes += len
          this.tickRate(rec)
          this.emit(rec, false)
        })
        source.on('error', fail)
        sink.on('error', fail)
        sink.on('close', () => {
          if (settled) return
          settled = true
          resolve()
        })
        source.pipe(sink)
      })

      // Integrity guard: a stream that ended early (dropped tunnel, disk full
      // the sink swallowed, server truncation) must not be promoted over a good
      // file. Only assert when the expected size is known.
      if (rec.totalBytes !== null && rec.doneBytes !== rec.totalBytes) {
        throw new Error(
          `Transfer incomplete: expected ${rec.totalBytes} bytes but transferred ${rec.doneBytes}`,
        )
      }

      // Atomically promote temp → final.
      if (rec.kind === 'upload') {
        await sftpRenameReplace(sftp, tempRemote, rec.remotePath)
      } else {
        await rename(tempLocal, rec.localPath)
      }
    } catch (err) {
      // Best-effort removal of the partial temp file.
      if (rec.kind === 'upload') {
        await sftpUnlink(sftp, tempRemote).catch(() => {})
      } else {
        await rm(tempLocal, { force: true }).catch(() => {})
      }
      throw err
    }
  }

  private tickRate(rec: TransferRec): void {
    const now = Date.now()
    if (rec.lastTickAt === 0) {
      rec.lastTickAt = now
      rec.lastTickBytes = rec.doneBytes
      return
    }
    const dt = now - rec.lastTickAt
    if (dt < 500) return
    const instant = ((rec.doneBytes - rec.lastTickBytes) / dt) * 1000
    rec.rate = rec.rate === 0 ? instant : 0.7 * rec.rate + 0.3 * instant
    rec.lastTickAt = now
    rec.lastTickBytes = rec.doneBytes
  }

  private emit(rec: TransferRec, force: boolean): void {
    const now = Date.now()
    if (!force && now - rec.lastEmit < EVENT_THROTTLE_MS) return
    rec.lastEmit = now
    if (rec.owner.isDestroyed()) return
    rec.owner.send(IPC_EVENTS.sftpTransfer, toTransfer(rec))
  }
}

function toTransfer(rec: TransferRec): Transfer {
  const remaining = rec.totalBytes !== null ? rec.totalBytes - rec.doneBytes : null
  return transferSchema.parse({
    id: rec.id,
    sftpId: rec.sftpId,
    kind: rec.kind,
    label: rec.label,
    localPath: rec.localPath,
    remotePath: rec.remotePath,
    totalBytes: rec.totalBytes,
    doneBytes: rec.doneBytes,
    rate: Math.round(rec.rate),
    etaSec:
      remaining !== null && rec.rate > 0 && rec.status === 'active'
        ? Math.round(remaining / rec.rate)
        : null,
    status: rec.status,
    ...(rec.error !== undefined ? { error: rec.error } : {}),
  })
}

/** Sibling temp path for an in-progress remote upload (hidden, per-transfer unique). */
function partialRemotePath(remotePath: string, id: string): string {
  const dir = posix.dirname(remotePath)
  const base = posix.basename(remotePath)
  return posix.join(dir, `.${base}.termdesk-part-${id.slice(0, 8)}`)
}

/** Sibling temp path for an in-progress local download (same dir → same filesystem). */
function partialLocalPath(localPath: string, id: string): string {
  return `${localPath}.termdesk-part-${id.slice(0, 8)}`
}

function sftpRename(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(from, to, (err) => (err ? reject(err) : resolve()))
  })
}

function sftpUnlink(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(path, (err) => (err ? reject(err) : resolve()))
  })
}

/**
 * Renames temp → final, replacing an existing destination. The base SFTP
 * rename errors when the target exists on strict servers (e.g. OpenSSH without
 * the posix-rename extension), so fall back to unlink-then-rename. The full new
 * content already lives in `from`, so the brief gap on the fallback path can
 * never leave a truncated file in place.
 */
async function sftpRenameReplace(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  try {
    await sftpRename(sftp, from, to)
  } catch {
    await sftpUnlink(sftp, to).catch(() => {})
    await sftpRename(sftp, from, to)
  }
}

export const transferManager = new TransferManager()
