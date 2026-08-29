/**
 * Folder-tree credential & setting inheritance (issues #38, #41).
 *
 * The multi-protocol managers (Devolutions RDM, Royal TS) are loved for one
 * thing above all: set a credential / jump host / default on a parent folder and
 * every host beneath it inherits, unless overridden locally. TermDesk already
 * has nested groups (`groups.parentId`) and hosts that reference a shared
 * credential (`hosts.credentialId`); this module is the pure resolution core
 * that turns that tree into the *effective* configuration for a host.
 *
 * It is deliberately standalone (no zod / DB imports) so the precedence rules
 * are unit-tested in isolation. The main-process repo layer feeds it the host's
 * group ancestry and reads back the effective values at connect time; the schema
 * additions (group-level default columns) and IPC wiring are the follow-up.
 *
 * Precedence, per field: the host's own explicit (non-null) value wins; else the
 * NEAREST ancestor group with a value wins over farther ones; else null. Tags
 * are the special case — they are a UNION (host tags first, then ancestors
 * nearest→farthest), never an override, so a folder tag augments rather than
 * replaces a host's own tags.
 */

/** The connection fields a group folder can supply as a default. A structural subset of `@shared/ipc` Host. */
export interface InheritableDefaults {
  credentialId?: string | null
  proxyJump?: string | null
  defaultPath?: string | null
  color?: string | null
  /** Additive: merged (union) into the host's tags, never replacing them. */
  tags?: string[]
}

/** A host's own inheritable fields (the same subset, as carried on a Host). */
export interface HostInheritable extends InheritableDefaults {
  tags: string[]
}

/** A group in the host's ancestry, with the defaults it contributes. Ordered nearest-first by the caller. */
export interface AncestorGroup {
  id: string
  defaults: InheritableDefaults
}

/** Which source supplied each resolved scalar field: 'host', a group id, or 'none'. */
export type FieldSource = 'host' | 'none' | (string & {})

export interface EffectiveHostConfig {
  credentialId: string | null
  proxyJump: string | null
  defaultPath: string | null
  color: string | null
  tags: string[]
  /** Provenance of each scalar field, for an "inherited from Folder X" UI badge. */
  sources: {
    credentialId: FieldSource
    proxyJump: FieldSource
    defaultPath: FieldSource
    color: FieldSource
  }
}

const SCALAR_FIELDS = ['credentialId', 'proxyJump', 'defaultPath', 'color'] as const

function isSet(value: string | null | undefined): value is string {
  return value != null && value !== ''
}

/**
 * Resolve a host's effective inheritable config given its group ancestry ordered
 * NEAREST-first (immediate parent, then grandparent, …). Pure; never mutates.
 */
export function resolveInheritedHost(
  host: HostInheritable,
  ancestorsNearestFirst: readonly AncestorGroup[],
): EffectiveHostConfig {
  const resolved = {
    credentialId: null as string | null,
    proxyJump: null as string | null,
    defaultPath: null as string | null,
    color: null as string | null,
  }
  const sources: EffectiveHostConfig['sources'] = {
    credentialId: 'none',
    proxyJump: 'none',
    defaultPath: 'none',
    color: 'none',
  }

  for (const field of SCALAR_FIELDS) {
    if (isSet(host[field])) {
      resolved[field] = host[field] as string
      sources[field] = 'host'
      continue
    }
    for (const ancestor of ancestorsNearestFirst) {
      if (isSet(ancestor.defaults[field])) {
        resolved[field] = ancestor.defaults[field] as string
        sources[field] = ancestor.id
        break
      }
    }
  }

  // Tags: union, host first then ancestors nearest→farthest, de-duplicated, order preserved.
  const tags: string[] = []
  const seen = new Set<string>()
  for (const tag of [
    ...host.tags,
    ...ancestorsNearestFirst.flatMap((a) => a.defaults.tags ?? []),
  ]) {
    if (!seen.has(tag)) {
      seen.add(tag)
      tags.push(tag)
    }
  }

  return { ...resolved, tags, sources }
}

/**
 * Walk `parentId` links from `startGroupId` up to the root, returning ancestor
 * group ids NEAREST-first (the start group itself is included as the first
 * element). Cycle-safe — a malformed parent loop stops instead of hanging.
 */
export function orderedAncestorIds(
  startGroupId: string | null | undefined,
  groups: ReadonlyArray<{ id: string; parentId: string | null }>,
): string[] {
  if (!startGroupId) return []
  const byId = new Map(groups.map((g) => [g.id, g]))
  const chain: string[] = []
  const seen = new Set<string>()
  let current: string | null | undefined = startGroupId
  while (current && byId.has(current) && !seen.has(current)) {
    seen.add(current)
    chain.push(current)
    current = byId.get(current)?.parentId
  }
  return chain
}
