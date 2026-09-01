/**
 * Install / packaging contract.
 *
 * Pure checks the outsider-facing install path must satisfy: package.json version
 * vs a git tag, electron-builder artifact names, and user-facing docs that must
 * not invent a GitHub Release that does not exist.
 *
 * GitHub I/O stays out of this module. Callers pass the released-artifact
 * inventory (empty until the first published Release). The loader only reads
 * files from a repo root.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** GitHub owner/repo this project's install docs and updater talk about. */
export const GITHUB_REPO = 'konraddzbik/termdesk'

/**
 * Installers actually attached to a published (non-draft) GitHub Release.
 * Empty on purpose: `konraddzbik/termdesk` has no tags and no Releases.
 * Update this when the first `v*` tag is published and the draft is released.
 */
export const RELEASED_ARTIFACTS: readonly string[] = []

/** Release workflow the packaging contract cross-checks against the builder config. */
export const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml'

/** User-facing files the honesty check reads. */
export const INSTALL_DOC_PATHS = [
  'INSTALL.md',
  'README.md',
  'docs/UPDATING.md',
  'src/main/updater.ts',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
] as const

export type BuilderPackaging = {
  appId: string
  productName: string
  outputDir: string
  mac: { dmgArtifactName: string; arches: string[] }
  win: { artifactName: string; ext: string }
  linux: { artifactName: string; exts: string[] }
}

export type PackageManifest = {
  name: string
  version: string
  engines: { node?: string; npm?: string }
}

export type InstallContractFiles = {
  packageJson: string
  builderYml: string
  docs: { path: string; text: string }[]
}

export type InventedReleaseClaim = {
  path: string
  id: string
  excerpt: string
}

export type InstallContractReport = {
  ok: boolean
  errors: string[]
  manifest: PackageManifest
  builder: BuilderPackaging
  docPatterns: string[]
  inventedClaims: InventedReleaseClaim[]
}

/**
 * Phrases that assert a downloadable GitHub Release already exists.
 * Allowed only when `RELEASED_ARTIFACTS` is non-empty.
 */
export const INVENTED_RELEASE_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: 'only-published-installer', re: /the only published installer is/i },
  { id: 'download-installer-cta', re: /Download an installer from the /i },
  { id: 'prebuilt-published', re: /prebuilt installers published on the Releases page/i },
  { id: 'current-releases-contain', re: /What the current releases actually contain/i },
  { id: 'table-status-published', re: /\|\s*Published\s*\|/ },
  {
    id: 'download-latest-from-releases',
    re: /Download the latest version from the Releases page/i,
  },
  {
    id: 'published-macos-build-for-version',
    re: /the published macOS build for 0\.4\.0 is arm64 only/i,
  },
]

