import type { AutomationEvent, AutomationJob, AutomationJobInput } from '@shared/ipc'
import { create } from 'zustand'

export type HostRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'error' | 'cancelled'

export interface HostRunState {
  hostId: string
  status: HostRunStatus
  /** Combined stdout+stderr, capped to the last OUTPUT_CAP chars. */
  output: string
  exitCode: number | null
  error?: string
}

export interface RunState {
  runId: string
  command: string
  hostIds: string[]
  hosts: Record<string, HostRunState>
}

/** Per-host output buffer cap (chars) to bound memory on chatty commands. */
const OUTPUT_CAP = 200_000

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function appendCapped(prev: string, chunk: string): string {
  const next = prev + chunk
  return next.length > OUTPUT_CAP ? next.slice(next.length - OUTPUT_CAP) : next
}

function emptyHost(hostId: string): HostRunState {
  return { hostId, status: 'pending', output: '', exitCode: null }
}

interface AutomationState {
  jobs: AutomationJob[]
  loading: boolean
  error: string | null
  /** The run currently shown in the results pane. */
  currentRunId: string | null
  runs: Record<string, RunState>

  loadJobs(): Promise<void>
  createJob(input: AutomationJobInput): Promise<void>
  updateJob(id: string, input: AutomationJobInput): Promise<void>
  deleteJob(id: string): Promise<void>
  startRun(command: string, hostIds: string[]): Promise<void>
  cancelRun(runId: string): Promise<void>
  applyEvent(event: AutomationEvent): void
}

export const useAutomationStore = create<AutomationState>((set, get) => ({
  jobs: [],
  loading: false,
  error: null,
  currentRunId: null,
  runs: {},

  loadJobs: async () => {
    set({ loading: true, error: null })
    try {
      set({ jobs: await window.api.automation.listJobs(), loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  createJob: async (input) => {
    await window.api.automation.createJob(input)
    await get().loadJobs()
  },

  updateJob: async (id, input) => {
    await window.api.automation.updateJob(id, input)
    await get().loadJobs()
  },

  deleteJob: async (id) => {
    await window.api.automation.deleteJob(id)
    await get().loadJobs()
  },

  startRun: async (command, hostIds) => {
    const runId = await window.api.automation.run({ command, hostIds })
    set((state) => {
      // Don't clobber events that may already have arrived for this runId.
      const existing = state.runs[runId]
      const hosts: Record<string, HostRunState> = {}
      for (const hostId of hostIds) hosts[hostId] = existing?.hosts[hostId] ?? emptyHost(hostId)
      return {
        currentRunId: runId,
        runs: { ...state.runs, [runId]: { runId, command, hostIds, hosts } },
      }
    })
  },

  cancelRun: async (runId) => {
    await window.api.automation.cancel(runId)
  },

  applyEvent: (event) =>
    set((state) => {
      const run: RunState = state.runs[event.runId] ?? {
        runId: event.runId,
        command: '',
        hostIds: [],
        hosts: {},
      }
      const host: HostRunState = run.hosts[event.hostId] ?? emptyHost(event.hostId)
      const next: HostRunState = { ...host }

      switch (event.type) {
        case 'started':
          next.status = 'running'
          break
        case 'stdout':
        case 'stderr':
          next.output = appendCapped(next.output, event.chunk ?? '')
          if (next.status === 'pending') next.status = 'running'
          break
        case 'exit':
          next.exitCode = event.exitCode ?? null
          next.status = event.exitCode === 0 ? 'success' : 'failed'
          break
        case 'error':
          next.error = event.message
          next.status = event.message?.toLowerCase().includes('cancel') ? 'cancelled' : 'error'
          break
      }

      const hostIds = run.hostIds.includes(event.hostId)
        ? run.hostIds
        : [...run.hostIds, event.hostId]
      return {
        runs: {
          ...state.runs,
          [event.runId]: { ...run, hostIds, hosts: { ...run.hosts, [event.hostId]: next } },
        },
      }
    }),
}))

/** Wire the global automation event stream into the store (call once at app start). */
export function initAutomationSubscription(): () => void {
  return window.api.automation.onEvent((event) => {
    useAutomationStore.getState().applyEvent(event)
  })
}
