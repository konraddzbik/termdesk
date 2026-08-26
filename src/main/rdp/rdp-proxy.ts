import { randomBytes } from 'node:crypto'
import type { Duplex } from 'node:stream'
import * as tls from 'node:tls'
import { type WebSocket, WebSocketServer } from 'ws'
import {
  buildRdCleanPathError,
  buildRdCleanPathResponse,
  certFingerprint,
  derValueLength,
  parseRdCleanPathRequest,
  tpktLength,
} from './rdcleanpath'
import { rdpLog } from './rdp-log'

/**
 * In-process RDCleanPath proxy: a WebSocket server the renderer's IronRDP WASM
 * client connects to, standing in for Devolutions Gateway. It performs the
 * cleartext X.224 negotiation + TLS handshake with the RDP server, hands the
 * server certificate chain back to the client (which uses it for CredSSP's
 * public-key binding), then relays plaintext RDP PDUs over the already-terminated
 * TLS session — the same one-time-token, origin-checked, backpressure-aware
 * shape as the VNC ws-bridge.
 *
 * The RDP handshake needs a live Windows target, so the end-to-end flow is not
 * exercised by the unit tests (only rdcleanpath.ts's wire format is).
 */

const TOKEN_TTL_MS = 30_000
const BACKPRESSURE_HIGH_WATER = 4 * 1024 * 1024
const HANDSHAKE_TIMEOUT_MS = 20_000
/** IronRDP IronErrorKind.ProxyConnect — surfaced to the client on failure. */
const ERR_PROXY_CONNECT = 5

export interface RdpTarget {
  /** Opens the transport to the RDP server (direct TCP or SSH-tunnelled). */
  connect: () => Promise<Duplex>
  /** `host:port` echoed to the client in the RDCleanPath response. */
  serverAddr: string
  /** Trust-on-first-use check of the server leaf-cert fingerprint (colon-hex SHA-256). */
  verifyCert: (fingerprint: string) => { ok: boolean; reason?: string }
  /** Fired exactly once when the session ends (tears down a dedicated SSH conn). */
  onClosed: () => void
}

interface Pending extends RdpTarget {
  expiresAt: number
}

let server: WebSocketServer | null = null
let serverPort: number | null = null
const pending = new Map<string, Pending>()

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

function sweepExpired(): void {
  const now = Date.now()
  for (const [token, t] of pending) {
    if (t.expiresAt < now) {
      pending.delete(token)
      t.onClosed()
    }
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
      rdpLog(`rdp-proxy: listener error after start: ${err.message}`)
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
    throw new Error('rdp-proxy: could not determine listening port')
  }
  wss.on('connection', (ws, req) => {
    sweepExpired()
    const token = (req.url ?? '').replace(/^\//, '')
    const target = token ? pending.get(token) : undefined
    if (!target) {
      rdpLog('proxy: WS connection with invalid/expired token — rejected')
      ws.close(1008, 'invalid token')
      return
    }
    pending.delete(token)
    void handleConnection(ws, target)
  })
  server = wss
  serverPort = address.port
  return address.port
}

/** Reads from a duplex until `isComplete(buffer)` returns a length, resolving that framed slice. */
function readFramed(stream: Duplex, isComplete: (buf: Buffer) => number | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk])
      let total: number | null
      try {
        total = isComplete(buf)
      } catch (err) {
        cleanup()
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      if (total !== null) {
        cleanup()
        resolve(buf.subarray(0, total))
      }
    }
    const onErr = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const onEnd = (): void => {
      cleanup()
      reject(new Error('stream ended during handshake'))
    }
    const cleanup = (): void => {
      stream.removeListener('data', onData)
      stream.removeListener('error', onErr)
      stream.removeListener('end', onEnd)
    }
    stream.on('data', onData)
    stream.on('error', onErr)
    stream.on('end', onEnd)
  })
}

/** Builds the server cert chain (leaf first, DER) from a TLS socket, deduped by fingerprint. */
function collectCertChain(socket: tls.TLSSocket): { chain: Buffer[]; leafFingerprint: string } {
  const chain: Buffer[] = []
  const seen = new Set<string>()
  let cert = socket.getPeerCertificate(true) as tls.DetailedPeerCertificate | undefined
  let leafFingerprint = ''
  let guard = 0
  while (cert?.raw && guard++ < 16) {
    const der = cert.raw
    const fp = certFingerprint(der)
    if (leafFingerprint === '') leafFingerprint = fp
    if (seen.has(fp)) break
    seen.add(fp)
    chain.push(der)
    const issuer = cert.issuerCertificate
    if (!issuer || issuer === cert) break
    cert = issuer
  }
  return { chain, leafFingerprint }
}

