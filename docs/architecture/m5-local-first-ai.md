# Architecture review — Local-first AI (Milestone M5)

Scope: issues #44 (command blocks), #45 (NL→command + explain-failed-command), #46 (local & BYO-key AI backends), #47 (approval-gated agent UX). Positioning: **Warp's AI power without Warp's strings.**

This PR lands the **AI backend abstraction** (`src/shared/ai-backend.ts`) — the contract everything else in the milestone runs on — and reviews how blocks, NL→command, and the agent UX integrate with TermDesk's existing MCP/Prompt-Book/vault architecture.

## What already exists

- **MCP integration, Prompt Book, and Routines** already make TermDesk AI-forward (`src/main/mcp/`, `prompts-repo.ts`, `routines-repo.ts`, `ai-audit` table). MCP tool calls are already **approval-gated and audited** (`aiAudit`, `mcp/approvals.ts`). So #47 is largely a UX-surfacing job, not new safety machinery.
- **The vault pattern** (`secrets.ts`, hosts exposing `hasPassword` not the password) is the template for how an AI API key is handled: stored in safeStorage, only `hasApiKey` crosses to the renderer.

## #46 — Backend abstraction (this PR)

`AiBackendConfig` is renderer-safe by construction: `{ kind: 'none' | 'ollama' | 'openai-compatible', baseUrl?, model?, hasApiKey? }` — **no `apiKey` field** (a test asserts this). `kind: 'none'` is the default, so **AI is off until the user opts in**. Helpers: `validateAiBackend`, `resolveChatEndpoint` (Ollama `/api/chat`, OpenAI-compatible `/v1/chat/completions`), and `isLocalBackend` (Ollama / loopback → drives the "local only" privacy badge). Pure — no network.

### Integration plan (follow-up)
1. **Settings** — add `aiBackend` to `settingsSchema` (`src/shared/ipc.ts`) using this shape. The API key is **not** in `settings.json`: store its ciphertext in a new vault column/table, encrypted through `secrets.ts` (which is encrypt/decrypt only — it has no storage of its own).
2. **Main** — a small `ai-client.ts` in `src/main` that takes the resolved endpoint + the key (decrypted **via `secrets.ts`**, never a direct `safeStorage` call, to keep `secrets.ts` the only `safeStorage` caller) and performs the chat call (streaming), reused by NL→command / explain / completion ranking. This is the only module that handles the key.
3. **Renderer** — a settings panel (backend picker + the "local only" indicator from `isLocalBackend`), and AI actions that are inert when `isAiEnabled` is false.

Privacy invariant: nothing is sent anywhere unless the user configured a backend and explicitly invoked an action; the key never leaves main; loopback backends light the "local" badge.

## #44 — Command blocks
Shell-integration-driven grouping of command+output in the xterm.js view (`src/renderer/components/terminal`). A block becomes the natural unit an MCP client can reference/re-run/explain (approval-gated). Degrades to a plain buffer without shell integration.

## #45 — NL→command + explain-failed-command
Palette action (NL→ an editable, never auto-run command) and a per-block "explain failure" on non-zero exit, both routed through the #46 backend. Reuses the Prompt Book templating (`src/shared/template.ts`) for the prompts.

## #47 — Approval-gated agent UX
Surface the existing MCP approval + `aiAudit` machinery as a first-class "visible plan + explicit approval + hands-never-keys" experience. Mostly renderer work over data that already exists.

## Test / validation
`ai-backend.test.ts`: off-by-default, validation (baseUrl/model), endpoint building per kind (+ trailing-slash trim), localness detection, and a guard that the config shape carries no secret. `lint` / `typecheck` / `test` / `build` green.
