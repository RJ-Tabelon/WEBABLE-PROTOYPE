import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as setup } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Build the e2e flavour of the extension: host access to the fixture origin
 * only, and test-only messages (`e2e:*`) compiled in. The production build
 * never contains either (scripts/check-extension-package.mjs checks).
 */
setup('build the e2e extension', () => {
  if (process.env.WEBABLE_E2E_SKIP_BUILD === '1') return;
  execFileSync('npx', ['wxt', 'build', '--mode', 'e2e'], {
    cwd: root,
    stdio: 'pipe',
  });
});
