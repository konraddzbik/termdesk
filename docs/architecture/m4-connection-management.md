# Architecture review — Connection management at scale (Milestone M4)

Scope: issues #38 (folder-tree credential & setting inheritance), #39 (reusable credential objects), #40 (host search / tags / color-coded tabs), #41 (per-folder jump/gateway inheritance), #42 (migrate-from-X importers).

This PR lands the **inheritance resolution core** (`src/shared/host-inheritance.ts`) — the algorithmic heart of #38 and #41 — plus this review of where the rest of the milestone stands against the *already-substantial* existing data model.

## What already exists (so the milestone is smaller than it looks)

Reading `src/main/store/schema.ts` and `src/shared/ipc.ts`:

- **Reusable credential objects (#39) already exist.** There is a `credentials` table (`credentials-repo.ts`, `CredentialsDialog.tsx`) and hosts carry a `credentialId` FK that "supplies username/auth at connect time." #39 is largely **done**; remaining work is UX (rotate-updates-all, dependents warning). This PR's review flags it so we don't rebuild it.
- **Nested groups already exist.** `groups.parentId` gives a real tree; groups have `color` + `sortOrder`.
- **Tags & per-host color already exist** on `hosts` (`tags` JSON array, `color`). #40's remaining work is *search* wiring + tab tinting, not the data model.

So the genuine gap for M4 is **inheritance**: groups nest but contribute no defaults, and nothing resolves a host's effective config down the tree. That is exactly what this PR implements.

## #38 / #41 — Inheritance core (this PR)

`resolveInheritedHost(host, ancestorsNearestFirst)` computes a host's effective `credentialId / proxyJump / defaultPath / color` and a **union** of tags, with a `sources` map for an "inherited from Folder X" badge. Precedence: host's own explicit value → nearest ancestor with a value → none. `orderedAncestorIds` walks `parentId` nearest-first, cycle-safe. Pure and standalone (no zod/DB) so the precedence rules are unit-tested in isolation.

Because `proxyJump` and `credentialId` are among the inherited fields, **#41's per-folder jump/gateway inheritance falls out of the same resolver** — a folder default `proxyJump` cascades to every descendant host at connect time.

### Integration plan (follow-up)
1. **Schema** — add nullable default columns to `groups`: `default_credential_id`, `default_proxy_jump`, `default_path`, `default_tags` (JSON). Additive; mirror in `db.ts` bootstrap DDL.
2. **Repo** — in `hosts-repo.ts`, when resolving a host for connect, build the ancestor chain (`orderedAncestorIds`) and apply `resolveInheritedHost`. Connect paths (ssh/sftp/vnc) read the *effective* credentialId/proxyJump.
3. **IPC/renderer** — surface the `sources` provenance so the host form shows "inherited from <group>" and allows override; group editor gains the default fields.

Secrets are unaffected: inheritance resolves a `credentialId` *reference*; the secret itself is still only ever decrypted in `secrets.ts` (CONTRIBUTING invariant 2 preserved).

## #40 — Search / tags / color-coded tabs
Data model is present. Remaining: fuzzy host search in the command palette over name/hostname/tag/folder, tab-chrome tinting from `host.color` (and inherited color from this resolver), tag filtering in the sidebar. Pure-client + a search index; no schema change.

## #42 — Migrate-from-X importers
Follows the existing `ssh-config` importer pattern (`src/main/ipc/ssh-config.ts`). Add parsers for PuTTY (registry/`.reg`), Termius export, and RDM/mRemoteNG connection files, mapping into the host/group tree. Imported secrets are **re-encrypted into safeStorage on import, never left in plaintext**; the source's insecure storage is flagged to the user.

## Test / validation
`host-inheritance.test.ts` covers nearest-wins, host-override, empty-string-as-unset, tag union+dedup, immutability, and cycle-safe ancestor ordering. `lint` / `typecheck` / `test` / `build` green.
