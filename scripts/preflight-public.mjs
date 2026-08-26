// Pre-publication exposure audit. Run before making this repository public,
// and on every pull request (see the `preflight` job in .github/workflows/ci.yml).
//
//   node scripts/preflight-public.mjs
//
// Exits 0 when clean, 1 when anything is found, 2 on its own failure.
//
// Checks 1-3 read ALL GIT HISTORY, not the working tree. Deleting a key in a
// later commit does not unpublish it: `git clone` of a public repo hands over
// every blob that was ever committed. Checks 4-6 read the current tree, where
// "is it tracked right now" is the question that matters — plus a repeat of the
// credential patterns over tracked file contents, so an uncommitted secret
// fails here instead of one commit later.
//
// No dependencies, no network. The only external command is git.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Configuration — the two lists a maintainer is expected to edit
// ---------------------------------------------------------------------------

// Strings that must never appear in tracked files. Add an entry here whenever a
// value is removed from the source, so it cannot quietly come back.
//
// Deliberately empty in the public repository. An entry's `value` IS the string
// being suppressed, so a populated denylist published here would disclose the
// very thing it exists to keep out. Keep private values in a local, untracked
// copy of this list if you need them; the mechanism below works over an empty
// array.
const DENYLIST = []

// Credential-shaped strings that are documentation placeholders, not secrets.
// Matched exactly against the text the pattern captured.
const CREDENTIAL_ALLOWLIST = new Set([
  // AWS's own example key from their documentation, asserted on in the
  // redactSecrets test (src/shared/redact.test.ts).
  'AKIAIOSFODNN7EXAMPLE',
])

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const CREDENTIAL_PATTERNS = [
  ['private key header', /-----BEGIN (?:RSA |OPENSSH |DSA |EC |PGP )?PRIVATE KEY-----/g],
  ['AWS access key id', /(?:AKIA|ASIA)[0-9A-Z]{16}/g],
  ['GitHub token', /gh[pous]_[A-Za-z0-9]{30,}/g],
  ['GitHub fine-grained PAT', /github_pat_[A-Za-z0-9_]{50,}/g],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI-style API key', /sk-[A-Za-z0-9]{32,}/g],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['Google API key', /AIza[0-9A-Za-z_-]{30,}/g],
  ['JWT', /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\./g],
]

// Sensitive by extension, wherever they sit in the tree.
const SENSITIVE_EXTENSIONS = /\.(?:pem|key|p12|pfx|jks|keystore|env|ovpn|kdbx)$/i

// Sensitive by exact basename. Exact equality matters, so an ordinary source
// file whose name merely ends in `device-id` is not flagged.
const SENSITIVE_BASENAMES = new Set([
  '.env',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'license.dat',
  'device-id',
  '.npmrc',
  '.netrc',
])
const SENSITIVE_BASENAME_PATTERNS = [
  /^secrets\.(?:json|ya?ml|txt)$/i,
  // .env.local, .env.production, ... same risk as a bare .env
  /^\.env\.[^/]+$/i,
]

// Build output, logs and OS cruft. None of it belongs in a git object.
const CRUFT_DIRECTORIES = ['dist', 'out', 'coverage', 'node_modules']
function isCruftPath(p) {
  const segments = p.split('/')
  const base = segments[segments.length - 1]
  if (base === '.DS_Store') return '.DS_Store'
  if (base.endsWith('.log')) return 'log file'
  for (const dir of CRUFT_DIRECTORIES) {
    if (segments.slice(0, -1).includes(dir)) return `build output under ${dir}/`
  }
  return null
}

function sensitiveReason(p) {
  const base = p.split('/').pop() ?? p
  if (SENSITIVE_BASENAMES.has(base)) return `sensitive filename (${base})`
  if (SENSITIVE_BASENAME_PATTERNS.some((re) => re.test(base))) return `sensitive filename (${base})`
  if (SENSITIVE_EXTENSIONS.test(base)) return `sensitive extension (${path.extname(base)})`
  return null
}

// IPv4 literals that are fine to publish: loopback, unspecified, broadcast /
// netmask octets, the documentation ranges of RFC 5737, and the two example
// addresses this codebase already uses in docs and tests.
const IP_ALLOWLIST = [
  /^127\./, // 127.0.0.0/8 loopback (isLoopbackListenHost tests use 127.1.2.3)
  /^0\.0\.0\.0$/,
  /^255\./, // netmasks and broadcast
  /^10\.0\.0\./, // documentation/test LAN examples used throughout this repo
  /^192\.168\.1\./,
  /^1\.2\.3\.4$/,
  /^8\.8\.8\.8$/,
  /^192\.0\.2\./, // RFC 5737 TEST-NET-1
  /^198\.51\.100\./, // TEST-NET-2
  /^203\.0\.113\./, // TEST-NET-3
]

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

const MAX_BUFFER = 512 * 1024 * 1024

