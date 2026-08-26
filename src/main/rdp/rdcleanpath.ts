import { createHash } from 'node:crypto'

/**
 * Minimal DER (ASN.1) codec for the RDCleanPath PDU that Devolutions' IronRDP
 * web client exchanges with its proxy/gateway. We implement only the field
 * shapes IronRDP uses — enough to stand in for Devolutions Gateway in-process.
 *
 * RDCleanPathPdu ::= SEQUENCE {
 *   version           [0] INTEGER,
 *   error             [1] RDCleanPathErr    OPTIONAL,  (error responses)
 *   destination       [2] UTF8String        OPTIONAL,  (request)
 *   proxyAuth         [3] UTF8String        OPTIONAL,  (request: opaque token)
 *   serverAuth        [4] UTF8String        OPTIONAL,
 *   preconnectionBlob [5] UTF8String        OPTIONAL,  (request)
 *   x224ConnectionPdu [6] OCTET STRING       OPTIONAL,  (request & response)
 *   serverCertChain   [7] SEQUENCE OF OCTET STRING OPTIONAL,  (response)
 *   serverAddr        [9] UTF8String        OPTIONAL,  (response)
 * }
 *
 * NOTE: the protocol version constant and exact tag set match the community
 * reference proxy (electerm/ironrdp-wasm). Because the RDP handshake itself
 * needs a live Windows target, this codec is verified here only by its
 * encode/decode round-trip; end-to-end validation is a manual step.
 */

/** RDCleanPath protocol version negotiated with the IronRDP web client. */
export const RDCLEANPATH_VERSION = 3390

const TAG_INTEGER = 0x02
const TAG_OCTET_STRING = 0x04
const TAG_UTF8STRING = 0x0c
const TAG_SEQUENCE = 0x30
/** Explicit context tag [n] (constructed). */
const ctx = (n: number): number => 0xa0 + n

// --- DER length ---------------------------------------------------------------

function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len])
  const bytes: number[] = []
  let n = len
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

/** Reads a DER length at `offset`; returns the value and the offset of its content. */
function readLength(buf: Buffer, offset: number): { length: number; contentStart: number } {
  const first = buf[offset]
  if (first === undefined) throw new Error('RDCleanPath: truncated length')
  if (first < 0x80) return { length: first, contentStart: offset + 1 }
  const numBytes = first & 0x7f
  if (numBytes === 0 || numBytes > 4) throw new Error('RDCleanPath: bad length form')
  let length = 0
  for (let i = 0; i < numBytes; i++) {
    const b = buf[offset + 1 + i]
    if (b === undefined) throw new Error('RDCleanPath: truncated length bytes')
    length = (length << 8) | b
  }
  return { length, contentStart: offset + 1 + numBytes }
}

function encodeTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content])
}

/** Explicitly-tagged context field [n] wrapping one inner TLV. */
function encodeContext(n: number, inner: Buffer): Buffer {
  return encodeTlv(ctx(n), inner)
}

function encodeInteger(value: number): Buffer {
  const bytes: number[] = []
  let n = value
  do {
    bytes.unshift(n & 0xff)
    n >>= 8
  } while (n > 0)
  // Ensure positive: prepend 0x00 if high bit set.
  if ((bytes[0] ?? 0) & 0x80) bytes.unshift(0x00)
  return encodeTlv(TAG_INTEGER, Buffer.from(bytes))
}

// --- TLV cursor ---------------------------------------------------------------

interface Tlv {
  tag: number
  content: Buffer
  /** Offset in the parent buffer just past this TLV. */
  next: number
}

function readTlv(buf: Buffer, offset: number): Tlv {
  const tag = buf[offset]
  if (tag === undefined) throw new Error('RDCleanPath: truncated tag')
  const { length, contentStart } = readLength(buf, offset + 1)
  const end = contentStart + length
  if (end > buf.length) throw new Error('RDCleanPath: content exceeds buffer')
  return { tag, content: buf.subarray(contentStart, end), next: end }
}

/**
 * Total encoded byte length of the DER value starting at `offset`, or null when
 * the buffer does not yet hold the full value (used to detect a complete PDU as
 * WebSocket frames arrive).
 */
export function derValueLength(buf: Buffer, offset = 0): number | null {
  if (buf.length < offset + 2) return null
  const first = buf[offset + 1]
  if (first === undefined) return null
  let headerLen: number
  let length: number
  if (first < 0x80) {
    headerLen = 2
    length = first
  } else {
    const numBytes = first & 0x7f
    if (numBytes === 0 || numBytes > 4) throw new Error('RDCleanPath: bad length form')
    if (buf.length < offset + 2 + numBytes) return null
    headerLen = 2 + numBytes
    length = 0
    for (let i = 0; i < numBytes; i++) length = (length << 8) | (buf[offset + 2 + i] as number)
  }
  const total = headerLen + length
  return buf.length >= offset + total ? total : null
}

