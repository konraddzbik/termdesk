import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Documentation/config contract for the "Contributor setup" milestone. A fresh
// clone hits a small set of traps that all look like code bugs (better-sqlite3
// ABI, wrong-arch native modules after `npm run dist`, missing toolchain, Linux
// keyring, stale CONTRIBUTING citations, the smoke timeout). Each was fixed by a
// doc, script or config change; these tests fail if a future edit silently
// regresses one — the same "docs must not lie" approach as install-contract.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8')

describe('contributor-setup contract', () => {
  describe('#27 — better-sqlite3 Node rebuild points at the right workflow', () => {
    const contributing = read('CONTRIBUTING.md')

    it('CONTRIBUTING attributes the Node-ABI rebuild step to verify.yml, not ci.yml', () => {
      const trap1 = contributing.slice(
        contributing.indexOf('Trap 1'),
        contributing.indexOf('Trap 2'),
      )
      expect(trap1).toContain('verify.yml')
      // The step must not be attributed to ci.yml (where it does not live).
      expect(trap1).not.toMatch(/Node test runtime[\s\S]{0,80}ci\.yml/)
    })

    it('verify.yml actually contains that named step', () => {
      const verify = read('.github/workflows/verify.yml')
      expect(verify).toContain('Build better-sqlite3 for the Node test runtime')
    })
  })

  describe('#15 — CONTRIBUTING does not cite frozen electron-builder line numbers', () => {
    it('trap 2 references the mac:/dmg: keys, not a line range', () => {
      const contributing = read('CONTRIBUTING.md')
      const trap2 = contributing.slice(contributing.indexOf('Trap 2'))
      expect(trap2).not.toMatch(/electron-builder\.yml:\d+(-\d+)?/)
      expect(trap2).toMatch(/`mac:`|`dmg:`|mac:` \/ `dmg:/)
    })
  })

  describe('#14 — npm run dist restores host-arch native modules automatically', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

    it('a postdist hook runs electron-builder install-app-deps', () => {
      expect(pkg.scripts.postdist ?? '').toContain('install-app-deps')
    })

    it('dist:publish has the same restore hook', () => {
      expect(pkg.scripts['postdist:publish'] ?? '').toContain('install-app-deps')
    })
  })

  describe('#13 / #17 — a doctor script preflights the common install traps', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

    it('package.json exposes `npm run doctor`', () => {
      expect(pkg.scripts.doctor ?? '').toContain('scripts/doctor.mjs')
    })

    it('the doctor script exists and checks the toolchain and better-sqlite3 ABI', () => {
      expect(existsSync(join(REPO_ROOT, 'scripts/doctor.mjs'))).toBe(true)
      const doctor = read('scripts/doctor.mjs')
      expect(doctor).toContain('better-sqlite3')
      expect(doctor).toMatch(/toolchain|node-gyp|xcode-select|build-essential/i)
    })
  })

  describe('#29 — the sftp smoke gets a longer wall-clock budget than 90s', () => {
    const runSmoke = read('scripts/run-smoke.mjs')

    it('run-smoke.mjs has a per-suite timeout map with an sftp entry', () => {
      expect(runSmoke).toMatch(/TIMEOUTS_MS/)
      expect(runSmoke).toMatch(/sftp:\s*\d/)
    })

    it('the sftp budget comfortably exceeds the 90s default', () => {
      // Parse the sftp entry, e.g. `sftp: 12 * 60_000,`
      const m = runSmoke.match(/sftp:\s*([0-9_]+)\s*\*\s*([0-9_]+)/)
      const [, factor, unit] = m ?? []
      expect(factor).toBeDefined()
      expect(unit).toBeDefined()
      const budget =
        Number((factor ?? '0').replace(/_/g, '')) * Number((unit ?? '0').replace(/_/g, ''))
      expect(budget).toBeGreaterThan(90_000)
      // The sftp harness allows up to 10 minutes per transfer leg; the runner
      // budget must cover at least one such leg with margin.
      expect(budget).toBeGreaterThanOrEqual(10 * 60_000)
    })
  })

  describe('#16 — the Linux keyring requirement is on the from-source path', () => {
    it('INSTALL.md names the keyring in the from-source prerequisites', () => {
      const install = read('INSTALL.md')
      const fromSource = install.slice(
        install.indexOf('Run from source'),
        install.indexOf('Build an unsigned installer locally'),
      )
      expect(fromSource).toMatch(/keyring/i)
      expect(fromSource).toMatch(/libsecret|kwallet/i)
    })

    it('README quick start mentions the keyring on Linux', () => {
      const readme = read('README.md')
      const quickStart = readme.slice(readme.indexOf('Quick start'), readme.indexOf('Dev test'))
      expect(quickStart).toMatch(/keyring/i)
    })
  })

  describe('#28 — uninstall docs name the OS user-data vault paths', () => {
    const install = read('INSTALL.md')
    const uninstall = install.slice(install.indexOf('## Uninstall'))

    it('documents per-OS vault directories', () => {
      expect(uninstall).toContain('Application Support/termdesk') // macOS
      expect(uninstall).toMatch(/%APPDATA%\\termdesk/) // Windows
      expect(uninstall).toContain('.config/termdesk') // Linux
    })

    it('states that removing the app leaves hosts/secrets behind', () => {
      expect(uninstall).toMatch(/not your data|leaves that directory|hosts.*secrets|secret vault/i)
    })
  })
})
