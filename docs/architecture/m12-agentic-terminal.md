# Architecture review — Agentic terminal & data-rich UX (Milestone M12)

Scope: issues #95 (agent-drives-primitives — SSH/SFTP/tunnel/fleet as MCP tools), #96 (BYOK + local-model agent mode & universal agent tabs), #97 (inline structured-data & graphics previews). Epic: #103. Extends M5 (local-first AI) and M6 (terminal parity).

This PR lands the **agentic core** (`src/shared/agent-tools.ts`) — the pure tool registry + approval policy for #95 and the preview detector for #97 — and reviews how the milestone builds on TermDesk's already-shipped MCP/Prompt-Book/AI-backend architecture. No IPC/UI wiring here; this is *surfacing + tool-surface*, not new safety machinery.

## Why this milestone (competitor evidence)

Agentic terminals are the defining 2025–2026 battleground — **Warp 2.0** (Agentic Development Environment, multi-agent orchestration, Apr-2026 universal agent tabs), **Tabby**'s unfinished MCP-over-SSH work, **Wave**'s inline previews ("the killer feature"). But Warp **blocks BYOK and meters credits** (Free dropped to 75/mo, Dec 2025) and iTerm2's cloud AI drew a 2024 privacy backlash. TermDesk already has what no rival combines: an agent surface (MCP, approval-gated, audited) **and** a real SSH connection manager with fleet/tunnel/SFTP primitives.

## What already exists (so the milestone is smaller than it looks)

- **MCP agent access is shipped** (`src/main/mcp/`, `mcp/approvals.ts`, `aiAudit` table): "hands never keys", per-host opt-in, approval-gated, live in the AI Activity log. #95 is a *tool-surface expansion* on top of this, not new safety machinery.
- **M5 AI backend abstraction** (`src/shared/ai-backend.ts`) already models `none` / `ollama` / `openai-compatible` with the key held only in main and an `isLocalBackend` "local only" signal — exactly what #96's BYOK/local agent mode runs on.
- **Prompt Book already launches agents** (Claude Code / Aider / OpenCode / Codex / Gemini) — #96's "universal agent tabs" promote that into first-class resumable sessions.
- **M6 #50** already scopes Sixel/Kitty/iTerm2 image rendering + SFTP thumbnails — #97 extends that from *images* to *structured data* and ties previews to command blocks.

## #95 — Agent tool registry + approval policy (this PR's core)

`AGENT_TOOLS` maps each drivable primitive (`session.open/run/read`, `sftp.get/put`, `tunnel.start/stop`, `fleet.run`) to a descriptor; `requiresApproval(name, opts)` is the pure policy: **fail-closed on unknown tools**, every mutating tool always gated, and only the read-only `session.read` is eligible for an opt-in auto-approve. **Integration:** register these tools in `src/main/mcp/`, enforce the policy at the approval boundary, and log each call to `aiAudit` — credentials never leave main, exactly as today. Long-running commands stay observable (the agent polls `session.read`) without blocking approvals.

## #97 — Inline preview detection (this PR's core)

`detectPreview(content)` classifies output as `image` (data-URI or base64-signature), `json` (object/array), `table` (CSV/TSV with column+row counts), or `text`, best-effort and side-effect-free, in an order that won't mistake a multi-line JSON array for CSV. **Integration:** the renderer (`components/terminal`, `components/sftp`) draws the preview inline via the M6 image path for images and lightweight table/tree views for data; an SFTP "quicklook" streams a bounded prefix so a huge file can't hang the renderer. Previews attach to the command block that produced them, giving the #95 agent tools a structured artifact to reference/re-run.

## #96 — BYOK + local-model agent mode & universal agent tabs

Runs on the M5 backend abstraction: `none` (default/off), `ollama` (local), `openai-compatible` (BYOK); the API key is stored via `secrets.ts`, never in `settings.json`, never crosses to the renderer (a test already asserts no `apiKey` field). A visible **"local only"** badge from `isLocalBackend`; nothing leaves the machine unless the user configured a cloud backend and explicitly acted. Universal agent tabs promote the Prompt Book's agent launch into first-class, resumable sessions with run history — the "your keys, your models, your machine" stance Warp structurally can't match.

## Test / validation

`agent-tools.test.ts`: registry invariants (every mutating tool gated; `session.read` the only read-only); `requiresApproval` always gates mutating tools and fails closed on unknown, relaxes reads only on opt-in; `detectPreview` for data-URI + bare-base64 images, JSON object/array, JSON-array-not-CSV, CSV/TSV with counts, and text fallbacks (prose, single line, empty, inconsistent delimiters). `lint` / `typecheck` / `test` / `build` green. No MCP runtime, no network, no secret flow in the core.
