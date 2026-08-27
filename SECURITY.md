# Security Model for TermDesk

TermDesk is a local-first desktop application. All sensitive operations and data stay on the user's machine.

## Core Security Principles

- **Main process owns everything sensitive**: SSH (`ssh2`), SFTP, VNC tunneling, and the encrypted vault (better-sqlite3 + Drizzle) run exclusively in the main (privileged) process.
- **Renderer is fully sandboxed**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`. No direct Node access or remote module loading.
- **Secrets never persist in plaintext**:
  - Passwords, passphrases, and VNC passwords are encrypted with Electron `safeStorage` (OS keychain) the instant they arrive via IPC.
  - Ciphertext is stored in SQLite. Decryption happens at the last possible moment inside the main process only (connection time).
  - On **Linux**, a real OS keyring (gnome-libsecret or kwallet) is **required**: if none is available/unlocked, `safeStorage` would silently fall back to a publicly-known static key, so TermDesk refuses to store or read secrets in that mode and surfaces an actionable error instead. macOS (Keychain) and Windows (DPAPI) have no such fallback.
  - The SQLite vault (and its WAL/SHM sidecars) is written with owner-only (`0600`) permissions on POSIX systems, inside a `0700` directory, as defense-in-depth.
  - **Two documented exceptions** where a decrypted credential does cross to the renderer:
    - the **VNC** password, per bridge session, to satisfy noVNC's credentials callback (`vnc:open`);
    - the **RDP** password, returned by `rdp:open` for the IronRDP client.

    Both are real and neither is currently bound to an open tab or rate-limited: `rdp:open` and
    `vnc:open` validate only a host id, so renderer-side code can call them per host. Tightening this
    to a single-use token the renderer redeems for the credential is tracked under Known Limitations.
- **Host kind scoping**:
  - Hosts can be SSH-only, VNC-only, or both.
  - Secrets are strictly scoped: a pure VNC host will not store (or send) SSH credentials. A pure SSH host will not store VNC credentials.
  - Attempting SSH-tunneled VNC on a VNC-only host produces a clear, sanitized error.
- **Host key verification**: SHA-256 fingerprints are verified against a local `known_hosts` table for the final target **and every ProxyJump hop**. Unknown keys require explicit user approval; a same-type fingerprint change hard-blocks the connection (OpenSSH-equivalent semantics).
- **VNC bridge protection**: the local WebSocket server binds `127.0.0.1` only, on a random port, with single-use 30-second tokens, and rejects WebSocket upgrades from any foreign `Origin` — so a browser tab on localhost cannot reach it, and nothing off-machine can.
- **Activity log privacy**: the local activity log stores the OS username, redacts secret-bearing tokens from logged commands, and purges entries older than 90 days. It is metadata only — never secrets.
- **Local terminals**: spawned shells inherit the user's environment minus TermDesk's own internal config (`TERMDESK_*` / `SSHDECK_*`), so app internals never leak into child processes or shell history.
- **IPC**: Every channel uses Zod-validated contracts (`src/shared/ipc.ts`), including length bounds on all renderer→main string inputs.
- **Navigation & external content**: Strict `will-navigate` + `setWindowOpenHandler` allow only same-origin dev server URLs or system browser for https links. No webviews.
- **Permissions**: Deny-by-default for all permission requests.

## VNC Direct vs Tunnel

- **Tunnel (recommended for most corporate use)**: VNC traffic rides an existing or dedicated SSH channel (`forwardOut`). The remote VNC port (usually 5900) is never exposed on the network.
- **Direct**: Plain TCP to the declared VNC port. Use only when the VNC server is on a trusted network or behind other controls. The UI and documentation now make this choice explicit per host kind.

## Data at Rest & in Use

- The SQLite database lives in the OS user data directory (`termdesk.db`).
- No secrets are ever logged (redaction + `sanitizeErrorMessage` on all error paths returned to the renderer).
- Application settings are plain JSON (no secrets).

## Cryptographic primitives (where the key lives)

- **Secrets at rest** are encrypted with Electron `safeStorage`, which delegates to the OS keystore: **macOS Keychain** (AES-128-GCM, key in the login keychain), **Windows DPAPI** (per-user), **Linux** gnome-libsecret/kwallet. The encryption key is held by the OS, not derived from anything TermDesk stores; TermDesk never writes a key to disk. On Linux, the insecure `basic_text` fallback is refused (see above).
- **Host-key fingerprints**: SHA-256, compared in full.
- **VNC bridge tokens**: 192 bits of CSPRNG entropy (`crypto.randomBytes(24)`), single-use, 30-second TTL.

## Known limitations

Stated plainly, because a security policy that only lists strengths is not one. These are open as of
v0.4.0 and are the issues worth reporting *progress* on rather than reporting as new:

- **`rdp:open` / `vnc:open` return a decrypted password to the renderer** for any stored host id, with
  no binding to an open tab and no rate limit. Renderer-side code can therefore enumerate stored RDP
  and VNC passwords. The fix is to return a single-use token the renderer redeems for the credential.
- **VNC key pinning can be bypassed by a security-type downgrade.** The RA2 (RSA-AES) server-key pin is
  only consulted when RA2 is negotiated, and nothing requires an encrypted security type — so an
  on-path attacker who simply does not offer RA2 is not checked against the pin. The patched noVNC
  picks the security type from a *client* preference list rather than the server's order
  (`patches/@novnc+novnc+1.7.0.patch`, item 5); `None` sits last in that list, so it is chosen only
  when a server offers nothing else, but nothing yet *refuses* a session that ends up unauthenticated.
- **VNC offers no transport encryption below RA2.** noVNC 1.7.0 implements no TLS-wrapped VeNCrypt
  subtype, so against a non-RealVNC server the realistic outcome is VNC auth — a DES-56
  challenge-response that does not put the password on the wire but leaves the session in cleartext.
  This is why the default `vncMode` is `tunnel`, where the RFB stream rides an SSH channel whose host
  key *is* verified. Direct mode is the exposed path, and it is what `kind: 'vnc'` hosts are forced to.
- **RDP and VNC trust the server's certificate/key silently on first use**, unlike SSH, which prompts.
- **There is no way to un-pin a trusted SSH host key, VNC key or RDP certificate** from inside the app.
  A legitimate key rotation (Windows RDP certificates roll roughly every six months) therefore makes a
  host unreachable with no in-app recovery.
- **Prompt quoting for AI-agent commands is POSIX-only.** `shellSingleQuote` protects a POSIX shell;
  on Windows the default shell is `cmd.exe`, where it does not. Treat the agent features as
  POSIX-only for now.
- **macOS builds are unsigned and unnotarized**, so they cannot self-update and Gatekeeper warns.
- Windows and Linux self-update is configured but has never been exercised end to end.

### Dependency advisories

`npm audit --omit=dev` reports **no advisories**: the packaged app ships nothing currently known to
be vulnerable.

That was not always true. This section previously recorded 5 advisories (3 high, 2 moderate) in
transitive production dependencies — `hono` and `@hono/node-server` (via
`@modelcontextprotocol/sdk`), `fast-uri` (via `ajv`), `ip-address` (via `express-rate-limit`, itself pulled in by `@modelcontextprotocol/sdk` — not by `ssh2`, as an earlier revision of this file claimed) and
`js-yaml` (via `electron-updater`) — and stated that `npm audit fix` did not clear them. That was
wrong. Every fix was transitive and inside a parent's existing semver range, so
`npm audit fix --package-lock-only` resolved all five without touching `package.json`.

`npm audit` over the full tree still reports 4 moderate advisories, all **development-only** and all
in the `esbuild` / `drizzle-kit` chain. They concern the esbuild dev server, which is never part of a
build and never runs on a user's machine, so they do not reach the packaged app. Clearing them needs a
major `drizzle-kit` downgrade, which is a worse trade than carrying them.

`@modelcontextprotocol/sdk` and `electron` are kept current so upstream fixes arrive as they land.

## Future hardening

- Optional master password / Argon2id layer for an additional encryption wrapper around the vault (beyond OS safeStorage).
- FIDO2 / hardware-backed key support (`ed25519-sk`) and per-host agent-forwarding policy (default off).
- Optional end-to-end-encrypted sync to a user-chosen backend (no mandatory cloud).
- SBOM generation and automated dependency vulnerability scanning in CI; reproducible builds.
- Optional crash reporting (opt-in, no PII by default).

## Reporting a vulnerability

**Report privately through GitHub, not in a public issue.** On the repository's
**Security** tab, choose **Report a vulnerability** — or go straight to
[`/security/advisories/new`](https://github.com/konraddzbik/termdesk/security/advisories/new).
That opens a draft advisory visible only to you and the maintainer, with a private
comment thread, so no detail is public until there is a fix. Do not use a public issue,
pull request or discussion, and do not push a proof of concept to a branch of this
repository.

Please include:

- a description and an impact assessment — what an attacker gains, and what they need
  first (local user access on the machine, a malicious remote host, a malicious MCP
  client, a hostile update feed, …);
- steps to reproduce, or a proof of concept;
- the affected version or commit, plus OS and architecture;
- whether the issue is already public anywhere.

**Do not put real credentials in a report.** No private keys, passwords, passphrases,
license keys or activation tokens, and no unredacted log — a VNC/RDP bridge URL contains
its own single-use token. Reproduce against throwaway credentials or the disposable test
container (`docker-compose.test.yml`) wherever that is possible.

TermDesk is maintained by one person; there is no bug bounty. The aim is to acknowledge a
report within **72 hours**, to give a triage verdict (confirmed / not a vulnerability /
needs more information) within **7 days**, and to ship a fix or mitigation for confirmed
high-severity issues promptly. If you have had no acknowledgement after a week, you may
open a public issue that says only that you filed a private report and gives no details.

Coordinated disclosure is appreciated; we will credit reporters who wish to be named.

TermDesk has **no project website today**, so there is no `/.well-known/security.txt` to serve — GitHub
private vulnerability reporting (above) is the sole and sufficient channel. If a homepage is added
later, it should serve an [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) `security.txt` pointing at
this same process; until then, do not expect one.

**Current version security posture**: Suitable for internal/company deployment when combined with OS-level protections, least-privilege user accounts on target machines, and proper host key hygiene.

---

TermDesk is open source under the MIT Licence: every claim in this document can be checked against the
source. If you find one that is wrong, that is itself worth reporting.