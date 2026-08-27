# Installing TermDesk

**There is no downloadable installer yet.** The public repository
`konraddzbik/termdesk` currently has **no tags and no GitHub Releases**, so the
Releases page is empty. Until a `v*` tag is pushed and that draft Release is
published, the supported way to run TermDesk is **from source**, or an unsigned
installer you build yourself.

## Run from source (supported today)

You need:

- **Node.js >=22.12.0** and **npm 10+** (`.nvmrc` pins the version CI uses)
- A C/C++ toolchain so native modules can compile: Xcode Command Line Tools on
  macOS, `build-essential` + `python3` on Linux, the Visual Studio C++ build
  tools plus Python (node-gyp) on Windows
- **On Linux: an unlocked OS keyring** (gnome-libsecret or kwallet). TermDesk
  refuses Electron's insecure `basic_text` `safeStorage` fallback and fails
  closed, so **without a keyring you cannot save a host with a password** — even
  from source. macOS (Keychain) and Windows (DPAPI) need nothing extra. See
  [`SECURITY.md`](SECURITY.md).

```bash
git clone https://github.com/konraddzbik/termdesk.git
cd termdesk
npm install        # applies patches and rebuilds native deps for Electron
npm run dev        # usable app — no licence check, no account
```

`npm install && npm run dev` opens the full application. There is no licence
check, no seat and no account. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
full development setup, including the `better-sqlite3` ABI step you need before
`npm test` will run.

## Build an unsigned installer locally

```bash
npm run dist
```

