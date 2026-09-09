/**
 * Mobile-ready sync contract core (Milestone M13: issue #99; foundation for a
 * future thin mobile client, and the guardrail on M8's BYO-storage sync #62).
 *
 * Mobile is where Termius has real moat (cross-device encrypted vault). TermDesk
 * won't build a mobile client now, but the cross-cutting research is explicit:
 * the mistake to avoid is a desktop that can *never* later sync to mobile. So we
 * lock a small, versioned, transport-agnostic **sync contract** onto the M8
 * export envelope now — schema version + a monotonic revision + device id + a
 * pure conflict model — so a future non-Electron client can implement the same
 * rules against the same file/Git/S3/WebDAV storage the user brings. No TermDesk
 * server is ever involved; conflicts are detected, never silently overwritten.
 *
 * Pure and deterministic (no clock, no id generation, no I/O — the caller passes
 * `deviceId` and `now`) so the revision bump and the three-way conflict decision
 * are unit-tested in isolation. Builds on `vault-export.ts` (#61): the sync meta
 * wraps the same secret-stripped envelope.
 */

/** Bump when the on-disk sync shape changes incompatibly. A client refuses a newer major. */
export const SYNC_CONTRACT_VERSION = 1

export interface SyncMeta {
  /** The contract version this envelope was written with. */
  contractVersion: number
  /** Monotonic counter incremented on every local change; the sync ordering key. */
  revision: number
  /** Opaque id of the device that produced this revision (caller-supplied). */
  deviceId: string
  /** Unix ms when this revision was written (caller-supplied — no clock here). */
  updatedAt: number
}

export interface MakeSyncMetaOptions {
  deviceId: string
  /** Current time in Unix ms. */
  now: number
}

/**
 * Produce the meta for a new local revision. The first revision (no `prev`) is
 * revision 1; each subsequent change increments the previous revision by one.
 * The revision is a lineage counter, not a timestamp, so ordering is stable even
 * if two devices' clocks disagree.
 */
export function makeSyncMeta(
  prev: SyncMeta | null | undefined,
  opts: MakeSyncMetaOptions,
): SyncMeta {
  const revision = (prev?.revision ?? 0) + 1
  return {
    contractVersion: SYNC_CONTRACT_VERSION,
    revision,
    deviceId: opts.deviceId,
    updatedAt: opts.now,
  }
}

/**
 * Whether this build can read an envelope written with `contractVersion`.
 * Same major (here: any version `<=` ours) is readable; a newer version is
 * refused so an old client never corrupts data it doesn't understand.
 */
export function isCompatibleContract(contractVersion: number): boolean {
  return contractVersion <= SYNC_CONTRACT_VERSION
}

export type SyncComparison = 'in-sync' | 'local-ahead' | 'remote-ahead' | 'diverged'

/**
 * Three-way conflict detection. `lastSyncedRevision` is the revision at the last
 * successful sync (tracked per remote by the client); a side is "changed" if its
 * current revision is ahead of it.
 *
 *  - neither changed      → `in-sync`
 *  - only local changed   → `local-ahead`  (safe to push)
 *  - only remote changed  → `remote-ahead` (safe to pull)
 *  - both changed         → `diverged`     (conflict — never silently overwrite)
 */
export function detectSyncConflict(
  local: SyncMeta,
  remote: SyncMeta,
  lastSyncedRevision: number,
): SyncComparison {
  const localChanged = local.revision > lastSyncedRevision
  const remoteChanged = remote.revision > lastSyncedRevision
  if (!localChanged && !remoteChanged) return 'in-sync'
  if (localChanged && !remoteChanged) return 'local-ahead'
  if (!localChanged && remoteChanged) return 'remote-ahead'
  return 'diverged'
}

export type SyncAction = 'none' | 'push' | 'pull' | 'conflict'

/** Map a comparison to the action a client should take. A `diverged` state is a conflict the user resolves. */
export function resolveSync(comparison: SyncComparison): SyncAction {
  switch (comparison) {
    case 'local-ahead':
      return 'push'
    case 'remote-ahead':
      return 'pull'
    case 'diverged':
      return 'conflict'
    default:
      return 'none'
  }
}
