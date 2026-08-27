# Updating TermDesk

## How updates reach users

TermDesk checks this repository's **GitHub Releases** on launch via
`electron-updater`'s `github` provider (see `src/main/updater.ts`; the release
workflow publishes there via `electron-builder.yml` → `publish`). That feed is
empty today: `konraddzbik/termdesk` currently has **no tags and no GitHub
Releases**, so there is nothing to download or self-update to. Once a Release
exists, no credential is involved in either direction — the update is the same
artifact anyone can download from the Releases page and verify (see
[`INSTALL.md`](../INSTALL.md)). A **beta** channel preference maps to GitHub
*pre-releases* rather than a separate feed. What happens on update depends on
the platform and whether the build is code-signed.

| Platform | Signed build | Unsigned build (current default) |
|----------|--------------|----------------------------------|
| Windows (NSIS) | Auto: downloads + prompts to restart | Auto: downloads + prompts to restart |
| Linux (AppImage) | Auto: downloads + prompts to restart | Auto: downloads + prompts to restart |
| **macOS** | Auto: downloads + prompts to restart | **Manual:** prompts and opens the download page |

**Why macOS is different:** macOS in-app updates use Squirrel.Mac, which only
applies an update if the app is **code-signed and notarized**. An unsigned macOS
build cannot self-update — Squirrel rejects it. So unsigned macOS builds fall
back to opening the Releases page (empty until the first tag is published;
see [`INSTALL.md`](../INSTALL.md)) where, once a Release exists, the user
downloads the new `.dmg` and replaces the app.

macOS is disabled in code by `platformSegment()` in `src/main/updater.ts`, which
returns `null` on `darwin` — `initUpdater()` then returns early and the renderer
banner reports `canSelfUpdate: false`. (There is no `MAC_AUTO_UPDATE` flag; an
earlier revision of this document referred to one that never existed.) See
"Enabling true macOS auto-update" below.

You can always trigger a check manually from **Help ▸ Check for Updates…**.

## Updating an installed macOS app (manual, unsigned builds)

Until a GitHub Release exists, build from source or run `npm run dist` — there
is no `.dmg` to download. Once a Release is published:

1. Open **Help ▸ Check for Updates…** (or the menu prompt on launch), then click
   **Download** — or go straight to the
   [Releases page](https://github.com/konraddzbik/termdesk/releases).
2. Download the `.dmg` for your chip:
   - Apple Silicon (M1/M2/M3/M4): **`TermDesk-<version>-arm64.dmg`**
   - Intel: **`TermDesk-<version>-x64.dmg`**
3. Open the `.dmg`. In the install window, **drag TermDesk onto the Applications
   folder**, replacing the existing copy.
4. Quit and relaunch TermDesk.

> Download the **`.dmg`**, not the `-mac.zip`. The zip is the auto-update payload
> (used by `electron-updater`), not the human installer — it has no install
> popup. The `.dmg` is the one with the drag-to-Applications window.

## Cutting a release (maintainers)

No `v*` tag has been pushed to `konraddzbik/termdesk` yet, so this path has
never produced a GitHub Release. When you are ready:

Releases are cut by tagging. To publish real, downloadable installers:

1. Bump `version` in `package.json`.
2. Tag and push (use the matching version):
   ```bash
   git tag v0.3.1
   git push origin v0.3.1
   ```
3. `.github/workflows/release.yml` builds macOS (arm64 + x64 `.dmg` + update
   zips), Windows, and Linux, then publishes a **draft** GitHub Release with all
   assets attached. Review and publish it.

Once a signed macOS build is published, macOS auto-update can be enabled — see
the checklist below.

## Enabling true macOS auto-update

1. Configure Apple Developer ID signing + notarization secrets (see
   `docs/CODE_SIGNING.md`) and **uncomment `notarize: true`** under `mac:` in
   `electron-builder.yml`. Signing without notarization still leaves Gatekeeper
   refusing the app, and Squirrel.Mac still refusing to update it.
2. Add a `publish:` block under `mac:` in `electron-builder.yml`, mirroring the
   `win:`/`linux:` blocks exactly — `provider: github` with `releaseType: draft`.
   Without it no macOS update metadata is ever uploaded. (An earlier revision of
   this step described a bucket path for a generic provider. That belonged to a
   feed this project no longer uses, and copying it would produce a config that
   does not publish.)
3. In `src/main/updater.ts`, make `platformSegment()` return `'mac'` on `darwin`
   and add `'mac'` to the `PlatformSegment` type, so `configure()` points at the
   `…/mac` feed instead of bailing out.
4. Confirm the entitlements are still sufficient for a signed build. `build/
   entitlements.mac*.plist` deliberately request only `allow-jit`;
   `disable-library-validation` and `allow-unsigned-executable-memory` were
   removed in v0.4.0 and should only be re-added if a signed build demonstrably
   fails without them.
5. Cut a signed release. From then on, macOS clients download and apply updates
   in-app like Windows and Linux.
