// node-pty ships a macOS/Linux `spawn-helper` executable in its prebuilds, but
// npm extraction can drop the executable bit, making the PTY fail to spawn with
// "posix_spawnp failed". Re-assert +x after install so local terminals work on
// fresh installs and in CI packaging. No-op on Windows (no spawn-helper).
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const prebuilds = join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds')
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper')
    if (existsSync(helper)) {
      try {
        chmodSync(helper, 0o755)
      } catch {
        // best-effort
      }
    }
  }
}
