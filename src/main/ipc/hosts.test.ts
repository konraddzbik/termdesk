import { describe, expect, it, vi } from 'vitest'

// hosts.ts pulls in electron's ipcMain at module load; stub it so the pure
// helper can be imported in a plain node test.
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { resolveTestPort, sanitizeErrorMessage } from './hosts'

describe('sanitizeErrorMessage', () => {
  it('returns only the first line, never a stack', () => {
    const err = new Error('Boom happened')
    err.stack = 'Error: Boom happened\n    at foo (/app/x.ts:1:1)'
    expect(sanitizeErrorMessage(err)).toBe('Boom happened')
  })

  it('redacts POSIX absolute paths (e.g. a leaked private-key path)', () => {
    const out = sanitizeErrorMessage(new Error('ENOENT: no such file /home/me/.ssh/id_ed25519'))
    expect(out).not.toContain('/home/me/.ssh/id_ed25519')
    expect(out).toContain('<path>')
  })

  it('redacts Windows and ~ paths', () => {
    expect(sanitizeErrorMessage(new Error('cannot read C:\\Users\\me\\secret.key'))).not.toContain(
      'C:\\Users',
    )
    expect(sanitizeErrorMessage(new Error('missing ~/.ssh/config'))).not.toContain('.ssh/config')
  })

  it('falls back to a generic message for non-Error and empty inputs', () => {
    expect(sanitizeErrorMessage('a string')).toBe('Connection failed')
    expect(sanitizeErrorMessage(new Error(''))).toBe('Connection failed')
    expect(sanitizeErrorMessage(undefined)).toBe('Connection failed')
  })

  it('leaves a path-free message intact', () => {
    expect(sanitizeErrorMessage(new Error('Authentication failed'))).toBe('Authentication failed')
  })
})

describe('resolveTestPort', () => {
  it('probes the VNC port for a VNC-only host that has one', () => {
    expect(resolveTestPort({ kind: 'vnc', port: 22, vncPort: 5901 })).toBe(5901)
  })

  it('defaults a VNC-only host without a VNC port to 5900 (never the SSH port)', () => {
    expect(resolveTestPort({ kind: 'vnc', port: 2222, vncPort: null })).toBe(5900)
  })

  it('always probes the SSH port for SSH and dual-capability hosts', () => {
    // Even when a vncPort is configured, an SSH-capable host is reached on its SSH port.
    expect(resolveTestPort({ kind: 'ssh', port: 22, vncPort: 5901 })).toBe(22)
    expect(resolveTestPort({ kind: 'both', port: 2200, vncPort: 5901 })).toBe(2200)
  })
})
