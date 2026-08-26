import { z } from 'zod'
import { IPC } from './channels'

export { IPC, type IpcChannel } from './channels'

export const versionsSchema = z.object({
  app: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
})

export type Versions = z.infer<typeof versionsSchema>

// ---------------------------------------------------------------------------
// Hosts & groups (vault)
// ---------------------------------------------------------------------------

export const authTypeSchema = z.enum(['password', 'key', 'agent'])
export type AuthType = z.infer<typeof authTypeSchema>

export const vncModeSchema = z.enum(['tunnel', 'direct'])
export type VncMode = z.infer<typeof vncModeSchema>

/** RDP reachability: `direct` TCP, or `tunnel` over SSH (needs SSH credentials). */
export const rdpModeSchema = z.enum(['tunnel', 'direct'])
export type RdpMode = z.infer<typeof rdpModeSchema>

export const hostKindSchema = z.enum(['ssh', 'vnc', 'rdp', 'both'])
export type HostKind = z.infer<typeof hostKindSchema>

/** Host record as exposed to the renderer. Never carries secret material. */
export const hostSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  hostname: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string(),
  authType: authTypeSchema,
  keyPath: z.string().nullable(),
  /** Jump host chain, OpenSSH ProxyJump syntax: `user@jump1:port,jump2`. */
  proxyJump: z.string().nullable(),
  /**
   * Default remote directory. When set, SFTP opens here (instead of the login
   * home) and a terminal session `cd`s here on connect. Null → server default.
   */
  defaultPath: z.string().nullable(),
  groupId: z.string().nullable(),
  /** When set, the referenced credential supplies username/auth at connect time. */
  credentialId: z.string().nullable(),
  tags: z.array(z.string()),
  color: z.string().nullable(),
  kind: hostKindSchema,
  /** VNC server port on the remote (null → default 5900). */
  vncPort: z.number().int().min(1).max(65535).nullable(),
  /** `tunnel` (default, via SSH) or `direct` TCP. */
  vncMode: vncModeSchema,
  /** RDP server port on the remote (null → default 3389). */
  rdpPort: z.number().int().min(1).max(65535).nullable(),
  /** `direct` (default) or `tunnel` over SSH. */
  rdpMode: rdpModeSchema,
  /** Optional Windows/AD logon domain for RDP (e.g. `CORP`). */
  domain: z.string().nullable(),
  hasPassword: z.boolean(),
  hasPassphrase: z.boolean(),
  hasVncPassword: z.boolean(),
  hasRdpPassword: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Host = z.infer<typeof hostSchema>

/**
 * Create/update payload. `password`/`passphrase` are plaintext only while in
 * transit renderer→main; main encrypts them with safeStorage immediately and
 * they are never persisted or sent back. Omitting them keeps the stored
 * secret; `clearPassword`/`clearPassphrase` remove it.
 */
export const hostInputSchema = z
  .object({
    label: z.string().min(1),
    hostname: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().optional().default(''),
    authType: authTypeSchema,
    keyPath: z.string().nullable().optional(),
    proxyJump: z.string().nullable().optional(),
    defaultPath: z.string().nullable().optional(),
    groupId: z.string().nullable().optional(),
    credentialId: z.string().nullable().optional(),
    tags: z.array(z.string()).default([]),
    color: z.string().nullable().optional(),
    kind: hostKindSchema.default('ssh'),
    vncPort: z.number().int().min(1).max(65535).nullable().optional(),
    vncMode: vncModeSchema.default('tunnel'),
    rdpPort: z.number().int().min(1).max(65535).nullable().optional(),
    rdpMode: rdpModeSchema.default('direct'),
    domain: z.string().nullable().optional(),
    password: z.string().optional(),
    passphrase: z.string().optional(),
    vncPassword: z.string().optional(),
    rdpPassword: z.string().optional(),
    clearPassword: z.boolean().optional(),
    clearPassphrase: z.boolean().optional(),
    clearVncPassword: z.boolean().optional(),
    clearRdpPassword: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    // A username is required for any host with an SSH capability — unless it
    // borrows one from a shared credential, or it is a pure-VNC host.
    if (value.kind !== 'vnc' && value.credentialId == null && value.username.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['username'],
        message: 'Username is required for SSH hosts',
      })
    }
    // A VNC-only host has no SSH credentials, so it cannot tunnel — an
    // invalid-by-construction config the connect path would reject at runtime.
    if (value.kind === 'vnc' && value.vncMode === 'tunnel') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vncMode'],
        message: 'VNC-only hosts must use direct mode (tunnel requires SSH credentials)',
      })
    }
    // Same reasoning for RDP: a pure-RDP host has no SSH credentials to tunnel over.
    if (value.kind === 'rdp' && value.rdpMode === 'tunnel') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rdpMode'],
        message: 'RDP hosts must use direct mode (tunnel requires SSH credentials)',
      })
    }
  })
export type HostInput = z.input<typeof hostInputSchema>

/** Credential kind: an SSH identity, or a shared VNC password. */
export const credentialTypeSchema = z.enum(['ssh', 'vnc'])
export type CredentialType = z.infer<typeof credentialTypeSchema>

/**
 * Reusable credential ("Keychain" entry) as exposed to the renderer. Like Host,
 * it never carries secret material — only derived booleans. A 'vnc' credential
 * holds a RealVNC-style username + password pair (hasPassword carries the secret;
 * username is stored for VNC type; SSH-only fields are blanked).
 */
