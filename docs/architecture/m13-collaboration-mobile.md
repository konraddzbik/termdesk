# Architecture review — Collaboration & mobile-ready foundation (Milestone M13)

Scope: issues #99 (mobile-ready sync contract), #98 (relay-optional shared read/write terminal). Epic: #104. Priority P3 (forward bets). Both strictly local-first: no relay, no account.

This PR lands the **sync contract core** (`src/shared/sync-contract.ts`) — the pure, versioned meta + conflict model of #99 — and reviews the exploratory pair-terminal work (#98) as a spike. No IPC/UI wiring here.

## Why this milestone (competitor evidence)

Two lower-urgency but differentiating bets from the 2026-09-09 research:

- **Mobile is where Termius has real moat** — its cross-device encrypted vault is repeatedly the "worth paying for" feature. We won't build a mobile client now, but the research is explicit: *the mistake to avoid is a desktop that can never later sync to mobile.* So we lock a forward-compatible sync contract onto the M8 work now (#99).
- **No polished GUI client offers a turnkey pair/shared terminal** — it's all manual shared-tmux-over-SSH today, which needs a shared host, shell access, and firewall/relay gymnastics. A relay-optional shared read/write terminal is genuinely novel for team/DevOps buyers (#98).

## #99 — Sync contract (this PR's core)

`makeSyncMeta(prev, { deviceId, now })` stamps a versioned envelope with a **monotonic revision** (a lineage counter, not a timestamp, so ordering is stable across disagreeing clocks), the writing device id, and `updatedAt`. `detectSyncConflict(local, remote, lastSyncedRevision)` is a pure three-way merge decision — `in-sync` / `local-ahead` / `remote-ahead` / `diverged` — and `resolveSync` maps it to `none` / `push` / `pull` / `conflict`. `isCompatibleContract` refuses a newer major so an old client never corrupts data it can't read. **A divergence is always a conflict the user resolves — never a silent overwrite** (a test asserts this).

**Integration (follow-up):** wrap the M8 secret-stripped export envelope (`vault-export.ts`, #61) with this meta and persist `lastSyncedRevision` per remote. The BYO-storage sync (#62) reads/writes the envelope to the user's chosen file / Git remote / S3 / WebDAV — TermDesk runs no server and sees no plaintext. Publish the contract in `docs/` as a stable spec an independent (mobile) client could target. This is the guardrail that keeps M8 forward-compatible; it does **not** build a mobile client.

## #98 — Relay-optional shared terminal (spike)

Share an active session read-only or read/write with another user over a **user-controlled channel** — the lowest-friction path is **tmux control-mode** on the shared host (already available via the multiplexer program selection), so both sides drive the same live buffer with no relay and no account. Host controls: grant/revoke write, list participants, end sharing; sharing rides the existing SSH session's trust, secrets are never exposed to the guest, and every share start/stop lands in the Activity log. **Spike first** to confirm the tmux-control-mode MVP before committing to a bespoke transport; keep the first cut minimal.

## Cross-milestone note

The sync contract composes with M8 (#61/#62 provide the envelope this wraps) and leans on M11's reconnect semantics for a future thin mobile client (same roaming/reconnect behavior). The pair-terminal spike reuses the multiplexer integration that M11's session-persistence work also touches.

## Test / validation

`sync-contract.test.ts`: revision starts at 1 and increments; version compatibility (accept current/older, refuse newer); the four conflict states; comparison→action mapping; and the never-silently-overwrite invariant. `lint` / `typecheck` / `test` / `build` green. No clock, no id generation, no I/O in the core.
