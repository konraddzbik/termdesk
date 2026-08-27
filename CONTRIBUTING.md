# Contributing to TermDesk

TermDesk is an Electron application: a privileged **main** process that owns SSH, SFTP, VNC, RDP and
the encrypted vault; a sandboxed **renderer** (React 19 + Tailwind 4) that owns nothing sensitive;
and a typed IPC contract between them. Three native modules (`better-sqlite3`, `node-pty`, `ssh2`)
are compiled locally against Electron's ABI, which makes the build environment less forgiving than a
typical web project. The two "traps" sections below exist because both failures look exactly like
code bugs and are neither — read them before filing an issue that starts with "tests don't run".

Follow this file top to bottom and you get a working checkout.

## Prerequisites

- **Node 22.12+** and **npm 10+**. `.nvmrc` pins the exact version CI uses (`nvm use`),
  and every workflow reads it via `node-version-file`, so local and CI never drift.
  The floor is not arbitrary: `electron` and `@electron/rebuild` both declare
  `node >= 22.12.0`, so Node 20 cannot build the native modules the app ships.
- A C/C++ toolchain, because native modules are built locally by `node-gyp`: Xcode Command Line
  Tools on macOS, `build-essential` + `python3` on Linux, the Visual Studio C++ build tools on
  Windows.
- **Docker** — only if you intend to run the `ssh` / `sftp` / `vnc` smoke harnesses.
- **On Linux: an unlocked OS keyring** (gnome-libsecret or kwallet). Electron's `safeStorage` reports
  encryption as "available" even when it silently falls back to Chromium's `basic_text` backend,
  whose key is a public constant. TermDesk refuses that mode and fails closed
  (`src/main/store/secrets.ts:21-38`), so without a keyring you cannot save a host with a password.
  macOS (Keychain) and Windows (DPAPI) have no such fallback.

## Quick start

```bash
npm ci               # postinstall: patch-package, then rebuilds native modules for Electron
npm run doctor       # optional: verify Node, toolchain, better-sqlite3 ABI and (Linux) keyring
npm run lint
npm run typecheck
npm test             # 70 files, 650 tests at the time of writing
npm run build
npm run dev
```

One thing to know about that first run: **`npm run dev` opens a usable app.** There is no licence
check, no seat and no account — the commercial licensing subsystem is not part of this repository, so
nothing gates the host list.

`npm run lint`, `npm run typecheck` and `npm test` are all expected to be clean on `main`. The bar for
a pull request is that it keeps them clean; a new diagnostic is a review comment, not a footnote.

| Command | What it does |
|---|---|
| `npm run dev` | electron-vite dev server + Electron window, HMR |
| `npm run build` | typecheck (TS strict) then production build into `out/` |
| `npm run typecheck` | `tsc` over `tsconfig.node.json` and `tsconfig.web.json` |
| `npm run lint` / `lint:fix` | biome check (format + lint), with/without writing |
| `npm run doctor` | preflight: Node version, C/C++ toolchain, better-sqlite3 Node prebuild, Linux keyring |
| `npm test` | vitest, one pass |
| `npm run test:watch` | vitest in watch mode |
| `npm run test:coverage` | vitest with v8 coverage into `coverage/` |
| `npm run test:smoke <suite>…` | Electron smoke harnesses — see below; needs `npm run build` first |
| `npm run dist` | build + electron-builder installers into `dist/` (see trap 2) |

## Trap 1 — `better-sqlite3` is built for Electron, and vitest runs under Node

`postinstall` is `patch-package && electron-builder install-app-deps && node scripts/fix-node-pty-perms.mjs`.
The middle step compiles every native module against **Electron's** ABI, which is what the app needs
and what plain Node cannot load:

```console
$ node -e "require('better-sqlite3')"
Error: The module '.../node_modules/better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version …
```

`npm test` passes anyway. The eleven test files that touch the vault mock `better-sqlite3`, probe the
bundled binary once, and on ABI mismatch fall back to the Node-ABI prebuild that `prebuild-install`
cached under `~/.npm/_prebuilds`, injected through better-sqlite3's `nativeBinding` option — see the
comment and mock at `src/main/store/db.test.ts:17-66`. `node_modules` is left untouched, so the same
checkout runs both `npm test` and `npm run dev`.

That fallback needs the cached tarball
(`better-sqlite3-v<version>-node-v<abi>-<platform>-<arch>.tar.gz`). It is normally there, because
better-sqlite3's own install script runs `prebuild-install` before `install-app-deps` replaces the
binary. `npm run doctor` reports this exact condition before you hit it in a test run. If a test fails with
*"better-sqlite3 native binary targets Electron and no Node prebuild … is cached"*, you have two
options:

