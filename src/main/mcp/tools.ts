import { redactSecrets } from '@shared/redact'
import { z } from 'zod'
import { sanitizeErrorMessage } from '../ipc/hosts'
import { runCommand } from '../ssh/command-runner'
import type { DataSink } from '../ssh/session-manager'
import { recordAiAudit } from '../store/ai-audit-repo'
import { listGroups } from '../store/groups-repo'
import { findHostRow, listHosts } from '../store/hosts-repo'
import { getSettings } from '../store/settings'
import { requestApproval } from './approvals'
import { decide, type PolicyConfig } from './policy'

/** Cap on captured stdout/stderr per command (chars). */
const OUTPUT_CAP = 64 * 1024
/** Default per-command timeout. */
const COMMAND_TIMEOUT_MS = 60_000
/** Max hosts a run_on_group fan-out touches concurrently. */
const GROUP_FANOUT_LIMIT = 8
/**
 * Longest command an agent may submit. Deliberately bounded to a length the
 * approval dialog can render in full — a command the user cannot actually read
 * is a command the approval gate cannot actually gate.
 */
const COMMAND_MAX = 2000
/** Chars of the redacted command kept in the audit row. */
const AUDIT_SUMMARY_CAP = 2000

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Synthetic owner for agent-initiated SSH work. Negative id so it can never
 * collide with a real WebContents id; sends nowhere (the agent reads results
 * via the tool return value, not an event stream).
 */
const MCP_OWNER: DataSink = { id: -777, send: () => {}, isDestroyed: () => false }

function policyConfig(): PolicyConfig {
  const s = getSettings()
  return {
    approvalMode: s.mcpApprovalMode,
    readHostIds: s.mcpReadHostIds,
    execHostIds: s.mcpExecHostIds,
    allowPatterns: s.mcpAllowPatterns,
  }
}

/**
 * Host ids the user has explicitly opted into for MCP read or exec. The
 * inventory tools (list_hosts/list_groups) expose ONLY these, so an agent
 * holding the bearer token can't enumerate hostnames/usernames the user never
 * granted it — keeping inventory disclosure consistent with the per-host
 * opt-in model that already gates run_command.
 */
function optedInHostIds(): Set<string> {
  const s = getSettings()
  return new Set<string>([...s.mcpReadHostIds, ...s.mcpExecHostIds])
}

interface CommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

async function runCommandCapture(hostId: string, command: string): Promise<CommandResult> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), COMMAND_TIMEOUT_MS)
  let stdout = ''
  let stderr = ''
  try {
    const { exitCode } = await runCommand(
      hostId,
      MCP_OWNER,
      command,
      {
        onStdout: (c) => {
          if (stdout.length < OUTPUT_CAP) stdout += c
        },
        onStderr: (c) => {
          if (stderr.length < OUTPUT_CAP) stderr += c
        },
      },
      ac.signal,
    )
    return { exitCode, stdout: stdout.slice(0, OUTPUT_CAP), stderr: stderr.slice(0, OUTPUT_CAP) }
  } finally {
    clearTimeout(timer)
  }
}

function hostLabelOf(hostId: string): string {
  return findHostRow(hostId)?.label ?? hostId
}

/** Runs one command on one host through the full policy → approval → audit path. */
async function execOnHost(hostId: string, command: string, client: string | null): Promise<string> {
  const hostLabel = hostLabelOf(hostId)
  // The approval dialog must show the WHOLE command that will run: a display
  // slice here let an agent push a payload past the cut-off and have the user
  // approve a benign-looking prefix. `redactSecrets` is substitution-only, so
  // this is the same string modulo secrets.
  const redacted = redactSecrets(command)
  // The audit column stays bounded, but wide enough to reconstruct an incident.
  const summary = redacted.slice(0, AUDIT_SUMMARY_CAP)
  const inBytes = Buffer.byteLength(command)
  const decision = decide({ toolClass: 'exec', hostId, command }, policyConfig())
  const started = Date.now()

  if (decision.verdict === 'deny') {
    recordAiAudit({
      client,
      tool: 'run_command',
      hostId,
      hostLabel,
      summary,
      verdict: 'deny',
      outcome: 'denied',
      detail: decision.reason,
      durationMs: null,
    })
    return `Denied: ${decision.reason}`
  }

  if (decision.verdict === 'needs-approval') {
    const approved = await requestApproval({
      client,
      tool: 'run_command',
      hostLabel,
      summary: redacted,
    })
    if (!approved) {
      recordAiAudit({
        client,
        tool: 'run_command',
        hostId,
        hostLabel,
        summary,
        verdict: 'needs-approval',
        outcome: 'denied',
        detail: 'denied by user or approval timed out',
        durationMs: Date.now() - started,
      })
      return 'Denied by user.'
    }
  }

  try {
    const r = await runCommandCapture(hostId, command)
    recordAiAudit({
      client,
      tool: 'run_command',
      hostId,
      hostLabel,
      summary,
      verdict: decision.verdict,
      outcome: decision.verdict === 'allow' ? 'auto' : 'approved',
      detail: `exit ${r.exitCode}`,
      durationMs: Date.now() - started,
      inBytes,
      outBytes: Buffer.byteLength(r.stdout) + Buffer.byteLength(r.stderr),
    })
    return JSON.stringify({ hostId, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr })
  } catch (err) {
    const msg = sanitizeErrorMessage(err)
    recordAiAudit({
      client,
      tool: 'run_command',
      hostId,
      hostLabel,
      summary,
      verdict: decision.verdict,
      outcome: 'error',
      detail: msg,
      durationMs: Date.now() - started,
    })
    return `Error: ${msg}`
  }
}

