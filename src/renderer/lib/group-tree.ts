import type { Group } from '@shared/ipc'

export interface GroupNode {
  group: Group
  depth: number
  children: GroupNode[]
}

const bySortThenName = (a: Group, b: Group): number =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)

/**
 * A group's effective parent: its `parentId` only if that group still exists,
 * otherwise null (a dangling reference is treated as top-level — defensive,
 * since the FK is ON DELETE SET NULL).
 */
function effectiveParent(group: Group, ids: Set<string>): string | null {
  return group.parentId && ids.has(group.parentId) ? group.parentId : null
}

/** Builds a nested, depth-annotated tree from a flat group list. */
export function buildGroupTree(groups: Group[]): GroupNode[] {
  const ids = new Set(groups.map((g) => g.id))
  const byParent = new Map<string | null, Group[]>()
  for (const g of groups) {
    const key = effectiveParent(g, ids)
    const siblings = byParent.get(key)
    if (siblings) siblings.push(g)
    else byParent.set(key, [g])
  }
  const build = (parentId: string | null, depth: number): GroupNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort(bySortThenName)
      .map((group) => ({ group, depth, children: build(group.id, depth + 1) }))
  return build(null, 0)
}

/** Depth-first flattening of the tree — handy for indented `<select>` options. */
export function flattenGroupTree(groups: Group[]): Array<{ group: Group; depth: number }> {
  const out: Array<{ group: Group; depth: number }> = []
  const walk = (nodes: GroupNode[]): void => {
    for (const node of nodes) {
      out.push({ group: node.group, depth: node.depth })
      walk(node.children)
    }
  }
  walk(buildGroupTree(groups))
  return out
}

/** Slash-separated path of names from the root to `id` (e.g. "Prod / EU / web"). */
export function groupPath(groups: Group[], id: string): string {
  const byId = new Map(groups.map((g) => [g.id, g] as const))
  const names: string[] = []
  const seen = new Set<string>()
  let cursor: string | null | undefined = id
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor)
    const g = byId.get(cursor)
    if (!g) break
    names.unshift(g.name)
    cursor = g.parentId
  }
  return names.join(' / ')
}

/** The id plus every group nested beneath it — used to forbid cyclic re-parenting. */
export function descendantIds(groups: Group[], id: string): Set<string> {
  const childrenOf = new Map<string, Group[]>()
  for (const g of groups) {
    if (g.parentId) {
      const arr = childrenOf.get(g.parentId)
      if (arr) arr.push(g)
      else childrenOf.set(g.parentId, [g])
    }
  }
  const result = new Set<string>([id])
  const stack = [id]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break
    for (const child of childrenOf.get(current) ?? []) {
      if (!result.has(child.id)) {
        result.add(child.id)
        stack.push(child.id)
      }
    }
  }
  return result
}
