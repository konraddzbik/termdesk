import { describe, expect, it } from 'vitest'
import { parseVncConnection } from './vnc-connection-parser'

describe('parseVncConnection', () => {
  it('parses a RealVNC-style file with host::port and a connection name', () => {
    const entry = parseVncConnection(
      `[Connection]
Host=192.168.1.10::5901
Username=admin
[Options]
ConnectionName=Lab desktop
`,
      'lab',
    )
    expect(entry).toEqual({
      name: 'Lab desktop',
      hostname: '192.168.1.10',
      vncPort: 5901,
      username: 'admin',
    })
  })

  it('caps an over-long imported name and strips control characters', () => {
    const longName = 'A'.repeat(500)
    const entry = parseVncConnection(`Host=h.example.com\nConnectionName=${longName}\n`, 'fallback')
    expect(entry?.name.length).toBe(255)
    // A control char (SOH) in the label is stripped; a normal space is kept.
    const ctrl = parseVncConnection('Host=h.example.com\nName=lab\u0001desk\n', 'fallback')
    expect(ctrl?.name).toBe('labdesk')
  })

  it('maps a single-colon display number to 5900+n', () => {
    const entry = parseVncConnection('host=desktop.example.com:2\n', 'fallback')
    expect(entry).toMatchObject({ hostname: 'desktop.example.com', vncPort: 5902 })
  })

  it('treats a single-colon value >= 100 as a literal port', () => {
    const entry = parseVncConnection('host=desktop:5999\n', 'fallback')
    expect(entry?.vncPort).toBe(5999)
  })

  it('uses the separate port key (TightVNC/UltraVNC style)', () => {
    const entry = parseVncConnection(
      `[connection]
host=10.0.0.5
port=5905
`,
      'fallback',
    )
    expect(entry).toMatchObject({ hostname: '10.0.0.5', vncPort: 5905 })
  })

  it('defaults to port 5900 when none is given', () => {
    const entry = parseVncConnection('host=plain.example.com\n', 'fallback')
    expect(entry?.vncPort).toBe(5900)
  })

  it('falls back to the file name when no connection name is present', () => {
    const entry = parseVncConnection('host=10.0.0.9\n', 'My Server')
    expect(entry?.name).toBe('My Server')
  })

  it('uses the hostname as the label when name and fallback are both empty', () => {
    const entry = parseVncConnection('host=10.0.0.9\n', '   ')
    expect(entry?.name).toBe('10.0.0.9')
  })

  it('ignores comments, blank lines, and section headers', () => {
    const entry = parseVncConnection(
      `; a comment
# another comment

[Connection]
Host=box
`,
      'fallback',
    )
    expect(entry).toMatchObject({ hostname: 'box', vncPort: 5900 })
  })

  it('returns null when there is no host', () => {
    expect(parseVncConnection('[Options]\nFullScreen=1\n', 'fallback')).toBeNull()
  })

  it('treats an empty username as no username', () => {
    const entry = parseVncConnection('host=box\nusername=\n', 'fallback')
    expect(entry?.username).toBeNull()
  })
})