1. Re-run `npm ci` with network access, which repopulates the cache.
2. Do what CI does (the *Build better-sqlite3 for the Node test runtime* step in
   the `Verify` workflow, `.github/workflows/verify.yml`) and compile a Node-ABI binary from source:

   ```bash
   git apply -R patches/better-sqlite3+12.10.0.patch
   npm rebuild better-sqlite3 --build-from-source
   ```

   The patch adds `v8::kExternalPointerTypeTagDefault` and related fixes that Electron's V8
   requires; Node's V8 has no such symbol, hence the reverse-apply. **This leaves `node_modules`
   unusable by Electron** — `npm run dev`, `npm start` and every smoke harness will fail to load the
   module until you restore it with `npm ci` (or `npx patch-package && npx electron-builder install-app-deps`).

Only reverse the `better-sqlite3` patch. `patches/@novnc+novnc+1.7.0.patch` must stay applied; the
renderer build needs it.

## Trap 2 — after `npm run dist` on macOS, `node_modules` is built for the wrong architecture

`electron-builder.yml` builds **arm64 and x64** macOS artifacts in one run, deliberately, so a single
`latest-mac.yml` covers both chips — see the `arch:` list under the `mac:` / `dmg:` keys in
`electron-builder.yml`. The x64 leg rebuilds the native modules for x86_64 and leaves them that way.
Everything that runs `electron .` afterwards — the smoke harnesses, `npm run dev` — would then die
with an `incompatible architecture` dlopen error that reads like a code fault.

To stop that from biting, `npm run dist` has a **`postdist` hook** that runs
`electron-builder install-app-deps` automatically once packaging finishes, restoring `node_modules`
to the host architecture. You should not have to do anything. If you ever interrupt `npm run dist`
before the hook runs (Ctrl-C mid-build), restore the host arch by hand:

```bash
npx electron-builder install-app-deps    # restores the host architecture
```

If a native module suddenly fails to load and your last command was a *cancelled* `npm run dist`,
this is why.

## Smoke harnesses

The smoke suites run the real Electron main process headlessly, without opening a window. Build
first — they launch `electron .`, which loads `out/`.

```bash
npm run build
npm run test:smoke vault mcp                          # no external services needed
docker compose -f docker-compose.test.yml up -d       # SSH + TigerVNC in one container
npm run test:smoke ssh sftp vnc
docker compose -f docker-compose.test.yml down -v
```

Conventions worth knowing before you write one (`scripts/run-smoke.mjs`):

- The runner sets `TERMDESK_SMOKE=<name>`, and each harness prints `<NAME>_SMOKE_OK` or
  `<NAME>_SMOKE_FAIL: <reason>` and then calls `app.quit()`. Because the exit code is always 0,
  pass/fail is decided by **parsing stdout** for those markers. A suite that prints neither, or
  exceeds its wall-clock budget, counts as failed. The budget is 90 seconds by default; `sftp` gets
  12 minutes because its 1 GB transfer legitimately runs long (`TIMEOUTS_MS` in
  `scripts/run-smoke.mjs`). Add an entry there if you write a suite that needs more than 90s rather
  than raising the default for everyone.
- Harnesses always redirect the vault to a fresh temp database (`setSmokeDbPath`) before anything can
  open the real one. Keep that ordering if you add a suite; it is the only thing standing between a
  smoke run and a developer's actual hosts.
- Set `ELECTRON_NO_SANDBOX=1` where Chromium's setuid sandbox is unavailable (CI Linux runners).
  `.github/workflows/e2e.yml` shows the full Linux recipe: `xvfb-run`, `dbus-run-session`, and an
  unlocked `gnome-keyring` — without the keyring, `safeStorage` fails closed by design and every
  suite that stores a secret errors out.

The `ssh` harness's `key` and `key+passphrase` scenarios need `.test/test_key` and
`.test/test_key_enc`, and the container mounts `.test/authorized_keys`. All three are generated, none
are tracked:

```bash
npm run test:keys        # ssh-keygen x2 + a matching authorized_keys; --force to regenerate
```

Run it once before `docker compose up`, and again after regenerating either key — `authorized_keys`
is derived from whatever pair is on disk, so the two cannot drift. Never commit a private key here,
however loudly the filename says "test".

## Invariants new code must keep

These are load-bearing. A change that breaks one is a security bug, not a style disagreement.

### 1. Every IPC handler that takes an argument validates it

There are 99 `ipcMain.handle` / `ipcMain.on` registrations across `src/main/ipc/` plus
`src/main/updater.ts`, and every single one that accepts a parameter parses it with a zod schema
before use — either a named schema from `src/shared/ipc.ts` or an inline bound `z.string().min(1).max(200)`.
The argument is typed `unknown` and named `raw*` so an unvalidated use is visible on sight:

```ts
// src/main/ipc/hosts.ts:93
ipcMain.handle(IPC.hostsCreate, (_event, rawInput: unknown) => {
  const input = hostInputSchema.parse(rawInput)
  …
})
```

Handlers that take no argument need nothing (`src/main/ipc/logs.ts:6`). Channel names live in
`src/shared/channels.ts`, which must stay dependency-free — it is bundled into the sandboxed preload,
which cannot load zod. Schemas therefore go in `src/shared/ipc.ts`, which re-exports the channels.

### 2. Secrets are encrypted at the IPC boundary and never travel outward

