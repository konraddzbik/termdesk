# Deploying TermDesk in Company / Enterprise Environments

## Host kinds
When adding hosts, administrators and users can now choose:
- **SSH only** — full terminal + SFTP
- **VNC only** — desktop access (direct or SSH-tunneled)
- **Both** — combined access

This allows clean separation for locked-down environments that only expose VNC (or only SSH).

## Recommended Rollout

1. Package signed builds from the official release process (see `.github/workflows/release.yml` and `docs/CODE_SIGNING.md`).
2. macOS: Use hardened runtime + notarization. Provide a company .mobileconfig or Intune profile if needed for Gatekeeper.
3. Windows: Signed NSIS or MSI installer. Can be deployed via SCCM, Intune, or Group Policy.
4. Pre-populating hosts (optional):
   - Users can import from ~/.ssh/config.
   - For fleets, provide a documented JSON import or seed the sqlite db during installation with care (secrets still need per-machine safeStorage encryption).
5. Default settings: The `settings.json` in user data can be pre-seeded for terminal font, keepalive, theme, etc.

## Security Considerations for Deployment
- Review SECURITY.md.
- Train users on host-key acceptance (first-connect fingerprint dialog).
- Prefer SSH-tunnel VNC mode for any cross-network use.
- The app stores everything locally; no central telemetry by default.

## Auto-Updates
Configure `electron-updater` pointed at your internal update server or private GitHub releases. Draft releases allow staged rollouts.

## Licensing
The source is MIT-licensed (`LICENSE`); the project's pre-built installers are additionally covered by `EULA.txt`. A build you make yourself is governed by `LICENSE` alone, so a company is free to build and deploy its own.

---
See `docs/CODE_SIGNING.md` for signing and notarization, and [`docs/UPDATING.md`](UPDATING.md) for the update pipeline.