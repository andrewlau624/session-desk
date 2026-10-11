import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { version } from './package.json'

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    environment: 'node',
    // Git-backed tests create real repos; give them room.
    testTimeout: 30_000
  },
  resolve: {
    // Main-process modules import electron; tests use a small fake instead.
    alias: { electron: resolve(__dirname, 'test/fakes/electron.ts') }
  }
})
