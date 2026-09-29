import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests for Tune (/tune), run against a Next.js server.
 *
 *   pnpm --filter @webable/web exec playwright test -c components/tune/e2e/playwright.config.ts
 *
 * An already running server on TUNE_E2E_PORT (default 3103) is reused, so run
 * it against your own dev server (NEXT_DIST_DIR=.next-g PORT=3103 pnpm dev).
 * Otherwise a dev server is started with its own dist dir. Each test gets a
 * fresh browser context, so it is always signed out: nothing is written to
 * the database, and the fit waits in the context's localStorage.
 *
 * Uses the installed Google Chrome (no browser download); set
 * PW_CHANNEL=chromium to use Playwright's bundled Chromium instead.
 */
const port = Number(process.env.TUNE_E2E_PORT ?? 3103);
const channel = process.env.PW_CHANNEL ?? 'chrome';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  webServer: {
    command: `pnpm exec next dev --port ${port}`,
    cwd: '../../..',
    env: { NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-e2e-tune' },
    url: `${baseURL}/tune`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL,
    channel: channel === 'chromium' ? undefined : channel,
    headless: true,
    viewport: { width: 1280, height: 860 },
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  },
});
