/**
 * History-learning command completion ranking (issue #49).
 *
 * WindTerm's context-aware, history-learning autocompletion is a signature
 * feature power users say is missing everywhere else. This is the pure ranking
 * core: given the session's command history and the current prefix, rank the
 * candidate completions by a blend of frequency (how often the user runs it) and
 * recency (how recently), so the suggestion is what they actually reach for.
 *
 * Dependency-free and deterministic so the ranking is unit-tested in isolation;
 * the renderer wires it to the input line (ghost text / dropdown) and the main
 * process supplies per-host + global history. An optional AI re-rank (via the
 * #46 backend) can layer on top, but the offline ranking must be good on its own.
 */

export interface RankOptions {
  /** Max candidates returned (default 10). */
  limit?: number
  /** Prefix match is case-insensitive by default; set true to require an exact-case prefix. */
  caseSensitive?: boolean
}

export interface Completion {
  value: string
  /** Combined frequency + recency score (higher = better). */
  score: number
  /** Number of times the command appears in history. */
  frequency: number
}

const DEFAULT_LIMIT = 10

/**
 * Rank completions for `prefix` from `history` (oldest → newest). Candidates that
 * start with the prefix are scored by `frequency + recency`, de-duplicated, and
 * returned best-first. The prefix itself (nothing to complete) is excluded. An
 * empty prefix ranks the whole history.
 */
export function rankCompletions(
  history: readonly string[],
  prefix: string,
  opts: RankOptions = {},
): Completion[] {
  const limit = opts.limit ?? DEFAULT_LIMIT
  const caseSensitive = opts.caseSensitive ?? false
  const needle = caseSensitive ? prefix : prefix.toLowerCase()

  const matches = (candidate: string): boolean => {
    if (candidate === prefix) return false // already fully typed
    const hay = caseSensitive ? candidate : candidate.toLowerCase()
    return needle === '' ? true : hay.startsWith(needle)
  }

  // Aggregate frequency and the most-recent position for each unique candidate.
  const freq = new Map<string, number>()
  const lastIndex = new Map<string, number>()
  for (let i = 0; i < history.length; i++) {
    const cmd = history[i]
    if (cmd === undefined || cmd === '' || !matches(cmd)) continue
    freq.set(cmd, (freq.get(cmd) ?? 0) + 1)
    lastIndex.set(cmd, i)
  }

  const span = Math.max(history.length - 1, 1)
  const scored: Completion[] = []
  for (const [value, frequency] of freq) {
    const recency = (lastIndex.get(value) ?? 0) / span // 0..1
    scored.push({ value, frequency, score: frequency + recency })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Deterministic tie-break: more recent first, then lexical.
    const recencyDiff = (lastIndex.get(b.value) ?? 0) - (lastIndex.get(a.value) ?? 0)
    if (recencyDiff !== 0) return recencyDiff
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0
  })

  return scored.slice(0, limit)
}

/** Convenience: just the ranked completion strings. */
export function suggestCompletions(
  history: readonly string[],
  prefix: string,
  opts?: RankOptions,
): string[] {
  return rankCompletions(history, prefix, opts).map((c) => c.value)
}
