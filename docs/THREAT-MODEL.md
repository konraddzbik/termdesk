# TermDesk threat model & security posture

This is the "state it out loud" trust page (issue #59). Every claim here is
checkable against the MIT source — if one is wrong, that itself is worth
reporting (see [`SECURITY.md`](../SECURITY.md)).

## What TermDesk is, in trust terms

- **Local-first. No account. No telemetry.** TermDesk stores everything on your
  machine. It has no sign-in, sends no usage data, and operates no relay or sync
  server. The **only** outbound request is an optional launch-time GitHub
  Releases update check (`api.github.com`) — a from-source build can avoid even
  that.
- **Open source (MIT).** The whole client is auditable. There is no closed
  server component that your keystrokes or credentials pass through.

## Where secrets live and how they flow

- **One module touches secrets.** `src/main/store/secrets.ts` is the only caller
  of Electron `safeStorage`. Passwords, passphrases, VNC and RDP passwords are
  encrypted the moment they arrive in the main process and stored only as
  ciphertext (`*_enc` columns).
- **The renderer never receives a secret.** Repositories reduce secrets to
  booleans on the way out (`hasPassword`, `hasPassphrase`, …). The two documented
  exceptions — the VNC password for noVNC and the RDP password for the IronRDP
  client — are tracked as known limitations in `SECURITY.md`.
- **On Linux, encryption fails closed.** If no OS keyring is available, TermDesk
  refuses Chromium's insecure `basic_text` fallback rather than pretend to
  encrypt (`CONTRIBUTING.md`, `SECURITY.md`).
- **Ciphertext is machine-bound.** The safeStorage key lives in the OS keychain,
  so a stolen database file is not enough to read secrets, and a vault export is
  metadata-only by design (see the M8 export envelope).

## Connection integrity

- **SSH host-key verification** with a SHA-256 fingerprint prompt on first
  connect, a hard block on a changed key, and a loud possible-MITM warning.
- **Trust-on-first-use pinning** for VNC server keys (`vnc_known_keys`) and RDP
  TLS certs (`rdp_known_certs`): a changed fingerprint on a pinned endpoint
  refuses the connection.
- **VNC is tunneled by default** over SSH with single-use, 30-second bridge
  tokens, so port 5900 is not exposed on the default path. (A `direct` VNC mode
  is available for VNC-only hosts that opt into it.)

## How TermDesk contrasts with the field

| Concern | Common incumbent behavior | TermDesk |
|---|---|---|
| Credential storage | mRemoteNG: plaintext-recoverable (CVE-2023-30367); PuTTY: sessions in the registry | Encrypted vault, OS-keychain-bound, renderer never sees secrets |
| Account / telemetry | Warp: telemetry on by default; RealVNC: forced cloud account | None — no account, no telemetry, no relay |
| Auditability | WindTerm: "partially open source" closed binary | Fully MIT; every claim here is in the source |
| Supply chain | Xshell ShadowPad backdoor (2017) memory | Open source; signed & (goal) reproducible builds |

## Roadmap items that harden this further

- Signed & notarized releases + reproducible builds (#58, extends #18/#19).
- Self-update that only walks forward, from this repo's Releases (`updater.ts`,
  `allowDowngrade=false`; verified in `updater.test.ts`; real-feed exercise is #25).
- Performance budgets so a regression can't quietly degrade the app (#56).
