import { randomUUID } from 'node:crypto'
import { IPC_EVENTS } from '@shared/channels'
import type { McpApprovalRequest } from '@shared/ipc'
import { BrowserWindow } from 'electron'

/** Default time the agent waits on a human decision before auto-deny. */
const APPROVAL_TIMEOUT_MS = 2 * 60 * 1000

interface Pending {
  request: McpApprovalRequest
  resolve(approved: boolean): void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, Pending>()

function broadcast(type: 'request' | 'resolved', request: McpApprovalRequest): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.mcpApprovalEvent, { type, request })
  }
}

/**
 * Blocks until the user approves/denies the action in-app, or the timeout
 * elapses (→ deny). Fails closed: no window open, or timeout, → false.
 */
export function requestApproval(
  input: Omit<McpApprovalRequest, 'id'>,
  timeoutMs = APPROVAL_TIMEOUT_MS,
): Promise<boolean> {
  const request: McpApprovalRequest = { id: randomUUID(), ...input }
  return new Promise<boolean>((resolve) => {
    const settle = (approved: boolean): void => {
      const p = pending.get(request.id)
      if (!p) return
      clearTimeout(p.timer)
      pending.delete(request.id)
      broadcast('resolved', request)
      resolve(approved)
    }
    const timer = setTimeout(() => settle(false), timeoutMs)
    pending.set(request.id, { request, resolve: settle, timer })
    broadcast('request', request)
  })
}

/** Resolve a pending approval from the renderer (mcpApprove IPC). */
export function resolveApproval(id: string, approved: boolean): void {
  pending.get(id)?.resolve(approved)
}

/** Deny everything in flight (kill switch / MCP disabled). */
export function denyAllPending(): void {
  for (const [, p] of pending) p.resolve(false)
}

/** Snapshot of currently-pending approvals (for a freshly-opened window). */
export function pendingApprovals(): McpApprovalRequest[] {
  return [...pending.values()].map((p) => p.request)
}
