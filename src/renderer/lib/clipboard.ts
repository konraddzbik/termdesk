/**
 * Clipboard hygiene for the terminal.
 *
 * Copying from / pasting into a terminal is a common source of "weird
 * characters": stray C0/C1 control bytes, zero-width characters and BOMs that
 * are invisible in the source but show up elsewhere, leftover bracketed-paste
 * markers, and CRLF line endings that a PTY turns into `^M`.
 *
 * Filtering is done by code point (not a control-char regex literal) so the
 * source stays clean and lint-safe.
 */

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff])

function isNoise(code: number): boolean {
  // Keep tab, line feed, carriage return.
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false
  // Drop other C0 controls, DEL, and the C1 range.
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true
  // Drop zero-width characters and the BOM.
  return ZERO_WIDTH.has(code)
}

/** Strip control/invisible/bracketed-paste noise from text copied out of the
 *  terminal, keeping tabs and newlines intact. */
export function sanitizeCopiedText(text: string): string {
  let out = ''
  for (const ch of text) {
    if (!isNoise(ch.codePointAt(0) ?? 0)) out += ch
  }
  // The ESC of any bracketed-paste marker is gone (control byte); drop the body.
  return out.replace(/\[20[01]~/g, '')
}

/** Prepare clipboard text for writing to a PTY: strip the same noise, then
 *  normalize every line ending to a single `\n` so `\r\n` clipboards don't
 *  inject a stray CR (`^M`) or a double newline. */
export function normalizePastedText(text: string): string {
  return sanitizeCopiedText(text).replace(/\r\n?/g, '\n')
}
