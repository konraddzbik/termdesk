import { describe, expect, it } from 'vitest'
import { classifyVncKey } from './vnc-key-trust'

describe('classifyVncKey', () => {
  const FP_A = 'SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const FP_B = 'SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

  it('treats an endpoint with no pinned keys as unknown (first use)', () => {
    expect(classifyVncKey([], FP_A)).toBe('unknown')
  })

  it('matches a presented key that is already pinned', () => {
    expect(classifyVncKey([FP_A], FP_A)).toBe('match')
    expect(classifyVncKey([FP_B, FP_A], FP_A)).toBe('match')
  })

  it('flags a changed key on a pinned endpoint as a mismatch (possible MITM)', () => {
    expect(classifyVncKey([FP_A], FP_B)).toBe('mismatch')
  })
})
