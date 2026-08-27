import { IPC, IPC_EVENTS } from '@shared/channels'
import { type UpdateState, updateStateSchema } from '@shared/ipc'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { devEnvFlag } from './app-paths'
import { getSettings } from './store/settings'

/**
 * App auto-update from this repository's GitHub Releases. The lifecycle is
 * mirrored to the renderer over `updates:*` IPC for a non-modal in-app banner.
 *
 * Public releases need no credential, which is the point: the open-source client
 * updates from the same artifacts anyone can download and verify.
 *
 * Platform support: Windows (NSIS) + Linux (AppImage) only. macOS is skipped
 * entirely until the build is signed + notarized (Squirrel.Mac refuses to
 * update an unsigned app); Mac users get new builds via the manual download.
 */

const GITHUB_OWNER = 'konraddzbik'
const GITHUB_REPO = 'termdesk'
/** Where to send users for a manual download (macOS, or update failures). */
const DOWNLOADS_URL =
  devEnvFlag('DOWNLOADS_URL') ?? `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

type Channel = 'stable' | 'beta'
type PlatformSegment = 'win' | 'linux'

export function openReleasesPage(): void {
  void shell.openExternal(DOWNLOADS_URL)
}

/** win/linux self-update; darwin (unsigned) is intentionally unsupported. */
function platformSegment(): PlatformSegment | null {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'linux') return 'linux'
  return null
}

function currentChannel(): Channel {
  return getSettings().updateChannel === 'beta' ? 'beta' : 'stable'
}

/** Set while a user-initiated check is in flight, so its result is surfaced. */
let manualUpdateCheck = false
/** Last broadcast state; replayed to windows that subscribe late. */
let state: UpdateState = { status: 'idle', canSelfUpdate: platformSegment() !== null }

function setState(patch: Partial<UpdateState>): void {
  state = updateStateSchema.parse({ ...state, ...patch })
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.updateEvent, state)
  }
}

/**
 * Points the updater at this repository's GitHub Releases. Returns false when
 * the platform has no self-update support — the caller then skips.
 */
function configure(): boolean {
  if (!platformSegment()) return false
  // A 'beta' preference maps to GitHub pre-releases; 'stable' takes published
  // releases only. This is the GitHub provider's equivalent of a channel.
  autoUpdater.allowPrerelease = currentChannel() === 'beta'
  // Updates go FORWARD only. electron-updater's `channel` setter silently sets
  // allowDowngrade = true, so pin it explicitly: a stale or tampered feed must
  // not be able to walk clients backwards onto an older build whose
  // vulnerabilities are already public. A deliberate rollback is a manual
  // download.
  autoUpdater.allowDowngrade = false
  autoUpdater.setFeedURL({ provider: 'github', owner: GITHUB_OWNER, repo: GITHUB_REPO })
  return true
}

/** Triggered by the Help ▸ Check for Updates… menu item. */
export function manualCheckForUpdates(): void {
  if (!app.isPackaged) {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Check for Updates',
      message: 'Updates are only checked in packaged builds.',
    })
    return
  }
  if (platformSegment() === null) {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Check for Updates',
      message: 'Automatic updates are not available on this platform yet.',
      detail:
        'If a GitHub Release exists, download it from the repository Releases page. Otherwise build from source — see INSTALL.md.',
    })
    return
  }
  manualUpdateCheck = true
  void autoUpdater.checkForUpdates().catch(() => {
    // Result surfaced by the autoUpdater 'error' handler.
  })
}

/** Renderer → main controls for the in-app banner. */
export function registerUpdaterIpc(): void {
  ipcMain.handle(IPC.updatesGetState, () => state)
  ipcMain.handle(IPC.updatesDownload, () => {
    // Re-apply the feed config before downloading.
    if (configure()) void autoUpdater.downloadUpdate().catch(() => {})
  })
  ipcMain.handle(IPC.updatesInstall, () => {
    if (platformSegment() !== null) autoUpdater.quitAndInstall()
    else openReleasesPage()
  })
}

/** Wires the autoUpdater lifecycle and schedules background checks. */
export function initUpdater(): void {
  if (platformSegment() === null) {
    console.log('[updater] disabled on this platform (macOS unsigned)')
    return
  }
  autoUpdater.autoDownload = false // ask the user via the banner first
  autoUpdater.autoInstallOnAppQuit = true

  if (!app.isPackaged) {
    console.log('[updater] Skipping auto-update checks in development')
    return
  }

  autoUpdater.on('checking-for-update', () => {
    if (manualUpdateCheck) setState({ status: 'checking' })
  })

  autoUpdater.on('update-available', (info: { version: string }) => {
    manualUpdateCheck = false
    console.log('[updater] Update available:', info.version)
    // Don't auto-download — surface the banner so the user opts in.
    setState({ status: 'available', version: info.version, percent: 0 })
  })

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    setState({ status: 'downloading', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    console.log('[updater] Update downloaded:', info.version)
    setState({ status: 'downloaded', version: info.version, percent: 100 })
  })

  autoUpdater.on('update-not-available', () => {
    setState({ status: 'idle' })
    if (!manualUpdateCheck) return
    manualUpdateCheck = false
    void dialog.showMessageBox({
      type: 'info',
      title: 'You’re up to date',
      message: 'TermDesk is already on the latest version.',
    })
  })

  autoUpdater.on('error', (err: Error) => {
    console.error('[updater] Error:', err)
    setState({ status: 'idle' }) // don't nag in-app for background failures
    if (!manualUpdateCheck) return
    manualUpdateCheck = false
    void dialog
      .showMessageBox({
        type: 'warning',
        title: 'Update check failed',
        message: 'Could not check for updates right now.',
        detail:
          'If a GitHub Release exists, download it from the repository Releases page. Otherwise build from source — see INSTALL.md.',
        buttons: ['Open download page', 'Close'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) openReleasesPage()
      })
  })

  // Check shortly after launch and periodically.
  const check = (): void => {
    if (configure()) void autoUpdater.checkForUpdates().catch(() => {})
  }
  setTimeout(check, 8_000).unref?.()
  setInterval(check, 6 * 60 * 60 * 1000).unref?.()
}
