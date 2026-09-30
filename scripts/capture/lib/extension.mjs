/* global document -- page.evaluate callbacks run in the page. */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { settle } from './kit.mjs';
import { EXTENSION_BUILD } from './paths.mjs';
import { startFixtureServer } from './services.mjs';

/**
 * The extension: the e2e build loaded unpacked into a persistent Chrome
 * profile exactly as apps/extension/tests/e2e/extension.ts does, driven with
 * the same test-only worker messages (e2e:seed, e2e:state) and the popup
 * opened as a page for a tab (popup.html?tab=<id>). The engine fixtures are
 * served on 127.0.0.1:4173 (the e2e build's only host access) and, for "as
 * the site made it" and "needs site access", on 127.0.0.1:4180 (no access).
 */

const ALLOWED = 'http://127.0.0.1:4173';
const BLOCKED_PORT = 4180;
const BLOCKED = `http://127.0.0.1:${BLOCKED_PORT}`;

const POPUP = 'Extension popup';
const WELCOME = 'Extension welcome page';
const ENGINE = 'Engine on fixture pages';

let nonce = 0;

export async function launchExtension(pw, channel) {
  await stat(join(EXTENSION_BUILD, 'manifest.json')).catch(() => {
    throw new Error(`No e2e extension build at ${EXTENSION_BUILD}.`);
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'webable-capture-ext-'));
  const bundled = channel === 'chromium';
  const context = await pw.chromium.launchPersistentContext(dataDir, {
    ...(bundled ? {} : { channel }),
    headless: true,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    locale: 'en-US',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: bundled
      ? [
          `--disable-extensions-except=${EXTENSION_BUILD}`,
          `--load-extension=${EXTENSION_BUILD}`,
        ]
      : ['--enable-unsafe-extension-debugging'],
  });
  if (!bundled) {
    const browser = context.browser();
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: EXTENSION_BUILD });
    await cdp.detach();
  }
  const worker =
    context.serviceWorkers().find((w) => w.url().endsWith('/background.js')) ??
    (await context.waitForEvent('serviceworker', {
      predicate: (w) => w.url().endsWith('/background.js'),
      timeout: 15_000,
    }));
  const id = new URL(worker.url()).host;
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/welcome.html`);

  const send = (msg) =>
    control.evaluate((m) => globalThis.chrome.runtime.sendMessage(m), msg);

  const deadline = Date.now() + 15_000;
  for (;;) {
    const s = await send({ type: 'e2e:state' });
    if ((s?.registered ?? []).some((r) => r.id === 'webable-engine')) break;
    if (Date.now() > deadline)
      throw new Error('The engine was never registered for the fixtures.');
    await new Promise((r) => setTimeout(r, 200));
  }

  const tabState = async (tabId) => {
    const s = await send({ type: 'e2e:state' });
    return s.tabs.find((t) => t.tabId === tabId);
  };

  const tabIdOf = (url) =>
    control.evaluate(async (u) => {
      const tabs = await globalThis.chrome.tabs.query({});
      return tabs.find((t) => t.url === u)?.id ?? -1;
    }, url);

  return {
    context,
    id,
    control,
    send,
    tabState,
    async seed({ profile, account } = {}) {
      const reply = await send({
        type: 'e2e:seed',
        reset: true,
        ...(profile !== undefined ? { profile } : {}),
        ...(account !== undefined ? { account } : {}),
      });
      if (!reply?.ok) throw new Error('e2e:seed was refused');
    },
    /** Open a page and wait for WebAble to finish with it (allowed origin only). */
    async open(url, { settleEngine = true } = {}) {
      const page = await context.newPage();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(url, { waitUntil: 'load' });
      const tabId = await tabIdOf(url);
      if (tabId < 0) throw new Error(`No tab for ${url}`);
      if (settleEngine) {
        const until = Date.now() + 15_000;
        while ((await tabState(tabId))?.phase !== 'ready') {
          if (Date.now() > until)
            throw new Error(`WebAble never finished with ${url}`);
          await page.waitForTimeout(150);
        }
      }
      await page.waitForTimeout(600);
      return { page, tabId };
    },
    fixture(name, origin = ALLOWED) {
      return `${origin}/engine/${name}.html?capture=${++nonce}`;
    },
    async popup(tabId) {
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 800, height: 600 });
      await popup.goto(`chrome-extension://${id}/popup.html?tab=${tabId}`);
      await popup.locator('h1').first().waitFor();
      await popup.waitForTimeout(400);
      return popup;
    },
    async closeTabs() {
      for (const page of context.pages())
        if (page !== control) await page.close().catch(() => undefined);
    },
    async close() {
      await context.close().catch(() => undefined);
      await rm(dataDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    },
  };
}

