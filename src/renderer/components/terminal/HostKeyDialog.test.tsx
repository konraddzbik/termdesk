// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { HostKeyPrompt } from '@shared/ipc'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostKeyDialog } from './HostKeyDialog'

function makePrompt(overrides: Partial<HostKeyPrompt> & { requestId: string }): HostKeyPrompt {
  return {
    hostId: 'h1',
    host: 'web.example.com',
    port: 22,
    keyType: 'ssh-ed25519',
    fingerprint: 'SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEF0',
    previouslyKnown: false,
    ...overrides,
  }
}

let pushPrompt: (prompt: HostKeyPrompt) => void
let unsubscribe: ReturnType<typeof vi.fn>
let respondHostKey: ReturnType<typeof vi.fn>

beforeEach(() => {
  pushPrompt = () => {
    throw new Error('onHostKeyPrompt not subscribed')
  }
  unsubscribe = vi.fn()
  respondHostKey = vi.fn(async () => {})
  Object.defineProperty(window, 'api', {
    value: {
      ssh: {
        onHostKeyPrompt: vi.fn((cb: (prompt: HostKeyPrompt) => void) => {
          pushPrompt = cb
          return unsubscribe
        }),
        respondHostKey,
      },
    },
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
  delete (window as { api?: unknown }).api
})

describe('HostKeyDialog', () => {
  it('stays closed until a prompt arrives, then shows host:port, key type and fingerprint', () => {
    render(<HostKeyDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => {
      pushPrompt(
        makePrompt({
          requestId: 'req-1',
          host: 'db.example.com',
          port: 2222,
          fingerprint: 'SHA256:fingerprint-one',
        }),
      )
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Unknown host key')).toBeInTheDocument()
    expect(screen.getByText('db.example.com:2222')).toBeInTheDocument()
    expect(screen.getByText('ssh-ed25519')).toBeInTheDocument()
    expect(screen.getByText('SHA256:fingerprint-one')).toBeInTheDocument()
    expect(screen.queryByText(/more prompt/)).not.toBeInTheDocument()
  })

  it('queues prompts, shows the waiting indicator and answers them one at a time', async () => {
    const user = userEvent.setup()
    render(<HostKeyDialog />)

    act(() => {
      pushPrompt(
        makePrompt({ requestId: 'req-1', host: 'first.example.com', fingerprint: 'SHA256:one' }),
      )
      pushPrompt(
        makePrompt({
          requestId: 'req-2',
          host: 'second.example.com',
          port: 22022,
          fingerprint: 'SHA256:two',
        }),
      )
    })

    // First prompt shown, second queued.
    expect(screen.getByText('first.example.com:22')).toBeInTheDocument()
    expect(screen.queryByText(/second\.example\.com/)).not.toBeInTheDocument()
    expect(screen.getByText('1 more prompt waiting')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Accept & remember' }))

    expect(respondHostKey).toHaveBeenCalledWith('req-1', true)
    // The queued prompt takes over and the indicator disappears.
    expect(await screen.findByText('second.example.com:22022')).toBeInTheDocument()
    expect(screen.getByText('SHA256:two')).toBeInTheDocument()
    expect(screen.queryByText(/more prompt/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reject' }))

    expect(respondHostKey).toHaveBeenCalledWith('req-2', false)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('pluralises the waiting indicator for three or more queued prompts', () => {
    render(<HostKeyDialog />)

    act(() => {
      pushPrompt(makePrompt({ requestId: 'req-1' }))
      pushPrompt(makePrompt({ requestId: 'req-2' }))
      pushPrompt(makePrompt({ requestId: 'req-3' }))
    })

    expect(screen.getByText('2 more prompts waiting')).toBeInTheDocument()
  })

  it('ignores a duplicate requestId pushed twice', () => {
    render(<HostKeyDialog />)

    act(() => {
      pushPrompt(makePrompt({ requestId: 'req-1' }))
      pushPrompt(makePrompt({ requestId: 'req-1' }))
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText(/more prompt/)).not.toBeInTheDocument()
  })

  it('shows a loud "not recognized" warning (not the benign prompt) when previouslyKnown', () => {
    render(<HostKeyDialog />)

    act(() => {
      pushPrompt(makePrompt({ requestId: 'req-1', previouslyKnown: true }))
    })

    // Distinct title + copy, and Accept is de-emphasised to "Accept anyway".
    expect(screen.getByText('Warning: host key not recognized')).toBeInTheDocument()
    expect(screen.queryByText('Unknown host key')).not.toBeInTheDocument()
    expect(screen.getByText(/man-in-the-middle/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept anyway' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept & remember' })).not.toBeInTheDocument()
  })

  it('unsubscribes from the prompt stream on unmount', () => {
    const { unmount } = render(<HostKeyDialog />)
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
