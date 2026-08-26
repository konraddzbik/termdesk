/**
 * Resolves OpenSSH `Include` directives in a client config into a single
 * flattened text stream that {@link parseSshConfig} can consume.
 *
 * Included files are spliced in *at the position of the directive* — matching
 * OpenSSH's textual semantics, so an `Include` inside a `Host` block continues
 * that block. Resolution rules mirror `ssh` where it matters for vault import:
 *
 * - `~/`-prefixed paths expand against the user's home directory.
 * - Relative paths resolve against the user config base (`~/.ssh`), as OpenSSH
 *   does for a user configuration file — NOT against the including file's dir.
 * - Glob patterns (`*`, `?`) in the final path segment are expanded over a
 *   directory listing and the matches are sorted (OpenSSH sorts glob results).
 *   NOTE: only the final segment is globbed — a mid-path glob
 *   (`Include conf.d/*​/config`) is treated literally and, finding no such
 *   directory, contributes nothing. Multi-segment globs are rare in practice.
 * - Multiple whitespace-separated paths (optionally double-quoted) per
 *   `Include` line are each resolved in order.
 *
 * Because this runs on a *credential* tool's config, resolution is bounded and
 * best-effort: it never throws on a bad include (missing files are skipped),
 * and it is guarded against include cycles, unbounded depth, and pathological
 * fan-out/aggregate size. Only the ROOT file failing to read propagates to the
 * caller. (The size cap bounds the *accumulated* text across files; a single
 * pathologically large file is still read whole, which is fine for the tiny
 * hand-written configs this targets.)
 */

import { readFile as fsReadFile, readdir } from 'node:fs/promises'
import { homedir as osHomedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { globToRegExp, parseConfigLine } from './ssh-config-parser'

/** Filesystem/environment surface, injectable so the resolver is unit-testable. */
export interface IncludeFsDeps {
  /** Reads a file as UTF-8 text; rejects if it cannot be read. */
  readFile(path: string): Promise<string>
  /** Lists the entry names (not full paths) of a directory. */
  listDir(dir: string): Promise<string[]>
  /** Absolute path to the user's home directory. */
  homedir(): string
}

export interface ResolveResult {
  /** Flattened config text with every `Include` spliced in. */
  content: string
  /** Total number of config files read (root + every included file). */
  filesRead: number
}

// Guard rails — a self-including or huge config must not hang or OOM the app.
const MAX_DEPTH = 16
const MAX_FILES = 256
const MAX_TOTAL_BYTES = 5 * 1024 * 1024

const DEFAULT_DEPS: IncludeFsDeps = {
  readFile: (path) => fsReadFile(path, 'utf8'),
  listDir: (dir) => readdir(dir),
  homedir: () => osHomedir(),
}

/** True when a path segment contains a glob metacharacter we expand. */
function hasGlob(segment: string): boolean {
  return segment.includes('*') || segment.includes('?')
}

function expandTilde(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, path.slice(2))
  return path
}

/**
 * Turns one `Include` path token into a sorted list of absolute file paths.
 * Handles tilde expansion, the `~/.ssh` relative base, and a glob in the final
 * segment. A non-glob token yields exactly one path (existence is checked by
 * the reader, not here); a glob whose directory is unreadable yields none.
 */
async function resolveIncludeToken(
  token: string,
  baseDir: string,
  home: string,
  deps: IncludeFsDeps,
): Promise<string[]> {
  const expanded = expandTilde(token, home)
  const abs = isAbsolute(expanded) ? expanded : join(baseDir, expanded)

  const base = basename(abs)
  if (!hasGlob(base)) return [abs]

  const dir = dirname(abs)
  let entries: string[]
  try {
    entries = await deps.listDir(dir)
  } catch {
    return [] // directory missing/unreadable — no matches, best-effort.
  }
  const re = globToRegExp(base)
  // Like glob(3), a leading-dot is only matched when the pattern itself starts
  // with a dot; otherwise dotfiles are excluded.
  const matchDotfiles = base.startsWith('.')
  return entries
    .filter((name) => (matchDotfiles || !name.startsWith('.')) && re.test(name))
    .sort()
    .map((name) => join(dir, name))
}

/** Detects an `Include` line and returns its path tokens, else null. */
function includeTokens(rawLine: string): string[] | null {
  const parsed = parseConfigLine(rawLine)
  if (parsed === null || parsed.keyword !== 'include') return null
  return parsed.args.filter((a) => a !== '')
}

/**
 * Resolves every `Include` in `rootPath` (recursively) into one flattened
 * config string. Injected `deps` default to the real filesystem + home dir.
 *
 * @throws if the ROOT file cannot be read (e.g. ENOENT). Include failures below
 *   the root are swallowed and simply contribute nothing.
 */
export async function resolveSshConfigIncludes(
  rootPath: string,
  deps: IncludeFsDeps = DEFAULT_DEPS,
): Promise<ResolveResult> {
  const home = deps.homedir()
  // OpenSSH resolves relative Includes in a user config against ~/.ssh. We use
  // that base for every root — including the "choose a file" picker path — so a
  // relative Include in an arbitrary picked file still resolves under ~/.ssh
  // (tilde/absolute includes are unaffected). Acceptable: import is user-driven.
  const baseDir = join(home, '.ssh')
  const state = { filesRead: 0, totalBytes: 0, capped: false }

  // Expands one file: reads it, splices its includes, returns its lines.
  // `ancestors` holds the resolved paths on the current chain (cycle guard).
  // The root passes `rethrow` so an unreadable root surfaces to the caller,
  // whereas an unreadable nested include is silently skipped.
  const expandFile = async (
    absPath: string,
    depth: number,
    ancestors: Set<string>,
    rethrow = false,
  ): Promise<string> => {
    const canonical = resolve(absPath)
    if (depth > MAX_DEPTH || ancestors.has(canonical) || state.capped) return ''
    if (state.filesRead >= MAX_FILES) {
      state.capped = true
      return ''
    }

    let text: string
    try {
      text = await deps.readFile(absPath)
    } catch (err) {
      if (rethrow) throw err
      return '' // missing/unreadable include — skip (best-effort).
    }
    if (state.totalBytes + text.length > MAX_TOTAL_BYTES) {
      state.capped = true
      return ''
    }
    state.filesRead += 1
    state.totalBytes += text.length

    const nextAncestors = new Set(ancestors).add(canonical)
    const out: string[] = []
    for (const rawLine of text.split(/\r?\n/)) {
      const tokens = includeTokens(rawLine)
      if (tokens === null) {
        out.push(rawLine)
        continue
      }
      for (const token of tokens) {
        const targets = await resolveIncludeToken(token, baseDir, home, deps)
        for (const target of targets) {
          out.push(await expandFile(target, depth + 1, nextAncestors))
        }
      }
    }
    return out.join('\n')
  }

  const content = await expandFile(rootPath, 0, new Set(), true)
  return { content, filesRead: state.filesRead }
}
