import { beforeEach, describe, expect, it } from 'vitest'
import { useAutomationStore } from './automation'

function host(runId: string, hostId: string) {
  return useAutomationStore.getState().runs[runId]?.hosts[hostId]
}

describe('automation store applyEvent', () => {
  beforeEach(() => useAutomationStore.setState({ runs: {}, currentRunId: null }))

  it('reduces started → stdout → exit(0) to success with captured output', () => {
    const s = useAutomationStore.getState()
    s.applyEvent({ runId: 'r', hostId: 'h', type: 'started' })
    s.applyEvent({ runId: 'r', hostId: 'h', type: 'stdout', chunk: 'hello ' })
    s.applyEvent({ runId: 'r', hostId: 'h', type: 'stderr', chunk: 'warn' })
    s.applyEvent({ runId: 'r', hostId: 'h', type: 'exit', exitCode: 0 })
    expect(host('r', 'h')).toMatchObject({ status: 'success', output: 'hello warn', exitCode: 0 })
  })

  it('non-zero exit is failed', () => {
    const s = useAutomationStore.getState()
    s.applyEvent({ runId: 'r', hostId: 'h', type: 'exit', exitCode: 3 })
    expect(host('r', 'h')).toMatchObject({ status: 'failed', exitCode: 3 })
  })

  it('error events mark error, cancel messages mark cancelled', () => {
    const s = useAutomationStore.getState()
    s.applyEvent({ runId: 'r', hostId: 'h1', type: 'error', message: 'connect failed' })
    s.applyEvent({ runId: 'r', hostId: 'h2', type: 'error', message: 'Run cancelled' })
    expect(host('r', 'h1')?.status).toBe('error')
    expect(host('r', 'h2')?.status).toBe('cancelled')
  })

  it('lazily creates run + host entries for events arriving before startRun', () => {
    useAutomationStore.getState().applyEvent({ runId: 'late', hostId: 'x', type: 'started' })
    expect(host('late', 'x')?.status).toBe('running')
    expect(useAutomationStore.getState().runs.late?.hostIds).toContain('x')
  })
})
