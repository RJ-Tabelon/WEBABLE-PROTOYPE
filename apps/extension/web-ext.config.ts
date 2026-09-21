import { resolve } from 'node:path';
import { defineWebExtConfig } from 'wxt';

export default defineWebExtConfig({
  chromiumArgs: [
    `--user-data-dir=${resolve('.wxt/chrome-data')}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  keepProfileChanges: true,
});
