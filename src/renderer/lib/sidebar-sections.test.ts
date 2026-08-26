import { SIDEBAR_SECTION_IDS } from '@shared/ipc'
import { describe, expect, it } from 'vitest'
import { SIDEBAR_SECTIONS } from './sidebar-sections'

describe('SIDEBAR_SECTIONS', () => {
  it('covers exactly the schema section ids, in the same order', () => {
    expect(SIDEBAR_SECTIONS.map((s) => s.id)).toEqual([...SIDEBAR_SECTION_IDS])
  })

  it('gives every section a non-empty label and hint', () => {
    for (const s of SIDEBAR_SECTIONS) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.hint.length).toBeGreaterThan(0)
    }
  })
})
