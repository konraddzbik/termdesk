import { describe, expect, it } from 'vitest'
import {
  type Host,
  hostInputSchema,
  hostSchema,
  isLoopbackListenHost,
  savedTunnelInputSchema,
  settingsPatchSchema,
  settingsSchema,
  sshSessionEventSchema,
  type Transfer,
  transferSchema,
} from './ipc'

const minimalHostInput = {
  label: 'web',
  hostname: 'example.com',
  username: 'root',
  authType: 'password',
}

describe('hostInputSchema', () => {
  it('applies defaults: port 22, tags [], vncMode tunnel, kind ssh', () => {
    const parsed = hostInputSchema.parse(minimalHostInput)
    expect(parsed.port).toBe(22)
    expect(parsed.tags).toEqual([])
    expect(parsed.vncMode).toBe('tunnel')
    expect(parsed.kind).toBe('ssh')
  })

  it('accepts ports 1 and 65535', () => {
    expect(hostInputSchema.safeParse({ ...minimalHostInput, port: 1 }).success).toBe(true)
    expect(hostInputSchema.safeParse({ ...minimalHostInput, port: 65535 }).success).toBe(true)
  })

  it('rejects port 0 and 65536', () => {
    expect(hostInputSchema.safeParse({ ...minimalHostInput, port: 0 }).success).toBe(false)
    expect(hostInputSchema.safeParse({ ...minimalHostInput, port: 65536 }).success).toBe(false)
  })

  it('rejects non-integer port', () => {
    expect(hostInputSchema.safeParse({ ...minimalHostInput, port: 22.5 }).success).toBe(false)
  })

  it('rejects empty label and hostname', () => {
    expect(hostInputSchema.safeParse({ ...minimalHostInput, label: '' }).success).toBe(false)
    expect(hostInputSchema.safeParse({ ...minimalHostInput, hostname: '' }).success).toBe(false)
  })

  it('requires username for SSH-capable hosts but not for pure VNC hosts', () => {
    // SSH (default kind) and 'both' require a username.
    expect(hostInputSchema.safeParse({ ...minimalHostInput, username: '' }).success).toBe(false)
    expect(
      hostInputSchema.safeParse({ ...minimalHostInput, kind: 'both', username: '' }).success,
    ).toBe(false)
    // Pure VNC hosts have no SSH username.
    expect(
      hostInputSchema.safeParse({
        ...minimalHostInput,
        kind: 'vnc',
        vncMode: 'direct',
        username: '',
      }).success,
    ).toBe(true)
  })

  it('rejects a VNC-only host using tunnel mode (no SSH credentials to tunnel through)', () => {
    expect(
      hostInputSchema.safeParse({
        ...minimalHostInput,
        kind: 'vnc',
        username: '',
        vncMode: 'tunnel',
      }).success,
    ).toBe(false)
    expect(
      hostInputSchema.safeParse({
        ...minimalHostInput,
        kind: 'vnc',
        username: '',
        vncMode: 'direct',
      }).success,
    ).toBe(true)
    // 'both' may still tunnel — it has SSH credentials.
    expect(
      hostInputSchema.safeParse({ ...minimalHostInput, kind: 'both', vncMode: 'tunnel' }).success,
    ).toBe(true)
  })

  it('rejects unknown authType', () => {
    expect(hostInputSchema.safeParse({ ...minimalHostInput, authType: 'kerberos' }).success).toBe(
      false,
    )
  })

  it('accepts every documented authType', () => {
    for (const authType of ['password', 'key', 'agent']) {
      expect(hostInputSchema.safeParse({ ...minimalHostInput, authType }).success).toBe(true)
    }
  })

  it('passes through optional secrets and clear flags', () => {
    const parsed = hostInputSchema.parse({
      ...minimalHostInput,
      password: 'p4ss',
      passphrase: 'phrase',
      vncPassword: 'vnc',
      clearPassword: true,
      clearPassphrase: true,
      clearVncPassword: true,
    })
    expect(parsed.password).toBe('p4ss')
    expect(parsed.passphrase).toBe('phrase')
    expect(parsed.vncPassword).toBe('vnc')
    expect(parsed.clearPassword).toBe(true)
    expect(parsed.clearPassphrase).toBe(true)
    expect(parsed.clearVncPassword).toBe(true)
  })

  it('leaves omitted secrets undefined (keep-stored-secret semantics)', () => {
    const parsed = hostInputSchema.parse(minimalHostInput)
    expect(parsed.password).toBeUndefined()
    expect(parsed.passphrase).toBeUndefined()
    expect(parsed.vncPassword).toBeUndefined()
    expect(parsed.clearPassword).toBeUndefined()
  })

  it('rejects vncPort out of range but accepts null', () => {
    expect(hostInputSchema.safeParse({ ...minimalHostInput, vncPort: 0 }).success).toBe(false)
    expect(hostInputSchema.safeParse({ ...minimalHostInput, vncPort: 65536 }).success).toBe(false)
    expect(hostInputSchema.parse({ ...minimalHostInput, vncPort: null }).vncPort).toBeNull()
    expect(hostInputSchema.parse({ ...minimalHostInput, vncPort: 5901 }).vncPort).toBe(5901)
  })
})

