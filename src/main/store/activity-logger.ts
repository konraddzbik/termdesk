import { hostname, userInfo } from 'node:os'
import { IPC_EVENTS } from '@shared/channels'
import type { ActivityAction, ActivityEntry, ActivityKind } from '@shared/ipc'
import { BrowserWindow } from 'electron'
import { recordActivity } from './activity-log-repo'
import { findHostRow } from './hosts-repo'

function deviceLabel(): string {
  switch (process.platform) {
    case 'darwin':
      return 'Mac'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return process.platform
  }
}

/**
 * Local OS username for the activity log. The activity log is a local,
 * unencrypted SQLite table, so it deliberately records only the OS username —
 * never an account identifier or email address — so that copying the DB file
 * does not hand over PII.
 */
function currentUser(): string {
  try {
    return userInfo().username
  } catch {
    return hostname()
  }
}

/** "ssh · web, prod" style subtitle from a host row. */
function hostInfo(hostId: string): { label: string; subtitle: string | null } | null {
  const row = findHostRow(hostId)
  if (!row) return null
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags)
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string')
  } catch {
    // ignore malformed tags
  }
  const subtitle = [row.kind, tags.join(', ')].filter((s) => s.length > 0).join(' · ')
  return { label: row.label, subtitle: subtitle || null }
}

function broadcast(entry: ActivityEntry): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.logEvent, entry)
  }
}

export interface LogActivityInput {
  action: ActivityAction
  kind: ActivityKind
  /** When set, the host label/subtitle are resolved from the vault. */
  hostId?: string | null
  /** Explicit label override (e.g. automation runs that span many hosts). */
  hostLabel?: string
  detail?: string | null
}

/**
 * Records one activity-log entry and broadcasts it to open windows. Best-effort:
 * logging must never break the action it describes, so all errors are swallowed.
 */
export function logActivity(input: LogActivityInput): void {
  try {
    const resolved = input.hostId ? hostInfo(input.hostId) : null
    const hostLabel = input.hostLabel ?? resolved?.label ?? input.hostId ?? 'Unknown'
    const entry = recordActivity({
      ts: Date.now(),
      action: input.action,
      kind: input.kind,
      hostId: input.hostId ?? null,
      hostLabel,
      hostSubtitle: resolved?.subtitle ?? null,
      detail: input.detail ?? null,
      user: currentUser(),
      device: deviceLabel(),
    })
    broadcast(entry)
  } catch {
    // best-effort: never let logging interfere with the underlying operation
  }
}
