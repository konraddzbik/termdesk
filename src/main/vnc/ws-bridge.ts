import { randomBytes } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { previewBytes, vncLog } from './vnc-log'

/**
 * Local WebSocket↔TCP bridge for noVNC (which speaks RFB only over
 * WebSockets). Replaces websockify:
 *
 *   noVNC (renderer) ── ws://127.0.0.1:<port>/<one-time-token> ──┐
 *                                                                ▼
 *                                       this bridge (main process)
 *                                                                │
 *                       net.Socket (direct) / ssh2 forwardOut (tunnel)
 *
 * Security model: the server binds to 127.0.0.1 with a random port. Every
 * connection must present a single-use, time-limited token issued at VNC
 * session start — connections without a valid token are destroyed before any
 * byte reaches a target. This keeps other local processes from riding the
 * bridge.
 */

const TOKEN_TTL_MS = 30_000
/** Pause the source when this much is queued on the websocket. */
const BACKPRESSURE_HIGH_WATER = 4 * 1024 * 1024

interface PendingTarget {
  /** Lazily creates the byte stream to the VNC server (TCP socket or SSH channel). */
  createStream(): Promise<Duplex>
  /** Invoked when the bridged connection (or unused token) is finished. */
  onClosed(): void
  expiresAt: number
}

let server: WebSocketServer | null = null
let serverPort: number | null = null
const pending = new Map<string, PendingTarget>()

function sweepExpired(): void {
  const now = Date.now()
  for (const [token, target] of pending) {
    if (target.expiresAt <= now) {
      pending.delete(token)
      target.onClosed()
    }
  }
}

/**
 * Defense-in-depth on top of the single-use token: only accept upgrades from
 * the app's own renderer. A packaged (file://) renderer sends no Origin or
 * 'null'; the dev renderer sends ELECTRON_RENDERER_URL's origin. Any other
 * Origin (e.g. a stray browser tab on localhost) is rejected before the token
 * is even consulted.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin || origin === 'null') return true
  const dev = process.env.ELECTRON_RENDERER_URL
  if (!dev) return false
  try {
    return new URL(origin).origin === new URL(dev).origin
  } catch {
    return false
  }
}

/**
 * In-flight {@link startServer} promise. `ensureServer` awaits the listen
 * event, so two callers that interleave across that await both used to see
 * `server === null`, both bound a listener, and the second assignment orphaned
 * the first — leaving a token-gated loopback socket open for the process
 * lifetime that `shutdownBridge` could never close. Single-flight fixes it.
 */
let starting: Promise<number> | null = null

async function ensureServer(): Promise<number> {
  if (server && serverPort !== null) return serverPort
  if (starting) return starting
  starting = startServer().finally(() => {
    starting = null
  })
  return starting
}

async function startServer(): Promise<number> {
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    verifyClient: (info: { origin?: string }): boolean => isAllowedOrigin(info.origin),
  })
  // `once('error', reject)` alone is a listen-time guard: after 'listening'
  // resolves, a post-listen error (EMFILE on accept, a reset on the listener)
  // would reach an emitter with no 'error' listener, and Node throws
  // ERR_UNHANDLED_ERROR — killing the main process. Keep a permanent handler
  // that logs and drops the server so the next open rebuilds it.
  let settled = false
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => {
      settled = true
      resolve()
    })
    wss.on('error', (err: Error) => {
      if (!settled) {
        settled = true
        reject(err)
        return
      }
      vncLog(`ws-bridge: listener error after start: ${err.message}`)
      if (server === wss) {
        server = null
        serverPort = null
      }
      try {
        wss.close()
      } catch {
        // already closing
      }
    })
  })
  const address = wss.address()
  if (address === null || typeof address === 'string') {
    throw new Error('ws-bridge: could not determine listening port')
  }

  wss.on('connection', (ws, req) => {
    sweepExpired()
    const token = (req.url ?? '').replace(/^\//, '')
    const target = token ? pending.get(token) : undefined
    if (!target) {
      // No/unknown/used token — drop immediately, nothing was connected yet.
      vncLog('bridge: WS connection with invalid/expired token — rejected')
      ws.close(1008, 'invalid token')
      return
    }
    vncLog('bridge: WS connected with valid token, opening target stream')
    pending.delete(token) // single use
    void bridge(ws, target)
  })

  server = wss
  serverPort = address.port
  return address.port
}