export const credentialSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  type: credentialTypeSchema,
  username: z.string(),
  authType: authTypeSchema,
  keyPath: z.string().nullable(),
  hasPassword: z.boolean(),
  hasPassphrase: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Credential = z.infer<typeof credentialSchema>

/** Create/update payload for a credential. Same secret semantics as hostInputSchema. */
export const credentialInputSchema = z.object({
  label: z.string().min(1),
  type: credentialTypeSchema.default('ssh'),
  // Optional: a credential may be "just a secret" (e.g. a shared password); the
  // host that uses it supplies the username. When set, it overrides the host's.
  username: z.string().optional().default(''),
  // For a 'vnc' credential the authType is a benign placeholder; the VNC password
  // travels in the `password` field.
  authType: authTypeSchema.default('password'),
  keyPath: z.string().nullable().optional(),
  password: z.string().optional(),
  passphrase: z.string().optional(),
  clearPassword: z.boolean().optional(),
  clearPassphrase: z.boolean().optional(),
})
export type CredentialInput = z.input<typeof credentialInputSchema>

export const groupSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  color: z.string().nullable(),
  /** Parent group id for nesting (subgroups); null = top-level. */
  parentId: z.string().nullable(),
  sortOrder: z.number().int(),
})
export type Group = z.infer<typeof groupSchema>

export const groupInputSchema = z.object({
  name: z.string().min(1),
  color: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
})
export type GroupInput = z.input<typeof groupInputSchema>

export const hostTestResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
})
export type HostTestResult = z.infer<typeof hostTestResultSchema>

export const sshConfigImportResultSchema = z.object({
  imported: z.number().int(),
  skipped: z.number().int(),
  hosts: z.array(hostSchema),
  /** True when the user dismissed the file picker without choosing a file. */
  canceled: z.boolean().optional(),
  /**
   * Number of config files read (root + every resolved `Include`). Present on
   * successful imports; lets the UI note when includes were followed.
   */
  filesRead: z.number().int().optional(),
})
export type SshConfigImportResult = z.infer<typeof sshConfigImportResultSchema>

// ---------------------------------------------------------------------------
// SSH sessions & snippets
// ---------------------------------------------------------------------------

export const sshConnectResultSchema = z.object({
  sessionId: z.string(),
})
export type SshConnectResult = z.infer<typeof sshConnectResultSchema>

export const sshSessionEventSchema = z.object({
  sessionId: z.string(),
  type: z.enum(['connecting', 'connected', 'disconnected', 'error', 'hostkey-mismatch']),
  message: z.string().optional(),
})
export type SshSessionEvent = z.infer<typeof sshSessionEventSchema>

/** Result of opening a local-machine shell PTY. */
export const localTermOpenResultSchema = z.object({
  sessionId: z.string(),
  /** Basename of the spawned shell (e.g. "zsh"). */
  shell: z.string(),
})
export type LocalTermOpenResult = z.infer<typeof localTermOpenResultSchema>

/** Emitted when a local terminal's shell process exits. */
export const localTermExitSchema = z.object({
  sessionId: z.string(),
  exitCode: z.number(),
})
export type LocalTermExit = z.infer<typeof localTermExitSchema>

/** Options for spawning a local terminal (cwd optional → home). */
export interface LocalTermOpenOptions {
  cwd?: string
}

/** A saved local-terminal working directory, shown in the sidebar like a host. */
export const savedLocalTerminalSchema = z.object({
  id: z.string(),
  /** Custom label; null → derive from the path's last two segments. */
  name: z.string().nullable(),
  path: z.string().min(1),
  sortOrder: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type SavedLocalTerminal = z.infer<typeof savedLocalTerminalSchema>

export const savedLocalTerminalInputSchema = z.object({
  name: z.string().nullable().optional(),
  path: z.string().min(1),
  sortOrder: z.number().int().optional(),
})
export type SavedLocalTerminalInput = z.input<typeof savedLocalTerminalInputSchema>

// ---------------------------------------------------------------------------
// SSH tunnels / port forwards
// ---------------------------------------------------------------------------

/** `local` = -L (local port → remote host:port); `dynamic` = -D SOCKS5 proxy. */
export const tunnelTypeSchema = z.enum(['local', 'dynamic'])
export type TunnelType = z.infer<typeof tunnelTypeSchema>

export const savedTunnelSchema = z.object({
  id: z.string(),
  hostId: z.string(),
  type: tunnelTypeSchema,
  listenHost: z.string().min(1),
  listenPort: z.number().int().min(1).max(65535),
  /** Destination for local forwards; null for dynamic (SOCKS picks per-connection). */
  dstHost: z.string().nullable(),
  dstPort: z.number().int().min(1).max(65535).nullable(),
  name: z.string().nullable(),
  /** Start automatically when the host has a live connection. */
  autoStart: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type SavedTunnel = z.infer<typeof savedTunnelSchema>

/**
 * True for bind addresses that keep a forward private to this machine.
 * Anything else (0.0.0.0, ::, a LAN IP) exposes the forwarded port to the
 * network and must be explicitly confirmed. Shared so the UI can warn too.
 */
export function isLoopbackListenHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  if (h === 'localhost' || h === '::1') return true
  // Must be a literal IPv4 address in 127.0.0.0/8 — NOT merely a string
  // starting with "127.". A hostname like `127.corp.example.com` passed the old
  // prefix check, skipped the LAN-exposure confirmation, and then resolved via
  // DNS to whatever address its A record names, binding the forward there.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const octets = m.slice(1).map(Number)
  if (octets.some((o) => o > 255)) return false
  return octets[0] === 127
}

export const savedTunnelInputSchema = z
  .object({
    hostId: z.string().min(1),
    type: tunnelTypeSchema.default('local'),
    listenHost: z.string().min(1).default('127.0.0.1'),
    listenPort: z.number().int().min(1).max(65535),
    dstHost: z.string().nullable().optional(),
    dstPort: z.number().int().min(1).max(65535).nullable().optional(),
    name: z.string().nullable().optional(),
    autoStart: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    /** Must be explicitly true to bind a non-loopback `listenHost` (LAN exposure). */
    exposeToLan: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    // Local forwards need a destination; dynamic (SOCKS) chooses it per-connection.
    if (v.type === 'local') {
      if (!v.dstHost || v.dstHost.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dstHost'],
          message: 'Destination host is required for a local forward',
        })
      }
      if (v.dstPort == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dstPort'],
          message: 'Destination port is required for a local forward',
        })
      }
    }
    // Guard against silently binding a forward to a non-loopback address.
    if (v.listenHost && !isLoopbackListenHost(v.listenHost) && v.exposeToLan !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['listenHost'],
        message:
          'Binding to a non-loopback address exposes this forward to your network. Enable "Expose on the network" to confirm.',
      })
    }
  })
