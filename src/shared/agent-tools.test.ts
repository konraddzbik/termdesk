import { describe, expect, it } from 'vitest'
import { AGENT_TOOLS, agentTool, detectPreview, requiresApproval } from './agent-tools'

describe('agent tool registry (#95)', () => {
  it('marks every mutating tool as approval-required', () => {
    for (const tool of AGENT_TOOLS) {
      if (tool.mutating) expect(tool.requiresApproval).toBe(true)
    }
  })
  it('exposes session.read as the only auto-approvable (read-only) tool', () => {
    const readOnly = AGENT_TOOLS.filter((t) => !t.mutating)
    expect(readOnly.map((t) => t.name)).toEqual(['session.read'])
  })
  it('looks up by name', () => {
    expect(agentTool('session.run')?.mutating).toBe(true)
    expect(agentTool('nope')).toBeUndefined()
  })
})

describe('requiresApproval (#95)', () => {
  it('always gates mutating tools, even with autoApproveReads', () => {
    expect(requiresApproval('session.run')).toBe(true)
    expect(requiresApproval('sftp.put', { autoApproveReads: true })).toBe(true)
    expect(requiresApproval('fleet.run', { autoApproveReads: true })).toBe(true)
  })
  it('gates reads by default but lets them through when the user opted in', () => {
    expect(requiresApproval('session.read')).toBe(true)
    expect(requiresApproval('session.read', { autoApproveReads: true })).toBe(false)
  })
  it('fails closed on an unknown tool', () => {
    expect(requiresApproval('rm.-rf', { autoApproveReads: true })).toBe(true)
  })
})

describe('detectPreview (#97)', () => {
  it('detects a data-URI image and its format', () => {
    const p = detectPreview('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB')
    expect(p).toEqual({ kind: 'image', format: 'png', dataUri: true })
  })
  it('detects a bare base64 image by signature', () => {
    // PNG signature "iVBORw0KGgo" + padding to clear the length gate.
    expect(detectPreview('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB').kind).toBe('image')
    expect(detectPreview('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBD').kind).toBe('image') // jpeg
  })
  it('detects JSON objects and arrays', () => {
    expect(detectPreview('{"a":1,"b":2}')).toEqual({ kind: 'json', jsonType: 'object' })
    expect(detectPreview('[\n  1,\n  2,\n  3\n]')).toEqual({ kind: 'json', jsonType: 'array' })
  })
  it('does not mistake a multi-line JSON array for a table', () => {
    expect(detectPreview('[\n{"a":1},\n{"a":2}\n]').kind).toBe('json')
  })
  it('detects a CSV table with column and row counts', () => {
    const csv = 'name,age,city\nalice,30,paris\nbob,25,rome'
    expect(detectPreview(csv)).toEqual({ kind: 'table', delimiter: ',', columns: 3, rows: 3 })
  })
  it('detects a TSV table (a single tab per line is enough)', () => {
    const tsv = 'a\tb\nc\td\ne\tf'
    expect(detectPreview(tsv)).toEqual({ kind: 'table', delimiter: '\t', columns: 2, rows: 3 })
  })
  it('does not sniff ordinary prose with one comma per line as a table', () => {
    // A comma table needs >= 3 columns; single-comma prose stays text.
    expect(detectPreview('Hello, world\nGoodbye, moon').kind).toBe('text')
  })
  it('validates delimiter consistency over the same lines it counts as rows', () => {
    // First two lines are clean 3-col CSV, third is prose → not a table.
    expect(detectPreview('a,b,c\nd,e,f\nnow some prose here').kind).toBe('text')
    // A clean 3-col CSV reports rows over exactly the validated lines.
    expect(detectPreview('a,b,c\nd,e,f\ng,h,i')).toEqual({
      kind: 'table',
      delimiter: ',',
      columns: 3,
      rows: 3,
    })
  })
  it('does not treat a non-image base64 blob (short magic) as an image', () => {
    // "Qk" (BMP) is intentionally not a signature — would false-positive.
    expect(detectPreview('QkFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB').kind).not.toBe('image')
  })
  it('falls back to text for prose and single lines', () => {
    expect(detectPreview('just some log output here')).toEqual({ kind: 'text' })
    expect(detectPreview('name,age,city')).toEqual({ kind: 'text' }) // one row, not a table
    expect(detectPreview('')).toEqual({ kind: 'text' })
    // Inconsistent delimiter counts are not a table.
    expect(detectPreview('a,b,c\nd,e').kind).toBe('text')
  })
})
