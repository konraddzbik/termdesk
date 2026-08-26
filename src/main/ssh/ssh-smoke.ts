import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { hostInputSchema } from '@shared/ipc'
import { app } from 'electron'
import { envFlag } from '../app-paths'
import { getSqlite, setSmokeDbPath } from '../store/db'
import { createHost } from '../store/hosts-repo'
import type { DataSink } from './session-manager'
import { sessionManager } from './session-manager'

/**
 * End-to-end SSH smoke harness (run with TERMDESK_SMOKE=ssh). Exercises the
 * full vault → SessionManager → shell pipeline against a local test SSH
 * server (e.g. the docker-compose test container) without opening a window.
 *
 * Server endpoint is configurable via env:
 *   TERMDESK_SMOKE_HOST (default 127.0.0.1)
 *   TERMDESK_SMOKE_PORT (default 2222)
 *   TERMDESK_SMOKE_USER (default testuser)
 *
 * Prints SSH_SMOKE_OK / SSH_SMOKE_FAIL: <reason> and quits the app.
 */

const SMOKE_PASSWORD = 'testpass123'
const SMOKE_PASSPHRASE = 'testphrase'
const OUTPUT_TIMEOUT_MS = 5_000

interface SmokeSink extends DataSink {
  /** Concatenated terminal output across all data channels of this sink. */
  output(): string
}

let nextSinkId = 1_000_000

/** Headless DataSink that collects terminal output instead of sending it to a window. */
function makeSmokeSink(): SmokeSink {
  const chunks: Buffer[] = []
  const id = nextSinkId++
  return {
    id,
    isDestroyed: () => false,
    send(channel: string, ...args: unknown[]): void {
      if (!channel.startsWith('ssh:data:')) return
      const payload = args[0]
      if (payload instanceof Uint8Array) chunks.push(Buffer.from(payload))
    },
    output(): string {
      return Buffer.concat(chunks).toString('utf8')
    },
  }
}

function waitForOutput(sink: SmokeSink, needle: string, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const startedAt = Date.now()
    const poll = (): void => {
      if (sink.output().includes(needle)) {
        resolvePromise()
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        rejectPromise(new Error(`timed out waiting for "${needle}" in shell output`))
        return
      }
      setTimeout(poll, 50)
    }
    poll()
  })
}

interface Scenario {
  name: string
  input: Record<string, unknown>
}

export async function runSshSmokeTest(): Promise<void> {
  const host = envFlag('SMOKE_HOST') ?? '127.0.0.1'
  const port = Number.parseInt(envFlag('SMOKE_PORT') ?? '2222', 10)
  const username = envFlag('SMOKE_USER') ?? 'testuser'

  // Always a fresh temp DB — never touch a real database.
  const smokeDir = mkdtempSync(join(tmpdir(), 'sshdeck-ssh-smoke-'))
  setSmokeDbPath(join(smokeDir, 'smoke.db'))

  const scenarios: Scenario[] = [
    {
      name: 'password',
      input: {
        label: 'smoke-password',
        hostname: host,
        port,
        username,
        authType: 'password',
        password: SMOKE_PASSWORD,
      },
    },
    {
      name: 'key',
      input: {
        label: 'smoke-key',
        hostname: host,
        port,
        username,
        authType: 'key',
        keyPath: resolve(process.cwd(), '.test/test_key'),
      },
    },
    {
      name: 'key+passphrase',
      input: {
        label: 'smoke-key-enc',
        hostname: host,
        port,
        username,
        authType: 'key',
        keyPath: resolve(process.cwd(), '.test/test_key_enc'),
        passphrase: SMOKE_PASSPHRASE,
      },
    },
  ]

  let failure: string | null = null

  try {
    for (const scenario of scenarios) {
      try {
        // Secrets go through the real safeStorage-backed repo path.
        const created = createHost(hostInputSchema.parse(scenario.input))
        const sink = makeSmokeSink()
        const { sessionId } = await sessionManager.connect(created.id, sink)
        try {
          sessionManager.attach(sessionId, sink.id)
          sessionManager.write(sessionId, 'echo smoke-$((40+2))\n', sink.id)
          await waitForOutput(sink, 'smoke-42', OUTPUT_TIMEOUT_MS)
        } finally {
          sessionManager.disconnect(sessionId, sink.id)
        }
        console.log(`ssh-smoke: scenario "${scenario.name}" ok`)
      } catch (err) {
        throw new Error(
          `scenario "${scenario.name}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // The unknown-host-key auto-accept must have persisted exactly one
    // known_hosts row per (host, port, keyType) across all three connects.
    const rows = getSqlite()
      .prepare(
        'SELECT host, port, key_type, COUNT(*) AS n FROM known_hosts GROUP BY host, port, key_type',
      )
      .all() as Array<{ host: string; port: number; key_type: string; n: number }>
    if (rows.length === 0) {
      throw new Error('known_hosts: auto-accept persisted no rows')
    }
    for (const row of rows) {
      if (row.n !== 1) {
        throw new Error(
          `known_hosts: expected exactly 1 row for (${row.host}, ${row.port}, ${row.key_type}), found ${row.n}`,
        )
      }
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err)
  } finally {
    sessionManager.destroyAll()
    try {
      getSqlite().close()
    } catch {
      // may already be closed
    }
    try {
      rmSync(smokeDir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
    console.log(failure === null ? 'SSH_SMOKE_OK' : `SSH_SMOKE_FAIL: ${failure}`)
    app.quit()
  }
}
