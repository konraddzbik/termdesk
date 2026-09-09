# Architecture review — Modern SSH auth & post-quantum trust (Milestone M10)

Scope: issues #86 (FIDO2 hardware-security-key SSH), #87 (passkey / resident-key identities), #88 (OpenSSH certificate support), #89 (post-quantum hybrid KEX), #90 (SSH-agent hygiene), plus the positioning matrix #100. Epic: #101.

This PR lands the **auth & transport core** (`src/shared/ssh-auth.ts`) — the pure, dependency-free heart of the milestone — and reviews how each issue integrates with TermDesk's existing SSH/secrets architecture. Following the M4–M9 pattern, **no IPC/UI wiring lands here**: the core is the low-risk, fully-tested foundation; wiring lands in follow-ups tracked by the issues above.

## Why this milestone (competitor evidence)

Modern authentication is the widest-open lane in the SSH-client market (2026-09-09 competitor research): only **Termius** ships FIDO2/passkeys and it is **cloud-gated behind a forced account**; **SecureCRT/Xshell** stop at smart cards / PKCS#11; **PuTTY** and **mRemoteNG** have nothing. Meanwhile **post-quantum SSH became the OpenSSH 10.0 default** (Apr 2025; 10.1 warns without it) driven by "harvest-now-decrypt-later", and **agent-forwarding hijacking** is a widely-cited footgun. TermDesk can own "modern, phishing-resistant SSH auth — with no account and no cloud".

## What already exists (so the milestone is smaller than it looks)

- **ProxyJump chains via `forwardOut`** already exist (`session-manager`), so #90's "prefer ProxyJump over agent forwarding" is a *default + advisory* job, not new plumbing.
- **The secrets invariant** — `src/main/store/secrets.ts` is the only `safeStorage` caller and the renderer never sees private material — is exactly the boundary FIDO2/passkey/cert private keys must respect (the private key never leaves the token/enclave, so it is *even easier* to keep the invariant).
- **M4's inheritance resolver** (`src/shared/host-inheritance.ts`) already cascades `credentialId`/`proxyJump` down the folder tree, so #88's per-folder certificate/CA inheritance falls out of the same resolver.

## #89 — Post-quantum key exchange (this PR's core)

`orderKexAlgorithms()` builds the client's KEX offer with the PQ hybrids `mlkem768x25519-sha256` (OpenSSH 10.0 default) and `sntrup761x25519-sha512@openssh.com` **ahead of** the classical fallbacks, de-duplicated in preference order, optionally intersected with the server's supported set. `kexProtection(negotiated)` classifies what was actually used so the session panel can show a **"post-quantum protected"** badge (or a neutral state). Pure — a test asserts every PQ hybrid sorts before any classical algorithm.

**Integration (follow-up):** pass `orderKexAlgorithms()` into the `ssh2` client's `algorithms.kex`. **Spike first:** confirm the bundled `ssh2`/crypto stack exposes ML-KEM; if not, this issue's real cost is the library bump, which the spike sizes.

## #88 — OpenSSH certificate validity (this PR's core)

`certValidityState(cert, { now })` classifies a user certificate as `not-yet-valid` / `valid` / `expiring-soon` / `expired` against a caller-supplied clock, and `describeCertValidity` renders the badge label. Short-lived CA-signed certs are the enterprise direction (Teleport/Vault); TermDesk is a **cert consumer, never a CA** — it must warn on/near expiry rather than fail opaquely at connect. **Integration:** import `id_*-cert.pub` alongside the key, present it via `ssh2`, and (optionally) let a host/folder point at a user-configured signing command to refresh a cert before connect. Certificates inherit down the tree via M4.

## #86 / #87 — FIDO2 hardware keys & passkeys

`authMethodInfo(kind)` ranks methods for the connection UI (hardware-backed FIDO2 + platform passkeys are strongest and phishing-resistant); `isSecurityKeyType` detects the `sk-*` OpenSSH key types. **Integration:** generate/use `sk-ed25519@openssh.com` / `sk-ecdsa-sk` via the platform FIDO2/CTAP stack (YubiKey/SoloKey/Nitrokey for #86; Secure Enclave / Windows Hello for #87). Only the key handle + public part enter the vault; the private key stays on the token/enclave — a *stronger* form of the existing secrets invariant. **Spike first:** confirm `ssh2` can present `sk-*` credentials or identify the middleware/native module needed; this spike gates the milestone's sizing.

## #90 — SSH agent hygiene (this PR's core)

`agentForwardingAdvice({ agentForwarding, hasProxyJump })` returns a stable, keyable advice code — loudest when forwarding is on with no ProxyJump. **Integration:** default agent forwarding off, surface the warning on enable, add per-identity key timeout + an agent-lock action, and show whether forwarding is active in the session panel. Documented in `docs/THREAT-MODEL.md`.

## #100 — Positioning matrix

A docs-only companion (README section + `docs/`) that makes the "no account, no telemetry, MIT, PQ, FIDO2" story explicit vs Termius/Warp/MobaXterm/SecureCRT/RDM/Remmina/RustDesk. Guard every claim with the existing doc-contract test pattern so it can never drift into the "invented capability" class the OSS review caught.

## Test / validation

`ssh-auth.test.ts`: PQ-first ordering + server intersection + PQ-only + no-overlap; `kexProtection` classification; cert validity across all four states incl. unbounded; badge rendering (minutes vs hours); agent advice levels/codes; auth-method ranking; `sk-*` detection. `lint` / `typecheck` / `test` / `build` green. No secret flow, no network, no `ssh2` dependency in the core.
