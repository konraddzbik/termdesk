# Code Signing & Notarization for TermDesk

CI builds unsigned installers by default. Release builds sign when the GitHub secrets below are configured.

## GitHub Secrets

| Secret | Platform | Description |
|--------|----------|-------------|
| `APPLE_CERTIFICATE_BASE64` | macOS | Base64-encoded `.p12` Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | macOS | Password for the `.p12` export |
| `APPLE_ID` | macOS | Apple ID email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | App-specific password ([appleid.apple.com](https://appleid.apple.com)) |
| `APPLE_TEAM_ID` | macOS | 10-character Team ID from Apple Developer |
| `WIN_CERTIFICATE_BASE64` | Windows | Base64-encoded `.pfx` code-signing certificate |
| `WIN_CERTIFICATE_PASSWORD` | Windows | Password for the `.pfx` export |

## Local signing

### macOS

```bash
# Export Developer ID Application cert as .p12, then:
export CSC_LINK=/path/to/cert.p12
export CSC_KEY_PASSWORD='…'
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='XXXXXXXXXX'

# Uncomment `notarize: true` under `mac:` in electron-builder.yml, then:
npm run dist
```

### Windows

```bash
export CSC_LINK=/path/to/cert.pfx
export CSC_KEY_PASSWORD='…'
npm run dist
```

## Release workflow

`.github/workflows/release.yml` passes signing env vars to `electron-builder`. When macOS secrets are present, uncomment `notarize: true` in `electron-builder.yml`.

Unsigned local/CI builds:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
```

## User data migration

Existing installs under `~/Library/Application Support/sshdeck` (or `%APPDATA%\sshdeck`) are reused automatically when upgrading to the TermDesk-branded build.