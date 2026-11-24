# Architecture review — App update pipeline (release → feed → installed client)

Scope: how a new TermDesk version travels from a `v*` tag to a running install, what each hop trusts, the gaps in today's implementation, and the target design that fixes them in phases. Covers `src/main/updater.ts`, `src/renderer/stores/updates.ts`, `electron-builder.yml`, `.github/workflows/release.yml`, `src/main/store/db.ts` (data compatibility across versions) and `docs/UPDATING.md`. Related: #25 (feed never exercised), #58 (signed + reproducible releases), #91 (session persistence), the M7 threat model.

This is a design document. It changes no code. The phased work at the end is tracked as milestones **Updates U1–U5** (epics #129–#133).

## Where we are (facts, as of v0.4.0)

- **No Release has ever been published.** The repository has no tags, so every installed client's feed is empty and the whole path below has never run end to end (#25).
- **Feed:** `electron-updater` 6.8.9, `github` provider, hard-coded to `konraddzbik/termdesk` (`GITHUB_OWNER`/`GITHUB_REPO`, asserted in `updater.test.ts`). Stable = published releases, beta = `allowPrerelease`. `allowDowngrade = false` is pinned explicitly, because electron-updater's `channel` setter flips it on.
- **Publishing:** `release.yml` runs `verify.yml`, checks that the tag equals `package.json`, builds macOS → Windows → Linux one after another, and publishes a **draft** Release. A human publishing the draft is what turns the feed on. win/linux upload `latest*.yml` update metadata. macOS has no `publish` block, so it ships only a `.dmg`/`.zip` for manual download.
- **Client lifecycle:** first check 8 s after launch, then every 6 h. `autoDownload = false`, so the banner asks the user first, and `autoInstallOnAppQuit = true`. Main-process state goes to the renderer over `updates:*` IPC (`updateStateSchema`), and the banner dismisses until the state advances.
- **Platforms:** `platformSegment()` enables win + linux and returns `null` on darwin (unsigned Squirrel.Mac cannot update).

```
tag v* ──► release.yml ──► draft GitHub Release ──(human publishes)──► feed
                                                                        │
  github.com releases.atom + latest*.yml  ◄── check (8s, then 6h) ──────┤
                                                                        ▼
  main: updater.ts  ──updates:event──►  renderer: updates store + banner
        ▲  download / install  ◄──updates:* IPC──┘
        └─► quitAndInstall ──► before-quit teardown ──► installer ──► relaunch ──► db.ts migrate
```

## Trust model — what an update is trusted on today

| Hop | Integrity today | Trust root |
|-----|-----------------|------------|
| Tag → artifacts | CI builds from the tag after `verify` passes | Repo write access plus `GITHUB_TOKEN` in CI |
| Draft → live | A human publishes the draft | The maintainer's GitHub account |
| Feed → client | TLS to GitHub. `sha512` in `latest*.yml` is checked against the download | **The same GitHub Release**: the hash and the binary come from the same origin |
| Binary → install | Windows unsigned: no publisher check. macOS: n/a. Linux: none | — |
| Version order | `allowDowngrade = false` | Semver in the feed |

**Conclusion:** the only thing an attacker needs is the ability to publish a Release on this repository, through a stolen maintainer session, a leaked PAT, or a compromised workflow. `SHA256SUMS` and the `sha512` hashes don't help here, because they are published alongside the binary. The draft gate and forward-only updates are good. What's missing is an update signature that does not depend on GitHub.

Side note for the threat model: `THREAT-MODEL.md` names `api.github.com` as the only outbound host. The github provider also reads `github.com/<owner>/<repo>/releases.atom` and downloads assets from GitHub's release CDN, so a firewall allowlist needs all three.

## Gaps found

| # | Gap | Evidence | Impact | Severity |
|---|-----|----------|--------|----------|
| G1 | **Update trust = GitHub account.** No signature independent of the publisher | table above | A compromised account pushes a malicious build to every win/linux client | High (latent until the first Release) |
| G2 | **Linux `.deb` installs report `canSelfUpdate: true` but aren't a supported path.** electron-updater reads `resources/package-type` and switches to `DebUpdater`, which installs through `sudo`/`pkexec`. Whether our `latest-linux.yml` even lists the `.deb` has never been verified | `electron-updater/out/main.js` `doLoadAutoUpdater`; `LinuxUpdater.js` sudo path; `linux.target: [AppImage, deb]` | deb users may see "Update available", then hit a password prompt or a silent failure (`error` → `idle`) | High |
| G3 | **Restart kills live work without warning.** `quitAndInstall` → `before-quit` tears down every SSH session, tunnel, SFTP transfer and remote edit (`index.ts` `before-quit`) | `updates:install` handler | Lost in-flight transfers and unsaved remote edits. Worst for the DevOps users the app targets | Medium |
| G4 | **Main process doesn't own the install invariant.** `updates:install` calls `quitAndInstall()` whatever the state. Only the renderer's banner makes sure the status is `downloaded` | `registerUpdaterIpc` | A UI bug or a compromised renderer can force a quit. The update itself is still refused without a downloaded file | Low |
| G5 | **Failures are invisible.** Background errors map to `idle`, the schema's `error` status is never set, and there's no last-check time or last-error | `autoUpdater.on('error')` | A broken feed looks exactly like "up to date", which is how #25 stays unnoticed in the field | Medium |
| G6 | **No data-schema version.** Migrations are additive (`ensureColumn`) plus structural rebuilds with `.bak-<version>` snapshots, but there's no `PRAGMA user_version`. Since `allowDowngrade = false`, the documented rollback is a *manual* reinstall of an older build, which then opens a newer database | `db.ts` | An older binary against a newer schema: CHECK or rebuild mismatches, possible write failures | Medium |
| G7 | **macOS can't self-update** (known). Blocked on Developer ID + notarization (#58) | `platformSegment()` | Mac users update by hand | Known / blocked |
| G8 | **No staged rollout or kill switch.** Publishing a draft reaches 100% of clients at their next 6 h check | `release.yml` | A bad release can't be contained, and with downgrade disabled the only fix is a new, higher version | Medium |
| G9 | **Channel is re-read at download time.** `updates:download` calls `configure()` again, so the policy used for the check and the one used for the download can differ if the user toggles beta in between | `registerUpdaterIpc` | Confusing edge case: the check result and the download come from different policies | Low |

## Target architecture

The principles are the same as in the other milestone reviews: a **pure, tested `@shared` policy core**, thin Electron adapters, and no new outbound hosts or accounts.

### 1. Update policy core — `src/shared/update-policy.ts` (pure)

It owns every decision that `updater.ts` currently makes inline, so each one can be tested without Electron:

- `installKind({ platform, packageType, isPackaged, signed })` → `'win-nsis' | 'linux-appimage' | 'linux-deb' | 'mac-signed' | 'mac-unsigned' | 'dev'`.
- `capability(kind)` → `'self-update' | 'manual-download' | 'none'`. This replaces `platformSegment()` and is the single source of `canSelfUpdate`. `linux-deb` stays `manual-download` until G2 is verified against a real Release, `mac-signed` becomes `self-update` with #58, and `dev` is `none`.
- `nextState(state, event)`: a transition function over `idle → checking → available → downloading → downloaded`, with `error` as a real state. It rejects illegal transitions such as `install` from anything other than `downloaded` (G4).
- `feedPolicy(settings)` → `{ allowPrerelease, allowDowngrade: false }`. It is computed **once per check** and reused for that check's download (G9). `allowDowngrade: false` stays a constant, not a setting.

`updater.ts` shrinks to an adapter: it maps electron-updater events to `nextState`, applies `feedPolicy`, and enforces the core's verdicts in the IPC handlers.

### 2. State contract (additive change to `updateStateSchema`)

```ts
status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
version?: string; percent?: number
capability: 'self-update' | 'manual-download' | 'none'   // supersedes canSelfUpdate (kept, derived, for one release)
lastCheckedAt?: number                                     // G5: shown in Help ▸ About / Settings, not as a banner
lastError?: { kind: 'network' | 'feed' | 'integrity' | 'install'; at: number }
```

Background errors still don't open a banner, because the no-nagging rule stays. They are recorded, though, and an `integrity` error (a hash or signature mismatch) *is* surfaced, since that failure is the one that matters for security.

### 3. Safe restart (G3)

Before `quitAndInstall`, main counts live work: sessions, active tunnels, running transfers and unsaved remote edits, all from the existing managers. If anything is active, the renderer shows the counts with **Restart now / Restart when idle / Later**. "When idle" installs on the next quit, which `autoInstallOnAppQuit` already does. Once M11 session persistence (#91) lands, tmux-backed sessions reattach after the restart, and the prompt says which sessions will resume and which won't.

### 4. Data compatibility across versions (G6)

- `db.ts` stamps `PRAGMA user_version = SCHEMA_VERSION` after migrations. One integer, bumped by every structural migration.
- On open, a database whose `user_version` is **newer** than the build supports is opened **read-only**, and the user sees a "Created by a newer TermDesk" notice with the `.bak-<version>` snapshot as the way back. It never gets migrated or written to.
- Additive columns keep using `ensureColumn`. The `.bak-<version>` snapshot before a structural migration stays as it is.

This makes the one documented rollback path (manual reinstall of an older build) safe.

### 5. Feed integrity (G1): a signature that doesn't depend on GitHub

This comes in three independent layers, each one useful by itself:

1. **Now (no certificates needed):** keep the draft gate and forward-only updates. Add **GitHub artifact attestations** (`actions/attest-build-provenance`) to `release.yml`, so humans and scripts can check that a binary was built by this workflow from this tag. This is for manual verification. The client doesn't use it.
2. **Update-metadata signature (the actual fix):** CI signs each `latest*.yml` with an Ed25519 key (minisign format, detached `latest*.yml.sig` asset). The client ships the **public key pinned at build time**, next to `GITHUB_OWNER`. Before any download, it fetches the `.sig`, verifies the metadata, and only then trusts the `sha512` inside it. The client hooks in through a custom provider that wraps `GitHubProvider`. A missing or bad signature counts as an `integrity` error and the update is refused. The private key lives in a protected GitHub Environment that requires reviewer approval, so repo write access alone can't sign.
3. **Platform code signing (#58):** Windows sets `publisherName` so electron-updater verifies Authenticode on the downloaded installer. macOS gets Developer ID + notarization, and Squirrel.Mac then enforces a matching designated requirement. That unlocks `mac-signed`.

Key rotation: the client accepts a list of pinned keys. A release signed with a new key must also be signed with the old one while the old key is phased out.

### 6. Rollout and kill switch (G8)

- **Staged rollout:** set `stagingPercentage` in the published `latest*.yml`. electron-updater already honours it through `isStagingMatch`, using a stable per-install id. A new `scripts/release-stage.mjs` edits the percentage on the live Release (10 → 50 → 100). It stays maintainer-run, with no server involved.
- **Kill switch:** set the percentage to 0 on the bad release, then ship `x.y.z+1`. Downgrades stay off on purpose. The runbook goes into `RELEASING.md`.

### 7. Open-core boundary

The feed identity (owner, repo, pinned signing keys) is a **compile-time constant**, never a runtime setting or env var in packaged builds. `devEnvFlag` already returns `undefined` when packaged, and that stays the case. A paid distribution built from the private repo supplies its own constants through a build flag, the same mechanism as `__TERMDESK_OFFICIAL_BUILD__`. No paid-only update logic lives in this repository, and forks get working updates from their own Releases by changing the constants.

## Phased delivery

Each phase is a GitHub milestone with an epic. Issues are listed in suggested order.

| Phase / milestone | Epic | Issues | Gaps | Depends on |
|-------------------|------|--------|------|------------|
| **U1: Update-pipeline groundwork** (before the first Release) | #129 | #113 policy core (anchor) · #114 `.deb` → manual · #115 main-owned install guard + per-check policy · #116 diagnostics (`capability`/`lastCheckedAt`/`lastError`) · #117 threat-model host list | G2, G4, G5, G9 | none |
| **U2: First Release & real-feed validation** | #130 | #118 first Release + Windows NSIS/AppImage end-to-end test (supersedes #18/#25) · #119 `.deb` decision from real `latest-linux.yml` · #120 build-provenance attestations | G1 (partial), G2 | U1 |
| **U3: Update integrity & safe upgrades** | #131 | #121 sign `latest*.yml` in CI (protected Environment) · #122 client verifies against pinned keys · #123 `user_version` + read-only newer vault · #124 safe-restart prompt | G1, G3, G6 | U2 |
| **U4: Staged rollout & kill switch** | #132 | #125 `stagingPercentage` tooling · #126 kill-switch runbook | G8 | U2 (+ #121 for re-signing) |
| **U5: Platform code signing & macOS self-update** | #133 | #127 Windows Authenticode + `publisherName` · #128 macOS notarize + `mac-signed` self-update | G7 | certificates |
| Later | — | Session reattach after update (#91, M11), wired through #124 | G3 (full) | M11 |

## Invariants to pin in tests

- Updates come only from the compiled-in feed identity. There's no runtime override when packaged (already in `updater.test.ts`, keep it).
- `allowDowngrade` is `false` for every channel and every install kind.
- `install` is refused unless the state is `downloaded`.
- Every install kind maps to exactly one capability, and `mac-unsigned`, `linux-deb` (until verified) and `dev` never self-update.
- (U3, #122) Metadata with a missing or invalid signature is never downloaded. A signature from a key that isn't pinned is refused.
- (U3, #123) A database with `user_version` greater than `SCHEMA_VERSION` is never migrated or written.
- A background check error never opens a banner. An integrity error always surfaces.

## Open decisions

1. **Signature format:** minisign (Ed25519, tiny verifier, no dependencies) vs. Sigstore/cosign (keyless, but the verifier needs network access and a transparency log, which clashes with the no-extra-hosts posture). **Recommendation: minisign.** Use attestations for humans and minisign for the client.
2. **deb self-update:** support it (a password prompt from `pkexec` during an update is unusual for a desktop app) or permanently mark `.deb` as manual, with a pointer to the APT/repo route. **Recommendation:** manual until the U2 evidence (#119) says otherwise.
3. **Check cadence:** keep 8 s + 6 h. It needs no auth and stays within GitHub's unauthenticated rate limits. Offices behind a shared NAT make that limit a real concern at scale, and G5's `lastError.kind = 'network'` makes that measurable before anyone tunes it.
