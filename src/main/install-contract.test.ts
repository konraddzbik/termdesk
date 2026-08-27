import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertTagMatchesPackage,
  builderVar,
  checkInstallContract,
  checkRepoInstallContract,
  docArtifactPatterns,
  expectedInstallerFilenames,
  findInventedReleaseClaims,
  GITHUB_REPO,
  INSTALL_DOC_PATHS,
  interpolateArtifactName,
  loadInstallContractFiles,
  parseBuilderPackaging,
  parsePackageManifest,
  RELEASED_ARTIFACTS,
  tagMatchesPackageVersion,
} from './install-contract'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const MINIMAL_BUILDER = `
appId: com.termdesk.app
productName: TermDesk
directories:
  output: dist
  buildResources: build
mac:
  target:
    - target: dmg
      arch:
        - arm64
        - x64
dmg:
  artifactName: \${productName}-\${version}-\${arch}.\${ext}
win:
  target:
    - nsis
  artifactName: \${productName}-Setup-\${version}.\${ext}
linux:
  target:
    - AppImage
    - deb
  artifactName: \${productName}-\${version}.\${ext}
`

const MINIMAL_PKG = JSON.stringify({
  name: 'termdesk',
  version: '0.4.0',
  engines: { node: '>=22.12.0', npm: '>=10' },
})

const HONEST_INSTALL = `# Installing TermDesk

**There is no downloadable installer yet.** The public repository
konraddzbik/termdesk currently has **no tags and no GitHub Releases**.

Run it from source, or build an unsigned installer locally.

| Platform | Artifact |
|---|---|
| macOS arm64 | \`TermDesk-<version>-arm64.dmg\` |
| macOS x64 | \`TermDesk-<version>-x64.dmg\` |
| Windows | \`TermDesk-Setup-<version>.exe\` |
| Debian | \`TermDesk-<version>.deb\` |
| AppImage | \`TermDesk-<version>.AppImage\` |
`

const HONEST_README = `# TermDesk

Requires Node.js >=22.12.0. Clone and run from source with \`npm install && npm run dev\`.
`

function honestFiles(overrides: Partial<{ packageJson: string; builderYml: string }> = {}) {
  return {
    packageJson: overrides.packageJson ?? MINIMAL_PKG,
    builderYml: overrides.builderYml ?? MINIMAL_BUILDER,
    docs: [
      { path: 'INSTALL.md', text: HONEST_INSTALL },
      { path: 'README.md', text: HONEST_README },
    ],
  }
}

describe('parsePackageManifest', () => {
  it('reads name, version and engines from real JSON text', () => {
    const manifest = parsePackageManifest(MINIMAL_PKG)
    expect(manifest).toEqual({
      name: 'termdesk',
      version: '0.4.0',
      engines: { node: '>=22.12.0', npm: '>=10' },
    })
  })

  it('rejects JSON that is not an object with a version', () => {
    expect(() => parsePackageManifest('[]')).toThrow(/must be an object/)
    expect(() => parsePackageManifest('{"name":"termdesk"}')).toThrow(/missing version/)
    expect(() => parsePackageManifest('{')).toThrow(/not valid JSON/)
  })
})

describe('parseBuilderPackaging', () => {
  it('extracts artifact templates, mac arches and linux targets from YAML text', () => {
    const builder = parseBuilderPackaging(MINIMAL_BUILDER)
    expect(builder.productName).toBe('TermDesk')
    expect(builder.appId).toBe('com.termdesk.app')
    expect(builder.outputDir).toBe('dist')
    expect(builder.mac.dmgArtifactName).toBe(
      `${builderVar('productName')}-${builderVar('version')}-${builderVar('arch')}.${builderVar('ext')}`,
    )
    expect(builder.mac.arches).toEqual(['arm64', 'x64'])
    expect(builder.win.artifactName).toBe(
      `${builderVar('productName')}-Setup-${builderVar('version')}.${builderVar('ext')}`,
    )
    expect(builder.linux.exts).toEqual(['AppImage', 'deb'])
  })

  it('fails when the mac arch list is missing', () => {
    const yml = MINIMAL_BUILDER.replace(
      `      arch:
        - arm64
        - x64
`,
      '',
    )
    expect(() => parseBuilderPackaging(yml)).toThrow(/no arm64\/x64/)
  })
})

describe('tagMatchesPackageVersion / assertTagMatchesPackage', () => {
  it('requires the v-prefix and an exact version match', () => {
    expect(tagMatchesPackageVersion('v0.4.0', '0.4.0')).toBe(true)
    expect(tagMatchesPackageVersion('0.4.0', '0.4.0')).toBe(false)
    expect(tagMatchesPackageVersion('v0.4.1', '0.4.0')).toBe(false)
    expect(tagMatchesPackageVersion('v0.4.0-beta.1', '0.4.0')).toBe(false)
    expect(tagMatchesPackageVersion('v0.4.0', '')).toBe(false)
  })

  it('throws the release-workflow error when a tag disagrees with package.json', () => {
    expect(() => assertTagMatchesPackage('v0.4.1', MINIMAL_PKG)).toThrow(
      'tag v0.4.1 does not match package.json (v0.4.0)',
    )
    expect(() => assertTagMatchesPackage('v0.4.0', MINIMAL_PKG)).not.toThrow()
  })
})

