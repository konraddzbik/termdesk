/**
 * Pure, dependency-free parser for VNC Viewer connection files (`.vnc`).
 *
 * Covers the common INI text format shared by RealVNC VNC Viewer (text
 * exports), TightVNC, UltraVNC, and TigerVNC. A `.vnc` file describes a single
 * connection; this returns one parsed host (or null when no host is found).
 *
 * Recognised keys (case-insensitive, first value wins, section headers ignored):
 * - `host` — hostname, optionally carrying the port/display (see below).
 * - `port` — explicit TCP port, when the host line has none.
 * - `username` / `user` — RealVNC stores a user for credentialed servers.
 * - `connectionname` / `name` / `friendlyname` — preferred label.
 *
 * Host/port forms (RealVNC convention):
 * - `host::5901`  → explicit port 5901.
 * - `host:1`      → display 1 → port 5901 (display numbers < 100 map to 5900+n).
 * - `host:5901`   → values ≥ 100 are treated as a literal port.
 * - `host`        → port falls back to the `port` key, else 5900.
 *
 * Known limitation (intentional): RealVNC's modern address book is a
 * proprietary encrypted database, not readable here. Users export individual
 * connections as `.vnc` files (or use any `.vnc`-emitting viewer) to import.
 */

const MIN_PORT = 1
const MAX_PORT = 65535
const DEFAULT_VNC_PORT = 5900
/** Display numbers below this map to 5900+n; values at/above are literal ports. */
const DISPLAY_CEILING = 100

export interface ParsedVncHost {
  /** Friendly label for the host row. */
  name: string
  hostname: string
  vncPort: number
  username: string | null
}

/** Parses INI-style `key=value` lines into a lowercased-key map (first wins). */
function parseIni(content: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';') || line.startsWith('[')) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    if (!map.has(key)) map.set(key, value)
  }
  return map
}

function clampPort(n: number): number | null {
  return Number.isInteger(n) && n >= MIN_PORT && n <= MAX_PORT ? n : null
}

/** Splits a `host`, `host:display`, or `host::port` value into hostname + port. */
function splitHostPort(value: string): { hostname: string; port: number | null } {
  // `host::port` — explicit port after a double colon.
  const doubleColon = value.indexOf('::')
  if (doubleColon !== -1) {
    const hostname = value.slice(0, doubleColon).trim()
    const port = clampPort(Number(value.slice(doubleColon + 2).trim()))
    return { hostname, port }
  }
  // `host:n` — single colon is a display number (n<100 → 5900+n) or a port.
  const colon = value.lastIndexOf(':')
  if (colon !== -1) {
    const hostname = value.slice(0, colon).trim()
    const n = Number(value.slice(colon + 1).trim())
    if (Number.isInteger(n)) {
      const port = n < DISPLAY_CEILING ? clampPort(DEFAULT_VNC_PORT + n) : clampPort(n)
      return { hostname, port }
    }
    return { hostname, port: null }
  }
  return { hostname: value.trim(), port: null }
}

/** True if the string contains any whitespace or control character (<= space, or DEL). */
function hasWhitespaceOrControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c <= 0x20 || c === 0x7f) return true
  }
  return false
}

/** Caps length and drops control characters from an untrusted label. */
function sanitizeLabel(label: string): string {
  let out = ''
  for (const ch of label) {
    const c = ch.codePointAt(0) ?? 0
    if (c >= 0x20 && c !== 0x7f) out += ch
  }
  return out.trim().slice(0, 255)
}

/**
 * Parses one `.vnc` connection file. `fallbackName` (typically the file name
 * without extension) is used as the label when the file carries no name.
 * Returns null when no usable hostname is present.
 */
export function parseVncConnection(content: string, fallbackName: string): ParsedVncHost | null {
  const ini = parseIni(content)

  const rawHost = ini.get('host') ?? ini.get('hostname')
  if (!rawHost) return null

  const { hostname, port: hostPort } = splitHostPort(rawHost)
  // Reject empty, over-long, or whitespace/control-char hostnames from an
  // imported file — they're never valid and shouldn't enter the host store.
  if (hostname === '' || hostname.length > 255 || hasWhitespaceOrControl(hostname)) {
    return null
  }

  const portKey = ini.has('port') ? clampPort(Number(ini.get('port'))) : null
  const vncPort = hostPort ?? portKey ?? DEFAULT_VNC_PORT

  const username = ini.get('username') ?? ini.get('user') ?? null

  const rawName =
    ini.get('connectionname') ??
    ini.get('name') ??
    ini.get('friendlyname') ??
    (fallbackName.trim() || hostname)
  // The label comes from an untrusted .vnc file — bound its length and drop
  // control characters before it enters the host store / UI.
  const name = sanitizeLabel(rawName) || hostname

  return { name, hostname, vncPort, username: username && username !== '' ? username : null }
}