function git(args, opts = {}) {
  return execFileSync('git', args, { maxBuffer: MAX_BUFFER, encoding: 'utf8', ...opts })
}

function gitLines(args) {
  return git(args).split('\n').filter((l) => l.length > 0)
}

function assertHistoryPresent() {
  // A shallow clone makes checks 1-3 silently examine almost nothing, which is
  // the single easiest way to render this script useless. Refuse instead.
  const isShallow = git(['rev-parse', '--is-shallow-repository']).trim()
  if (isShallow === 'true') {
    console.error(
      'preflight: shallow clone — the history checks would examine almost nothing.\n' +
        '           Fetch full history first (actions/checkout with fetch-depth: 0).'
    )
    process.exit(2)
  }
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/** @type {Map<string, {items: string[], note?: string}>} */
const findings = new Map()

function report(check, detail, note) {
  const entry = findings.get(check) ?? { items: [], note }
  entry.items.push(detail)
  if (note) entry.note = note
  findings.set(check, entry)
}

// ---------------------------------------------------------------------------
// Check 1 — credential-shaped strings in every blob in history
// ---------------------------------------------------------------------------

const MAX_BLOB_BYTES = 2 * 1024 * 1024

/** This script defines the denylist, so its own blobs always match it. */
const SELF_PATH = 'scripts/preflight-public.mjs'

/** Dedupe key set for the history denylist scan: `${value}\0${path}`. */
const historyDenylistSeen = new Set()

function checkHistoryCredentials() {
  // Blobs over 2 MB are skipped: at this repo's size that is the lockfile and
  // binary assets, and reading them dominates the runtime. The remaining
  // ~1,200 blobs are read in one batch and take a second or two.
  const oids = []
  for (const line of gitLines(['cat-file', '--batch-check', '--batch-all-objects'])) {
    const [oid, type, size] = line.split(' ')
    if (type !== 'blob') continue
    if (Number(size) > MAX_BLOB_BYTES) continue
    oids.push(oid)
  }

  // Best-effort oid -> path, so a hit names a file rather than a bare hash. One
  // blob can appear at several paths; the first is enough to start looking.
  const pathForOid = new Map()
  for (const line of gitLines(['rev-list', '--objects', '--all'])) {
    const sp = line.indexOf(' ')
    if (sp === -1) continue
    const oid = line.slice(0, sp)
    if (!pathForOid.has(oid)) pathForOid.set(oid, line.slice(sp + 1))
  }

  // One `git cat-file --batch` process for all of them; parse the
  // `<oid> <type> <size>\n<content>\n` records out of the raw stdout buffer.
  const res = spawnSync('git', ['cat-file', '--batch'], {
    input: oids.join('\n') + '\n',
    maxBuffer: MAX_BUFFER,
  })
  if (res.status !== 0) {
    console.error('preflight: git cat-file --batch failed:', res.stderr?.toString())
    process.exit(2)
  }

  const buf = res.stdout
  let off = 0
  let scanned = 0
  while (off < buf.length) {
    const nl = buf.indexOf(0x0a, off)
    if (nl === -1) break
    const header = buf.toString('utf8', off, nl)
    const parts = header.split(' ')
    if (parts.length < 3) break // "<oid> missing" — should not happen
    const oid = parts[0]
    const size = Number(parts[2])
    const start = nl + 1
    const body = buf.subarray(start, start + size)
    off = start + size + 1 // trailing newline
    scanned++

    if (body.includes(0)) continue // binary
    const text = body.toString('utf8')
    for (const [label, re] of CREDENTIAL_PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text))) {
        if (CREDENTIAL_ALLOWLIST.has(m[0])) continue
        const where = pathForOid.get(oid) ?? '(unreachable blob)'
        report(
          'Credential-shaped strings in git history',
          `${label} in blob ${oid.slice(0, 12)} (${where}) — matched ${m[0].slice(0, 12)}…`
        )
      }
    }

    // The denylist has to run over HISTORY, not just the tracked tree.
    // Publishing a repository publishes every commit, tag and branch — so a
    // value removed from HEAD is still public if any reachable blob holds it.
    // Reporting only on the working tree is precisely the false all-clear this
    // script exists to prevent: it would print "clean" while a retired host
    // sat in a dozen tags. Deduplicated per (value, path) so one string in a
    // file's whole revision history is one finding, not eighty.
    const lower = text.toLowerCase()
    for (const entry of DENYLIST) {
      if (!lower.includes(entry.value.toLowerCase())) continue
      const where = pathForOid.get(oid) ?? '(unreachable blob)'
      // This file IS the denylist, so every revision of it necessarily contains
      // every value. Its own blobs are not a finding, in history or at HEAD.
      if (where === SELF_PATH) continue
      const key = `${entry.value}\u0000${where}`
      if (historyDenylistSeen.has(key)) continue
      historyDenylistSeen.add(key)
      report(
        'Denylisted strings in git history',
        `${where} — ${entry.value}: ${entry.why}`,
        'reachable from a commit, tag or branch; removing it from HEAD is not enough'
      )
    }
  }

  console.log(`  scanned ${scanned} blobs (<= 2 MB) across all history`)
}

