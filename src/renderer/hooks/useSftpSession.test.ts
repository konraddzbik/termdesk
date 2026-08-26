// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSftpSession } from './useSftpSession'

let open: ReturnType<typeof vi.fn>
let close: ReturnType<typeof vi.fn>
let abortConnect: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  open = vi.fn(async () => ({ sftpId: 'f1', homeDir: '/home/u' }))
  close = vi.fn(async () => {})
  abortConnect = vi.fn(async () => {})
  Object.defineProperty(window, 'api', {
    value: { sftp: { open, close }, ssh: { abortConnect } },
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (window as { api?: unknown }).api
})

/** Flushes pending microtasks (resolved IPC promises) inside act. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useSftpSession', () => {
  it('opens a session on mount and exposes sftpId/homeDir once ready', async () => {
    const { result } = renderHook(() => useSftpSession('host1'))

    expect(result.current.status).toBe('connecting')
    expect(result.current.sftpId).toBeNull()

    await flush()

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('host1')
    expect(result.current).toMatchObject({
      status: 'ready',
      sftpId: 'f1',
      homeDir: '/home/u',
      error: undefined,
    })
  })

  it('reports an error (IPC prefix stripped) and recovers via reconnect()', async () => {
    open.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'sftp:open': Error: All authentication methods failed",
      ),
    )
    const { result } = renderHook(() => useSftpSession('host1'))
    await flush()

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('All authentication methods failed')
    expect(result.current.sftpId).toBeNull()

    act(() => result.current.reconnect())
    expect(result.current.status).toBe('connecting')
    await flush()

    expect(open).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('ready')
    expect(result.current.sftpId).toBe('f1')

    // The retry's effect cleanup must not close the fresh session.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5)
    })
    expect(close).not.toHaveBeenCalled()
  })

  it('closes the session on real unmount (deferred past StrictMode remounts)', async () => {
    const { unmount } = renderHook(() => useSftpSession('host1'))
    await flush()

    unmount()
    expect(close).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(close).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith('f1')
  })

  it('closes an orphaned session when unmounted while still connecting', async () => {
    let resolveOpen: (value: { sftpId: string; homeDir: string }) => void = () => {}
    open.mockImplementationOnce(
      () =>
        new Promise<{ sftpId: string; homeDir: string }>((resolve) => {
          resolveOpen = resolve
        }),
    )
    const { unmount } = renderHook(() => useSftpSession('host1'))

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    resolveOpen({ sftpId: 'late-1', homeDir: '/root' })
    await flush()

    // The late session is closed instead of leaking in main.
    expect(close).toHaveBeenCalledWith('late-1')
  })
})
