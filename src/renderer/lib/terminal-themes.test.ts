import type { TerminalColorScheme } from '@shared/ipc'
import { describe, expect, it } from 'vitest'
import { schemeBackground, TERMINAL_THEME_LABELS, TERMINAL_THEMES } from './terminal-themes'

const SCHEMES: TerminalColorScheme[] = [
  'default',
  'dracula',
  'solarized-dark',
  'gruvbox-dark',
  'one-dark',
  'nord',
]

describe('terminal themes', () => {
  it('defines a complete ANSI theme for every scheme', () => {
    for (const scheme of SCHEMES) {
      const t = TERMINAL_THEMES[scheme]
      expect(t, scheme).toBeDefined()
      for (const key of ['background', 'foreground', 'cursor', 'red', 'green', 'blue', 'white']) {
        expect(t[key as keyof typeof t], `${scheme}.${key}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('has a label for every scheme', () => {
    for (const scheme of SCHEMES) {
      expect(TERMINAL_THEME_LABELS[scheme], scheme).toBeTruthy()
    }
  })

  it('schemeBackground returns the scheme background color', () => {
    expect(schemeBackground('dracula')).toBe('#282a36')
    expect(schemeBackground('default')).toBe('#18181b')
  })
})