// ---------------------------------------------------------------------------
// Checks 2 and 3 — paths ever added to history
// ---------------------------------------------------------------------------

function checkHistoryPaths() {
  const added = new Set(
    gitLines(['log', '--all', '--diff-filter=A', '--name-only', '--pretty=format:'])
  )
  for (const p of added) {
    const sensitive = sensitiveReason(p)
    if (sensitive) report('Sensitive filenames ever added to history', `${p} — ${sensitive}`)
    const cruft = isCruftPath(p)
    if (cruft) report('Build output, logs or OS cruft ever committed', `${p} — ${cruft}`)
  }
  console.log(`  examined ${added.size} distinct paths ever added`)
}

// ---------------------------------------------------------------------------
// Checks 4-6 — the current tree
// ---------------------------------------------------------------------------

function trackedFiles() {
  return git(['ls-files', '-z']).split('\0').filter(Boolean)
}

function checkTracked(files) {
  for (const p of files) {
    const sensitive = sensitiveReason(p)
    if (sensitive) report('Risky files tracked right now', `${p} — ${sensitive}`)
    const cruft = isCruftPath(p)
    if (cruft) report('Risky files tracked right now', `${p} — ${cruft}`)
    if (p === '.claude' || p.startsWith('.claude/')) {
      report('Risky files tracked right now', `${p} — agent scratch under .claude/`)
    }
  }
}

const IPV4 = /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g

function checkContents(files) {
  for (const p of files) {
    // The lockfile is all package versions and integrity hashes; coverage/ is
    // generated. Neither is hand-written, and both are noise here.
    if (p === 'package-lock.json' || p.startsWith('coverage/')) continue

    let raw
    try {
      raw = fs.readFileSync(p)
    } catch {
      continue // deleted from the working tree but still in the index
    }
    if (raw.includes(0)) continue // binary
    const text = raw.toString('utf8')

    // The same credential patterns as check 1, over the working-tree copy of
    // every tracked file. Check 1 only sees committed blobs, so a secret pasted
    // into a file but not yet committed would otherwise pass locally and fail
    // in CI one commit too late.
    for (const [label, re] of CREDENTIAL_PATTERNS) {
      re.lastIndex = 0
      let cm
      while ((cm = re.exec(text))) {
        if (CREDENTIAL_ALLOWLIST.has(cm[0])) continue
        report(
          'Credential-shaped strings in the working tree',
          `${p}:${lineOf(text, cm.index)} — ${label}, matched ${cm[0].slice(0, 12)}…`
        )
      }
    }

    IPV4.lastIndex = 0
    let m
    while ((m = IPV4.exec(text))) {
      const ip = m[1]
      if (ip.split('.').some((o) => Number(o) > 255)) continue // not an address
      if (IP_ALLOWLIST.some((re) => re.test(ip))) continue
      report(
        'IP address literals in tracked files',
        `${p}:${lineOf(text, m.index)} — ${ip}`,
        'A real LAN address was once hardcoded here (scripts/vnc-ra2-probe.mjs, now 127.0.0.1). ' +
          'Publishing internal topology helps nobody. Allowlist documentation ranges only.'
      )
    }

    const lower = text.toLowerCase()
    // This file necessarily contains every denylisted value, since the list IS
    // the values. Scanning itself would report a permanent, meaningless finding.
    const isSelf = p === SELF_PATH
    for (const entry of DENYLIST) {
      if (isSelf) break
      let idx = lower.indexOf(entry.value.toLowerCase())
      while (idx !== -1) {
        report(
          'Denylisted strings in tracked files',
          `${p}:${lineOf(text, idx)} — ${entry.value}: ${entry.why}`
        )
        idx = lower.indexOf(entry.value.toLowerCase(), idx + entry.value.length)
      }
    }
  }
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

assertHistoryPresent()

console.log('preflight: scanning all git history for credential-shaped strings')
checkHistoryCredentials()
console.log('preflight: scanning all git history for sensitive and generated paths')
checkHistoryPaths()
console.log('preflight: scanning the tracked tree')
const files = trackedFiles()
checkTracked(files)
checkContents(files)
console.log(`  read ${files.length} tracked files`)

if (findings.size === 0) {
  console.log('\npreflight: clean — nothing found.')
  process.exit(0)
}

const knownGateChecks = new Set()
let total = 0
console.log('')
for (const [check, { items, note }] of findings) {
  const label = knownGateChecks.has(check) ? `${check}  [known open gate]` : check
  console.log(`${label} — ${items.length} finding${items.length === 1 ? '' : 's'}`)
  if (note) console.log(`  note: ${note}`)
  for (const item of items) console.log(`  - ${item}`)
  console.log('')
  total += items.length
}
console.log(`preflight: ${total} finding(s). Not safe to publish as-is.`)
process.exit(1)
