import type { Credential, CredentialInput } from '@shared/ipc'
import { create } from 'zustand'
import { useHostsStore } from './hosts'

interface CredentialsState {
  credentials: Credential[]
  loading: boolean
  error: string | null
  loadAll(): Promise<void>
  createCredential(input: CredentialInput): Promise<Credential>
  updateCredential(id: string, input: CredentialInput): Promise<Credential>
  deleteCredential(id: string): Promise<boolean>
}

/** Normalises a rejection into a human-readable message, stripping Electron's IPC prefix. */
function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

export const useCredentialsStore = create<CredentialsState>((set) => ({
  credentials: [],
  loading: false,
  error: null,

  async loadAll() {
    set({ loading: true, error: null })
    try {
      const credentials = await window.api.credentials.list()
      set({ credentials, loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  async createCredential(input) {
    const credential = await window.api.credentials.create(input)
    set((state) => ({ credentials: [...state.credentials, credential], error: null }))
    return credential
  },

  async updateCredential(id, input) {
    const credential = await window.api.credentials.update(id, input)
    set((state) => ({
      credentials: state.credentials.map((c) => (c.id === id ? credential : c)),
      error: null,
    }))
    return credential
  },

  async deleteCredential(id) {
    try {
      await window.api.credentials.remove(id)
      set((state) => ({ credentials: state.credentials.filter((c) => c.id !== id), error: null }))
      // Hosts that referenced this credential had credential_id set null in main;
      // re-fetch so the host list reflects the change immediately.
      await useHostsStore.getState().loadAll()
      return true
    } catch (error) {
      set({ error: toMessage(error) })
      return false
    }
  },
}))
