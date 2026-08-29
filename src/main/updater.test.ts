import { afterEach, describe, expect, it, vi } from 'vitest'

// The self-update path has "never been exercised against a real GitHub Release
// feed" (#25) — because no Release exists yet. A unit test cannot download from
// a real feed, but it CAN lock in the client wiring that would otherwise be
// wrong silently: which repo the feed points at, that macOS is gated off, and
// that the updater can never walk a client backwards. Those are exactly the
// bugs a first real Release would surface the hard way.

// electron-updater's autoUpdater is a stateful singleton; capture what configure() sets.
const autoUpdater = {
  allowPrerelease: false,
  allowDowngrade: true, // electron-updater's real default — configure() must flip it
  autoDownload: true,
  autoInstallOnAppQuit: false,
  setFeedURL: vi.fn(),
  on: vi.fn(),
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  downloadUpdate: vi.fn().mockResolvedValue(undefined),
  quitAndInstall: vi.fn(),
}
vi.mock('electron-updater', () => ({ autoUpdater }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', setPath: vi.fn(), setName: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { openExternal: vi.fn() },
}))

const settings = { updateChannel: 'stable' as 'stable' | 'beta' }
vi.mock('./store/settings', () => ({ getSettings: () => settings }))

const realPlatform = process.platform
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

afterEach(() => {
  setPlatform(realPlatform)
  vi.clearAllMocks()
  autoUpdater.allowDowngrade = true
  settings.updateChannel = 'stable'
})

describe('updater feed wiring (#25)', () => {
  it('serves updates only from this repository', async () => {
    const { GITHUB_OWNER, GITHUB_REPO } = await import('./updater')
    expect(GITHUB_OWNER).toBe('konraddzbik')
    expect(GITHUB_REPO).toBe('termdesk')
  })

  it('points electron-updater at this repo’s GitHub Releases', async () => {
    setPlatform('win32')
    const { configure } = await import('./updater')
    expect(configure()).toBe(true)
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'github',
      owner: 'konraddzbik',
      repo: 'termdesk',
    })
  })

  it('never lets the feed walk a client backwards (allowDowngrade stays false)', async () => {
    setPlatform('linux')
    const { configure } = await import('./updater')
    configure()
    expect(autoUpdater.allowDowngrade).toBe(false)
  })

  it('maps the beta channel to GitHub pre-releases, stable to published only', async () => {
    setPlatform('win32')
    const { configure } = await import('./updater')

    settings.updateChannel = 'beta'
    configure()
    expect(autoUpdater.allowPrerelease).toBe(true)

    settings.updateChannel = 'stable'
    configure()
    expect(autoUpdater.allowPrerelease).toBe(false)
  })
})

describe('updater platform gating (#25)', () => {
  it('enables self-update on Windows and Linux', async () => {
    const { platformSegment } = await import('./updater')
    setPlatform('win32')
    expect(platformSegment()).toBe('win')
    setPlatform('linux')
    expect(platformSegment()).toBe('linux')
  })

  it('disables self-update on macOS (unsigned Squirrel.Mac refuses it)', async () => {
    setPlatform('darwin')
    const { platformSegment, configure } = await import('./updater')
    expect(platformSegment()).toBeNull()
    // configure() must refuse and never touch the feed on darwin.
    expect(configure()).toBe(false)
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled()
  })
})
