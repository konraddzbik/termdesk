import type {
  ActivityEntry,
  AiAuditEntry,
  AutomationEvent,
  AutomationJob,
  AutomationJobInput,
  AutomationRunInput,
  Credential,
  CredentialInput,
  DetectedHarness,
  ExternalTerminalInfo,
  ExternalTerminalOpenInput,
  ExternalTerminalOpenResult,
  Group,
  GroupInput,
  Host,
  HostInput,
  HostKeyPrompt,
  HostTestResult,
  LocalTermExit,
  LocalTermOpenOptions,
  LocalTermOpenResult,
  McpApprovalRequest,
  McpStatus,
  Prompt,
  PromptInput,
  RdpOpenResult,
  RecordRunInput,
  Routine,
  RoutineInput,
  RoutineRun,
  SavedLocalTerminal,
  SavedLocalTerminalInput,
  SavedTunnel,
  SavedTunnelInput,
  Settings,
  SettingsPatch,
  SftpEntry,
  SftpOpenResult,
  Snippet,
  SnippetInput,
  SshConfigImportResult,
  SshConnectResult,
  SshSessionEvent,
  TerminalProgramInfo,
  Transfer,
  TunnelStatus,
  UpdateState,
  Versions,
  VncOpenResult,
  VncVerifyResult,
} from './ipc'

/**
 * The API surface exposed to the renderer via contextBridge.
 * The preload implements it; the renderer consumes it as `window.api`.
 */