describe('settingsSchema', () => {
  it('fills all defaults from an empty object', () => {
    expect(settingsSchema.parse({})).toEqual({
      theme: 'dark',
      terminalFontSize: 13,
      terminalFontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      keepaliveSeconds: 15,
      terminalColorScheme: 'default',
      terminalRightClickPaste: false,
      mcpEnabled: false,
      mcpApprovalMode: 'always',
      mcpReadHostIds: [],
      mcpExecHostIds: [],
      mcpAllowPatterns: [],
      hasSeenWelcome: false,
      updateChannel: 'stable',
      tmuxEnabled: false,
      terminalProgram: 'default',
      externalTerminal: '',
      defaultHarnessId: '',
      routineSchedulerEnabled: true,
      terminalWorkspaces: [],
      sidebarSections: {
        hosts: true,
        localTerminals: true,
        workspaces: true,
        tunnels: true,
        snippets: true,
        promptBook: true,
        routines: true,
      },
    })
  })

  it('enforces terminalFontSize bounds 8..32', () => {
    expect(settingsSchema.safeParse({ terminalFontSize: 7 }).success).toBe(false)
    expect(settingsSchema.safeParse({ terminalFontSize: 8 }).success).toBe(true)
    expect(settingsSchema.safeParse({ terminalFontSize: 32 }).success).toBe(true)
    expect(settingsSchema.safeParse({ terminalFontSize: 33 }).success).toBe(false)
  })

  it('enforces keepaliveSeconds bounds 0..300', () => {
    expect(settingsSchema.safeParse({ keepaliveSeconds: -1 }).success).toBe(false)
    expect(settingsSchema.safeParse({ keepaliveSeconds: 0 }).success).toBe(true)
    expect(settingsSchema.safeParse({ keepaliveSeconds: 300 }).success).toBe(true)
    expect(settingsSchema.safeParse({ keepaliveSeconds: 301 }).success).toBe(false)
  })

  it('rejects unknown theme', () => {
    expect(settingsSchema.safeParse({ theme: 'solarized' }).success).toBe(false)
  })

  it('defaults every sidebar section to visible, per-key (back-compat)', () => {
    // A partial file that only turned off tunnels must keep the rest visible.
    const parsed = settingsSchema.parse({ sidebarSections: { tunnels: false } })
    expect(parsed.sidebarSections).toEqual({
      hosts: true,
      localTerminals: true,
      workspaces: true,
      tunnels: false,
      snippets: true,
      promptBook: true,
      routines: true,
    })
  })

  it('rejects a non-boolean sidebar section value', () => {
    expect(settingsSchema.safeParse({ sidebarSections: { hosts: 'yes' } }).success).toBe(false)
  })
})

describe('settingsPatchSchema', () => {
  it('accepts an empty patch; defaulted fields are still filled in', () => {
    expect(settingsPatchSchema.parse({})).toEqual(settingsSchema.parse({}))
  })

  it('accepts a single-key patch and keeps the provided value', () => {
    const parsed = settingsPatchSchema.parse({ theme: 'light' })
    expect(parsed.theme).toBe('light')
    expect(parsed.terminalFontSize).toBe(13)
  })

  it('still validates bounds on provided keys', () => {
    expect(settingsPatchSchema.safeParse({ terminalFontSize: 7 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ keepaliveSeconds: 301 }).success).toBe(false)
  })
})

const validHost: Host = {
  id: 'h1',
  label: 'web',
  hostname: 'example.com',
  port: 22,
  username: 'root',
  authType: 'key',
  keyPath: '/home/me/.ssh/id_ed25519',
  proxyJump: null,
  defaultPath: null,
  groupId: null,
  credentialId: null,
  tags: ['prod'],
  color: null,
  kind: 'ssh',
  vncPort: null,
  vncMode: 'tunnel',
  hasPassword: false,
  hasPassphrase: true,
  hasVncPassword: false,
  rdpPort: null,
  rdpMode: 'direct',
  domain: null,
  hasRdpPassword: false,
  createdAt: 1,
  updatedAt: 2,
}