export type SavedTunnelInput = z.input<typeof savedTunnelInputSchema>

/** Live runtime status of a tunnel (broadcast on the tunnelEvent channel). */
export const tunnelStatusSchema = z.object({
  /** The saved tunnel's id. */
  savedId: z.string(),
  running: z.boolean(),
  /** Set when the listener failed to start (e.g. port in use) or the tunnel stopped on error. */
  error: z.string().nullable(),
  /** Bytes relayed since the tunnel started. */
  bytesUp: z.number(),
  bytesDown: z.number(),
  /** Currently-open relayed connections. */
  connections: z.number(),
})
export type TunnelStatus = z.infer<typeof tunnelStatusSchema>

/** Sent by main when an unknown host key needs user approval. */
export const hostKeyPromptSchema = z.object({
  requestId: z.string(),
  hostId: z.string(),
  host: z.string(),
  port: z.number().int(),
  keyType: z.string(),
  /** SHA256 fingerprint, base64, in the OpenSSH `SHA256:…` presentation. */
  fingerprint: z.string(),
  /**
   * True when this endpoint is ALREADY known (has other trusted keys) but
   * presented a key/type we've never trusted here — a possible MITM downgrade,
   * not a genuine first contact. The dialog shows a loud warning in this case.
   */
  previouslyKnown: z.boolean().default(false),
})
export type HostKeyPrompt = z.infer<typeof hostKeyPromptSchema>

export const snippetSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  command: z.string().min(1),
  sortOrder: z.number().int(),
})
export type Snippet = z.infer<typeof snippetSchema>

export const snippetInputSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  sortOrder: z.number().int().optional(),
})
export type SnippetInput = z.input<typeof snippetInputSchema>

/** A Prompt Book entry: a reusable, `{{variable}}`-templated prompt. */
export const promptSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  body: z.string().min(1),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  defaultHarnessId: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Prompt = z.infer<typeof promptSchema>

export const promptInputSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  defaultHarnessId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
})
export type PromptInput = z.input<typeof promptInputSchema>

/** An AI harness (agent CLI) and whether its binary is installed on this machine. */
export const detectedHarnessSchema = z.object({
  id: z.string(),
  label: z.string(),
  available: z.boolean(),
})
export type DetectedHarness = z.infer<typeof detectedHarnessSchema>

/**
 * When a routine runs. `manual` = only on demand; `interval` = every N minutes;
 * `daily` = at a local HH:MM; `cron` = a 5-field cron subset (evaluated in M4).
 */
export const routineScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }),
  z.object({ kind: z.literal('interval'), everyMinutes: z.number().int().min(1) }),
  z.object({
    kind: z.literal('daily'),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({ kind: z.literal('cron'), expr: z.string().min(1) }),
])
export type RoutineSchedule = z.infer<typeof routineScheduleSchema>

export const routineModeSchema = z.enum(['interactive', 'headless'])
export type RoutineMode = z.infer<typeof routineModeSchema>

export const routineSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  promptId: z.string(),
  harnessId: z.string(),
  cwd: z.string().min(1),
  mode: routineModeSchema,
  autonomy: z.boolean(),
  schedule: routineScheduleSchema,
  /** Preset variable values for the prompt (scheduled runs can't prompt). */
  variables: z.record(z.string(), z.string()),
  enabled: z.boolean(),
  lastRunAt: z.number().nullable(),
  nextRunAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Routine = z.infer<typeof routineSchema>

export const routineInputSchema = z.object({
  name: z.string().min(1),
  promptId: z.string().min(1),
  harnessId: z.string().min(1),
  cwd: z.string().min(1),
  mode: routineModeSchema.default('interactive'),
  autonomy: z.boolean().default(false),
  schedule: routineScheduleSchema.default({ kind: 'manual' }),
  variables: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
})
export type RoutineInput = z.input<typeof routineInputSchema>

