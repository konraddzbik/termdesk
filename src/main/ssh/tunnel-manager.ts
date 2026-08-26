import { createServer, type Server, type Socket } from 'node:net'
import { IPC_EVENTS } from '@shared/channels'
import type { SavedTunnel, TunnelStatus } from '@shared/ipc'
import type { Client, ClientChannel } from 'ssh2'
import { findTunnel } from '../store/tunnels-repo'
import { type DataSink, sessionManager } from './session-manager'
import { parseConnect, parseGreeting } from './socks'

/**
 * SSH port-forward / tunnel runtime. A tunnel binds a local `net.Server` and
 * relays each accepted connection over an ssh2 `forwardOut` channel — reusing a
 * live terminal's SSH client when one exists (`borrowClient`), else a dedicated
 * shell-less connection (with ProxyJump + host-key verification + vault auth).
 *
 * - `local`   : every connection forwards to a fixed remote host:port.
 * - `dynamic` : the connection first speaks SOCKS5 (no-auth + CONNECT); the
 *               parsed destination is then forwarded.
 *
 * Tunnels are owner-scoped (one runtime per window per saved tunnel) and torn
 * down when the window closes. No new SSH/auth code lives here.
 */

interface ActiveTunnel {
  saved: SavedTunnel
  ownerId: number
  owner: DataSink
  server: Server
  /** Set when we opened our own connection (vs borrowing) — disconnect on stop. */
  dedicatedSessionId: string | null
  client: Client
  sockets: Set<Socket>
  bytesUp: number
  bytesDown: number
  connections: number
  refresh: ReturnType<typeof setInterval> | null
  stopped: boolean
}

function key(ownerId: number, savedId: string): string {
  return `${ownerId}:${savedId}`
}

class TunnelManager {
  private readonly active = new Map<string, ActiveTunnel>()

  private statusOf(t: ActiveTunnel, error: string | null = null): TunnelStatus {
    return {
      savedId: t.saved.id,
      running: !t.stopped,
      error,
      bytesUp: t.bytesUp,
      bytesDown: t.bytesDown,
      connections: t.connections,
    }
  }

  private emit(t: ActiveTunnel, error: string | null = null): void {
    if (!t.owner.isDestroyed()) t.owner.send(IPC_EVENTS.tunnelEvent, this.statusOf(t, error))
  }

  /** Pipe `from`→`to` with byte counting + high-water backpressure. */
  private relay(
    from: NodeJS.ReadableStream,
    to: NodeJS.WritableStream,
    count: (n: number) => void,
  ): void {
    from.on('data', (chunk: Buffer) => {
      count(chunk.length)
      if (!to.write(chunk)) {
        from.pause()
        to.once('drain', () => from.resume())
      }
    })
  }

  private wire(t: ActiveTunnel, socket: Socket, channel: ClientChannel): void {
    t.sockets.add(socket)
    t.connections += 1
    let closed = false
    const cleanup = (): void => {
      if (closed) return
      closed = true
      t.sockets.delete(socket)
      t.connections = Math.max(0, t.connections - 1)
      try {
        socket.destroy()
      } catch {
        /* already gone */
      }
      try {
        channel.destroy?.()
      } catch {
        /* already gone */
      }
      this.emit(t)
    }
    socket.on('error', cleanup)
    channel.on('error', cleanup)
    socket.on('close', cleanup)
    channel.on('close', cleanup)
    this.relay(socket, channel, (n) => {
      t.bytesUp += n
    })
    this.relay(channel, socket, (n) => {
      t.bytesDown += n
    })
    this.emit(t)
  }

  private forward(t: ActiveTunnel, socket: Socket, dstHost: string, dstPort: number): void {
    if (t.stopped) {
      socket.destroy()
      return
    }
    // ssh2's forwardOut THROWS synchronously ('Not connected') when the client's
    // socket is no longer writable — it does not route that through the
    // callback. This runs inside a net.Server 'connection' listener, so an
    // unwrapped throw is an uncaught exception in the Electron main process:
    // every terminal, transfer and tunnel in the app dies with it. That window
    // is ordinary, not exotic — closing the terminal tab whose client this
    // tunnel borrowed makes the socket unwritable before 'close' has fired.
    try {
      t.client.forwardOut('127.0.0.1', socket.remotePort ?? 0, dstHost, dstPort, (err, channel) => {
        if (err) {
          socket.destroy()
          return
        }
        this.wire(t, socket, channel)
      })
    } catch {
      socket.destroy()
      this.stop(t.saved.id, t.ownerId, 'SSH connection closed')
    }
  }