// --- Request (client → proxy) -------------------------------------------------

export interface RdCleanPathRequest {
  version: number | null
  destination: string | null
  proxyAuth: string | null
  preconnectionBlob: string | null
  /** The RDP X.224 Connection Request PDU (TPKT-framed) to forward to the server. */
  x224: Buffer | null
}

export function parseRdCleanPathRequest(buf: Buffer): RdCleanPathRequest {
  const outer = readTlv(buf, 0)
  if (outer.tag !== TAG_SEQUENCE) throw new Error('RDCleanPath: request is not a SEQUENCE')
  const req: RdCleanPathRequest = {
    version: null,
    destination: null,
    proxyAuth: null,
    preconnectionBlob: null,
    x224: null,
  }
  let offset = 0
  const body = outer.content
  while (offset < body.length) {
    const field = readTlv(body, offset)
    offset = field.next
    // Every field is an explicitly-tagged context value; unwrap the inner TLV.
    if ((field.tag & 0xe0) !== 0xa0) continue
    const inner = readTlv(field.content, 0)
    switch (field.tag & 0x1f) {
      case 0:
        req.version = inner.content.reduce((acc, b) => (acc << 8) | b, 0)
        break
      case 2:
        req.destination = inner.content.toString('utf8')
        break
      case 3:
        req.proxyAuth = inner.content.toString('utf8')
        break
      case 5:
        req.preconnectionBlob = inner.content.toString('utf8')
        break
      case 6:
        req.x224 = Buffer.from(inner.content)
        break
      default:
        break
    }
  }
  return req
}

// --- Response (proxy → client) ------------------------------------------------

export interface RdCleanPathResponse {
  /** X.224 Connection Confirm PDU received from the server (TPKT-framed). */
  x224: Buffer
  /** Server TLS certificate chain, leaf first, each a DER-encoded certificate. */
  certChain: Buffer[]
  /** `host:port` the proxy reached. */
  serverAddr: string
}

export function buildRdCleanPathResponse(res: RdCleanPathResponse): Buffer {
  const version = encodeContext(0, encodeInteger(RDCLEANPATH_VERSION))
  const x224 = encodeContext(6, encodeTlv(TAG_OCTET_STRING, res.x224))
  const certs = res.certChain.map((der) => encodeTlv(TAG_OCTET_STRING, der))
  const certChain = encodeContext(7, encodeTlv(TAG_SEQUENCE, Buffer.concat(certs)))
  const serverAddr = encodeContext(
    9,
    encodeTlv(TAG_UTF8STRING, Buffer.from(res.serverAddr, 'utf8')),
  )
  return encodeTlv(TAG_SEQUENCE, Buffer.concat([version, x224, certChain, serverAddr]))
}

/**
 * An error PDU: version + an `error` field [1] carrying an errorCode ([0]) and
 * optional httpStatusCode ([1]). Lets the client surface a real failure reason.
 */
export function buildRdCleanPathError(errorCode: number, httpStatusCode?: number): Buffer {
  const version = encodeContext(0, encodeInteger(RDCLEANPATH_VERSION))
  const inner: Buffer[] = [encodeContext(0, encodeInteger(errorCode))]
  if (httpStatusCode !== undefined) inner.push(encodeContext(1, encodeInteger(httpStatusCode)))
  const error = encodeContext(1, encodeTlv(TAG_SEQUENCE, Buffer.concat(inner)))
  return encodeTlv(TAG_SEQUENCE, Buffer.concat([version, error]))
}

// --- TPKT framing (X.224 lives inside TPKT) -----------------------------------

/**
 * Total length of the TPKT packet at the start of `buf`, or null if incomplete.
 * TPKT header: version(0x03) reserved(0x00) length-hi length-lo.
 */
export function tpktLength(buf: Buffer): number | null {
  if (buf.length < 4) return null
  if (buf[0] !== 0x03) throw new Error('RDCleanPath: not a TPKT frame')
  const len = ((buf[2] as number) << 8) | (buf[3] as number)
  // The header itself is 4 bytes, so a declared length below that is
  // structurally impossible. The X.224 exchange is cleartext and pre-TLS by
  // design, so this field is attacker-controlled: without the bound, `03 00 00
  // 00` resolved an EMPTY frame and silently discarded whatever else had
  // already been read off the socket.
  if (len < 4) throw new Error('RDCleanPath: TPKT length below header size')
  return buf.length >= len ? len : null
}

// --- Certificate fingerprint --------------------------------------------------

/** SHA-256 fingerprint of a DER certificate, lowercase hex with colons. */
export function certFingerprint(der: Buffer): string {
  const hex = createHash('sha256').update(der).digest('hex')
  return (hex.match(/../g) ?? []).join(':')
}