describe('artifact names', () => {
  it('interpolates electron-builder templates into the filenames dist/ actually uses', () => {
    const builder = parseBuilderPackaging(MINIMAL_BUILDER)
    expect(
      interpolateArtifactName(builder.mac.dmgArtifactName, {
        productName: builder.productName,
        version: '0.4.0',
        arch: 'arm64',
        ext: 'dmg',
      }),
    ).toBe('TermDesk-0.4.0-arm64.dmg')

    expect(expectedInstallerFilenames(builder, '0.4.0')).toEqual([
      'TermDesk-0.4.0-arm64.dmg',
      'TermDesk-0.4.0-x64.dmg',
      'TermDesk-Setup-0.4.0.exe',
      'TermDesk-0.4.0.AppImage',
      'TermDesk-0.4.0.deb',
    ])
    expect(docArtifactPatterns(builder)).toEqual([
      'TermDesk-<version>-arm64.dmg',
      'TermDesk-<version>-x64.dmg',
      'TermDesk-Setup-<version>.exe',
      'TermDesk-<version>.AppImage',
      'TermDesk-<version>.deb',
    ])
  })
})

describe('findInventedReleaseClaims / checkInstallContract', () => {
  it('flags docs that claim a published installer while the inventory is empty', () => {
    const lying = {
      path: 'INSTALL.md',
      text: [
        'Download an installer from the Releases page.',
        'What the current releases actually contain',
        '| Published |',
        'So today: the only published installer is the macOS Apple Silicon .dmg.',
        'The prebuilt installers published on the Releases page are covered by the EULA.',
        'Download the latest version from the Releases page.',
        'the published macOS build for 0.4.0 is arm64 only',
      ].join('\n'),
    }
    const claims = findInventedReleaseClaims([lying])
    expect(claims.map((c) => c.id).sort()).toEqual(
      [
        'current-releases-contain',
        'download-installer-cta',
        'download-latest-from-releases',
        'only-published-installer',
        'prebuilt-published',
        'published-macos-build-for-version',
        'table-status-published',
      ].sort(),
    )

    const report = checkInstallContract(
      {
        packageJson: MINIMAL_PKG,
        builderYml: MINIMAL_BUILDER,
        docs: [lying, { path: 'README.md', text: HONEST_README }],
      },
      [],
    )
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('invents a GitHub Release'))).toBe(true)
  })

  it('accepts honest from-source docs against an empty inventory', () => {
    const report = checkInstallContract(honestFiles(), [])
    expect(report.errors).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.docPatterns.length).toBe(5)
  })

  it('fails when INSTALL.md omits an artifact pattern from electron-builder.yml', () => {
    const report = checkInstallContract(
      honestFiles({
        builderYml: MINIMAL_BUILDER.replace(
          `artifactName: ${builderVar('productName')}-Setup-${builderVar('version')}.${builderVar('ext')}`,
          `artifactName: ${builderVar('productName')}-Installer-${builderVar('version')}.${builderVar('ext')}`,
        ),
      }),
      [],
    )
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('TermDesk-Installer-<version>.exe'))).toBe(true)
  })

  it('requires released artifacts to be named in the docs once the inventory is non-empty', () => {
    const report = checkInstallContract(honestFiles(), ['TermDesk-0.4.0-arm64.dmg'])
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('TermDesk-0.4.0-arm64.dmg'))).toBe(true)
  })
})

describe('loadInstallContractFiles + checkRepoInstallContract (real checkout)', () => {
  it('loads the real repo files and enforces the shipped empty-release inventory', () => {
    expect(RELEASED_ARTIFACTS).toEqual([])
    expect(GITHUB_REPO).toBe('konraddzbik/termdesk')

    const files = loadInstallContractFiles(REPO_ROOT)
    expect(files.docs.map((d) => d.path)).toEqual([...INSTALL_DOC_PATHS])

    const report = checkRepoInstallContract(REPO_ROOT)
    expect(report.errors, report.errors.join('\n')).toEqual([])
    expect(report.ok).toBe(true)

    const fromPkg = parsePackageManifest(files.packageJson)
    const fromYml = parseBuilderPackaging(files.builderYml)
    expect(fromPkg.name).toBe('termdesk')
    expect(fromPkg.version.length).toBeGreaterThan(0)
    expect(tagMatchesPackageVersion(`v${fromPkg.version}`, fromPkg.version)).toBe(true)
    expect(fromYml.productName).toBe(report.builder.productName)
    expect(report.docPatterns).toEqual(docArtifactPatterns(fromYml))

    const installMd = files.docs.find((d) => d.path === 'INSTALL.md')
    expect(installMd).toBeDefined()
    for (const pattern of report.docPatterns) {
      expect(installMd?.text).toContain(pattern)
    }
  })

  it('reads contract files from a repo-shaped directory, not a stub object', () => {
    const root = mkdtempSync(join(tmpdir(), 'install-contract-'))
    mkdirSync(join(root, 'docs'), { recursive: true })
    mkdirSync(join(root, 'src/main'), { recursive: true })
    mkdirSync(join(root, '.github/ISSUE_TEMPLATE'), { recursive: true })
    writeFileSync(join(root, 'package.json'), MINIMAL_PKG)
    writeFileSync(join(root, 'electron-builder.yml'), MINIMAL_BUILDER)
    writeFileSync(join(root, 'INSTALL.md'), HONEST_INSTALL)
    writeFileSync(join(root, 'README.md'), HONEST_README)
    writeFileSync(
      join(root, 'docs/UPDATING.md'),
      'Build from source until a GitHub Release exists.\n',
    )
    writeFileSync(
      join(root, 'src/main/updater.ts'),
      'export const DOWNLOADS_URL = "https://example.invalid"\n',
    )
    writeFileSync(
      join(root, '.github/ISSUE_TEMPLATE/bug_report.yml'),
      'description: built from source\n',
    )

    const loaded = loadInstallContractFiles(root)
    const report = checkInstallContract(loaded, RELEASED_ARTIFACTS)
    expect(report.ok).toBe(true)
  })
})
