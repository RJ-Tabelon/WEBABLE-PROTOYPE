import { defineConfig } from '@playwright/test';

/**
 * Projects:
 *   engine    - the in-page engine in real Chromium on fixture pages, without the
 *               service worker (tests/engine, window.__webableEngine test bundle).
 *   extension - reserved for the service-worker engineer (tests/e2e): add a project
 *               here that launches a persistent context with the built extension.
 *
 * The engine project uses the installed Google Chrome by default (no browser
 * download); set PW_CHANNEL=chromium to use Playwright's bundled Chromium.
 */
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  timeout: 30_000,
  globalSetup: './tests/engine/global-setup.ts',
  webServer: {
    command: 'node tests/engine/fixture-server.mjs',
    url: 'http://127.0.0.1:4173/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  projects: [
    {
      name: 'engine',
      testDir: './tests/engine',
      testMatch: /.*\.spec\.ts$/,
      use: {
        channel: channel === 'chromium' ? undefined : channel,
        headless: true,
        viewport: { width: 1280, height: 800 },
        baseURL: 'http://127.0.0.1:4173',
        colorScheme: 'light',
        reducedMotion: 'no-preference',
      },
    },
  ],
});
