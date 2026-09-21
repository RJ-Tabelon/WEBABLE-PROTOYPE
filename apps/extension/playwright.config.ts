import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  webServer: {
    command: 'node tests/e2e/fixture-server.mjs',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
