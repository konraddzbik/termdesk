import { describe, expect, it } from 'vitest'
import { IPC, IPC_EVENTS, IPC_SEND, sshDataChannel } from './channels'

describe('sshDataChannel', () => {
  it('formats the per-session channel name', () => {
    expect(sshDataChannel('abc-123')).toBe('ssh:data:abc-123')
  })

  it('produces distinct channels for distinct sessions', () => {
    expect(sshDataChannel('a')).not.toBe(sshDataChannel('b'))
  })
})

describe('channel name uniqueness', () => {
  it('has no duplicate channel strings across IPC, IPC_SEND and IPC_EVENTS', () => {
    const all = [
      ...Object.values(IPC),
      ...Object.values(IPC_SEND),
      ...Object.values(IPC_EVENTS),
    ] as string[]
    const duplicates = all.filter((name, i) => all.indexOf(name) !== i)
    expect(duplicates).toEqual([])
    expect(new Set(all).size).toBe(all.length)
  })

  it('every channel is a non-empty string', () => {
    for (const name of [
      ...Object.values(IPC),
      ...Object.values(IPC_SEND),
      ...Object.values(IPC_EVENTS),
    ]) {
      expect(typeof name).toBe('string')
      expect(name.length).toBeGreaterThan(0)
    }
  })
})
