// @vitest-environment jsdom
import { useSessionsStore } from '@renderer/stores/sessions'
import { useTabsStore } from '@renderer/stores/tabs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getActiveSession, sendToActiveSession } from './send-to-session'

const sshWrite = vi.fn()
const localWrite = vi.fn()

beforeEach(() => {
  sshWrite.mockReset()
  localWrite.mockReset()
  // Minimal window.api surface used by the helper.
  ;(window as unknown as { api: unknown }).api = {
    ssh: { write: sshWrite },
    localTerm: { write: localWrite },
  }
  useTabsStore.setState({
    tabs: [],
    activeTabId: null,
    secondaryTabId: null,
    splitDirection: null,
    focusedPane: 'primary',
  })
  useSessionsStore.setState({ sessions: {} })
})

function setActive(kind: 'terminal' | 'local-terminal', status: string, sessionId: string | null) {
  useTabsStore.setState({
    tabs: [{ id: 't1', kind, title: 'x' } as never],
    activeTabId: 't1',
  })
  useSessionsStore.setState({ sessions: { t1: { sessionId, status: status as never } } })
}

describe('getActiveSession', () => {
  it('returns null with no active tab', () => {
    expect(getActiveSession()).toBeNull()
  })

  it('returns null for a connected but non-terminal tab kind', () => {
    useTabsStore.setState({ tabs: [{ id: 't1', kind: 'sftp' } as never], activeTabId: 't1' })
    useSessionsStore.setState({ sessions: { t1: { sessionId: 's', status: 'connected' } } })
    expect(getActiveSession()).toBeNull()
  })

  it('returns null when the session is not connected', () => {
    setActive('terminal', 'connecting', 's1')
    expect(getActiveSession()).toBeNull()
  })

  it('returns the ssh session when connected', () => {
    setActive('terminal', 'connected', 's1')
    expect(getActiveSession()).toEqual({ sessionId: 's1', kind: 'terminal' })
  })
})

describe('sendToActiveSession', () => {
  it('writes to the SSH transport for a terminal tab', () => {
    setActive('terminal', 'connected', 's1')
    expect(sendToActiveSession('echo hi\n')).toBe(true)
    expect(sshWrite).toHaveBeenCalledWith('s1', 'echo hi\n')
    expect(localWrite).not.toHaveBeenCalled()
  })

  it('writes to the local PTY transport for a local-terminal tab', () => {
    setActive('local-terminal', 'connected', 'L1')
    expect(sendToActiveSession('claude\n')).toBe(true)
    expect(localWrite).toHaveBeenCalledWith('L1', 'claude\n')
    expect(sshWrite).not.toHaveBeenCalled()
  })

  it('returns false and writes nothing when there is no connected terminal', () => {
    expect(sendToActiveSession('x')).toBe(false)
    expect(sshWrite).not.toHaveBeenCalled()
    expect(localWrite).not.toHaveBeenCalled()
  })
})
