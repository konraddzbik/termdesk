import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Documentation/config contract for the "Community polish" milestone. These
// guard the specific doc drift the issues called out: enterprise docs that
// promised targets the repo does not build, a legal/contact path that led
// nowhere, and README badges that froze volatile numbers. Same "docs must not
// lie" approach as install-contract / contributor-setup.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8')

describe('community-polish contract', () => {
  describe('#31 — DEPLOYMENT.md only promises what the repo builds', () => {
    const deployment = read('docs/DEPLOYMENT.md')

    it('names NSIS and states there is no MSI target', () => {
      expect(deployment).toMatch(/NSIS/)
      expect(deployment).toMatch(/no MSI/i)
    })

    it('does not offer an internal/private update server as a supported feature', () => {
      // The updater owner/repo are compile-time constants; there is no configurable feed.
      expect(deployment).toMatch(/no support for pointing/i)
      expect(deployment).toMatch(/internal[^.]*update server/i)
    })

    it('is honest that current builds are unsigned', () => {
      expect(deployment).toMatch(/unsigned/i)
    })
  })

  describe('#30 — setup questions have a public place to land', () => {
    it('a Question / setup help issue form exists', () => {
      const path = '.github/ISSUE_TEMPLATE/question.yml'
      expect(existsSync(join(REPO_ROOT, path))).toBe(true)
      expect(read(path)).toMatch(/name:\s*Question/i)
    })

    it('the issue-template config offers a private contact route', () => {
      const config = read('.github/ISSUE_TEMPLATE/config.yml')
      expect(config).toMatch(/konraddzbik/)
      expect(config).toMatch(/privately|maintainer/i)
    })

    it('EULA no longer points contact at a non-existent discussion', () => {
      const eula = read('EULA.txt')
      expect(eula).not.toMatch(/open a discussion/i)
      expect(eula).toMatch(/issue|konraddzbik/)
    })
  })

  describe('#21 — README badges do not freeze volatile numbers', () => {
    const readme = read('README.md')
    // The badge block sits at the top; inspect the header region.
    const header = readme.slice(0, readme.indexOf('## '))

    it('no badge hard-codes a passing-test count', () => {
      expect(header).not.toMatch(/tests-\d+/)
    })

    it('no badge hard-codes a coverage percentage', () => {
      expect(header).not.toMatch(/coverage-\d/)
    })

    it('uses a live CI status badge that reads GitHub instead', () => {
      expect(header).toMatch(/actions\/workflow\/status\/konraddzbik\/termdesk/)
    })
  })

  describe('#23 — SECURITY.md does not imply a security.txt that is not served', () => {
    const security = read('SECURITY.md')

    it('states there is no project website / security.txt today', () => {
      expect(security).toMatch(/no project website/i)
    })

    it('still names GitHub private vulnerability reporting as the channel', () => {
      expect(security).toMatch(/security\/advisories\/new/)
    })
  })
})