/**
 * Size the popup page the way Chrome sizes the popup (its root box, up to
 * 800 x 600) and screenshot it, from the top of its scrolling body. When the
 * body scrolls, a second picture (`<state>-scrolled`) shows its end.
 */
async function popupShot(rec, popup, meta) {
  await popup.mouse.move(0, 0);
  await settle(popup, 250);
  for (let i = 0; i < 3; i++) {
    const box = await popup.evaluate(() => {
      const r = document.documentElement.getBoundingClientRect();
      return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
    });
    const size = popup.viewportSize();
    const w = Math.min(800, Math.max(200, box.w));
    const h = Math.min(600, Math.max(100, box.h));
    if (size && size.width === w && size.height === h) break;
    await popup.setViewportSize({ width: w, height: h });
    await settle(popup, 150);
  }
  const width = popup.viewportSize()?.width ?? 380;
  const scroll = (to) =>
    popup.evaluate((where) => {
      const body = document.querySelector('.pp-body');
      if (!body) return false;
      body.scrollTop = where === 'end' ? body.scrollHeight : 0;
      return body.scrollHeight > body.clientHeight + 2;
    }, to);
  const overflows = await scroll('top');
  await settle(popup, 100);
  await rec.shot(popup, { group: POPUP, viewport: String(width), ...meta });
  if (overflows) {
    await scroll('end');
    await settle(popup, 100);
    await rec.shot(popup, {
      group: POPUP,
      viewport: String(width),
      ...meta,
      state: `${meta.state}-scrolled`,
    });
    await scroll('top');
  }
  // Back to room for the next state to lay out in.
  await popup.setViewportSize({ width: 800, height: 600 });
}

/** A popup state in light, and in dark when asked. */
async function popupStates(
  rec,
  popup,
  surfaceState,
  { dark = false, scale, note } = {},
) {
  const state = scale ? `${surfaceState}-scale-${scale}` : surfaceState;
  await popupShot(rec, popup, {
    surface: 'popup',
    state,
    theme: 'light',
    note,
  });
  if (dark) {
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popupShot(rec, popup, {
      surface: 'popup',
      state,
      theme: 'dark',
      note,
    });
    await popup.emulateMedia({ colorScheme: 'light' });
  }
}

async function pageShot(rec, page, surface, state, extra = {}) {
  await settle(page, 300);
  await rec.shot(
    page,
    {
      group: ENGINE,
      surface,
      state,
      viewport: '1440',
      theme: 'light',
      ...extra,
    },
    { keepPointer: extra.keepPointer },
  );
}

async function waitHeading(popup, pattern, timeout = 15_000) {
  await popup
    .getByRole('heading', { level: 1, name: pattern })
    .first()
    .waitFor({ timeout });
}

async function expandChanges(popup) {
  const folded = popup.getByRole('button', { name: /^What changed/ });
  if (
    (await folded.count()) > 0 &&
    (await folded.first().getAttribute('aria-expanded')) === 'false'
  ) {
    await folded.first().click();
    return true;
  }
  return false;
}

