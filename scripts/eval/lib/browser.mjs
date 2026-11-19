/* global document, window, MutationObserver, getComputedStyle -- page.evaluate callbacks run in the page. */
import { writeFile } from 'node:fs/promises';

import { playwright } from './paths.mjs';

/**
 * Browser plumbing for the evaluation: installed Google Chrome (headless)
 * through Playwright, one CDP session per page, the in-page bundles in a CDP
 * isolated world (no bypassCSP: the page's own CSP and Trusted Types stay on),
 * page scale through device-metrics emulation, consent banners declined.
 */

export const VIEWPORT = { width: 1440, height: 900 };
export const WORLD = 'webable-eval';

export async function launch() {
  const { chromium } = playwright();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    locale: 'en-US',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
  return { browser, context };
}

/**
 * A page with the document_start scripts registered: the input firewall in
 * the eval's isolated world, the key bridge and watchers in the MAIN world.
 */
export async function openPage(context, bundles) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: bundles.start,
    worldName: WORLD,
  });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: bundles.mainWorld,
  });
  return { page, cdp };
}

/**
 * Load the eval API into the page's isolated world (the same world the
 * firewall was installed in at document_start) and return an evaluator.
 */
export async function attachWorld(cdp, entry) {
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: WORLD,
  });
  const ev = async (expression, { timeout = 60_000 } = {}) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      contextId: executionContextId,
      awaitPromise: true,
      returnByValue: true,
      timeout,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(
        `in-page: ${d.exception?.description?.split('\n').slice(0, 4).join(' ') ?? d.text}`,
      );
    }
    return r.result.value;
  };
  const has = await ev('typeof window.__wae');
  if (has !== 'object') await ev(`${entry};0`);
  const call = (fn, ...args) =>
    ev(
      `window.__wae.${fn}(${args.map((a) => JSON.stringify(a ?? null)).join(',')})`,
    );
  return { ev, call, contextId: executionContextId };
}

/** Wait until the DOM has been quiet for `quietMs` (at most `capMs`). */
export async function quiet(page, quietMs = 2500, capMs = 10_000) {
  return page
    .evaluate(
      ([q, cap]) =>
        new Promise((resolve) => {
          const t0 = performance.now();
          let last = performance.now();
          let n = 0;
          const mo = new MutationObserver((recs) => {
            n += recs.length;
            last = performance.now();
          });
          mo.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          const tick = () => {
            const t = performance.now();
            if (t - last >= q || t - t0 >= cap) {
              mo.disconnect();
              resolve({
                ms: Math.round(t - t0),
                mutations: n,
                capped: t - t0 >= cap,
              });
            } else setTimeout(tick, 100);
          };
          setTimeout(tick, 100);
        }),
      [quietMs, capMs],
    )
    .catch(() => ({ ms: 0, mutations: -1, capped: true }));
}

/** Fonts ready, a quiet DOM, a scroll down and back for lazy content, quiet again. */
export async function settle(page) {
  await page
    .evaluate(() => document.fonts?.ready.then(() => true))
    .catch(() => undefined);
  const first = await quiet(page, 2500, 10_000);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 900).catch(() => undefined);
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  const second = await quiet(page, 1500, 6_000);
  return { first, second };
}

const REJECT =
  /^(reject( all)?( cookies)?|decline( all)?( cookies)?|reject (additional|optional|non-essential|all optional) cookies|decline (optional|additional|non-essential) cookies|only (allow )?(essential|necessary|required)( cookies)?|(use|accept) (only )?(essential|necessary|strictly necessary) cookies( only)?|necessary (cookies )?only|refuse( all)?|continue without accepting|no,? thanks|reject and close)$/i;

/**
 * Decline cookie consent where a banner offers it. Only reject/decline or
 * "necessary only" choices are ever clicked; never accept.
 */
