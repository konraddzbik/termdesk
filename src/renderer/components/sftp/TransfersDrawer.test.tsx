// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useTransfersStore } from '@renderer/stores/transfers'
import type { Transfer } from '@shared/ipc'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TransfersDrawer } from './TransfersDrawer'

function makeTransfer(overrides: Partial<Transfer> & { id: string }): Transfer {
  return {
    sftpId: 'f1',
    kind: 'download',
    label: `${overrides.id}.bin`,
    localPath: `/tmp/${overrides.id}.bin`,
    remotePath: `/srv/${overrides.id}.bin`,
    totalBytes: 100,
    doneBytes: 0,
    rate: 0,
    etaSec: null,
    status: 'queued',
    ...overrides,
  }
}

let cancelTransfer: ReturnType<typeof vi.fn>
let retryTransfer: ReturnType<typeof vi.fn>

beforeEach(() => {
  useTransfersStore.setState({ transfers: {}, order: [] })
  cancelTransfer = vi.fn(async () => {})
  retryTransfer = vi.fn(async () => {})
  Object.defineProperty(window, 'api', {
    value: {
      sftp: {
        onTransfer: vi.fn(() => () => {}),
        cancelTransfer,
        retryTransfer,
      },
    },
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
  delete (window as { api?: unknown }).api
})

function seed(...transfers: Transfer[]): void {
  const map: Record<string, Transfer> = {}
  for (const t of transfers) map[t.id] = t
  useTransfersStore.setState({ transfers: map, order: transfers.map((t) => t.id) })
}

describe('TransfersDrawer', () => {
  it('renders nothing when there are no transfers', () => {
    const { container } = render(<TransfersDrawer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows per-row progress, rate and eta for an active transfer', () => {
    seed(
      makeTransfer({
        id: 't1',
        label: 'backup.tar',
        status: 'active',
        doneBytes: 512 * 1024,
        totalBytes: 1024 * 1024,
        rate: 256 * 1024,
        etaSec: 2,
      }),
    )
    render(<TransfersDrawer />)

    expect(screen.getByText('backup.tar')).toBeInTheDocument()
    expect(screen.getByText(/512 KB \/ 1\.0 MB/)).toBeInTheDocument()
    expect(screen.getByText(/256 KB\/s/)).toBeInTheDocument()
    expect(screen.getByText('2s')).toBeInTheDocument()
    // Header reflects the single active transfer: 50% of 1.0 MB.
    expect(screen.getByText('1 in progress — 50% of 1.0 MB')).toBeInTheDocument()
  })

  it('aggregates progress across all transfers with known totals', () => {
    seed(
      makeTransfer({ id: 't1', status: 'active', doneBytes: 50, totalBytes: 100 }),
      makeTransfer({ id: 't2', status: 'queued', doneBytes: 0, totalBytes: 100 }),
      makeTransfer({ id: 't3', status: 'done', doneBytes: 100, totalBytes: 100 }),
    )
    render(<TransfersDrawer />)

    // (50 + 0 + 100) / 300 = 50%, two still in flight.
    expect(screen.getByText('2 in progress — 50% of 300 B')).toBeInTheDocument()
  })

  it('shows "all finished" once nothing is queued or active', () => {
    seed(
      makeTransfer({ id: 't1', status: 'done', doneBytes: 100 }),
      makeTransfer({ id: 't2', status: 'error', error: 'Permission denied' }),
    )
    render(<TransfersDrawer />)

    expect(screen.getByText('all finished')).toBeInTheDocument()
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
    expect(screen.getByText('done · 100 B')).toBeInTheDocument()
  })

  it('cancel button calls window.api.sftp.cancelTransfer with the transfer id', async () => {
    const user = userEvent.setup()
    seed(
      makeTransfer({ id: 't1', label: 'big.iso', status: 'active', doneBytes: 1 }),
      makeTransfer({ id: 't2', label: 'small.txt', status: 'queued' }),
    )
    render(<TransfersDrawer />)

    await user.click(screen.getByRole('button', { name: 'Cancel big.iso' }))
    expect(cancelTransfer).toHaveBeenCalledWith('t1')

    await user.click(screen.getByRole('button', { name: 'Cancel small.txt' }))
    expect(cancelTransfer).toHaveBeenCalledWith('t2')
    expect(retryTransfer).not.toHaveBeenCalled()
  })

  it('retry button appears for error/cancelled rows and calls retryTransfer', async () => {
    const user = userEvent.setup()
    seed(
      makeTransfer({ id: 't1', label: 'fail.bin', status: 'error', error: 'boom' }),
      makeTransfer({ id: 't2', label: 'stop.bin', status: 'cancelled' }),
      makeTransfer({ id: 't3', label: 'live.bin', status: 'active', doneBytes: 1 }),
    )
    render(<TransfersDrawer />)

    await user.click(screen.getByRole('button', { name: 'Retry fail.bin' }))
    expect(retryTransfer).toHaveBeenCalledWith('t1')

    await user.click(screen.getByRole('button', { name: 'Retry stop.bin' }))
    expect(retryTransfer).toHaveBeenCalledWith('t2')

    expect(screen.queryByRole('button', { name: 'Retry live.bin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel fail.bin' })).not.toBeInTheDocument()
  })

  it('clear finished removes done/error/cancelled rows but keeps active and queued ones', async () => {
    const user = userEvent.setup()
    seed(
      makeTransfer({ id: 't1', label: 'done.bin', status: 'done', doneBytes: 100 }),
      makeTransfer({ id: 't2', label: 'fail.bin', status: 'error', error: 'boom' }),
      makeTransfer({ id: 't3', label: 'live.bin', status: 'active', doneBytes: 1 }),
      makeTransfer({ id: 't4', label: 'next.bin', status: 'queued' }),
    )
    render(<TransfersDrawer />)

    await user.click(screen.getByRole('button', { name: /Clear finished/ }))

    expect(useTransfersStore.getState().order).toEqual(['t3', 't4'])
    expect(screen.queryByText('done.bin')).not.toBeInTheDocument()
    expect(screen.queryByText('fail.bin')).not.toBeInTheDocument()
    expect(screen.getByText('live.bin')).toBeInTheDocument()
    expect(screen.getByText('next.bin')).toBeInTheDocument()
  })

  it('subscribes to the transfer event stream on mount', () => {
    seed(makeTransfer({ id: 't1', status: 'active', doneBytes: 1 }))
    render(<TransfersDrawer />)
    expect(window.api.sftp.onTransfer).toHaveBeenCalledTimes(1)
  })
})
