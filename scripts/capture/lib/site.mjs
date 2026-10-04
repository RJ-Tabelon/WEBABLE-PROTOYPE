/* global window -- page.evaluate callbacks run in the page. */
import { WEB_MATRIX, metaFor, settle, webContext } from './kit.mjs';

/**
 * Public site, auth pages, the 404 page and the component gallery, signed out.
 */

const PAGES = [
  { surface: 'site-home', path: '/', h1: true },
  { surface: 'site-privacy', path: '/privacy' },
  { surface: 'site-research', path: '/research' },
  { surface: 'site-accessibility', path: '/accessibility' },
  { surface: 'site-help', path: '/help' },
];

const FITS = [
  { id: 'reading', label: 'Larger text' },
  { id: 'pointing', label: 'Bigger clicks' },
  { id: 'focus', label: 'Fewer distractions' },
];

async function open(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await settle(page);
}

async function homeDemos(rec, page, cfg) {
  const hero = page.locator('section.ws-hero');
  const heroFigure = page.locator('figure.ws-demo--hero');
  const group = 'Public site';

  await rec.attempt(
    metaFor('site-home', 'hero-fitted', cfg, { group }),
    async () => {
      await page.getByRole('radio', { name: 'Fitted' }).click();
      await settle(page, 400);
      await rec.shot(
        page,
        metaFor('site-home', 'hero-fitted', cfg, { group }),
        {
          locator: hero,
        },
      );
      await rec.shot(
        page,
        metaFor('site-home', 'hero-demo-fitted', cfg, { group }),
        { locator: heroFigure },
      );
    },
  );
  await rec.attempt(
    metaFor('site-home', 'hero-original', cfg, { group }),
    async () => {
      await page.getByRole('radio', { name: 'Original' }).click();
      await settle(page, 400);
      await rec.shot(
        page,
        metaFor('site-home', 'hero-original', cfg, { group }),
        { locator: hero },
      );
      await rec.shot(
        page,
        metaFor('site-home', 'hero-demo-original', cfg, { group }),
        { locator: heroFigure },
      );
      // Back to the default, so the full-page shot shows the page as it loads.
      await page.getByRole('radio', { name: 'Fitted' }).click();
    },
  );

  const fits = page.locator('section[aria-labelledby="fits-title"]');
  for (const fit of FITS) {
    const meta = metaFor('site-home', `fits-${fit.id}`, cfg, { group });
    await rec.attempt(meta, async () => {
      const radio = page.getByRole('radio', { name: fit.label });
      if (await radio.isVisible().catch(() => false)) await radio.click();
      else
        await page
          .getByRole('combobox', { name: 'Choose a fit' })
          .selectOption(fit.id);
      await settle(page, 400);
      await rec.shot(page, meta, { locator: fits });
    });
  }
  await rec
    .attempt(metaFor('site-home', 'fits-reset', cfg, { group }), async () => {
      const radio = page.getByRole('radio', { name: FITS[0].label });
      if (await radio.isVisible().catch(() => false)) await radio.click();
      else
        await page
          .getByRole('combobox', { name: 'Choose a fit' })
          .selectOption(FITS[0].id);
    })
    .catch(() => undefined);
}

export async function captureSite(ctx) {
  const { browser, rec, base } = ctx;
  for (const cfg of WEB_MATRIX) {
    const context = await webContext(browser, cfg);
    const page = await context.newPage();
    for (const p of PAGES) {
      const group = 'Public site';
      await rec.attempt(
        metaFor(p.surface, 'full', cfg, { group }),
        async () => {
          await open(page, `${base}${p.path}`);
          if (cfg.vp === 'desktop' && cfg.theme === 'light')
            await rec.shot(
              page,
              metaFor(p.surface, 'first-screen', cfg, { group }),
            );
          if (p.path === '/') await homeDemos(rec, page, cfg);
          await page.evaluate(() => window.scrollTo(0, 0));
          await rec.shot(page, metaFor(p.surface, 'full', cfg, { group }), {
            fullPage: true,
          });
        },
      );
    }

    // Mobile navigation, opened.
    if (cfg.vp === 'mobile') {
      const meta = metaFor('site-nav', 'menu-open', cfg, {
        group: 'Public site',
      });
      await rec.attempt(meta, async () => {
        await open(page, `${base}/`);
        const toggle = page
          .getByRole('banner')
          .getByRole('button', { name: /menu/i })
          .first();
        await toggle.click();
        await settle(page, 400);
        await rec.shot(page, meta);
      });
    }

    await rec.attempt(
      metaFor('not-found', 'full', cfg, { group: 'Public site' }),
      async () => {
        await open(page, `${base}/this-page-does-not-exist`);
        await rec.shot(
          page,
          metaFor('not-found', 'full', cfg, { group: 'Public site' }),
          { fullPage: true },
        );
      },
    );
    await context.close();
  }
}

