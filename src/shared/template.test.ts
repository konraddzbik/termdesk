import { describe, expect, it } from 'vitest'
import { parseTemplateVars, renderTemplate } from './template'

describe('parseTemplateVars', () => {
  it('returns [] when there are no placeholders', () => {
    expect(parseTemplateVars('just some text')).toEqual([])
    expect(parseTemplateVars('')).toEqual([])
  })

  it('extracts distinct variables in first-seen order', () => {
    expect(parseTemplateVars('{{b}} {{a}} {{b}} {{c}}')).toEqual([
      { name: 'b' },
      { name: 'a' },
      { name: 'c' },
    ])
  })

  it('parses defaults and descriptions', () => {
    expect(parseTemplateVars('{{name:World}}')).toEqual([{ name: 'name', default: 'World' }])
    expect(parseTemplateVars('{{name|who to greet}}')).toEqual([
      { name: 'name', description: 'who to greet' },
    ])
    expect(parseTemplateVars('{{name:World|who to greet}}')).toEqual([
      { name: 'name', default: 'World', description: 'who to greet' },
    ])
  })

  it('keeps a default containing slashes/colons after the first colon', () => {
    expect(parseTemplateVars('{{path:/usr/local:bin}}')).toEqual([
      { name: 'path', default: '/usr/local:bin' },
    ])
  })

  it('trims names but allows internal spaces', () => {
    expect(parseTemplateVars('{{  full name  }}')).toEqual([{ name: 'full name' }])
  })

  it('lets the first occurrence carrying a field win, filling gaps later', () => {
    expect(parseTemplateVars('{{a}} {{a:x}}')).toEqual([{ name: 'a', default: 'x' }])
    expect(parseTemplateVars('{{a:x}} {{a:y}}')).toEqual([{ name: 'a', default: 'x' }])
  })

  it('ignores empty and escaped placeholders', () => {
    expect(parseTemplateVars('{{}} {{ }}')).toEqual([])
    expect(parseTemplateVars('literal \\{{a}} here')).toEqual([])
  })
})

describe('renderTemplate', () => {
  it('substitutes provided values', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'Ada' })).toBe('Hello Ada!')
  })

  it('falls back to the inline default, then to empty', () => {
    expect(renderTemplate('Hi {{name:World}}')).toBe('Hi World')
    expect(renderTemplate('Hi {{name}}')).toBe('Hi ')
  })

  it('lets an explicit empty string override the default', () => {
    expect(renderTemplate('[{{x:def}}]', { x: '' })).toBe('[]')
  })

  it('substitutes every occurrence of a repeated variable', () => {
    expect(renderTemplate('{{a}}-{{a}}', { a: 'z' })).toBe('z-z')
  })

  it('inserts values literally and never re-scans them for placeholders', () => {
    // A value that itself looks like a placeholder must stay inert.
    expect(renderTemplate('{{a}}', { a: '{{b}}', b: 'LEAKED' })).toBe('{{b}}')
  })

  it('does not let a value inject shell metacharacters into further parsing', () => {
    // Rendering is pure substitution; metacharacters are just text here.
    expect(renderTemplate('run {{cmd}}', { cmd: '; rm -rf / #' })).toBe('run ; rm -rf / #')
  })

  it('keeps malformed/empty placeholders verbatim', () => {
    expect(renderTemplate('a {{}} b {{ }} c')).toBe('a {{}} b {{ }} c')
  })

  it('renders an escaped \\{{ as a literal {{ with no substitution', () => {
    expect(renderTemplate('literal \\{{name}}', { name: 'X' })).toBe('literal {{name}}')
  })

  it('uses description-only placeholders as required (no default)', () => {
    expect(renderTemplate('{{n|desc}}', { n: 'v' })).toBe('v')
    expect(renderTemplate('{{n|desc}}')).toBe('')
  })

  it('never throws on odd input', () => {
    expect(() => renderTemplate('{{{{a}}}}', { a: 'x' })).not.toThrow()
    expect(() => renderTemplate('}}{{')).not.toThrow()
  })
})