export const routineRunStatusSchema = z.enum(['running', 'launched', 'ok', 'error', 'canceled'])
export type RoutineRunStatus = z.infer<typeof routineRunStatusSchema>

export const routineRunSchema = z.object({
  id: z.string(),
  routineId: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  status: routineRunStatusSchema,
  exitCode: z.number().nullable(),
  summary: z.string().nullable(),
  outBytes: z.number().nullable(),
})
export type RoutineRun = z.infer<typeof routineRunSchema>

/**
 * Payload to record a routine execution. `command` is the raw composed command;
 * the main process redacts it before storing it as the run summary (secrets in
 * the command are never persisted). Also bumps the routine's `lastRunAt`.
 */
export const recordRunInputSchema = z.object({
  routineId: z.string().min(1),
  status: routineRunStatusSchema,
  command: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
})
export type RecordRunInput = z.input<typeof recordRunInputSchema>

// ---------------------------------------------------------------------------
// Automation (run a snippet/command across multiple SSH hosts)
// ---------------------------------------------------------------------------

/** A saved automation job: a named host set + the command/script to run. */
export const automationJobSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  command: z.string().min(1),
  /** Optional snippet this job was created from (provenance only). */
  snippetId: z.string().nullable(),
  hostIds: z.array(z.string()),
  sortOrder: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type AutomationJob = z.infer<typeof automationJobSchema>

export const automationJobInputSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  snippetId: z.string().nullable().optional(),
  hostIds: z.array(z.string()),
  sortOrder: z.number().int().optional(),
})
export type AutomationJobInput = z.input<typeof automationJobInputSchema>

/** Ad-hoc (or job-derived) run request: run `command` on each of `hostIds`. */
export const automationRunInputSchema = z.object({
  command: z.string().min(1),
  hostIds: z.array(z.string()).min(1),
})
export type AutomationRunInput = z.input<typeof automationRunInputSchema>

/**
 * Streamed run progress, main → renderer. One run (`runId`) fans out across
 * hosts; every event is tagged with the `hostId` it belongs to.
 */
export const automationEventSchema = z.object({
  runId: z.string(),
  hostId: z.string(),
  type: z.enum(['started', 'stdout', 'stderr', 'exit', 'error']),
  /** Output chunk for 'stdout'/'stderr'. */
  chunk: z.string().optional(),
  /** Process exit code for 'exit' (null when killed by a signal). */
  exitCode: z.number().nullable().optional(),
  /** Sanitized failure message for 'error'. */
  message: z.string().optional(),
})
export type AutomationEvent = z.infer<typeof automationEventSchema>

// ---------------------------------------------------------------------------
// Activity log (a local, per-host timeline of what the app did)
// ---------------------------------------------------------------------------

export const activityActionSchema = z.enum([
  'connected',
  'disconnected',
  'failed',
  'sftp-open',
  'vnc-open',
  'rdp-open',
  'automation',
  'tunnel-open',
  'tunnel-close',
])
export type ActivityAction = z.infer<typeof activityActionSchema>

export const activityKindSchema = z.enum(['ssh', 'sftp', 'vnc', 'rdp', 'automation', 'tunnel'])
export type ActivityKind = z.infer<typeof activityKindSchema>

export const activityEntrySchema = z.object({
  id: z.string(),
  /** Epoch milliseconds. */
  ts: z.number(),
  action: activityActionSchema,
  kind: activityKindSchema,
  /** Null when the host was later deleted (label is a snapshot). */
  hostId: z.string().nullable(),
  hostLabel: z.string(),
  /** e.g. "ssh · web, prod". */
  hostSubtitle: z.string().nullable(),
  /** Error message, command summary, or host count. */
  detail: z.string().nullable(),
  /** OS user at the time. */
  user: z.string().nullable(),
  /** Friendly device label (this machine). */
  device: z.string().nullable(),
})
export type ActivityEntry = z.infer<typeof activityEntrySchema>

// ---------------------------------------------------------------------------
// AI / MCP audit + control
// ---------------------------------------------------------------------------

export const aiVerdictSchema = z.enum(['allow', 'needs-approval', 'deny'])
export type AiVerdict = z.infer<typeof aiVerdictSchema>

export const aiOutcomeSchema = z.enum(['ok', 'auto', 'approved', 'denied', 'error'])
export type AiOutcome = z.infer<typeof aiOutcomeSchema>

/** One row of the user-visible AI activity log (an MCP agent tool call). */
export const aiAuditEntrySchema = z.object({
  id: z.string(),
  ts: z.number(),
  client: z.string().nullable(),
  tool: z.string(),
  hostId: z.string().nullable(),
  hostLabel: z.string().nullable(),
  summary: z.string(),
  verdict: aiVerdictSchema,
  outcome: aiOutcomeSchema,
  detail: z.string().nullable(),
  durationMs: z.number().nullable(),
  /** Bytes of command/args relayed in; basis for the (approximate) usage estimate. */
  inBytes: z.number().nullable().default(null),
  /** Bytes of output captured/returned; basis for the (approximate) usage estimate. */
  outBytes: z.number().nullable().default(null),
})
export type AiAuditEntry = z.infer<typeof aiAuditEntrySchema>

