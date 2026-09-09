/**
 * Agentic-terminal core (Milestone M12: issue #95 agent-drives-primitives, #97
 * inline data previews; positioned against #96 BYOK/local agent mode).
 *
 * The 2025–2026 battleground is agentic terminals — Warp's Agentic Development
 * Environment, Tabby's (unfinished) MCP-over-SSH work — but Warp blocks BYOK and
 * meters credits, and iTerm2's cloud AI drew a privacy backlash. TermDesk already
 * ships MCP agent access ("hands never keys", approval-gated, audited) and the
 * SSH/SFTP/tunnel/fleet substrate an agent needs. This module is the pure core
 * for two of the milestone's issues:
 *
 *  - #95: an **agent tool registry** describing which of TermDesk's primitives an
 *    agent may drive, and a pure **approval policy** — every mutating/side-
 *    effectful tool is approval-gated, matching the existing MCP safety machinery.
 *  - #97: **preview detection** — classify a command's / file's output as an
 *    image, JSON, delimited table, or plain text so the renderer can show it
 *    inline (Wave's "killer feature"), and so an agent can reference a structured
 *    artifact rather than a wall of text.
 *
 * Pure and dependency-free (no MCP runtime, no network) so the policy and the
 * detector are unit-tested in isolation; the main-process MCP layer enforces the
 * policy and the renderer draws the previews.
 */

// ---------------------------------------------------------------------------
// #95 — Agent tool registry + approval policy
// ---------------------------------------------------------------------------

export type AgentToolName =
  | 'session.open'
  | 'session.run'
  | 'session.read'
  | 'sftp.get'
  | 'sftp.put'
  | 'tunnel.start'
  | 'tunnel.stop'
  | 'fleet.run'

export interface AgentToolDescriptor {
  name: AgentToolName
  title: string
  /** Changes remote/host state or transfers data (vs a pure read). */
  mutating: boolean
  /**
   * Always require explicit user approval before running. True for every
   * mutating tool; read-only tools default to false so a user who opted into
   * "auto-approve reads" can let them run, but the policy can still force it.
   */
  requiresApproval: boolean
}

/**
 * The tools an agent may drive, each mapped to an existing TermDesk primitive.
 * Read-only tools (`session.read`) are the only ones eligible for auto-approve;
 * everything that runs a command, moves a file, or opens/closes a tunnel is
 * approval-gated by default.
 */
export const AGENT_TOOLS: readonly AgentToolDescriptor[] = [
  {
    name: 'session.open',
    title: 'Open or attach a session',
    mutating: true,
    requiresApproval: true,
  },
  {
    name: 'session.run',
    title: 'Run a command in a session',
    mutating: true,
    requiresApproval: true,
  },
  {
    name: 'session.read',
    title: 'Read a session block / output',
    mutating: false,
    requiresApproval: false,
  },
  { name: 'sftp.get', title: 'Download a file over SFTP', mutating: true, requiresApproval: true },
  { name: 'sftp.put', title: 'Upload a file over SFTP', mutating: true, requiresApproval: true },
  {
    name: 'tunnel.start',
    title: 'Start a tunnel / port-forward',
    mutating: true,
    requiresApproval: true,
  },
  {
    name: 'tunnel.stop',
    title: 'Stop a tunnel / port-forward',
    mutating: true,
    requiresApproval: true,
  },
  {
    name: 'fleet.run',
    title: 'Run across a host group (fleet)',
    mutating: true,
    requiresApproval: true,
  },
] as const

const TOOL_BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]))

/** Look up a tool descriptor, or `undefined` for an unknown name. */
export function agentTool(name: string): AgentToolDescriptor | undefined {
  return TOOL_BY_NAME.get(name as AgentToolName)
}

export interface ApprovalPolicyOptions {
  /**
   * The user has opted to let read-only tools run without a prompt. Mutating
   * tools are ALWAYS gated regardless — this only relaxes reads.
   */
  autoApproveReads?: boolean
}

/**
 * Whether a tool call must be approved by the user before it runs. An unknown
 * tool is treated as requiring approval (fail-closed). Mutating tools always
 * require approval; a read-only tool requires approval unless the user opted
 * into auto-approving reads.
 */
export function requiresApproval(name: string, opts: ApprovalPolicyOptions = {}): boolean {
  const tool = agentTool(name)
  if (!tool) return true // fail-closed on unknown tools
  if (tool.mutating || tool.requiresApproval) return true
  return !opts.autoApproveReads
}

// ---------------------------------------------------------------------------
// #97 — Inline preview detection
// ---------------------------------------------------------------------------

export type Preview =
  | { kind: 'image'; format: string; dataUri: boolean }
  | { kind: 'json'; jsonType: 'object' | 'array' }
  | { kind: 'table'; delimiter: ',' | '\t'; columns: number; rows: number }
  | { kind: 'text' }

export interface PreviewOptions {
  /** Lines to sample when sniffing a delimited table (default 20). */
  sampleLines?: number
}

// Base64 signatures for the common image formats (first bytes of the file).
const IMAGE_B64_SIGNATURES: Array<[string, string]> = [
  ['iVBORw0KGgo', 'png'],
  ['/9j/', 'jpeg'],
  ['R0lGOD', 'gif'],
  ['UklGR', 'webp'], // RIFF container
  ['PHN2Zw', 'svg'], // "<svg"
  ['Qk', 'bmp'],
]

function detectImage(content: string): Preview | null {
  const trimmed = content.trim()
  const dataUri = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(trimmed)
  if (dataUri) return { kind: 'image', format: (dataUri[1] ?? '').toLowerCase(), dataUri: true }
  // A bare base64 blob whose leading bytes match a known image signature.
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length >= 24) {
    const head = trimmed.replace(/\s+/g, '').slice(0, 16)
    for (const [sig, format] of IMAGE_B64_SIGNATURES) {
      if (head.startsWith(sig)) return { kind: 'image', format, dataUri: false }
    }
  }
  return null
}

function detectJson(content: string): Preview | null {
  const trimmed = content.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return { kind: 'json', jsonType: 'array' }
    if (parsed !== null && typeof parsed === 'object') return { kind: 'json', jsonType: 'object' }
  } catch {
    // not JSON
  }
  return null
}

function detectTable(content: string, sampleLines: number): Preview | null {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) return null
  const sample = lines.slice(0, sampleLines)
  for (const delimiter of [',', '\t'] as const) {
    const counts = sample.map((l) => l.split(delimiter).length - 1)
    const first = counts[0]
    if (first !== undefined && first >= 1 && counts.every((c) => c === first)) {
      return { kind: 'table', delimiter, columns: first + 1, rows: lines.length }
    }
  }
  return null
}

/**
 * Classify `content` for inline preview (#97). Order: image → JSON → delimited
 * table → text. JSON is checked before table so a multi-line JSON array is not
 * mistaken for CSV. Everything is best-effort and side-effect-free; ambiguous or
 * unrecognized content falls back to `text`.
 */
export function detectPreview(content: string, opts: PreviewOptions = {}): Preview {
  if (content.trim() === '') return { kind: 'text' }
  return (
    detectImage(content) ??
    detectJson(content) ??
    detectTable(content, opts.sampleLines ?? 20) ?? { kind: 'text' }
  )
}
