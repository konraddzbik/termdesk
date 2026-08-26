import { appendFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { envFlag } from '../app-paths'

/**
 * Lightweight diagnostic logging for the VNC path (manager + ws-bridge).
 * Console logging is always on (low volume: lifecycle events + first bytes +
 * totals, never per-chunk).
 *
 * File logging is OPT-IN (set TERMDESK_VNC_DEBUG=1). When enabled it writes to
 * the per-user logs directory — never process.cwd(), which could be a shared or
 * world-readable location and would leak connection metadata (hostnames, byte
 * counts). The file is size-capped so it can't grow unbounded. Synchronous
 * appends keep the trace alive across a sudden quit.
 */
const MAX_LOG_BYTES = 5 * 1024 * 1024

let logFilePath: string | null | undefined

/** Resolve the opt-in log path once. Returns null when file logging is off. */
function resolveLogFile(): string | null {
  if (logFilePath !== undefined) return logFilePath
  if (process.env.VITEST || envFlag('VNC_DEBUG') === undefined) {
    logFilePath = null
    return null
  }
  try {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    logFilePath = join(dir, 'vnc-debug.log')
  } catch {
    logFilePath = null
  }
  return logFilePath
}

export function vncLog(message: string, detail?: Record<string, unknown>): void {
  const hasDetail = detail && Object.keys(detail).length > 0
  if (hasDetail) console.log(`[vnc] ${message}`, detail)
  else console.log(`[vnc] ${message}`)
  const file = resolveLogFile()
  if (!file) return
  try {
    // Drop file logging once it exceeds the cap rather than growing forever.
    try {
      if (statSync(file).size > MAX_LOG_BYTES) return
    } catch {
      // file doesn't exist yet — fine, we're about to create it
    }
    const stamp = new Date().toISOString()
    const line = hasDetail ? `${message} ${JSON.stringify(detail)}` : message
    appendFileSync(file, `${stamp} [vnc] ${line}\n`)
  } catch {
    // diagnostics only — never let logging break a connection
  }
}

/** Short, safe preview of the first bytes on the wire (e.g. the RFB banner). */
export function previewBytes(chunk: Buffer, max = 32): string {
  const slice = chunk.subarray(0, max)
  const ascii = slice.toString('latin1').replace(/[^\x20-\x7e]/g, '.')
  return `${ascii}${chunk.length > max ? '…' : ''}`
}
