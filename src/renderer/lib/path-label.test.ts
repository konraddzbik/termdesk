import { describe, expect, it } from 'vitest'
import { lastTwoSegments } from './path-label'

describe('lastTwoSegments', () => {
  it('returns the last two segments of a deep path', () => {
    expect(lastTwoSegments('/Users/k/git/termdesk')).toBe('git/termdesk')
  })

  it('returns the single segment for a shallow path', () => {
    expect(lastTwoSegments('/Users')).toBe('Users')
  })

  it('handles trailing slashes', () => {
    expect(lastTwoSegments('/a/b/c/')).toBe('b/c')
  })

  it('handles the filesystem root', () => {
    expect(lastTwoSegments('/')).toBe('/')
  })

  it('handles Windows separators', () => {
    expect(lastTwoSegments('C:\\Users\\k\\projects\\app')).toBe('projects/app')
  })
})
