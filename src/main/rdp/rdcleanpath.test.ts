import { describe, expect, it } from 'vitest'
import {
  buildRdCleanPathError,
  buildRdCleanPathResponse,
  certFingerprint,
  derValueLength,
  parseRdCleanPathRequest,
  RDCLEANPATH_VERSION,
  tpktLength,
} from './rdcleanpath'

/** Minimal DER helpers to synthesize a client request for the decode test. */
function len(n: number): number[] {
  if (n < 0x80) return [n]
  const bytes: number[] = []
  let v = n
  while (v > 0) {
    bytes.unshift(v & 0xff)
    v >>= 8
  }
  return [0x80 | bytes.length, ...bytes]
}
function tlv(tag: number, content: number[]): number[] {
  return [tag, ...len(content.length), ...content]
}
function ctx(n: number, inner: number[]): number[] {
  return tlv(0xa0 + n, inner)
}
const utf8 = (s: string): number[] => [...Buffer.from(s, 'utf8')]

describe('parseRdCleanPathRequest', () => {
  it('extracts version, destination, proxyAuth and x224 from a client request', () => {
    const x224 = [0x03, 0x00, 0x00, 0x08, 0x02, 0xf0, 0x80, 0x7f]
    const body = [
      ...ctx(0, tlv(0x02, [0x0d, 0x3e])), // version 3390
      ...ctx(2, tlv(0x0c, utf8('10.0.0.5:3389'))), // destination
      ...ctx(3, tlv(0x0c, utf8('tok'))), // proxyAuth
      ...ctx(6, tlv(0x04, x224)), // x224 OCTET STRING
    ]
    const pdu = Buffer.from(tlv(0x30, body))
    const req = parseRdCleanPathRequest(pdu)
    expect(req.version).toBe(3390)
    expect(req.destination).toBe('10.0.0.5:3389')
    expect(req.proxyAuth).toBe('tok')
    expect(req.x224).toEqual(Buffer.from(x224))
  })
})

describe('buildRdCleanPathResponse', () => {
  it('produces a SEQUENCE that round-trips through the DER cursor', () => {
    const res = buildRdCleanPathResponse({
      x224: Buffer.from([0x03, 0x00, 0x00, 0x0b, 0x06, 0xd0, 0x00, 0x00, 0x12, 0x34, 0x00]),
      certChain: [Buffer.from([0x30, 0x03, 0x01, 0x02, 0x03]), Buffer.from([0x30, 0x01, 0xff])],
      serverAddr: '10.0.0.5:3389',
    })
    expect(res[0]).toBe(0x30) // SEQUENCE
    // The declared DER length matches the actual buffer length exactly.
    expect(derValueLength(res)).toBe(res.length)
    // Re-decode as a request-shaped cursor to confirm the version field encodes 3390.
    const asReq = parseRdCleanPathRequest(res)
    expect(asReq.version).toBe(RDCLEANPATH_VERSION)
  })
})

describe('buildRdCleanPathError', () => {
  it('encodes an error PDU with a version and error code', () => {
    const err = buildRdCleanPathError(6, 502)
    expect(err[0]).toBe(0x30)
    expect(derValueLength(err)).toBe(err.length)
  })
})

describe('derValueLength', () => {
  it('returns null until the full value is buffered', () => {
    const full = Buffer.from(tlv(0x30, tlv(0x02, [0x01])))
    expect(derValueLength(full.subarray(0, full.length - 1))).toBeNull()
    expect(derValueLength(full)).toBe(full.length)
  })

  it('handles long-form lengths', () => {
    const content = new Array(200).fill(0x41)
    const full = Buffer.from(tlv(0x04, content))
    expect(derValueLength(full)).toBe(full.length)
    expect(derValueLength(full.subarray(0, 10))).toBeNull()
  })
})

describe('tpktLength', () => {
  it('reads the 16-bit length from the TPKT header', () => {
    expect(tpktLength(Buffer.from([0x03, 0x00, 0x00, 0x0b, 1, 2, 3, 4, 5, 6, 7]))).toBe(11)
  })
  it('returns null when the frame is incomplete', () => {
    expect(tpktLength(Buffer.from([0x03, 0x00, 0x00, 0x0b, 1, 2]))).toBeNull()
  })
  it('rejects a non-TPKT first byte', () => {
    expect(() => tpktLength(Buffer.from([0x16, 0x03, 0x03, 0x00]))).toThrow()
  })
  it('rejects a declared length below the 4-byte header', () => {
    // A hostile server answering `03 00 00 00` used to resolve an EMPTY frame
    // and discard bytes already buffered off the socket.
    expect(() => tpktLength(Buffer.from([0x03, 0x00, 0x00, 0x00]))).toThrow(/below header size/)
    expect(() => tpktLength(Buffer.from([0x03, 0x00, 0x00, 0x03]))).toThrow(/below header size/)
  })
})

describe('certFingerprint', () => {
  it('is a colon-separated lowercase-hex SHA-256', () => {
    const fp = certFingerprint(Buffer.from('hello'))
    expect(fp).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){31}$/)
  })
})