/** Runtime status of the MCP server, surfaced in Settings + status indicator. */
export const mcpStatusSchema = z.object({
  enabled: z.boolean(),
  running: z.boolean(),
  /** Connection URL for an MCP client, when running. */
  url: z.string().nullable(),
  /** Bearer token to authenticate, when running. Shown to the user to copy. */
  token: z.string().nullable(),
  approvalMode: z.enum(['always', 'allowlist']),
})
export type McpStatus = z.infer<typeof mcpStatusSchema>

// ---------------------------------------------------------------------------
// App auto-update
// ---------------------------------------------------------------------------

/**
 * In-app update state, mirrored from the main-process electron-updater into the
 * renderer so it can show a VS Code-style banner instead of an OS dialog.
 */
export const updateStateSchema = z.object({
  status: z.enum(['idle', 'checking', 'available', 'downloading', 'downloaded', 'error']),
  /** The available/downloaded version, when known. */
  version: z.string().optional(),
  /** Download progress 0–100 while `downloading`. */
  percent: z.number().min(0).max(100).optional(),
  /**
   * Whether this platform/build can install an update in place. False for
   * unsigned macOS, where the banner offers the download page instead.
   */
  canSelfUpdate: z.boolean(),
})
export type UpdateState = z.infer<typeof updateStateSchema>

/** A pending agent action awaiting the user's approval. */
export const mcpApprovalRequestSchema = z.object({
  id: z.string(),
  client: z.string().nullable(),
  tool: z.string(),
  hostLabel: z.string().nullable(),
  /** Redacted command / action summary shown in the approval dialog. */
  summary: z.string(),
})
export type McpApprovalRequest = z.infer<typeof mcpApprovalRequestSchema>

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Built-in terminal color schemes. `default` is the app's zinc palette. */
export const terminalColorSchemeSchema = z
  .enum(['default', 'dracula', 'solarized-dark', 'gruvbox-dark', 'one-dark', 'nord'])
  .default('default')
export type TerminalColorScheme = z.infer<typeof terminalColorSchemeSchema>

/**
 * Terminal-program ids the user can choose from. `default` = the login shell
 * (no wrapper); the rest are multiplexers/shells detected on the machine. This
 * is the single source of truth shared by the settings schema (renderer) and the
 * program registry (main); keep it in sync with `TERMINAL_PROGRAMS`.
 */
export const TERMINAL_PROGRAM_IDS = [
  'default',
  'tmux',
  'zellij',
  'screen',
  'bash',
  'zsh',
  'fish',
  'pwsh',
  'nu',
] as const
export type TerminalProgramId = (typeof TERMINAL_PROGRAM_IDS)[number]
export const terminalProgramSchema = z.enum(TERMINAL_PROGRAM_IDS).default('default')

/** One detected terminal program, reported to the renderer for the picker. */
export const terminalProgramInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['shell', 'multiplexer']),
  /** Whether the program's binary is installed on this machine. */
  available: z.boolean(),
})
export type TerminalProgramInfo = z.infer<typeof terminalProgramInfoSchema>

/**
 * One detected EXTERNAL terminal emulator (Ghostty, Warp, iTerm2, …) — a GUI app
 * TermDesk can hand a directory off to, distinct from the in-tab terminal
 * program above.
 */
export const externalTerminalInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Whether the emulator is installed on this machine. */
  available: z.boolean(),
})
export type ExternalTerminalInfo = z.infer<typeof externalTerminalInfoSchema>

/** Request to open a directory in an external terminal emulator. */
export const externalTerminalOpenSchema = z.object({
  /** Directory to open at; null/omitted → the user's home dir. */
  cwd: z.string().nullable().optional(),
  /** Emulator id to use; omitted → the saved preference, else the OS default. */
  id: z.string().optional(),
})
export type ExternalTerminalOpenInput = z.infer<typeof externalTerminalOpenSchema>

/** Result of an external-terminal launch attempt. */
export const externalTerminalOpenResultSchema = z.object({
  launched: z.boolean(),
  error: z.string().optional(),
})
export type ExternalTerminalOpenResult = z.infer<typeof externalTerminalOpenResultSchema>

/**
 * Toggleable left-sidebar sections, in display order. Each can be hidden from
 * the sidebar via Settings; the toolbar, branding, and footer are always shown.
 * Single source of truth shared by the schema and the Settings UI metadata.
 */
export const SIDEBAR_SECTION_IDS = [
  'hosts',
  'localTerminals',
  'workspaces',
  'tunnels',
  'snippets',
  'promptBook',
  'routines',
] as const
export type SidebarSectionId = (typeof SIDEBAR_SECTION_IDS)[number]

/**
 * Per-section visibility. Every key defaults to `true` and the object itself
 * defaults to `{}`, so an old or partial settings file parses to "all visible" —
 * a section is only ever hidden when the user explicitly turned it off.
 */
export const sidebarSectionsSchema = z
  .object({
    hosts: z.boolean().default(true),
    localTerminals: z.boolean().default(true),
    workspaces: z.boolean().default(true),
    tunnels: z.boolean().default(true),
    snippets: z.boolean().default(true),
    promptBook: z.boolean().default(true),
    routines: z.boolean().default(true),
  })
  .default({
    hosts: true,
    localTerminals: true,
    workspaces: true,
    tunnels: true,
    snippets: true,
    promptBook: true,
    routines: true,
  })
export type SidebarSections = z.infer<typeof sidebarSectionsSchema>

