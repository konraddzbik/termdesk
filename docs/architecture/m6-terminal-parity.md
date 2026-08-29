# Architecture review — Terminal power-user parity (Milestone M6)

Scope: issues #49 (history-learning autocompletion), #50 (inline image/Sixel), #51 (scrollback search), #52 (keyword highlighting + command shortcuts + broadcast input), #53 (config-as-code), #54 (serial/Telnet).

This PR lands the **history-learning completion ranking core** (`src/shared/completion.ts`) — the heart of #49 — and reviews how the rest integrates with the xterm.js terminal and existing session/settings layers.

## #49 — Completion ranking (this PR)
`rankCompletions(history, prefix, opts)` blends **frequency + recency** to rank prefix-matching candidates, de-duplicated and capped, with deterministic tie-breaking. Pure and offline — it must be good without AI; an optional AI re-rank (via the M5 backend, #46) can layer on top later.

Integration (follow-up): the main process supplies per-host + global command history (a small ring buffer per host, persisted); the renderer's terminal input shows the top suggestion as ghost text / a dropdown and accepts on a key. No secret involvement.

## #51 — Scrollback search (smallest, do first)
xterm.js ships a `@xterm/addon-search`. Wire it into `TerminalView.tsx` with a find bar (Cmd/Ctrl+F, incremental highlight, next/prev, case/regex, match count). Pure-client; a `good first issue`.

## #50 — Inline image / Sixel
xterm.js image addon for Sixel/iTerm2/Kitty protocols in the terminal, plus SFTP thumbnail previews in the file browser (`components/sftp`). Bound/stream large images so the renderer can't hang.

## #52 — Highlighting + command shortcuts + broadcast
- **Highlight rules** (regex→color) applied to terminal output — a pure rule engine (next `src/shared` module) feeding a rendering decorator.
- **Command shortcut bar** — buttons that send a snippet/script to the active session; reuses `snippets-repo`.
- **Broadcast input** — mirror keystrokes across the panes of a split / hosts of a group; extends the existing split-pane + fleet-automation plumbing (`session-manager`, `automation`).

## #53 — Config-as-code
Export/import of profiles, keybindings, highlight rules, and settings as a declarative YAML/TOML/JSON file — GUI for the 90% case, declarative for the 10%, no scripting language (the WezTerm-Lua pain). Foundation shared with the M8 vault export (#61): the non-secret settings envelope.

## #54 — Serial / Telnet
New session types alongside SSH (`src/main/ssh` → a sibling transport), sharing tabs/scrollback/logging. Serial needs a native serialport binding; Telnet is a plain socket. Absorbs the Tabby/WindTerm niche on top of TermDesk's SSH+SFTP+VNC+RDP breadth.

## Test / validation
`completion.test.ts`: prefix filtering, frequency ranking, recency tie-break, exclude-typed-prefix, case sensitivity, empty-prefix full ranking, dedup + limit, empty history. `lint` / `typecheck` / `test` / `build` green.
