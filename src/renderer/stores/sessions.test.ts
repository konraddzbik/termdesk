import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionsStore } from './sessions'

beforeEach(() => {
  useSessionsStore.setState({ sessions: {} })
})

describe('setSession', () => {
  it('creates an entry with idle status for a new tab', () => {
    useSessionsStore.getState().setSession('tab-1', 'ssh-1')
    expect(useSessionsStore.getState().sessions['tab-1']).toEqual({
      sessionId: 'ssh-1',
      status: 'idle',
    })
  })

  it('updates sessionId while preserving status (tab keeps its slot across reconnects)', () => {
    useSessionsStore.getState().setStatus('tab-1', 'connected')
    useSessionsStore.getState().setSession('tab-1', 'ssh-2')
    expect(useSessionsStore.getState().sessions['tab-1']).toEqual({
      sessionId: 'ssh-2',
      status: 'connected',
      error: undefined,
    })
  })

  it('can clear the session id with null', () => {
    useSessionsStore.getState().setSession('tab-1', 'ssh-1')
    useSessionsStore.getState().setSession('tab-1', null)
    expect(useSessionsStore.getState().sessions['tab-1']?.sessionId).toBeNull()
  })
})

describe('setStatus', () => {
  it('sets status and error while preserving the sessionId', () => {
    useSessionsStore.getState().setSession('tab-1', 'ssh-1')
    useSessionsStore.getState().setStatus('tab-1', 'error', 'auth failed')
    expect(useSessionsStore.getState().sessions['tab-1']).toEqual({
      sessionId: 'ssh-1',
      status: 'error',
      error: 'auth failed',
    })
  })

  it('a later status update without error clears the previous error', () => {
    useSessionsStore.getState().setStatus('tab-1', 'error', 'auth failed')
    useSessionsStore.getState().setStatus('tab-1', 'connecting')
    expect(useSessionsStore.getState().sessions['tab-1']).toEqual({
      sessionId: null,
      status: 'connecting',
      error: undefined,
    })
  })

  it('only touches the targeted tab', () => {
    useSessionsStore.getState().setStatus('tab-1', 'connected')
    useSessionsStore.getState().setStatus('tab-2', 'connecting')
    expect(useSessionsStore.getState().sessions['tab-1']?.status).toBe('connected')
    expect(useSessionsStore.getState().sessions['tab-2']?.status).toBe('connecting')
  })
})

describe('clear', () => {
  it('removes only the targeted tab entry', () => {
    useSessionsStore.getState().setSession('tab-1', 'ssh-1')
    useSessionsStore.getState().setSession('tab-2', 'ssh-2')
    useSessionsStore.getState().clear('tab-1')
    const sessions = useSessionsStore.getState().sessions
    expect(sessions['tab-1']).toBeUndefined()
    expect(sessions['tab-2']?.sessionId).toBe('ssh-2')
  })

  it('clearing an unknown tab is a no-op', () => {
    useSessionsStore.getState().setSession('tab-1', 'ssh-1')
    useSessionsStore.getState().clear('missing')
    expect(Object.keys(useSessionsStore.getState().sessions)).toEqual(['tab-1'])
  })
})
