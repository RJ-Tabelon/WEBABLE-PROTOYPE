import { defineConfig, devices } from '@playwright/test';

import { STORAGE_STATE } from './e2e/support/env';

/**
 * End-to-end tests for the web app (apps/web/e2e).
 *
 *   pnpm --filter @webable/web test:e2e
 *
 * Base URL: E2E_BASE_URL, else http://localhost:$PORT (default 3000). When
 * E2E_BASE_URL is unset, Playwright starts `next dev` on that port, or reuses a
 * server that is already running there. Use a separate NEXT_DIST_DIR when other
 * dev servers share the working tree.
 *
 * Signed-in specs use a local test user: E2E_EMAIL / E2E_PASSWORD, else
 * e2e/.env.e2e-user, else supabase/tests/.env.test-user (create one with
 * `node scripts/create-test-user.mjs`). The `setup` project signs in through the
 * real sign-in page once and shares the session with the `app` project.
 *
 * Specs are named `*.e2e.ts` so Vitest (`pnpm test`, default include
 * `*.{test,spec}.ts`) never collects them.
 *
 * Browser: the installed Google Chrome by default (no download); set
 * PW_CHANNEL=chromium to use Playwright's bundled Chromium.
 */
const port = process.env.PORT ?? '3000';
const baseURL = (
  process.env.E2E_BASE_URL ?? `http://localhost:${port}`
).replace(/\/$/, '');
const channel = process.env.PW_CHANNEL ?? 'chrome';
const browser = channel === 'chromium' ? {} : { channel };

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/e2e',
  // Signed-in specs share one account, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    ...browser,
    headless: true,
    locale: 'en-US',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next dev --port ${port}`,
        url: `${baseURL}/sign-in`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts$/,
      use: { ...devices['Desktop Chrome'], ...browser },
    },
    {
      name: 'public',
      testMatch: /sign-in\.e2e\.ts$/,
      use: { ...devices['Desktop Chrome'], ...browser },
    },
    {
      name: 'app',
      testMatch: /\.e2e\.ts$/,
      testIgnore: /sign-in\.e2e\.ts$/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        ...browser,
        storageState: STORAGE_STATE,
      },
    },
  ],
});
