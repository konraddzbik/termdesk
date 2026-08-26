import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { hostInputSchema } from '@shared/ipc'
import { app } from 'electron'
import { listAiAudit } from '../store/ai-audit-repo'
import { getSqlite, setSmokeDbPath } from '../store/db'
import { createHost } from '../store/hosts-repo'
import { updateSettings } from '../store/settings'
import { mcpStatus, startMcpServer, stopMcpServer } from './server'

/**
 * End-to-end MCP smoke (TERMDESK_SMOKE=mcp). Starts the real server and drives
 * it with a real MCP client: lists tools, calls list_hosts, verifies the policy
 * denies exec on a non-enabled host, checks the AI audit log was written, and
 * confirms a forged bearer token is rejected. Prints MCP_SMOKE_OK / FAIL.
 */
export async function runMcpSmokeTest(): Promise<void> {
  const smokeDir = mkdtempSync(join(tmpdir(), 'termdesk-mcp-smoke-'))
  setSmokeDbPath(join(smokeDir, 'smoke.db'))

  const connect = async (tokenOverride?: string): Promise<Client> => {
    const status = mcpStatus()
    if (!status.url || !status.token) throw new Error('server not running')
    const transport = new StreamableHTTPClientTransport(new URL(status.url), {
      requestInit: { headers: { Authorization: `Bearer ${tokenOverride ?? status.token}` } },
    })
    const client = new Client({ name: 'mcp-smoke', version: '1.0.0' })
    await client.connect(transport)
    return client
  }

  try {
    const host = createHost(
      hostInputSchema.parse({
        label: 'smoke-host',
        hostname: '127.0.0.1',
        username: 'smoke',
        authType: 'password',
        password: 'x',
      }),
    )
    updateSettings({ mcpEnabled: true, mcpReadHostIds: [host.id], mcpExecHostIds: [] })

    await startMcpServer()
    const client = await connect()

    // 1. Tool discovery.
    const tools = await client.listTools()
    const names = new Set(tools.tools.map((t) => t.name))
    for (const expected of ['list_hosts', 'list_groups', 'run_command', 'run_on_group']) {
      if (!names.has(expected)) throw new Error(`missing tool ${expected}`)
    }

    // 2. list_hosts returns the host with no secret fields.
    const listed = await client.callTool({ name: 'list_hosts', arguments: {} })
    const text = (listed.content as Array<{ type: string; text?: string }>)[0]?.text ?? ''
    if (!text.includes(host.id)) throw new Error('list_hosts did not return the created host')
    if (/"password"|"passwordEnc"|"passphrase"/.test(text)) {
      throw new Error('list_hosts leaked a secret field')
    }

    // 3. run_command on a host that is NOT exec-enabled must be denied by policy.
    const denied = await client.callTool({
      name: 'run_command',
      arguments: { hostId: host.id, command: 'echo hi' },
    })
    const deniedText = (denied.content as Array<{ type: string; text?: string }>)[0]?.text ?? ''
    if (!/denied/i.test(deniedText)) {
      throw new Error(`expected policy denial, got: ${deniedText.slice(0, 80)}`)
    }

    // 4. The AI audit log recorded both calls.
    const audit = listAiAudit()
    if (audit.length < 2) throw new Error(`expected >=2 audit rows, got ${audit.length}`)
    if (!audit.some((a) => a.tool === 'run_command' && a.verdict === 'deny')) {
      throw new Error('audit missing the run_command deny row')
    }

    await client.close()

    // 5. A forged bearer token is rejected.
    let rejected = false
    try {
      const bad = await connect('not-the-token')
      await bad.close()
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('forged token was NOT rejected')

    console.log('MCP_SMOKE_OK')
  } catch (err) {
    console.log(`MCP_SMOKE_FAIL: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    stopMcpServer()
    try {
      getSqlite().close()
    } catch {
      // ignore
    }
    try {
      rmSync(smokeDir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
    app.quit()
  }
}
