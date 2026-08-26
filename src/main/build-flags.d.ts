/**
 * Compile-time build flags, substituted by electron-vite's `define`
 * (see electron.vite.config.ts).
 */

/**
 * True only in installers built by this project's own release pipeline, which
 * sets TERMDESK_OFFICIAL_BUILD=1. False in every other build — a contributor's
 * `npm run dist`, a distro package, a fork's release.
 *
 * It exists so that terms attached to *the project's distributed binaries* —
 * EULA.txt — cannot follow the MIT source into somebody else's build. Under
 * vitest and `electron-vite dev` no substitution happens, so the fallback in
 * the reader below applies.
 */
declare const __TERMDESK_OFFICIAL_BUILD__: boolean
