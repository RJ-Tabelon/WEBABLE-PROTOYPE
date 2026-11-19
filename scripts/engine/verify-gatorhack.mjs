#!/usr/bin/env node
// Browser integration regression: /tune -> original Chrome onboarding -> real
// task runner -> saved fit -> popup/settings -> adaptation -> Original page.
// The three task URLs are fulfilled with deterministic link fixtures; the
// original content script, tab navigation and click measurements all run.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { engineState } from './eval/lib/pagefacts.mjs';

const require = createRequire(
  new URL('../../apps/extension/package.json', import.meta.url),
);
const { chromium } = require('@playwright/test');
const build = fileURLToPath(
  new URL('../../apps/extension/.output/chrome-mv3', import.meta.url),
);
const origin = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const output =
  process.env.VERIFY_OUTPUT ?? join(tmpdir(), 'webable-gatorhack-verification');
const profile = await mkdtemp(join(tmpdir(), 'webable-gatorhack-chrome-'));
await mkdir(output, { recursive: true });
const errors = [];
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: true,
  viewport: { width: 1440, height: 900 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging'],
});
const log = (message) => console.log(`✓ ${message}`);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await pause(200);
  }
  throw new Error(`Condition did not settle in ${timeout} ms`);
}

try {
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`${origin}/tune`);
  await page.getByRole('link', { name: 'Get WebAble', exact: true }).waitFor();
  assert.equal(await page.getByText('Which hand do you use?').count(), 0);
  log(
    'Without the extension, /tune explains installation instead of running the old Tune flow',
  );

  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: build });
  await cdp.detach();
  const worker =
    context.serviceWorkers().find((w) => w.url().includes(id)) ??
    (await context.waitForEvent('serviceworker'));
  await page.reload();
  await page.locator('iframe[title="Set up WebAble"]').waitFor();
  const frame = await until(() =>
    page.frames().find((f) => f.url().endsWith('/fitting.html')),
  );
  await frame.waitForFunction(
    () => globalThis.__fitting?.phase() === 'welcome',
  );
  await page.getByText('Opening WebAble…').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('webable-ui').count(), 0);
  await page.screenshot({ path: join(output, '01-welcome.png') });
  log(
    '/tune renders the original Gatorhack welcome screen with extension APIs',
  );

  const tasks = [
    [
      'https://en.wikipedia.org/wiki/Gainesville,_Florida',
      '<a href="/wiki/University_of_Florida">University of Florida</a>',
    ],
    [
      'https://www.cnn.com/',
      '<nav><a href="https://www.cnn.com/health">Health</a></nav>',
    ],
    [
      'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/',
      '<a href="#recipe">Jump to Recipe</a><section id="recipe">Chocolate chip cookies</section>',
    ],
  ];
  for (const [url, body] of tasks) {
    await context.route(url, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><title>Finding fixture</title><style>body{font:20px system-ui;margin:60px}a{display:inline-block;padding:20px}</style></head><body><main>${body}</main></body></html>`,
      }),
    );
  }

  await page.mouse.move(700, 500);
  await frame.locator('[data-answer="start"]').click();
  const visited = new Set();
  let findingDone = false;
  let sizeSteps = 0;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const phase = await frame.evaluate(() => globalThis.__fitting.phase());
    if (!visited.has(phase)) {
      visited.add(phase);
      log(`Onboarding ${phase}`);
    }
    if (phase === 'results') break;
    if (phase.startsWith('intro:')) {
      await frame.locator('[data-answer="start-step"]').click();
    } else if (phase === 'task:size') {
      if (sizeSteps++ < 2)
        await frame.locator('[data-answer="larger"]').click();
      else await frame.locator('[data-answer="comfortable"]').click();
    } else if (phase === 'task:truefalse' || phase === 'task:lightdark') {
      if (await frame.locator('[data-answer="light"]').count()) {
        await frame.locator('[data-answer="light"]').click();
      } else {
        const truth = await frame
          .locator('.fl-sentence')
          .getAttribute('data-truth');
        await frame.locator(`.fl-actions [data-answer="${truth}"]`).click();
      }
    } else if (phase === 'task:faint') {
      const word = await frame.locator('.fl-word').getAttribute('data-word');
      await frame
        .locator(`.fl-words button:has([data-word="${word}"])`)
        .click();
    } else if (phase === 'task:dots') {
      await frame.locator('.fl-dot.is-lit').click();
    } else if (phase === 'task:find') {
      if (!findingDone) {
        const taskPage = await until(() =>
          context.pages().find((p) => tasks.some(([u]) => p.url() === u)),
        );
        for (let i = 0; i < tasks.length; i++) {
          await taskPage.waitForURL(tasks[i][0]);
          // Chrome creates the first tab before Playwright can attach request
          // interception. Reload once attached so every task uses its fixture.
          await taskPage.reload({ waitUntil: 'domcontentloaded' });
          assert.equal(await taskPage.title(), 'Finding fixture');
          await taskPage.locator('webable-task').waitFor({ state: 'attached' });
          assert.equal(await taskPage.locator('webable-ui').count(), 0);
          await pause(400);
          await taskPage.screenshot({
            path: join(output, `02-finding-${i + 1}.png`),
          });
          await taskPage
            .getByRole('link', {
              name: ['University of Florida', 'Health', 'Jump to Recipe'][i],
              exact: true,
            })
            .click();
        }
        await until(() => taskPage.isClosed());
        findingDone = true;
        log(
          'All three original task URLs open, measure actual clicks, close and return to /tune',
        );
      }
      if (await frame.locator('[data-answer="first"]').count())
        await frame.locator('[data-answer="first"]').click();
      else if (await frame.locator('[data-answer="done-find"]').count()) {
        await frame.locator('[data-answer="nothing"]').click();
        await frame.locator('[data-answer="done-find"]').click();
      }
    } else if (phase === 'task:context') {
      await frame
        .getByRole('button', { name: 'I don’t use an AI assistant' })
        .click();
    }
    await pause(380); // Original trial clocks ignore accidental repeated presses.
  }
  assert.equal(
    await frame.evaluate(() => globalThis.__fitting.phase()),
    'results',
  );
  for (const step of [
    'size',
    'truefalse',
    'faint',
    'lightdark',
    'dots',
    'find',
    'context',
  ])
    assert(visited.has(`task:${step}`), step);
  const saved = await frame.evaluate(async () =>
    chrome.storage.local.get(['fit', 'webable.evidence']),
  );
  assert.equal(saved.fit.v, 'fit.1');
  assert.equal(saved['webable.evidence'].sites.length, 3);
  assert(
    saved['webable.evidence'].sites.every((s) => s.found),
    'All site measurements must be recorded',
  );
  await page.screenshot({ path: join(output, '03-results.png') });
  log(
    'All original stages reach Results and persist the native fit and site evidence',
  );

  const before = saved.fit.text.override ?? saved.fit.text.bodyPx;
  await frame.getByRole('button', { name: 'Larger text', exact: true }).click();
  await until(async () => {
    const fit = await worker.evaluate(
      async () => (await chrome.storage.local.get('fit')).fit,
    );
    return (fit.text.override ?? fit.text.bodyPx) > before;
  });
  const adjusted = await worker.evaluate(
    async () => (await chrome.storage.local.get('fit')).fit,
  );
  await page.reload();
  const settingsPage = await context.newPage();
  await settingsPage.goto(`chrome-extension://${id}/fitting.html#settings`);
  await settingsPage.waitForFunction(
    () => globalThis.__fitting?.phase() === 'results',
  );
  assert.deepEqual(
    await settingsPage.evaluate(
      async () => (await chrome.storage.local.get('fit')).fit,
    ),
    adjusted,
  );
  await settingsPage.goto(`chrome-extension://${id}/fitting.html#ai`);
  await settingsPage
    .getByRole('heading', { name: 'Let pages explain things the way you like' })
    .waitFor();
  log(
    'Result adjustments persist; the toolbar settings and AI context screens use the same fit',
  );

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup
    .getByRole('button', { name: 'Your settings', exact: true })
    .waitFor();
  await popup
    .getByRole('button', { name: 'How you like things explained', exact: true })
    .waitFor();
  log('Original toolbar popup controls render');

  // Exercise the copied engine and server on its original interactive demo.
  await worker.evaluate(async () => {
    await globalThis.__webable.setFit('rosa');
    await globalThis.__webable.setSettings({
      enabled: true,
      aiLayouts: false,
      pausedOrigins: [],
    });
  });
  const demo = await context.newPage();
  demo.on('pageerror', (err) => errors.push(err.message));
  await demo.goto('http://127.0.0.1:41741/demo/alderra/refill.html?reset=1');
  await demo.locator('webable-ui').waitFor({ state: 'attached' });
  const engine = await until(async () => {
    const state = await engineState(demo);
    return (
      state && ['tailored', 'understood', 'calm'].includes(state.phase) && state
    );
  }, 40_000);
  assert(engine.ops.length > 0, 'The engine must apply adaptations');
  await demo.screenshot({ path: join(output, '04-adapted.png') });
  await demo.keyboard.press('Alt+Shift+KeyC');
  await until(
    async () =>
      (await demo.locator('webable-ui').getAttribute('data-calm-open')) !==
      null,
    40_000,
  );
  await demo.screenshot({ path: join(output, '05-calm.png') });
  await demo.keyboard.press('Alt+Shift+KeyO');
  await until(
    async () =>
      (await demo.locator('webable-ui').getAttribute('data-calm-open')) ===
      null,
  );
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        source: '8f25bfe',
        visited: [...visited],
        fit: saved.fit,
        evidence: saved['webable.evidence'],
        engine,
        errors,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  log(
    'Original engine adapts the demo; Calm view opens and returns to the original page',
  );
  console.log(`Screenshots and measurements: ${output}`);
} catch (error) {
  for (const [i, page] of context.pages().entries()) {
    await page
      .screenshot({ path: join(output, `failure-${i}.png`) })
      .catch(() => {});
  }
  throw error;
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
