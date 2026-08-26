import { IPC, IPC_EVENTS, IPC_SEND, localTermDataChannel, sshDataChannel } from '@shared/channels'
import type {
  ActivityEntry,
  AiAuditEntry,
  AutomationEvent,
  HostKeyPrompt,
  IpcInvokeMap,
  LocalTermExit,
  McpApprovalRequest,
  McpStatus,
  SshSessionEvent,
  Transfer,
  TunnelStatus,
  UpdateState,
} from '@shared/ipc'
import type { RendererApi } from '@shared/types'
import { contextBridge, ipcRenderer, webUtils } from 'electron'

function invoke<C extends keyof IpcInvokeMap>(
  channel: C,
  ...args: IpcInvokeMap[C]['args']
): Promise<IpcInvokeMap[C]['result']> {
  return ipcRenderer.invoke(channel, ...args)
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: RendererApi = {
  getVersions: () => invoke(IPC.appGetVersions),
  detectTerminals: () => invoke(IPC.terminalsDetect),
  detectExternalTerminals: () => invoke(IPC.externalTerminalsDetect),
  detectHarnesses: () => invoke(IPC.harnessesDetect),
  openExternalTerminal: (input) => invoke(IPC.externalTerminalOpen, input),
  hosts: {
    list: () => invoke(IPC.hostsList),
    create: (input) => invoke(IPC.hostsCreate, input),
    duplicate: (id, label, hostname) => invoke(IPC.hostsDuplicate, id, label, hostname),
    update: (id, input) => invoke(IPC.hostsUpdate, id, input),
    remove: (id) => invoke(IPC.hostsDelete, id),
    setGroup: (id, groupId) => invoke(IPC.hostsSetGroup, id, groupId),
    test: (id) => invoke(IPC.hostsTest, id),
  },
  groups: {
    list: () => invoke(IPC.groupsList),
    create: (input) => invoke(IPC.groupsCreate, input),
    update: (id, input) => invoke(IPC.groupsUpdate, id, input),
    remove: (id) => invoke(IPC.groupsDelete, id),
  },
  credentials: {
    list: () => invoke(IPC.credentialsList),
    create: (input) => invoke(IPC.credentialsCreate, input),
    update: (id, input) => invoke(IPC.credentialsUpdate, id, input),
    remove: (id) => invoke(IPC.credentialsDelete, id),
  },
  sshConfig: {
    importFromFile: () => invoke(IPC.sshConfigImport),
    importFromPickedFile: () => invoke(IPC.sshConfigImportFile),
  },
  ssh: {
    connect: (hostId) => invoke(IPC.sshConnect, hostId),
    abortConnect: (hostId) => invoke(IPC.sshAbortConnect, hostId),
    disconnect: (sessionId) => invoke(IPC.sshDisconnect, sessionId),
    write: (sessionId, data) => ipcRenderer.send(IPC_SEND.sshInput, sessionId, data),
    attach: (sessionId) => ipcRenderer.send(IPC_SEND.sshAttach, sessionId),
    resize: (sessionId, cols, rows) => invoke(IPC.sshResize, sessionId, cols, rows),
    onData: (sessionId, cb) => subscribe<Uint8Array>(sshDataChannel(sessionId), cb),
    onEvent: (cb) => subscribe<SshSessionEvent>(IPC_EVENTS.sshEvent, cb),
    onHostKeyPrompt: (cb) => subscribe<HostKeyPrompt>(IPC_EVENTS.sshHostKeyPrompt, cb),
    respondHostKey: (requestId, accept) => invoke(IPC.sshHostKeyRespond, requestId, accept),
  },
  prompts: {
    list: () => invoke(IPC.promptsList),
    create: (input) => invoke(IPC.promptsCreate, input),
    update: (id, input) => invoke(IPC.promptsUpdate, id, input),
    remove: (id) => invoke(IPC.promptsDelete, id),
    reorder: (ids) => invoke(IPC.promptsReorder, ids),
  },
  routines: {
    list: () => invoke(IPC.routinesList),
    create: (input) => invoke(IPC.routinesCreate, input),
    update: (id, input) => invoke(IPC.routinesUpdate, id, input),
    remove: (id) => invoke(IPC.routinesDelete, id),
    recordRun: (input) => invoke(IPC.routinesRecordRun, input),
    listRuns: (routineId) => invoke(IPC.routineRunsList, routineId),
    onTrigger: (cb) => subscribe(IPC_EVENTS.routineTrigger, cb),
  },
  snippets: {
    list: () => invoke(IPC.snippetsList),
    create: (input) => invoke(IPC.snippetsCreate, input),
    update: (id, input) => invoke(IPC.snippetsUpdate, id, input),
    remove: (id) => invoke(IPC.snippetsDelete, id),
  },
  automation: {
    listJobs: () => invoke(IPC.automationJobsList),
    createJob: (input) => invoke(IPC.automationJobCreate, input),
    updateJob: (id, input) => invoke(IPC.automationJobUpdate, id, input),
    deleteJob: (id) => invoke(IPC.automationJobDelete, id),
    run: (input) => invoke(IPC.automationRun, input),
    cancel: (runId) => invoke(IPC.automationCancel, runId),
    onEvent: (cb) => subscribe<AutomationEvent>(IPC_EVENTS.automationEvent, cb),
  },
  logs: {
    list: () => invoke(IPC.logList),
    clear: () => invoke(IPC.logClear),
    onEvent: (cb) => subscribe<ActivityEntry>(IPC_EVENTS.logEvent, cb),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    set: (patch) => invoke(IPC.settingsSet, patch),
  },
  mcp: {
    status: () => invoke(IPC.mcpStatus),
    setEnabled: (enabled) => invoke(IPC.mcpSetEnabled, enabled),
    auditList: () => invoke(IPC.mcpAuditList),
    auditClear: () => invoke(IPC.mcpAuditClear),
    approve: (id, approve) => invoke(IPC.mcpApprove, id, approve),
    onAudit: (cb) => subscribe<AiAuditEntry>(IPC_EVENTS.aiAuditEvent, cb),
    onStatus: (cb) => subscribe<McpStatus>(IPC_EVENTS.mcpStatusEvent, cb),
    onApproval: (cb) =>
      subscribe<{ type: 'request' | 'resolved'; request: McpApprovalRequest }>(
        IPC_EVENTS.mcpApprovalEvent,
        cb,
      ),
  },
  updates: {
    getState: () => invoke(IPC.updatesGetState),
    download: () => invoke(IPC.updatesDownload),
    install: () => invoke(IPC.updatesInstall),
    onEvent: (cb) => subscribe<UpdateState>(IPC_EVENTS.updateEvent, cb),
  },
  vnc: {
    open: (hostId) => invoke(IPC.vncOpen, hostId),
    debugLog: (message) => ipcRenderer.send(IPC_SEND.vncDebugLog, message),
    importConnections: () => invoke(IPC.vncImportFile),
    verifyServerKey: (hostId, publicKeyB64) => invoke(IPC.vncVerifyServerKey, hostId, publicKeyB64),
  },
  rdp: {
    open: (hostId) => invoke(IPC.rdpOpen, hostId),
  },
  localTerm: {
    open: (opts) => invoke(IPC.localTermOpen, opts),
    write: (sessionId, data) => ipcRenderer.send(IPC_SEND.localTermInput, sessionId, data),
    attach: (sessionId) => ipcRenderer.send(IPC_SEND.localTermAttach, sessionId),
    resize: (sessionId, cols, rows) => invoke(IPC.localTermResize, sessionId, cols, rows),
    close: (sessionId) => invoke(IPC.localTermClose, sessionId),
    cwd: (sessionId) => invoke(IPC.localTermCwd, sessionId),
    onData: (sessionId, cb) => subscribe<string>(localTermDataChannel(sessionId), cb),
    onExit: (cb) => subscribe<LocalTermExit>(IPC_EVENTS.localTermExit, cb),
  },
  localTerminals: {
    list: () => invoke(IPC.localTerminalsList),
    create: (input) => invoke(IPC.localTerminalsCreate, input),
    update: (id, input) => invoke(IPC.localTerminalsUpdate, id, input),
    remove: (id) => invoke(IPC.localTerminalsDelete, id),
    reorder: (ids) => invoke(IPC.localTerminalsReorder, ids),
    pickDirectory: () => invoke(IPC.localTerminalsPick),
  },
  tunnels: {
    list: () => invoke(IPC.tunnelsList),
    create: (input) => invoke(IPC.tunnelsCreate, input),
    update: (id, input) => invoke(IPC.tunnelsUpdate, id, input),
    remove: (id) => invoke(IPC.tunnelsDelete, id),
    start: (id) => invoke(IPC.tunnelStart, id),
    stop: (id) => invoke(IPC.tunnelStop, id),
    status: () => invoke(IPC.tunnelStatus),
    onEvent: (cb) => subscribe<TunnelStatus>(IPC_EVENTS.tunnelEvent, cb),
  },
  sftp: {
    open: (hostId) => invoke(IPC.sftpOpen, hostId),
    close: (sftpId) => invoke(IPC.sftpClose, sftpId),
    list: (sftpId, path) => invoke(IPC.sftpList, sftpId, path),
    mkdir: (sftpId, path) => invoke(IPC.sftpMkdir, sftpId, path),
    rename: (sftpId, from, to) => invoke(IPC.sftpRename, sftpId, from, to),
    remove: (sftpId, path) => invoke(IPC.sftpDelete, sftpId, path),
    chmod: (sftpId, path, mode) => invoke(IPC.sftpChmod, sftpId, path, mode),
    download: (sftpId, remotePath) => invoke(IPC.sftpDownload, sftpId, remotePath),
    upload: (sftpId, localPaths, remoteDir) =>
      invoke(IPC.sftpUpload, sftpId, localPaths, remoteDir),
    cancelTransfer: (transferId) => invoke(IPC.sftpTransferCancel, transferId),
    retryTransfer: (transferId) => invoke(IPC.sftpTransferRetry, transferId),
    listTransfers: () => invoke(IPC.sftpTransfersList),
    editOpen: (sftpId, remotePath) => invoke(IPC.sftpEditOpen, sftpId, remotePath),
    onTransfer: (cb) => subscribe<Transfer>(IPC_EVENTS.sftpTransfer, cb),
    getPathForFile: (file) => webUtils.getPathForFile(file),
  },
}

contextBridge.exposeInMainWorld('api', api)
