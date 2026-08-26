import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { pendingRdpTokenCount, registerRdpTarget, shutdownRdpProxy } from './rdp-proxy'

function target(onClosed: () => void) {
  return {
    connect: async () => new PassThrough(),
    serverAddr: '10.0.0.1:3389',
    verifyCert: () => ({ ok: true }),
    onClosed,
  }
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

afterAll(() => {
  shutdownRdpProxy()
})

describe('rdp-proxy', () => {
  it('tracks a pending token until the server is torn down', async () => {
    const before = pendingRdpTokenCount()
    await registerRdpTarget(target(() => {}))
    expect(pendingRdpTokenCount()).toBe(before + 1)
  })

  it('fires onClosed for every never-connected target on shutdown', async () => {
    let closedA = false
    let closedB = false
    await registerRdpTarget(
      target(() => {
        closedA = true
      }),
    )
    await registerRdpTarget(
      target(() => {
        closedB = true
      }),
    )
    shutdownRdpProxy()
    expect(closedA).toBe(true)
    expect(closedB).toBe(true)
    expect(pendingRdpTokenCount()).toBe(0)
  })

  it('rejects a connection with an unknown token (code 1008)', async () => {
    const wsUrl = await registerRdpTarget(target(() => {}))
    const base = wsUrl.replace(/\/[^/]*$/, '')
    expect(await expectClose(`${base}/not-a-real-token`)).toBe(1008)
  })
})
