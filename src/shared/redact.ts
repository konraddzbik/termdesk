/**
 * Best-effort scrubbing of secret-bearing tokens from a free-text command before
 * it is persisted (e.g. into the local activity log). This is defense-in-depth,
 * not a guarantee — it targets the common shapes that leak credentials into
 * shell history / logs. Never rely on it to make arbitrary input "safe".
 */

const REDACTED = '«redacted»'

/** Patterns whose captured secret group is replaced with a placeholder. */
const PATTERNS: Array<{ re: RegExp; replace: (m: string, ...g: string[]) => string }> = [
  // Long flags with a required separator: --password <v> / --password=<v> / --token … / --secret …
  {
    re: /(--password|--pass|--token|--secret|--api[-_]?key)([= ])(\S+)/gi,
    replace: (_m, flag: string, sep: string) => `${flag}${sep}${REDACTED}`,
  },
  // Short -p with an optional separator: -p<v> (mysql-style), -p=<v>, -p <v>.
  // Over-redaction here is acceptable: it only scrubs the LOGGED copy, never the
  // command that actually runs.
  {
    re: /(\s-p)([= ]?)(\S+)/g,
    replace: (_m, flag: string, sep: string) => `${flag}${sep}${REDACTED}`,
  },
  // KEY=value env-style assignments for secret-looking keys
  {
    re: /\b([A-Z0-9_]*(?:PASS(?:WORD)?|SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[A-Z0-9_]*)=(\S+)/gi,
    replace: (_m, key: string) => `${key}=${REDACTED}`,
  },
  // Authorization: Bearer <token> / Basic <b64>
  {
    re: /\b(Authorization:\s*(?:Bearer|Basic))\s+(\S+)/gi,
    replace: (_m, prefix: string) => `${prefix} ${REDACTED}`,
  },
  // AWS-style access key ids and long base64-ish secrets following "key"/"secret"
  {
    re: /\b(AKIA[0-9A-Z]{16})\b/g,
    replace: () => REDACTED,
  },
  // URL userinfo: scheme://user:secret@host — the shape a `git clone` with a
  // PAT, a `psql` connection string or a `curl` against a private registry
  // takes. Keep the scheme and username (useful context), drop the secret.
  {
    re: /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
    replace: (_m, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`,
  },
  // `-u user:pass` / `--user user:pass` (curl, az, many CLIs).
  {
    re: /(\s(?:-u|--user(?:name)?)[= ])([^\s:]+):(\S+)/g,
    replace: (_m, flagAndSep: string, user: string) => `${flagAndSep}${user}:${REDACTED}`,
  },
  // Credential-bearing headers other than Authorization (`-H 'X-Api-Key: …'`).
  {
    re: /\b((?:x-)?(?:api[-_]?key|auth[-_]?token|access[-_]?token|private[-_]?token|cookie)\s*:)\s*([^\s'"]+)/gi,
    replace: (_m, prefix: string) => `${prefix} ${REDACTED}`,
  },
]

/** Returns `text` with common secret-bearing tokens masked. */
export function redactSecrets(text: string): string {
  let out = text
  for (const { re, replace } of PATTERNS) {
    out = out.replace(re, replace as (substring: string, ...args: unknown[]) => string)
  }
  return out
}
