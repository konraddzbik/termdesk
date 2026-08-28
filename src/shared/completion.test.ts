import { describe, expect, it } from 'vitest'
import { rankCompletions, suggestCompletions } from './completion'

describe('rankCompletions', () => {
  it('only returns candidates that start with the prefix', () => {
    const history = ['git status', 'git push', 'npm test', 'grep foo']
    const values = suggestCompletions(history, 'git')
    expect(values).toEqual(expect.arrayContaining(['git status', 'git push']))
    expect(values).not.toContain('npm test')
    expect(values).not.toContain('grep foo')
  })

  it('ranks more frequent commands higher', () => {
    const history = ['git push', 'git status', 'git push', 'git push']
    const values = suggestCompletions(history, 'git')
    expect(values[0]).toBe('git push') // 3× beats 1×
  })

  it('breaks frequency ties by recency (more recent first)', () => {
    const history = ['git status', 'git stash', 'git status', 'git stash'] // both 2×
    const values = suggestCompletions(history, 'git s')
    expect(values[0]).toBe('git stash') // last occurrence is more recent
  })

  it('excludes the fully-typed prefix itself', () => {
    const history = ['git', 'git status']
    expect(suggestCompletions(history, 'git')).toEqual(['git status'])
  })

  it('is case-insensitive by default and case-sensitive on request', () => {
    const history = ['Git Status']
    expect(suggestCompletions(history, 'git')).toEqual(['Git Status'])
    expect(suggestCompletions(history, 'git', { caseSensitive: true })).toEqual([])
  })

  it('ranks the whole history for an empty prefix', () => {
    const history = ['a', 'b', 'a']
    const values = suggestCompletions(history, '')
    expect(values[0]).toBe('a') // most frequent
    expect(values).toContain('b')
  })

  it('de-duplicates and respects the limit', () => {
    const history = ['ls -1', 'ls -2', 'ls -3', 'ls -4', 'ls -1']
    const result = rankCompletions(history, 'ls', { limit: 2 })
    expect(result).toHaveLength(2)
    const values = result.map((r) => r.value)
    expect(new Set(values).size).toBe(2) // unique
  })

  it('reports frequency in the ranked result', () => {
    const history = ['git push', 'git push']
    const [top] = rankCompletions(history, 'git')
    expect(top?.frequency).toBe(2)
  })

  it('handles empty history', () => {
    expect(suggestCompletions([], 'anything')).toEqual([])
  })
})
