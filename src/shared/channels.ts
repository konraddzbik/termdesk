/**
 * IPC channel names. Every renderer↔main exchange goes through a channel
 * declared here so both sides share one source of truth.
 *
 * This module must stay free of runtime dependencies (no zod) — it is
 * bundled into the sandboxed preload, which cannot load external modules.
 */
export const IPC = {
  appGetVersions: 'app:get-versions',
  /** Detect which terminal programs (multiplexers/shells) are installed locally. */
  terminalsDetect: 'app:terminals-detect',
  /** Detect which external terminal emulators (Ghostty, Warp, …) are installed. */
  externalTerminalsDetect: 'app:external-terminals-detect',
  /** Open a directory in an external terminal emulator. */
  externalTerminalOpen: 'app:external-terminal-open',
  hostsList: 'hosts:list',
  hostsCreate: 'hosts:create',
  hostsDuplicate: 'hosts:duplicate',
  hostsUpdate: 'hosts:update',
  hostsDelete: 'hosts:delete',
  hostsSetGroup: 'hosts:set-group',
  hostsTest: 'hosts:test',
  groupsList: 'groups:list',
  groupsCreate: 'groups:create',
  groupsUpdate: 'groups:update',
  groupsDelete: 'groups:delete',
  credentialsList: 'credentials:list',
  credentialsCreate: 'credentials:create',
  credentialsUpdate: 'credentials:update',
  credentialsDelete: 'credentials:delete',
  sshConfigImport: 'ssh-config:import',
  sshConfigImportFile: 'ssh-config:import-file',
  sshConnect: 'ssh:connect',
  sshAbortConnect: 'ssh:abort-connect',
  sshDisconnect: 'ssh:disconnect',
  sshResize: 'ssh:resize',
  sshHostKeyRespond: 'ssh:hostkey-respond',
  snippetsList: 'snippets:list',
  snippetsCreate: 'snippets:create',
  snippetsUpdate: 'snippets:update',
  snippetsDelete: 'snippets:delete',
  promptsList: 'prompts:list',
  promptsCreate: 'prompts:create',
  promptsUpdate: 'prompts:update',
  promptsDelete: 'prompts:delete',
  promptsReorder: 'prompts:reorder',
  harnessesDetect: 'harnesses:detect',
  routinesList: 'routines:list',
  routinesCreate: 'routines:create',
  routinesUpdate: 'routines:update',
  routinesDelete: 'routines:delete',
  routinesRecordRun: 'routines:record-run',
  routineRunsList: 'routines:runs-list',
  automationJobsList: 'automation:jobs-list',
  automationJobCreate: 'automation:job-create',
  automationJobUpdate: 'automation:job-update',
  automationJobDelete: 'automation:job-delete',
  automationRun: 'automation:run',
  automationCancel: 'automation:cancel',
  logList: 'log:list',
  logClear: 'log:clear',
  sftpOpen: 'sftp:open',
  sftpClose: 'sftp:close',
  sftpList: 'sftp:list',
  sftpMkdir: 'sftp:mkdir',
  sftpRename: 'sftp:rename',
  sftpDelete: 'sftp:delete',
  sftpChmod: 'sftp:chmod',
  sftpDownload: 'sftp:download',
  sftpUpload: 'sftp:upload',
  sftpTransferCancel: 'sftp:transfer-cancel',
  sftpTransferRetry: 'sftp:transfer-retry',
  sftpTransfersList: 'sftp:transfers-list',
  sftpEditOpen: 'sftp:edit-open',
  vncOpen: 'vnc:open',
  vncImportFile: 'vnc:import-file',
  /** Verify a VNC server's RA2 public key against the trust-on-first-use pin store. */
  vncVerifyServerKey: 'vnc:verify-server-key',
  rdpOpen: 'rdp:open',
  localTermOpen: 'local-term:open',
  localTermResize: 'local-term:resize',
  localTermClose: 'local-term:close',
  localTermCwd: 'local-term:cwd',
  localTerminalsList: 'local-terminals:list',
  localTerminalsCreate: 'local-terminals:create',
  localTerminalsUpdate: 'local-terminals:update',
  localTerminalsDelete: 'local-terminals:delete',
  localTerminalsReorder: 'local-terminals:reorder',
  localTerminalsPick: 'local-terminals:pick-directory',
  // SSH tunnels / port forwards
  tunnelsList: 'tunnels:list',
  tunnelsCreate: 'tunnels:create',
  tunnelsUpdate: 'tunnels:update',
  tunnelsDelete: 'tunnels:delete',
  tunnelStart: 'tunnels:start',
  tunnelStop: 'tunnels:stop',
  tunnelStatus: 'tunnels:status',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  // App auto-update (electron-updater)
  updatesGetState: 'updates:get-state',
  updatesDownload: 'updates:download',
  updatesInstall: 'updates:install',
  // MCP / AI agent integration
  mcpStatus: 'mcp:status',
  mcpSetEnabled: 'mcp:set-enabled',
  mcpAuditList: 'mcp:audit-list',
  mcpAuditClear: 'mcp:audit-clear',
  /** Resolve a pending agent-action approval: { id, approve }. */
  mcpApprove: 'mcp:approve',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** One-way renderer→main channels (ipcRenderer.send, no response). */
export const IPC_SEND = {
  sshInput: 'ssh:input',
  /** Renderer signals its terminal is subscribed; main flushes buffered output. */
  sshAttach: 'ssh:attach',
  /** Renderer forwards VNC viewer events into the main-process VNC debug log. */
  vncDebugLog: 'vnc:debug-log',
  /** Local terminal keystroke stream. */
  localTermInput: 'local-term:input',
  /** Renderer signals its local terminal is subscribed; main flushes buffered output. */
  localTermAttach: 'local-term:attach',
} as const

/** Main→renderer event channels (webContents.send). */
export const IPC_EVENTS = {
  sshEvent: 'ssh:event',
  sshHostKeyPrompt: 'ssh:hostkey-prompt',
  automationEvent: 'automation:event',
  logEvent: 'log:event',
  sftpTransfer: 'sftp:transfer',
  localTermExit: 'local-term:exit',
  /** Live tunnel status (running/error/throughput). */
  tunnelEvent: 'tunnels:event',
  /** New AI-audit row appended (live AI activity stream). */
  aiAuditEvent: 'mcp:audit-event',
  /** MCP server status changed (enabled/running/token). */
  mcpStatusEvent: 'mcp:status-event',
  /** An agent action needs user approval (or was withdrawn). */
  mcpApprovalEvent: 'mcp:approval-event',
  /** App update lifecycle (available / downloading / downloaded / error). */
  updateEvent: 'updates:event',
  /** A scheduled routine is due — the renderer should run it. */
  routineTrigger: 'routines:trigger',
} as const

/** Per-session terminal output stream channel name. */
export function sshDataChannel(sessionId: string): string {
  return `ssh:data:${sessionId}`
}

/** Per-session local terminal output stream channel name. */
export function localTermDataChannel(sessionId: string): string {
  return `local-term:data:${sessionId}`
}
