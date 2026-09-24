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

/**
 * Bump when the on-disk sync shape changes incompatibly. A single positive
 * integer (no major/minor split); a client refuses any version newer than its own.
 */
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
 * Any positive integer version `<=` ours is readable; a newer version is refused
 * so an old client never corrupts data it doesn't understand, and a malformed
 * one (0, negative, fractional, NaN) is refused outright.
 */
export function isCompatibleContract(contractVersion: number): boolean {
  return (
    Number.isInteger(contractVersion) &&
    contractVersion >= 1 &&
    contractVersion <= SYNC_CONTRACT_VERSION
  )
}

/**
 * Structural check for a meta read from user-supplied storage, which may be
 * truncated, hand-edited or written by a buggy client. Anything that fails this
 * is never treated as "unchanged" — `detectSyncConflict` reports it as a conflict.
 */
export function isValidSyncMeta(value: unknown): value is SyncMeta {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return (
    typeof m.contractVersion === 'number' &&
    Number.isInteger(m.contractVersion) &&
    m.contractVersion >= 1 &&
    typeof m.revision === 'number' &&
    Number.isSafeInteger(m.revision) &&
    m.revision >= 0 &&
    typeof m.deviceId === 'string' &&
    m.deviceId.length > 0 &&
    typeof m.updatedAt === 'number' &&
    Number.isFinite(m.updatedAt)
  )
}

/**
 * What the client remembers about the remote at the last successful sync
 * (persisted per remote). The device id is what tells a *replaced* remote — same
 * revision number, different lineage — apart from an unchanged one.
 */
export interface SyncBaseline {
  revision: number
  deviceId: string
}

/** The baseline to persist after successfully pushing or pulling `meta`. */
export function syncBaselineOf(meta: SyncMeta): SyncBaseline {
  return { revision: meta.revision, deviceId: meta.deviceId }
}

export type SyncComparison = 'in-sync' | 'local-ahead' | 'remote-ahead' | 'diverged'

/**
 * Three-way conflict detection against the `baseline` recorded at the last
 * successful sync. A side is "changed" if its revision is ahead of the baseline.
 *
 *  - neither changed      → `in-sync`
 *  - only local changed   → `local-ahead`  (safe to push — as a conditional write)
 *  - only remote changed  → `remote-ahead` (safe to pull)
 *  - both changed         → `diverged`     (conflict — never silently overwrite)
 *
 * The remote is also `diverged` — never "unchanged" — when it can't be the
 * lineage we last synced with: its revision is *below* the baseline (rolled back,
 * restored from backup, re-created by a fresh install), it has the baseline's
 * revision but a different device id (replaced, or two devices raced to the same
 * number), or either meta is malformed. Treating any of those as unchanged would
 * turn a local change into a push that overwrites the remote.
 *
 * A bare-number `baseline` (legacy) still gets the rollback check, but a
 * same-revision replacement can't be detected without the device id.
 */
export function detectSyncConflict(
  local: SyncMeta,
  remote: SyncMeta,
  baseline: SyncBaseline | number,
): SyncComparison {
  if (!isValidSyncMeta(local) || !isValidSyncMeta(remote)) return 'diverged'
  const base = typeof baseline === 'number' ? { revision: baseline, deviceId: null } : baseline
  if (remote.revision < base.revision) return 'diverged'
  if (
    remote.revision === base.revision &&
    base.deviceId !== null &&
    remote.deviceId !== base.deviceId
  ) {
    return 'diverged'
  }
  const localChanged = local.revision > base.revision
  const remoteChanged = remote.revision > base.revision
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
