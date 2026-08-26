// @vitest-environment jsdom
import { useSessionsStore } from '@renderer/stores/sessions'
import type { SshSessionEvent } from '@shared/ipc'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSshSession } from './useSshSession'

let emitEvent: (event: SshSessionEvent) => void
let connect: ReturnType<typeof vi.fn>
let abortConnect: ReturnType<typeof vi.fn>
let disconnect: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  useSessionsStore.setState({ sessions: {} })
  emitEvent = () => {
    throw new Error('onEvent not subscribed')
  }
  connect = vi.fn(async () => ({ sessionId: 's1' }))
  abortConnect = vi.fn(async () => {})
  disconnect = vi.fn(async () => {})
  Object.defineProperty(window, 'api', {
    value: {
      ssh: {
        connect,
        abortConnect,
        disconnect,
        onEvent: vi.fn((cb: (event: SshSessionEvent) => void) => {
          emitEvent = cb
          return () => {}
        }),
      },
    },
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

async function mountConnected(): Promise<
  ReturnType<typeof renderHook<ReturnType<typeof useSshSession>, undefined>>
> {
  const rendered = renderHook(() => useSshSession('tab1', 'host1'))
  await flush()
  return rendered
}

describe('useSshSession', () => {
  it('connects on mount and reports the connected session', async () => {
    const { result } = renderHook(() => useSshSession('tab1', 'host1'))
    expect(result.current.status).toBe('connecting')

    await flush()

    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith('host1')
    expect(result.current.status).toBe('connected')
    expect(result.current.sessionId).toBe('s1')
    expect(result.current.error).toBeUndefined()
  })

  it('surfaces a connect rejection as an error status with the IPC prefix stripped', async () => {
    connect.mockRejectedValueOnce(
      new Error("Error invoking remote method 'ssh:connect': Error: Authentication failed"),
    )
    const { result } = renderHook(() => useSshSession('tab1', 'host1'))

    await flush()

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Authentication failed')
  })

  it('auto-reconnects with escalating backoff (1s then 2s) when enabled', async () => {
    const { result } = await mountConnected()
    act(() => result.current.setAutoReconnect(true))

    // Drop the connection: a reconnect is scheduled at 1s.
    connect.mockRejectedValueOnce(new Error('still down'))
    act(() => emitEvent({ sessionId: 's1', type: 'disconnected' }))
    expect(result.current.status).toBe('disconnected')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999)
    })
    expect(connect).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(connect).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('error')

    // Second drop: backoff escalates to 2s.
    act(() => emitEvent({ sessionId: 's1', type: 'disconnected' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999)
    })
    expect(connect).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(connect).toHaveBeenCalledTimes(3)
    expect(result.current.status).toBe('connected')
  })

  it('does not reconnect when autoReconnect is off', async () => {
    const { result } = await mountConnected()

    act(() => emitEvent({ sessionId: 's1', type: 'disconnected', message: 'Connection lost' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('disconnected')
    expect(result.current.error).toBe('Connection lost')
  })

  it('manual disconnect tears the session down and suppresses auto-reconnect', async () => {
    const { result } = await mountConnected()
    act(() => result.current.setAutoReconnect(true))

    act(() => result.current.disconnect())

    expect(disconnect).toHaveBeenCalledWith('s1')
    expect(result.current.status).toBe('disconnected')
    expect(result.current.sessionId).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('turning autoReconnect off cancels a pending retry', async () => {
    const { result } = await mountConnected()
    act(() => result.current.setAutoReconnect(true))
    act(() => emitEvent({ sessionId: 's1', type: 'disconnected' }))

    act(() => result.current.setAutoReconnect(false))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('ignores events for other sessions', async () => {
    const { result } = await mountConnected()

    act(() => emitEvent({ sessionId: 'other', type: 'disconnected' }))

    expect(result.current.status).toBe('connected')
  })

  it('maps hostkey-mismatch to an error status with the event message', async () => {
    const { result } = await mountConnected()

    act(() => emitEvent({ sessionId: 's1', type: 'hostkey-mismatch', message: 'key changed!' }))

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('key changed!')
  })

  it('falls back to a MITM warning when hostkey-mismatch has no message', async () => {
    const { result } = await mountConnected()

    act(() => emitEvent({ sessionId: 's1', type: 'hostkey-mismatch' }))

    expect(result.current.status).toBe('error')
    expect(result.current.error).toMatch(/man-in-the-middle/i)
  })

  it('abortConnect cancels an in-flight connect', async () => {
    let resolveConnect!: (value: { sessionId: string }) => void
    connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConnect = resolve
        }),
    )
    const { result } = renderHook(() => useSshSession('tab1', 'host1'))
    expect(result.current.status).toBe('connecting')

    act(() => result.current.abortConnect())

    expect(abortConnect).toHaveBeenCalledWith('host1')
    expect(result.current.status).toBe('disconnected')
    expect(result.current.error).toBe('Connection aborted')

    resolveConnect({ sessionId: 'late' })
    await flush()
    expect(result.current.sessionId).toBeNull()
  })

  it('disconnects and clears the store slot on real unmount', async () => {
    const { unmount } = await mountConnected()
    expect(useSessionsStore.getState().sessions.tab1).toBeDefined()

    unmount()
    // Teardown is deferred one tick to survive StrictMode remounts.
    expect(disconnect).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(disconnect).toHaveBeenCalledWith('s1')
    expect(useSessionsStore.getState().sessions.tab1).toBeUndefined()
  })
})
