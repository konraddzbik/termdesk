/**
 * Minimal, pure SOCKS5 server-side parsing for dynamic (`-D`) SSH forwards.
 * Supports the only combination clients actually use for an SSH SOCKS proxy:
 * no-auth + CONNECT. Everything else is rejected with the proper reply byte.
 * No I/O here — the tunnel-manager feeds accumulated socket bytes in and writes
 * the returned reply buffers back. RFC 1928.
 */

export const SOCKS5_VERSION = 0x05
const METHOD_NO_AUTH = 0x00
const METHOD_NONE_ACCEPTABLE = 0xff
const CMD_CONNECT = 0x01

const REP_SUCCESS = 0x00
const REP_CMD_NOT_SUPPORTED = 0x07
const REP_ATYP_NOT_SUPPORTED = 0x08

function reply(rep: number): Buffer {
  // VER, REP, RSV, ATYP(IPv4), BND.ADDR 0.0.0.0, BND.PORT 0 — clients accept this.
  return Buffer.from([SOCKS5_VERSION, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
}

export type GreetingResult =
  | { status: 'incomplete' }
  | { status: 'ok'; reply: Buffer }
  | { status: 'error'; reply?: Buffer }

/** Phase 1: the client's method-selection greeting. */
export function parseGreeting(data: Buffer): GreetingResult {
  if (data.length < 2) return { status: 'incomplete' }
  if (data[0] !== SOCKS5_VERSION) return { status: 'error' }
  const nMethods = data[1] ?? 0
  if (data.length < 2 + nMethods) return { status: 'incomplete' }
  const methods = data.subarray(2, 2 + nMethods)
  if (!methods.includes(METHOD_NO_AUTH)) {
    return { status: 'error', reply: Buffer.from([SOCKS5_VERSION, METHOD_NONE_ACCEPTABLE]) }
  }
  return { status: 'ok', reply: Buffer.from([SOCKS5_VERSION, METHOD_NO_AUTH]) }
}

export type ConnectResult =
  | { status: 'incomplete' }
  | { status: 'ok'; host: string; port: number; reply: Buffer }
  | { status: 'error'; reply?: Buffer }

/** Phase 2: the CONNECT request. Returns the destination host:port + success reply. */
export function parseConnect(data: Buffer): ConnectResult {
  if (data.length < 4) return { status: 'incomplete' }
  if (data[0] !== SOCKS5_VERSION) return { status: 'error' }
  if (data[1] !== CMD_CONNECT) return { status: 'error', reply: reply(REP_CMD_NOT_SUPPORTED) }

  const atyp = data[3]
  let host: string
  let offset: number
  if (atyp === 0x01) {
    // IPv4
    if (data.length < 10) return { status: 'incomplete' }
    host = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`
    offset = 8
  } else if (atyp === 0x03) {
    // domain name
    const len = data[4] ?? 0
    if (data.length < 5 + len + 2) return { status: 'incomplete' }
    host = data.subarray(5, 5 + len).toString('utf8')
    offset = 5 + len
  } else if (atyp === 0x04) {
    // IPv6
    if (data.length < 22) return { status: 'incomplete' }
    const parts: string[] = []
    for (let i = 0; i < 16; i += 2) parts.push(data.readUInt16BE(4 + i).toString(16))
    host = parts.join(':')
    offset = 20
  } else {
    return { status: 'error', reply: reply(REP_ATYP_NOT_SUPPORTED) }
  }
  const port = data.readUInt16BE(offset)
  return { status: 'ok', host, port, reply: reply(REP_SUCCESS) }
}