describe('hostSchema', () => {
  it('accepts a full host record', () => {
    expect(hostSchema.safeParse(validHost).success).toBe(true)
  })

  it('rejects a wrong vncMode enum value', () => {
    expect(hostSchema.safeParse({ ...validHost, vncMode: 'websocket' }).success).toBe(false)
  })

  it('rejects a wrong authType enum value', () => {
    expect(hostSchema.safeParse({ ...validHost, authType: 'token' }).success).toBe(false)
  })
})

const validTransfer: Transfer = {
  id: 't1',
  sftpId: 's1',
  kind: 'upload',
  label: 'file.txt',
  localPath: '/tmp/file.txt',
  remotePath: '/srv/file.txt',
  totalBytes: 100,
  doneBytes: 50,
  rate: 1024,
  etaSec: null,
  status: 'active',
}

describe('transferSchema', () => {
  it('accepts the documented shape', () => {
    expect(transferSchema.safeParse(validTransfer).success).toBe(true)
  })

  it('accepts every documented status', () => {
    for (const status of ['queued', 'active', 'done', 'error', 'cancelled']) {
      expect(transferSchema.safeParse({ ...validTransfer, status }).success).toBe(true)
    }
  })

  it('rejects an unknown status and an unknown kind', () => {
    expect(transferSchema.safeParse({ ...validTransfer, status: 'paused' }).success).toBe(false)
    expect(transferSchema.safeParse({ ...validTransfer, kind: 'sync' }).success).toBe(false)
  })
})

describe('sshSessionEventSchema', () => {
  it('accepts every documented event type, message optional', () => {
    for (const type of ['connecting', 'connected', 'disconnected', 'error', 'hostkey-mismatch']) {
      expect(sshSessionEventSchema.safeParse({ sessionId: 's1', type }).success).toBe(true)
    }
    expect(
      sshSessionEventSchema.safeParse({ sessionId: 's1', type: 'error', message: 'boom' }).success,
    ).toBe(true)
  })

  it('rejects an unknown event type', () => {
    expect(sshSessionEventSchema.safeParse({ sessionId: 's1', type: 'timeout' }).success).toBe(
      false,
    )
  })
})

describe('savedTunnelInputSchema — non-loopback bind guard (L2)', () => {
  const base = {
    hostId: 'h1',
    type: 'local' as const,
    listenPort: 5432,
    dstHost: '127.0.0.1',
    dstPort: 5432,
  }

  it('accepts a loopback listen address', () => {
    expect(savedTunnelInputSchema.safeParse({ ...base, listenHost: '127.0.0.1' }).success).toBe(
      true,
    )
  })

  it('rejects a non-loopback listen address without exposeToLan', () => {
    expect(savedTunnelInputSchema.safeParse({ ...base, listenHost: '0.0.0.0' }).success).toBe(false)
  })

  it('allows a non-loopback listen address only when exposeToLan is explicitly true', () => {
    expect(
      savedTunnelInputSchema.safeParse({ ...base, listenHost: '0.0.0.0', exposeToLan: true })
        .success,
    ).toBe(true)
  })
})

describe('isLoopbackListenHost', () => {
  it('treats loopback forms as loopback', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', 'LOCALHOST']) {
      expect(isLoopbackListenHost(h)).toBe(true)
    }
  })

  it('treats routable addresses as non-loopback', () => {
    for (const h of ['0.0.0.0', '::', '192.168.1.10', '10.0.0.5']) {
      expect(isLoopbackListenHost(h)).toBe(false)
    }
  })

  it('does not accept a HOSTNAME that merely starts with 127.', () => {
    // `127.corp.example.com` resolves via DNS to whatever its A record says —
    // possibly a LAN address — so it must NOT skip the exposure confirmation.
    for (const h of ['127.corp.example.com', '127.evil.test', '127.0.0.1.attacker.tld']) {
      expect(isLoopbackListenHost(h)).toBe(false)
    }
  })

  it('rejects malformed dotted quads', () => {
    for (const h of ['127.0.0.256', '127.0.0', '127.0.0.1.2', '1270.0.0.1']) {
      expect(isLoopbackListenHost(h)).toBe(false)
    }
  })
})
