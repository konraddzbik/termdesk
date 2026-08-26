import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostRow } from '../store/hosts-repo'

// openVnc reaches out to the SSH layer, the WebSocket bridge and the host
// vault. We stub all three so the tests exercise only the kind/mode guard:
//   - findHostRow returns whatever row the test wants,
//   - registerBridgeTarget rejects with a sentinel so any code path that gets
//     PAST the guard fails recognizably (and never opens a real socket/tunnel),
//   - sessionManager.borrowClient hands back a dummy client for the tunnel path.
const BRIDGE_SENTINEL = new Error('__bridge_reached__')

const findHostRow = vi.fn<(id: string) => HostRow | null>()
vi.mock('../store/hosts-repo', () => ({
  findHostRow: (id: string) => findHostRow(id),
}))
vi.mock('./ws-bridge', () => ({
  registerBridgeTarget: vi.fn(() => Promise.reject(BRIDGE_SENTINEL)),
}))
vi.mock('../ssh/session-manager', () => ({
  sessionManager: {
    borrowClient: vi.fn(() => ({ forwardOut: vi.fn() })),
    connectDedicated: vi.fn(),
    disconnect: vi.fn(),
  },
}))
vi.mock('../store/secrets', () => ({ decryptSecret: vi.fn(() => 'pw') }))

import { openVnc } from './vnc-manager'

function row(over: Partial<HostRow>): HostRow {
  return {
    id: 'h1',
    label: 'desktop',
    hostname: '10.0.0.5',
    port: 22,
    username: '',
    authType: 'agent',
    keyPath: null,
    proxyJump: null,
    kind: 'vnc',
    vncPort: 5901,
    vncMode: 'direct',
    vncPasswordEnc: null,
    groupId: null,
    tags: '[]',
    color: null,
    passwordEnc: null,
    passphraseEnc: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as HostRow
}

const owner = { id: 'sink-1' } as never

describe('openVnc kind/mode guard', () => {
  beforeEach(() => {
    findHostRow.mockReset()
  })

  it('rejects a VNC-only host configured for tunnel mode with a clear message', async () => {
    findHostRow.mockReturnValue(row({ kind: 'vnc', vncMode: 'tunnel' }))
    await expect(openVnc('h1', owner)).rejects.toThrow(/VNC-only/)
  })

  it('lets a VNC-only host in direct mode past the guard', async () => {
    findHostRow.mockReturnValue(row({ kind: 'vnc', vncMode: 'direct' }))
    // Passing the guard means execution reaches the bridge (our sentinel),
    // not the guard error.
    await expect(openVnc('h1', owner)).rejects.toBe(BRIDGE_SENTINEL)
  })

  it('lets a dual-capability (both) host tunnel — the guard only blocks pure VNC', async () => {
    findHostRow.mockReturnValue(row({ kind: 'both', vncMode: 'tunnel' }))
    await expect(openVnc('h1', owner)).rejects.toBe(BRIDGE_SENTINEL)
  })

  it('throws "Host not found" when the host is missing', async () => {
    findHostRow.mockReturnValue(null)
    await expect(openVnc('missing', owner)).rejects.toThrow('Host not found')
  })
})