export function parsePackageManifest(json: string): PackageManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch (err) {
    throw new Error(`package.json is not valid JSON: ${String(err)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json must be an object')
  }
  const rec = parsed as Record<string, unknown>
  if (typeof rec.name !== 'string' || rec.name.length === 0) {
    throw new Error('package.json is missing name')
  }
  if (typeof rec.version !== 'string' || rec.version.length === 0) {
    throw new Error('package.json is missing version')
  }
  const enginesRaw = rec.engines
  const engines: PackageManifest['engines'] = {}
  if (enginesRaw && typeof enginesRaw === 'object') {
    const e = enginesRaw as Record<string, unknown>
    if (typeof e.node === 'string') engines.node = e.node
    if (typeof e.npm === 'string') engines.npm = e.npm
  }
  return { name: rec.name, version: rec.version, engines }
}

export function parseBuilderPackaging(yml: string): BuilderPackaging {
  const appId = topLevelScalar(yml, 'appId')
  const productName = topLevelScalar(yml, 'productName')
  const directories = topLevelSection(yml, 'directories')
  const outputDir = nestedScalar(directories, 'output')
  const dmg = topLevelSection(yml, 'dmg')
  const win = topLevelSection(yml, 'win')
  const linux = topLevelSection(yml, 'linux')
  const mac = topLevelSection(yml, 'mac')

  const dmgArtifactName = nestedScalar(dmg, 'artifactName')
  const winArtifactName = nestedScalar(win, 'artifactName')
  const linuxArtifactName = nestedScalar(linux, 'artifactName')

  const archLines = mac.match(/^\s+-\s+(arm64|x64)\s*$/gm) ?? []
  const arches = [...new Set(archLines.map((l) => l.trim().slice(2).trim()))]
  if (arches.length === 0) {
    throw new Error('electron-builder.yml mac: section has no arm64/x64 arch entries')
  }

  const linuxExts = listLinuxExts(linux)
  if (linuxExts.length === 0) {
    throw new Error('electron-builder.yml linux: section has no AppImage/deb targets')
  }

  return {
    appId,
    productName,
    outputDir,
    mac: { dmgArtifactName, arches },
    win: { artifactName: winArtifactName, ext: 'exe' },
    linux: { artifactName: linuxArtifactName, exts: linuxExts },
  }
}

/** Tag `v1.2.3` must equal `v` + package.json version. No other spelling is accepted. */
export function tagMatchesPackageVersion(tag: string, version: string): boolean {
  return version.length > 0 && tag === `v${version}`
}

export function assertTagMatchesPackage(tag: string, packageJsonText: string): void {
  const { version } = parsePackageManifest(packageJsonText)
  if (!tagMatchesPackageVersion(tag, version)) {
    throw new Error(`tag ${tag} does not match package.json (v${version})`)
  }
}

/** electron-builder `${name}` placeholder in `artifactName` templates. */
export function builderVar(name: string): string {
  return ['$', '{', name, '}'].join('')
}

export function interpolateArtifactName(
  template: string,
  vars: { productName: string; version: string; arch?: string; ext: string },
): string {
  return template
    .replaceAll(builderVar('productName'), vars.productName)
    .replaceAll(builderVar('version'), vars.version)
    .replaceAll(builderVar('arch'), vars.arch ?? '')
    .replaceAll(builderVar('ext'), vars.ext)
}

/** Filenames `npm run dist` / the CI package job produce, using the real version. */
export function expectedInstallerFilenames(builder: BuilderPackaging, version: string): string[] {
  const names: string[] = []
  for (const arch of builder.mac.arches) {
    names.push(
      interpolateArtifactName(builder.mac.dmgArtifactName, {
        productName: builder.productName,
        version,
        arch,
        ext: 'dmg',
      }),
    )
  }
  names.push(
    interpolateArtifactName(builder.win.artifactName, {
      productName: builder.productName,
      version,
      ext: builder.win.ext,
    }),
  )
  for (const ext of builder.linux.exts) {
    names.push(
      interpolateArtifactName(builder.linux.artifactName, {
        productName: builder.productName,
        version,
        ext,
      }),
    )
  }
  return names
}

/**
 * The same names as they appear in INSTALL.md (`<version>` keeps the doc from
 * going stale on every bump).
 */
export function docArtifactPatterns(builder: BuilderPackaging): string[] {
  return expectedInstallerFilenames(builder, '<version>')
}

export function findInventedReleaseClaims(
  docs: { path: string; text: string }[],
): InventedReleaseClaim[] {
  const found: InventedReleaseClaim[] = []
  for (const doc of docs) {
    for (const { id, re } of INVENTED_RELEASE_PATTERNS) {
      const match = re.exec(doc.text)
      if (match?.[0]) {
        found.push({ path: doc.path, id, excerpt: match[0] })
      }
    }
  }
  return found
}

export function loadInstallContractFiles(repoRoot: string): InstallContractFiles {
  return {
    packageJson: readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    builderYml: readFileSync(join(repoRoot, 'electron-builder.yml'), 'utf8'),
    docs: INSTALL_DOC_PATHS.map((path) => ({
      path,
      text: readFileSync(join(repoRoot, path), 'utf8'),
    })),
  }
}

/**
 * Drive the whole contract against file contents. `releasedArtifacts` is the
 * inventory of published installers — pass `RELEASED_ARTIFACTS` for the shipped
 * truth, or a synthetic list in tests.
 */
export function checkInstallContract(
  files: InstallContractFiles,
  releasedArtifacts: readonly string[] = RELEASED_ARTIFACTS,
): InstallContractReport {
  const errors: string[] = []
  const manifest = parsePackageManifest(files.packageJson)
  const builder = parseBuilderPackaging(files.builderYml)
  const docPatterns = docArtifactPatterns(builder)
  const inventedClaims = findInventedReleaseClaims(files.docs)

  const installMd = files.docs.find((d) => d.path === 'INSTALL.md')
  if (!installMd) {
    errors.push('INSTALL.md is missing from the contract file set')
  } else {
    for (const pattern of docPatterns) {
      if (!installMd.text.includes(pattern)) {
        errors.push(`INSTALL.md does not document artifact pattern ${pattern}`)
      }
    }
    if (releasedArtifacts.length === 0) {
      if (!/\bno tags\b/i.test(installMd.text) || !/\bno GitHub Releases\b/i.test(installMd.text)) {
        errors.push(
          `INSTALL.md must state that ${GITHUB_REPO} currently has no tags and no GitHub Releases`,
        )
      }
      if (!/from source/i.test(installMd.text)) {
        errors.push('INSTALL.md must describe running TermDesk from source')
      }
    }
  }

  const readme = files.docs.find((d) => d.path === 'README.md')
  if (readme && !readme.text.includes('>=22.12')) {
    errors.push('README.md must mention the Node.js >=22.12 engine floor from package.json')
  }

  if (releasedArtifacts.length === 0) {
    for (const claim of inventedClaims) {
      errors.push(`${claim.path} invents a GitHub Release (${claim.id}: "${claim.excerpt}")`)
    }
  } else {
    for (const artifact of releasedArtifacts) {
      const mentioned = files.docs.some((d) => d.text.includes(artifact))
      if (!mentioned) {
        errors.push(`released artifact ${artifact} is not mentioned in install docs`)
      }
    }
  }

  if (!manifest.engines.node?.includes('22.12')) {
    errors.push('package.json engines.node must keep the Electron floor (>=22.12.0)')
  }

  return {
    ok: errors.length === 0,
    errors,
    manifest,
    builder,
    docPatterns,
    inventedClaims,
  }
}

export function checkRepoInstallContract(repoRoot: string): InstallContractReport {
  return checkInstallContract(loadInstallContractFiles(repoRoot), RELEASED_ARTIFACTS)
}

/**
 * The installer file extensions electron-builder.yml actually produces, in a
 * stable order: macOS `dmg`, Windows `exe`, then each Linux target
 * (`AppImage`, `deb`). Case is preserved — `AppImage`, not `appimage` — because
 * that is exactly how the file lands in `dist/` and how release.yml globs it.
 */
export function installerExtensions(builder: BuilderPackaging): string[] {
  return [...new Set(['dmg', builder.win.ext, ...builder.linux.exts])]
}

export type ReleaseWorkflowUploads = {
  /** Distinct installer extensions the workflow attaches via `dist/*.<ext>` globs. */
  uploadExts: string[]
  /** Whether a SHA256SUMS checksum file is attached to the Release. */
  attachesChecksums: boolean
  /** Whether Release uploads are gated on a `refs/tags/` ref. */
  tagGuardedRelease: boolean
}

/**
 * Read what release.yml uploads without a YAML parser: the workflow references
 * every installer as a `dist/*.<ext>` glob, so the set of those exts is the set
 * of installers that reach the Release. Also detects the checksum attachment and
 * the tag guard. Text-level on purpose — it tracks the file the maintainer edits.
 */
export function parseReleaseWorkflowUploads(yml: string): ReleaseWorkflowUploads {
  const uploadExts = [
    ...new Set([...yml.matchAll(/dist\/\*\.([A-Za-z0-9]+)/g)].map((m) => m[1] as string)),
  ]
  return {
    uploadExts,
    attachesChecksums: /SHA256SUMS/.test(yml),
    tagGuardedRelease: /startsWith\(github\.ref,\s*'refs\/tags\//.test(yml),
  }
}

/**
 * Every installer electron-builder produces must actually be attached to the
 * Release, a checksum file must accompany them, and the whole publish path must
 * be tag-gated. Catches the silent drift where a new packaging target is added
 * to electron-builder.yml but never wired into the Release upload globs — so it
 * builds in CI yet never reaches a single user.
 */
export function checkReleaseWorkflowContract(
  builder: BuilderPackaging,
  uploads: ReleaseWorkflowUploads,
): string[] {
  const errors: string[] = []
  for (const ext of installerExtensions(builder)) {
    if (!uploads.uploadExts.includes(ext)) {
      errors.push(
        `release.yml never uploads dist/*.${ext}, but electron-builder.yml produces a .${ext} installer`,
      )
    }
  }
  if (!uploads.attachesChecksums) {
    errors.push('release.yml does not attach a SHA256SUMS checksum file to the Release')
  }
  if (!uploads.tagGuardedRelease) {
    errors.push('release.yml must gate Release uploads on a refs/tags/ ref')
  }
  return errors
}

export type ReleaseWorkflowReport = {
  ok: boolean
  errors: string[]
  uploads: ReleaseWorkflowUploads
  builder: BuilderPackaging
}

export function checkRepoReleaseWorkflow(repoRoot: string): ReleaseWorkflowReport {
  const builder = parseBuilderPackaging(
    readFileSync(join(repoRoot, 'electron-builder.yml'), 'utf8'),
  )
  const uploads = parseReleaseWorkflowUploads(
    readFileSync(join(repoRoot, RELEASE_WORKFLOW_PATH), 'utf8'),
  )
  const errors = checkReleaseWorkflowContract(builder, uploads)
  return { ok: errors.length === 0, errors, uploads, builder }
}

function topLevelScalar(yml: string, key: string): string {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm')
  const match = re.exec(yml)
  const value = match?.[1]
  if (!value) throw new Error(`electron-builder.yml is missing ${key}`)
  return stripYamlValue(value)
}

function topLevelSection(yml: string, key: string): string {
  const lines = yml.split(/\r?\n/)
  const start = lines.findIndex((line) => line === `${key}:` || line.startsWith(`${key}:`))
  if (start < 0) throw new Error(`electron-builder.yml is missing ${key}:`)
  const body: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) break
    if (
      line.length > 0 &&
      !line.startsWith(' ') &&
      !line.startsWith('\t') &&
      !line.startsWith('#')
    ) {
      break
    }
    body.push(line)
  }
  return body.join('\n')
}

function nestedScalar(section: string, key: string): string {
  const re = new RegExp(`^\\s+${key}:\\s*(.+)$`, 'm')
  const match = re.exec(section)
  const value = match?.[1]
  if (!value) throw new Error(`electron-builder.yml is missing ${key}`)
  return stripYamlValue(value)
}

function stripYamlValue(raw: string): string {
  let value = raw.trim()
  const comment = value.search(/\s+#/)
  if (comment >= 0) value = value.slice(0, comment).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  if (value.length === 0) throw new Error('electron-builder.yml has an empty scalar')
  return value
}

function listLinuxExts(linuxSection: string): string[] {
  const exts: string[] = []
  if (/(?:^|\n)\s+-\s+AppImage\s*(?:\n|$)/.test(linuxSection)) exts.push('AppImage')
  if (/(?:^|\n)\s+-\s+deb\s*(?:\n|$)/.test(linuxSection)) exts.push('deb')
  return exts
}
