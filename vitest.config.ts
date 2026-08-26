import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Default is plain node; DOM-dependent renderer tests opt into jsdom via
    // a `// @vitest-environment jsdom` docblock (environmentMatchGlobs was
    // removed in Vitest 4).
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        // Entry points and e2e smoke harnesses are exercised by the
        // TERMDESK_SMOKE suites, not unit tests.
        'src/main/index.ts',
        'src/preload/index.ts',
        'src/renderer/main.tsx',
        'src/main/**/*-smoke.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
})
