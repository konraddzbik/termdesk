// Generates the SSH keypairs the `ssh` smoke harness needs, plus the
// authorized_keys file the docker test server mounts.
//
//   node scripts/gen-test-keys.mjs [--force]
//
// These are throwaway keys for a local container that also accepts a published
// password. They are NOT committed: a tracked private key in a public repo gets
// reported as a leak no matter how loudly the filename says "test", and a
// tracked authorized_keys pins two specific public keys, which is what made the
// `key` and `key+passphrase` scenarios unrunnable on a fresh clone.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Must match SMOKE_PASSPHRASE in src/main/ssh/ssh-smoke.ts.
const PASSPHRASE = 'testphrase'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const testDir = join(root, '.test')
const force = process.argv.includes('--force')

const KEYS = [
  { file: 'test_key', comment: 'termdesk-test', passphrase: '' },
  { file: 'test_key_enc', comment: 'termdesk-test-enc', passphrase: PASSPHRASE },
]

mkdirSync(testDir, { recursive: true })

for (const { file, comment, passphrase } of KEYS) {
  const path = join(testDir, file)
  if (existsSync(path) && !force) {
    console.log(`keep   .test/${file} (exists; --force to regenerate)`)
    continue
  }
  rmSync(path, { force: true })
  rmSync(`${path}.pub`, { force: true })
  execFileSync(
    'ssh-keygen',
    ['-t', 'ed25519', '-f', path, '-N', passphrase, '-C', comment, '-q'],
    { stdio: 'inherit' },
  )
  console.log(`create .test/${file}`)
}

// Derive authorized_keys from whichever keys are now on disk, so the container
// always trusts exactly this clone's pair.
const authorized = KEYS.map(({ file }) => readFileSync(join(testDir, `${file}.pub`), 'utf8').trim())
writeFileSync(join(testDir, 'authorized_keys'), `${authorized.join('\n')}\n`)
console.log('write  .test/authorized_keys')
