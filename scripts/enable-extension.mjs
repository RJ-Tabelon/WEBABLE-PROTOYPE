import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const extensionDirectory = resolve('apps/extension/.output/chrome-mv3');
const shouldOpen = process.argv.includes('--open');

try {
  await access(resolve(extensionDirectory, 'manifest.json'));
} catch {
  console.error(
    'The production extension has not been built. Run "pnpm build".',
  );
  process.exit(1);
}

console.log('\nWebAble is ready to load in Chrome.');
console.log(`\nExtension folder:\n${extensionDirectory}\n`);
console.log('1. Open chrome://extensions');
console.log('2. Turn on Developer mode');
console.log('3. Choose Load unpacked');
console.log('4. Select the extension folder above');
console.log("5. Pin WebAble from Chrome's extensions menu\n");

if (shouldOpen) {
  try {
    if (process.platform === 'darwin') {
      execFileSync('open', [extensionDirectory]);
      execFileSync('open', ['-a', 'Google Chrome', 'chrome://extensions']);
    } else if (process.platform === 'win32') {
      execFileSync('explorer.exe', [extensionDirectory]);
      execFileSync('cmd.exe', [
        '/c',
        'start',
        '',
        'chrome',
        'chrome://extensions',
      ]);
    } else {
      execFileSync('xdg-open', [extensionDirectory]);
      execFileSync('google-chrome', ['chrome://extensions']);
    }
  } catch {
    console.warn(
      'Chrome or the extension folder could not be opened automatically. Use the steps above.',
    );
  }
}
