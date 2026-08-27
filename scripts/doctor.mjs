// `npm run doctor` — a fast preflight that turns the two most common "tests
// don't run / app won't start" failures into a plain-English checklist instead
// of an opaque node-gyp or ABI dump. It checks, in order:
//
//   1. Node version against package.json's engines.node floor.
//   2. A C/C++ toolchain, so `node-gyp` can compile the native modules
//      (better-sqlite3, node-pty). Missing toolchains are the #1 first-install
//      failure (issue #17).
//   3. The cached better-sqlite3 *Node*-ABI prebuild that `npm test` needs but
//      `npm run dev` does not — the trap that makes a fresh clone fail vitest
//      with an ABI error that looks like a code bug (issue #13).
//   4. On Linux, whether an OS keyring is likely present (secrets fail closed
//      without one).
//
// It is advisory: it prints findings and a remediation for each, and exits
// non-zero only when something will actually block `npm test`. Never throws.

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

let blocking = 0
let warnings = 0

function ok(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`)
}
function warn(msg, fix) {
  warnings += 1
  console.log(`${YELLOW}!${RESET} ${msg}`)
  if (fix) console.log(`${DIM}    → ${fix}${RESET}`)
}
function fail(msg, fix) {
  blocking += 1
  console.log(`${RED}✗${RESET} ${msg}`)
  if (fix) console.log(`${DIM}    → ${fix}${RESET}`)
}

function which(cmd) {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  try {
    execFileSync(finder, [cmd], { stdio: ['ignore', 'ignore', 'ignore'] })
    return true
  } catch {
    return false
  }
}

// --- 1. Node version -------------------------------------------------------
function checkNode() {
  const pkg = require('../package.json')
  const required = (pkg.engines?.node ?? '').replace(/[^\d.]/g, '') // e.g. ">=22.12.0" -> "22.12.0"
  const [reqMajor, reqMinor = 0] = required.split('.').map(Number)
  const [curMajor, curMinor] = process.versions.node.split('.').map(Number)
  const behind = curMajor < reqMajor || (curMajor === reqMajor && curMinor < reqMinor)
  if (!required) {
    warn(`Node ${process.versions.node} (could not read engines.node floor from package.json)`)
  } else if (behind) {
    fail(
      `Node ${process.versions.node} is below the required ${pkg.engines.node}`,
      'Install the version pinned in .nvmrc: `nvm install && nvm use` (electron/@electron/rebuild need >=22.12).',
    )
  } else {
    ok(`Node ${process.versions.node} satisfies ${pkg.engines.node}`)
  }
}

// --- 2. C/C++ toolchain ----------------------------------------------------
function checkToolchain() {
  if (process.platform === 'darwin') {
    try {
      execFileSync('xcode-select', ['-p'], { stdio: ['ignore', 'ignore', 'ignore'] })
      ok('Xcode Command Line Tools present')
    } catch {
      fail(
        'Xcode Command Line Tools not found — node-gyp cannot compile native modules',
        'Run `xcode-select --install`, then re-run `npm install`.',
      )
    }
    return
  }
  if (process.platform === 'linux') {
    const hasCC = which('cc') || which('gcc')
    const hasMake = which('make')
    const hasPython = which('python3') || which('python')
    if (hasCC && hasMake && hasPython) {
      ok('C/C++ toolchain present (cc, make, python)')
    } else {
      const missing = [!hasCC && 'a C compiler', !hasMake && 'make', !hasPython && 'python3']
        .filter(Boolean)
        .join(', ')
      fail(
        `Missing build tools: ${missing}`,
        'Install: `sudo apt-get install -y build-essential python3` (or your distro equivalent).',
      )
    }
    return
  }
  if (process.platform === 'win32') {
    // A reliable check needs node-gyp's own probe; keep it advisory.
    if (which('cl') || existsSync(join(process.env.ProgramFiles ?? '', 'Microsoft Visual Studio'))) {
      ok('Visual Studio C++ build tools appear to be installed')
    } else {
      warn(
        'Could not confirm Visual Studio C++ build tools',
        'If `npm install` fails with node-gyp errors, install the "Desktop development with C++" workload.',
      )
    }
  }
}

// --- 3. better-sqlite3 Node-ABI prebuild (what `npm test` needs) -----------
function checkSqliteNodePrebuild() {
  let bundledLoadsUnderNode = false
  try {
    // If the bundled binary loads under plain Node, tests run without any cache.
    const Database = require('better-sqlite3')
    new Database(':memory:').close()
    bundledLoadsUnderNode = true
  } catch {
    // Expected after postinstall: bundled binary targets Electron's ABI.
  }
  if (bundledLoadsUnderNode) {
    ok('better-sqlite3 loads under Node — `npm test` will run')
    return
  }

  // Bundled binary is Electron-ABI. `npm test` falls back to the cached Node
  // prebuild (see src/main/store/db.test.ts). Confirm that cache exists.
  let version
  try {
    version = require('better-sqlite3/package.json').version
  } catch {
    fail(
      'better-sqlite3 is not installed',
      'Run `npm ci` (or `npm install`) first.',
    )
    return
  }
  const abi = process.versions.modules
  const suffix = `better-sqlite3-v${version}-node-v${abi}-${process.platform}-${process.arch}.tar.gz`
  const cacheDir = join(homedir(), '.npm', '_prebuilds')
  const cached = existsSync(cacheDir) && readdirSync(cacheDir).some((f) => f.endsWith(suffix))
  if (cached) {
    ok(`better-sqlite3 Node prebuild cached (*${suffix}) — \`npm test\` will run`)
  } else {
    fail(
      `better-sqlite3 targets Electron's ABI and no Node prebuild *${suffix} is cached — \`npm test\` will fail`,
      'Re-run `npm ci` with network access to repopulate ~/.npm/_prebuilds, or follow CONTRIBUTING trap 1 to build a Node-ABI binary from source.',
    )
  }
}

// --- 4. Linux keyring ------------------------------------------------------
function checkKeyring() {
  if (process.platform !== 'linux') return
  const likely =
    process.env.DBUS_SESSION_BUS_ADDRESS &&
    (which('gnome-keyring-daemon') || which('kwalletd6') || which('kwalletd5'))
  if (likely) {
    ok('An OS keyring appears available (secrets can be saved)')
  } else {
    warn(
      'No OS keyring detected — TermDesk fails closed and cannot save host passwords',
      'Install/unlock gnome-libsecret or kwallet before saving a host with a password (see SECURITY.md).',
    )
  }
}

console.log('TermDesk doctor — checking your build environment\n')
checkNode()
checkToolchain()
checkSqliteNodePrebuild()
checkKeyring()

console.log('')
if (blocking > 0) {
  console.log(`${RED}${blocking} blocking issue(s)${RESET}${warnings ? `, ${warnings} warning(s)` : ''}. Fix the ✗ items above, then re-run \`npm run doctor\`.`)
  process.exit(1)
}
if (warnings > 0) {
  console.log(`${YELLOW}${warnings} warning(s)${RESET} — none block \`npm test\`. Review the ! items above.`)
  process.exit(0)
}
console.log(`${GREEN}All checks passed.${RESET} \`npm test\` and \`npm run dev\` should work.`)