/** A workspace directory, with an optional command to auto-run on open. */
export const workspaceDirSchema = z.object({
  path: z.string(),
  command: z.string().optional(),
})
export type WorkspaceDir = z.infer<typeof workspaceDirSchema>

/** A named set of directories opened side by side (first two go into a split).
 *  Legacy string entries are accepted and normalized to `{ path }`. */
export const terminalWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  dirs: z
    .array(z.union([z.string(), workspaceDirSchema]))
    .min(1)
    .transform((arr) => arr.map((d) => (typeof d === 'string' ? { path: d } : d))),
})
export type TerminalWorkspace = z.infer<typeof terminalWorkspaceSchema>

export const settingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
  terminalFontSize: z.number().int().min(8).max(32).default(13),
  terminalFontFamily: z
    .string()
    .min(1)
    .max(200)
    .default('ui-monospace, SFMono-Regular, Menlo, monospace'),
  /** SSH keepalive interval in seconds; 0 disables keepalives. */
  keepaliveSeconds: z.number().int().min(0).max(300).default(15),
  /** Terminal color scheme. */
  terminalColorScheme: terminalColorSchemeSchema,
  /**
   * Paste clipboard into the terminal on right-click. Off by default: an
   * unconditional right-click paste executes on the next newline, which is a
   * destructive surprise in an SSH session.
   */
  terminalRightClickPaste: z.boolean().default(false),
  /** Expose TermDesk to AI agents over MCP. Off by default (security-sensitive). */
  mcpEnabled: z.boolean().default(false),
  /**
   * How agent exec/mutation is gated: 'always' = every command needs in-app
   * approval; 'allowlist' = auto-approve only commands matching an allow pattern
   * (deny patterns are always enforced). Default 'always'.
   */
  mcpApprovalMode: z.enum(['always', 'allowlist']).default('always'),
  /** Host ids an agent may READ (list dirs, read files). Per-host opt-in, default none. */
  mcpReadHostIds: z.array(z.string()).default([]),
  /** Host ids an agent may run commands on (exec). Per-host opt-in, default none. */
  mcpExecHostIds: z.array(z.string()).default([]),
  /** Extra command allow patterns (substrings) for allowlist mode. */
  mcpAllowPatterns: z.array(z.string()).default([]),
  /** Set once the user has seen (or skipped) the first-run welcome tour. */
  hasSeenWelcome: z.boolean().default(false),
  /** Auto-update channel. `beta` opts into prerelease builds. */
  updateChannel: z.enum(['stable', 'beta']).default('stable'),
  /**
   * Legacy tmux toggle, superseded by `terminalProgram`. Kept so old settings
   * files still parse; migrated to `terminalProgram: 'tmux'` on first read (see
   * main/store/settings.ts). Nothing writes it anymore.
   * @deprecated use `terminalProgram`
   */
  tmuxEnabled: z.boolean().default(false),
  /**
   * What runs when a terminal opens: `default` (the login shell) or a detected
   * multiplexer/shell (tmux, Zellij, screen, bash, zsh, fish, PowerShell,
   * Nushell). Multiplexers apply both locally (gated on being installed here)
   * and to SSH sessions (exec'd on the remote when present, else a plain shell).
   */
  terminalProgram: terminalProgramSchema,
  /**
   * Preferred EXTERNAL terminal emulator (Ghostty, Warp, iTerm2, …) for the
   * "Open in external terminal" action. Empty → the OS default terminal. Stores
   * a free id (validated against what's installed at launch time, not here) so a
   * new emulator never invalidates an existing settings file.
   */
  externalTerminal: z.string().default(''),
  /** Preferred AI harness id for "Run in agent" (empty → ask / fall back to claude). */
  defaultHarnessId: z.string().default(''),
  /** Master switch for the routine scheduler; off = no scheduled runs fire. */
  routineSchedulerEnabled: z.boolean().default(true),
  /** Saved terminal workspaces: named directory sets opened side by side. */
  terminalWorkspaces: z.array(terminalWorkspaceSchema).default([]),
  /** Which left-sidebar sections are shown. Every section visible by default. */
  sidebarSections: sidebarSectionsSchema,
})
export type Settings = z.infer<typeof settingsSchema>
export const settingsPatchSchema = settingsSchema.partial()
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

// ---------------------------------------------------------------------------
// VNC
// ---------------------------------------------------------------------------

/**
 * Result of opening a VNC bridge. The URL embeds a one-time token; the
 * password (when stored) is handed to the renderer exactly once, solely to
 * answer the RFB credentials callback for this session.
 */
export const vncOpenResultSchema = z.object({
  wsUrl: z.string(),
  /** RealVNC RSA-AES often needs both; password-only servers omit username. */
  username: z.string().nullable(),
  password: z.string().nullable(),
})
export type VncOpenResult = z.infer<typeof vncOpenResultSchema>

/** Verdict for a VNC server key checked against the pin store (TOFU). */
export const vncVerifyResultSchema = z.object({
  /** True → the viewer may approve the server and proceed. */
  ok: z.boolean(),
  /** Human-readable reason when the key is refused. */
  reason: z.string().optional(),
})
export type VncVerifyResult = z.infer<typeof vncVerifyResultSchema>

// ---------------------------------------------------------------------------
// RDP
// ---------------------------------------------------------------------------

