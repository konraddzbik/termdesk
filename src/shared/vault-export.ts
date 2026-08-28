/**
 * Portable, secret-safe vault export/import envelope (issue #61).
 *
 * The "config follows me" benefit users love in Termius — without the forced
 * cloud account. A v1 export is **metadata-only**: hosts, groups, credentials
 * (as references), settings and their structure travel; **no secret leaves in
 * plaintext**. safeStorage ciphertext is machine-bound (its key lives in the OS
 * keychain) and useless elsewhere, so it is stripped too — the importer re-keys
 * secrets into the local vault and flags which items need a secret re-entered
 * (each host/credential already carries `hasPassword`-style booleans).
 *
 * This is the pure envelope core: a versioned wrapper, a recursive
 * secret-field stripper (defense-in-depth so an accidental secret-bearing field
 * can never ride along), and a validating parser. Git-friendly and diff-able;
 * the passphrase-encrypted secret bundle for true cross-machine sync is the
 * separate #62 enhancement.
 *
 * CAVEAT (see docs/architecture/m8-sync-teams.md): the stripper is *key-name*
 * based, so it removes secret-typed fields but NOT secrets a user embedded in a
 * free-text CONTENT field (`automationJobs.command`, `snippets.command`,
 * `routines.variables` — e.g. `mysql -pSECRET`). The export/import layer that
 * gathers those fields MUST pass them through `redact.ts::redactSecrets` before
 * they reach the envelope.
 */

export const VAULT_EXPORT_FORMAT = 'termdesk-vault'
export const VAULT_EXPORT_VERSION = 1 as const

export interface VaultExport<T = unknown> {
  format: typeof VAULT_EXPORT_FORMAT
  version: typeof VAULT_EXPORT_VERSION
  /** v1 exports never carry decrypted secrets. */
  secretsIncluded: false
  /** ISO timestamp; optional so callers can keep exports byte-stable/diffable. */
  exportedAt?: string
  data: T
}

/**
 * Keys whose values are treated as secrets and removed on export. Matches the
 * schema's `*_enc` ciphertext columns and any password/passphrase/secret/token/
 * key-material field, however nested.
 */
const SECRET_KEY_RE =
  /(password|passphrase|secret|token|api[-_]?key|private[-_]?key|_enc$|credential[-_]?secret)/i

export interface StripResult<T> {
  cleaned: T
  /** Dot-paths of every field that was removed, for an audit/warning. */
  removed: string[]
}

/**
 * Recursively remove secret-looking fields from a plain JSON-ish value. Returns a
 * deep copy (never mutates the input) plus the paths of everything stripped.
 */
export function stripSecretFields<T>(value: T): StripResult<T> {
  const removed: string[] = []

  function walk(node: unknown, path: string): unknown {
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, `${path}[${i}]`))
    }
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key
        // A boolean is a presence flag (`hasPassword`, `secretsIncluded`), never
        // the secret itself — only actual secret VALUES (strings/buffers) are stripped.
        if (SECRET_KEY_RE.test(key) && typeof val !== 'boolean') {
          removed.push(childPath)
          continue
        }
        out[key] = walk(val, childPath)
      }
      return out
    }
    return node
  }

  return { cleaned: walk(value, '') as T, removed }
}

/** Wrap `data` in a versioned, secret-stripped export envelope. */
export function buildVaultExport<T>(data: T, opts: { exportedAt?: string } = {}): VaultExport<T> {
  const { cleaned } = stripSecretFields(data)
  const envelope: VaultExport<T> = {
    format: VAULT_EXPORT_FORMAT,
    version: VAULT_EXPORT_VERSION,
    secretsIncluded: false,
    data: cleaned,
  }
  if (opts.exportedAt) envelope.exportedAt = opts.exportedAt
  return envelope
}

/** The list of secret field-paths that `buildVaultExport` would strip from `data`. */
export function secretFieldsIn<T>(data: T): string[] {
  return stripSecretFields(data).removed
}

export class VaultImportError extends Error {}

/**
 * Validate and unwrap an export envelope. Throws {@link VaultImportError} on a
 * missing/unknown format or unsupported version rather than importing garbage.
 */
export function parseVaultExport<T = unknown>(input: unknown): VaultExport<T> {
  if (input === null || typeof input !== 'object') {
    throw new VaultImportError('not a TermDesk vault export (expected an object)')
  }
  const env = input as Partial<VaultExport<T>>
  if (env.format !== VAULT_EXPORT_FORMAT) {
    throw new VaultImportError(`unrecognized format: ${JSON.stringify(env.format)}`)
  }
  if (env.version !== VAULT_EXPORT_VERSION) {
    throw new VaultImportError(
      `unsupported version ${String(env.version)} (this build reads v${VAULT_EXPORT_VERSION})`,
    )
  }
  if (!('data' in env)) {
    throw new VaultImportError('export has no data')
  }
  // Defense-in-depth: re-strip on import too, so a hand-crafted or tampered
  // envelope that smuggled a secret-looking field cannot inject it into the
  // vault. `secretsIncluded` is always forced false regardless of the input flag.
  return {
    format: VAULT_EXPORT_FORMAT,
    version: VAULT_EXPORT_VERSION,
    secretsIncluded: false,
    exportedAt: env.exportedAt,
    data: stripSecretFields(env.data as T).cleaned,
  }
}
