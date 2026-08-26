import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { pendingTokenCount, registerBridgeTarget, shutdownBridge } from './ws-bridge'

/** Echo duplex standing in for a VNC server socket. */
function echoStream(): PassThrough {
  return new PassThrough()
}

function connectAndSend(wsUrl: string, payload: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('echo timeout'))
    }, 5000)
    ws.on('open', () => ws.send(payload, { binary: true }))
    ws.on('message', (data: Buffer) => {
      clearTimeout(timer)
      ws.close()
      resolve(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
    })
    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function expectClose(wsUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('close timeout'))
    }, 5000)
    ws.on('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
    ws.on('error', () => {})
  })
}

/** Resolves if the upgrade is rejected (never opens), rejects if it opens. */
function expectUpgradeRejected(wsUrl: string, origin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers: { Origin: origin } })
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('expected the upgrade to be rejected'))
    }, 5000)
    ws.on('open', () => {
      clearTimeout(timer)
      ws.close()
      reject(new Error('connection unexpectedly opened'))
    })
    ws.on('error', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

afterAll(() => {
  shutdownBridge()
})

describe('ws-bridge', () => {
  it('pipes bytes both ways through a tokened connection', async () => {
    let closed = false
    const wsUrl = await registerBridgeTarget(
      async () => echoStream(),
      () => {
        closed = true
      },
    )
    const echoed = await connectAndSend(wsUrl, Buffer.from('RFB 003.008\n'))
    expect(echoed.toString()).toBe('RFB 003.008\n')
    // Closing the ws side must release the target.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(closed).toBe(true)
  })

  it('rejects a connection without a known token (code 1008)', async () => {
    const wsUrl = await registerBridgeTarget(
      async () => echoStream(),
      () => {},
    )
    const base = wsUrl.replace(/\/[^/]*$/, '')
    expect(await expectClose(`${base}/not-a-real-token`)).toBe(1008)
  })

  it('enforces single-use tokens', async () => {
    const wsUrl = await registerBridgeTarget(
      async () => echoStream(),
      () => {},
    )
    await connectAndSend(wsUrl, Buffer.from('x'))
    expect(await expectClose(wsUrl)).toBe(1008)
  })

  it('closes the websocket when the target stream fails to connect', async () => {
    const wsUrl = await registerBridgeTarget(
      async () => {
        throw new Error('boom')
      },
      () => {},
    )
    expect(await expectClose(wsUrl)).toBe(1011)
  })

  it('rejects an upgrade from a disallowed Origin before the token is consulted', async () => {
    const wsUrl = await registerBridgeTarget(
      async () => echoStream(),
      () => {},
    )
    const before = pendingTokenCount()
    await expectUpgradeRejected(wsUrl, 'https://evil.example.com')
    // Rejected at verifyClient, before token lookup — so the token is untouched
    // and still usable (a stray browser tab can't even burn a valid token).
    expect(pendingTokenCount()).toBe(before)
    expect(await connectAndSend(wsUrl, Buffer.from('z'))).toEqual(Buffer.from('z'))
  })

  it('tracks pending tokens until use', async () => {
    const before = pendingTokenCount()
    const wsUrl = await registerBridgeTarget(
      async () => echoStream(),
      () => {},
    )
    expect(pendingTokenCount()).toBe(before + 1)
    await connectAndSend(wsUrl, Buffer.from('y'))
    expect(pendingTokenCount()).toBe(before)
  })
})
