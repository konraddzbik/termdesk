import {
  type AddressInfo,
  createServer,
  connect as netConnect,
  type Server,
  type Socket,
} from 'node:net'
import type { SavedTunnel } from '@shared/ipc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mocks: the repo (tunnel definition) and the SSH session manager. --------
const state = vi.hoisted(() => ({
  saved: null as SavedTunnel | null,
  upstreamPort: 0,
  disconnect: vi.fn(),
}))

vi.mock('./session-manager', () => ({
  sessionManager: {
    // A "borrowed" SSH client whose forwardOut just opens a real TCP connection
    // to our local echo upstream — standing in for the remote destination.
    borrowClient: () => ({
      forwardOut: (
        _sip: string,
        _sport: number,
        _dh: string,
        _dp: number,
        cb: (err: Error | undefined, ch: Socket) => void,
      ) => {
        const up = netConnect({ host: '127.0.0.1', port: state.upstreamPort })
        up.once('connect', () => cb(undefined, up))
        up.once('error', (e) => cb(e, up))
      },
      once: vi.fn(),
    }),
    connectDedicated: vi.fn(),
    disconnect: state.disconnect,
  },
}))

vi.mock('../store/tunnels-repo', () => ({
  findTunnel: () => state.saved,
}))

import { tunnelManager } from './tunnel-manager'

const owner = { id: 42, send: vi.fn(), isDestroyed: () => false }

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port
      s.close(() => resolve(port))
    })
  })
}

let upstream: Server
beforeEach(async () => {
  // Echo upstream representing the remote destination.
  upstream = createServer((sock) => sock.pipe(sock))
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
  state.upstreamPort = (upstream.address() as AddressInfo).port
  state.disconnect.mockClear()
  owner.send.mockClear()
})

afterEach(() => {
  tunnelManager.destroyForOwner(owner.id)
  upstream.close()
})

describe('tunnelManager (local forward)', () => {
  it('relays bytes through forwardOut and reports running status', async () => {
    const listenPort = await freePort()
    state.saved = {
      id: 't1',
      hostId: 'h1',
      type: 'local',
      listenHost: '127.0.0.1',
      listenPort,
      dstHost: '127.0.0.1',
      dstPort: 9999,
      name: null,
      autoStart: false,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    }

    const status = await tunnelManager.start('t1', owner)
    expect(status.running).toBe(true)
    expect(tunnelManager.list(owner.id).map((s) => s.savedId)).toContain('t1')

    // A client connecting to the local listen port should round-trip through
    // the (stubbed) forwardOut to the echo upstream.
    const echoed = await new Promise<string>((resolve, reject) => {
      const c = netConnect({ host: '127.0.0.1', port: listenPort })
      c.setEncoding('utf8')
      c.once('connect', () => c.write('ping-123'))
      c.once('data', (d) => {
        resolve(String(d))
        c.end()
      })
      c.once('error', reject)
      setTimeout(() => reject(new Error('timeout')), 3000)
    })
    expect(echoed).toBe('ping-123')
  })

  it('is owner-scoped and tears down on destroyForOwner', async () => {
    const listenPort = await freePort()
    state.saved = {
      id: 't2',
      hostId: 'h1',
      type: 'local',
      listenHost: '127.0.0.1',
      listenPort,
      dstHost: '127.0.0.1',
      dstPort: 9999,
      name: null,
      autoStart: false,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    }
    await tunnelManager.start('t2', owner)
    expect(tunnelManager.list(owner.id)).toHaveLength(1)
    // A different owner sees nothing.
    expect(tunnelManager.list(99)).toHaveLength(0)

    tunnelManager.destroyForOwner(owner.id)
    expect(tunnelManager.list(owner.id)).toHaveLength(0)

    // The listen port is released — a fresh server can bind it.
    await new Promise<void>((resolve, reject) => {
      const s = createServer()
      s.once('error', reject)
      s.listen(listenPort, '127.0.0.1', () => s.close(() => resolve()))
    })
  })

  it('reports a friendly error when the local port is already in use', async () => {
    const listenPort = await freePort()
    const blocker = createServer()
    await new Promise<void>((r) => blocker.listen(listenPort, '127.0.0.1', r))
    state.saved = {
      id: 't3',
      hostId: 'h1',
      type: 'local',
      listenHost: '127.0.0.1',
      listenPort,
      dstHost: '127.0.0.1',
      dstPort: 9999,
      name: null,
      autoStart: false,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    }
    await expect(tunnelManager.start('t3', owner)).rejects.toThrow(/already in use/i)
    blocker.close()
  })
})
