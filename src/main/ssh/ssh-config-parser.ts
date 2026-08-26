/**
 * Pure, dependency-free OpenSSH client config (`~/.ssh/config`) parser.
 *
 * Extracts concrete host entries for vault import. Mirrors real ssh_config
 * semantics where practical:
 * - `Host` lines open a block; each concrete (non-pattern) alias on the line
 *   yields one entry.
 * - Within a block the FIRST obtained value for a keyword wins.
 * - Keywords are case-insensitive and accept both `Key value` and
 *   `Key=value` separators; values may be double-quoted.
 * - `Match` blocks are skipped entirely (until the next `Host` line).
 *
 * - `Host *` and other pattern blocks (`prod-*`, `!excluded`) contribute their
 *   keywords to every concrete alias they match, following OpenSSH
 *   first-obtained-wins-in-file-order semantics. Pattern-only blocks still add
 *   no entries of their own.
 *
 * Known limitations (intentional — out of scope for vault import):
 * - `Include` directives are resolved by `resolveSshConfigIncludes`
 *   (`ssh-config-include.ts`) *before* this parser runs; `parseSshConfig`
 *   itself operates on already-flattened text and ignores stray `Include`
 *   lines.
 * - `Match` blocks are skipped entirely (until the next `Host` line).
 */

export interface ParsedSshHost {
  alias: string
  hostname: string
  port: number
  username: string | null
  identityFile: string | null
  proxyJump: string | null
}

/** Keywords we extract; everything else is ignored. */
const KNOWN_KEYWORDS = new Set(['hostname', 'port', 'user', 'identityfile', 'proxyjump'])

const MIN_PORT = 1
const MAX_PORT = 65535
const DEFAULT_PORT = 22

export interface ParsedLine {
  keyword: string
  /** Argument tokens with quotes already stripped. */
  args: string[]
}

/**
 * Splits a config line into a lowercased keyword and its argument tokens.
 * Handles `Key value`, `Key=value`, `Key = value` and double-quoted values.
 * Returns null for blank lines, comments and malformed lines. Exported so the
 * `Include` resolver tokenizes directive paths identically to the parser.
 */
export function parseConfigLine(rawLine: string): ParsedLine | null {
  const line = rawLine.trim()
  if (line === '' || line.startsWith('#')) return null

  // Keyword runs until whitespace or '='.
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === undefined || ch === '=' || /\s/.test(ch)) break
    i++
  }
  const keyword = line.slice(0, i).toLowerCase()
  if (keyword === '') return null

  // Skip whitespace, at most one '=', then whitespace again.
  while (i < line.length && /\s/.test(line[i] as string)) i++
  if (line[i] === '=') {
    i++
    while (i < line.length && /\s/.test(line[i] as string)) i++
  }

  return { keyword, args: tokenize(line.slice(i)) }
}

/** Splits a string into whitespace-separated tokens, honouring double quotes. */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < input.length) {
    // Skip leading whitespace.
    while (i < input.length && /\s/.test(input[i] as string)) i++
    if (i >= input.length) break

    let token = ''
    while (i < input.length && !/\s/.test(input[i] as string)) {
      if (input[i] === '"') {
        i++ // opening quote
        while (i < input.length && input[i] !== '"') {
          token += input[i]
          i++
        }
        i++ // closing quote (or end of line on unterminated quote)
      } else {
        token += input[i]
        i++
      }
    }
    tokens.push(token)
  }
  return tokens
}

/** True for tokens that are patterns, not concrete importable aliases. */
function isPatternAlias(alias: string): boolean {
  return alias.includes('*') || alias.includes('?') || alias.startsWith('!')
}

/**
 * Matches a single OpenSSH host pattern against a concrete alias. `*` matches
 * any run of characters and `?` matches exactly one; everything else is
 * literal. Matching is case-sensitive, mirroring OpenSSH's treatment of the
 * host argument. The pattern here must NOT carry a leading `!` (negation is
 * handled by the caller).
 */
function matchesPattern(pattern: string, alias: string): boolean {
  if (!pattern.includes('*') && !pattern.includes('?')) return pattern === alias
  return globToRegExp(pattern).test(alias)
}

