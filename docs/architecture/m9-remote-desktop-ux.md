# Architecture review — Remote-desktop UX (Milestone M9)

Scope: the roadmap milestone [Remote-desktop UX](../../issues?q=milestone%3A%22Roadmap%3A+Remote-desktop+UX%22) — issues #65 (file transfer over RDP/VNC), #66 (multi-monitor/scaling), #67 (wake-on-LAN), #68 (secure-by-default docs + optional browser share).

This PR lands the **wake-on-LAN core** (`src/shared/wake-on-lan.ts`) and reviews how the rest of the milestone integrates with the existing architecture. It intentionally ships no UI/IPC wiring — the pure packet builder is the low-risk, fully-tested foundation; the wiring lands in follow-ups tracked by the issues above.

## Existing architecture this milestone builds on

- **Secrets never cross to the renderer.** `src/main/store/secrets.ts` is the only `safeStorage` caller; the RDP/VNC passwords are the two documented exceptions handed out for the IronRDP/noVNC clients. Any new remote-desktop feature must preserve this (see `CONTRIBUTING.md` invariant 2).
- **TOFU pinning already exists** for VNC (`vnc_known_keys`) and RDP (`rdp_known_certs`) — issue #68's "secure by default" story is largely already engineered; it needs documenting, not building.
- **Hosts carry `proxyJump` + a tunnel manager** (`src/main/store/tunnels-repo.ts`, `-L`/`-D`), and VNC already defaults to `vncMode:'tunnel'` over SSH — the substrate for "WoL through a jump host" (#67) and "browser share over the user's tunnel" (#68).

## #67 — Wake-on-LAN (this PR's core + integration plan)

`buildMagicPacket(mac)` returns the canonical 102-byte payload (6×0xFF + MAC×16) as a `Uint8Array` — no `Buffer`/`dgram` dependency, so it stays in `@shared` and is unit-tested in isolation.

Integration (follow-up):
1. **Schema** — add a nullable `mac TEXT` column to `hosts` (mirror in `db.ts` bootstrap DDL, per the schema.ts note). Additive + backward-compatible.
2. **IPC** — a `hosts:wake` channel in `src/shared/channels.ts` + a `z.string()`-validated handler in `src/main/ipc/hosts.ts` that calls `buildMagicPacket` and sends the datagram via `dgram` to the subnet broadcast, **or** forwards it through an existing SSH session's `forwardOut` when the target is only reachable via a jump host (reuse `session-manager`).
3. **Renderer** — a "Wake" action on the host row/command palette (gated on `host.mac`), plus an optional "wake before connect" toggle.

Philosophy fit: uses only user-provided infrastructure (LAN broadcast or the user's own jump host); no relay, no account.

## #65 — File transfer over RDP/VNC

Reuse the existing streaming `TransferManager` (`src/main/sftp/transfer-manager.ts`). For VNC-over-SSH hosts the SFTP channel already exists on the same connection; for RDP, IronRDP drive redirection is the path. No new secret flow. Effort: M-L.

## #66 — Multi-monitor & scaling

Lives in the RDP (IronRDP WASM) and VNC (noVNC) render paths (`src/renderer/components/rdp`, `.../vnc`). Pure-client change; no vault/IPC impact. Effort: M-L.

## #68 — Secure-by-default docs + optional browser share

Two parts: (a) a positioning/security doc contrasting TermDesk's tunnel-by-default + single-use tokens + TOFU pinning against the VNC family's insecure/cloud defaults (docs only, already engineered); (b) an **opt-in** "share session to a browser" brokered over the user's own SSH tunnel — never a TermDesk-operated gateway. Off by default; its own threat-model section required before it ships.

## Test / validation

`src/shared/wake-on-lan.test.ts` covers MAC normalization (colon/hyphen/Cisco/bare forms), rejection of malformed input, and the exact packet structure (length 102, 6×0xFF prefix, MAC repeated 16×). `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` are green.
