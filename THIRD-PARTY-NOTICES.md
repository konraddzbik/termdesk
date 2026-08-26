# Third-party notices

TermDesk bundles its entire production dependency tree into the application
package. On macOS every one of these packages is inside
`TermDesk.app/Contents/Resources/app.asar` (the three native modules —
`better-sqlite3`, `node-pty`, `ssh2` — are additionally unpacked next to it in
`app.asar.unpacked/`). Because the packages are distributed, their licences
travel with the installer, and this file records them.

Every licence below was read from the package itself — its `package.json` and
its bundled licence text — not from a licence-scanner summary. See
[Reproducing this list](#reproducing-this-list).

## Scope: what is distributed and what is not

- **`dependencies` in `package.json` and everything they pull in** — distributed.
  241 package directories end up in `app.asar`, of which 26 are direct
  dependencies.
- **`devDependencies`** — **not** distributed. Biome, TypeScript, Vitest, Vite,
  electron-vite, electron-builder, drizzle-kit, patch-package, Tailwind, jsdom,
  the `@types/*` packages and the Testing Library packages exist only to build
  and test the app. None of them is copied into an installer, so none of them
  imposes a distribution obligation.
- **One exception to that rule:** `electron` is declared as a devDependency, but
  the Electron *runtime* is bundled into every installer. It is covered in
  [The Electron runtime](#the-electron-runtime) below.

## The one real obligation: `@novnc/novnc` (MPL-2.0)

`@novnc/novnc` 1.7.0 is the VNC client used in the renderer. noVNC's core
library files — which is exactly what this project uses — are licensed
**MPL-2.0** (`node_modules/@novnc/novnc/LICENSE.txt`). Every other bundled
package is under a permissive licence with no source-availability requirement.
noVNC is different for one reason: **this repository patches it.**

`patches/@novnc+novnc+1.7.0.patch` modifies two MPL-2.0-covered files,
`core/ra2.js` and `core/rfb.js`, to add RealVNC RSA-AES support (security types
5 and 13), fix an upstream Web Crypto `importKey` call, and change security-type
selection from server-preferred to a client preference list. patch-package
applies it during `npm install`, so the shipped binaries contain modified
MPL-2.0 files.

MPL-2.0 keeps a modified covered file under MPL-2.0 and requires that its Source
Code Form be made available to anyone who receives the software. The patched
files ship verbatim inside `app.asar` as
`node_modules/@novnc/novnc/core/ra2.js` and `.../core/rfb.js`, so recipients
already hold the modified source; what they had no way to see was the
modification itself — which lines are ours and under what terms.

**Publishing this repository is how that requirement is actually met.** While
the repository was private, the patch existed only somewhere recipients could
not reach. A public repository puts the modification, its provenance and its
licence next to the binaries that carry it. This is a compliance improvement
that follows directly from going open source, not a cost of it.

The patch file carries an attribution header naming upstream, its licence, and
what the modification does, so the obligation is discoverable from the patch
itself and not only from this file.

## Direct production dependencies

Versions are the installed ones (`package.json` declares ranges; exact
resolutions live in `package-lock.json`).

### MIT

| Package | Version |
|---|---|
| `@modelcontextprotocol/sdk` | 1.30.0 |
| `@xterm/addon-fit` | 0.11.0 |
| `@xterm/addon-search` | 0.16.0 |
| `@xterm/addon-web-links` | 0.12.0 |
| `@xterm/addon-webgl` | 0.19.0 |
| `@xterm/xterm` | 6.0.0 |
| `better-sqlite3` | 12.10.0 |
| `clsx` | 2.1.1 |
| `cmdk` | 1.1.1 |
| `electron-updater` | 6.8.9 |
| `node-pty` | 1.1.0 |
| `radix-ui` | 1.5.0 |
| `react` | 19.2.7 |
| `react-dom` | 19.2.7 |
| `ssh2` | 1.17.0 |
| `tailwind-merge` | 3.6.0 |
| `tw-animate-css` | 1.4.0 |
| `ws` | 8.21.0 |
| `zod` | 4.4.3 |
| `zustand` | 5.0.14 |

`ssh2` declares its licence through the legacy `licenses` array rather than the
SPDX `license` field; its bundled `LICENSE` file is the MIT text.

### Apache-2.0

| Package | Version |
|---|---|
| `class-variance-authority` | 0.7.1 |
| `drizzle-orm` | 0.45.2 |

### ISC

| Package | Version |
|---|---|
| `lucide-react` | 1.18.0 |

### MIT OR Apache-2.0 (dual, recipient's choice)

| Package | Version |
|---|---|
| `@devolutions/iron-remote-desktop` | 0.11.0 |
| `@devolutions/iron-remote-desktop-rdp` | 0.7.0 |

### MPL-2.0

| Package | Version |
|---|---|
| `@novnc/novnc` | 1.7.0 |

Three of these packages ship no licence text file of their own —
`drizzle-orm`, `@devolutions/iron-remote-desktop` and
`@devolutions/iron-remote-desktop-rdp`. Their licence is the SPDX identifier
declared in their `package.json`.

## The full bundled tree

Counting direct and transitive dependencies together, 241 package directories
sit inside `app.asar`. The breakdown below was read out of a shipped archive
(the 0.4.0 macOS build in `dist/mac-arm64`) rather than out of `node_modules`,
because the two do not always agree — see the note on `cpu-features` at the end
of this section.

| Licence | Packages |
|---|---|
| MIT | 211 |
| ISC | 12 |
| Apache-2.0 | 4 |
| BSD-3-Clause | 4 |
| MIT OR Apache-2.0 | 2 |
| BSD-2-Clause | 1 |
| BlueOak-1.0.0 | 1 |
| 0BSD | 1 |
| MPL-2.0 | 1 |
| Python-2.0 | 1 |
| Unlicense | 1 |
| BSD-2-Clause OR MIT OR Apache-2.0 | 1 |
| MIT OR WTFPL | 1 |

Every package outside MIT and ISC, named in full, at the version that shipped
(`*` marks a direct dependency):

- **Apache-2.0** — `class-variance-authority` 0.7.1\*, `drizzle-orm` 0.45.2\*,
  `detect-libc` 2.1.2, `tunnel-agent` 0.6.0
- **MIT OR Apache-2.0** — `@devolutions/iron-remote-desktop` 0.11.0\*,
  `@devolutions/iron-remote-desktop-rdp` 0.7.0\*
- **MPL-2.0** — `@novnc/novnc` 1.7.0\*
- **BSD-3-Clause** — `bcrypt-pbkdf` 1.0.2, `fast-uri` 3.1.2, `ieee754` 1.2.1,
  `qs` 6.15.2
- **BSD-2-Clause** — `json-schema-typed` 8.0.2
- **BlueOak-1.0.0** — `sax` 1.6.0
- **0BSD** — `tslib` 2.8.1
- **Python-2.0** — `argparse` 2.0.1
- **Unlicense** — `tweetnacl` 0.14.5
- **BSD-2-Clause OR MIT OR Apache-2.0** — `rc` 1.2.8
- **MIT OR WTFPL** — `expand-template` 2.0.3

Three of the 211 MIT packages — `better-sqlite3`, `node-pty` and `ssh2` — are
the native modules, stored outside the archive in `app.asar.unpacked/`. Each
carries its own MIT `LICENSE` file there.

One directory is not what its name says. `node_modules/cpu-features` — the
optional native dependency of `ssh2` — contains the `noop2` stub package
(`noop2` 2.0.0, MIT, github.com/yoshuawuyts/noop2), which electron-builder
substitutes for optional native dependencies it does not build. The real
`cpu-features` source is not distributed; the MIT count above counts the stub.

## Patched dependencies

Two dependencies are modified locally by patch-package (see the `postinstall`
script in `package.json`). Both patch files begin with an attribution header
naming upstream, its licence, and what the patch changes.

| Patch | Upstream licence | Nature of the change |
|---|---|---|
| `patches/@novnc+novnc+1.7.0.patch` | MPL-2.0 | Functional: RealVNC RSA-AES security types 5 and 13, a Web Crypto `importKey` fix, RA2 message chunking, client-side security-type preference ordering |
| `patches/better-sqlite3+12.10.0.patch` | MIT | Compile fix only: V8 external-pointer tag and a `nullptr` argument. No runtime behaviour change |

Only the noVNC patch carries a source-availability obligation. The
better-sqlite3 patch is included for the same reason any patch is — so a fresh
`npm install` produces a buildable tree — and MIT asks nothing further of it.

## The Electron runtime

Installers embed the Electron runtime (**Electron 43.4.1, MIT**), which in turn
embeds Chromium and Node.js and their own large body of third-party code.
Electron maintains those notices upstream: the licence texts ship in the
`electron` package as `node_modules/electron/dist/LICENSE` and
`node_modules/electron/dist/LICENSES.chromium.html`.

`electron-builder.yml` copies both files into the packaged app under
`Contents/Resources/licenses/` (`extraResources`: `electron.LICENSE` and
`LICENSES.chromium.html`), so every installer carries the Chromium and Node.js
notices alongside the binary as their BSD-style terms require.

## Reproducing this list

```sh
# direct production dependencies: installed version and declared licence,
# read from each package's own package.json
node -e 'const fs = require("fs");
for (const d of Object.keys(require("./package.json").dependencies).sort()) {
  const p = JSON.parse(fs.readFileSync(`node_modules/${d}/package.json`));
  console.log([d, p.version, p.license ?? JSON.stringify(p.licenses)].join("\t"));
}'

# what actually ships (after `npm run dist`)
npx @electron/asar list dist/mac-arm64/TermDesk.app/Contents/Resources/app.asar \
  | grep -o "^/node_modules/[^/]*" | sort -u
```

The per-licence counts for the bundled tree come from reading each
`node_modules/*/package.json` **inside** the archive, not the same paths in the
working tree — that is how the `cpu-features`/`noop2` substitution shows up.
`npx @electron/asar extract-file <archive> <path>` prints one out; note that it
writes to `basename(path)` in the current directory, so run it somewhere
harmless rather than in the repository root.

`npm ls --omit=dev` is not useful here: with devDependencies installed it labels
every top-level package `extraneous`, so read `package.json` directly instead.

## TermDesk's own licence

The licence for TermDesk itself is in [`LICENSE`](LICENSE). Nothing in this file
changes it; these are other people's terms for other people's code.