export interface RendererApi {
  getVersions(): Promise<Versions>
  /** Detected terminal programs (multiplexers/shells) installed on this machine. */
  detectTerminals(): Promise<TerminalProgramInfo[]>
  /** Detected external terminal emulators (Ghostty, Warp, …) installed here. */
  detectExternalTerminals(): Promise<ExternalTerminalInfo[]>
  /** Detected AI harness CLIs (claude, aider, …) installed on this machine. */
  detectHarnesses(): Promise<DetectedHarness[]>
  /** Open a directory in an external terminal emulator (spawned detached). */
  openExternalTerminal(input: ExternalTerminalOpenInput): Promise<ExternalTerminalOpenResult>
  hosts: {
    list(): Promise<Host[]>
    create(input: HostInput): Promise<Host>
    duplicate(id: string, label: string, hostname: string): Promise<Host>
    update(id: string, input: HostInput): Promise<Host>
    remove(id: string): Promise<void>
    setGroup(id: string, groupId: string | null): Promise<Host>
    test(id: string): Promise<HostTestResult>
  }
  groups: {
    list(): Promise<Group[]>
    create(input: GroupInput): Promise<Group>
    update(id: string, input: GroupInput): Promise<Group>
    remove(id: string): Promise<void>
  }
  credentials: {
    list(): Promise<Credential[]>
    create(input: CredentialInput): Promise<Credential>
    update(id: string, input: CredentialInput): Promise<Credential>
    remove(id: string): Promise<void>
  }
  sshConfig: {
    /** Import from the user's default ~/.ssh/config. */
    importFromFile(): Promise<SshConfigImportResult>
    /** Open a file picker and import from the chosen OpenSSH-config-format file. */
    importFromPickedFile(): Promise<SshConfigImportResult>
  }
  ssh: {
    connect(hostId: string): Promise<SshConnectResult>
    /** Cancels an in-flight connect for this host (no-op if nothing is pending). */
    abortConnect(hostId: string): Promise<void>
    disconnect(sessionId: string): Promise<void>
    /** Fire-and-forget keystroke stream renderer→main. */
    write(sessionId: string, data: string): void
    /**
     * Must be called once the onData subscription is in place; main buffers
     * early shell output (MOTD/banner) and flushes it on attach.
     */
    attach(sessionId: string): void
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    /** Subscribe to terminal output for one session. Returns unsubscribe. */
    onData(sessionId: string, cb: (data: Uint8Array) => void): () => void
    /** Subscribe to lifecycle events for all sessions. Returns unsubscribe. */
    onEvent(cb: (event: SshSessionEvent) => void): () => void
    /** Subscribe to host-key approval prompts. Returns unsubscribe. */
    onHostKeyPrompt(cb: (prompt: HostKeyPrompt) => void): () => void
    respondHostKey(requestId: string, accept: boolean): Promise<void>
  }
  prompts: {
    list(): Promise<Prompt[]>
    create(input: PromptInput): Promise<Prompt>
    update(id: string, input: PromptInput): Promise<Prompt>
    remove(id: string): Promise<void>
    reorder(ids: string[]): Promise<Prompt[]>
  }
  routines: {
    list(): Promise<Routine[]>
    create(input: RoutineInput): Promise<Routine>
    update(id: string, input: RoutineInput): Promise<Routine>
    remove(id: string): Promise<void>
    recordRun(input: RecordRunInput): Promise<RoutineRun>
    listRuns(routineId: string): Promise<RoutineRun[]>
    /** Fires when the scheduler wants this routine run. Returns unsubscribe. */
    onTrigger(cb: (routine: Routine) => void): () => void
  }
  snippets: {
    list(): Promise<Snippet[]>
    create(input: SnippetInput): Promise<Snippet>
    update(id: string, input: SnippetInput): Promise<Snippet>
    remove(id: string): Promise<void>
  }
  automation: {
    listJobs(): Promise<AutomationJob[]>
    createJob(input: AutomationJobInput): Promise<AutomationJob>
    updateJob(id: string, input: AutomationJobInput): Promise<AutomationJob>
    deleteJob(id: string): Promise<void>
    /** Starts a run; returns the runId. Progress arrives via `onEvent`. */
    run(input: AutomationRunInput): Promise<string>
    cancel(runId: string): Promise<void>
    onEvent(cb: (event: AutomationEvent) => void): () => void
  }
  logs: {
    list(): Promise<ActivityEntry[]>
    clear(): Promise<void>
    onEvent(cb: (entry: ActivityEntry) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: SettingsPatch): Promise<Settings>
  }
  mcp: {
    /** Current MCP server status (enabled, running, connection URL + token). */
    status(): Promise<McpStatus>
    /** Enable/disable the MCP server; resolves with the new status. */
    setEnabled(enabled: boolean): Promise<McpStatus>
    /** The AI activity audit log (agent decisions + actions). */
    auditList(): Promise<AiAuditEntry[]>
    /** Clear the AI activity log. */
    auditClear(): Promise<void>
    /** Resolve a pending agent-action approval. */
    approve(id: string, approve: boolean): Promise<void>
    /** Live AI-audit rows as agents act. */
    onAudit(cb: (entry: AiAuditEntry) => void): () => void
    /** MCP server status changes (enabled/running/token rotation). */
    onStatus(cb: (status: McpStatus) => void): () => void
    /** Agent actions awaiting approval (or withdrawn). */
    onApproval(
      cb: (ev: { type: 'request' | 'resolved'; request: McpApprovalRequest }) => void,
    ): () => void
  }
  updates: {
    /** Current update state (for a freshly-mounted renderer). */
    getState(): Promise<UpdateState>
    /** Start downloading an available update (or open the download page on unsigned macOS). */
    download(): Promise<void>
    /** Restart into the downloaded update (or open the download page on unsigned macOS). */
    install(): Promise<void>
    /** Update lifecycle changes (available → downloading → downloaded / error). */
    onEvent(cb: (state: UpdateState) => void): () => void
  }
  vnc: {
    /**
     * Provisions a one-shot local WebSocket bridge to the host's VNC server
     * (through the SSH tunnel by default). Each call returns a fresh
     * single-use token URL; call again for every (re)connect attempt.
     */
    open(hostId: string): Promise<VncOpenResult>
    /** Forwards a VNC viewer diagnostic line into the main-process debug log. */
    debugLog(message: string): void
    /** Open a file picker and import VNC Viewer `.vnc` connection files as hosts. */
    importConnections(): Promise<SshConfigImportResult>
    /**
     * Verify a RealVNC RA2 server public key (base64) against the trust-on-
     * first-use pin store before approving it. Resolves `{ ok: false }` with a
     * reason when the pinned key changed (possible MITM).
     */
    verifyServerKey(hostId: string, publicKeyB64: string): Promise<VncVerifyResult>
  }
  rdp: {
    /**
     * Provisions a one-time in-process RDCleanPath proxy to the host's RDP
     * server and returns the ws:// URL + logon material for the IronRDP WASM
     * client. Call again for every (re)connect attempt.
     */
    open(hostId: string): Promise<RdpOpenResult>
  }
  localTerm: {
    /** Spawns a local-machine shell PTY (optionally in `cwd`); returns id + shell. */
    open(opts?: LocalTermOpenOptions): Promise<LocalTermOpenResult>
    write(sessionId: string, data: string): void
    attach(sessionId: string): void
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    close(sessionId: string): Promise<void>
    /** Best-effort current working directory of the shell (null if unknown). */
    cwd(sessionId: string): Promise<string | null>
    onData(sessionId: string, cb: (data: string) => void): () => void
    onExit(cb: (event: LocalTermExit) => void): () => void
  }
  localTerminals: {
    list(): Promise<SavedLocalTerminal[]>
    create(input: SavedLocalTerminalInput): Promise<SavedLocalTerminal>
    update(id: string, input: SavedLocalTerminalInput): Promise<SavedLocalTerminal>
    remove(id: string): Promise<void>
    /** Persist a new sidebar order (top→bottom); returns the reordered list. */
    reorder(ids: string[]): Promise<SavedLocalTerminal[]>
    /** Native folder picker for Browse…; null if cancelled. */
    pickDirectory(): Promise<string | null>
  }
  tunnels: {
    list(): Promise<SavedTunnel[]>
    create(input: SavedTunnelInput): Promise<SavedTunnel>
    update(id: string, input: SavedTunnelInput): Promise<SavedTunnel>
    remove(id: string): Promise<void>
    /** Start a saved tunnel; resolves with its runtime status. */
    start(id: string): Promise<TunnelStatus>
    stop(id: string): Promise<void>
    /** Runtime status of all running tunnels for this window. */
    status(): Promise<TunnelStatus[]>
    /** Live per-tunnel status updates (running/error/throughput). */
    onEvent(cb: (status: TunnelStatus) => void): () => void
  }
  sftp: {
    /** Opens an SFTP browser session for a vault host (reuses a live SSH connection when possible). */
    open(hostId: string): Promise<SftpOpenResult>
    close(sftpId: string): Promise<void>
    list(sftpId: string, path: string): Promise<SftpEntry[]>
    mkdir(sftpId: string, path: string): Promise<void>
    rename(sftpId: string, from: string, to: string): Promise<void>
    /** Deletes a file, or a directory recursively. */
    remove(sftpId: string, path: string): Promise<void>
    chmod(sftpId: string, path: string, mode: number): Promise<void>
    /** Prompts for a save location in main; resolves to a transfer id, or null if cancelled. */
    download(sftpId: string, remotePath: string): Promise<string | null>
    /** Uploads files and/or directories (recursively); resolves to created transfer ids. */
    upload(sftpId: string, localPaths: string[], remoteDir: string): Promise<string[]>
    cancelTransfer(transferId: string): Promise<void>
    retryTransfer(transferId: string): Promise<void>
    listTransfers(): Promise<Transfer[]>
    /** Downloads to a temp file, opens it in the OS editor and auto-uploads on save. */
    editOpen(sftpId: string, remotePath: string): Promise<void>
    /** Subscribe to transfer progress/state events. Returns unsubscribe. */
    onTransfer(cb: (transfer: Transfer) => void): () => void
    /** Resolves the absolute filesystem path of a dropped File (drag & drop). */
    getPathForFile(file: File): string
  }
}
