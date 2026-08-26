import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron'
import { configureUserDataPath, devEnvFlag } from './app-paths'
import { registerAppIpc } from './ipc/app'
import { registerAutomationIpc } from './ipc/automation'
import { registerCredentialsIpc } from './ipc/credentials'
import { registerGroupsIpc } from './ipc/groups'
import { registerHostsIpc } from './ipc/hosts'
import { registerLocalTerminalIpc } from './ipc/local-terminal'
import { registerLocalTerminalsIpc } from './ipc/local-terminals'
import { registerLogsIpc } from './ipc/logs'
import { registerMcpIpc } from './ipc/mcp'
import { registerPromptsIpc } from './ipc/prompts'
import { registerRdpIpc } from './ipc/rdp'
import { registerRoutinesIpc } from './ipc/routines'
import { registerSettingsIpc } from './ipc/settings'
import { registerSftpIpc } from './ipc/sftp'
import { registerSnippetsIpc } from './ipc/snippets'
import { registerSshIpc } from './ipc/ssh'
import { registerSshConfigIpc } from './ipc/ssh-config'
import { registerTunnelsIpc } from './ipc/tunnels'
import { registerVncIpc } from './ipc/vnc'
import { registerVncImportIpc } from './ipc/vnc-import'
import { runMcpSmokeTest } from './mcp/mcp-smoke'
import { stopMcpServer, syncMcpFromSettings } from './mcp/server'
import { shutdownRdpProxy } from './rdp/rdp-proxy'
import { startRoutineScheduler, stopRoutineScheduler } from './routine-scheduler'
import { closeAllEdits, sweepOrphanedEditDirs } from './sftp/edit-watch'
import { sftpManager } from './sftp/sftp-manager'
import { runSftpSmokeTest } from './sftp/sftp-smoke'
import { transferManager } from './sftp/transfer-manager'
import { sessionManager } from './ssh/session-manager'
import { runSshSmokeTest } from './ssh/ssh-smoke'
import { tunnelManager } from './ssh/tunnel-manager'
import { runVaultSmokeTest } from './store/vault-smoke'
import { localTerminalManager } from './terminal/local-terminal-manager'
import { initUpdater, manualCheckForUpdates, openReleasesPage, registerUpdaterIpc } from './updater'
import { runVncRa2Probe } from './vnc/vnc-ra2-probe'
import { runVncSmokeTest } from './vnc/vnc-smoke'
import { shutdownBridge } from './vnc/ws-bridge'

function buildMenu(): void {
  // No File menu → Cmd/Ctrl+W stays free for the renderer's close-tab
  // shortcut instead of closing the whole window.
  const helpMenu: Electron.MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      { label: 'Check for Updates…', click: () => manualCheckForUpdates() },
      { label: 'Releases & Downloads', click: () => openReleasesPage() },
    ],
  }
  const template: Electron.MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [
          { role: 'appMenu' },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
          helpMenu,
        ]
      : [{ role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }, helpMenu]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.on('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function isAllowedNavigation(url: string): boolean {
  const allowed = process.env.ELECTRON_RENDERER_URL
  if (!allowed) return false
  try {
    return new URL(url).origin === new URL(allowed).origin
  } catch {
    return false
  }
}

/**
 * First-run EULA acceptance, for the project's own distributed binaries only.
 *
 * The source is MIT: nothing may condition its use on accepting further terms,
 * and a contributor running an unpackaged build must never meet a modal wall.
 * `EULA.txt` governs the *pre-built installers this project publishes* and says
 * so in its own scope clause — "If you build TermDesk yourself from source, the
 * MIT License alone applies and this Agreement does not."
 *
 * `app.isPackaged` is the wrong line to draw for that: it is true of ANY
 * packaged build, so a fork's `npm run dist`, a distro package or a user's own
 * installer all inherited this licensor's terms and quit when declined —
 * exactly what the MIT grant and the clause above rule out.
 *
 * `__TERMDESK_OFFICIAL_BUILD__` is baked in at build time and is true only for
 * installers produced by this project's release workflow. It is `undefined`
 * under vitest and `electron-vite dev`, where no substitution runs, hence the
 * `!== true` test rather than a bare negation.
 */
function ensureEulaAccepted(): boolean {
  if (!app.isPackaged) return true
  if (typeof __TERMDESK_OFFICIAL_BUILD__ === 'undefined' || __TERMDESK_OFFICIAL_BUILD__ !== true) {
    return true
  }

  const flagPath = join(app.getPath('userData'), 'eula-accepted.txt')
  if (existsSync(flagPath)) return true

  const eulaText = `TermDesk End User License Agreement

TermDesk's source code is MIT-licensed (see LICENSE). This agreement covers only
the pre-built installer you are running: see the accompanying EULA.txt.

It does not restrict inspecting or modifying the source, and it does not apply to
a build you make yourself. Accepting also acknowledges the local-only data model
described in SECURITY.md.`

  const result = dialog.showMessageBoxSync({
    type: 'info',
    title: 'TermDesk License Agreement',
    message: 'Please read and accept the End User License Agreement',
    detail: eulaText,
    buttons: ['Accept and Continue', 'Decline and Quit'],
    defaultId: 0,
    cancelId: 1,
  })

  if (result === 0) {
    try {
      writeFileSync(flagPath, new Date().toISOString())
    } catch {
      // non-fatal
    }
    return true
  }
  app.quit()
  return false
}

configureUserDataPath()

