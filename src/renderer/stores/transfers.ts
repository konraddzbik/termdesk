import type { Transfer } from '@shared/ipc'
import { create } from 'zustand'

interface TransfersState {
  /** Insertion-ordered map of transfer id → latest state. */
  transfers: Record<string, Transfer>
  order: string[]
  upsert(transfer: Transfer): void
  clearFinished(): void
}

export const useTransfersStore = create<TransfersState>((set) => ({
  transfers: {},
  order: [],

  upsert: (transfer) =>
    set((state) => ({
      transfers: { ...state.transfers, [transfer.id]: transfer },
      order: state.order.includes(transfer.id) ? state.order : [...state.order, transfer.id],
    })),

  clearFinished: () =>
    set((state) => {
      const keep = (id: string): boolean => {
        const t = state.transfers[id]
        return t !== undefined && (t.status === 'queued' || t.status === 'active')
      }
      const order = state.order.filter(keep)
      const transfers: Record<string, Transfer> = {}
      for (const id of order) {
        const t = state.transfers[id]
        if (t) transfers[id] = t
      }
      return { transfers, order }
    }),
}))

/** Wire the global transfer event stream into the store (call once at app start). */
export function initTransfersSubscription(): () => void {
  return window.api.sftp.onTransfer((transfer) => {
    useTransfersStore.getState().upsert(transfer)
  })
}
