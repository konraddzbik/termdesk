# Releasing TermDesk

This is the runbook for cutting a GitHub Release. Today the project has **no tags and no
Releases** — from-source is the supported install path (see [`INSTALL.md`](INSTALL.md)). Cutting the
first Release (#18) is a deliberate, manual action; this document is the checklist for doing it
safely.

## What a Release is here

A Release is created **only by pushing a `v*` tag**. That tag push runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which:

1. Runs the full verify suite (lint + typecheck + `npm test`). A tag can no longer ship artifacts
   without the tests passing.
2. **Verifies the tag equals `v` + `package.json`'s `version`.** `electron-builder` stamps artifacts
   from `package.json`, so a tag that disagrees would ship mislabelled binaries — the job fails
   closed instead.
3. Builds unsigned installers for macOS, Windows and Linux.
4. **Fails closed on a native-module architecture mismatch** (the same `lipo -archs` check the CI
   package job runs) — so a broken Intel `sshcrypto.node` can never reach a Release asset.
5. Attaches the installers to a **draft** GitHub Release. Nothing is public until you publish the
   draft by hand.

## Cutting a Release — checklist

1. Pick the version. Ensure `package.json`'s `version` is what you intend to release (bump it in its
   own PR if needed; `CHANGELOG.md`'s top section should describe it).
2. Confirm `main` is green (CI on the merge commit).
3. Tag and push — the tag **must** be `v` + the exact `package.json` version:
   ```bash
   git tag v$(node -p "require('./package.json').version")
   git push origin v$(node -p "require('./package.json').version")
   ```
4. Watch the `Release` workflow. If the tag/version gate or the arch check fails, **fix the cause and
   re-tag** — do not force a Release around a red check.
5. Review the **draft** Release GitHub creates: the attached `.dmg` / `.exe` / `.AppImage` / `.deb`
   and the `latest*.yml` update-feed files.
6. Publish the draft when you are satisfied. That is the moment the Releases page becomes a real
   download source, and the in-app updater has something to fetch.

## Known constraints at first Release

- **Unsigned (#19).** Code signing and notarization are blocked on Apple Developer ID and Windows
  code-signing certificates. Until those secrets are configured, every OS shows a one-time "unknown
  developer" warning and **macOS builds cannot self-update** (Squirrel.Mac refuses an unsigned app —
  `platformSegment()` returns `null` on `darwin`). The signing hooks are already wired in
  `release.yml` / `electron-builder.yml`; see [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md).
- **Intel macOS x64 (#24).** The x64 cross-build has shipped a wrong-arch `sshcrypto.node` before, so
  CI builds macOS **arm64-only** and the arch check gates the dual-arch build in `release.yml`.
  Confirm the Intel `.dmg` passes that check on the first Release before advertising an Intel
  download.
- **Self-update is unproven until a Release exists (#25).** The Windows/Linux updater points at this
  repo's Releases (`src/main/updater.ts`; wiring covered by `src/main/updater.test.ts`), but the
  end-to-end feed can only be exercised once the first Release is published. Verify an in-app update
  from the first Release to a second before relying on it.
