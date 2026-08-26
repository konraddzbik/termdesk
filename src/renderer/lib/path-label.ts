/**
 * A compact label for a directory path: its last two segments
 * (e.g. "/Users/k/git/termdesk" → "git/termdesk"). Falls back gracefully for
 * shallow paths and the filesystem root. Handles both `/` and `\` separators.
 */
export function lastTwoSegments(path: string): string {
  const segments = path.split(/[/\\]+/).filter((s) => s.length > 0)
  if (segments.length === 0) return path || '/'
  return segments.slice(-2).join('/')
}
