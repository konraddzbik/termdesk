# Open-source delivery plan

Review of the public TermDesk repository for the work that actually helps
other people **use** the app: installer/packages, from-source setup, and
contributor setup. GitHub Issues and Milestones on `konraddzbik/termdesk`
are the shared tracker (the token cannot use GitHub Projects).

**GitHub fact (2026-08-26):** `konraddzbik/termdesk` has **no tags and no
Releases**. `INSTALL.md` / README must not be treated as already shipping
downloadable installers.

## Review findings

### What already works

- The repo is public MIT. `npm install && npm run dev` opens a usable app with
  no licence check, seat, or account (`README.md`, `CHANGELOG.md`).
- `CONTRIBUTING.md` is unusually honest about the two native-module traps
  (Electron ABI vs Node for `better-sqlite3`; `npm run dist` leaving x64
  modules on an Apple Silicon checkout).
- Packaging config is complete: `electron-builder.yml` names macOS `.dmg`
  (arm64 + x64), Windows NSIS, Linux AppImage + `.deb`. `npm run dist` is
  `--publish never`.
- CI (`ci.yml`) runs preflight + verify, then a matrix package job that
  uploads unsigned installers as Actions artifacts (14-day retention).
- `release.yml` is wired: tag `v*` → verify → per-OS package → **draft**
  GitHub Release. Tag must equal `v` + `package.json` version. macOS native
  modules are arch-checked before upload.
- OSS files exist: `LICENSE`, `EULA.txt` (binaries only), `SECURITY.md` with
  private reporting, CoC, issue/PR templates, Dependabot, `scripts/preflight-public.mjs`.

### What is false or blocking outsiders

1. **Invented downloads.** `INSTALL.md` opened with "Download an installer from
   the Releases page" and called the Apple Silicon `.dmg` "Published". README
   talked about "prebuilt installers published on the Releases page". The bug
   template described "the published macOS build for 0.4.0". None of that can
   be true with zero tags and zero Releases. `/releases/latest` 404s.
2. **From-source is the real product and was not first-class in INSTALL.md.**
   README quick start omitted Node `>=22.12.0` and a C/C++ toolchain — both
   required to compile `better-sqlite3` / `node-pty`.
3. **The release pipeline has never been run.** Cutting a first `v*` tag is
   still required before anyone can download an installer. Local `npm run dist`
   on this Mac cannot produce Windows/Linux artifacts; CI is that path.
4. **Contributor traps remain even when documented.** Missing Node prebuild
   cache → `npm test` dies; `npm run dist` then `npm run dev` dies on arch
   mismatch; Linux without a keyring fails closed; missing Xcode CLT /
   `build-essential` yields opaque `node-gyp` errors.
5. **Stale docs.** `CONTRIBUTING.md` cites `electron-builder.yml:29-37` for the
   dual-arch block (now around the `mac.target` entries). README test-count
   (637) and coverage badges will drift.

### Out of scope for this plan's implementation

Code signing / notarization, store listings (Homebrew, winget, Flathub, Snap,
AUR, npm-as-library), new product features, E2E-on-every-PR, SBOM, a project
website, and closing Dependabot PRs unless they block a started milestone.

## Milestones

| Milestone | Purpose | Implementation |
|---|---|---|
| **User install path** | Docs and checks match GitHub: from-source first-class; no invented download; artifact names and tag↔version testable | Started in this change |
| **Contributor setup** | Remaining package traps that still block a fresh clone (`npm test`, post-dist arch, toolchain, Linux keyring, stale line numbers) | Not started |
| **Community polish** | First real GitHub Release, signing, badge drift, Dependabot, homepage/security.txt, E2E-on-PR | Not started |

## Issues

Opened on `konraddzbik/termdesk`. Every item below is an issue; GitHub
Milestones with these same three names are the tracker grouping.

### User install path

