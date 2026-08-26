import { TERMINAL_PROGRAM_IDS } from '@shared/ipc'
import { describe, expect, it } from 'vitest'
import {
  buildRemoteInitCommand,
  findProgram,
  isProgramAvailableSync,
  localProgramArgs,
  probeProgram,
  REMOTE_MUX_SESSION,
  remoteExecFragment,
  resolveLocalProgram,
  shellSingleQuote,
  TERMINAL_PROGRAMS,
} from './terminal-programs'

describe('shellSingleQuote', () => {
  it('wraps a plain path in single quotes', () => {
    expect(shellSingleQuote('/var/www/app')).toBe("'/var/www/app'")
  })

  it('escapes embedded single quotes', () => {
    // a'b → 'a'\''b'
    expect(shellSingleQuote("a'b")).toBe("'a'\\''b'")
  })

  it('neutralizes shell metacharacters by quoting them', () => {
    expect(shellSingleQuote('/tmp/$(rm -rf ~); echo')).toBe("'/tmp/$(rm -rf ~); echo'")
  })
})

describe('registry', () => {
  it('has unique ids and non-empty labels/bins', () => {
    const ids = TERMINAL_PROGRAMS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of TERMINAL_PROGRAMS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.bin.length).toBeGreaterThan(0)
    }
  })

  it('does not include a `default` entry (the login shell is implicit)', () => {
    expect(findProgram('default')).toBeUndefined()
  })

  it('stays in sync with the shared TERMINAL_PROGRAM_IDS enum (minus `default`)', () => {
    const registryIds = [...TERMINAL_PROGRAMS.map((p) => p.id)].sort()
    const schemaIds = TERMINAL_PROGRAM_IDS.filter((id) => id !== 'default').sort()
    expect(registryIds).toEqual(schemaIds)
  })
})

describe('localProgramArgs', () => {
  it('builds attach-or-create args per multiplexer, keyed on a per-tab name', () => {
    const tmux = findProgram('tmux')
    const zellij = findProgram('zellij')
    const screen = findProgram('screen')
    if (!tmux || !zellij || !screen) throw new Error('registry missing a multiplexer')
    expect(localProgramArgs(tmux, 'termdesk-abcd1234')).toEqual([
      'new-session',
      '-A',
      '-s',
      'termdesk-abcd1234',
    ])
    expect(localProgramArgs(zellij, 'termdesk-abcd1234')).toEqual([
      'attach',
      '--create',
      'termdesk-abcd1234',
    ])
    expect(localProgramArgs(screen, 'termdesk-abcd1234')).toEqual(['-D', '-R', 'termdesk-abcd1234'])
  })

  it('passes no args for a shell (launches interactively)', () => {
    const fish = findProgram('fish')
    if (!fish) throw new Error('registry missing fish')
    expect(localProgramArgs(fish, 'termdesk-abcd1234')).toEqual([])
  })
})

describe('remoteExecFragment', () => {
  it('returns null for default and unknown ids', () => {
    expect(remoteExecFragment('default')).toBeNull()
    expect(remoteExecFragment('nope')).toBeNull()
  })

  it('guards a multiplexer exec on the remote and uses the shared session name', () => {
    expect(remoteExecFragment('tmux')).toBe(
      `command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s ${REMOTE_MUX_SESSION}`,
    )
    expect(remoteExecFragment('zellij')).toBe(
      `command -v zellij >/dev/null 2>&1 && exec zellij attach --create ${REMOTE_MUX_SESSION}`,
    )
  })

  it('guards a shell exec on the remote with no extra args', () => {
    expect(remoteExecFragment('fish')).toBe('command -v fish >/dev/null 2>&1 && exec fish')
  })
})

describe('buildRemoteInitCommand', () => {
  it('returns null when neither default path nor program applies', () => {
    expect(buildRemoteInitCommand({ defaultPath: null, program: 'default' })).toBeNull()
    expect(buildRemoteInitCommand({ defaultPath: '   ', program: 'default' })).toBeNull()
  })

  it('emits only a cd when a default path is set and program is default', () => {
    expect(buildRemoteInitCommand({ defaultPath: '/srv/app', program: 'default' })).toBe(
      "cd '/srv/app' 2>/dev/null",
    )
  })

  it('emits only a guarded exec when a program is chosen without a default path', () => {
    expect(buildRemoteInitCommand({ defaultPath: null, program: 'tmux' })).toBe(
      `command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s ${REMOTE_MUX_SESSION}`,
    )
  })

  it('cd happens before the program so it inherits the directory', () => {
    const cmd = buildRemoteInitCommand({ defaultPath: '/srv/app', program: 'tmux' })
    expect(cmd).toBe(
      `cd '/srv/app' 2>/dev/null; command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s ${REMOTE_MUX_SESSION}`,
    )
    expect(cmd?.indexOf('cd ')).toBeLessThan(cmd?.indexOf('tmux') ?? -1)
  })

  it('safely quotes a malicious default path', () => {
    const cmd = buildRemoteInitCommand({ defaultPath: "/tmp'; rm -rf ~; '", program: 'default' })
    expect(cmd).toBe("cd '/tmp'\\''; rm -rf ~; '\\''' 2>/dev/null")
  })
})

describe('probeProgram + resolveLocalProgram', () => {
  it('detects a present binary and rejects a missing one', async () => {
    // `node` is guaranteed present in the test runner; the other name is not.
    await expect(probeProgram('node')).resolves.toBe(true)
    await expect(probeProgram('definitely-not-a-real-binary-xyz')).resolves.toBe(false)
  })

  it('resolves null for default and for programs that are not installed', () => {
    expect(resolveLocalProgram('default')).toBeNull()
    expect(resolveLocalProgram('unknown-id')).toBeNull()
  })

  it('isProgramAvailableSync reflects a resolved probe', async () => {
    await probeProgram('node')
    expect(isProgramAvailableSync('node')).toBe(true)
    expect(isProgramAvailableSync('definitely-not-a-real-binary-xyz')).toBe(false)
  })
})
