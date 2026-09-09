# Architecture review — Resilient & durable sessions (Milestone M11)

Scope: issues #91 (auto-reconnect + session persistence), #92 (mosh-style UDP roaming transport), #93 (self-healing tunnels & port-forwards), #94 (resumable SFTP transfers). Epic: #102.

This PR lands the **reconnect state machine** (`src/shared/reconnect.ts`) — the anchor of the milestone (#91) that #93 and #94 reuse verbatim — and reviews how roaming/durability integrate with the existing SSH/tunnel/SFTP layers. No IPC/UI wiring here; the pure state machine is the low-risk, fully-tested foundation.

## Why this milestone (competitor evidence)

Sessions that survive IP roaming, laptop-sleep and flaky Wi-Fi are strongly praised but CLI-only today: **Wave Terminal v0.14 "Durable Sessions"**, **iTerm2**/**WezTerm** session persistence, **Eternal Terminal** auto-reconnect, **mosh** UDP roaming (bundled by MobaXterm as a selling point), and **SecureFX 9.7** transfer pausing. M7 #57 hardened against *hangs* (backpressure) but did **not** add reconnect — this milestone adds the missing half and makes TermDesk's existing tunnel/SFTP features reliable across network changes.

## #91 — Reconnect state machine (this PR's core)

`reduceReconnect(state, event, opts)` is a pure, deterministic machine over `connected → reconnecting → failed` with exponential `nextBackoff` (capped) and a `maxRetries` give-up ceiling. The transport drives it with events (`drop` / `attempt-failed` / `success` / `manual-retry` / `give-up`) and reads `nextDelayMs` to schedule the next attempt; `describeReconnect` renders the status-dot/tab label. No timers, clock, or randomness live here, so backoff and the ceiling are unit-tested in isolation (a caller may add jitter on top).

**Integration (follow-up):** the main-process session layer (`src/main/ssh` / `session-manager`) owns the timer and the actual re-dial, holds the terminal scrollback across the gap, and — when the session program is a multiplexer (tmux/Zellij/screen, already selectable in Settings) — **reattaches** to the existing remote session instead of spawning a fresh shell. The renderer shows the `reconnecting…` state and a manual retry/give-up control.

## #93 — Self-healing tunnels (reuses this core)

The tunnel manager (`src/main/store/tunnels-repo.ts`, `-L`/`-D`) already has a live status dot; today a dropped upstream SSH connection silently kills the forward. Feed the same `reduceReconnect` machine per tunnel: on drop, re-establish the forward when connectivity returns, mapping `connected/reconnecting/failed` onto the existing status dot. Local listeners are held (or cleanly re-bound) so client apps pointed at the forward need not restart where feasible.

## #94 — Resumable SFTP (reuses this core)

The SFTP streaming queue already does chunked, constant-memory transfers with cancel/retry. On a transport drop, an in-flight transfer becomes **paused** (not failed) and, once the session's reconnect machine returns to `connected`, resumes from the last confirmed offset (SFTP supports offset reads/writes), with a size/offset (optionally checksum) integrity check so a partial write can't silently corrupt. Recursive transfers resume at the file that was in flight.

## #92 — mosh-style UDP roaming (the risk item)

Optional per-host resilient transport: when `mosh-server` is present, bootstrap it **over the existing SSH connection** (no relay, no account) and hand the session to a UDP roaming channel with local echo/prediction. Capability detection + graceful fallback to plain SSH (backed by the #91 machine) when unavailable. **Spike first:** a client-side roaming UDP implementation inside Electron is a real cost; keep #92 de-scopable to "detect `mosh-server` + document" if the client proves too heavy.

## Cross-milestone note

The reconnect machine here is also the substrate the M13 mobile story leans on (a thin client wants the same roaming/reconnect semantics), and it composes with M10's PQ transport — reconnection re-negotiates the same hardened KEX.

## Test / validation

`reconnect.test.ts`: exponential backoff + cap + non-positive attempts; give-up ceiling; drop→reconnecting; per-attempt backoff; success reset; `maxRetries` (incl. immediate fail at 1); manual-retry revival; give-up from any state; redundant-drop and wrong-state event ignores; status labels. `lint` / `typecheck` / `test` / `build` green. No secret flow, no network, no timers in the core.
