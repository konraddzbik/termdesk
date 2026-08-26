import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hostInputSchema } from '@shared/ipc'
import { app } from 'electron'
import { WebSocket } from 'ws'
import { envFlag } from '../app-paths'
import type { DataSink } from '../ssh/session-manager'
import { sessionManager } from '../ssh/session-manager'
import { setSmokeDbPath } from '../store/db'
import { createHost } from '../store/hosts-repo'
import { openVnc } from './vnc-manager'
import { shutdownBridge } from './ws-bridge'

/**
 * VNC end-to-end smoke (TERMDESK_SMOKE=vnc) against the docker test server.
 * Protocol-level verification of the parts that don't need a GUI:
 *  1. Direct TCP variant: the RFB greeting flows through the ws-bridge.
 *  2. SSH-tunnel variant: same greeting through ssh2 forwardOut.
 *  3. A connection without a valid token is rejected before reaching a target.
 *  4. A token is single-use: the second connection with it is rejected.
 * Prints VNC_SMOKE_OK or VNC_SMOKE_FAIL: <reason>.
 */

const HANDSHAKE_TIMEOUT_MS = 10_000

function makeSink(): DataSink {
  return { id: 9_999_998, isDestroyed: () => false, send: () => {} }
}

/** Connects to the bridge and resolves with the first binary message. */
function firstMessage(wsUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('timed out waiting for RFB greeting'))
    }, HANDSHAKE_TIMEOUT_MS)
    ws.on('message', (data: Buffer) => {
      clearTimeout(timer)
      ws.close()
      resolve(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
    })
    ws.on('close', (code, reasonBuf) => {
      clearTimeout(timer)
      reject(new Error(`closed before greeting (code ${code} ${reasonBuf.toString()})`))
    })
    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/** Expects the bridge to reject the connection (close without any message). */
function expectRejected(wsUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('rejection expected but connection lingered'))
    }, HANDSHAKE_TIMEOUT_MS)
    ws.on('message', () => {
      clearTimeout(timer)
      ws.terminate()
      reject(new Error('received data on a connection that should have been rejected'))
    })
    ws.on('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
    ws.on('error', () => {
      // connection-level errors also count as rejection; close will follow
    })
  })
}

function assertRfbGreeting(buffer: Buffer, label: string): void {
  if (!buffer.subarray(0, 4).toString('ascii').startsWith('RFB ')) {
    throw new Error(`${label}: expected RFB greeting, got ${buffer.subarray(0, 12).toString()}`)
  }
}

export async function runVncSmokeTest(): Promise<void> {
  const host = envFlag('SMOKE_HOST') ?? '127.0.0.1'
  const sshPort = Number.parseInt(envFlag('SMOKE_PORT') ?? '2222', 10)
  const vncPort = Number.parseInt(envFlag('SMOKE_VNC_PORT') ?? '5901', 10)
  const username = envFlag('SMOKE_USER') ?? 'testuser'
  const password = envFlag('SMOKE_PASSWORD') ?? 'testpass123'

  const smokeDir = mkdtempSync(join(tmpdir(), 'sshdeck-vnc-smoke-'))
  setSmokeDbPath(join(smokeDir, 'smoke.db'))
  const sink = makeSink()

  try {
    // --- 1. Direct variant ---
    const directHost = createHost(
      hostInputSchema.parse({
        label: `vnc-smoke-direct-${randomUUID().slice(0, 8)}`,
        hostname: host,
        port: sshPort,
        username,
        authType: 'password',
        password,
        vncPort,
        vncMode: 'direct',
      }),
    )
    const direct = await openVnc(directHost.id, sink)
    assertRfbGreeting(await firstMessage(direct.wsUrl), 'direct')
    console.log('vnc-smoke: direct variant ok')

    // --- 2. Tunnel variant (dedicated SSH connection, auto-accepted host key) ---
    const tunnelHost = createHost(
      hostInputSchema.parse({
        label: `vnc-smoke-tunnel-${randomUUID().slice(0, 8)}`,
        hostname: host,
        port: sshPort,
        username,
        authType: 'password',
        password,
        vncPort,
        vncMode: 'tunnel',
      }),
    )
    const tunnel = await openVnc(tunnelHost.id, sink)
    assertRfbGreeting(await firstMessage(tunnel.wsUrl), 'tunnel')
    console.log('vnc-smoke: ssh-tunnel variant ok')

    // --- 3. Invalid token is rejected ---
    const base = tunnel.wsUrl.replace(/\/[^/]*$/, '')
    const badCode = await expectRejected(`${base}/forged-token-${randomUUID()}`)
    if (badCode !== 1008) throw new Error(`invalid token close code ${badCode}, expected 1008`)
    console.log('vnc-smoke: invalid token rejected ok')

    // --- 4. Token is single-use ---
    const reuse = await openVnc(tunnelHost.id, sink)
    assertRfbGreeting(await firstMessage(reuse.wsUrl), 'single-use first connect')
    const reuseCode = await expectRejected(reuse.wsUrl)
    if (reuseCode !== 1008) throw new Error(`token reuse close code ${reuseCode}, expected 1008`)
    console.log('vnc-smoke: token single-use ok')

    console.log('VNC_SMOKE_OK')
  } catch (err) {
    console.log(`VNC_SMOKE_FAIL: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  } finally {
    shutdownBridge()
    sessionManager.destroyAll()
    rmSync(smokeDir, { recursive: true, force: true })
    app.quit()
  }
}
