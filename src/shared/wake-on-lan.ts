/**
 * Wake-on-LAN magic-packet construction (issue #67).
 *
 * Pure, dependency-free logic so it is trivially testable and can be reused from
 * the main process (which does the actual UDP send) without pulling Node's
 * `dgram` into this module. The transport — broadcast on the local LAN, or a
 * datagram forwarded through an existing SSH tunnel / jump host on the target's
 * network — is layered on top in the main process; this file only turns a MAC
 * address into the 102-byte payload every WoL implementation agrees on.
 *
 * A magic packet is 6 bytes of 0xFF followed by the 6-byte target MAC repeated
 * 16 times = 102 bytes. Returned as a Uint8Array (a Node Buffer is one, and
 * `dgram.send` accepts it) so nothing here depends on the Buffer global.
 */

const MAC_BYTES = 6
const MAGIC_PACKET_BYTES = 6 + 16 * MAC_BYTES // 102

/**
 * Normalize a MAC address to canonical upper-case colon form (`AA:BB:CC:DD:EE:FF`).
 * Accepts the common written forms — colon, hyphen, Cisco dotted (`aabb.ccdd.eeff`),
 * and bare 12 hex digits. Throws on anything that is not exactly 12 hex nibbles.
 */
export function normalizeMac(input: string): string {
  const hex = input.trim().replace(/[.:-]/g, '').toUpperCase()
  if (!/^[0-9A-F]{12}$/.test(hex)) {
    throw new Error(`invalid MAC address: ${JSON.stringify(input)}`)
  }
  return (hex.match(/.{2}/g) as string[]).join(':')
}

/** The six MAC bytes, in order. Throws (via {@link normalizeMac}) on a bad address. */
export function macToBytes(input: string): number[] {
  const hex = normalizeMac(input).replace(/:/g, '')
  return (hex.match(/.{2}/g) as string[]).map((byte) => Number.parseInt(byte, 16))
}

/**
 * Build the 102-byte Wake-on-LAN magic packet for `mac`.
 * Throws if the MAC is malformed — callers should validate before sending.
 */
export function buildMagicPacket(mac: string): Uint8Array {
  const macBytes = macToBytes(mac)
  const packet = new Uint8Array(MAGIC_PACKET_BYTES)
  packet.fill(0xff, 0, MAC_BYTES) // 6 × 0xFF sync stream
  for (let repeat = 0; repeat < 16; repeat++) {
    packet.set(macBytes, MAC_BYTES + repeat * MAC_BYTES)
  }
  return packet
}

/** True when `input` is a syntactically valid MAC address (no throw). */
export function isValidMac(input: string): boolean {
  try {
    normalizeMac(input)
    return true
  } catch {
    return false
  }
}

export const WOL_PACKET_LENGTH = MAGIC_PACKET_BYTES
