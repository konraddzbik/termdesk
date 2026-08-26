import type { Client, ClientChannel } from 'ssh2'
import { sanitizeErrorMessage } from '../ipc/hosts'
import { type DataSink, sessionManager } from './session-manager'

export interface RunCommandCallbacks {
  onStdout(chunk: string): void
  onStderr(chunk: string): void
}

/**
 * A non-interactive command must not let a misbehaving or compromised remote
 * server hold a connection open forever or flood the main process: cap total
 * captured output and impose a hard wall-clock timeout. (The interactive
 * terminal shell is a separate path and is not bounded here.)
 */
const OUTPUT_CAP_BYTES = 1024 * 1024
const COMMAND_TIMEOUT_MS = 120_000

export interface RunCommandResult {
  /** Process exit code, or null when the process was killed by a signal. */
  exitCode: number | null
}

/**
 * Runs a single command on one host non-interactively (ssh2 `exec`), streaming
 * stdout/stderr via callbacks and resolving with the exit code.
 *
 * Reuses a live terminal connection when one exists (`borrowClient`), otherwise
 * opens a dedicated shell-less connection with host-key prompts disabled — so a
 * batch run can never spawn interactive prompts — and tears it down afterwards.
 * Cancellation (`signal`) destroys the exec channel.
 */
export async function runCommand(
  hostId: string,
  owner: DataSink,
  command: string,
  callbacks: RunCommandCallbacks,
  signal: AbortSignal,
): Promise<RunCommandResult> {
  if (signal.aborted) throw new Error('Run cancelled')

  let dedicatedSessionId: string | null = null
  let client = sessionManager.borrowClient(hostId, owner.id)
  if (!client) {
    const dedicated = await sessionManager.connectDedicated(hostId, owner, { promptHostKey: false })
    client = dedicated.client
    dedicatedSessionId = dedicated.sessionId
  }
  if (signal.aborted) {
    if (dedicatedSessionId) sessionManager.disconnect(dedicatedSessionId, owner.id)
    throw new Error('Run cancelled')
  }

  const liveClient: Client = client
  try {
    return await new Promise<RunCommandResult>((resolve, reject) => {
      let settled = false
      let exitCode: number | null = null
      const settleResolve = (result: RunCommandResult): void => {
        if (settled) return
        settled = true
        resolve(result)
      }
      const settleReject = (err: Error): void => {
        if (settled) return
        settled = true
        reject(err)
      }

      liveClient.exec(command, (err: Error | undefined, channel: ClientChannel) => {
        if (err) {
          settleReject(new Error(sanitizeErrorMessage(err)))
          return
        }
        let timer: ReturnType<typeof setTimeout> | null = null
        let outBytes = 0
        let capped = false
        const destroyChannel = (): void => {
          try {
            channel.destroy()
          } catch {
            // already gone
          }
        }
        const teardown = (): void => {
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
          signal.removeEventListener('abort', onAbort)
        }
        const onAbort = (): void => {
          destroyChannel()
          teardown()
          settleReject(new Error('Run cancelled'))
        }
        signal.addEventListener('abort', onAbort, { once: true })

        // Hard wall-clock cap so a hung/silent server can't hold the lane.
        timer = setTimeout(() => {
          destroyChannel()
          teardown()
          settleReject(
            new Error(`Command timed out after ${Math.round(COMMAND_TIMEOUT_MS / 1000)}s`),
          )
        }, COMMAND_TIMEOUT_MS)
        timer.unref?.()

        // Stop forwarding (and abort) once combined output exceeds the cap, so a
        // flooding server can't drive unbounded memory/IPC traffic.
        const underCap = (len: number): boolean => {
          outBytes += len
          if (outBytes <= OUTPUT_CAP_BYTES) return true
          if (!capped) {
            capped = true
            destroyChannel()
            teardown()
            settleReject(new Error('Command output exceeded the output cap'))
          }
          return false
        }

        channel.on('data', (data: Buffer) => {
          if (underCap(data.length)) callbacks.onStdout(data.toString('utf8'))
        })
        channel.stderr.on('data', (data: Buffer) => {
          if (underCap(data.length)) callbacks.onStderr(data.toString('utf8'))
        })
        // `exit` carries the code; `close` fires after all output is flushed.
        channel.on('exit', (code: number | null) => {
          exitCode = typeof code === 'number' ? code : null
        })
        channel.on('close', () => {
          teardown()
          settleResolve({ exitCode })
        })
        channel.on('error', (channelErr: Error) => {
          teardown()
          settleReject(new Error(sanitizeErrorMessage(channelErr)))
        })
      })
    })
  } finally {
    // Only tear down connections we created; borrowed terminal clients live on.
    if (dedicatedSessionId) sessionManager.disconnect(dedicatedSessionId, owner.id)
  }
}
