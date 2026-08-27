// Runs one or more Electron SMOKE harnesses and passes only when each prints
// its `<NAME>_SMOKE_OK` marker. The harnesses always call app.quit() (exit 0)
// and signal pass/fail via stdout, so we parse the output rather than the code.
//
// Usage:  node scripts/run-smoke.mjs vault mcp ssh sftp vnc
//   - vault / mcp need no external services
//   - ssh / sftp / vnc need the docker test env:
//       docker compose -f docker-compose.test.yml up -d
//
// Requires a build first (npm run build) so `electron .` loads out/.

import { spawn } from 'node:child_process'

const SMOKES = process.argv.slice(2)
if (SMOKES.length === 0) {
  console.error('usage: node scripts/run-smoke.mjs <vault|ssh|sftp|vnc|mcp>...')
  process.exit(2)
}

// Per-suite wall-clock budgets. Most harnesses finish in seconds, so 90s is a
// generous default. The sftp suite is the exception: it moves a 1 GB file up and
// back down and copies a 500-file tree, and its own transfer waits allow up to
// 10 minutes each (src/main/sftp/sftp-smoke.ts). A single 90s cap killed it
// mid-transfer and reported a red smoke that was really a harness-budget bug
// (issue #29). Give sftp room to finish; keep everything else tight.
const DEFAULT_TIMEOUT_MS = 90_000
const TIMEOUTS_MS = {
  sftp: 12 * 60_000,
}

function timeoutFor(name) {
  return TIMEOUTS_MS[name] ?? DEFAULT_TIMEOUT_MS
}

function runOne(name) {
  return new Promise((resolve) => {
    const timeoutMs = timeoutFor(name)
    const okMarker = `${name.toUpperCase()}_SMOKE_OK`
    const failMarker = `${name.toUpperCase()}_SMOKE_FAIL`
    let out = ''
    // GitHub's Linux runners can't use Chromium's setuid sandbox; opt out there.
    const args = process.env.ELECTRON_NO_SANDBOX ? ['electron', '.', '--no-sandbox'] : ['electron', '.']
    // shell: true so this works on Windows, where `npx` is npx.cmd and a bare
    // spawn() cannot execute it (documented command, tri-platform app).
    const child = spawn('npx', args, {
      shell: process.platform === 'win32',
      env: { ...process.env, TERMDESK_SMOKE: name },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    const onData = (buf) => {
      const s = buf.toString()
      out += s
      process.stdout.write(s)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', () => {
      clearTimeout(timer)
      const passed = !timedOut && out.includes(okMarker) && !out.includes(failMarker)
      resolve({ name, passed, timedOut })
    })
  })
}

let failures = 0
for (const name of SMOKES) {
  console.log(`\n=== smoke: ${name} ===`)
  const r = await runOne(name)
  if (r.passed) {
    console.log(`✓ ${name} smoke passed`)
  } else {
    failures += 1
    console.log(`✗ ${name} smoke FAILED${r.timedOut ? ' (timed out)' : ''}`)
  }
}

console.log(`\n${SMOKES.length - failures}/${SMOKES.length} smoke suites passed`)
process.exit(failures === 0 ? 0 : 1)
