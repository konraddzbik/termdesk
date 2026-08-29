import { describe, expect, it } from 'vitest'
import {
  buildMagicPacket,
  isValidMac,
  macToBytes,
  normalizeMac,
  WOL_PACKET_LENGTH,
} from './wake-on-lan'

describe('normalizeMac', () => {
  it('accepts the common written forms and canonicalizes to upper colon form', () => {
    expect(normalizeMac('aa:bb:cc:dd:ee:ff')).toBe('AA:BB:CC:DD:EE:FF')
    expect(normalizeMac('AA-BB-CC-DD-EE-FF')).toBe('AA:BB:CC:DD:EE:FF')
    expect(normalizeMac('aabb.ccdd.eeff')).toBe('AA:BB:CC:DD:EE:FF') // Cisco dotted
    expect(normalizeMac('aabbccddeeff')).toBe('AA:BB:CC:DD:EE:FF') // bare
    expect(normalizeMac('  aa:bb:cc:dd:ee:ff  ')).toBe('AA:BB:CC:DD:EE:FF') // trimmed
  })

  it('rejects malformed addresses', () => {
    expect(() => normalizeMac('')).toThrow(/invalid MAC/)
    expect(() => normalizeMac('aa:bb:cc:dd:ee')).toThrow(/invalid MAC/) // too short
    expect(() => normalizeMac('aa:bb:cc:dd:ee:ff:00')).toThrow(/invalid MAC/) // too long
    expect(() => normalizeMac('gg:bb:cc:dd:ee:ff')).toThrow(/invalid MAC/) // non-hex
  })
})

describe('isValidMac', () => {
  it('reflects normalizeMac without throwing', () => {
    expect(isValidMac('aa:bb:cc:dd:ee:ff')).toBe(true)
    expect(isValidMac('nope')).toBe(false)
  })
})

describe('macToBytes', () => {
  it('returns the six MAC bytes in order', () => {
    expect(macToBytes('01:23:45:67:89:AB')).toEqual([0x01, 0x23, 0x45, 0x67, 0x89, 0xab])
  })
})

describe('buildMagicPacket', () => {
  it('is exactly 102 bytes', () => {
    expect(buildMagicPacket('aa:bb:cc:dd:ee:ff').length).toBe(WOL_PACKET_LENGTH)
    expect(WOL_PACKET_LENGTH).toBe(102)
  })

  it('starts with six 0xFF sync bytes', () => {
    const packet = buildMagicPacket('01:23:45:67:89:ab')
    expect(Array.from(packet.slice(0, 6))).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
  })

  it('repeats the MAC exactly 16 times after the sync stream', () => {
    const mac = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab]
    const packet = buildMagicPacket('01:23:45:67:89:ab')
    for (let repeat = 0; repeat < 16; repeat++) {
      const start = 6 + repeat * 6
      expect(Array.from(packet.slice(start, start + 6))).toEqual(mac)
    }
  })

  it('throws on an invalid MAC rather than emitting a bad packet', () => {
    expect(() => buildMagicPacket('not-a-mac')).toThrow(/invalid MAC/)
  })
})
