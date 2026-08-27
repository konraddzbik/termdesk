# Deploying TermDesk in Company / Enterprise Environments

> Scope: this describes what **this repository actually builds and ships**. It does not promise
> MSI packages, an internal update server, or currently-signed binaries — none of those exist here
> today. Where a capability is gated on future work, that is called out inline.

## Host kinds
When adding hosts, administrators and users can choose:
- **SSH only** — full terminal + SFTP
- **VNC only** — desktop access (direct or SSH-tunneled)
- **Both** — combined access

This allows clean separation for locked-down environments that only expose VNC (or only SSH).

## What the build produces

`electron-builder.yml` defines exactly these installer targets — there is **no MSI**:

| OS | Target | Notes |
|---|---|---|
| macOS | `.dmg` (+ `.zip` for the update feed) | arm64 and x64 in one run |
| Windows | **NSIS** setup `.exe` | per-user installer; deployable via SCCM/Intune/GPO by wrapping the `.exe` |
| Linux | `.AppImage` + `.deb` | — |

Builds are currently **unsigned** (code signing and notarization are tracked but blocked on
Apple/Windows certificates — see `docs/CODE_SIGNING.md`). Until signing is configured, every OS shows
a one-time "unknown developer" warning, and macOS builds cannot self-update. Plan your rollout around
unsigned artifacts, or build and sign in-house from source (MIT — see *Licensing* below).

## Recommended rollout

1. Produce installers from the release process (`.github/workflows/release.yml`), or `npm run dist`
   per OS. See `INSTALL.md` for artifact names and the per-OS "unknown developer" steps.
2. **Windows:** wrap the NSIS `.exe` for SCCM, Intune, or Group Policy software deployment. (There is
   no MSI target; if your tooling requires MSI you must repackage the NSIS installer yourself.)
3. **macOS:** because builds are unsigned today, ship a documented Gatekeeper step
   (`xattr -dr com.apple.quarantine …`) or wait for signing. A `.mobileconfig`/Intune profile can
   pre-trust a build once you sign it in-house.
4. **Pre-populating hosts (optional):**
   - Users can import from `~/.ssh/config`.
   - For fleets, provide a documented JSON import. Seeding the sqlite db during installation is
     possible but fragile — secrets still need per-machine `safeStorage` encryption, so a seeded db
     cannot carry passwords across machines.
5. **Default settings:** the `settings.json` in the user-data directory can be pre-seeded for terminal
   font, keepalive, theme, etc.

## Security considerations for deployment
- Review [`SECURITY.md`](../SECURITY.md).
- Train users on host-key acceptance (first-connect fingerprint dialog).
- Prefer SSH-tunnel VNC mode for any cross-network use.
- The app stores everything locally; no central telemetry. The only outbound request is the
  launch-time GitHub Releases update check (`api.github.com`), which a from-source build can avoid.

## Auto-updates
TermDesk's updater points at **this project's GitHub Releases** — the owner/repo are compile-time
constants in `src/main/updater.ts`, not a configurable endpoint. There is **no support for pointing
`electron-updater` at an internal/private update server**; a fork that wants its own update feed must
change those constants and rebuild. Until the first GitHub Release exists there is nothing to fetch,
and macOS self-update stays disabled while builds are unsigned (see [`UPDATING.md`](UPDATING.md)).

## Licensing
The source is MIT-licensed (`LICENSE`); the project's pre-built installers are additionally covered by
`EULA.txt`. A build you make yourself is governed by `LICENSE` alone, so a company is free to build,
sign, and deploy its own.

---
See `docs/CODE_SIGNING.md` for signing and notarization, and [`docs/UPDATING.md`](UPDATING.md) for the
update pipeline.
