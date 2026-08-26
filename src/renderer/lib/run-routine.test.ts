// @vitest-environment jsdom
import { useTabsStore } from '@renderer/stores/tabs'
import type { Prompt, Routine } from '@shared/ipc'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runRoutineInteractive } from './run-routine'

const recordRun = vi.fn()

function resetTabs(): void {
  useTabsStore.setState({
    tabs: [],
    activeTabId: null,
    secondaryTabId: null,
    splitDirection: null,
    focusedPane: 'primary',
  })
}

const prompt: Prompt = {
  id: 'p1',
  title: 'Review',
  body: 'Review {{path}} for {{focus}}',
  description: null,
  tags: [],
  defaultHarnessId: null,
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
}

const routine: Routine = {
  id: 'r1',
  name: 'Daily',
  promptId: 'p1',
  harnessId: 'claude',
  cwd: '/work/app',
  mode: 'interactive',
  autonomy: false,
  schedule: { kind: 'manual' },
  variables: { path: 'src', focus: 'security' },
  enabled: true,
  lastRunAt: null,
  nextRunAt: null,
  createdAt: 0,
  updatedAt: 0,
}

beforeEach(() => {
  recordRun.mockReset()
  resetTabs()
  ;(window as unknown as { api: unknown }).api = { routines: { recordRun } }
})

describe('runRoutineInteractive', () => {
  it('renders variables, composes the command, opens a terminal, records the launch', () => {
    const cmd = runRoutineInteractive(routine, prompt)
    expect(cmd).toBe("claude -p 'Review src for security'")

    // A local terminal opened in the routine's cwd with the composed runOnOpen.
    const tabs = useTabsStore.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      kind: 'local-terminal',
      cwd: '/work/app',
      runOnOpen: "claude -p 'Review src for security'",
    })

    expect(recordRun).toHaveBeenCalledWith({
      routineId: 'r1',
      status: 'launched',
      command: "claude -p 'Review src for security'",
    })
  })

  it('adds auto-approve flags only when the routine opts into autonomy', () => {
    const cmd = runRoutineInteractive({ ...routine, autonomy: true }, prompt)
    expect(cmd).toContain('--dangerously-skip-permissions')
  })

  it('refuses a routine whose agent no longer exists instead of substituting Claude Code', () => {
    // Falling back would turn `codex exec --sandbox workspace-write` into
    // `claude --dangerously-skip-permissions` behind the user's back.
    expect(() =>
      runRoutineInteractive({ ...routine, harnessId: 'retired-agent', autonomy: true }, prompt),
    ).toThrow(/no longer exists/)
  })
})
