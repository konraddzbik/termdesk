# Installing TermDesk

Download an installer from the [**Releases page**](../../releases/latest), or build one yourself
from source (see [`CONTRIBUTING.md`](CONTRIBUTING.md)).

## What the current releases actually contain

TermDesk targets macOS, Windows and Linux, and `electron-builder.yml` configures all three. What is
attached to a release depends on what the release workflow managed to build:

| Platform | Artifact | Status |
|---|---|---|
| **macOS (Apple Silicon)** | `TermDesk-<version>-arm64.dmg` | Published |
| **macOS (Intel)** | `TermDesk-<version>-x64.dmg` | **Not in 0.4.0.** The x86_64 bundle shipped an arm64 `sshcrypto.node`, so the release workflow's architecture check withheld it. See the 0.4.0 entry in [`CHANGELOG.md`](CHANGELOG.md). |
| **Windows 10/11 (x64)** | `TermDesk-Setup-<version>.exe` | Configured, not attached to the current releases |
| **Ubuntu / Debian** | `TermDesk-<version>.deb` | Configured, not attached to the current releases |
| **Other Linux** | `TermDesk-<version>.AppImage` | Configured, not attached to the current releases |

So today: **the only published installer is the macOS Apple Silicon `.dmg`**. On any other platform,
build from source.

## The builds are unsigned

No release is code-signed or notarized. Every OS therefore shows a one-time "unknown developer"
warning, and on macOS this has a second consequence: **an unsigned macOS build cannot update
itself.** See [Updates](#updates) below.

---

## macOS

1. Open the `.dmg` and drag **TermDesk** into **Applications**.
   - Not sure which build you need? Apple menu → *About This Mac*. "Apple M…" → **arm64**.
2. First launch is blocked by Gatekeeper because the app is unsigned. Either:
   - **Right-click** TermDesk in Applications → **Open** → **Open** in the dialog, or
   - run once in Terminal:
     ```bash
     xattr -dr com.apple.quarantine /Applications/TermDesk.app
     ```
3. TermDesk opens normally on every launch after that.

## Windows

1. Run `TermDesk-Setup-<version>.exe`.
2. SmartScreen may say "Windows protected your PC" → click **More info** → **Run anyway**.
3. Choose the install directory (optional) and finish. A desktop shortcut is created.

## Ubuntu / Debian (`.deb`)

```bash
sudo apt install ./TermDesk-<version>.deb
# older apt / fallback:
sudo dpkg -i TermDesk-<version>.deb && sudo apt-get -f install
```
Launch from your app menu or run `termdesk`.

On Linux, TermDesk requires a working OS keyring (gnome-libsecret or kwallet) to store secrets —
see [`SECURITY.md`](SECURITY.md) for why it refuses to fall back.

## Linux — portable (`.AppImage`)

```bash
chmod +x TermDesk-<version>.AppImage
./TermDesk-<version>.AppImage
```
If it fails to start, install FUSE 2:
```bash
sudo apt install libfuse2
```

---

## Updates

- **Windows & Linux:** TermDesk checks its update feed on launch and updates in place.
- **macOS:** there is no self-update. macOS in-app updates go through Squirrel.Mac, which refuses to
  apply an update to an app that is not signed and notarized, so `platformSegment()` in
  `src/main/updater.ts` returns `null` on `darwin` and the update check is skipped entirely (the
  in-app banner reports `canSelfUpdate: false`). **To move to a new version, download the newer
  `.dmg` and replace the app in `/Applications`** — your hosts, settings and vault live in the app's
  `userData` directory and are untouched by replacing the bundle.

Details, including how to enable real macOS auto-update once signing is in place, are in
[`docs/UPDATING.md`](docs/UPDATING.md).

## Uninstall

- **macOS:** delete `/Applications/TermDesk.app`.
- **Windows:** *Settings → Apps → TermDesk → Uninstall*.
- **Ubuntu/Debian:** `sudo apt remove termdesk`.
- **AppImage:** delete the file.
