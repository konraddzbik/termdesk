import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

const DEFAULTS = {
  theme: 'dark',
  terminalFontSize: 13,
  terminalFontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  keepaliveSeconds: 15,
  terminalColorScheme: 'default',
  terminalRightClickPaste: false,
  mcpEnabled: false,
  mcpApprovalMode: 'always',
  mcpReadHostIds: [],
  mcpExecHostIds: [],
  mcpAllowPatterns: [],
  hasSeenWelcome: false,
  updateChannel: 'stable',
  tmuxEnabled: false,
  terminalProgram: 'default',
  externalTerminal: '',
  defaultHarnessId: '',
  routineSchedulerEnabled: true,
  terminalWorkspaces: [],
  sidebarSections: {
    hosts: true,
    localTerminals: true,
    workspaces: true,
    tunnels: true,
    snippets: true,
    promptBook: true,
    routines: true,
  },
}

describe('settings', () => {
  let dir: string
  let settingsFile: string

  // The module caches the parsed settings, so every test gets a fresh temp
  // file plus a fresh module instance via vi.resetModules + dynamic import.
  const load = () => import('./settings')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sshdeck-settings-'))
    settingsFile = join(dir, 'settings.json')
    process.env.SSHDECK_SETTINGS_PATH = settingsFile
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.SSHDECK_SETTINGS_PATH
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns defaults when the file is missing', async () => {
    const { getSettings } = await load()
    expect(getSettings()).toEqual(DEFAULTS)
    // Reading must not create the file as a side effect.
    expect(existsSync(settingsFile)).toBe(false)
  })

  it('returns defaults when the file is corrupt JSON', async () => {
    writeFileSync(settingsFile, '{theme: definitely not json', 'utf8')
    const { getSettings } = await load()
    expect(getSettings()).toEqual(DEFAULTS)
  })

  it('keeps valid fields and defaults only the out-of-bounds one', async () => {
    // One bad field must not discard the rest: `theme: light` survives even
    // though `terminalFontSize: 99` is out of range and falls back to default.
    writeFileSync(settingsFile, JSON.stringify({ theme: 'light', terminalFontSize: 99 }), 'utf8')
    const { getSettings } = await load()
    expect(getSettings()).toEqual({ ...DEFAULTS, theme: 'light' })
  })

  it('preserves every other setting when a new version rejects one enum value', async () => {
    // Simulates upgrading into a build that removed a color scheme (or renamed a
    // program id): the now-invalid field resets, all other settings persist.
    writeFileSync(
      settingsFile,
      JSON.stringify({
        theme: 'light',
        terminalFontSize: 20,
        keepaliveSeconds: 30,
        terminalColorScheme: 'a-scheme-removed-in-this-version',
        sidebarSections: { hosts: false },
      }),
      'utf8',
    )
    const { getSettings } = await load()
    expect(getSettings()).toEqual({
      ...DEFAULTS,
      theme: 'light',
      terminalFontSize: 20,
      keepaliveSeconds: 30,
      terminalColorScheme: 'default', // the only field reset
      sidebarSections: { ...DEFAULTS.sidebarSections, hosts: false },
    })
  })

  it('fills missing fields with defaults for a partial valid file', async () => {
    writeFileSync(settingsFile, JSON.stringify({ theme: 'light' }), 'utf8')
    const { getSettings } = await load()
    expect(getSettings()).toEqual({ ...DEFAULTS, theme: 'light' })
  })

  it('persists updates across module reloads (round-trip via SSHDECK_SETTINGS_PATH)', async () => {
    const first = await load()
    first.updateSettings({ theme: 'light', terminalFontSize: 20 })

    vi.resetModules()
    const second = await load()
    expect(second.getSettings()).toEqual({ ...DEFAULTS, theme: 'light', terminalFontSize: 20 })
  })

  it('merges patches instead of replacing the whole object', async () => {
    const { getSettings, updateSettings } = await load()
    updateSettings({ terminalFontSize: 18 })
    const merged = updateSettings({ keepaliveSeconds: 0 })
    expect(merged).toEqual({ ...DEFAULTS, terminalFontSize: 18, keepaliveSeconds: 0 })
    expect(getSettings()).toEqual(merged)
  })

  it('rejects a terminal font size above the zod bound (33)', async () => {
    const { updateSettings } = await load()
    expect(() => updateSettings({ terminalFontSize: 33 })).toThrow()
  })

  it('rejects other out-of-bounds or non-integer patches', async () => {
    const { updateSettings } = await load()
    expect(() => updateSettings({ terminalFontSize: 7 })).toThrow()
    expect(() => updateSettings({ terminalFontSize: 12.5 })).toThrow()
    expect(() => updateSettings({ keepaliveSeconds: 301 })).toThrow()
    expect(() => updateSettings({ keepaliveSeconds: -1 })).toThrow()
  })

  it('keeps cache and file untouched when a patch fails validation', async () => {
    const { getSettings, updateSettings } = await load()
    expect(() => updateSettings({ terminalFontSize: 33 })).toThrow()
    expect(getSettings()).toEqual(DEFAULTS)
    expect(existsSync(settingsFile)).toBe(false)
  })

  it('migrates a legacy tmuxEnabled:true file to terminalProgram "tmux"', async () => {
    writeFileSync(settingsFile, JSON.stringify({ tmuxEnabled: true }), 'utf8')
    const { getSettings } = await load()
    expect(getSettings().terminalProgram).toBe('tmux')
  })

  it('does not migrate when terminalProgram is already set (respects the explicit choice)', async () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({ tmuxEnabled: true, terminalProgram: 'default' }),
      'utf8',
    )
    const { getSettings } = await load()
    expect(getSettings().terminalProgram).toBe('default')
  })

  it('leaves terminalProgram at default when tmuxEnabled was off', async () => {
    writeFileSync(settingsFile, JSON.stringify({ tmuxEnabled: false }), 'utf8')
    const { getSettings } = await load()
    expect(getSettings().terminalProgram).toBe('default')
  })

  it('writes valid pretty-printed JSON with a trailing newline', async () => {
    const { updateSettings } = await load()
    const next = updateSettings({ theme: 'light' })
    const raw = readFileSync(settingsFile, 'utf8')
    expect(JSON.parse(raw)).toEqual(next)
    expect(raw).toBe(`${JSON.stringify(next, null, 2)}\n`)
  })

  it('writes atomically, leaving no staging file behind', async () => {
    const { updateSettings } = await load()
    updateSettings({ theme: 'light' })
    const leftovers = readdirSync(dirname(settingsFile)).filter((f) => f.includes('.tmp-'))
    expect(leftovers).toEqual([])
  })
})
