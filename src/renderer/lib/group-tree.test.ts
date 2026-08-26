import type { Group } from '@shared/ipc'
import { describe, expect, it } from 'vitest'
import { buildGroupTree, descendantIds, flattenGroupTree, groupPath } from './group-tree'

const g = (id: string, parentId: string | null, sortOrder = 0, name = id): Group => ({
  id,
  name,
  color: null,
  parentId,
  sortOrder,
})

// prod
//   eu
//     web
//   us
// standalone
const groups: Group[] = [
  g('prod', null, 0, 'prod'),
  g('eu', 'prod', 0, 'eu'),
  g('web', 'eu', 0, 'web'),
  g('us', 'prod', 1, 'us'),
  g('standalone', null, 1, 'standalone'),
]

describe('buildGroupTree', () => {
  it('nests children under parents with correct depth', () => {
    const tree = buildGroupTree(groups)
    expect(tree.map((n) => n.group.id)).toEqual(['prod', 'standalone'])
    const prod = tree[0]
    expect(prod?.depth).toBe(0)
    expect(prod?.children.map((c) => c.group.id)).toEqual(['eu', 'us'])
    expect(prod?.children[0]?.depth).toBe(1)
    expect(prod?.children[0]?.children[0]?.group.id).toBe('web')
    expect(prod?.children[0]?.children[0]?.depth).toBe(2)
  })

  it('treats a dangling parent reference as top-level', () => {
    const orphan = [g('x', 'missing', 0, 'x')]
    const tree = buildGroupTree(orphan)
    expect(tree).toHaveLength(1)
    expect(tree[0]?.group.id).toBe('x')
    expect(tree[0]?.depth).toBe(0)
  })
})

describe('flattenGroupTree', () => {
  it('flattens depth-first with depth annotations', () => {
    expect(flattenGroupTree(groups).map((r) => [r.group.id, r.depth])).toEqual([
      ['prod', 0],
      ['eu', 1],
      ['web', 2],
      ['us', 1],
      ['standalone', 0],
    ])
  })
})

describe('groupPath', () => {
  it('joins ancestor names from the root', () => {
    expect(groupPath(groups, 'web')).toBe('prod / eu / web')
    expect(groupPath(groups, 'prod')).toBe('prod')
  })
})

describe('descendantIds', () => {
  it('includes the group itself and all nested descendants', () => {
    expect(descendantIds(groups, 'prod')).toEqual(new Set(['prod', 'eu', 'web', 'us']))
    expect(descendantIds(groups, 'eu')).toEqual(new Set(['eu', 'web']))
    expect(descendantIds(groups, 'standalone')).toEqual(new Set(['standalone']))
  })
})
