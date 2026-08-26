import type { Transfer, TransferStatus } from '@shared/ipc'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTransfersStore } from './transfers'

function makeTransfer(id: string, status: TransferStatus, doneBytes = 0): Transfer {
  return {
    id,
    sftpId: 'sftp-1',
    kind: 'download',
    label: `${id}.bin`,
    localPath: `/tmp/${id}.bin`,
    remotePath: `/srv/${id}.bin`,
    totalBytes: 1000,
    doneBytes,
    rate: 0,
    etaSec: null,
    status,
  }
}

beforeEach(() => {
  useTransfersStore.setState({ transfers: {}, order: [] })
})

describe('upsert', () => {
  it('preserves insertion order across multiple transfers', () => {
    const { upsert } = useTransfersStore.getState()
    upsert(makeTransfer('c', 'queued'))
    upsert(makeTransfer('a', 'queued'))
    upsert(makeTransfer('b', 'queued'))
    expect(useTransfersStore.getState().order).toEqual(['c', 'a', 'b'])
  })

  it('updates an existing transfer in place without reordering', () => {
    const { upsert } = useTransfersStore.getState()
    upsert(makeTransfer('a', 'queued'))
    upsert(makeTransfer('b', 'queued'))
    upsert(makeTransfer('a', 'active', 500))
    const state = useTransfersStore.getState()
    expect(state.order).toEqual(['a', 'b'])
    expect(state.transfers.a?.status).toBe('active')
    expect(state.transfers.a?.doneBytes).toBe(500)
    expect(state.transfers.b?.status).toBe('queued')
  })
})

describe('clearFinished', () => {
  it('keeps only queued and active transfers, preserving order', () => {
    const { upsert } = useTransfersStore.getState()
    upsert(makeTransfer('done', 'done'))
    upsert(makeTransfer('q', 'queued'))
    upsert(makeTransfer('err', 'error'))
    upsert(makeTransfer('act', 'active'))
    upsert(makeTransfer('cxl', 'cancelled'))
    useTransfersStore.getState().clearFinished()
    const state = useTransfersStore.getState()
    expect(state.order).toEqual(['q', 'act'])
    expect(Object.keys(state.transfers).sort()).toEqual(['act', 'q'])
  })

  it('is a no-op on an empty store', () => {
    useTransfersStore.getState().clearFinished()
    const state = useTransfersStore.getState()
    expect(state.order).toEqual([])
    expect(state.transfers).toEqual({})
  })
})
