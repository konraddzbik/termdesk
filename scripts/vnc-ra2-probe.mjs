/**
 * Headless RealVNC RSA-AES (type 5) handshake probe via patched noVNC.
 * Usage:
 *   VNC_USER=... VNC_PASS=... node scripts/vnc-ra2-probe.mjs [host] [port]
 *   node scripts/vnc-probe-from-db.mjs [hostId]   # loads creds from sshdeck.db
 */
import { webcrypto } from 'node:crypto'
import net from 'node:net'
import { JSDOM } from 'jsdom'
import WebSocket, { WebSocketServer } from 'ws'

// Loopback default on purpose: a developer's own LAN address must not be baked
// into a script that ships in the repository.
const targetHost = process.argv[2] ?? '127.0.0.1'
const targetPort = Number(process.argv[3] ?? 5900)
const username = process.env.VNC_USER ?? ''
const password = process.env.VNC_PASS ?? ''

if (!username || !password) {
  console.error('VNC_RA2_PROBE_FAIL: set VNC_USER and VNC_PASS')
  process.exit(1)
}

function relayBridge(wss, stream) {
  wss.on('connection', (ws) => {
    let closed = false
    const finish = () => {
      if (closed) return
      closed = true
      try {
        stream.destroy()
      } catch {
        /* ignore */
      }
      if (ws.readyState === WebSocket.OPEN) ws.close()
    }
    stream.on('data', (chunk) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true })
    })
    stream.on('close', finish)
    stream.on('error', finish)
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      stream.write(buf)
    })
    ws.on('close', finish)
    ws.on('error', finish)
  })
}

async function openTcp() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(targetPort, targetHost)
    sock.once('connect', () => resolve(sock))
    sock.once('error', reject)
    sock.setTimeout(15_000, () => {
      sock.destroy()
      reject(new Error('TCP connect timeout'))
    })
  })
}

const dom = new JSDOM('<div id="screen"></div>', { url: 'https://localhost/' })
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.WebSocket = WebSocket
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator,
    configurable: true,
  })
}
Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true })
globalThis.CustomEvent = window.CustomEvent
globalThis.MutationObserver = window.MutationObserver
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.Uint8Array = Uint8Array
globalThis.setTimeout = setTimeout
globalThis.clearTimeout = clearTimeout

window.HTMLCanvasElement.prototype.getContext = () => ({
  fillRect() {},
  clearRect() {},
  drawImage() {},
  getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData() {},
  createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  setTransform() {},
  resetTransform() {},
  scale() {},
  translate() {},
  save() {},
  restore() {},
})

const { default: RFB } = await import('@novnc/novnc')

const stream = await openTcp()
const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await new Promise((resolve, reject) => {
  wss.once('listening', resolve)
  wss.once('error', reject)
})
relayBridge(wss, stream)
const { port } = wss.address()

const phases = []
const container = window.document.getElementById('screen')
const rfb = new RFB(container, `ws://127.0.0.1:${port}`, {
  credentials: { username, password },
})

const result = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    resolve({ ok: false, reason: 'timeout', phases })
  }, 20_000)

  rfb.addEventListener('connect', () => {
    clearTimeout(timer)
    resolve({ ok: true, phases })
  })
  rfb.addEventListener('disconnect', (e) => {
    if (e.detail.clean) return
    clearTimeout(timer)
    resolve({ ok: false, reason: 'disconnect', phases })
  })
  rfb.addEventListener('rfberror', (e) => {
    clearTimeout(timer)
    resolve({ ok: false, reason: e.detail.message, phases })
  })
  rfb.addEventListener('securityfailure', (e) => {
    clearTimeout(timer)
    resolve({ ok: false, reason: `security ${e.detail.status}: ${e.detail.reason}`, phases })
  })
  rfb.addEventListener('ra2phase', (e) => {
    phases.push(e.detail.phase)
    console.log(`[probe] ra2: ${e.detail.phase}`)
  })
  rfb.addEventListener('securitytype', (e) => {
    phases.push(`security-type-${e.detail.type}`)
    console.log(`[probe] security type: ${e.detail.type}`)
  })
  rfb.addEventListener('serververification', () => {
    rfb.approveServer()
    phases.push('serververification')
  })
})

rfb.disconnect()
wss.close()
stream.destroy()

if (result.ok) {
  console.log(`VNC_RA2_PROBE_OK phases=${phases.join(',')}`)
  process.exit(0)
}
console.error(`VNC_RA2_PROBE_FAIL: ${result.reason} phases=${phases.join(',')}`)
process.exit(1)