import { describe, expect, it } from 'vitest'
import { normalizePastedText, sanitizeCopiedText } from './clipboard'

// Build noisy strings via char codes so this source contains no literal
// control/invisible characters.
const ESC = String.fromCharCode(0x1b)
const NUL = String.fromCharCode(0x00)
const BEL = String.fromCharCode(0x07)
const DEL = String.fromCharCode(0x7f)
const C1 = String.fromCharCode(0x9f)
const ZWSP = String.fromCharCode(0x200b)
const ZWNJ = String.fromCharCode(0x200c)
const ZWJ = String.fromCharCode(0x200d)
const WJ = String.fromCharCode(0x2060)
const BOM = String.fromCharCode(0xfeff)

describe('sanitizeCopiedText', () => {
  it('keeps normal text, tabs, newlines and CR', () => {
    expect(sanitizeCopiedText('a\tb\nc\r')).toBe('a\tb\nc\r')
  })
  it('strips C0 control bytes (incl. ESC) but keeps tab/newline/CR', () => {
    expect(sanitizeCopiedText(`a${NUL}b${BEL}c${ESC}d`)).toBe('abcd')
    expect(sanitizeCopiedText('x\ty\nz\r')).toBe('x\ty\nz\r')
  })
  it('strips DEL and the C1 range', () => {
    expect(sanitizeCopiedText(`a${DEL}b${C1}c`)).toBe('abc')
  })
  it('strips zero-width characters and BOM', () => {
    expect(sanitizeCopiedText(`a${ZWSP}b${ZWNJ}${ZWJ}${WJ}${BOM}c`)).toBe('abc')
  })
  it('removes leftover bracketed-paste markers', () => {
    expect(sanitizeCopiedText(`${ESC}[200~ls -la${ESC}[201~`)).toBe('ls -la')
  })
})

describe('normalizePastedText', () => {
  it('collapses CRLF and lone CR to a single LF', () => {
    expect(normalizePastedText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })
  it('sanitizes noise and normalizes endings together', () => {
    expect(normalizePastedText(`echo hi${ZWSP}\r\n`)).toBe('echo hi\n')
  })
  it('leaves clean single-line text untouched', () => {
    expect(normalizePastedText('systemctl restart api')).toBe('systemctl restart api')
  })
})