/**
 * Result of opening an RDP session. The renderer's IronRDP WASM client connects
 * to `wsUrl` (our in-process RDCleanPath proxy), presenting `authToken` (opaque
 * to the proxy). Credentials are handed to the client exactly once to answer the
 * RDP/CredSSP logon; they are never persisted or echoed back.
 */
export const rdpOpenResultSchema = z.object({
  /** ws:// URL of the one-time RDCleanPath proxy target. */
  wsUrl: z.string(),
  /** Opaque token the client puts in the RDCleanPath proxyAuth field. */
  authToken: z.string(),
  /** `host:port` the proxy connects the RDP session to. */
  destination: z.string(),
  username: z.string(),
  /** AD/Windows logon domain, or null. */
  domain: z.string().nullable(),
  password: z.string().nullable(),
})
export type RdpOpenResult = z.infer<typeof rdpOpenResultSchema>

// ---------------------------------------------------------------------------
// SFTP
// ---------------------------------------------------------------------------

export const sftpOpenResultSchema = z.object({
  sftpId: z.string(),
  /** The remote login home directory (the "go home" target). */
  homeDir: z.string(),
  /**
   * Directory the browser should open at: the host's `defaultPath` when it is
   * set and resolves on the remote, otherwise `homeDir`.
   */
  startDir: z.string(),
})
export type SftpOpenResult = z.infer<typeof sftpOpenResultSchema>

export const sftpEntrySchema = z.object({
  name: z.string(),
  /** Absolute remote path. */
  path: z.string(),
  type: z.enum(['file', 'dir', 'symlink', 'other']),
  size: z.number(),
  mtimeMs: z.number(),
  /** POSIX permission bits (lower 12 bits of st_mode). */
  mode: z.number().int(),
})
export type SftpEntry = z.infer<typeof sftpEntrySchema>

export const transferStatusSchema = z.enum(['queued', 'active', 'done', 'error', 'cancelled'])
export type TransferStatus = z.infer<typeof transferStatusSchema>

export const transferSchema = z.object({
  id: z.string(),
  sftpId: z.string(),
  kind: z.enum(['upload', 'download']),
  /** Display name (file basename). */
  label: z.string(),
  localPath: z.string(),
  remotePath: z.string(),
  totalBytes: z.number().nullable(),
  doneBytes: z.number(),
  /** Bytes per second over a recent window; 0 while queued. */
  rate: z.number(),
  etaSec: z.number().nullable(),
  status: transferStatusSchema,
  error: z.string().optional(),
})
export type Transfer = z.infer<typeof transferSchema>

// ---------------------------------------------------------------------------
// Channel → signature map for `ipcRenderer.invoke`. The preload's typed
// wrapper derives argument and result types from this, so a channel cannot
// be invoked with the wrong shape without a compile error.
// ---------------------------------------------------------------------------

