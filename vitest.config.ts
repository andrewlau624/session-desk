import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
