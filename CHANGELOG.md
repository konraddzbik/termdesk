# Changelog

## Unreleased — Open source

TermDesk's source is now published under the **MIT Licence**.

- **No licence check, no seat, no account.** The commercial licensing subsystem has been removed from
  this repository — `npm install && npm run dev` opens a usable app, and a build you make from this
  source is the whole application. There are no host-count caps: the previous free tier allowed 25 SSH
  and 15 VNC hosts, and that limit is gone entirely.
- **The Account tab and the upgrade prompts are gone** with it, along with the sidebar's
  "Plan: Free — n/25 SSH" line.
- **Self-update now uses this project's GitHub Releases** instead of a licence-gated feed, so checking
  for and downloading an update needs no credential — the same artifacts anyone can download and
  verify. A `beta` channel preference maps to GitHub pre-releases. macOS remains manual-download until
  the app is signed and notarized.
- Added `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `THIRD-PARTY-NOTICES.md`, issue and
  pull-request templates, and Dependabot. `EULA.txt` is now scoped to the pre-built binary installers
  only and explicitly does not restrict what the MIT Licence grants over the source.
- `SECURITY.md` now names a real reporting channel (GitHub private vulnerability reporting) instead of
  deferring to a profile page.
- **`scripts/preflight-public.mjs`** — a re-runnable audit that scans *all git history* for
  credential-shaped strings, sensitive filenames, committed build output, internal IP literals and
  denylisted hosts. It gates CI, so "no secret in the repository" stays a check rather than a claim.
- Fixed: a probe script shipped with a maintainer's internal LAN address as its default target; it now
  defaults to `127.0.0.1`.
- Fixed: five lint errors on `main` where the smoke harnesses' `useSmokeDbPath()` tripped biome's
  React hook rule. Renamed to `setSmokeDbPath()`.

### Open-source readiness review

*A second audit, this time of the extracted repository as a public artifact (eight dimensions with an
adversarial verification pass): 96 findings raised, 69 confirmed.*

- **A shipped installer could have its SSH host-key verification switched off by an environment
  variable.** `TERMDESK_SMOKE=<anything>` ran the app completely normally while every unknown host key
  was auto-accepted and written to `known_hosts` with no fingerprint dialog. The smoke and VNC-probe
  entry points are now unreachable in a packaged build, which also closes the probe path that decrypted
  a stored VNC password out of the real vault.
- **VNC no longer prefers security type `None` over every authenticated type.** The bundled noVNC patch
  chooses the security type from a client preference list rather than the server's order, and `None`
  sat first among the non-RA2 entries — so a server offering `VeNCrypt,None` got no authentication and
  no encryption. `None` is now last.
- **The first-run EULA prompt no longer appears in builds this project did not produce.** It was gated
  on "is this packaged", so a fork's `npm run dist`, a distro package or your own installer showed
  terms that `EULA.txt` and `LICENSE` both say do not apply to them.
- **No known-vulnerable code ships any more.** `npm audit --omit=dev` went from 5 advisories (3 high)
  to zero; the whole tree from 15 (1 critical, 8 high) to 4 that are development-only.
- **Electron 42 → 43**, and the Node baseline is now coherent: `.nvmrc` pins 22.22.3, `engines`
  requires `>=22.12.0` (what Electron itself declares), and every workflow reads `.nvmrc` instead of
  hard-coding the end-of-life Node 20 that release artifacts were being built on.
- **Releases are drafts again.** A tag used to publish a live public release of unsigned installers,
  and feed them to the updater, before anyone looked — and without running the test suite at all.
  Tests now gate a release, and both publish paths agree on `draft`.
- Contribution licensing is stated (inbound=outbound MIT, no CLA); `npm run test:keys` generates the
  SSH keys the smoke harness needs, which could not run on a fresh clone before; and `.gitattributes`
  stops a Windows checkout from CRLF-corrupting `patches/*.patch` and breaking `npm install`.

## v0.4.0 — Security & reliability hardening (2026-08-24)

*A full-system security + architecture review ahead of this release (six-dimension audit with an
independent verification pass) found no critical defect — the
Electron privilege boundary, the secret pipeline and the SQL layer all held up — and 40+ real
findings at the edges. This release fixes the ones that mattered.*

### Security

- **The AI approval dialog now shows the whole command that will run.** It previously displayed only
  the first 240 characters while executing the full string, so an agent could put a benign prefix in
  front of a payload and have the user approve something they never saw. The full (redacted) command
  is sent to the dialog, whitespace and newline padding is rendered visibly (`␣×n` / `⏎×n`) so a tail
  can't be pushed off the edge or below the fold, the character/line count is shown, and the accepted
  command length is capped to what the dialog can honestly display.
- **SFTP edit-in-place is now an extension allowlist, not a denylist.** The old list missed the entire
  Windows Script Host family — `.js` runs under `WScript.exe` with no execute bit — plus `.hta`,
  `.terminal` (macOS Terminal executes its embedded command), `.py`, `.rb` and anything a future OS
  association might add. A malicious server picks the remote filename, so anything not proven inert
  now gets a `.txt` suffix before the OS handler sees it.
- **MCP allowlist patterns must end on a token boundary.** An allow entry of `ip` silently
  auto-approved `iptables -F`; `ls` approved `lsblk`; `ps` approved `psql -c '…'`. The deny list also
  now catches split flags (`rm -r -f`, `rm --recursive --force`), not just `rm -rf`.
- **A routine whose directory is gone no longer runs in `$HOME`.** An explicitly requested directory
  that can't be resolved is an error instead of a silent fallback — with autonomy on, the old
  behaviour meant an approval-free agent running in the user's home directory the moment an external
  volume was unmounted.
- **A routine's AI agent is never substituted.** An unrecognised agent id used to fall back to Claude
  Code, which could turn a sandboxed routine into one carrying `--dangerously-skip-permissions`. It
  now fails with a message naming the routine.
- **The plan's host cap is enforced on every path that creates a host** — Duplicate and both importers
  wrote straight past it before.
- **The single-use VNC bridge token is no longer written to the log.** With `TERMDESK_VNC_DEBUG=1` the
  full `ws://` URL — token included — was appended to a world-readable file; only the port is logged now.
- `redactSecrets` now also covers passwords in URLs (`https://user:token@host`), `-u user:pass`, and
  credential headers beyond `Authorization`.
- Server-controlled SSH error text is length-capped before it is broadcast and stored.
- A bind address is only treated as loopback if it really parses as an address in `127.0.0.0/8` — the
  hostname `127.corp.example.com` used to skip the LAN-exposure confirmation and then resolve via DNS.
- The RDP pre-TLS parser rejects a TPKT length below the 4-byte header (a hostile server could
  otherwise make it discard buffered bytes).
- Auto-update now pins `allowDowngrade = false`; setting an update channel silently enabled downgrades
  upstream, letting a stale or tampered feed walk clients backwards onto an older build.
- The macOS entitlements no longer request `disable-library-validation` or
  `allow-unsigned-executable-memory` — the app is installed by drag-and-drop, so those would have
  opened a dylib-injection path to the vault key once signing lands.
- Temp copies made by SFTP edit-in-place are swept at startup. `before-quit` cleanup doesn't run on a
  crash, so a plaintext copy of an edited `.env` or private key could previously outlive the app.

### Reliability & data safety

- **The vault is snapshotted before any structural migration.** The one destructive statement in
  startup — the `hosts` table rebuild — now takes a consistent `VACUUM INTO` copy first
  (`termdesk.db.bak-<version>`, newest three kept), verifies referential integrity afterwards, and
  copies only the columns the old table actually has, so a database missing a legacy column degrades
  to defaults instead of refusing to open.
- **A failed migration no longer leaves a half-initialized database cached.** The connection is only
  published after every pragma, the bootstrap DDL and every migration succeed; otherwise it is closed
  and the error is raised instead of the app running a whole session against an un-migrated vault.
- **Only one TermDesk instance per vault.** Nothing stopped a second process from opening the same
  data directory — two routine schedulers, two MCP servers, two SQLite writers. A duplicate launch now
  focuses the existing window. `busy_timeout` is set for the cases that remain.
- **A dropped SSH connection can no longer take the whole app down.** ssh2's `forwardOut` throws
  synchronously when its socket dies, and the tunnel accept path called it unguarded — closing the
  terminal tab whose connection a tunnel had borrowed could kill every session in the app. That call
  is wrapped, the VNC/RDP bridges and the tunnel listener have lifetime `error` handlers instead of
  listen-time-only ones, and a last-resort handler keeps a stray throw from ending the session.
- **The VNC and RDP bridges can't leak a bound listener.** Two quick connections could each start a
  loopback server; the orphan stayed bound for the process lifetime. Startup is now single-flight.
- Settings are written atomically (write-then-rename), so a crash mid-write can't truncate the file
  and reset every setting.
- Saved port-forwards are deleted with their host instead of lingering in the sidebar as dead entries.
- Routine run history is capped per routine (newest 200, 90-day purge) and indexed. It was the only
  history table that grew forever, and its summaries embed the composed agent command.
- The vault and settings paths can no longer be repointed by an environment variable in a packaged
  build (dev/CI only), matching how the license and update endpoints already behave.

### Testing & tooling

- **The SMOKE harnesses no longer write into a real vault.** Each redirects the database to a temp
  path, but the dispatch ran *after* the routine scheduler had already opened and cached a handle on
  the user's real database — so the redirect had no effect. The harnesses now run before anything
  touches the vault, and redirect in-process so it works in a packaged build too.
- `release.yml` verifies that every packaged native module matches its target architecture. The
  x86_64 macOS bundle ships an arm64 `sshcrypto.node`, which `ssh2` swallows in a bare `catch` — so
  Intel Macs silently ran a different cipher path. **Only the arm64 macOS artifact is released for
  0.4.0** until the cross-build is fixed.

### Docs

- `docs/UPDATING.md` no longer tells the maintainer to flip a `MAC_AUTO_UPDATE` symbol that has never
  existed; it names the real change (`platformSegment()` in `src/main/updater.ts`) and the
  notarization switch.

## v0.3.9 — Prompt Book & Routines, faithful ssh_config import, settings resilience (2026-08-24)


### Prompt Book — reusable prompts (M1)

- **Prompt Book** — a new sidebar section holding reusable prompts for AI agents. Prompts are
  plain text with `{{variable}}` placeholders (optionally `{{name:default}}` / `{{name|description}}`,
  matching Warp's convention); when you run one, TermDesk asks for any variable values, shows a
  live preview, and sends the rendered text into the **active terminal** — SSH **or** local PTY.
- Create/edit/delete prompts with a title, body, optional description and tags; "New prompt" is in
  the ⌘K palette, and the section can be hidden from Settings → Sidebar sections like any other.
- **Security:** templating is logic-less pure substitution (a value that looks like `{{x}}` or
  shell metacharacters is inert — no re-scanning, no eval); prompts are stored plaintext like
  snippets, with an in-form reminder not to embed secrets.

### Prompt Book — run in an AI agent (M2)

- **Run a prompt in an AI agent, in a folder.** Each Prompt Book entry gains a **Run in agent**
  action: pick an agent (**Claude Code, Aider, OpenCode, Codex, Gemini** — or your saved default),
  fill any variables, choose a directory, and TermDesk opens a local terminal there running the
  composed command. Interactive and visible — you watch the agent work and can stop it.
- **Settings → Default AI agent** picks which agent that action defaults to (installed agents are
  detected on PATH; detection only runs `--version`, never a real prompt).
- **Security:** prompt text is never concatenated into a shell string — it is a single
  POSIX-quoted argument (or a quoted heredoc for stdin-style agents), so `;`, backticks and `$( )`
  in a prompt are inert. Auto-approve / "skip permissions" flags are **never** added here (that is a
  Routines opt-in). Harness profiles + command composition are pure and unit-tested.

### Routines — definitions & manual runs (M3)

- **Routines** — a new sidebar section for saved "run *this prompt* through *this agent* in *this
  directory*" jobs. Create a routine (prompt + agent + directory + preset variable values + an
  optional schedule), **Run now** to launch it in a visible local terminal, and see a per-routine
  **run history**.
- **Autonomy is opt-in and off by default**, behind an explicit, plainly-worded toggle ("run
  without approval prompts — only for directories you fully trust").
- Every run is recorded to a `routine_runs` history table; the launched command is **redacted**
  (`redactSecrets`) before it is stored as the run summary, so secrets never land in the DB.

### Routines — the scheduler (M4)

- **Scheduled routines now fire.** A once-a-minute main-process loop runs due routines on their
  **interval / daily / cron** schedule, opening a visible terminal (via the M3 run pipeline). All the
  scheduling math (next-run, due selection, a 5-field cron subset) is a **pure, unit-tested** module.
- **Honest, local-first semantics:** routines fire while TermDesk is open; a run missed while the
  app was closed **catches up once** on next launch (not once per missed interval).
- **Settings → Run scheduled routines** is a master switch (default on) to pause all scheduling;
  manual "Run now" always works. Editing a routine reschedules it from now.
- Stability: the tick loop is `.unref()`'d and wrapped so a bad routine can never crash the app;
  the scheduler owns `nextRunAt` (recording a run no longer clears it).

### Faithful `~/.ssh/config` import

- **`Include` directives are now resolved during import.** The importer follows `Include` lines
  (tilde `~/`, absolute, and paths relative to `~/.ssh`), expands globs in the final path segment
  (sorted, dotfiles skipped), and handles multiple/quoted paths per line — splicing each file in at
  the directive's position so an `Include` inside a `Host` block continues that block, exactly as
  OpenSSH resolves it. Bounded and best-effort: include cycles, excessive depth, runaway file
  fan-out, and oversized configs are all capped, and a missing include is skipped rather than
  failing the import.
- **`Host *` and wildcard-pattern blocks now merge into concrete hosts.** A `Host *` (or `prod-*`,
  or a mixed line with `!` negations) contributes its `HostName`/`Port`/`User`/`IdentityFile`/
  `ProxyJump` to every alias it matches, following OpenSSH first-obtained-wins-in-file-order. Real
  configs that keep shared defaults in a `Host *` block now import those defaults instead of
  dropping them.
- The import button reports **"Imported N (skipped S) from M files"** when includes were followed.

### Fixed

- **Settings no longer reset wholesale when one field is rejected.** `getSettings()` used to fall
  back to *all* defaults if `safeParse` failed on the whole object, so a single value a newer build
  no longer accepts (a removed enum member, a tightened numeric range) discarded every other
  setting — the "my settings reset after updating" symptom. Parsing is now field-resilient: the
  whole-schema fast path first, then per-field validation that keeps everything still valid and
  defaults only the offending key. On-disk persistence itself was already version-safe (`userData`
  is pinned to `<appData>/termdesk`, no version in the path).

### Customizable sidebar

- **Show or hide left-sidebar sections.** A new **Sidebar sections** control (Settings → General, or
  the new *Customize sidebar* button in the sidebar toolbar) lets you toggle each section — **Hosts**
  (with its search box), **Local terminals**, **Workspaces**, **Tunnels**, and **Snippets** — on or
  off. Hidden sections disappear from the sidebar until you re-enable them.
- **Everything visible by default**, and the choice is per-section and persisted. Old settings files
  (and any section absent from a saved file) parse to "visible", so nothing is ever hidden that you
  didn't turn off yourself. The branding row, action toolbar, and footer (Add host / imports) always
  remain, so the sidebar is never left unusable.

## v0.3.8 — Choose your terminal, and open in external terminals (2026-08-17)

### Open in external terminal (Ghostty, Warp, iTerm2, …)
- **Hand a directory off to your favorite GUI terminal.** TermDesk now detects the popular external
  terminal emulators installed on your machine — **Ghostty, Warp, iTerm2, kitty, Alacritty, WezTerm,
  GNOME Terminal, Konsole, Windows Terminal** — and can open the current directory in one, spawned as
  its own window. Available from the ⌘K palette ("Open in external terminal") and a one-click button
  on every local terminal tab.
- **Saved preference** in Settings → General; empty means "the OS default terminal". Detection never
  launches the emulator (it uses `open -Ra` on macOS and `which`/`where` elsewhere), so probing can't
  pop stray windows. Per-emulator launch flags set the working directory correctly (e.g.
  `--working-directory`, `--cwd`, `-d`), falling back to the spawn cwd for flag-less apps.
- These are GUI *emulators* (they draw their own windows), distinct from the in-tab terminal program
  below (which runs *inside* TermDesk's PTY).

### Choose your terminal program

- **Pick what runs when a terminal opens.** Settings → General now has a **Terminal program**
  dropdown, replacing the single tmux checkbox. Choose your default login shell, a **multiplexer**
  (tmux, Zellij, GNU Screen — attach-or-create, persist across restarts/disconnects) or an
  **alternate shell** (bash, zsh, fish, PowerShell, Nushell). Only programs detected on your machine
  are selectable; unavailable ones are shown greyed out.
- The choice applies to **both local terminals and SSH sessions**: locally it spawns the program in
  the PTY (falling back to your login shell when it isn't installed), and on SSH it `exec`s the
  program on the remote when present (guarded by `command -v`), otherwise a plain shell — same
  graceful degradation the tmux integration already had.
- **Backward compatible.** An existing `tmuxEnabled: true` setting is migrated once to
  `terminalProgram: 'tmux'` on first read; nothing else changes for existing users.

## v0.3.7 — Two directories at once, phase 3 (2026-08-17)

- **Auto-run a command per directory.** A local terminal can carry a `runOnOpen` command that fires
  once after the shell connects, and workspace directories now each take an optional command. So a
  saved workspace can **start Claude in directory A and Grok in directory B automatically** when
  opened side by side. The workspace dialog gained a per-directory command field. (Broadcast-to-all
  and OSC-7 live-cwd remain on the roadmap.)

## v0.3.6 — Two directories at once, phase 2 (2026-08-17)

- **Open two directories side by side** — pick two folders and get two local terminals in a split,
  in one action (also in the ⌘K palette).
- **Saved workspaces** — a named set of directories opened side by side in one click, managed from
  a new sidebar *Workspaces* panel (name + directories, persisted). Purpose-built for the
  "Claude in directory A, Grok in directory B" workflow.

## v0.3.5 — Two directories at once, phase 1 (2026-08-17)

Working in two directories side by side (e.g. Claude in one, Grok in another) was already possible
via multiple local terminals + split panes, but hard to discover. Phase 1 makes it reachable:
- **Open terminal in folder…** — pick a directory and open a local terminal there directly (no need
  to save it first), from the sidebar toolbar and the ⌘K palette.
- **Duplicate current terminal** — open another shell in the active terminal's directory.
- **Split panes side by side** — a discoverable palette command for the existing split feature.
- Release reliability: the release workflow now builds platforms serially so parallel jobs can't
  race to create the GitHub Release (which intermittently dropped a platform's installer).

## v0.3.4 — Terminal clipboard fix (2026-08-17)

- **Copy/paste no longer injects "weird characters."** Pasting clipboard text with `\r\n` line
  endings (Windows and many web sources) used to write a stray carriage return to the PTY, which
  renders as `^M` and acts as a double Enter; copied text could also carry invisible control /
  zero-width / BOM bytes or leftover bracketed-paste markers. Terminal copy now strips that noise
  and paste folds all line endings to a single `\n`. Applies to SSH and local terminals; unit-tested.

## v0.3.3 — AI Activity history & usage + scroll rework (2026-08-17)

Validated: `typecheck` ✅ · `biome` ✅ · **525 tests passing** ✅ · `build` ✅.

### AI Activity → History, Search & Usage estimate
- **Searchable history + verdict filter.** The AI Activity tab (TermDesk's record of every
  agent/MCP action) gains a search box (host / command / client) and an Allowed / Needs-approval /
  Denied filter.
- **Approximate usage & cost.** Each executed command now records the byte size of its input and
  output (new `ai_audit.in_bytes` / `out_bytes` columns + migration). The tab estimates tokens
  (~bytes/4) and cost against a **user-selected model rate** (Claude Opus/Sonnet/Haiku, Grok,
  GPT-4o) and shows totals per view.
- **Honest by design.** TermDesk is the MCP *server* — the LLM runs in the client, so it cannot
  see the provider's real token usage or even which model was used. The figure is clearly labeled
  "approximate — relayed I/O × the selected model's list price, not a provider bill." Real
  provider-accurate token/cost would require the client to report usage and is out of scope.

### Scroll rework
- **Truncation fixed app-wide:** the shadcn `ScrollArea` viewport no longer forces its content to a
  `display:table` wrapper, so `truncate` works everywhere it's used.
- **Consistent scrollbars:** a single theme-aware scrollbar style for every raw overflow region
  (matching the Radix ScrollArea look) + `overscroll-behavior: contain` on inner scrollers.
- **Sidebar footer protected:** the Local terminals / Tunnels / Snippets panel stack is bounded and
  scrollable so it can no longer push the "Add host" footer off-screen on short windows.

### Deferred (documented)
Provider-accurate token/cost (needs client-side reporting); full sidebar "Vault" IA rework and
append-only stick-to-bottom / prepend-anchor for Logs & AI Activity (need live layout
verification); configurable audit retention.

## v0.3.2 — Review hardening + UX (2026-08-14)

A full 5-track review (security · architecture · docs · competitive · UX/UI) landed as one
version. No Critical/High security issues were found; the items below are hardening, correctness,
and polish. Everything is validated: `typecheck` ✅ · `biome` ✅ · **519 tests passing** ✅ ·
`npm run build` ✅. Shipped as PRs #24–#30 (fast-forwarded into `main`).

### Security
- **Host-key MITM warning.** A known host that presents a key of an algorithm never trusted for it
  used to show the benign "unknown host key" first-contact prompt — the exact shape of a
  downgrade attack. Now classified as `changed`: it still prompts (a legitimate new algorithm
  isn't a permanent lockout) but with a distinct, destructive **"possible man-in-the-middle"**
  dialog and the accept action de-emphasised. Same-type key changes remain a hard block.
- **MCP inventory scoping.** `list_hosts` / `list_groups` now return only hosts you've opted into
  for AI read/exec — no more enumerating infrastructure the agent was never granted.
- **Tunnel LAN-bind guard.** A tunnel's listen address can no longer silently bind to a
  non-loopback address (e.g. `0.0.0.0`); doing so now requires an explicit "Expose on the network"
  confirmation, surfaced in the tunnel dialog with a warning.
- **Terminal-link confirmation.** Clicking a link printed by a remote server's (untrusted) terminal
  output now shows a native confirm dialog with the URL before opening the browser.

### Reliability / correctness
- **No leaks on quit.** A direct Cmd-Q with a window open no longer leaks SSH port-forwards,
  in-flight transfer temp files, open SFTP channels, or edit-watch temp dirs — they're all torn
  down in `before-quit` before the SSH sessions.
- **SFTP dedicated-connection cleanup.** A self-closing SFTP channel now releases its dedicated SSH
  connection instead of orphaning it.
- **Host-key prompt cleanup.** Tearing down sessions now clears any outstanding host-key prompt's
  timer + callback (previously left dangling for up to 60s).
- **Fewer re-renders.** The session-tab strip no longer re-renders on unrelated store changes
  (shallow-selected), and terminal/SFTP tabs no longer re-render on unrelated host edits
  (single-host selection).

### UX / UI
- **System theme.** New theme option that follows the OS `prefers-color-scheme` and updates live
  when the OS flips light/dark (default stays dark).
- **Show secrets.** A "Show secrets while typing" toggle reveals all four host-form secret fields
  (password / passphrase / VNC / RDP) so you can verify what you typed.
- **Command palette.** A **Recent** group (open sessions, most-recent-first) at the top of `⌘K`,
  plus a footer legend (`↵ open · ↑↓ navigate · esc close`).
- **SFTP accessibility.** The file browser is now keyboard- and screen-reader-operable: focusable
  rows with Enter to open/download, and sort headers are real buttons with `aria-sort`.
- **Light-theme parity.** AI Activity verdict badges and the "Upgrade" links no longer assume dark
  mode; micro-text below WCAG contrast was lifted to legible sizes/opacities.

### Docs / build
- **README/docs truth-up.** Corrected License section + docs links; corrected test/coverage
  numbers and the update feed; added `INSTALL.md` with per-OS download & install steps.
- **Release pipeline.** The tag workflow now attaches installers to a (draft) GitHub Release
  (quota-proof, separate storage), tolerates missing publish secrets, and can be run manually via
  `workflow_dispatch`.

### Deferred (documented)
L3 MCP audit attribution (stateless-transport limitation); host-kind-first host-form reorder;
sidebar "Vault" IA consolidation.