| # | Title |
|---|---|
| [#8](https://github.com/konraddzbik/termdesk/issues/8) | INSTALL.md and README invent a published GitHub Release |
| [#9](https://github.com/konraddzbik/termdesk/issues/9) | From-source must be the first-class install path until a v* tag exists |
| [#10](https://github.com/konraddzbik/termdesk/issues/10) | Add a testable install/package contract (artifact names, tag vs version, no invented downloads) |
| [#11](https://github.com/konraddzbik/termdesk/issues/11) | Bug report template assumed a published 0.4.0 arm64 installer |
| [#12](https://github.com/konraddzbik/termdesk/issues/12) | Updater and UPDATING.md send users to /releases/latest as if a build exists |
| [#26](https://github.com/konraddzbik/termdesk/issues/26) | CI package job does not verify macOS native-module architecture |

### Contributor setup

| # | Title |
|---|---|
| [#13](https://github.com/konraddzbik/termdesk/issues/13) | better-sqlite3 Electron-vs-Node ABI trap still fails npm test without a cached prebuild |
| [#14](https://github.com/konraddzbik/termdesk/issues/14) | npm run dist on macOS leaves native modules on the x64 ABI |
| [#15](https://github.com/konraddzbik/termdesk/issues/15) | CONTRIBUTING.md cites stale electron-builder.yml line numbers |
| [#16](https://github.com/konraddzbik/termdesk/issues/16) | Linux keyring requirement is easy to miss from README |
| [#17](https://github.com/konraddzbik/termdesk/issues/17) | Missing C++ toolchain produces opaque node-gyp failures on first npm install |
| [#27](https://github.com/konraddzbik/termdesk/issues/27) | CONTRIBUTING.md points the better-sqlite3 Node rebuild at ci.yml; it lives in verify.yml |
| [#28](https://github.com/konraddzbik/termdesk/issues/28) | Uninstall docs omit the vault in OS userData |
| [#29](https://github.com/konraddzbik/termdesk/issues/29) | SFTP smoke cannot finish inside the 90s runner timeout |

### Community polish

| # | Title |
|---|---|
| [#18](https://github.com/konraddzbik/termdesk/issues/18) | Cut the first GitHub Release so unsigned installers actually exist |
| [#19](https://github.com/konraddzbik/termdesk/issues/19) | Code signing and notarization are blocked on Apple/Windows certificates |
| [#20](https://github.com/konraddzbik/termdesk/issues/20) | Consider running E2E smoke on pull requests once the manual workflow is proven |
| [#21](https://github.com/konraddzbik/termdesk/issues/21) | README test-count and coverage badges will drift |
| [#22](https://github.com/konraddzbik/termdesk/issues/22) | Review open Dependabot PRs separately from install-path work |
| [#23](https://github.com/konraddzbik/termdesk/issues/23) | Project homepage / security.txt |
| [#24](https://github.com/konraddzbik/termdesk/issues/24) | Confirm Intel macOS x64 native-module arch check before the first Release attaches that dmg |
| [#25](https://github.com/konraddzbik/termdesk/issues/25) | Windows/Linux self-update has never been exercised against a real GitHub Release feed |
| [#30](https://github.com/konraddzbik/termdesk/issues/30) | EULA and CoC point at Discussions / a profile page; the repo has no public question path |
| [#31](https://github.com/konraddzbik/termdesk/issues/31) | DEPLOYMENT.md promises MSI and an internal update server this client cannot use |

## First implementation (User install path)

This milestone is the one that changes the outsider setup path:

- `INSTALL.md` / `README.md` / `docs/UPDATING.md` / bug template / updater
  copy now describe from-source as what works, and state that GitHub has no
  tags and no Releases. Unsigned CI package artifacts (14-day Actions
  retention) are documented as the only current binary download, not as a
  Release.
- `src/main/install-contract.ts` is the config-loader. Tests in
  `src/main/install-contract.test.ts` drive the real parser and
  `checkRepoInstallContract` against this checkout. `RELEASED_ARTIFACTS` is
  the empty inventory; update it when the first Release is published.

Later milestones stay on separate PRs.

## How a first Release will work (not done here)

1. `package.json` version is the stamp electron-builder will put on artifacts.
2. `git tag v<that-version> && git push origin v<that-version>` — the tag
   string must equal `v` + version or `release.yml` fails.
3. Review the **draft** GitHub Release, then publish it by hand.
4. Set `RELEASED_ARTIFACTS` in `src/main/install-contract.ts` to the attached
   filenames and adjust INSTALL.md so the contract still passes.