export async function declineConsent(page) {
  for (const frame of page.frames()) {
    let buttons = [];
    try {
      buttons = await frame.$$(
        'button, [role="button"], a[role="button"], input[type="button"], input[type="submit"]',
      );
    } catch {
      continue;
    }
    for (const b of buttons) {
      const t = (
        (await b.innerText().catch(() => '')) ||
        (await b.getAttribute('value').catch(() => '')) ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (!t || t.length > 60 || !REJECT.test(t)) continue;
      if (!(await b.isVisible().catch(() => false))) continue;
      await b.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      return `declined: "${t}"`;
    }
  }
  return 'none';
}

const INTERSTITIAL =
  /^(stay on amazon\.com|stay on this site|no,? thanks|not now|maybe later|dismiss|close)$/i;

/**
 * Close site interstitials that sit over the page in a pinned layer (a
 * country-redirect prompt, a newsletter or app nag): only the choice that
 * keeps the page as it is, never a sign-in or an accept.
 */
export async function dismissInterstitials(page) {
  const out = [];
  for (let round = 0; round < 2; round++) {
    const clicked = await page
      .evaluate((src) => {
        const rx = new RegExp(src, 'i');
        const pinned = (el) => {
          for (let n = el; n; n = n.parentElement) {
            const p = getComputedStyle(n).position;
            if (p === 'fixed') return true;
          }
          return false;
        };
        const cands = Array.from(
          document.querySelectorAll(
            'button, [role="button"], a[role="button"], input[type="submit"], input[type="button"], span.a-button-inner input',
          ),
        );
        // Known keep-this-page controls without text (Amazon's country prompt).
        const known = document.querySelector(
          '#redir-stay-at-www, .redir-dismiss-x a',
        );
        if (known && known.getBoundingClientRect().width > 0 && pinned(known)) {
          known.click();
          return known.id || 'redir-dismiss';
        }
        for (const b of cands) {
          const t = (
            b.getAttribute('aria-label') ||
            b.innerText ||
            b.value ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          if (!t || t.length > 40 || !rx.test(t)) continue;
          const r = b.getBoundingClientRect();
          if (r.width < 4 || r.height < 4 || !pinned(b)) continue;
          b.click();
          return t;
        }
        return null;
      }, INTERSTITIAL.source)
      .catch(() => null);
    if (!clicked) break;
    out.push(clicked);
    await page.waitForTimeout(800);
  }
  return out.length ? `closed: ${out.map((t) => `"${t}"`).join(', ')}` : 'none';
}

const BLOCK_TEXT =
  /captcha|robot check|automated access|unusual traffic|access denied|pardon our interruption|are you a human|blocked by network security|verify you are human|request blocked|you have been blocked/i;

/** A bot wall or block page rather than the site. */
export async function blocked(page) {
  try {
    const info = await page.evaluate(() => ({
      text: (document.body?.innerText ?? '').slice(0, 4000),
      links: document.querySelectorAll('a[href]').length,
      title: document.title,
    }));
    if (/captcha|sorry\/index|errors\/validate/i.test(page.url()))
      return `url ${page.url()}`;
    if (info.links < 40 && BLOCK_TEXT.test(`${info.title} ${info.text}`))
      return `page says "${(BLOCK_TEXT.exec(`${info.title} ${info.text}`) ?? [''])[0]}"`;
    return null;
  } catch (e) {
    return `unreadable: ${String(e.message).slice(0, 80)}`;
  }
}

/** Page scale as browser zoom does it: a smaller CSS viewport at a higher DPR. */
export async function setScale(cdp, z) {
  if (!(z > 1.001)) return restoreScale(cdp);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: Math.round(VIEWPORT.width / z),
    height: Math.round(VIEWPORT.height / z),
    deviceScaleFactor: z,
    mobile: false,
  });
}

export async function restoreScale(cdp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

/** The visible viewport at device pixels (1440x900 whatever the scale). */
export async function shot(cdp, file) {
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 72,
  });
  await writeFile(file, Buffer.from(data, 'base64'));
}

/** Main-world watchers installed by main-world.ts. */
export async function watchers(page, reset = false) {
  return page
    .evaluate((r) => {
      const w = window;
      const out = {
        leaks: [...(w.__waLeaks ?? [])],
        proxied: [...(w.__waProxied ?? [])],
        installed: Array.isArray(w.__waLeaks),
      };
      if (r && Array.isArray(w.__waLeaks)) {
        w.__waLeaks.length = 0;
        w.__waProxied.length = 0;
      }
      return out;
    }, reset)
    .catch(() => ({ leaks: [], proxied: [], installed: false }));
}
