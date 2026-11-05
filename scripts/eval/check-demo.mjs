// Before-state checks for the demo pages, without the extension (research-demo.md §3 "Before-state assertions").
// Usage: node scripts/eval/check-demo.mjs [--headed] [--out <dir>]   (or: pnpm eval --check)
// Serves apps/server/demo itself on a random 127.0.0.1 port, so the WebAble server does not need to run.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT, browserTarget, loadPlaywright, sleep, stamp, startStaticServer } from './lib/common.mjs';

const CONTROLS = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[tabindex]:not([tabindex="-1"])';

/** Runs every check; resolves to { ok, results: [{ page, name, pass, detail }], outDir }. */
export async function runDemoChecks({ headed = false, outDir, log = console.log } = {}) {
  const out = outDir ?? path.join(ROOT, 'eval-output', `check-${stamp()}`);
  mkdirSync(out, { recursive: true });
  const { chromium } = loadPlaywright();
  const srv = await startStaticServer();
  const browser = await chromium.launch({ ...browserTarget(), headless: !headed });
  const results = [];
  const check = (pageName, name, pass, detail = '') => {
    results.push({ page: pageName, name, pass: Boolean(pass), detail: String(detail) });
    log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };

  /** A fresh context per page so storage and timers start clean. */
  async function open(url, viewport = { width: 1280, height: 720 }) {
    const context = await browser.newContext({ viewport, colorScheme: 'light', reducedMotion: 'no-preference', locale: 'en-US' });
    const page = await context.newPage();
    const errors = [];
    const offsite = [];
    page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(srv.origin) && !u.startsWith('data:')) offsite.push(u);
    });
    const t0 = Date.now();
    const resp = await page.goto(url, { waitUntil: 'load' });
    return { context, page, errors, offsite, t0, status: resp?.status() ?? 0 };
  }
  const since = (t0) => Date.now() - t0;
  const waitUntil = async (t0, ms) => { const left = ms - since(t0); if (left > 0) await sleep(left); };

  try {
    /* -------------------------------------------------------------- Alderra refill page */
    log('Alderra Pharmacy · refill (1280 × 720)');
    const A = `${srv.origin}/demo/alderra/refill.html`;
    {
      const { context, page, errors, offsite, t0, status } = await open(`${A}?reset=1`);
      check('alderra', 'Page loads', status === 200, `HTTP ${status}`);
      const confirm = page.getByRole('button', { name: 'Confirm refill' });
      const box = await confirm.boundingBox();
      check('alderra', 'Confirm refill is 104 × 28 px', box && Math.abs(box.width - 104) < 0.6 && Math.abs(box.height - 28) < 0.6, box ? `${box.width} × ${box.height}` : 'missing');
      check('alderra', 'Confirm refill starts below the fold (top > 720)', box && box.y > 720, box ? `top ${Math.round(box.y)}` : 'missing');
      const cont = await page.getByRole('button', { name: 'Continue shopping' }).boundingBox();
      check('alderra', 'Continue shopping is 210 × 48 px', cont && Math.abs(cont.width - 210) < 0.6 && Math.abs(cont.height - 48) < 0.6, cont ? `${cont.width} × ${cont.height}` : 'missing');
      const loud = await page.locator('.cta-coral').first().boundingBox();
      check('alderra', '"Schedule now" is 180 × 52 px', loud && Math.abs(loud.width - 180) < 0.6 && Math.abs(loud.height - 52) < 0.6, loud ? `${loud.width} × ${loud.height}` : 'missing');

      const firstSlide = await page.evaluate(visibleSlide);
      const facts = await page.evaluate((sel) => {
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return false;
          const cs = getComputedStyle(el);
          return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
        };
        const controls = [...document.querySelectorAll(sel)].filter(visible);
        const fine = document.querySelector('.fineprint');
        const fcs = fine ? getComputedStyle(fine) : null;
        const name = (el) => {
          const by = el.getAttribute('aria-labelledby');
          if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
          if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
          if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) return l.textContent.trim(); }
          const wrap = el.closest('label');
          if (wrap) return wrap.textContent.trim();
          return (el.textContent || el.getAttribute('title') || el.getAttribute('alt') || '').trim();
        };
        const unnamed = [...document.querySelectorAll(sel)].filter((el) => !name(el)).map((el) => el.outerHTML.slice(0, 80));
        const help = [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Call your pharmacist');
        return {
          controls: controls.length,
          height: document.documentElement.scrollHeight,
          fineSize: fcs?.fontSize, fineColor: fcs?.color,
          unnamed,
          help: help ? { href: help.getAttribute('href'), visible: visible(help) } : null,
          disclaimer: document.body.textContent.includes('Alderra Pharmacy is a fictional demo site built for Gator Hack V. No real orders.'),
          sixSentences: (fine?.textContent ?? '').includes('Generic substitution may occur unless your prescriber indicates otherwise.'),
          upsellIsDiv: document.querySelector('[role="button"][tabindex="0"]')?.tagName === 'DIV',
        };
      }, CONTROLS);
      check('alderra', 'At least 30 visible controls', facts.controls >= 30, `${facts.controls}`);
      check('alderra', 'Page is about 3,100 px tall', facts.height >= 2800 && facts.height <= 3400, `${facts.height} px`);
      check('alderra', 'Fine print is 11 px #8C8C8C (3.4:1)', facts.fineSize === '11px' && facts.fineColor === 'rgb(140, 140, 140)', `${facts.fineSize} ${facts.fineColor}`);
      check('alderra', 'Fine print has the six sentences', facts.sixSentences);
      check('alderra', 'Upsell is a div with role="button"', facts.upsellIsDiv);
      check('alderra', '"Call your pharmacist" is a visible tel: link', facts.help?.visible && facts.help.href?.startsWith('tel:'), facts.help ? facts.help.href : 'missing');
      check('alderra', 'Footer says it is a fictional demo site', facts.disclaimer);
      check('alderra', 'Every control has an accessible name', facts.unnamed.length === 0, facts.unnamed.slice(0, 3).join(' | '));

      await waitUntil(t0, 1400);
      const cookie = await page.evaluate(() => {
        const el = document.querySelector('[data-cookie]');
        if (!el || el.hidden) return null;
        const r = el.getBoundingClientRect();
        return { share: (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * r.width / (innerWidth * innerHeight), fixed: getComputedStyle(el).position === 'fixed' };
      });
      check('alderra', 'Cookie banner covers at least 20% of the viewport', cookie && cookie.share >= 0.2 && cookie.fixed, cookie ? `${(cookie.share * 100).toFixed(1)}%` : 'not shown');
      const reject = await page.getByRole('button', { name: 'Reject non-essential' }).boundingBox();
      const accept = await page.getByRole('button', { name: 'Accept all' }).boundingBox();
      check('alderra', '"Reject non-essential" is a small link next to a 160 × 44 "Accept all"', reject && accept && reject.height < 20 && Math.round(accept.width) === 160 && Math.round(accept.height) === 44, reject && accept ? `reject ${Math.round(reject.width)} × ${Math.round(reject.height)}` : 'missing');

      await waitUntil(t0, 4500);
      const chatOpen = await page.evaluate(() => {
        const p = document.querySelector('[data-chat-panel]');
        if (!p || p.hidden) return null;
        const r = p.getBoundingClientRect();
        return `${Math.round(r.width)} × ${Math.round(r.height)}`;
      });
      check('alderra', 'Chat panel is open by 4.5 s (360 × 480)', chatOpen === '360 × 480', chatOpen ?? 'closed');

      await waitUntil(t0, 5600);
      const laterSlide = await page.evaluate(visibleSlide);
      check('alderra', 'Carousel changes slide by 5.5 s', firstSlide === 0 && laterSlide === 1, `slide ${firstSlide + 1} → ${laterSlide + 1}`);
      await page.screenshot({ path: path.join(out, 'alderra-before-1280x720.png') });
      await page.screenshot({ path: path.join(out, 'alderra-full.png'), fullPage: true });

      await sleep(900);
      const greeting = await page.locator('[data-chat-log] .chat-msg').first().textContent().catch(() => null);
      check('alderra', 'Chat greets after the typing dots', greeting?.startsWith('Hi! Need help with your refill?'), greeting ?? 'no message');

      check('alderra', 'No requests leave the page origin', offsite.length === 0, offsite.slice(0, 3).join(', '));
      check('alderra', 'No script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await context.close();
    }
    {
      const { context, page } = await open(`${A}?reset=1`, { width: 1440, height: 900 });
      const box = await page.getByRole('button', { name: 'Confirm refill' }).boundingBox();
      check('alderra', 'Confirm refill is below the fold at 1440 × 900 too', box && box.y > 900, box ? `top ${Math.round(box.y)}` : 'missing');
      await context.close();
    }
    {
      // Interactions: keyboard on the div button, confirm, continue shopping and back, consent memory and ?reset=1.
      const { context, page, errors } = await open(`${A}?reset=1`);
      const upsell = page.getByRole('button', { name: 'Add flu shot to order' });
      await upsell.focus();
      await page.keyboard.press('Enter');
      const pressed1 = await page.locator('[data-upsell-btn]').getAttribute('aria-pressed');
      await page.keyboard.press('Space');
      const pressed2 = await page.locator('[data-upsell-btn]').getAttribute('aria-pressed');
      check('alderra', 'Upsell div button works with Enter and Space', pressed1 === 'true' && pressed2 === 'false', `${pressed1} → ${pressed2}`);

      await page.getByRole('button', { name: 'Accept all' }).click({ timeout: 3000 }).catch(() => {});
      await page.getByRole('button', { name: 'Continue shopping' }).click();
      const stub = await page.locator('[data-view="shop"]').isVisible();
      await page.getByRole('button', { name: '← Back to refill' }).click();
      const back = await page.locator('[data-view="refill"]').isVisible();
      check('alderra', 'Continue shopping shows a stub with a way back', stub && back);

      await page.getByRole('button', { name: 'Confirm refill' }).click();
      const done = await page.locator('[data-confirmed]').textContent();
      check('alderra', 'Confirm refill shows "Refill requested ✓ Ready around 4:30 PM"', done?.includes('Refill requested ✓ Ready around 4:30 PM'));

      await page.goto(A, { waitUntil: 'load' });
      await sleep(1200);
      const hiddenAfterAccept = await page.locator('[data-cookie]').isHidden();
      await page.goto(`${A}?reset=1`, { waitUntil: 'load' });
      await sleep(1200);
      const backWithReset = await page.locator('[data-cookie]').isVisible();
      check('alderra', 'Consent is remembered, and ?reset=1 brings the banner back', hiddenAfterAccept && backWithReset);
      check('alderra', 'No script errors while clicking around', errors.length === 0, errors.slice(0, 3).join(' | '));
      await context.close();
    }
    {
      const { context, page } = await open(`${A}?reset=1&modal=1`);
      await sleep(2800);
      const modal = await page.getByRole('dialog', { name: 'Get refill reminders by text' }).isVisible();
      check('alderra', '?modal=1 shows the text-signup modal', modal);
      await context.close();
    }

    /* -------------------------------------------------------------- benefits application */
    log('Lakeshore County · benefits application (1280 × 720)');
    const B = `${srv.origin}/demo/benefits/apply.html`;
    {
      const { context, page, errors, offsite, status } = await open(B);
      check('benefits', 'Page loads', status === 200, `HTTP ${status}`);
      const warning = page.getByRole('alertdialog', { name: 'Your session is about to end' });
      check('benefits', 'Session-timeout warning is open on load', await warning.isVisible());
      const c1 = await page.locator('[data-countdown]').textContent();
      await sleep(2100);
      const c2 = await page.locator('[data-countdown]').textContent();
      check('benefits', 'Countdown is ticking', c1 !== c2, `${c1} → ${c2}`);
      check('benefits', 'Survey popup is visible', await page.getByRole('dialog', { name: 'How is your visit going?' }).isVisible());
      const help = await page.locator('a[href^="tel:"]').first().isVisible();
      check('benefits', 'Help phone link is visible', help);
      const filled = await page.evaluate(() => [...document.querySelectorAll('input[required]')].filter((i) => i.value).length);
      check('benefits', 'Some required fields are already filled', filled >= 2, `${filled}`);
      await page.screenshot({ path: path.join(out, 'benefits-before-1280x720.png') });
      await page.getByRole('button', { name: 'Stay signed in' }).click();
      check('benefits', '"Stay signed in" closes the warning', await warning.isHidden());
      await page.getByRole('button', { name: 'No thanks' }).click();
      check('benefits', '"No thanks" closes the survey', await page.locator('[data-survey]').isHidden());
      await page.getByRole('button', { name: 'Save and continue' }).click();
      check('benefits', 'Submitting with empty fields shows the error summary', await page.locator('[data-errors]').isVisible());
      check('benefits', 'No requests leave the page origin', offsite.length === 0, offsite.slice(0, 3).join(', '));
      check('benefits', 'No script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await context.close();
    }

    /* -------------------------------------------------------------- index */
    log('Demo index');
    {
      const { context, page, errors, status } = await open(`${srv.origin}/demo/`);
      check('index', 'Index loads', status === 200, `HTTP ${status}`);
      const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((u) => u.startsWith(location.origin)));
      const bad = [];
      for (const u of hrefs) {
        const r = await page.request.get(u);
        if (r.status() !== 200) bad.push(`${u} ${r.status()}`);
      }
      check('index', 'Every local link resolves', bad.length === 0 && hrefs.length >= 2, bad.join(', ') || `${hrefs.length} links`);
      check('index', 'No script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await context.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  const failed = results.filter((r) => !r.pass);
  log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${out}`);
  return { ok: failed.length === 0, results, outDir: out };
}

/** Index of the top-most visible hero slide (runs in the page). */
function visibleSlide() {
  const slides = [...document.querySelectorAll('.hero-slide')];
  let top = -1;
  slides.forEach((s, i) => {
    const cs = getComputedStyle(s);
    if (cs.visibility === 'visible' && Number(cs.opacity) > 0.5) top = i;
  });
  return top;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { headed: { type: 'boolean', default: false }, out: { type: 'string' } } });
  runDemoChecks({ headed: values.headed, outDir: values.out ? path.resolve(values.out) : undefined })
    .then((r) => process.exit(r.ok ? 0 : 1))
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
