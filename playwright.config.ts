import { defineConfig, devices } from '@playwright/test'

// The suite runs against the production build served by `vite preview`, never the dev server.
// `npm run test:e2e` builds first so the build under test can never be stale.
const port = Number(process.env.E2E_PORT ?? 4173)

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    // Never attach to a server that is already running: it could serve an old build.
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
