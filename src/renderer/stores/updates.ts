import type { UpdateState } from '@shared/ipc'
import { create } from 'zustand'

/**
 * Mirrors the main-process auto-update state for the in-app banner, and exposes
 * the download/install controls. A "dismiss" only hides the banner until the
 * state advances (a new version, or the update becoming ready to install).
 */
interface UpdatesStore {
  update: UpdateState
  dismissed: boolean
  init(): void
  download(): void
  install(): void
  dismiss(): void
}

const INITIAL: UpdateState = { status: 'idle', canSelfUpdate: true }

let subscribed = false

export const useUpdatesStore = create<UpdatesStore>((set, get) => ({
  update: INITIAL,
  dismissed: false,

  init: () => {
    if (subscribed) return
    subscribed = true
    void window.api.updates.getState().then((s) => set({ update: s }))
    window.api.updates.onEvent((next) => {
      const prev = get().update
      // Un-dismiss when a new version appears, or once it's ready to install —
      // the "restart" prompt should always surface even if a download toast was
      // dismissed earlier.
      const reshow =
        next.version !== prev.version ||
        (next.status === 'downloaded' && prev.status !== 'downloaded')
      set((state) => ({ update: next, dismissed: reshow ? false : state.dismissed }))
    })
  },

  download: () => void window.api.updates.download(),
  install: () => void window.api.updates.install(),
  dismiss: () => set({ dismissed: true }),
}))