`src/main/store/secrets.ts` is the **only** module that calls `safeStorage`. Plaintext exists solely
in transit renderer→main; it is encrypted immediately, stored only as ciphertext in `*_enc` columns,
and decrypted at connection time inside main. The renderer must never receive a decrypted secret or a
raw `*_enc` blob — repositories reduce them to booleans on the way out
(`hasPassword: row.passwordEnc !== null`, `src/main/store/hosts-repo.ts:96-97`; the renderer-facing
`hostSchema` exposes only `hasPassword` / `hasPassphrase` / `hasVncPassword` / `hasRdpPassword`,
`src/shared/ipc.ts:32-67`). New IPC has to preserve that shape.

The one deliberate exception, documented in `SECURITY.md` and `README.md`: the stored VNC password is
handed to the renderer for noVNC's credentials callback, and the RDP password returned by `rdp:open`
for the IronRDP client. Both are tracked as known limitations — do not add a third, and prefer
tightening the existing two (a single-use token the renderer redeems) over adding another.

### 3. Errors crossing back to the renderer are sanitized

Error messages routinely embed absolute paths and server-controlled text. `sanitizeErrorMessage()`
takes the first line only, replaces POSIX/Windows/`~` paths with `<path>`, and caps the result at 300
characters (`src/main/ipc/hosts.ts:33-50`). Never return a stack, and never log a secret — `redact.ts`
exists for that.

## Project layout

```
src/
  main/       privileged process: ssh/ sftp/ vnc/ rdp/ terminal/ store/ (vault, better-sqlite3 +
              Drizzle) mcp/ automation/ ipc/ (one file per channel group), updater.ts
  preload/    index.ts — the entire bridge. Sandboxed, dependency-free, channel names only.
  renderer/   React app: App.tsx, components/ (one directory per feature), hooks/, stores/ (zustand),
              lib/, types/
  shared/     channels.ts (channel names, no runtime deps), ipc.ts (zod schemas + inferred types),
              types.ts, redact.ts, template.ts, ai-harnesses.ts
```

`electron.vite.config.ts` builds all three targets; `@shared` and `@renderer` path aliases are
mirrored in `vitest.config.ts`.

## Tests

- vitest, `src/**/*.test.{ts,tsx}`, colocated next to the code under test.
- The default environment is `node`. A renderer test that needs a DOM opts in with a
  `// @vitest-environment jsdom` docblock at the top of the file — `environmentMatchGlobs` is gone in
  Vitest 4.
- Entry points (`src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`) and
  `*-smoke.ts` are excluded from coverage on purpose: the smoke suites cover them.

## Style

biome handles both formatting and linting (`biome.json`): 2-space indent, 100-column lines, single
quotes, semicolons only where needed, trailing commas, imports organized automatically. Run
`npm run lint:fix` before committing. Its scope is `src/**`, root `*.ts` and `*.json` — the `.mjs`
files in `scripts/` are not covered, so match their existing style by hand.

Comments in this codebase explain *why*, especially where something looks wrong but is deliberate.
That convention is worth keeping; several of them are the only record of a non-obvious platform
constraint.

## Before opening a pull request

1. `npm run lint && npm run typecheck && npm test && npm run build` — no new diagnostics, no new
   failures.
2. `node scripts/preflight-public.mjs` — the pre-publication exposure audit (credential patterns
   across all history, sensitive filenames, IP literals, a denylist of strings that must never
   return). It runs as its own `preflight` job in `.github/workflows/ci.yml` with `fetch-depth: 0`,
   because its history checks are meaningless on a shallow clone. Anything it flags must be resolved
   before merge.
3. If your change is user-visible, add it to `CHANGELOG.md` — under an `## Unreleased` heading if the
   top of the file is already a released version. Match the existing entries' style: what changed and
   why it mattered, not a list of commits.
4. Commit subjects use conventional-commit prefixes with a scope — `feat(hosts):`, `fix(settings):`,
   `fix(a11y):`, `docs(readme):`, `chore(release):`, `release:`. Keep them in the imperative and
   specific ("faithful ssh_config import — Include + Host * defaults", not "update host import").
5. Pull requests are **squash-merged**, so the PR title becomes the commit subject on `main` and
   carries the `(#NN)` reference. Write the title as the commit message you want to keep.

## Licensing of contributions

TermDesk is inbound=outbound: **by opening a pull request you licence your contribution under the
MIT License** in [`LICENSE`](LICENSE), the same terms as the rest of the source. There is no CLA to
sign and no copyright assignment — you keep the copyright in what you write.

One consequence is worth stating plainly rather than leaving you to infer it. The project also
publishes prebuilt installers, and those binaries carry additional terms ([`EULA.txt`](EULA.txt))
that restrict redistributing *the project's own builds*. The MIT licence you grant permits your
contribution to be included in them. It equally permits anyone — including you — to build and
redistribute TermDesk from source under MIT alone; `EULA.txt` says so in its own scope clause, and
the first-run prompt is compiled only into this project's release builds, so it never appears in a
build somebody else produces.

If you are contributing on an employer's time or equipment, please make sure you have the right to
licence the work before you open the PR.
