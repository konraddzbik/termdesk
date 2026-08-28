# Architecture review — Performance, trust & distribution (Milestone M7)

Scope: issues #56 (startup/RAM budget + benchmark harness), #57 (won't-hang-your-session SSH/PTY hardening), #58 (signed & reproducible releases — extends #18, #19), #59 (public threat model). This milestone also **absorbs the still-open release issues #18, #19, #25** into the product roadmap.

This PR lands the **performance-budget core** (`src/shared/bench-metrics.ts`) + a runnable harness scaffold (`scripts/bench.mjs`) for #56, and the **public threat model** (`docs/THREAT-MODEL.md`) for #59.

## #56 — Performance budgets (this PR + follow-up)
`checkBudgets(results, budgets)` compares measured metrics (cold start, keystroke latency, heavy-output throughput, idle RSS/session) against per-metric `max`/`min` budgets, treating a *missing* measurement as a failure (an unverifiable budget is not a pass). `formatBudgetReport` renders CI-log lines. `scripts/bench.mjs` emits results in that shape (`--json`), with app-dependent metrics marked `pending` until the harness drives a packaged build.

Follow-up: a CI job runs `bench.mjs` on each platform, pipes results into `checkBudgets` with agreed budgets (target: <~1s cold start; bounded idle RSS/session), and fails on regression; numbers are published in the README.

## #57 — Won't-hang-your-session hardening
The reliability narrative Tabby just lost (russh hangs on vim-over-SSH; memory leaks). Harden the SSH/PTY path (`src/main/ssh`, `src/main/terminal`) against large/continuous output backpressure, full-screen TUIs, rapid resize, and long-idle sessions; add stress tests (huge output, TUI apps, memory-over-time) to the smoke/e2e suite. No new secret flow.

## #58 — Signed & reproducible releases (extends #18, #19)
Cut the first Release (#18), add Apple notarization + Windows signing once certs exist (#19), and pursue reproducible builds so the published binaries verify against source. The client-side self-update wiring is already in place and tested (`updater.ts` / `updater.test.ts`, PR #37); #25 (real-feed exercise) unblocks once the first Release exists.

## #59 — Public threat model (this PR)
`docs/THREAT-MODEL.md` states the posture out loud — local-first, no account/telemetry, one secrets module, renderer-never-sees-secrets, host-key/TOFU verification — with a comparison table against the incumbents' known weaknesses (mRemoteNG CVE, PuTTY plaintext, Warp telemetry, Xshell ShadowPad). Link it from the README (follow-up).

## Cross-milestone note
This milestone is the foundation the rest of the roadmap ships on: a fast, trustworthy, signed client. It deliberately re-homes the Community-polish release issues (#18 first Release, #19 signing, #25 self-update-vs-real-feed) so they sit next to the performance and trust work they belong with.

## Test / validation
`bench-metrics.test.ts`: pass when budgets met, fail on exceeded max / unmet min / missing measurement, and report formatting. `scripts/bench.mjs` runs and emits the metric shape. `lint` / `typecheck` / `test` / `build` green.
