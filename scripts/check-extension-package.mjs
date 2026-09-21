import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const extensionDirectory = resolve('apps/extension/.output/chrome-mv3');
const manifestPath = resolve(extensionDirectory, 'manifest.json');

try {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) {
    throw new Error('Production manifest must use Manifest V3.');
  }

  const permissions = [...(manifest.permissions ?? [])].sort();
  const expectedPermissions = ['activeTab', 'scripting'];

  if (JSON.stringify(permissions) !== JSON.stringify(expectedPermissions)) {
    throw new Error(
      `Unexpected production permissions: ${permissions.join(', ') || 'none'}`,
    );
  }

  if ((manifest.host_permissions ?? []).length > 0) {
    throw new Error('Production build must not request permanent host access.');
  }

  const requiredFiles = [
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    'content-scripts/reader.js',
  ].filter(Boolean);

  await Promise.all(
    requiredFiles.map((file) => access(resolve(extensionDirectory, file))),
  );

  console.log('Extension package check passed.');
  console.log(`Load-unpacked directory: ${extensionDirectory}`);
} catch (error) {
  console.error('Extension package check failed. Run "pnpm build" first.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
