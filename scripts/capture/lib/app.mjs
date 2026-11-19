import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WEB_MATRIX, metaFor, settle, webContext } from './kit.mjs';

/**
 * The signed-in app and Connect, against the local Supabase stub (signed in
 * through the real sign-in page with the stub's own throwaway account), with
 * this browser's extension played by the web e2e suite's in-page stand-in.
 */

const APP = 'Signed-in app';
const CONNECT = 'Connect';

/** Extension states for the in-page stand-in (apps/web/e2e/support/fake-extension.ts). */
function extensionStates(fixtures, email) {
  return {
    'not-installed': null,
    'not-connected': fixtures.fakeState(),
    connected: fixtures.fakeState({
      status: { connected: true, email, allSites: true },
    }),
    'connected-not-all-sites': fixtures.fakeState({
      status: { connected: true, email, allSites: false },
    }),
  };
}

async function signIn(browser, base, stub) {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await page.goto(`${base}/sign-in`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(stub.user.email);
  await page.getByLabel('Password', { exact: true }).fill(stub.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/app', { timeout: 30_000 });
  const dir = await mkdtemp(join(tmpdir(), 'webable-capture-'));
  const state = join(dir, 'state.json');
  await context.storageState({ path: state });
  await context.close();
  return state;
}

async function open(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  await settle(page, 400);
}

async function withPage(ctx, cfg, storageState, fake, fn) {
  const context = await webContext(ctx.browser, cfg, { storageState });
  const page = await context.newPage();
  if (fake) await ctx.fixtures.installFakeExtension(page, fake);
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

export async function captureApp(ctx) {
  const { rec, base, stub, fixtures } = ctx;
  await stub.setScenario('full');
  let storageState;
  const ok = await rec.attempt(
    { surface: 'app', state: 'sign-in', viewport: '1440', theme: 'light' },
    async () => {
      storageState = await signIn(ctx.browser, base, stub);
    },
  );
  if (!ok) return;

  const states = extensionStates(fixtures, stub.user.email);
  const pages = [
    { surface: 'app-your-fit', path: '/app' },
    { surface: 'app-changes', path: '/app/changes' },
    { surface: 'app-privacy', path: '/app/privacy' },
    { surface: 'app-settings', path: '/app/settings' },
  ];

  for (const cfg of WEB_MATRIX) {
    // The app pages as a connected person sees them.
    await withPage(ctx, cfg, storageState, states.connected, async (page) => {
      for (const p of pages) {
        const meta = metaFor(p.surface, 'extension-connected', cfg, {
          group: APP,
        });
        await rec.attempt(meta, async () => {
          await open(page, `${base}${p.path}`);
          await rec.shot(page, meta, { fullPage: true });
        });
      }
      if (cfg.vp === 'mobile') {
        const meta = metaFor('app-nav', 'menu-open', cfg, { group: APP });
        await rec.attempt(meta, async () => {
          await open(page, `${base}/app`);
          await page.getByRole('button', { name: 'Menu' }).first().click();
          await settle(page, 400);
          await rec.shot(page, meta);
        });
      }
      if (cfg.vp === 'desktop' && cfg.theme === 'light') {
        await interactions(ctx, page, cfg);
      }
    });

    // Sites and Connect in each extension state.
    for (const [name, fake] of Object.entries(states)) {
      await withPage(ctx, cfg, storageState, fake, async (page) => {
        const sites = metaFor('app-sites', `extension-${name}`, cfg, {
          group: APP,
        });
        await rec.attempt(sites, async () => {
          await open(page, `${base}/app/sites`);
          await page.waitForTimeout(400);
          await settle(page, 200);
          await rec.shot(page, sites, { fullPage: true });
        });
        const connect = metaFor('connect', `extension-${name}`, cfg, {
          group: CONNECT,
        });
        await rec.attempt(connect, async () => {
          await open(page, `${base}/connect`);
          await page.waitForTimeout(400);
          await settle(page, 200);
          await rec.shot(page, connect, { fullPage: true });
        });
      });
    }
  }

  // Connect: pressing Connect, and a browser connected to someone else (1440 light).
  const cfg = { vp: 'desktop', theme: 'light' };
  await withPage(
    ctx,
    cfg,
    storageState,
    states['not-connected'],
    async (page) => {
      const meta = metaFor('connect', 'after-connect-pressed', cfg, {
        group: CONNECT,
        note: 'The stub extension-link function answers; the stand-in extension then reports connected.',
      });
      await rec.attempt(meta, async () => {
        await open(page, `${base}/connect`);
        await page
          .getByRole('button', { name: 'Connect this browser' })
          .click();
        await page
          .getByRole('heading', { level: 1 })
          .filter({ hasNotText: 'Connect this browser' })
          .first()
          .waitFor({ timeout: 15_000 });
        await settle(page, 400);
        await rec.shot(page, meta, { fullPage: true });
      });
    },
  );
  await withPage(
    ctx,
    cfg,
    storageState,
    fixtures.fakeState({
      status: {
        connected: true,
        email: 'someone.else@example.com',
        allSites: true,
      },
    }),
    async (page) => {
      const meta = metaFor(
        'connect',
        'extension-connected-other-account',
        cfg,
        {
          group: CONNECT,
        },
      );
      await rec.attempt(meta, async () => {
        await open(page, `${base}/connect`);
        await page.waitForTimeout(400);
        await rec.shot(page, meta, { fullPage: true });
      });
    },
  );

  // Your fit and the extension status when WebAble is not installed.
  await withPage(ctx, cfg, storageState, null, async (page) => {
    const meta = metaFor('app-your-fit', 'extension-not-installed', cfg, {
      group: APP,
    });
    await rec.attempt(meta, async () => {
      await open(page, `${base}/app`);
      await page.waitForTimeout(400);
      await rec.shot(page, meta, { fullPage: true });
    });
    const privacy = metaFor('app-privacy', 'extension-not-installed', cfg, {
      group: APP,
    });
    await rec.attempt(privacy, async () => {
      await open(page, `${base}/app/privacy`);
      await page.waitForTimeout(400);
      await rec.shot(page, privacy, { fullPage: true });
    });
  });

  // Tune again, signed in with a current fit.
  for (const c of [cfg, { vp: 'mobile', theme: 'light' }]) {
    await withPage(ctx, c, storageState, states.connected, async (page) => {
      const meta = metaFor('tune-intro', 'recalibrate', c, { group: 'Tune' });
      await rec.attempt(meta, async () => {
        await open(page, `${base}/tune?recalibrate=1`);
        await rec.shot(page, meta, { fullPage: true });
      });
    });
  }

  // Choosing a new password (the page a reset link opens, with its session).
  await withPage(ctx, cfg, storageState, null, async (page) => {
    const meta = metaFor('auth-reset-password', 'form', cfg, {
      group: 'Auth',
      note: 'Opened signed in to the local stand-in, as a reset link would leave it.',
    });
    await rec.attempt(meta, async () => {
      await open(page, `${base}/reset-password`);
      await rec.shot(page, meta, { fullPage: true });
    });
  });

  // A new account: no fit yet, nothing changed yet.
  await stub.setScenario('new');
  for (const c of [cfg, { vp: 'mobile', theme: 'light' }]) {
    await withPage(ctx, c, storageState, states.connected, async (page) => {
      for (const p of [
        { surface: 'app-your-fit', path: '/app' },
        { surface: 'app-changes', path: '/app/changes' },
        { surface: 'app-settings', path: '/app/settings' },
      ]) {
        const meta = metaFor(p.surface, 'empty-new-account', c, {
          group: APP,
        });
        await rec.attempt(meta, async () => {
          await open(page, `${base}${p.path}`);
          await rec.shot(page, meta, { fullPage: true });
        });
      }
    });
  }
  await stub.setScenario('full');
}

/** Open states on the app pages (1440 light). */
async function interactions(ctx, page, cfg) {
  const { rec, base } = ctx;
  const at = (surface, state) => metaFor(surface, state, cfg, { group: APP });

  await rec.attempt(at('app-your-fit', 'adjust-open'), async () => {
    await open(page, `${base}/app`);
    const adjust = page.getByRole('button', { name: /^Adjust/ }).first();
    await adjust.click();
    await settle(page, 400);
    await rec.shot(page, at('app-your-fit', 'adjust-open'), {
      fullPage: true,
    });
    await page.keyboard.press('Escape');
  });

  await rec.attempt(at('app-privacy', 'exact-body-open'), async () => {
    await open(page, `${base}/app/privacy`);
    await page
      .getByRole('button', { name: 'Exactly what was sent' })
      .first()
      .click();
    await settle(page, 300);
    await rec.shot(page, at('app-privacy', 'exact-body-open'), {
      fullPage: true,
    });
  });

  await rec.attempt(at('app-privacy', 'delete-account-dialog'), async () => {
    await open(page, `${base}/app/privacy`);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByRole('dialog').waitFor();
    await settle(page, 400);
    await rec.shot(page, at('app-privacy', 'delete-account-dialog'));
    await page.keyboard.press('Escape');
  });

  await rec.attempt(at('app-sites', 'forget-dialog'), async () => {
    await open(page, `${base}/app/sites`);
    await page
      .getByRole('button', { name: /^Forget / })
      .first()
      .click();
    await page.getByRole('dialog').waitFor();
    await settle(page, 400);
    await rec.shot(page, at('app-sites', 'forget-dialog'));
    await page.keyboard.press('Escape');
  });

  await rec.attempt(at('app-sites', 'paused-toast'), async () => {
    await open(page, `${base}/app/sites`);
    await page
      .getByRole('button', { name: /^Pause on / })
      .first()
      .click();
    await page
      .getByRole('status')
      .filter({ hasText: /^Paused on/ })
      .first()
      .waitFor();
    await settle(page, 300);
    await rec.shot(page, at('app-sites', 'paused-toast'));
  });
}