  /** SOCKS5 (no-auth + CONNECT) handshake, then forward to the requested dst. */
  private handleSocks(t: ActiveTunnel, socket: Socket): void {
    let phase: 'greeting' | 'connect' | 'done' = 'greeting'
    let buf = Buffer.alloc(0)
    // Bound the handshake: a client that connects but never completes the SOCKS
    // negotiation must not hold a socket (and its accept slot) open forever.
    // Cleared once relaying starts, since a live tunnel may legitimately idle.
    const HANDSHAKE_TIMEOUT_MS = 30_000
    socket.setTimeout(HANDSHAKE_TIMEOUT_MS)
    socket.once('timeout', () => socket.destroy())
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk])
      if (phase === 'greeting') {
        const g = parseGreeting(buf)
        if (g.status === 'incomplete') return
        if (g.status === 'error') {
          if (g.reply) socket.write(g.reply)
          socket.destroy()
          return
        }
        socket.write(g.reply)
        phase = 'connect'
        buf = Buffer.alloc(0)
        return
      }
      if (phase === 'connect') {
        const c = parseConnect(buf)
        if (c.status === 'incomplete') return
        if (c.status === 'error') {
          if (c.reply) socket.write(c.reply)
          socket.destroy()
          return
        }
        phase = 'done'
        socket.setTimeout(0) // handshake complete; allow long-lived idle relaying
        socket.off('data', onData)
        socket.write(c.reply)
        this.forward(t, socket, c.host, c.port)
      }
    }
    socket.on('data', onData)
    socket.on('error', () => socket.destroy())
  }

  /**
   * Start a saved tunnel. `requireBorrowable` (auto-start) refuses to open a new
   * SSH connection — and thus never fires a host-key prompt — when the host has
   * no live, borrowable client.
   */
  async start(
    savedId: string,
    owner: DataSink,
    opts?: { requireBorrowable?: boolean },
  ): Promise<TunnelStatus> {
    const existing = this.active.get(key(owner.id, savedId))
    if (existing && !existing.stopped) return this.statusOf(existing)

    const saved = findTunnel(savedId)
    if (!saved) throw new Error('Tunnel not found')

    let client = sessionManager.borrowClient(saved.hostId, owner.id)
    let dedicatedSessionId: string | null = null
    if (!client) {
      if (opts?.requireBorrowable) throw new Error('Host is not connected')
      const dedicated = await sessionManager.connectDedicated(saved.hostId, owner)
      client = dedicated.client
      dedicatedSessionId = dedicated.sessionId
    }

    const server = createServer()
    const t: ActiveTunnel = {
      saved,
      ownerId: owner.id,
      owner,
      server,
      dedicatedSessionId,
      client,
      sockets: new Set(),
      bytesUp: 0,
      bytesDown: 0,
      connections: 0,
      refresh: null,
      stopped: false,
    }

    server.on('connection', (socket) => {
      socket.setNoDelay(true)
      if (saved.type === 'dynamic') this.handleSocks(t, socket)
      else this.forward(t, socket, saved.dstHost ?? '127.0.0.1', saved.dstPort ?? 0)
    })

    // If the (borrowed or dedicated) SSH client drops, the tunnel can't relay —
    // tear it down rather than leave an orphaned bound port.
    const onClientDown = (): void => this.stop(savedId, owner.id, 'SSH connection closed')
    client.once('close', onClientDown)
    client.once('error', onClientDown)

    try {
      await new Promise<void>((resolve, reject) => {
        // `once('error', reject)` is a LISTEN-time guard only. Keep a permanent
        // handler as well: after 'listening' resolves, a post-listen error
        // (EMFILE on accept, ECONNRESET on the listener) would otherwise have
        // no listener at all, and an EventEmitter with no 'error' listener
        // throws ERR_UNHANDLED_ERROR — killing the whole main process.
        let settled = false
        server.on('error', (err) => {
          if (!settled) {
            settled = true
            reject(err)
            return
          }
          console.error(`[tunnel] listener error on ${saved.listenHost}:${saved.listenPort}:`, err)
          this.stop(saved.id, owner.id, err instanceof Error ? err.message : 'listener error')
        })
        server.listen(saved.listenPort, saved.listenHost, () => {
          settled = true
          resolve()
        })
      })
    } catch (err) {
      if (dedicatedSessionId) sessionManager.disconnect(dedicatedSessionId, owner.id)
      const msg =
        err instanceof Error && 'code' in err && (err as { code?: string }).code === 'EADDRINUSE'
          ? `Local port ${saved.listenPort} is already in use`
          : err instanceof Error
            ? err.message
            : 'failed to start tunnel'
      throw new Error(msg)
    }

    this.active.set(key(owner.id, savedId), t)
    // Light throughput refresh so the UI shows live byte counts.
    t.refresh = setInterval(() => this.emit(t), 2000)
    t.refresh.unref?.()
    this.emit(t)
    return this.statusOf(t)
  }

  stop(savedId: string, ownerId: number, error: string | null = null): void {
    const t = this.active.get(key(ownerId, savedId))
    if (!t) return
    t.stopped = true
    if (t.refresh) clearInterval(t.refresh)
    for (const s of t.sockets) {
      try {
        s.destroy()
      } catch {
        /* ignore */
      }
    }
    t.sockets.clear()
    try {
      t.server.close()
    } catch {
      /* ignore */
    }
    if (t.dedicatedSessionId) sessionManager.disconnect(t.dedicatedSessionId, ownerId)
    this.active.delete(key(ownerId, savedId))
    this.emit(t, error)
  }

  /** Runtime status of every running tunnel for an owner. */
  list(ownerId: number): TunnelStatus[] {
    const out: TunnelStatus[] = []
    for (const t of this.active.values()) {
      if (t.ownerId === ownerId) out.push(this.statusOf(t))
    }
    return out
  }

  /** Tear down every tunnel owned by `ownerId` (window closed / app quit). */
  destroyForOwner(ownerId: number): void {
    for (const t of [...this.active.values()]) {
      if (t.ownerId === ownerId) this.stop(t.saved.id, ownerId)
    }
  }

  /** Tear down every running tunnel regardless of owner (app quit). */
  destroyAll(): void {
    for (const t of [...this.active.values()]) this.stop(t.saved.id, t.ownerId)
  }
}

export const tunnelManager = new TunnelManager()
