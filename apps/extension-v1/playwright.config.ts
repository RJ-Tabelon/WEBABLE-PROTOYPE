import { defineConfig } from '@playwright/test';

/**
 * Projects:
 *   engine          - the in-page engine in real Chromium on fixture pages, without the
 *                     service worker (tests/engine, window.__webableEngine test bundle).
 *   extension-build - builds the e2e flavour (wxt build --mode e2e) once per run.
 *   extension       - the whole extension (service worker, engine, popup, welcome page)
 *                     loaded unpacked into a persistent Chrome profile (tests/e2e).
 *
 * Both use the installed Google Chrome by default (no browser download); set
 * PW_CHANNEL=chromium to use Playwright's bundled Chromium. Both share the fixture
 * server on 127.0.0.1:4173, which is the only host the e2e build may run on.
 * Set WEBABLE_E2E_SKIP_BUILD=1 to reuse an existing e2e build.
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
    {
      // v2 (docs/10): skeleton, Fit view and proxies on fixture pages. Each
      // tests/v2/entries/<name>.ts is bundled by global-setup and served at
      // /__v2/<name>.js; fixtures are served at /v2/<name>.html.
      name: 'v2',
      testDir: './tests/v2',
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
    {
      name: 'extension-build',
      testDir: './tests/e2e',
      testMatch: /build\.setup\.ts$/,
      timeout: 180_000,
    },
    {
      name: 'extension',
      testDir: './tests/e2e',
      testMatch: /.*\.spec\.ts$/,
      dependencies: ['extension-build'],
      timeout: 60_000,
    },
  ],
});
