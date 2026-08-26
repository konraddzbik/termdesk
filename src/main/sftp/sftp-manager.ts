import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { SftpEntry, SftpOpenResult } from '@shared/ipc'
import type { SFTPWrapper } from 'ssh2'
import { type DataSink, sessionManager } from '../ssh/session-manager'
import { findHostRow } from '../store/hosts-repo'

/**
 * SFTP browser sessions. A session reuses the ssh2 Client of a live terminal
 * session to the same host (no second login) and falls back to a dedicated
 * shell-less connection managed by SessionManager.
 */

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFREG = 0o100000
const S_IFLNK = 0o120000

export interface SftpSession {
  readonly id: string
  readonly hostId: string
  readonly owner: DataSink
  readonly sftp: SFTPWrapper
  /** Set when we own a dedicated SSH connection (closed with the session). */
  readonly dedicatedSessionId: string | null
  closed: boolean
}

function entryType(mode: number): SftpEntry['type'] {
  switch (mode & S_IFMT) {
    case S_IFDIR:
      return 'dir'
    case S_IFREG:
      return 'file'
    case S_IFLNK:
      return 'symlink'
    default:
      return 'other'
  }
}

function openSftpChannel(client: import('ssh2').Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) reject(err)
      else resolve(sftp)
    })
  })
}

function realpath(sftp: SFTPWrapper, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(path, (err, resolved) => {
      if (err) reject(err)
      else resolve(resolved)
    })
  })
}

export class SftpManager {
  private readonly sessions = new Map<string, SftpSession>()

  async open(hostId: string, owner: DataSink): Promise<SftpOpenResult> {
    const borrowed = sessionManager.borrowClient(hostId, owner.id)
    let client = borrowed
    let dedicatedSessionId: string | null = null
    if (!client) {
      const dedicated = await sessionManager.connectDedicated(hostId, owner)
      client = dedicated.client
      dedicatedSessionId = dedicated.sessionId
    }

    try {
      const sftp = await openSftpChannel(client)
      const homeDir = await realpath(sftp, '.')
      // Open at the host's default path when it's set and resolves on the
      // remote; otherwise fall back to the login home.
      const defaultPath = findHostRow(hostId)?.defaultPath ?? null
      let startDir = homeDir
      if (defaultPath && defaultPath.trim() !== '') {
        try {
          startDir = await realpath(sftp, defaultPath)
        } catch {
          startDir = homeDir
        }
      }
      const session: SftpSession = {
        id: randomUUID(),
        hostId,
        owner,
        sftp,
        dedicatedSessionId,
        closed: false,
      }
      sftp.on('close', () => {
        // close()/closeForOwner() already set this and released the dedicated
        // connection; only act when the channel closed on its own.
        if (session.closed) return
        session.closed = true
        this.sessions.delete(session.id)
        if (session.dedicatedSessionId) {
          sessionManager.disconnect(session.dedicatedSessionId, owner.id)
        }
      })
      this.sessions.set(session.id, session)
      return { sftpId: session.id, homeDir, startDir }
    } catch (err) {
      if (dedicatedSessionId) sessionManager.disconnect(dedicatedSessionId, owner.id)
      throw err
    }
  }

  /** Returns the session if it exists, is open, and belongs to ownerId. */
  get(sftpId: string, ownerId: number): SftpSession {
    const session = this.sessions.get(sftpId)
    if (!session || session.closed || session.owner.id !== ownerId) {
      throw new Error('SFTP session not found')
    }
    return session
  }

  close(sftpId: string, ownerId: number): void {
    const session = this.sessions.get(sftpId)
    if (!session || session.owner.id !== ownerId) return
    session.closed = true
    this.sessions.delete(sftpId)
    try {
      session.sftp.end()
    } catch {
      // best-effort
    }
    if (session.dedicatedSessionId) {
      sessionManager.disconnect(session.dedicatedSessionId, ownerId)
    }
  }

  closeForOwner(ownerId: number): void {
    for (const session of [...this.sessions.values()]) {
      if (session.owner.id === ownerId) this.close(session.id, ownerId)
    }
  }

  /** Close every SFTP session regardless of owner (app quit), releasing any
   *  dedicated SSH connections they own. */
  closeAll(): void {
    for (const session of [...this.sessions.values()]) {
      this.close(session.id, session.owner.id)
    }
  }

  list(sftpId: string, dirPath: string, ownerId: number): Promise<SftpEntry[]> {
    const { sftp } = this.get(sftpId, ownerId)
    return new Promise((resolve, reject) => {
      sftp.readdir(dirPath, (err, entries) => {
        if (err) {
          reject(err)
          return
        }
        resolve(
          entries.map((e) => ({
            name: e.filename,
            path: posix.join(dirPath, e.filename),
            type: entryType(e.attrs.mode ?? 0),
            size: e.attrs.size ?? 0,
            mtimeMs: (e.attrs.mtime ?? 0) * 1000,
            mode: (e.attrs.mode ?? 0) & 0o7777,
          })),
        )
      })
    })
  }

  mkdir(sftpId: string, dirPath: string, ownerId: number): Promise<void> {
    const { sftp } = this.get(sftpId, ownerId)
    return new Promise((resolve, reject) => {
      sftp.mkdir(dirPath, (err) => (err ? reject(err) : resolve()))
    })
  }

  rename(sftpId: string, from: string, to: string, ownerId: number): Promise<void> {
    const { sftp } = this.get(sftpId, ownerId)
    return new Promise((resolve, reject) => {
      sftp.rename(from, to, (err) => (err ? reject(err) : resolve()))
    })
  }

  chmod(sftpId: string, path: string, mode: number, ownerId: number): Promise<void> {
    const { sftp } = this.get(sftpId, ownerId)
    return new Promise((resolve, reject) => {
      sftp.chmod(path, mode, (err) => (err ? reject(err) : resolve()))
    })
  }

  /** Deletes a file or symlink; directories are removed recursively. */
  async remove(sftpId: string, path: string, ownerId: number): Promise<void> {
    const { sftp } = this.get(sftpId, ownerId)
    const stat = await new Promise<import('ssh2').Stats>((resolve, reject) => {
      sftp.lstat(path, (err, stats) => (err ? reject(err) : resolve(stats)))
    })
    if (stat.isDirectory()) {
      const children = await this.list(sftpId, path, ownerId)
      for (const child of children) {
        await this.remove(sftpId, child.path, ownerId)
      }
      await new Promise<void>((resolve, reject) => {
        sftp.rmdir(path, (err) => (err ? reject(err) : resolve()))
      })
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(path, (err) => (err ? reject(err) : resolve()))
      })
    }
  }

  /** mkdir -p for remote paths; existing directories are fine. */
  async mkdirp(sftpId: string, dirPath: string, ownerId: number): Promise<void> {
    const { sftp } = this.get(sftpId, ownerId)
    const parts = dirPath.split('/').filter((p) => p !== '')
    let current = dirPath.startsWith('/') ? '/' : '.'
    for (const part of parts) {
      current = current === '/' ? `/${part}` : `${current}/${part}`
      const exists = await new Promise<boolean>((resolve) => {
        sftp.stat(current, (err) => resolve(!err))
      })
      if (!exists) {
        await new Promise<void>((resolve, reject) => {
          sftp.mkdir(current, (err) => (err ? reject(err) : resolve()))
        })
      }
    }
  }
}

export const sftpManager = new SftpManager()