That runs `electron-builder` with `--publish never`. Artifact names come from
`electron-builder.yml` (the version is `package.json`'s `version`):

| Platform | Artifact (in `dist/`) | Who can produce it |
|---|---|---|
| **macOS (Apple Silicon)** | `TermDesk-<version>-arm64.dmg` | `npm run dist` on Apple Silicon; CI `macos-latest` |
| **macOS (Intel)** | `TermDesk-<version>-x64.dmg` | Same macOS run (cross-build) |
| **Windows 10/11 (x64)** | `TermDesk-Setup-<version>.exe` | A Windows host, or CI `windows-latest` |
| **Ubuntu / Debian** | `TermDesk-<version>.deb` | A Linux host, or CI `ubuntu-latest` |
| **Other Linux** | `TermDesk-<version>.AppImage` | A Linux host, or CI `ubuntu-latest` |

A single Mac checkout cannot produce the Windows or Linux installers. CI's
package job (`.github/workflows/ci.yml`) is the multi-OS path. After
`npm run dist` on Apple Silicon, restore host-arch native modules with
`npx electron-builder install-app-deps` before `npm run dev` — see
[`CONTRIBUTING.md`](CONTRIBUTING.md) trap 2.

## CI artifacts (unsigned, 14 days)

Every push to `main` that passes verify also runs the package job and uploads
unsigned installers as GitHub Actions artifacts (`termdesk-macos`,
`termdesk-windows`, `termdesk-linux`) with **14-day** retention. Open the latest
green [CI run](https://github.com/konraddzbik/termdesk/actions/workflows/ci.yml)
→ *Artifacts*. These are **not** GitHub Releases; they expire and they are
unsigned. The macOS job runs the same fail-closed native-module architecture
check as `release.yml`, so an arm64/x64 arch mismatch fails the build instead of
shipping a broken bundle. Because the Intel (x64) cross-build currently fails
that check — the x64 bundle picks up an arm64 `sshcrypto.node` — **the CI macOS
artifact is Apple-Silicon (arm64) only** for now. Intel Mac users should run from
source until the x64 cross-build is proven (tracked in the delivery plan).

The builds are **unsigned**. Every OS therefore shows a one-time "unknown
developer" warning, and on macOS this has a second consequence: **an unsigned
macOS build cannot update itself.** See [Updates](#updates) below.

### macOS (local `.dmg`)

1. Open the `.dmg` and drag **TermDesk** into **Applications**.
   - Not sure which build you need? Apple menu → *About This Mac*. "Apple M…" → **arm64**.
2. First launch is blocked by Gatekeeper because the app is unsigned. Either:
   - **Right-click** TermDesk in Applications → **Open** → **Open** in the dialog, or
   - run once in Terminal:
     ```bash
     xattr -dr com.apple.quarantine /Applications/TermDesk.app
     ```
3. TermDesk opens normally on every launch after that.

### Windows (local NSIS `.exe`)

1. Run `TermDesk-Setup-<version>.exe`.
2. SmartScreen may say "Windows protected your PC" → click **More info** → **Run anyway**.
3. Choose the install directory (optional) and finish. A desktop shortcut is created.

### Ubuntu / Debian (local `.deb`)

```bash
sudo apt install ./TermDesk-<version>.deb
# older apt / fallback:
sudo dpkg -i TermDesk-<version>.deb && sudo apt-get -f install
```
Launch from your app menu or run `termdesk`.

On Linux, TermDesk requires a working OS keyring (gnome-libsecret or kwallet) to store secrets —
see [`SECURITY.md`](SECURITY.md) for why it refuses to fall back.

### Linux — portable (local `.AppImage`)

```bash
chmod +x TermDesk-<version>.AppImage
./TermDesk-<version>.AppImage
```
If it fails to start, install FUSE 2:
```bash
sudo apt install libfuse2
```

## GitHub Releases (not published yet)

Pushing a `v*` tag (the tag must equal `v` plus `package.json`'s `version`) runs
[`.github/workflows/release.yml`](.github/workflows/release.yml): it verifies,
builds unsigned installers for macOS, Windows and Linux, and attaches them to a
**draft** GitHub Release. Publishing that draft by hand is what would make the
Releases page a real download source. That has not happened yet.

Do not treat the Releases page as a download until the first Release exists.

## Updates

Until a GitHub Release exists, there is nothing for the in-app updater to fetch.

Once a Release is published:

- **Windows & Linux:** TermDesk checks its update feed on launch and updates in place.
- **macOS:** there is no self-update. macOS in-app updates go through Squirrel.Mac, which refuses to
  apply an update to an app that is not signed and notarized, so `platformSegment()` in
  `src/main/updater.ts` returns `null` on `darwin` and the update check is skipped entirely (the
  in-app banner reports `canSelfUpdate: false`). **To move to a new version, install the newer
  `.dmg` and replace the app in `/Applications`** — your hosts, settings and vault live in the app's
  `userData` directory and are untouched by replacing the bundle.

Details, including how to enable real macOS auto-update once signing is in place, are in
[`docs/UPDATING.md`](docs/UPDATING.md).

## Uninstall

Removing the app removes the program, **not your data**. Hosts, settings and the encrypted secret
vault live in the OS user-data directory (`termdesk`, with a legacy `sshdeck` fallback — see
`src/main/app-paths.ts`), and every step below leaves that directory in place.

Remove the app:

- **macOS:** delete `/Applications/TermDesk.app`.
- **Windows:** *Settings → Apps → TermDesk → Uninstall*.
- **Ubuntu/Debian:** `sudo apt remove termdesk`.
- **AppImage:** delete the file.
- **From source:** delete the clone. App data lives in the OS user-data directory, not the repo.

Then, to also wipe your hosts and stored secrets, delete the user-data directory:

- **macOS:** `~/Library/Application Support/termdesk`
- **Windows:** `%APPDATA%\termdesk` (e.g. `C:\Users\<you>\AppData\Roaming\termdesk`)
- **Linux:** `~/.config/termdesk`

If you used a pre-rebrand build, also remove the `sshdeck`-named sibling in the same location. On
macOS and Windows the encrypted secrets are additionally keyed to the OS keychain (Keychain / DPAPI);
deleting the user-data directory orphans them, and they are cleared on next keychain cleanup.