export interface IpcInvokeMap {
  [IPC.sshConnect]: { args: [string]; result: SshConnectResult }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sshAbortConnect]: { args: [string]; result: void }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sshDisconnect]: { args: [string]; result: void }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sshResize]: { args: [string, number, number]; result: void }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sshHostKeyRespond]: { args: [string, boolean]; result: void }
  [IPC.sftpOpen]: { args: [string]; result: SftpOpenResult }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sftpClose]: { args: [string]; result: void }
  [IPC.sftpList]: { args: [string, string]; result: SftpEntry[] }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sftpMkdir]: { args: [string, string]; result: void }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sftpRename]: { args: [string, string, string]; result: void }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sftpDelete]: { args: [string, string]; result: void }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sftpChmod]: { args: [string, string, number]; result: void }
  [IPC.sftpDownload]: { args: [string, string]; result: string | null }
  [IPC.sftpUpload]: { args: [string, string[], string]; result: string[] }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sftpTransferCancel]: { args: [string]; result: void }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sftpTransferRetry]: { args: [string]; result: void }
  [IPC.sftpTransfersList]: { args: []; result: Transfer[] }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.sftpEditOpen]: { args: [string, string]; result: void }
  [IPC.vncOpen]: { args: [string]; result: VncOpenResult }
  [IPC.vncImportFile]: { args: []; result: SshConfigImportResult }
  [IPC.vncVerifyServerKey]: { args: [string, string]; result: VncVerifyResult }
  [IPC.rdpOpen]: { args: [string]; result: RdpOpenResult }
  [IPC.localTermOpen]: { args: [LocalTermOpenOptions?]; result: LocalTermOpenResult }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.localTermResize]: { args: [string, number, number]; result: void }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.localTermClose]: { args: [string]; result: void }
  [IPC.localTermCwd]: { args: [string]; result: string | null }
  [IPC.localTerminalsList]: { args: []; result: SavedLocalTerminal[] }
  [IPC.localTerminalsCreate]: { args: [SavedLocalTerminalInput]; result: SavedLocalTerminal }
  [IPC.localTerminalsUpdate]: {
    args: [string, SavedLocalTerminalInput]
    result: SavedLocalTerminal
  }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.localTerminalsDelete]: { args: [string]; result: void }
  [IPC.localTerminalsReorder]: { args: [string[]]; result: SavedLocalTerminal[] }
  [IPC.localTerminalsPick]: { args: []; result: string | null }
  // SSH tunnels
  [IPC.tunnelsList]: { args: []; result: SavedTunnel[] }
  [IPC.tunnelsCreate]: { args: [SavedTunnelInput]; result: SavedTunnel }
  [IPC.tunnelsUpdate]: { args: [string, SavedTunnelInput]; result: SavedTunnel }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.tunnelsDelete]: { args: [string]; result: void }
  /** Start a saved tunnel; resolves with its runtime status. */
  [IPC.tunnelStart]: { args: [string]; result: TunnelStatus }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.tunnelStop]: { args: [string]; result: void }
  /** Current runtime status of every running tunnel for this window. */
  [IPC.tunnelStatus]: { args: []; result: TunnelStatus[] }
  [IPC.settingsGet]: { args: []; result: Settings }
  [IPC.settingsSet]: { args: [SettingsPatch]; result: Settings }
  [IPC.snippetsList]: { args: []; result: Snippet[] }
  [IPC.snippetsCreate]: { args: [SnippetInput]; result: Snippet }
  [IPC.snippetsUpdate]: { args: [string, SnippetInput]; result: Snippet }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.snippetsDelete]: { args: [string]; result: void }
  [IPC.promptsList]: { args: []; result: Prompt[] }
  [IPC.promptsCreate]: { args: [PromptInput]; result: Prompt }
  [IPC.promptsUpdate]: { args: [string, PromptInput]; result: Prompt }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.promptsDelete]: { args: [string]; result: void }
  [IPC.promptsReorder]: { args: [string[]]; result: Prompt[] }
  [IPC.harnessesDetect]: { args: []; result: DetectedHarness[] }
  [IPC.routinesList]: { args: []; result: Routine[] }
  [IPC.routinesCreate]: { args: [RoutineInput]; result: Routine }
  [IPC.routinesUpdate]: { args: [string, RoutineInput]; result: Routine }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.routinesDelete]: { args: [string]; result: void }
  [IPC.routinesRecordRun]: { args: [RecordRunInput]; result: RoutineRun }
  [IPC.routineRunsList]: { args: [string]; result: RoutineRun[] }
  [IPC.automationJobsList]: { args: []; result: AutomationJob[] }
  [IPC.automationJobCreate]: { args: [AutomationJobInput]; result: AutomationJob }
  [IPC.automationJobUpdate]: { args: [string, AutomationJobInput]; result: AutomationJob }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.automationJobDelete]: { args: [string]; result: void }
  /** Starts a run; returns the runId. Progress streams via the automationEvent channel. */
  [IPC.automationRun]: { args: [AutomationRunInput]; result: string }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.automationCancel]: { args: [string]; result: void }
  [IPC.logList]: { args: []; result: ActivityEntry[] }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.logClear]: { args: []; result: void }
  // MCP / AI agent integration
  [IPC.mcpStatus]: { args: []; result: McpStatus }
  [IPC.mcpSetEnabled]: { args: [boolean]; result: McpStatus }
  [IPC.mcpAuditList]: { args: []; result: AiAuditEntry[] }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.mcpAuditClear]: { args: []; result: void }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.mcpApprove]: { args: [string, boolean]; result: void }
  // App auto-update
  [IPC.updatesGetState]: { args: []; result: UpdateState }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.updatesDownload]: { args: []; result: void }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.updatesInstall]: { args: []; result: void }
  [IPC.appGetVersions]: { args: []; result: Versions }
  /** Detected terminal programs (multiplexers/shells) installed on this machine. */
  [IPC.terminalsDetect]: { args: []; result: TerminalProgramInfo[] }
  /** Detected external terminal emulators (Ghostty, Warp, …) installed here. */
  [IPC.externalTerminalsDetect]: { args: []; result: ExternalTerminalInfo[] }
  /** Open a directory in an external terminal emulator (spawned detached). */
  [IPC.externalTerminalOpen]: {
    args: [ExternalTerminalOpenInput]
    result: ExternalTerminalOpenResult
  }
  [IPC.hostsList]: { args: []; result: Host[] }
  [IPC.hostsCreate]: { args: [HostInput]; result: Host }
  /** (sourceId, newLabel, newHostname) → a full copy with new identity. */
  [IPC.hostsDuplicate]: { args: [string, string, string]; result: Host }
  [IPC.hostsUpdate]: { args: [string, HostInput]; result: Host }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.hostsDelete]: { args: [string]; result: void }
  /** (hostId, groupId|null) — reassign a host's group without a full payload. */
  [IPC.hostsSetGroup]: { args: [string, string | null]; result: Host }
  [IPC.hostsTest]: { args: [string]; result: HostTestResult }
  [IPC.groupsList]: { args: []; result: Group[] }
  [IPC.groupsCreate]: { args: [GroupInput]; result: Group }
  [IPC.groupsUpdate]: { args: [string, GroupInput]; result: Group }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.groupsDelete]: { args: [string]; result: void }
  [IPC.credentialsList]: { args: []; result: Credential[] }
  [IPC.credentialsCreate]: { args: [CredentialInput]; result: Credential }
  [IPC.credentialsUpdate]: { args: [string, CredentialInput]; result: Credential }
  // biome-ignore lint/suspicious/noConfusingVoidType: void mirrors the Promise<void> contract in RendererApi
  [IPC.credentialsDelete]: { args: [string]; result: void }
  [IPC.sshConfigImport]: { args: []; result: SshConfigImportResult }
  [IPC.sshConfigImportFile]: { args: []; result: SshConfigImportResult }
}
