import { describe, expect, it } from 'vitest'
import { type ParsedSshHost, parseSshConfig } from './ssh-config-parser'

function byAlias(hosts: ParsedSshHost[], alias: string): ParsedSshHost {
  const host = hosts.find((h) => h.alias === alias)
  if (host === undefined) throw new Error(`expected host with alias "${alias}"`)
  return host
}

describe('parseSshConfig', () => {
  it('parses a typical config with all supported keywords', () => {
    const hosts = parseSshConfig(`
# Personal servers
Host web
  HostName web.example.com
  Port 2222
  User deploy
  IdentityFile ~/.ssh/id_ed25519
  ProxyJump bastion.example.com

Host db
  HostName 10.0.0.5
  User admin
`)
    expect(hosts).toEqual([
      {
        alias: 'web',
        hostname: 'web.example.com',
        port: 2222,
        username: 'deploy',
        identityFile: '~/.ssh/id_ed25519',
        proxyJump: 'bastion.example.com',
      },
      {
        alias: 'db',
        hostname: '10.0.0.5',
        port: 22,
        username: 'admin',
        identityFile: null,
        proxyJump: null,
      },
    ])
  })

  it('defaults hostname to the alias when HostName is absent', () => {
    const hosts = parseSshConfig('Host plain\n  User root\n')
    expect(hosts).toEqual([
      {
        alias: 'plain',
        hostname: 'plain',
        port: 22,
        username: 'root',
        identityFile: null,
        proxyJump: null,
      },
    ])
  })

  it('treats keywords case-insensitively', () => {
    const hosts = parseSshConfig(`
host MIXED
  hostname mixed.example.com
  PORT 2200
  uSeR alice
  identityfile ~/.ssh/mixed
  PROXYJUMP jump.example.com
`)
    expect(hosts).toEqual([
      {
        alias: 'MIXED',
        hostname: 'mixed.example.com',
        port: 2200,
        username: 'alice',
        identityFile: '~/.ssh/mixed',
        proxyJump: 'jump.example.com',
      },
    ])
  })

  it('handles double-quoted values, including embedded spaces', () => {
    const hosts = parseSshConfig(`
Host quoted
  HostName "quoted.example.com"
  IdentityFile "~/.ssh/my key with spaces"
  User "bob"
`)
    const host = byAlias(hosts, 'quoted')
    expect(host.hostname).toBe('quoted.example.com')
    expect(host.identityFile).toBe('~/.ssh/my key with spaces')
    expect(host.username).toBe('bob')
  })

  it('supports Key=Value and Key = Value separators', () => {
    const hosts = parseSshConfig(`
Host equals
  HostName=eq.example.com
  Port = 8022
  User= carol
  IdentityFile =~/.ssh/eq
`)
    expect(hosts).toEqual([
      {
        alias: 'equals',
        hostname: 'eq.example.com',
        port: 8022,
        username: 'carol',
        identityFile: '~/.ssh/eq',
        proxyJump: null,
      },
    ])
  })

  it('expands multi-pattern Host lines into one entry per concrete alias', () => {
    const hosts = parseSshConfig(`
Host app1 app2 app3
  HostName shared.example.com
  User svc
`)
    expect(hosts.map((h) => h.alias)).toEqual(['app1', 'app2', 'app3'])
    for (const host of hosts) {
      expect(host.hostname).toBe('shared.example.com')
      expect(host.username).toBe('svc')
    }
  })

  it('emits entries only for concrete aliases, but merges matching pattern blocks in', () => {
    const hosts = parseSshConfig(`
Host *
  User everyone

Host *.example.com staging prod-? !secret real
  HostName mixed.example.com
`)
    // Wildcard/negated patterns create no entries of their own.
    expect(hosts.map((h) => h.alias)).toEqual(['staging', 'real'])
    // 'Host *' defaults merge into every concrete alias...
    expect(byAlias(hosts, 'staging').username).toBe('everyone')
    expect(byAlias(hosts, 'real').username).toBe('everyone')
    // ...and a positive pattern on a mixed Host line applies to the aliases it matches.
    expect(byAlias(hosts, 'staging').hostname).toBe('mixed.example.com')
    expect(byAlias(hosts, 'real').hostname).toBe('mixed.example.com')
  })

  it('merges Host * defaults into concrete hosts, honouring file order', () => {
    // Host * appears FIRST, so under first-obtained-wins its User is fixed for
    // every alias before the concrete blocks are seen — exactly why OpenSSH
    // users put a `Host *` defaults block last.
    const hosts = parseSshConfig(`
Host *
  User defaultuser
  IdentityFile ~/.ssh/id_default
  Port 2200

Host web
  HostName web.example.com
  User webuser

Host db
  HostName db.example.com
`)
    const web = byAlias(hosts, 'web')
    // The Host * User is obtained first → the concrete User is shadowed.
    expect(web.username).toBe('defaultuser')
    expect(web.hostname).toBe('web.example.com')
    // Port + IdentityFile come from the Host * defaults.
    expect(web.port).toBe(2200)
    expect(web.identityFile).toBe('~/.ssh/id_default')
    const db = byAlias(hosts, 'db')
    expect(db.username).toBe('defaultuser')
    expect(db.port).toBe(2200)
    expect(db.identityFile).toBe('~/.ssh/id_default')
  })

  it('lets a concrete block override defaults when Host * comes last', () => {
    // The canonical layout: concrete blocks first, `Host *` defaults last.
    const hosts = parseSshConfig(`
Host web
  HostName web.example.com
  User webuser

Host *
  User defaultuser
  Port 2200
`)
    const web = byAlias(hosts, 'web')
    expect(web.username).toBe('webuser') // concrete value obtained first
    expect(web.port).toBe(2200) // filled from the trailing defaults
  })

  it('honours later concrete blocks but keeps Host * default order correct', () => {
    // A concrete block BEFORE the Host * block: the concrete value must win.
    const hosts = parseSshConfig(`
Host web
  User specific

Host *
  User everyone
`)
    expect(byAlias(hosts, 'web').username).toBe('specific')
  })

  it('applies prefix wildcard blocks only to matching aliases', () => {
    const hosts = parseSshConfig(`
Host prod-*
  User produser

Host prod-web
  HostName prod-web.example.com

Host dev-web
  HostName dev-web.example.com
`)
    expect(byAlias(hosts, 'prod-web').username).toBe('produser')
    // dev-web does not match prod-* → no inherited user.
    expect(byAlias(hosts, 'dev-web').username).toBeNull()
  })

  it('excludes a concrete alias from a pattern block via negation', () => {
    const hosts = parseSshConfig(`
Host * !secret
  User everyone

Host secret
  HostName secret.example.com

Host normal
  HostName normal.example.com
`)
    // 'secret' is negated out of the defaults block.
    expect(byAlias(hosts, 'secret').username).toBeNull()
    expect(byAlias(hosts, 'normal').username).toBe('everyone')
  })

  it('produces no entries for a Host line containing only patterns', () => {
    const hosts = parseSshConfig('Host * !bad ??\n  User nobody\n')
    expect(hosts).toEqual([])
  })

  it('skips Match blocks until the next Host line', () => {
    const hosts = parseSshConfig(`
Host before
  HostName before.example.com

Match user root
  HostName should-be-ignored.example.com
  Port 9999

Host after
  HostName after.example.com
`)
    expect(hosts.map((h) => h.alias)).toEqual(['before', 'after'])
    expect(byAlias(hosts, 'before').hostname).toBe('before.example.com')
    expect(byAlias(hosts, 'after').hostname).toBe('after.example.com')
    expect(byAlias(hosts, 'after').port).toBe(22)
  })

  it('applies first-obtained-value-wins for repeated keywords in a block', () => {
    const hosts = parseSshConfig(`
Host repeat
  HostName first.example.com
  HostName second.example.com
  IdentityFile ~/.ssh/first_key
  IdentityFile ~/.ssh/second_key
  Port 1111
  Port 2222
  User first
  User second
`)
    expect(hosts).toEqual([
      {
        alias: 'repeat',
        hostname: 'first.example.com',
        port: 1111,
        username: 'first',
        identityFile: '~/.ssh/first_key',
        proxyJump: null,
      },
    ])
  })

  it('falls back to port 22 on garbage, negative, or out-of-range Port values', () => {
    expect(byAlias(parseSshConfig('Host a\n Port abc\n'), 'a').port).toBe(22)
    expect(byAlias(parseSshConfig('Host b\n Port -5\n'), 'b').port).toBe(22)
    expect(byAlias(parseSshConfig('Host c\n Port 0\n'), 'c').port).toBe(22)
    expect(byAlias(parseSshConfig('Host d\n Port 70000\n'), 'd').port).toBe(22)
    expect(byAlias(parseSshConfig('Host e\n Port 22a\n'), 'e').port).toBe(22)
    expect(byAlias(parseSshConfig('Host f\n Port 443\n'), 'f').port).toBe(443)
  })

  it('keeps ~ in IdentityFile unexpanded', () => {
    const hosts = parseSshConfig('Host h\n IdentityFile ~/.ssh/id_rsa\n')
    expect(byAlias(hosts, 'h').identityFile).toBe('~/.ssh/id_rsa')
  })

  it('ignores comments, blank lines, and unknown keywords', () => {
    const hosts = parseSshConfig(`
# leading comment

Host commented
  # inner comment
  HostName real.example.com
  ForwardAgent yes
  ServerAliveInterval 60
  Compression yes
`)
    expect(hosts).toEqual([
      {
        alias: 'commented',
        hostname: 'real.example.com',
        port: 22,
        username: null,
        identityFile: null,
        proxyJump: null,
      },
    ])
  })

  it('returns [] for an empty file', () => {
    expect(parseSshConfig('')).toEqual([])
  })

  it('returns [] for a comment-only / whitespace-only file', () => {
    expect(parseSshConfig('# just a comment\n\n   \n# another\n')).toEqual([])
  })

  it('ignores keyword lines that appear before any Host block', () => {
    const hosts = parseSshConfig('User stray\nPort 999\n\nHost ok\n HostName ok.example.com\n')
    expect(hosts).toEqual([
      {
        alias: 'ok',
        hostname: 'ok.example.com',
        port: 22,
        username: null,
        identityFile: null,
        proxyJump: null,
      },
    ])
  })

  it('handles CRLF line endings', () => {
    const hosts = parseSshConfig('Host crlf\r\n  HostName crlf.example.com\r\n  Port 2022\r\n')
    expect(hosts).toEqual([
      {
        alias: 'crlf',
        hostname: 'crlf.example.com',
        port: 2022,
        username: null,
        identityFile: null,
        proxyJump: null,
      },
    ])
  })

  it('parses quoted aliases on Host lines', () => {
    const hosts = parseSshConfig('Host "my host" other\n  User dave\n')
    expect(hosts.map((h) => h.alias)).toEqual(['my host', 'other'])
  })

  it('flushes the final block at end of file without a trailing newline', () => {
    const hosts = parseSshConfig('Host last\n  HostName last.example.com')
    expect(byAlias(hosts, 'last').hostname).toBe('last.example.com')
  })

  it('merges repeated Host blocks for the same alias: earlier value wins per keyword', () => {
    const hosts = parseSshConfig(`
Host myserver
  HostName first.example.com
  Port 2222
  User alice

Host myserver
  HostName second.example.com
  Port 9999
  User bob
  IdentityFile ~/.ssh/id_rsa
`)
    // Only one entry should be produced for the alias.
    expect(hosts.filter((h) => h.alias === 'myserver')).toHaveLength(1)
    const host = byAlias(hosts, 'myserver')
    // Earlier block wins for keywords already set.
    expect(host.hostname).toBe('first.example.com')
    expect(host.port).toBe(2222)
    expect(host.username).toBe('alice')
    // Later block fills in keywords not set by the earlier block.
    expect(host.identityFile).toBe('~/.ssh/id_rsa')
  })

  it('fills missing keywords from a later block when the earlier block omitted them', () => {
    const hosts = parseSshConfig(`
Host partial
  HostName partial.example.com

Host partial
  Port 3333
  User charlie
`)
    const host = byAlias(hosts, 'partial')
    expect(host.hostname).toBe('partial.example.com')
    expect(host.port).toBe(3333)
    expect(host.username).toBe('charlie')
  })
})
