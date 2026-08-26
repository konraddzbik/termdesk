import { describe, expect, it } from 'vitest'
import { buildLaunch, EXTERNAL_TERMINALS, findExternalTerminal } from './external-terminals'

describe('external-terminals registry', () => {
  it('has unique ids, non-empty labels, and at least one platform each', () => {
    const ids = EXTERNAL_TERMINALS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of EXTERNAL_TERMINALS) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.platforms.length).toBeGreaterThan(0)
      // Every entry must be launchable on each platform it claims.
      const macOk = !t.platforms.includes('darwin') || !!t.macApp
      const nonMacOk = (!t.platforms.includes('linux') && !t.platforms.includes('win32')) || !!t.bin
      expect(macOk && nonMacOk).toBe(true)
    }
  })

  it('includes the popular emulators the user asked for', () => {
    for (const id of ['ghostty', 'warp', 'iterm2', 'kitty', 'alacritty', 'wezterm']) {
      expect(findExternalTerminal(id)).toBeDefined()
    }
  })
})

describe('buildLaunch — macOS (via `open`)', () => {
  it('opens a plain app at a directory (Terminal, iTerm2, Warp)', () => {
    expect(buildLaunch('terminal-app', 'darwin', '/w')).toEqual({
      file: 'open',
      args: ['-a', 'Terminal', '/w'],
      cwd: '/w',
    })
    expect(buildLaunch('iterm2', 'darwin', '/w')).toEqual({
      file: 'open',
      args: ['-a', 'iTerm', '/w'],
      cwd: '/w',
    })
    expect(buildLaunch('warp', 'darwin', '/w')?.args).toEqual(['-a', 'Warp', '/w'])
  })

  it('forwards a cwd flag via `-n -a App --args` for CLI-driven emulators', () => {
    expect(buildLaunch('ghostty', 'darwin', '/w')?.args).toEqual([
      '-n',
      '-a',
      'Ghostty',
      '--args',
      '--working-directory=/w',
    ])
    expect(buildLaunch('kitty', 'darwin', '/w')?.args).toEqual([
      '-n',
      '-a',
      'kitty',
      '--args',
      '--directory',
      '/w',
    ])
    expect(buildLaunch('wezterm', 'darwin', '/w')?.args).toEqual([
      '-n',
      '-a',
      'WezTerm',
      '--args',
      'start',
      '--cwd',
      '/w',
    ])
  })
})

describe('buildLaunch — Linux/Windows (direct binary)', () => {
  it('invokes the binary with its own cwd flag', () => {
    expect(buildLaunch('ghostty', 'linux', '/w')).toEqual({
      file: 'ghostty',
      args: ['--working-directory=/w'],
      cwd: '/w',
    })
    expect(buildLaunch('gnome-terminal', 'linux', '/w')?.args).toEqual(['--working-directory=/w'])
    expect(buildLaunch('konsole', 'linux', '/w')?.args).toEqual(['--workdir', '/w'])
    expect(buildLaunch('windows-terminal', 'win32', 'C:/w')?.args).toEqual(['-d', 'C:/w'])
  })

  it('falls back to just the spawn cwd for a flag-less emulator (Warp on Linux)', () => {
    expect(buildLaunch('warp', 'linux', '/w')).toEqual({
      file: 'warp-terminal',
      args: [],
      cwd: '/w',
    })
  })
})

describe('buildLaunch — platform guards', () => {
  it('returns null when the emulator is not available on the platform', () => {
    expect(buildLaunch('iterm2', 'linux', '/w')).toBeNull() // mac-only
    expect(buildLaunch('gnome-terminal', 'darwin', '/w')).toBeNull() // linux-only
    expect(buildLaunch('windows-terminal', 'linux', '/w')).toBeNull() // win-only
  })

  it('returns null for an unknown id', () => {
    expect(buildLaunch('nope', 'darwin', '/w')).toBeNull()
  })
})
