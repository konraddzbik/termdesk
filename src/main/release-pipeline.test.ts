import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Release-pipeline contract for the remaining "Community polish" issues. These
// are CI/workflow guarantees that are easy to remove by accident and expensive
// to discover missing (a wrong-arch binary shipped, an E2E gate silently off).
// Assert them against the real workflow files — same approach as
// install-contract / community-polish.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8')

describe('release-pipeline contract', () => {
  describe('#24 — the fail-closed native-module arch check is locked into both build jobs', () => {
    it('release.yml runs the lipo arch check', () => {
      const release = read('.github/workflows/release.yml')
      expect(release).toMatch(/lipo -archs/)
      expect(release).toMatch(/Verify packaged native modules match their target arch/)
    })

    it('ci.yml runs the same lipo arch check', () => {
      const ci = read('.github/workflows/ci.yml')
      expect(ci).toMatch(/lipo -archs/)
      expect(ci).toMatch(/Verify packaged native modules match their target arch/)
    })

    it('ci.yml builds macOS arm64-only while the x64 cross-build is unproven', () => {
      const ci = read('.github/workflows/ci.yml')
      // The mac target list is replaced with arm64, not merely augmented.
      expect(ci).toMatch(/--mac dmg:arm64 zip:arm64/)
    })
  })

  describe('#20 — E2E smoke can gate a PR, opt-in by label', () => {
    const e2e = read('.github/workflows/e2e.yml')

    it('triggers on pull_request as well as manual dispatch', () => {
      expect(e2e).toMatch(/workflow_dispatch/)
      expect(e2e).toMatch(/pull_request:/)
    })

    it('gates the pull_request run on the `e2e` label', () => {
      // The job `if` must require the label so it does not run on every PR yet.
      expect(e2e).toMatch(/contains\(github\.event\.pull_request\.labels\.\*\.name, 'e2e'\)/)
    })
  })

  describe('#18 — cutting a Release is gated and documented', () => {
    it('release.yml verifies the tag equals v + package.json version', () => {
      const release = read('.github/workflows/release.yml')
      expect(release).toMatch(/Verify tag matches package\.json version/)
    })

    it('a RELEASING.md runbook exists and states the tag=v+version rule and the draft flow', () => {
      expect(existsSync(join(REPO_ROOT, 'RELEASING.md'))).toBe(true)
      const rel = read('RELEASING.md')
      expect(rel).toMatch(/must.*be.*`v`|`v` \+ the exact `package\.json`|equals `v` \+/)
      expect(rel).toMatch(/draft/i)
    })

    it('RELEASING.md names the signing (#19) and self-update (#25) constraints', () => {
      const rel = read('RELEASING.md')
      expect(rel).toMatch(/#19/)
      expect(rel).toMatch(/#25/)
    })
  })
})
