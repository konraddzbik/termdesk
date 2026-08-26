import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { readlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { IPC_EVENTS, localTermDataChannel } from '@shared/channels'
import { type IPty, spawn } from 'node-pty'
import type { DataSink } from '../ssh/session-manager'
import { getSettings } from '../store/settings'
import { localProgramArgs, resolveLocalProgram } from './terminal-programs'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
/** Output buffered before the renderer attaches (shell prompt/banner). */
const PRE_ATTACH_CAP = 256 * 1024

/**
 * The requested directory, or the home dir when none was requested.
 *
 * An *explicitly requested* directory that no longer resolves is an error, not
 * an invitation to substitute `$HOME`. The silent fallback was actively
 * dangerous for scheduled routines: a routine scoped to a repo — possibly with
 * autonomy on, i.e. an agent running without approval prompts — would run in
 * the user's home directory instead the moment an external volume was
 * unmounted or the folder renamed. Callers surface this message in the tab.
 */
function resolveCwd(cwd?: string): string {
  if (cwd === undefined) return homedir()
  try {
    if (statSync(cwd).isDirectory()) return cwd
    throw new Error(`Not a directory: ${cwd}`)
  } catch (err) {
    throw new Error(
      `Cannot open a terminal in "${cwd}": ${
        err instanceof Error && err.message.startsWith('Not a directory')
          ? 'not a directory'
          : 'the directory is missing or unreadable'
      }`,
    )
  }
}

/** Best-effort current working directory of a running process, by pid. */
async function pidCwd(pid: number): Promise<string | null> {
  if (process.platform === 'linux') {
    try {
      return await readlink(`/proc/${pid}/cwd`)
    } catch {
      return null
    }
  }
  if (process.platform === 'darwin') {
    return new Promise((resolve) => {
      execFile(
        'lsof',
        ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'],
        { timeout: 2000 },
        (err, stdout) => {
          if (err) return resolve(null)
          // -Fn output: fields on their own lines prefixed by a tag; the cwd path
          // is the line starting with 'n'.
          const line = stdout.split('\n').find((l) => l.startsWith('n'))
          resolve(line ? line.slice(1) : null)
        },
      )
    })
  }
  return null // win32 / unknown — UI falls back to Browse / typing
}

interface LocalSession {
  readonly id: string
  readonly pty: IPty
  readonly owner: DataSink
  attached: boolean
  preAttach: string[]
  preBytes: number
}

/** The user's default login shell for this platform. */
function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  return process.env.SHELL ?? '/bin/bash'
}

/**
 * The parent env minus TermDesk's own internal config, so app-internal settings
 * (DB/settings path overrides, smoke-test and debug flags) never leak into the
 * user's shell or any child process / shell history it spawns.
 */
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (/^(TERMDESK_|SSHDECK_)/.test(k)) continue
    env[k] = v
  }
  return env
}

/**
 * Spawns and tracks local-machine PTYs (one per "local terminal" tab). Mirrors
 * the SSH session manager's data-sink + pre-attach-buffer + owner-scoping model,
 * minus connect/auth — the shell is local.
 */
class LocalTerminalManager {
  private readonly sessions = new Map<string, LocalSession>()

  open(
    owner: DataSink,
    opts?: { cols?: number; rows?: number; cwd?: string },
  ): { sessionId: string; shell: string } {
    const shell = defaultShell()
    const sessionId = randomUUID()
    // Launch the user's chosen terminal program when it's installed on this
    // machine: a multiplexer wraps the shell in its own session (attach-or-
    // create, distinct name per tab so tabs don't mirror), an alternate shell
    // replaces the login shell. Falls back to the login shell for `default` or
    // when the program isn't available here.
    const program = resolveLocalProgram(getSettings().terminalProgram)
    const file = program ? program.bin : shell
    const args = program ? localProgramArgs(program, `termdesk-${sessionId.slice(0, 8)}`) : []
    const pty = spawn(file, args, {
      name: 'xterm-256color',
      cols: opts?.cols ?? DEFAULT_COLS,
      rows: opts?.rows ?? DEFAULT_ROWS,
      cwd: resolveCwd(opts?.cwd),
      env: childEnv(),
    })

    const session: LocalSession = {
      id: sessionId,
      pty,
      owner,
      attached: false,
      preAttach: [],
      preBytes: 0,
    }
    this.sessions.set(sessionId, session)

    pty.onData((data) => {
      if (session.attached && !owner.isDestroyed()) {
        owner.send(localTermDataChannel(sessionId), data)
      } else {
        this.buffer(session, data)
      }
    })
    pty.onExit(({ exitCode }) => {
      if (!owner.isDestroyed()) owner.send(IPC_EVENTS.localTermExit, { sessionId, exitCode })
      this.sessions.delete(sessionId)
    })

    return { sessionId, shell: program ? program.bin : basename(shell) }
  }

  /** Best-effort current working directory of the session's shell (or null). */
  async cwd(sessionId: string, ownerId: number): Promise<string | null> {
    const session = this.get(sessionId, ownerId)
    if (!session) return null
    return pidCwd(session.pty.pid)
  }

  /** Flushes buffered output and starts live streaming to the owner. */
  attach(sessionId: string, ownerId: number): void {
    const session = this.get(sessionId, ownerId)
    if (!session) return
    session.attached = true
    for (const chunk of session.preAttach) {
      if (!session.owner.isDestroyed()) session.owner.send(localTermDataChannel(sessionId), chunk)
    }
    session.preAttach = []
    session.preBytes = 0
  }

  write(sessionId: string, ownerId: number, data: string): void {
    this.get(sessionId, ownerId)?.pty.write(data)
  }

  resize(sessionId: string, ownerId: number, cols: number, rows: number): void {
    try {
      this.get(sessionId, ownerId)?.pty.resize(Math.max(1, cols), Math.max(1, rows))
    } catch {
      // pty may have exited between resize and here
    }
  }

  close(sessionId: string, ownerId: number): void {
    const session = this.get(sessionId, ownerId)
    if (!session) return
    try {
      session.pty.kill()
    } catch {
      // already dead
    }
    this.sessions.delete(sessionId)
  }

  /** Kill every PTY (app quit) or just one owner's (window closed). */
  destroyAll(ownerId?: number): void {
    for (const session of [...this.sessions.values()]) {
      if (ownerId === undefined || session.owner.id === ownerId) {
        try {
          session.pty.kill()
        } catch {
          // ignore
        }
        this.sessions.delete(session.id)
      }
    }
  }

  private buffer(session: LocalSession, data: string): void {
    session.preAttach.push(data)
    session.preBytes += data.length
    while (session.preBytes > PRE_ATTACH_CAP && session.preAttach.length > 0) {
      const dropped = session.preAttach.shift()
      if (dropped) session.preBytes -= dropped.length
    }
  }

  private get(sessionId: string, ownerId: number): LocalSession | undefined {
    const session = this.sessions.get(sessionId)
    return session && session.owner.id === ownerId ? session : undefined
  }
}

export const localTerminalManager = new LocalTerminalManager()