async function handleConnection(ws: WebSocket, target: Pending): Promise<void> {
  let serverStream: Duplex | null = null
  let tlsSocket: tls.TLSSocket | null = null
  let closed = false
  let phase: 'handshake' | 'relay' = 'handshake'
  let reqBuf = Buffer.alloc(0)

  const finish = (): void => {
    if (closed) return
    closed = true
    try {
      tlsSocket?.destroy()
    } catch {
      /* best-effort */
    }
    try {
      serverStream?.destroy()
    } catch {
      /* best-effort */
    }
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close()
    target.onClosed()
  }

  const fail = (code: number, log: string): void => {
    rdpLog(`proxy: ${log}`)
    try {
      if (ws.readyState === ws.OPEN) ws.send(buildRdCleanPathError(code), { binary: true })
    } catch {
      /* best-effort */
    }
    finish()
  }

  const handshakeTimer = setTimeout(() => {
    if (phase === 'handshake' && !closed) fail(ERR_PROXY_CONNECT, 'handshake timed out')
  }, HANDSHAKE_TIMEOUT_MS)
  handshakeTimer.unref?.()

  const startRelay = (): void => {
    if (!tlsSocket) return
    phase = 'relay'
    clearTimeout(handshakeTimer)
    tlsSocket.on('data', (chunk: Buffer) => {
      if (ws.readyState !== ws.OPEN) return
      ws.send(chunk, { binary: true })
      if (ws.bufferedAmount > BACKPRESSURE_HIGH_WATER) {
        tlsSocket?.pause()
        const drain = setInterval(() => {
          if (ws.readyState !== ws.OPEN || ws.bufferedAmount < BACKPRESSURE_HIGH_WATER / 4) {
            clearInterval(drain)
            tlsSocket?.resume()
          }
        }, 20)
      }
    })
    tlsSocket.on('error', finish)
    tlsSocket.on('close', finish)
  }

  const doServerHandshake = async (x224: Buffer): Promise<void> => {
    try {
      serverStream = await target.connect()
    } catch (err) {
      fail(ERR_PROXY_CONNECT, `target connect failed: ${err instanceof Error ? err.message : err}`)
      return
    }
    // Cleartext X.224: forward the client's Connection Request, read the Confirm.
    serverStream.write(x224)
    let x224Confirm: Buffer
    try {
      x224Confirm = await readFramed(serverStream, tpktLength)
    } catch (err) {
      fail(ERR_PROXY_CONNECT, `X.224 exchange failed: ${err instanceof Error ? err.message : err}`)
      return
    }
    // Upgrade to TLS; the proxy terminates TLS and the client binds CredSSP to
    // the returned cert chain. Self-signed RDP certs are the norm — we don't
    // reject here; MITM protection comes from our own TOFU pin check below.
    const socket = tls.connect({ socket: serverStream, rejectUnauthorized: false }, () => {
      if (closed || !socket) return
      const { chain, leafFingerprint } = collectCertChain(socket)
      if (chain.length === 0) {
        fail(ERR_PROXY_CONNECT, 'server presented no certificate')
        return
      }
      const verdict = target.verifyCert(leafFingerprint)
      if (!verdict.ok) {
        fail(ERR_PROXY_CONNECT, `cert pin check failed: ${verdict.reason ?? 'mismatch'}`)
        return
      }
      const response = buildRdCleanPathResponse({
        x224: x224Confirm,
        certChain: chain,
        serverAddr: target.serverAddr,
      })
      if (ws.readyState === ws.OPEN) ws.send(response, { binary: true })
      startRelay()
    })
    tlsSocket = socket
    socket.on('error', (err) => {
      if (phase === 'handshake') fail(ERR_PROXY_CONNECT, `TLS handshake failed: ${err.message}`)
      else finish()
    })
  }

  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    if (!isBinary) return
    const chunk = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data)
    if (phase === 'relay') {
      tlsSocket?.write(chunk)
      return
    }
    // Handshake: accumulate until the full RDCleanPath request PDU is buffered.
    reqBuf = Buffer.concat([reqBuf, chunk])
    let total: number | null
    try {
      total = derValueLength(reqBuf)
    } catch (err) {
      fail(
        ERR_PROXY_CONNECT,
        `bad RDCleanPath request: ${err instanceof Error ? err.message : err}`,
      )
      return
    }
    if (total === null) return
    let req: ReturnType<typeof parseRdCleanPathRequest>
    try {
      req = parseRdCleanPathRequest(reqBuf.subarray(0, total))
    } catch (err) {
      fail(ERR_PROXY_CONNECT, `parse failed: ${err instanceof Error ? err.message : err}`)
      return
    }
    if (!req.x224) {
      fail(ERR_PROXY_CONNECT, 'RDCleanPath request carried no X.224 PDU')
      return
    }
    rdpLog(`proxy: RDCleanPath request received, connecting to ${target.serverAddr}`)
    void doServerHandshake(req.x224)
  })
  ws.on('error', finish)
  ws.on('close', finish)
}

/**
 * Registers a one-time RDCleanPath target and returns its ws:// URL. Single-use,
 * expires after 30 s if no client connects (onClosed fires exactly once either
 * way). Mirrors the VNC bridge's registerBridgeTarget.
 */
export async function registerRdpTarget(target: RdpTarget): Promise<string> {
  const port = await ensureServer()
  const token = randomBytes(24).toString('base64url')
  pending.set(token, { ...target, expiresAt: Date.now() + TOKEN_TTL_MS })
  setTimeout(sweepExpired, TOKEN_TTL_MS + 1000).unref?.()
  return `ws://127.0.0.1:${port}/${token}`
}

/** Test/diagnostics: current pending token count. */
export function pendingRdpTokenCount(): number {
  sweepExpired()
  return pending.size
}

/**
 * Tears the proxy down on app quit: fires onClosed for every never-connected
 * target (releasing any dedicated SSH connection) and closes the WS server.
 * Mirrors the VNC bridge's shutdownBridge.
 */
export function shutdownRdpProxy(): void {
  for (const [, target] of pending) target.onClosed()
  pending.clear()
  server?.close()
  server = null
  serverPort = null
}