/**
 * Compiles a glob segment (`*` → any run, `?` → one char; everything else
 * literal) into an anchored, case-sensitive RegExp. Shared by host-pattern
 * matching here and `Include`-glob expansion in `ssh-config-include.ts` so the
 * two never drift.
 */
export function globToRegExp(pattern: string): RegExp {
  let body = '^'
  for (const ch of pattern) {
    if (ch === '*') body += '.*'
    else if (ch === '?') body += '.'
    else body += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${body}$`)
}

/**
 * Applies OpenSSH `Host`-line matching: a block matches an alias when at least
 * one positive pattern matches AND no negated (`!`) pattern matches. A block
 * whose only patterns are negations never matches (OpenSSH requires a positive
 * match), which is why a lone `Host !x` contributes nothing.
 */
function blockMatchesAlias(patterns: string[], alias: string): boolean {
  let positiveMatch = false
  for (const raw of patterns) {
    if (raw.startsWith('!')) {
      if (matchesPattern(raw.slice(1), alias)) return false
    } else if (matchesPattern(raw, alias)) {
      positiveMatch = true
    }
  }
  return positiveMatch
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) return DEFAULT_PORT
  const port = Number.parseInt(value, 10)
  if (port < MIN_PORT || port > MAX_PORT) return DEFAULT_PORT
  return port
}

interface Block {
  /** Raw `Host`-line patterns, including wildcards and `!` negations. */
  patterns: string[]
  /** keyword (lowercased) -> first obtained value within this block */
  values: Map<string, string>
}

/**
 * Parses the textual content of an OpenSSH client config file into a list of
 * concrete host entries. Never throws on malformed input — unparseable lines
 * are simply ignored.
 *
 * Blocks are collected in file order, then each concrete alias is resolved by
 * walking the blocks top-to-bottom and applying, for every block whose
 * patterns match that alias (including `Host *` and other wildcard blocks),
 * the OpenSSH rule that the FIRST obtained value for a keyword wins. A concrete
 * alias's own block therefore composes with any matching wildcard-default
 * blocks exactly as `ssh` would resolve them.
 */
export function parseSshConfig(content: string): ParsedSshHost[] {
  const blocks: Block[] = []
  // Concrete (non-pattern) aliases in first-seen order — the entries we emit.
  const aliasOrder: string[] = []
  const seenAliases = new Set<string>()

  let block: Block | null = null
  let inMatchBlock = false

  for (const rawLine of content.split(/\r?\n/)) {
    const line = parseConfigLine(rawLine)
    if (line === null) continue

    if (line.keyword === 'host') {
      inMatchBlock = false
      block = { patterns: line.args.filter((a) => a !== ''), values: new Map() }
      blocks.push(block)
      for (const alias of block.patterns) {
        if (!isPatternAlias(alias) && !seenAliases.has(alias)) {
          seenAliases.add(alias)
          aliasOrder.push(alias)
        }
      }
      continue
    }

    if (line.keyword === 'match') {
      inMatchBlock = true
      block = null
      continue
    }

    if (inMatchBlock || block === null) continue
    if (!KNOWN_KEYWORDS.has(line.keyword)) continue

    const value = line.args[0]
    if (value === undefined || value === '') continue

    // ssh_config rule: the first obtained value for a keyword wins.
    if (!block.values.has(line.keyword)) {
      block.values.set(line.keyword, value)
    }
  }

  // Resolve each concrete alias against every block that matches it.
  const hosts: ParsedSshHost[] = []
  for (const alias of aliasOrder) {
    const merged = new Map<string, string>()
    for (const b of blocks) {
      if (!blockMatchesAlias(b.patterns, alias)) continue
      for (const [kw, val] of b.values) {
        if (!merged.has(kw)) merged.set(kw, val)
      }
    }
    const portValue = merged.get('port')
    hosts.push({
      alias,
      hostname: merged.get('hostname') ?? alias,
      port: portValue !== undefined ? parsePort(portValue) : DEFAULT_PORT,
      username: merged.get('user') ?? null,
      identityFile: merged.get('identityfile') ?? null,
      proxyJump: merged.get('proxyjump') ?? null,
    })
  }
  return hosts
}
