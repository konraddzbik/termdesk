import { beforeEach, describe, expect, it, vi } from 'vitest'

// approvals.ts broadcasts to all renderer windows; we don't assert on the
// broadcast here, only on the resolution semantics, so a no-window mock is fine.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

import { denyAllPending, pendingApprovals, requestApproval, resolveApproval } from './approvals'

const req = { client: 'test', tool: 'run_command', hostLabel: 'web', summary: 'ls' } as const

/** The id of the single currently-pending approval (fails the test if none). */
function pendingId(): string {
  const [pending] = pendingApprovals()
  if (!pending) throw new Error('expected a pending approval')
  return pending.id
}

describe('approvals', () => {
  beforeEach(() => {
    // Drain anything a prior test left pending so state can't leak across tests.
    denyAllPending()
  })

  it('resolves true when the user approves the pending request', async () => {
    const p = requestApproval(req)
    resolveApproval(pendingId(), true)
    await expect(p).resolves.toBe(true)
    expect(pendingApprovals()).toHaveLength(0)
  })

  it('resolves false when the user denies', async () => {
    const p = requestApproval(req)
    resolveApproval(pendingId(), false)
    await expect(p).resolves.toBe(false)
  })

  it('fails closed: auto-denies when the timeout elapses', async () => {
    const p = requestApproval(req, 5)
    await expect(p).resolves.toBe(false)
    expect(pendingApprovals()).toHaveLength(0)
  })

  it('denyAllPending (kill switch) denies every in-flight request', async () => {
    const a = requestApproval(req)
    const b = requestApproval(req)
    expect(pendingApprovals()).toHaveLength(2)
    denyAllPending()
    await expect(a).resolves.toBe(false)
    await expect(b).resolves.toBe(false)
    expect(pendingApprovals()).toHaveLength(0)
  })

  it('ignores an unknown request id', () => {
    expect(() => resolveApproval('does-not-exist', true)).not.toThrow()
  })

  it('ignores a second resolve of an already-settled request', async () => {
    const p = requestApproval(req)
    const id = pendingId()
    resolveApproval(id, true)
    await expect(p).resolves.toBe(true)
    // Second resolve must be a no-op, not flip the result or throw.
    expect(() => resolveApproval(id, false)).not.toThrow()
  })
})
