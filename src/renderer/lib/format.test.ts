import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate, formatEta, formatMode, formatRate } from './format'

describe('formatBytes', () => {
  it('keeps values below 1024 in bytes with no decimals', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('crosses the KB boundary at 1024', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('crosses the MB, GB and TB boundaries', () => {
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB')
    expect(formatBytes(1.5 * 1024 ** 2)).toBe('1.5 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB')
  })

  it('rounds to a whole number once the value reaches 100', () => {
    expect(formatBytes(100 * 1024)).toBe('100 KB')
    expect(formatBytes(150.4 * 1024)).toBe('150 KB')
    expect(formatBytes(150.6 * 1024)).toBe('151 KB')
    expect(formatBytes(250 * 1024 ** 2)).toBe('250 MB')
  })

  it('keeps one decimal below 100', () => {
    expect(formatBytes(99.5 * 1024)).toBe('99.5 KB')
    expect(formatBytes(2.25 * 1024 ** 3)).toBe('2.3 GB')
  })
})

describe('formatRate', () => {
  it('appends /s to the byte formatting', () => {
    expect(formatRate(512)).toBe('512 B/s')
    expect(formatRate(2048)).toBe('2.0 KB/s')
    expect(formatRate(100 * 1024 ** 2)).toBe('100 MB/s')
  })
})

describe('formatEta', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatEta(0)).toBe('0s')
    expect(formatEta(59)).toBe('59s')
  })

  it('formats minute compositions', () => {
    expect(formatEta(60)).toBe('1m 0s')
    expect(formatEta(125)).toBe('2m 5s')
    expect(formatEta(3599)).toBe('59m 59s')
  })

  it('formats hour compositions and drops seconds', () => {
    expect(formatEta(3600)).toBe('1h 0m')
    expect(formatEta(3725)).toBe('1h 2m')
    expect(formatEta(7384)).toBe('2h 3m')
  })
})

describe('formatMode', () => {
  it('formats 0o755 as rwxr-xr-x', () => {
    expect(formatMode(0o755)).toBe('rwxr-xr-x')
  })

  it('formats 0o640 as rw-r-----', () => {
    expect(formatMode(0o640)).toBe('rw-r-----')
  })

  it('formats 0 as no permissions', () => {
    expect(formatMode(0)).toBe('---------')
  })

  it('formats 0o777 and write-only bits', () => {
    expect(formatMode(0o777)).toBe('rwxrwxrwx')
    expect(formatMode(0o222)).toBe('-w--w--w-')
  })

  it('ignores file-type bits above the permission triplets', () => {
    expect(formatMode(0o100644)).toBe('rw-r--r--')
  })
})

describe('formatDate', () => {
  it('returns an em dash for 0', () => {
    expect(formatDate(0)).toBe('—')
  })

  it('returns a locale string containing the year for real timestamps', () => {
    expect(formatDate(Date.UTC(2024, 5, 15, 12, 0))).toContain('2024')
  })
})
