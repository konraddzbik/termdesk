import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * The CSP meta tag in index.html is the strict production policy. Vite dev mode
 * needs inline scripts (react fast-refresh preamble) and HMR websockets, so we
 * relax only those two directives while serving.
 */
function relaxCspForDev(): Plugin {
  const replacements: ReadonlyArray<[string, string]> = [
    ["script-src 'self'", "script-src 'self' 'unsafe-inline'"],
    [
      "connect-src 'self' ws://127.0.0.1:*",
      "connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://localhost:*",
    ],
  ]
  return {
    name: 'relax-csp-for-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      let out = html
      for (const [from, to] of replacements) {
        if (!out.includes(from)) {
          throw new Error(
            `relax-csp-for-dev: "${from}" not found in index.html CSP — update the plugin`,
          )
        }
        out = out.replace(from, to)
      }
      return out
    },
  }
}

export default defineConfig({
  main: {
    // Only this project's release pipeline sets TERMDESK_OFFICIAL_BUILD=1, so
    // only the installers it publishes carry the EULA prompt. See
    // src/main/build-flags.d.ts.
    define: {
      __TERMDESK_OFFICIAL_BUILD__: JSON.stringify(process.env.TERMDESK_OFFICIAL_BUILD === '1'),
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    // Patched via patch-package — pre-bundling caches an unpatched copy in .vite/deps.
    optimizeDeps: {
      exclude: ['@novnc/novnc'],
    },
    plugins: [react(), tailwindcss(), relaxCspForDev()],
  },
})
