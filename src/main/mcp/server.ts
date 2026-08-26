import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { IPC_EVENTS } from '@shared/channels'
import type { McpStatus } from '@shared/ipc'
import { BrowserWindow } from 'electron'
import { getSettings } from '../store/settings'
import { denyAllPending } from './approvals'
import { MCP_TOOLS } from './tools'

/**
 * MCP server exposing TermDesk's tools over Streamable HTTP on loopback, gated
 * by a bearer token. Stateless JSON mode: each request is handled by a fresh
 * server+transport, so there is no session state to leak or desync. Off by
 * default; the token rotates on every enable.
 */

const MAX_BODY_BYTES = 1024 * 1024

let httpServer: Server | null = null
let port: number | null = null
let token: string | null = null
/** Best-effort MCP client name from the initialize handshake, for audit labels. */
let clientLabel: string | null = null

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'termdesk', version: '0.1.1' })
  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputShape },
      async (args: unknown) => {
        const text = await tool.run((args ?? {}) as Record<string, unknown>, clientLabel)
        return { content: [{ type: 'text' as const, text }] }
      },
    )
  }
  return server
}

/**
 * The client name from an `initialize` handshake is untrusted display data —
 * any client holding the shared token can send anything. Strip control
 * characters and cap the length before it can reach the audit log or UI. It's
 * a cosmetic label, never identity (all clients share one token).
 */
function sanitizeClientLabel(name: string): string | null {
  // Drop control characters (untrusted input) without a control-char regex literal.
  let clean = ''
  for (const ch of name) {
    const c = ch.codePointAt(0) ?? 0
    clean += c < 0x20 || c === 0x7f ? ' ' : ch
  }
  clean = clean.trim().slice(0, 64)
  return clean === '' ? null : clean
}

function tokenOk(header: string | undefined): boolean {
  if (!token || !header) return false
  const m = /^Bearer\s+(.+)$/.exec(header)
  if (!m?.[1]) return false
  const a = Buffer.from(m[1])
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(undefined)
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function deny(res: ServerResponse, code: number, message: string): void {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/'
  if (!url.startsWith('/mcp')) return deny(res, 404, 'not found')
  if (!tokenOk(req.headers.authorization)) return deny(res, 401, 'unauthorized')
  if (req.method !== 'POST') return deny(res, 405, 'method not allowed (use POST)')

  let body: unknown
  try {
    body = await readBody(req)
  } catch (err) {
    return deny(res, 400, err instanceof Error ? err.message : 'bad request')
  }

  // Capture the client name from initialize for audit attribution.
  if (body && typeof body === 'object' && (body as { method?: string }).method === 'initialize') {
    const info = (body as { params?: { clientInfo?: { name?: string } } }).params?.clientInfo
    if (typeof info?.name === 'string') clientLabel = sanitizeClientLabel(info.name)
  }

  const server = buildMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    // Belt-and-suspenders with the bearer token: reject requests whose Host
    // header isn't our loopback endpoint, closing the DNS-rebinding channel a
    // browser page could otherwise use to reach this local server.
    enableDnsRebindingProtection: true,
    allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
  })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}

function broadcastStatus(): void {
  const status = mcpStatus()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.mcpStatusEvent, status)
  }
}

export function mcpStatus(): McpStatus {
  const enabled = getSettings().mcpEnabled
  const running = httpServer !== null && port !== null
  return {
    enabled,
    running,
    url: running ? `http://127.0.0.1:${port}/mcp` : null,
    token: running ? token : null,
    approvalMode: getSettings().mcpApprovalMode,
  }
}

export async function startMcpServer(): Promise<void> {
  if (httpServer) return
  token = randomBytes(32).toString('base64url')
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) deny(res, 500, 'internal error')
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const addr = server.address()
  if (addr === null || typeof addr === 'string') {
    server.close()
    throw new Error('mcp: could not determine listening port')
  }
  httpServer = server
  port = addr.port
  broadcastStatus()
}

export function stopMcpServer(): void {
  denyAllPending()
  httpServer?.close()
  httpServer = null
  port = null
  token = null
  clientLabel = null
  broadcastStatus()
}

/** Start or stop the server to match the persisted `mcpEnabled` setting. */
export async function syncMcpFromSettings(): Promise<void> {
  if (getSettings().mcpEnabled) await startMcpServer()
  else stopMcpServer()
}
