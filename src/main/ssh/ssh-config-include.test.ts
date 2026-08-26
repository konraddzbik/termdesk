import { describe, expect, it } from 'vitest'
import { type IncludeFsDeps, resolveSshConfigIncludes } from './ssh-config-include'
import { parseSshConfig } from './ssh-config-parser'

const HOME = '/home/u'

/** Builds injectable fs deps backed by an in-memory `{ path: content }` map. */
function makeDeps(files: Record<string, string>, home = HOME): IncludeFsDeps {
  const enoent = (path: string): NodeJS.ErrnoException => {
    const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException
    err.code = 'ENOENT'
    return err
  }
  return {
    readFile: async (path) => {
      if (path in files) return files[path] as string
      throw enoent(path)
    },
    listDir: async (dir) => {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`
      const names = new Set<string>()
      let exists = false
      for (const path of Object.keys(files)) {
        if (!path.startsWith(prefix)) continue
        exists = true
        const rest = path.slice(prefix.length)
        if (!rest.includes('/')) names.add(rest)
      }
      if (!exists) throw enoent(dir)
      return [...names]
    },
    homedir: () => home,
  }
}

const ROOT = `${HOME}/.ssh/config`

describe('resolveSshConfigIncludes', () => {
  it('splices a relative Include (resolved against ~/.ssh) into the stream', async () => {
    const deps = makeDeps({
      [ROOT]: 'Host base\n  HostName base.example.com\nInclude extra\n',
      [`${HOME}/.ssh/extra`]: 'Host extra\n  HostName extra.example.com\n',
    })
    const { content, filesRead } = await resolveSshConfigIncludes(ROOT, deps)
    expect(filesRead).toBe(2)
    const hosts = parseSshConfig(content)
    expect(hosts.map((h) => h.alias).sort()).toEqual(['base', 'extra'])
  })

  it('an Include inside a Host block continues that block (position-preserving)', async () => {
    const deps = makeDeps({
      [ROOT]: 'Host web\n  HostName web.example.com\n  Include webkeys\n',
      [`${HOME}/.ssh/webkeys`]: 'User frominclude\nPort 2022\n',
    })
    const { content } = await resolveSshConfigIncludes(ROOT, deps)
    const hosts = parseSshConfig(content)
    expect(hosts).toHaveLength(1)
    expect(hosts[0]).toMatchObject({ alias: 'web', username: 'frominclude', port: 2022 })
  })

  it('resolves ~/ and absolute Include paths', async () => {
    const deps = makeDeps({
      [ROOT]: 'Include ~/.ssh/conf.d/tilde\nInclude /etc/ssh/abs\n',
      [`${HOME}/.ssh/conf.d/tilde`]: 'Host tilde\n',
      '/etc/ssh/abs': 'Host abs\n',
    })
    const { content, filesRead } = await resolveSshConfigIncludes(ROOT, deps)
    expect(filesRead).toBe(3)
    expect(
      parseSshConfig(content)
        .map((h) => h.alias)
        .sort(),
    ).toEqual(['abs', 'tilde'])
  })

  it('expands a glob in the final segment, sorted, skipping dotfiles', async () => {
    const deps = makeDeps({
      [ROOT]: 'Include conf.d/*.conf\n',
      [`${HOME}/.ssh/conf.d/z.conf`]: 'Host zeta\n',
      [`${HOME}/.ssh/conf.d/a.conf`]: 'Host alpha\n',
      [`${HOME}/.ssh/conf.d/.hidden.conf`]: 'Host hidden\n',
      [`${HOME}/.ssh/conf.d/ignore.txt`]: 'Host ignored\n',
    })
    const { content } = await resolveSshConfigIncludes(ROOT, deps)
    const aliases = parseSshConfig(content).map((h) => h.alias)
    // a.conf sorts before z.conf; .hidden and .txt are excluded.
    expect(aliases).toEqual(['alpha', 'zeta'])
  })

  it('resolves multiple whitespace-separated and quoted paths on one line', async () => {
    const deps = makeDeps({
      [ROOT]: 'Include first "my conf"\n',
      [`${HOME}/.ssh/first`]: 'Host first\n',
      [`${HOME}/.ssh/my conf`]: 'Host quoted\n',
    })
    const { content, filesRead } = await resolveSshConfigIncludes(ROOT, deps)
    expect(filesRead).toBe(3)
    expect(
      parseSshConfig(content)
        .map((h) => h.alias)
        .sort(),
    ).toEqual(['first', 'quoted'])
  })

  it('silently skips a missing include but keeps the rest', async () => {
    const deps = makeDeps({
      [ROOT]: 'Include nope\nHost real\n  HostName real.example.com\n',
    })
    const { content, filesRead } = await resolveSshConfigIncludes(ROOT, deps)
    expect(filesRead).toBe(1)
    expect(parseSshConfig(content).map((h) => h.alias)).toEqual(['real'])
  })

  it('breaks include cycles instead of looping forever', async () => {
    const deps = makeDeps({
      [ROOT]: 'Include config\nHost a\n  HostName a.example.com\n',
    })
    const { content, filesRead } = await resolveSshConfigIncludes(ROOT, deps)
    // The self-include is detected and dropped; the root is still read once.
    expect(filesRead).toBe(1)
    expect(parseSshConfig(content).map((h) => h.alias)).toEqual(['a'])
  })

  it('propagates a read error for the ROOT file (unlike nested includes)', async () => {
    const deps = makeDeps({}) // root absent
    await expect(resolveSshConfigIncludes(ROOT, deps)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stops following includes past the maximum depth', async () => {
    // Build a chain config -> f1 -> f2 -> ... -> f20, each with its own Host.
    const files: Record<string, string> = {
      [ROOT]: 'Include f1\nHost h0\n',
    }
    for (let i = 1; i <= 20; i++) {
      files[`${HOME}/.ssh/f${i}`] = `Include f${i + 1}\nHost h${i}\n`
    }
    const { content, filesRead } = await resolveSshConfigIncludes(ROOT, makeDeps(files))
    // MAX_DEPTH is 16: root (depth 0) + f1..f16 = 17 files; f17+ are skipped.
    expect(filesRead).toBe(17)
    const aliases = parseSshConfig(content).map((h) => h.alias)
    expect(aliases).toContain('h16')
    expect(aliases).not.toContain('h17')
  })

  it('caps the total number of files read (fan-out guard)', async () => {
    const files: Record<string, string> = { [ROOT]: 'Include many/*\n' }
    for (let i = 0; i < 300; i++) {
      // Zero-pad so lexical sort == numeric order.
      files[`${HOME}/.ssh/many/f${String(i).padStart(3, '0')}`] = `Host m${i}\n`
    }
    const { filesRead } = await resolveSshConfigIncludes(ROOT, makeDeps(files))
    // MAX_FILES is 256 (root counts as one of them).
    expect(filesRead).toBe(256)
  })

  it('skips an include that would blow the aggregate size cap', async () => {
    // One include alone larger than MAX_TOTAL_BYTES (5 MiB).
    const huge = `Host big\n${'#'.repeat(5 * 1024 * 1024 + 10)}\n`
    const deps = makeDeps({
      [ROOT]: 'Include huge\nHost small\n  HostName small.example.com\n',
      [`${HOME}/.ssh/huge`]: huge,
    })
    const { content, filesRead } = await resolveSshConfigIncludes(ROOT, deps)
    // Root is read (1); the oversized include trips the cap and is dropped.
    expect(filesRead).toBe(1)
    const aliases = parseSshConfig(content).map((h) => h.alias)
    expect(aliases).toContain('small')
    expect(aliases).not.toContain('big')
  })
})
