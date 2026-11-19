#!/usr/bin/env node
// Frozen source hashes make an accidental partial port visible without needing
// the sibling checkout. Formatting and the workspace package rename are ignored.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import prettier from 'prettier';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(
  await readFile(new URL('./gatorhack-source.json', import.meta.url), 'utf8'),
);
const failed = [];
for (const [file, expected] of Object.entries(manifest.files)) {
  try {
    const path = resolve(root, file);
    const data = await readFile(path);
    const options = { ...(await prettier.resolveConfig(path)), filepath: path };
    const formatted = /\.(?:tsx?|css|html|json|m?js)$/.test(file)
      ? await prettier.format(
          await prettier.format(data.toString(), options),
          options,
        )
      : data;
    const hash = createHash('sha256').update(formatted).digest('hex');
    const approved = manifest.adaptations?.[file]?.sha256 ?? expected;
    if (hash !== approved) failed.push(file);
  } catch {
    failed.push(file);
  }
}
if (failed.length) {
  console.error(`Gatorhack source differs in ${failed.length} file(s):`);
  for (const file of failed) console.error(`  ${file}`);
  process.exitCode = 1;
} else {
  const changed = Object.keys(manifest.adaptations ?? {}).length;
  console.log(
    `${Object.keys(manifest.files).length - changed} files match Gatorhack ${manifest.revision}; ${changed} documented news/sizing adaptations match their recorded hashes.`,
  );
}
