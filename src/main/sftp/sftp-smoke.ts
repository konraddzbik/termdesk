import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, open, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hostInputSchema } from '@shared/ipc'
import { app } from 'electron'
import { envFlag } from '../app-paths'
import type { DataSink } from '../ssh/session-manager'
import { sessionManager } from '../ssh/session-manager'
import { setSmokeDbPath } from '../store/db'
import { createHost } from '../store/hosts-repo'
import { sftpManager } from './sftp-manager'
import { transferManager } from './transfer-manager'

/**
 * SFTP end-to-end smoke (TERMDESK_SMOKE=sftp) against the docker test server.
 * Verifies two properties that only show up at scale:
 *  1. A 1 GB file uploads and downloads with process RSS staying under 300 MB
 *     (streaming, no whole-file buffering).
 *  2. A directory with 500 files uploads recursively and completely.
 * Prints SFTP_SMOKE_OK or SFTP_SMOKE_FAIL: <reason>.
 */

const GB_FILE_BYTES = 1024 * 1024 * 1024
const RSS_CAP_BYTES = 300 * 1024 * 1024
const FOLDER_FILE_COUNT = 500

function makeSink(): DataSink {
  return { id: 9_999_999, isDestroyed: () => false, send: () => {} }
}

async function waitForTransfers(ownerId: number, ids: string[], timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    const transfers = transferManager.list(ownerId)
    const mine = transfers.filter((t) => ids.includes(t.id))
    const failed = mine.find((t) => t.status === 'error' || t.status === 'cancelled')
    if (failed) throw new Error(`transfer ${failed.label} ${failed.status}: ${failed.error ?? ''}`)
    if (mine.length === ids.length && mine.every((t) => t.status === 'done')) return
    if (Date.now() - startedAt > timeoutMs) throw new Error('transfer timeout')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

export async function runSftpSmokeTest(): Promise<void> {
  const host = envFlag('SMOKE_HOST') ?? '127.0.0.1'
  const port = Number.parseInt(envFlag('SMOKE_PORT') ?? '2222', 10)
  const username = envFlag('SMOKE_USER') ?? 'testuser'
  const password = envFlag('SMOKE_PASSWORD') ?? 'testpass123'

  const smokeDir = mkdtempSync(join(tmpdir(), 'sshdeck-sftp-smoke-'))
  setSmokeDbPath(join(smokeDir, 'smoke.db'))

  let peakRss = 0
  const rssTimer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }, 100)

  const sink = makeSink()
  let sftpId: string | null = null
  let remoteBase: string | null = null
  try {
    const created = createHost(
      hostInputSchema.parse({
        label: `sftp-smoke-${randomUUID().slice(0, 8)}`,
        hostname: host,
        port,
        username,
        authType: 'password',
        password,
      }),
    )

    const opened = await sftpManager.open(created.id, sink)
    sftpId = opened.sftpId
    remoteBase = `${opened.homeDir}/sshdeck-smoke-${randomUUID().slice(0, 8)}`
    await sftpManager.mkdirp(sftpId, remoteBase, sink.id)

    // --- Scenario 1: 1 GB sparse file, upload then download, RSS capped ---
    const bigLocal = join(smokeDir, 'big.bin')
    const handle = await open(bigLocal, 'w')
    await handle.truncate(GB_FILE_BYTES)
    await handle.close()

    const upIds = await transferManager.enqueueUploads(sftpId, [bigLocal], remoteBase, sink)
    await waitForTransfers(sink.id, upIds, 10 * 60_000)

    const downLocal = join(smokeDir, 'big-down.bin')
    const downId = transferManager.enqueueDownload(
      sftpId,
      `${remoteBase}/big.bin`,
      downLocal,
      sink,
      null,
    )
    await waitForTransfers(sink.id, [downId], 10 * 60_000)
    const downInfo = await stat(downLocal)
    if (downInfo.size !== GB_FILE_BYTES) {
      throw new Error(`downloaded size ${downInfo.size} !== ${GB_FILE_BYTES}`)
    }
    if (peakRss > RSS_CAP_BYTES) {
      throw new Error(`peak RSS ${Math.round(peakRss / 1024 / 1024)} MB exceeded 300 MB cap`)
    }

    // --- Scenario 2: folder with 500 files uploads recursively ---
    const folderLocal = join(smokeDir, 'many')
    await mkdir(join(folderLocal, 'nested'), { recursive: true })
    for (let i = 0; i < FOLDER_FILE_COUNT; i++) {
      const dir = i % 5 === 0 ? join(folderLocal, 'nested') : folderLocal
      await writeFile(join(dir, `file-${i}.txt`), `smoke file ${i}\n`)
    }
    const folderIds = await transferManager.enqueueUploads(sftpId, [folderLocal], remoteBase, sink)
    if (folderIds.length !== FOLDER_FILE_COUNT) {
      throw new Error(`expected ${FOLDER_FILE_COUNT} transfers, enqueued ${folderIds.length}`)
    }
    await waitForTransfers(sink.id, folderIds, 10 * 60_000)

    const top = await sftpManager.list(sftpId, `${remoteBase}/many`, sink.id)
    const nested = await sftpManager.list(sftpId, `${remoteBase}/many/nested`, sink.id)
    const uploadedCount =
      top.filter((e) => e.type === 'file').length + nested.filter((e) => e.type === 'file').length
    if (uploadedCount !== FOLDER_FILE_COUNT) {
      throw new Error(`remote shows ${uploadedCount}/${FOLDER_FILE_COUNT} files`)
    }

    console.log(
      `sftp-smoke: 1GB up+down ok (peak RSS ${Math.round(peakRss / 1024 / 1024)} MB), ` +
        `${FOLDER_FILE_COUNT}-file folder ok`,
    )
    console.log('SFTP_SMOKE_OK')
  } catch (err) {
    console.log(`SFTP_SMOKE_FAIL: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  } finally {
    clearInterval(rssTimer)
    try {
      if (sftpId && remoteBase) await sftpManager.remove(sftpId, remoteBase, sink.id)
    } catch {
      // best-effort remote cleanup
    }
    if (sftpId) sftpManager.close(sftpId, sink.id)
    sessionManager.destroyAll()
    rmSync(smokeDir, { recursive: true, force: true })
    app.quit()
  }
}