/** Wait for WebAble's in-page layer (toast, chip, outlines, guide) to show. */
async function waitLayer(page, timeout = 8_000) {
  await page.waitForFunction(
    () => {
      const host = document.querySelector('webable-ui');
      if (!host) return false;
      const r = host.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    },
    null,
    { timeout },
  );
  await page.waitForTimeout(500);
}

function account(fixtures, patch) {
  return {
    userId: fixtures.fakeSession().user.id,
    email: 'alex@example.com',
    cloudAnalysis: false,
    productLearning: false,
    theme: 'system',
    onboardingStep: 'connected',
    needsReauth: false,
    connectedAt: 0,
    lastSyncAt: 0,
    ...patch,
  };
}

export async function captureExtension(ctx) {
  const { rec, fixtures, pw, channel } = ctx;
  const allowed = await startFixtureServer(4173);
  const blocked = await startFixtureServer(BLOCKED_PORT);
  let ext;
  try {
    ext = await launchExtension(pw, channel);
  } catch (error) {
    rec.miss(
      { surface: 'extension', state: 'launch', viewport: '', theme: '' },
      error instanceof Error ? error.message : String(error),
    );
    allowed.stop();
    blocked.stop();
    return;
  }

  const step = async (surface, state, fn) => {
    const ok = await rec.attempt(
      { surface, state, viewport: '', theme: '' },
      fn,
    );
    await ext.closeTabs();
    return ok;
  };

  const STRONG =
    'Strong reader fit (e2e fixture, 21 px text): WebAble’s own UI at text scale 1.31.';
  const LARGE = 'A 24 px reader fit: WebAble’s own UI at text scale 1.5.';

  try {
    /* ---------- Welcome page ---------- */
    for (const cfg of [
      { w: 1440, h: 900, theme: 'light', tag: '1440' },
      { w: 1440, h: 900, theme: 'dark', tag: '1440' },
      { w: 390, h: 844, theme: 'light', tag: '390' },
    ]) {
      await step('welcome', `default ${cfg.tag}-${cfg.theme}`, async () => {
        const page = await ext.context.newPage();
        await page.setViewportSize({ width: cfg.w, height: cfg.h });
        await page.emulateMedia({ colorScheme: cfg.theme });
        await page.goto(`chrome-extension://${ext.id}/welcome.html`);
        await page.getByRole('heading', { level: 1 }).waitFor();
        await settle(page, 400);
        const meta = {
          group: WELCOME,
          surface: 'welcome',
          state: 'default',
          viewport: cfg.tag,
          theme: cfg.theme,
        };
        await rec.shot(page, meta);
        await rec.shot(page, { ...meta, state: 'full' }, { fullPage: true });
      });
    }

    /* ---------- Fixture pages as the site made them ---------- */
    for (const name of ['article', 'store', 'clip']) {
      await step(`engine-${name}`, 'before', async () => {
        const page = await ext.context.newPage();
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(ext.fixture(name, BLOCKED), { waitUntil: 'load' });
        await pageShot(rec, page, `engine-${name}`, 'before', {
          note: 'Served from an origin WebAble has no access to: the page exactly as the site made it.',
        });
        await rec.shot(
          page,
          {
            group: ENGINE,
            surface: `engine-${name}`,
            state: 'before-full',
            viewport: '1440',
            theme: 'light',
          },
          { fullPage: true },
        );
      });
    }

    /* ---------- First run (no fit), settings, off everywhere ---------- */
    await ext.seed({});
    await step('popup', 'first-run', async () => {
      const { page, tabId } = await ext.open(ext.fixture('article'));
      await pageShot(rec, page, 'engine-article', 'after-basic-fit', {
        note: 'First run: no fit yet, only the basic fit.',
      });
      const popup = await ext.popup(tabId);
      await waitHeading(popup, 'Basic fit is on');
      await popupStates(rec, popup, 'first-run', { dark: true });

      await popup.getByRole('button', { name: 'What was sent' }).click();
      await waitHeading(popup, 'What was sent');
      await popupStates(rec, popup, 'what-was-sent-nothing', { dark: true });
      await popup.getByRole('button', { name: 'Back' }).click();

      await popup.getByRole('button', { name: 'Settings' }).click();
      await waitHeading(popup, 'Settings');
      await popupStates(rec, popup, 'settings', { dark: true });

      await popup
        .getByRole('button', { name: 'Turn WebAble off everywhere' })
        .click();
      await popup.getByText('Turn WebAble off on every site?').waitFor();
      await popupStates(rec, popup, 'settings-confirm-off-everywhere');
      await popup.getByRole('button', { name: 'Turn off' }).click();
      await popup.getByRole('button', { name: 'Turn WebAble on' }).waitFor();
      await popupStates(rec, popup, 'settings-off-everywhere');
      await popup.getByRole('button', { name: 'Back' }).click();
      await waitHeading(popup, 'WebAble is off');
      await popupStates(rec, popup, 'off-everywhere', { dark: true });
      await popup.getByRole('button', { name: 'Turn WebAble on' }).click();
      await waitHeading(popup, 'Basic fit is on');
    });

    /* ---------- Can't run here, needs site access ---------- */
    await step('popup', 'cant-run-here', async () => {
      const page = await ext.context.newPage();
      await page.goto('chrome://version/').catch(() => undefined);
      const tabId = await ext.control.evaluate(async () => {
        const tabs = await globalThis.chrome.tabs.query({});
        return (
          tabs.find((t) => (t.url ?? '').startsWith('chrome://version'))?.id ??
          -1
        );
      });
      if (tabId < 0) throw new Error('No chrome://version tab');
      const popup = await ext.popup(tabId);
      await waitHeading(popup, /can.t change this page/);
      await popupStates(rec, popup, 'cant-run-here', {
        dark: true,
        note: 'Opened for a chrome://version tab.',
      });
    });
    await step('popup', 'needs-site-access', async () => {
      const { tabId } = await ext.open(ext.fixture('article', BLOCKED), {
        settleEngine: false,
      });
      const popup = await ext.popup(tabId);
      await waitHeading(popup, 'Allow WebAble on this site');
      await popupStates(rec, popup, 'needs-site-access', { dark: true });
    });

    /* ---------- Undone by the checks (first run, "Larger text") ---------- */
    await ext.seed({});
    await step('popup', 'undone-by-checks', async () => {
      const { page, tabId } = await ext.open(ext.fixture('clip'));
      const popup = await ext.popup(tabId);
      await waitHeading(popup, 'Basic fit is on');
      await popup.getByRole('switch', { name: 'Larger text' }).click();
      await popup.getByText('Larger text was undone').waitFor();
      await popupStates(rec, popup, 'undone-by-checks', { dark: true });
      await popup.getByRole('button', { name: 'Why?' }).first().click();
      await popup
        .getByText(/WebAble checks every change right after it makes it/)
        .waitFor();
      await popupStates(rec, popup, 'undone-by-checks-why');
      await pageShot(rec, page, 'engine-clip', 'after-larger-text-undone', {
        note: 'An 18 px floor would clip captions in fixed boxes, so the checks put the page back.',
      });
    });

    /* ---------- Focus fit at text scale 1: toast, adapted, adjust, outlines, undo, paused ---------- */
    await ext.seed({ profile: fixtures.focusReaderProfile() });
    await step('popup', 'adapted', async () => {
      const { page, tabId } = await ext.open(ext.fixture('store'));
      await rec
        .attempt(
          {
            surface: 'engine-store',
            state: 'toast',
            viewport: '1440',
            theme: 'light',
          },
          async () => {
            await waitLayer(page);
            await pageShot(rec, page, 'engine-store', 'toast', {
              note: 'Focus fit (e2e focus fixture, 16 px text): moving things calmed and media paused automatically; the first-visit toast.',
            });
          },
        )
        .catch(() => undefined);
      const popup = await ext.popup(tabId);
      await waitHeading(popup, /^Adapted/);
      await popupStates(rec, popup, 'adapted', { dark: true });
      if (await expandChanges(popup))
        await popupStates(rec, popup, 'adapted-changes-open');

      await popup.getByRole('button', { name: 'Adjust for this site' }).click();
      await popup.getByRole('slider', { name: 'Text size' }).waitFor();
      await popupStates(rec, popup, 'adjust-for-this-site', { dark: true });

      await page.bringToFront();
      await pageShot(rec, page, 'engine-store', 'after-focus-fit');
      await ext.send({ type: 'ui:show-on-page', tabId, op: null, on: true });
      await page.waitForTimeout(800);
      await pageShot(rec, page, 'engine-store', 'show-on-page-outlines');
      await ext.send({ type: 'ui:show-on-page', tabId, op: null, on: false });

      await popup.bringToFront();
      await expandChanges(popup);
      await popup
        .getByRole('button', { name: /^Undo / })
        .first()
        .click();
      await popup
        .getByRole('group', { name: /undone$/ })
        .first()
        .waitFor();
      await popupStates(rec, popup, 'undone-by-you-reason', { dark: true });
    });
    await ext.seed({ profile: fixtures.focusReaderProfile() });
    await step('popup', 'paused', async () => {
      const { page, tabId } = await ext.open(ext.fixture('store'));
      const popup = await ext.popup(tabId);
      await waitHeading(popup, /^Adapted/);
      await popup.getByRole('switch', { name: 'WebAble on this site' }).click();
      await waitHeading(popup, 'Paused on this site');
      await popupStates(rec, popup, 'paused', { dark: true });
      await page.bringToFront();
      await pageShot(rec, page, 'engine-store', 'paused');
    });

    /* ---------- Nothing to change, reading guide (16 px reader fit) ---------- */
    await ext.seed({ profile: fixtures.readerProfile() });
    await step('popup', 'nothing-to-change', async () => {
      const { page, tabId } = await ext.open(ext.fixture('article'));
      const popup = await ext.popup(tabId);
      await waitHeading(popup, /already fits you|^Adapted/);
      await popupStates(rec, popup, 'page-already-fits', { dark: true });

      await page.bringToFront();
      await ext.send({ type: 'ui:reading-guide', tabId, on: true });
      const para = page.locator('main.story p:not(.byline)').nth(1);
      const box = await para.boundingBox();
      if (box)
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3, {
          steps: 6,
        });
      await page.waitForTimeout(700);
      await pageShot(rec, page, 'engine-article', 'reading-guide', {
        keepPointer: true,
        note: 'Reading guide turned on for the tab (ui:reading-guide), pointer over the second paragraph.',
      });
      await ext.send({ type: 'ui:reading-guide', tabId, on: false });
    });

    /* ---------- Strong reader fit (e2e): zoom, text size, offer, chip ---------- */
    await ext.seed({ profile: fixtures.strongReaderProfile() });
    await step('popup', 'adapted-strong-reader', async () => {
      const { page, tabId } = await ext.open(ext.fixture('article'));
      await pageShot(rec, page, 'engine-article', 'after', {
        note: 'Strong reader fit (21 px text floor): the page is zoomed to 125%.',
      });
      await rec.shot(
        page,
        {
          group: ENGINE,
          surface: 'engine-article',
          state: 'after-full',
          viewport: '1440',
          theme: 'light',
        },
        { fullPage: true },
      );
      const popup = await ext.popup(tabId);
      await waitHeading(popup, /^Adapted/);
      await popupStates(rec, popup, 'adapted', { scale: '1.31', note: STRONG });
      if (await expandChanges(popup))
        await popupStates(rec, popup, 'adapted-changes-open', {
          scale: '1.31',
          note: STRONG,
        });
      await popup.getByRole('button', { name: 'Adjust for this site' }).click();
      await popup.getByRole('slider', { name: 'Text size' }).waitFor();
      await popup.getByRole('button', { name: 'Increase text size' }).click();
      await page.waitForTimeout(1_500);
      await popupStates(rec, popup, 'adjust-text-size-set', {
        scale: '1.31',
        note: STRONG,
      });
      await page.bringToFront();
      await pageShot(rec, page, 'engine-article', 'after-text-size-21px', {
        note: 'Text size set to 21 px from Adjust for this site (replaces the zoom).',
      });
      await ext.send({ type: 'ui:show-on-page', tabId, op: null, on: true });
      await page.waitForTimeout(800);
      await pageShot(rec, page, 'engine-article', 'show-on-page-outlines');
      await ext.send({ type: 'ui:show-on-page', tabId, op: null, on: false });
    });
    await ext.seed({ profile: fixtures.strongReaderProfile() });
    await step('popup', 'offer-pending', async () => {
      const { page, tabId } = await ext.open(ext.fixture('store'));
      await pageShot(rec, page, 'engine-store', 'after', {
        note: 'Strong reader fit: zoomed; bigger click targets are offered in the popup, not applied.',
      });
      const popup = await ext.popup(tabId);
      await popup
        .getByRole('region', { name: /\?$/ })
        .first()
        .waitFor({ timeout: 10_000 });
      await popupStates(rec, popup, 'offer-pending', {
        dark: true,
        scale: '1.31',
        note: STRONG,
      });
      if (await expandChanges(popup))
        await popupStates(rec, popup, 'offer-pending-changes-open', {
          scale: '1.31',
          note: STRONG,
        });
      await popup.getByRole('button', { name: 'Try it' }).first().click();
      await popup.waitForTimeout(1_500);
      await expandChanges(popup);
      await popupStates(rec, popup, 'offer-accepted', {
        scale: '1.31',
        note: STRONG,
      });
      await page.bringToFront();
      await pageShot(rec, page, 'engine-store', 'after-offer-accepted');
    });
    await ext.seed({ profile: fixtures.strongReaderProfile() });
    await step('engine-store', 'offer-chip', async () => {
      const { page, tabId } = await ext.open(ext.fixture('store'));
      // No chip in a page's first 10 s; then clicks just next to small buttons.
      await page.waitForTimeout(11_000);
      const target = page.locator('button', { hasText: /^G$/ }).first();
      const b = await target.boundingBox();
      if (!b) throw new Error('No small button to click near');
      for (let i = 0; i < 3; i++) {
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(80);
      }
      for (let i = 0; i < 3; i++) {
        await page.mouse.click(b.x + b.width + 3, b.y + b.height + 4);
        await page.waitForTimeout(300);
      }
      await waitLayer(page);
      await page.mouse.move(700, 150);
      await pageShot(rec, page, 'engine-store', 'offer-chip', {
        note: 'A behaviour-triggered offer: clicks just next to small buttons after the 10 s quiet period.',
      });
      const popup = await ext.popup(tabId);
      await popupStates(rec, popup, 'offer-after-friction', {
        scale: '1.31',
        note: STRONG,
      });
    });

    /* ---------- Signed in, page analysis on, What was sent ---------- */
    const stub = await fixtures.startDecideStub();
    try {
      await ext.seed({
        profile: fixtures.focusReaderProfile(),
        account: account(fixtures, { cloudAnalysis: true }),
      });
      await ext.control.evaluate(
        (session) =>
          globalThis.chrome.storage.local.set({
            'wa.auth': JSON.stringify(session),
          }),
        fixtures.fakeSession('alex@example.com'),
      );
      await step('popup', 'signed-in-page-analysis', async () => {
        const { page, tabId } = await ext.open(ext.fixture('article'));
        const until = Date.now() + 10_000;
        while (stub.bodies.length === 0 && Date.now() < until)
          await page.waitForTimeout(200);
        await page.waitForTimeout(1_000);
        await pageShot(rec, page, 'engine-article', 'after-page-analysis', {
          note: 'Focus fit, signed in, page analysis on (local decide stand-in answers every region as an ad).',
        });
        const popup = await ext.popup(tabId);
        await popupStates(rec, popup, 'signed-in', { dark: true });
        await popup.getByRole('button', { name: 'What was sent' }).click();
        await waitHeading(popup, 'What was sent');
        await popupStates(rec, popup, 'what-was-sent', { dark: true });
        const show = popup.getByRole('button', { name: 'Show the exact data' });
        if ((await show.count()) > 0) {
          await show.click();
          await popupStates(rec, popup, 'what-was-sent-exact-data');
        }
      });
    } finally {
      await stub.close();
    }

    /* ---------- Sign in again ---------- */
    await ext.seed({
      profile: fixtures.focusReaderProfile(),
      account: account(fixtures, { needsReauth: true }),
    });
    await step('popup', 'sign-in-again', async () => {
      const { tabId } = await ext.open(ext.fixture('store'));
      const popup = await ext.popup(tabId);
      await waitHeading(popup, 'Sign in again to sync');
      await popupStates(rec, popup, 'sign-in-again', { dark: true });
    });

    /* ---------- Text scale 1.5 (a 24 px fit) ---------- */
    await ext.seed({ profile: fixtures.largeTextProfile() });
    await step('popup', 'scale-1.5', async () => {
      const { page, tabId } = await ext.open(ext.fixture('article'));
      await pageShot(rec, page, 'engine-article', 'after-24px-fit');
      const popup = await ext.popup(tabId);
      await waitHeading(popup, /^Adapted/);
      await popupStates(rec, popup, 'adapted', { scale: '1.5', note: LARGE });
      await popup.getByRole('button', { name: 'Adjust for this site' }).click();
      await popup.getByRole('slider', { name: 'Text size' }).waitFor();
      await popupStates(rec, popup, 'adjust-for-this-site', {
        scale: '1.5',
        note: LARGE,
      });
      await popup.getByRole('button', { name: 'Settings' }).click();
      await waitHeading(popup, 'Settings');
      await popupStates(rec, popup, 'settings', { scale: '1.5', note: LARGE });
      await popup.getByRole('button', { name: 'Back' }).click();
      await popup.getByRole('button', { name: 'What was sent' }).click();
      await waitHeading(popup, 'What was sent');
      await popupStates(rec, popup, 'what-was-sent-nothing', {
        scale: '1.5',
        note: LARGE,
      });
    });
    await ext.seed({ profile: fixtures.largeTextProfile() });
    await step('popup', 'offer-pending-scale-1.5', async () => {
      const { tabId } = await ext.open(ext.fixture('store'));
      const popup = await ext.popup(tabId);
      await popup
        .getByRole('region', { name: /\?$/ })
        .first()
        .waitFor({ timeout: 10_000 });
      await popupStates(rec, popup, 'offer-pending', {
        scale: '1.5',
        note: LARGE,
      });
      await popup.getByRole('switch', { name: 'WebAble on this site' }).click();
      await waitHeading(popup, 'Paused on this site');
      await popupStates(rec, popup, 'paused', { scale: '1.5', note: LARGE });
    });
  } finally {
    await ext.close();
    allowed.stop();
    blocked.stop();
  }

  rec.note(
    'Popup: "Checking this page…" and "Still checking" are transient (they show only while a page takes longer than 300 ms, or several seconds), and "WebAble couldn’t read this page" needs a page the engine fails to read; the harness does not force these three.',
  );
  rec.note(
    'Popup widths follow WebAble’s own text scale, which comes from the fit: 380 px at 1 (no fit, or a 16 px fit), 499 px at 1.31 (the e2e strong reader fit, 21 px), 570 px at 1.5 (a 24 px fit). Heights are the popup’s own, up to Chrome’s 600 px; `-scrolled` shows the end of a popup whose body scrolls.',
  );
}
