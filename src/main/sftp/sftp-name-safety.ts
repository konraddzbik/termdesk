import { extname, posix } from 'node:path'

/**
 * Pure helpers for turning a server-controlled remote path into a safe LOCAL
 * filename for edit-in-place. No Electron/db imports so they stay unit-testable.
 */

/**
 * Extensions that are safe to hand to the OS's default handler — i.e. ones that
 * open in a *viewer/editor*, never in an interpreter.
 *
 * This is an ALLOWLIST on purpose. The previous denylist could only ever be as
 * current as the author's knowledge of OS file associations, and it had real
 * gaps: `.js` is `WScript.exe %1` on Windows (executes with no execute bit),
 * `.hta` is mshta, `.terminal` makes macOS Terminal run its embedded command,
 * `.py`/`.rb` run under whatever launcher is registered. A malicious server
 * picks the remote filename, so anything not proven inert gets a `.txt` suffix
 * before `shell.openPath` sees it. The re-upload still targets the original
 * remote path, so correctness is unaffected.
 */
export const INERT_EXT = new Set([
  '',
  '.txt',
  '.text',
  '.md',
  '.markdown',
  '.log',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.csv',
  '.tsv',
  '.diff',
  '.patch',
  '.sql',
  '.properties',
  '.gitignore',
  '.editorconfig',
  '.lock',
])

/**
 * Reduces a server-controlled remote path to a safe local filename: no directory
 * traversal, no path separators (posix OR Windows), no NUL, and no extension
 * outside {@link INERT_EXT}. Returns null if the name can't be made safe.
 */
export function safeLocalName(remotePath: string): string | null {
  // Collapse Windows separators so a name like `..\evil` can't escape the dir.
  let base = posix.basename(remotePath.replace(/\\/g, '/'))
  if (
    !base ||
    base === '.' ||
    base === '..' ||
    base.includes('/') ||
    base.includes('\\') ||
    base.includes('\0')
  ) {
    return null
  }
  // Windows-reserved characters can't appear in a legitimate cross-platform
  // filename. ':' is the dangerous one — `evil.txt:payload.exe` is an NTFS
  // alternate data stream whose extension check would see `.txt` while the OS
  // can still execute the stream. Reject the whole class up front so the
  // extension allowlist below stays authoritative.
  if (/[:*?"<>|]/.test(base)) return null
  // Windows strips trailing dots and spaces when resolving a file's handler, so
  // `payload.exe.` and `payload.exe ` would still launch as `payload.exe`. Trim
  // them from the LOCAL name before the extension check (the re-upload uses the
  // original remote path, so this rename doesn't affect what's written back).
  base = base.replace(/[. ]+$/, '')
  if (!base || base === '.' || base === '..') return null
  const ext = extname(base).toLowerCase()
  return INERT_EXT.has(ext) ? base : `${base}.txt`
}