/** A registered MCP tool: metadata + Zod input shape + handler. */
export interface McpTool {
  name: string
  title: string
  description: string
  inputShape: z.ZodRawShape
  // biome-ignore lint/suspicious/noExplicitAny: args are validated by the SDK against inputShape
  run(args: any, client: string | null): Promise<string>
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_hosts',
    title: 'List hosts',
    description:
      'List the SSH/VNC hosts the user has opted into for AI access (label, kind, tags, group, hostname, username). Never returns secrets, and never lists hosts you have not been granted. Use the returned ids with run_command.',
    inputShape: {},
    run: async (_args, client) => {
      const allowed = optedInHostIds()
      const hosts = listHosts()
        .filter((h) => allowed.has(h.id))
        .map((h) => ({
          id: h.id,
          label: h.label,
          kind: h.kind,
          hostname: h.hostname,
          username: h.username,
          tags: h.tags,
          groupId: h.groupId,
        }))
      recordAiAudit({
        client,
        tool: 'list_hosts',
        hostId: null,
        hostLabel: null,
        summary: `listed ${hosts.length} opted-in hosts`,
        verdict: 'allow',
        outcome: 'ok',
        detail: null,
        durationMs: null,
      })
      return JSON.stringify(hosts)
    },
  },
  {
    name: 'list_groups',
    title: 'List host groups',
    description:
      'List host groups that contain at least one host you have been granted AI access to (use a group to target run_on_group).',
    inputShape: {},
    run: async (_args, client) => {
      const allowed = optedInHostIds()
      const groupsWithAccess = new Set(
        listHosts()
          .filter((h) => allowed.has(h.id) && h.groupId != null)
          .map((h) => h.groupId),
      )
      const groups = listGroups()
        .filter((g) => groupsWithAccess.has(g.id))
        .map((g) => ({ id: g.id, name: g.name, parentId: g.parentId }))
      recordAiAudit({
        client,
        tool: 'list_groups',
        hostId: null,
        hostLabel: null,
        summary: `listed ${groups.length} groups`,
        verdict: 'allow',
        outcome: 'ok',
        detail: null,
        durationMs: null,
      })
      return JSON.stringify(groups)
    },
  },
  {
    name: 'run_command',
    title: 'Run a command on a host',
    description:
      'Run a non-interactive shell command on one SSH host (by id from list_hosts) and return stdout/stderr/exit code. Subject to per-host opt-in and user approval; some obviously destructive commands are also blocked outright, but approval is the real control.',
    inputShape: {
      hostId: z.string().min(1).describe('Host id from list_hosts'),
      command: z.string().min(1).max(COMMAND_MAX).describe('The shell command to run'),
    },
    run: async (args, client) => execOnHost(args.hostId, args.command, client),
  },
  {
    name: 'run_on_group',
    title: 'Run a command across many hosts',
    description:
      'Run the same command on several SSH hosts (by host ids) and return a per-host result matrix. Each host must be agent-exec-enabled; subject to approval; some obviously destructive commands are also blocked outright, but approval is the real control.',
    inputShape: {
      hostIds: z.array(z.string().min(1)).min(1).max(200).describe('Host ids from list_hosts'),
      command: z.string().min(1).max(COMMAND_MAX).describe('The shell command to run on each host'),
    },
    run: async (args, client) => {
      const hostIds: string[] = args.hostIds
      const command: string = args.command
      // Bound concurrency: a large group must not open hundreds of SSH
      // connections at once (resource exhaustion on this host and the targets).
      const results = await mapWithConcurrency(hostIds, GROUP_FANOUT_LIMIT, async (hostId) => {
        const out = await execOnHost(hostId, command, client)
        // execOnHost returns JSON on success or a plain message on deny/error.
        try {
          return JSON.parse(out)
        } catch {
          return { hostId, result: out }
        }
      })
      return JSON.stringify(results)
    },
  },
]