async function bridge(ws: WebSocket, target: PendingTarget): Promise<void> {
  let stream: Duplex
  try {
    stream = await target.createStream()
  } catch (err) {
    // This is the usual culprit: the TCP/tunnel to the VNC server failed.
    vncLog(`bridge: target stream FAILED to open: ${err instanceof Error ? err.message : err}`)
    ws.close(1011, err instanceof Error ? err.message.slice(0, 100) : 'connect failed')
    target.onClosed()
    return
  }
  vncLog('bridge: target stream open — relaying RFB. Waiting for the server to send its banner…')

  let closed = false
  let srvToCli = 0
  let cliToSrv = 0
  let sawServerData = false
  let sawClientData = false
  // If the TCP/tunnel connected but the server never speaks (wrong port, not a
  // VNC server, or a firewall that accepts then blackholes), the viewer just
  // hangs. Flag that case explicitly after a grace period.
  const silenceTimer = setTimeout(() => {
    if (!sawServerData && !closed) {
      vncLog(
        'bridge: connected but the server has sent NO bytes after 5s — the target accepted the ' +
          'connection but is not speaking RFB. Likely not a VNC server on this port, or a ' +
          'firewall accepting-then-dropping. Check the port and that a VNC server is listening.',
      )
    }
  }, 5000)
  silenceTimer.unref?.()

  const finish = (): void => {
    if (closed) return
    closed = true
    clearTimeout(silenceTimer)
    vncLog(`bridge: closed — server→client ${srvToCli}B, client→server ${cliToSrv}B`)
    try {
      stream.destroy()
    } catch {
      // best-effort
    }
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close()
    }
    target.onClosed()
  }

  stream.on('data', (chunk: Buffer) => {
    srvToCli += chunk.length
    if (!sawServerData) {
      sawServerData = true
      // The very first server bytes should be the RFB banner, e.g. "RFB 003.008".
      vncLog(`bridge: first server→client bytes (${chunk.length}B): "${previewBytes(chunk)}"`)
    }
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(chunk, { binary: true })
    if (ws.bufferedAmount > BACKPRESSURE_HIGH_WATER) {
      stream.pause()
      const drain = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount < BACKPRESSURE_HIGH_WATER / 4) {
          clearInterval(drain)
          stream.resume()
        }
      }, 20)
    }
  })
  stream.on('error', (err: Error) => {
    vncLog(`bridge: target stream error: ${err.message}`)
    finish()
  })
  stream.on('close', finish)

  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    if (!isBinary) return // RFB is binary-only; ignore text frames
    const chunk = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data)
    cliToSrv += chunk.length
    if (!sawClientData) {
      sawClientData = true
      vncLog(`bridge: first client→server bytes (${chunk.length}B)`)
    }
    stream.write(chunk)
  })
  ws.on('error', (err: Error) => {
    vncLog(`bridge: websocket error: ${err.message}`)
    finish()
  })
  ws.on('close', finish)
}

/**
 * Registers a one-time bridge target and returns its ws:// URL. The token is
 * single-use and expires after 30 s if no connection arrives (onClosed fires
 * either way, exactly once per registration outcome).
 */
export async function registerBridgeTarget(
  createStream: () => Promise<Duplex>,
  onClosed: () => void,
): Promise<string> {
  const port = await ensureServer()
  const token = randomBytes(24).toString('base64url')
  pending.set(token, { createStream, onClosed, expiresAt: Date.now() + TOKEN_TTL_MS })
  // Opportunistic cleanup of expired never-used tokens.
  setTimeout(sweepExpired, TOKEN_TTL_MS + 1000).unref?.()
  return `ws://127.0.0.1:${port}/${token}`
}

/** Test/diagnostics: current pending token count. */
export function pendingTokenCount(): number {
  sweepExpired()
  return pending.size
}

export function shutdownBridge(): void {
  for (const [, target] of pending) target.onClosed()
  pending.clear()
  server?.close()
  server = null
  serverPort = null
}
