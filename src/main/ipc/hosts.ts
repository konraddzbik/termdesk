import { connect } from 'node:net'
import { type Host, type HostTestResult, hostInputSchema, IPC } from '@shared/ipc'
import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  createHost,
  deleteHost,
  duplicateHost,
  findHost,
  listHosts,
  setHostGroup,
  updateHost,
} from '../store/hosts-repo'

const TEST_TIMEOUT_MS = 5_000

/** Maximum simultaneous TCP test connections. */
const TEST_CONCURRENCY_CAP = 4

/** In-flight test promises keyed by hostId — deduplicates concurrent clicks. */
const inFlightTests = new Map<string, Promise<HostTestResult>>()

/** Number of tests currently in progress (counting all concurrent slots). */
let activeTestCount = 0

/**
 * Strips anything that could leak internals — message only, never a stack, and
 * never a filesystem path. Error messages routinely embed absolute paths (e.g.
 * an ENOENT for a private-key path, or a temp dir), which would disclose the
 * local layout to the renderer; redact those to a placeholder.
 */
export function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) {
    const firstLine = err.message.split('\n')[0] ?? ''
    // Cap the length: this text can be server-controlled (an ssh2 disconnect
    // reason or banner), it is broadcast to every window, and it lands in
    // activity_log.detail — every other writer into that column already caps.
    const redacted = redactPaths(firstLine).trim().slice(0, 300)
    return redacted.length > 0 ? redacted : 'Connection failed'
  }
  return 'Connection failed'
}

/** Replaces POSIX, Windows, and ~ absolute paths with a `<path>` placeholder. */
function redactPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:\\[^\s'"]*/g, '<path>') // C:\Users\me\...
    .replace(/~\/[^\s'"]*/g, '<path>') // ~/.ssh/id_ed25519
    .replace(/(?<![\w<])\/[^\s'"]*\/[^\s'"]*/g, '<path>') // /home/me/.ssh/key (>=2 segments)
}

/**
 * The port a reachability test should probe. A VNC-only host has no SSH service
 * on `port`, so we probe its VNC port (falling back to `port` if unset). Hosts
 * with an SSH capability ('ssh'/'both') are always tested on the SSH port.
 */
/** Default VNC server port, mirrored from vnc-manager. */
const DEFAULT_VNC_PORT = 5900

export function resolveTestPort(host: Pick<Host, 'kind' | 'port' | 'vncPort'>): number {
  // A VNC-only host has no SSH service on `port`; probe its VNC port, defaulting
  // to 5900 when unset (the same default the connection uses). SSH-capable hosts
  // ('ssh'/'both') are always tested on their SSH port.
  return host.kind === 'vnc' ? (host.vncPort ?? DEFAULT_VNC_PORT) : host.port
}

function testTcpReachability(hostname: string, port: number): Promise<HostTestResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const socket = connect({ host: hostname, port })
    let settled = false

    const finish = (result: HostTestResult): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(TEST_TIMEOUT_MS)
    socket.once('connect', () => finish({ ok: true, latencyMs: Date.now() - startedAt }))
    socket.once('timeout', () =>
      finish({ ok: false, error: `Connection timed out after ${TEST_TIMEOUT_MS / 1000}s` }),
    )
    socket.once('error', (err) => finish({ ok: false, error: sanitizeErrorMessage(err) }))
  })
}

export function registerHostsIpc(): void {
  ipcMain.handle(IPC.hostsList, () => listHosts())

  ipcMain.handle(IPC.hostsCreate, (_event, rawInput: unknown) => {
    return createHost(hostInputSchema.parse(rawInput))
  })

  ipcMain.handle(
    IPC.hostsDuplicate,
    (_event, rawId: unknown, rawLabel: unknown, rawHost: unknown) => {
      const id = z.string().parse(rawId)
      if (!findHost(id)) throw new Error('Host not found')
      return duplicateHost(
        id,
        z.string().min(1).max(200).parse(rawLabel),
        z.string().min(1).max(255).parse(rawHost),
      )
    },
  )

  ipcMain.handle(IPC.hostsUpdate, (_event, rawId: unknown, rawInput: unknown) => {
    const id = z.string().parse(rawId)
    return updateHost(id, hostInputSchema.parse(rawInput))
  })

  ipcMain.handle(IPC.hostsDelete, (_event, rawId: unknown) => {
    deleteHost(z.string().parse(rawId))
  })

  ipcMain.handle(IPC.hostsSetGroup, (_event, rawId: unknown, rawGroupId: unknown) =>
    setHostGroup(z.string().parse(rawId), z.string().nullable().parse(rawGroupId)),
  )

  ipcMain.handle(IPC.hostsTest, (_event, rawId: unknown): Promise<HostTestResult> => {
    const id = z.string().parse(rawId)
    const host = findHost(id)
    if (!host) return Promise.resolve({ ok: false, error: 'Host not found' })

    // Deduplicate: return the existing in-flight promise for this host.
    const existing = inFlightTests.get(id)
    if (existing !== undefined) return existing

    // Global concurrency cap.
    if (activeTestCount >= TEST_CONCURRENCY_CAP) {
      return Promise.resolve({
        ok: false,
        error: `Too many concurrent tests (max ${TEST_CONCURRENCY_CAP}) — try again shortly`,
      })
    }

    activeTestCount++
    const promise = testTcpReachability(host.hostname, resolveTestPort(host)).finally(() => {
      activeTestCount--
      inFlightTests.delete(id)
    })
    inFlightTests.set(id, promise)
    return promise
  })
}