/**
 * Last-resort net under the main process.
 *
 * Main owns every SSH connection, PTY, transfer and tunnel in the app, so a
 * single stray synchronous throw inside a socket/server event listener costs
 * the user every open session at once — a far worse outcome than continuing in
 * a slightly unknown state. Third-party network code is the realistic source
 * (ssh2's `forwardOut` throws synchronously when its socket dies), and those
 * call sites are individually guarded; this is the backstop for the ones nobody
 * has found yet. Logged loudly rather than swallowed silently.
 */
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception (session kept alive):', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection:', reason)
})

/**
 * One writer per vault.
 *
 * Nothing else prevents a second TermDesk process from opening the same
 * `userData` directory — `open -n`, a Linux/Windows relaunch, or a `npm run dev`
 * build started next to the installed app all do it — and two instances mean two
 * routine schedulers firing the same scheduled runs, two MCP servers racing for
 * the port, and two writers on one SQLite file (including during the startup
 * migration). Headless smoke/probe runs are exempt: they are short-lived,
 * deliberately started alongside a running app, and take no window.
 */
const isHeadlessRun = devEnvFlag('SMOKE') !== undefined || devEnvFlag('VNC_PROBE') !== undefined
const hasInstanceLock = isHeadlessRun || app.requestSingleInstanceLock()
if (!hasInstanceLock) {
  app.quit()
} else if (!isHeadlessRun) {
  // Someone tried to launch a duplicate: surface the window they already have.
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

/**
 * Confirm (native dialog) before handing an https link from terminal output to
 * the system browser — the URL is attacker-controllable, so never open silently.
 */
async function confirmAndOpenExternal(url: string): Promise<void> {
  const display = url.length > 120 ? `${url.slice(0, 120)}…` : url
  const opts: Electron.MessageBoxOptions = {
    type: 'question',
    buttons: ['Cancel', 'Open link'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Open external link?',
    message: 'Open this link from the terminal in your browser?',
    detail: display,
  }
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  const { response } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts)
  if (response === 1) await shell.openExternal(url)
}

app.whenReady().then(() => {
  // The duplicate instance is on its way out — never touch the vault or the
  // scheduler on the way there.
  if (!hasInstanceLock) return

  // Hard security defaults for every webContents, current and future.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    // External links open in the system browser, never inside the app. The only
    // path here is xterm's web-links (window.open) — i.e. links printed by a
    // remote server's terminal output, which is untrusted — so confirm first.
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void confirmAndOpenExternal(url)
      return { action: 'deny' }
    })
  })

  // Deny-by-default; individual permissions get opened up when a feature needs them.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  )

  // Smoke/probe harnesses run BEFORE anything can touch the vault.
  //
  // They each redirect the database to a throwaway temp path so test data can
  // never land in a real vault — a guarantee that silently did not hold while
  // this dispatch sat after `startRoutineScheduler()`, which opens the vault on
  // its first tick and caches the handle. Keep this block first.
  if (devEnvFlag('SMOKE') === 'vault') {
    void runVaultSmokeTest()
    return
  }

  if (devEnvFlag('SMOKE') === 'ssh') {
    void runSshSmokeTest()
    return
  }

  if (devEnvFlag('SMOKE') === 'sftp') {
    void runSftpSmokeTest()
    return
  }

  if (devEnvFlag('SMOKE') === 'vnc') {
    void runVncSmokeTest()
    return
  }

  if (devEnvFlag('SMOKE') === 'mcp') {
    void runMcpSmokeTest()
    return
  }

  const vncProbe = devEnvFlag('VNC_PROBE')
  if (vncProbe) {
    void runVncRa2Probe(vncProbe)
    return
  }

  // Remove plaintext temp copies a previous crashed run left in the temp dir.
  void sweepOrphanedEditDirs()

  registerAppIpc()
  registerHostsIpc()
  registerGroupsIpc()
  registerCredentialsIpc()
  registerSshConfigIpc()
  registerSshIpc()
  registerSnippetsIpc()
  registerPromptsIpc()
  registerRoutinesIpc()
  registerAutomationIpc()
  registerSftpIpc()
  registerVncIpc()
  registerRdpIpc()
  registerLocalTerminalIpc()
  registerLocalTerminalsIpc()
  registerTunnelsIpc()
  registerVncImportIpc()
  registerSettingsIpc()
  registerLogsIpc()
  registerMcpIpc()
  buildMenu()
  startRoutineScheduler()

  // --- Auto-update ---
  // electron-updater checks the GitHub releases feed (see electron-builder.yml);
  // the lifecycle is mirrored to the renderer's in-app banner (see updater.ts).
  registerUpdaterIpc()
  initUpdater()

  if (!ensureEulaAccepted()) {
    return
  }

  createWindow()

  // Start the MCP server only if the user previously enabled it (off by default).
  void syncMcpFromSettings().catch((err) => {
    console.warn('[mcp] failed to start:', err instanceof Error ? err.message : err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  shutdownBridge()
  shutdownRdpProxy()
  stopMcpServer()
  stopRoutineScheduler()
  // Tear these down before sessionManager: they own dedicated SSH connections
  // and temp files that leak on a direct Cmd-Q (the WebContents 'destroyed'
  // teardown doesn't fire when the app quits with a window still open).
  tunnelManager.destroyAll()
  transferManager.cancelAll()
  sftpManager.closeAll()
  closeAllEdits()
  sessionManager.destroyAll()
  localTerminalManager.destroyAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
