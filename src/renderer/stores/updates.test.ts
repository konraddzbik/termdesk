// @vitest-environment jsdom
import type { UpdateState } from '@shared/ipc'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUpdatesStore } from './updates'

let eventCb: ((s: UpdateState) => void) | null = null

const api = {
  updates: {
    getState: vi.fn(async (): Promise<UpdateState> => ({ status: 'idle', canSelfUpdate: true })),
    download: vi.fn(),
    install: vi.fn(),
    onEvent: vi.fn((cb: (s: UpdateState) => void) => {
      eventCb = cb
      return () => {}
    }),
  },
}
Object.defineProperty(window, 'api', { value: api, configurable: true })

const emit = (s: UpdateState): void => eventCb?.(s)

beforeEach(() => {
  useUpdatesStore.setState({ update: { status: 'idle', canSelfUpdate: true }, dismissed: false })
  // init() is idempotent (subscribes once); safe to call in every test.
  useUpdatesStore.getState().init()
})

describe('updates store', () => {
  it('subscribes once and applies incoming state', () => {
    expect(api.updates.onEvent).toHaveBeenCalled()
    emit({ status: 'downloading', version: '1.2.0', percent: 10, canSelfUpdate: true })
    expect(useUpdatesStore.getState().update.status).toBe('downloading')
    expect(useUpdatesStore.getState().update.percent).toBe(10)
  })

  it('keeps the banner dismissed across progress on the same version', () => {
    emit({ status: 'downloading', version: '1.2.0', percent: 10, canSelfUpdate: true })
    useUpdatesStore.getState().dismiss()
    expect(useUpdatesStore.getState().dismissed).toBe(true)
    emit({ status: 'downloading', version: '1.2.0', percent: 60, canSelfUpdate: true })
    expect(useUpdatesStore.getState().dismissed).toBe(true)
  })

  it('re-shows when the update becomes ready to install', () => {
    emit({ status: 'downloading', version: '1.2.0', percent: 60, canSelfUpdate: true })
    useUpdatesStore.getState().dismiss()
    emit({ status: 'downloaded', version: '1.2.0', percent: 100, canSelfUpdate: true })
    expect(useUpdatesStore.getState().dismissed).toBe(false)
  })

  it('re-shows when a newer version appears after a dismiss', () => {
    emit({ status: 'downloaded', version: '1.2.0', canSelfUpdate: true })
    useUpdatesStore.getState().dismiss()
    emit({ status: 'available', version: '1.3.0', canSelfUpdate: false })
    expect(useUpdatesStore.getState().dismissed).toBe(false)
  })

  it('forwards download/install to the bridge', () => {
    useUpdatesStore.getState().download()
    useUpdatesStore.getState().install()
    expect(api.updates.download).toHaveBeenCalled()
    expect(api.updates.install).toHaveBeenCalled()
  })
})
