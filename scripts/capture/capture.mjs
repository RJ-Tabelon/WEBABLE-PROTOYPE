#!/usr/bin/env node
/**
 * WebAble screenshot capture: every surface, in every state the harness can
 * reach, at 1440x900 light and dark and 390x844 light, plus the extension
 * popup, welcome page and engine fixtures. Writes PNGs and INDEX.md.
 *
 *   node scripts/capture/capture.mjs --out <dir>        (or CAPTURE_OUT=<dir>)
 *
 * See scripts/capture/README.md for options.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { loadFixtures } from './lib/bundle.mjs';
import { captureApp } from './lib/app.mjs';
import { captureExtension } from './lib/extension.mjs';
import { writeIndex } from './lib/index-md.mjs';
import { Recorder } from './lib/kit.mjs';
import { EXTENSION_BUILD, WEB, playwright } from './lib/paths.mjs';
import {
  buildExtension,
  buildWeb,
  startWeb,
  stopAll,
} from './lib/services.mjs';
import { captureAuth, captureGallery, captureSite } from './lib/site.mjs';
import { startSupabaseStub } from './lib/supabase-stub.mjs';
import { captureTune } from './lib/tune.mjs';

const GROUPS = ['site', 'auth', 'tune', 'app', 'extension', 'gallery'];

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    only: { type: 'string' },
    'skip-build': { type: 'boolean', default: false },
    'skip-web-build': { type: 'boolean', default: false },
    'skip-extension-build': { type: 'boolean', default: false },
    port: { type: 'string' },
    'stub-port': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Usage: node scripts/capture/capture.mjs --out <dir> [options]

  --out <dir>              Output folder (or CAPTURE_OUT). Required.
  --only <groups>          Comma list of: ${GROUPS.join(', ')}
  --skip-build             Reuse the existing web and extension builds
  --skip-web-build         Reuse apps/web/.next-capture
  --skip-extension-build   Reuse apps/extension/.output/chrome-mv3-e2e
  --port <n>               Web port (CAPTURE_WEB_PORT, default 3200)
  --stub-port <n>          Local Supabase stub port (default 54390)
  PW_CHANNEL=chromium      Playwright's Chromium instead of installed Chrome`);
  process.exit(0);
}

const outArg = values.out ?? process.env.CAPTURE_OUT;
if (!outArg) {
  console.error('Give an output folder: --out <dir> or CAPTURE_OUT=<dir>.');
  process.exit(2);
}
const OUT = resolve(outArg);
const only = new Set(
  (values.only ?? GROUPS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
for (const g of only)
  if (!GROUPS.includes(g)) {
    console.error(`Unknown group "${g}". Groups: ${GROUPS.join(', ')}`);
    process.exit(2);
  }

const PORT = Number(values.port ?? process.env.CAPTURE_WEB_PORT ?? 3200);
const STUB_PORT = Number(values['stub-port'] ?? 54390);
const DIST = '.next-capture';
const channel = process.env.PW_CHANNEL ?? 'chrome';

const needsWeb = ['site', 'auth', 'tune', 'app', 'gallery'].some((g) =>
  only.has(g),
);

async function main() {
  const started = new Date();
  const rec = new Recorder(OUT);
  await rec.init();
  console.log(`Capturing into ${OUT}`);

  const fixtures = await loadFixtures();
  const stub = await startSupabaseStub({ port: STUB_PORT, fixtures });
  const webEnv = {
    // The capture build talks to the local stub, never the hosted project.
    NEXT_PUBLIC_SUPABASE_URL: stub.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'capture-stub-publishable-key',
  };

  let web = null;
  const pw = playwright();
  const browser = await pw.chromium.launch({
    ...(channel === 'chromium' ? {} : { channel }),
    headless: true,
  });
  const base = `http://localhost:${PORT}`;
  const ctx = { browser, rec, base, stub, fixtures, pw, channel };

  try {
    if (needsWeb) {
      const reuse =
        (values['skip-build'] || values['skip-web-build']) &&
        existsSync(resolve(WEB, DIST, 'BUILD_ID'));
      if (!reuse) {
        console.log('Building the web app (next build, .next-capture)...');
        await buildWeb({ distDir: DIST, env: webEnv });
      }
      console.log(`Starting the web app on ${base}...`);
      web = await startWeb({ distDir: DIST, env: webEnv, port: PORT });
    }

    if (only.has('site')) {
      console.log('Public site...');
      await captureSite(ctx);
    }
    if (only.has('auth')) {
      console.log('Auth pages...');
      await captureAuth(ctx);
    }
    if (only.has('tune')) {
      console.log('Tune...');
      await captureTune(ctx);
    }
    if (only.has('app')) {
      console.log('Signed-in app and Connect...');
      await captureApp(ctx);
    }
    if (only.has('gallery')) {
      console.log('Component gallery...');
      await captureGallery(ctx);
    }
    if (only.has('extension')) {
      const reuse =
        (values['skip-build'] || values['skip-extension-build']) &&
        existsSync(resolve(EXTENSION_BUILD, 'manifest.json'));
      if (!reuse) {
        console.log('Building the extension (wxt build --mode e2e)...');
        await buildExtension();
      }
      console.log('Extension...');
      await captureExtension(ctx);
    }
  } finally {
    await browser.close().catch(() => undefined);
    web?.stop();
    await stub.close().catch(() => undefined);
    stopAll();
  }

  await writeIndex(rec, { started, finished: new Date(), groups: [...only] });
  console.log(
    `Done: ${rec.entries.length} images, ${rec.misses.length} misses. ${resolve(OUT, 'INDEX.md')}`,
  );
}

for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopAll();
    process.exit(130);
  });

main().catch((error) => {
  console.error(error);
  stopAll();
  process.exit(1);
});
