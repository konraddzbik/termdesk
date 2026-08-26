# MCP Agent Integration — Design & Security Model

> Let an AI agent (Claude, Claude Code, Cursor, Grok, …) **use** TermDesk — list hosts,
> run commands on remote hosts, run a command across a fleet, read remote files — through
> the [Model Context Protocol](https://modelcontextprotocol.io). The agent gets **hands,
> never keys**: credentials never leave TermDesk's main process, every action is
> **host-key-verified, policy-gated, and written to a user-visible AI activity log**.

This is the single most security-sensitive surface in the app. The safety layer is the
product. This document is the contract: read it before changing anything under
`src/main/mcp/`.

---

## 1. Why

TermDesk already is a secure execution backend (managed SSH sessions, an OS-keychain vault,
host-key verification, ProxyJump, a fleet automation runner). Exposing that over MCP turns
TermDesk into a safe execution layer for an agent: the agent never sees secrets, can't act
without policy approval, and everything it does is auditable.

## 2. Threat model

The agent is **untrusted and prompt-injectable.** A hostile MOTD, a file the agent reads, a
web page in its context, or a confused model can all try to make it run destructive or
exfiltrating commands. Therefore:

- The agent **must not** be able to read secrets (passwords, key material, tokens).
- The agent **must not** be able to mutate/execute on a host that the user hasn't explicitly
  enabled for agent use.
- Every mutating action **must** be gated (approval or allowlist) and **must** be logged
  with enough context for the user to understand and, where applicable, approve it.
- The user **must** have a always-available kill switch and a clear "an agent is connected"
  indicator.

Non-goals: defending against a fully compromised local machine (the OS user already has the
vault). MCP access is strictly ≤ what the logged-in desktop user can already do.

## 3. Architecture

```
┌─────────────────────┐      Streamable HTTP (127.0.0.1:<port>)        ┌──────────────────────────┐
│ MCP client          │  ── Authorization: Bearer <session-token> ──▶  │ TermDesk main process     │
│ (Claude Code/Desktop│                                                 │  mcp/server.ts (SDK)      │
│  Cursor, Grok, …)   │  ◀── JSON-RPC results / SSE stream ──────────  │   ├─ tools/ (adapters)    │
└─────────────────────┘                                                 │   ├─ policy.ts (gate)     │
                                                                        │   ├─ ai-audit (log)       │
                                                                        │   └─ existing managers:   │
                                                                        │      session-manager,     │
                                                                        │      command-runner,      │
                                                                        │      automation-runner,   │
                                                                        │      sftp-manager, vault  │
                                                                        └──────────────────────────┘
```

- **Transport:** Streamable HTTP bound to `127.0.0.1` on a random port (same loopback +
  token discipline as the VNC `ws-bridge`). Chosen over stdio because TermDesk is an
  always-running GUI app — an external client connects to it, rather than spawning it.
- **Auth:** a per-enable **bearer session token** (256-bit CSPRNG). The user copies the URL +
  token into their MCP client config. Requests without a valid token are rejected before any
  tool runs. The token rotates whenever MCP is toggled off/on.
- **Off by default.** MCP is disabled until the user enables it in Settings.
- **Reuses everything:** tools are thin adapters over the existing main-process managers, so
  there is exactly one implementation of SSH/auth/host-key logic.

## 4. Tool surface (MVP)

Shipped:

| Tool | Class | What it does | Gate |
|---|---|---|---|
| `list_hosts` | meta | Host names, kinds, tags, groups, hostname, username. **Never** secrets or `*Enc` fields. | always allowed when MCP on |
| `list_groups` | meta | Host groups (for fan-out targeting). | always allowed |
| `run_command` | **exec** | Non-interactive command on one host (reuses `command-runner.runCommand`); returns stdout/stderr/exit. | per-host exec opt-in **+** approval mode |
| `run_on_group` | **exec** | Fan-out a command across host ids; returns a per-host result matrix. | per-host exec opt-in for each host **+** approval |

Designed, not yet exposed: `sftp_list` / `sftp_read_file` (per-host read
opt-in), `read_ai_activity` (agent reads its own trail). Deliberately **never** in scope:
interactive PTY control / `send_keys`, `sftp_write`/`sftp_delete`, and credential reads of any
kind.

## 5. Policy engine (`src/main/mcp/policy.ts`)

Pure, unit-tested. Decides `allow | needs-approval | deny` for a tool call, given the tool
class, the target host, and user config.

- **Default deny for exec.** A host is exec-eligible only if the user set `agentExec: true`
  on it (per-host opt-in). Read tools require `agentRead: true` (also default off).
- **Approval modes** (global setting):
  - `always` — every exec needs an explicit in-app approval (default).
  - `allowlist` — exec auto-approved only if the command matches an allow pattern AND no deny
    pattern; otherwise falls back to approval.
  - `disabled` — MCP off (no tools served).
- **Deny patterns** (always enforced, even in allowlist): destructive/exfiltration shapes
  (`rm -rf /`, `mkfs`, `dd of=/dev/`, `:(){ :|:& };:`, `curl … | sh`, reads of `/etc/shadow`,
  `id_rsa`, etc.). A deny match is hard-rejected and audited, never just "needs approval".
- **Kill switch.** A single flag (and the Settings toggle) immediately stops the server and
  rejects in-flight calls.

Every decision — allow, approval-requested, approved/denied-by-user, deny — is written to the
AI audit log with the reason.

## 6. AI activity log (user-visible)

A dedicated `ai_audit` table (separate from the human `activity_log`), surfaced in a new **AI
Activity** view. Each row records one step of an agent interaction:

`ts · client (label) · tool · host · action summary · args (secret-redacted) · policy verdict ·
approval (auto/user/denied) · result status · duration · error`

- Command text is run through the same `redactSecrets()` used for the human log.
- Never stores secrets, key material, or full file contents — only metadata + a short
  result summary.
- Bounded (newest N) + time-purged like `activity_log`.
- Broadcast live to open windows so the user watches the agent act in real time.
- The agent can read **its own** recent trail via `read_ai_activity` (transparency), but not
  edit or clear it.

## 7. Approval flow

When policy returns `needs-approval`, the tool call **blocks** while an in-app dialog shows:
client, host, the exact (redacted) command, and Allow / Deny (with an optional "allow this
exact command for this host this session"). Timeout → deny. Reuses the modal pattern of
`HostKeyDialog`. The decision is audited.

## 8. Configuration

New settings (all default to the safe value):

- `mcpEnabled: boolean = false`
- `mcpApprovalMode: 'always' | 'allowlist' = 'always'`
- `mcpAllowPatterns: string[]`, `mcpDenyPatterns: string[]` (deny seeded with the built-in
  destructive set, which is always enforced regardless)

Per-host (on the host record): `agentRead: boolean = false`, `agentExec: boolean = false`.

When enabled, Settings shows the connection details to paste into a client, e.g. for Claude
Code: `claude mcp add --transport http termdesk http://127.0.0.1:<port>/mcp --header
"Authorization: Bearer <token>"`.

## 9. Files

```
src/main/mcp/
  server.ts        # SDK server + Streamable HTTP transport + token auth + lifecycle
  tools.ts         # tool definitions → existing managers (read) / policy+audit (exec)
  policy.ts        # pure decision engine (allow | needs-approval | deny)  [tested]
  mcp-smoke.ts     # TERMDESK_SMOKE=mcp: in-process client drives initialize/list/call
src/main/store/
  ai-audit-repo.ts # ai_audit table CRUD + purge  [tested]
src/main/ipc/mcp.ts          # renderer IPC: status, enable/disable, list audit, approve
src/renderer/components/ai/  # AI Activity view + approval dialog + settings panel
src/shared/ipc.ts            # mcp* schemas + AiAuditEntry + settings fields
```

## 10. Status

Implemented: read tools + `run_command`/`run_on_group` exec, policy engine, AI audit log +
UI, approval flow, HTTP/token transport, smoke harness. Off by default.

Not implemented: `sftp_write`/edit, per-tool rate limits, an allowlist UI editor, signed
audit export, and an in-app agent (TermDesk as MCP *host*).

## 11. Invariants (do not regress)

1. The agent never receives secrets, key material, or full credential records.
2. No exec/mutation without per-host opt-in **and** (approval or allowlist).
3. Every tool call is audited before its result is returned.
4. MCP is off by default and the token rotates on every enable.
5. The transport binds to loopback only and rejects untokened requests.