export async function captureAuth(ctx) {
  const { browser, rec, base, stub } = ctx;
  const group = 'Auth';
  const pages = [
    { surface: 'auth-sign-in', state: 'default', path: '/sign-in' },
    { surface: 'auth-sign-up', state: 'default', path: '/sign-up' },
    {
      surface: 'auth-check-email',
      state: 'sign-up',
      path: '/check-email?kind=sign-up',
    },
    {
      surface: 'auth-forgot-password',
      state: 'default',
      path: '/forgot-password',
    },
  ];
  for (const cfg of WEB_MATRIX) {
    const context = await webContext(browser, cfg);
    const page = await context.newPage();
    for (const p of pages) {
      const meta = metaFor(p.surface, p.state, cfg, { group });
      await rec.attempt(meta, async () => {
        await open(page, `${base}${p.path}`);
        await rec.shot(page, meta, { fullPage: true });
      });
    }

    const wrong = metaFor('auth-sign-in', 'error-invalid-password', cfg, {
      group,
      note: 'Wrong password for the local stub account; the stub answers invalid_credentials.',
    });
    await rec.attempt(wrong, async () => {
      await open(page, `${base}/sign-in`);
      await page.getByLabel('Email').fill(stub.user.email);
      await page
        .getByLabel('Password', { exact: true })
        .fill('not-the-password-1');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page
        .getByText(/don.t match/)
        .first()
        .waitFor({ timeout: 15_000 });
      await settle(page, 300);
      await rec.shot(page, wrong, { fullPage: true });
    });

    if (cfg.vp === 'desktop' && cfg.theme === 'light') {
      const empty = metaFor('auth-sign-in', 'error-empty-fields', cfg, {
        group,
      });
      await rec.attempt(empty, async () => {
        await open(page, `${base}/sign-in`);
        await page
          .getByRole('button', { name: 'Sign in', exact: true })
          .click();
        await settle(page, 400);
        await rec.shot(page, empty, { fullPage: true });
      });
      for (const kind of ['sign-in', 'reset']) {
        const meta = metaFor('auth-check-email', kind, cfg, { group });
        await rec.attempt(meta, async () => {
          await open(page, `${base}/check-email?kind=${kind}`);
          await rec.shot(page, meta, { fullPage: true });
        });
      }
      const reset = metaFor('auth-reset-password', 'link-expired', cfg, {
        group,
        note: 'Opened without the session a reset link sets up. The form itself is auth-reset-password__form.',
      });
      await rec.attempt(reset, async () => {
        await open(page, `${base}/reset-password`);
        await rec.shot(page, reset, { fullPage: true });
      });
    }
    await context.close();
  }
}

export async function captureGallery(ctx) {
  const { browser, rec, base } = ctx;
  rec.note(
    'The component gallery (/dev/components) is one page; it is taller than one capture can hold, so it is saved in parts.',
  );
  const cfg = { vp: 'desktop', theme: 'light' };
  const context = await webContext(browser, cfg);
  const page = await context.newPage();
  const meta = metaFor('dev-components', 'full', cfg, {
    group: 'Component gallery',
  });
  await rec.attempt(meta, async () => {
    await page.goto(`${base}/dev/components`, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    await settle(page, 500);
    await rec.shot(page, meta, { fullPage: true });
  });
  await context.close();
}
