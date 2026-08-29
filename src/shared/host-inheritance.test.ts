import { describe, expect, it } from 'vitest'
import {
  type AncestorGroup,
  type HostInheritable,
  orderedAncestorIds,
  resolveInheritedHost,
} from './host-inheritance'

const bareHost = (over: Partial<HostInheritable> = {}): HostInheritable => ({
  credentialId: null,
  proxyJump: null,
  defaultPath: null,
  color: null,
  tags: [],
  ...over,
})

describe('resolveInheritedHost', () => {
  it('returns the host values unchanged when there are no ancestors', () => {
    const host = bareHost({ credentialId: 'cred-1', color: '#f00', tags: ['prod'] })
    const r = resolveInheritedHost(host, [])
    expect(r.credentialId).toBe('cred-1')
    expect(r.color).toBe('#f00')
    expect(r.tags).toEqual(['prod'])
    expect(r.sources.credentialId).toBe('host')
    expect(r.sources.proxyJump).toBe('none')
  })

  it('inherits an unset field from the nearest ancestor that provides it', () => {
    const host = bareHost() // nothing set
    const ancestors: AncestorGroup[] = [
      { id: 'team', defaults: { proxyJump: 'user@bastion' } }, // nearest
      { id: 'org', defaults: { credentialId: 'org-cred', proxyJump: 'user@old' } },
    ]
    const r = resolveInheritedHost(host, ancestors)
    expect(r.proxyJump).toBe('user@bastion') // nearest wins over 'org'
    expect(r.sources.proxyJump).toBe('team')
    expect(r.credentialId).toBe('org-cred') // only 'org' provides it
    expect(r.sources.credentialId).toBe('org')
  })

  it("lets the host's own explicit value win over every ancestor", () => {
    const host = bareHost({ credentialId: 'host-cred' })
    const ancestors: AncestorGroup[] = [{ id: 'team', defaults: { credentialId: 'team-cred' } }]
    const r = resolveInheritedHost(host, ancestors)
    expect(r.credentialId).toBe('host-cred')
    expect(r.sources.credentialId).toBe('host')
  })

  it('treats empty string as unset (falls through to inheritance)', () => {
    const host = bareHost({ proxyJump: '' })
    const r = resolveInheritedHost(host, [{ id: 'team', defaults: { proxyJump: 'user@jump' } }])
    expect(r.proxyJump).toBe('user@jump')
    expect(r.sources.proxyJump).toBe('team')
  })

  it('unions tags (host first, then ancestors nearest→farthest) and de-duplicates', () => {
    const host = bareHost({ tags: ['db', 'prod'] })
    const ancestors: AncestorGroup[] = [
      { id: 'team', defaults: { tags: ['prod', 'eu'] } },
      { id: 'org', defaults: { tags: ['eu', 'core'] } },
    ]
    const r = resolveInheritedHost(host, ancestors)
    expect(r.tags).toEqual(['db', 'prod', 'eu', 'core'])
  })

  it('never mutates its inputs', () => {
    const host = bareHost({ tags: ['a'] })
    const ancestors: AncestorGroup[] = [{ id: 'g', defaults: { tags: ['b'] } }]
    resolveInheritedHost(host, ancestors)
    expect(host.tags).toEqual(['a'])
    expect(ancestors[0]?.defaults.tags).toEqual(['b'])
  })
})

describe('orderedAncestorIds', () => {
  const groups = [
    { id: 'org', parentId: null },
    { id: 'team', parentId: 'org' },
    { id: 'squad', parentId: 'team' },
  ]

  it('returns the chain nearest-first including the start group', () => {
    expect(orderedAncestorIds('squad', groups)).toEqual(['squad', 'team', 'org'])
  })

  it('returns [] for a null/absent group', () => {
    expect(orderedAncestorIds(null, groups)).toEqual([])
    expect(orderedAncestorIds('ghost', groups)).toEqual([])
  })

  it('is cycle-safe (a parent loop stops instead of hanging)', () => {
    const looped = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]
    const chain = orderedAncestorIds('a', looped)
    expect(chain).toEqual(['a', 'b'])
  })
})
