import { describe, expect, it } from 'vitest'
import { parseConnect, parseGreeting } from './socks'

describe('parseGreeting', () => {
  it('needs more bytes when truncated', () => {
    expect(parseGreeting(Buffer.from([0x05])).status).toBe('incomplete')
    expect(parseGreeting(Buffer.from([0x05, 0x02, 0x00])).status).toBe('incomplete')
  })

  it('selects no-auth when offered', () => {
    const r = parseGreeting(Buffer.from([0x05, 0x02, 0x00, 0x02]))
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect([...r.reply]).toEqual([0x05, 0x00])
  })

  it('rejects when no-auth is not offered', () => {
    const r = parseGreeting(Buffer.from([0x05, 0x01, 0x02]))
    expect(r.status).toBe('error')
    if (r.status === 'error') expect([...(r.reply ?? [])]).toEqual([0x05, 0xff])
  })

  it('rejects a non-SOCKS5 version', () => {
    expect(parseGreeting(Buffer.from([0x04, 0x01, 0x00])).status).toBe('error')
  })
})

describe('parseConnect', () => {
  it('parses an IPv4 CONNECT', () => {
    const buf = Buffer.from([0x05, 0x01, 0x00, 0x01, 10, 0, 0, 5, 0x1f, 0x90]) // 10.0.0.5:8080
    const r = parseConnect(buf)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.host).toBe('10.0.0.5')
      expect(r.port).toBe(8080)
      expect(r.reply[1]).toBe(0x00) // success
    }
  })

  it('parses a domain CONNECT', () => {
    const host = 'db.internal'
    const buf = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
      Buffer.from(host, 'utf8'),
      Buffer.from([0x14, 0x51]), // 5201
    ])
    const r = parseConnect(buf)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.host).toBe('db.internal')
      expect(r.port).toBe(5201)
    }
  })

  it('needs more bytes for a partial domain request', () => {
    const buf = Buffer.from([0x05, 0x01, 0x00, 0x03, 0x05, 0x61]) // claims 5-char host, only 1 sent
    expect(parseConnect(buf).status).toBe('incomplete')
  })

  it('rejects a non-CONNECT command (e.g. BIND/UDP)', () => {
    const r = parseConnect(Buffer.from([0x05, 0x02, 0x00, 0x01, 1, 2, 3, 4, 0, 80]))
    expect(r.status).toBe('error')
    if (r.status === 'error') expect(r.reply?.[1]).toBe(0x07)
  })

  it('rejects an unsupported address type', () => {
    const r = parseConnect(Buffer.from([0x05, 0x01, 0x00, 0x09, 0, 0]))
    expect(r.status).toBe('error')
    if (r.status === 'error') expect(r.reply?.[1]).toBe(0x08)
  })
})
