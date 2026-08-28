# Architecture review — Sync & teams without the cloud (Milestone M8)

Scope: issues #61 (encrypted vault export/import), #62 (BYO-storage E2EE sync), #63 (self-hostable shared team vault + RBAC). Guardrail: every item is **optional, off by default**; TermDesk operates **no relay or sync server** — the user brings their own storage.

This PR lands the **portable, secret-safe export envelope** (`src/shared/vault-export.ts`) — the core of #61 — and reviews how sync (#62) and team vaults (#63) build on it.

## #61 — Export/import envelope (this PR)
`buildVaultExport(data)` wraps hosts/groups/credentials/settings in a versioned envelope and runs a recursive **secret-field stripper** (`stripSecretFields`) so `*_enc` ciphertext and any password/passphrase/secret/token/key-material field is removed — a v1 export is **metadata-only** (`secretsIncluded: false`). `parseVaultExport` validates format + version and refuses to import garbage or a future version. Pure and unit-tested.

Rationale: safeStorage ciphertext is machine-bound (OS-keychain key), so it is useless on another machine — exporting it would be a leak with no benefit. The `has*` boolean flags survive so the importer can tell the user exactly which hosts/credentials need a secret re-entered, then re-key them into the local vault.

**Content-field caveat (architecture-review finding).** The stripper is *key-name* based: it removes secret-typed fields (`*_enc`, `password*`, `apiKey`, …) but NOT a secret a user embedded in a free-text **content** field — `automationJobs.command`, `snippets.command`, `routines.variables` (e.g. `mysql -pSECRET`, an API token pasted into a snippet). Those are legitimate content, so they are not stripped by key name. The export/import layer (`vault-io.ts`, follow-up) MUST run those specific fields through `src/shared/redact.ts::redactSecrets` before they reach the envelope. `parseVaultExport` additionally re-runs the stripper on import as defense-in-depth against a tampered envelope.

### Integration plan (follow-up)
1. **Main** — `src/main/ipc/vault-io.ts`: gather host/group/credential/settings DTOs (already secret-free), call `buildVaultExport`, write the JSON; import validates via `parseVaultExport` and upserts through the existing repos, re-encrypting any user-supplied secret via `secrets.ts`.
2. **Renderer** — Export/Import actions in settings; an import preview listing items + which need a secret.

## #62 — BYO-storage E2EE sync
Layers on #61: instead of a one-shot file, sync the (optionally passphrase-encrypted) envelope to **user-chosen storage** — a synced folder, a Git remote, or an S3/WebDAV endpoint the user controls. E2EE with a user-held key; TermDesk runs no server and sees no plaintext. Needs conflict detection (envelope carries a monotonic revision + device id) — never a silent overwrite. This is where a *passphrase-encrypted secret bundle* extends the metadata-only v1 so secrets can travel safely.

## #63 — Self-hostable shared team vault + RBAC (open-core)
The client attaches to a user-run shared vault (shared vs private scoping, role-based read/use/manage, audit). Delivered via the separate paid/open-core tier; this milestone tracks the **client-side integration + the open protocol**. The local-first single-user experience must be unchanged when no team vault is configured. Reuses the same DTO shapes and the export envelope's secret discipline.

## Shared foundation with M6 #53
The non-secret settings/profile envelope here and the config-as-code export (#53) are the same underlying serializer — build once, reuse.

## Test / validation
`vault-export.test.ts`: deep secret stripping (nested/arrays, `*Enc`/apiKey/privateKey/token) with immutability and removed-path audit, `has*` flags preserved, versioned wrap, round-trip, and rejection of non-objects / unknown format / unsupported version / missing data. `lint` / `typecheck` / `test` / `build` green.
