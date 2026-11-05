#!/usr/bin/env node
// WebAble eval harness. Loads the built extension (apps/extension/.output/chrome-mv3) into Playwright's
// Chrome for Testing, or into branded Google Chrome (--browser chrome, loaded over CDP), sets a demo fit, and for
// each site captures: before (WebAble paused), after (fitted, top of page), after scrolled to the main task,
// Jev Lens, Calm view. Measures each view in the page (zoom, body and heading sizes, the column, overflow,
// overlapping text, WebAble UI collisions) and saves PNGs, the TabReport, metrics.json per site and an index.html
// contact sheet.
//
//   pnpm eval                          demo pages, rosa fit
//   pnpm eval --browser chrome --dpr 2 --size 1440x900 --only alderra-refill,cnn-home
//                                      real Chrome at Retina scale (what Caden sees)
//   pnpm eval --sites all --fit reader demo pages + real sites
//   pnpm eval --only alderra-refill --headed
//   pnpm eval --fitting                the warm-up, every block and the result, with layout checks
//   pnpm eval --interact               panel, Lens, Explain, offer, Calm steps, Confirm, Original on Alderra
//   pnpm eval --sites all --interact --fitting   everything into one contact sheet
//   pnpm eval --check                  page checks only, no extension
//   pnpm eval --browser chrome --dpr 2 --size 1440x900 --sites real --sites-file scripts/claims/sites-50.json \
//     --skip lens,calm --no-ai --ext <frozen build>   the 50-site fit rate (docs/CLAIMS.md)
//
// It starts the WebAble server for the run if it is not already running, and stops it afterwards.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runDemoChecks } from './check-demo.mjs';
import {
  DESKTOP_UA, EXT_DIR, ROOT, SERVER_ORIGIN, baseDpr, browserTarget, chromePath, dprArgs, loadCore, loadPlaywright, parseViewport, setBaseDpr, shoot,
  sleep, slug, stamp,
} from './lib/common.mjs';
import { mainLabelFrom, measureView } from './lib/firstscreen.mjs';
import { engineState } from './lib/pagefacts.mjs';
import { runFitting } from './lib/fitting.mjs';
import { runInteract } from './lib/interact.mjs';
import { ensureServer, health } from './lib/server.mjs';
import { readingLine, renderSheet, siteMetrics } from './lib/sheet.mjs';
import { uiClick, uiProbe } from './lib/ui.mjs';

const HELP = `WebAble eval harness

  pnpm eval [options]

  --sites demo|real|all|none  which sites from scripts/eval/sites.json (default: demo, or none when
                          --fitting / --interact is given without --sites or --only)
  --sites-file <file>     more sites in the same JSON shape ({ demo: [...], real: [...] }), merged into
                          sites.json: an entry with the same name replaces it, new ones are added in order
  --only <names>          comma-separated site names, e.g. alderra-refill,drugs-metformin
  --fitting               also run the 70-second warm-up like a person and screenshot every block and the result
  --larger <n>            how many times to press Bigger on the warm-up's result screen (default: 0)
  --adjust                also press Narrower (Alt+Shift+[), open the panel and press Larger, with a shot each
  --interact              also drive one demo page: panel, Lens, Explain, offer, Calm steps, Confirm, Original
  --interact-site <name>  the page for --interact (default: alderra-refill)
  --struggle <seconds>    how long --interact tries near-misses before giving up on an offer (default: 75)
  --fit rosa|typical|reader   demo fit to set (default: rosa)
  --viewport WxH          window size in CSS px (default: 1280x720)
  --size WxH              same as --viewport (e.g. 1440x900)
  --dpr <n>               device scale factor (default: 1; 2 = a Retina display, screenshots twice the size)
  --browser chromium|chrome   Playwright's Chrome for Testing (default), or branded Google Chrome loaded with
                          CDP Extensions.loadUnpacked (--enable-unsafe-extension-debugging, throwaway profile)
  --chrome-path <file>    the Google Chrome binary for --browser chrome (default: the system install, or CHROME_PATH)
  --headed                show the browser
  --quick                 do not wait for the AI layout in Calm view
  --skip <views>          comma-separated views to leave out: task, lens, calm (a Calm view that opens by
                          itself is still closed before the "after" shot, without waiting or a screenshot)
  --no-ai                 switch AI layouts and Explain off for the run (no OpenAI spend; Jev still reads)
  --site-timeout <s>      give up on a site after this many seconds and move on (default: 240)
  --ext <dir>             unpacked extension (default: apps/extension/.output/chrome-mv3)
  --out <dir>             output folder (default: eval-output/<run>)
  --no-server             never start the WebAble server (use one that is already running)
  --check                 run the demo-page checks without the extension, then exit
  --rerender <run dir>    rebuild that run's index.html from its summary.json and report.json files, then exit
`;

/** Init script for sites.json `evalHide`: hide body-level overlay layers whose text matches, and their scroll lock. */
const HIDE_GATES = ({ gates, blocks }) => {
  const res = gates.map((p) => new RegExp(p));
  let n = 0;
  const sweep = () => {
    const body = document.body;
    if (!body) return;
    // Blocks: the smallest element whose text holds both the start and the end phrase.
    for (const [start, end] of blocks) {
      const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        if (!(t.nodeValue || '').includes(start)) continue;
        let el = t.parentElement;
        for (let d = 0; el && el !== body && d < 6 && !(el.textContent || '').includes(end); d++) el = el.parentElement;
        if (el && el !== body && (el.textContent || '').includes(end)) el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
    for (const el of Array.from(body.children)) {
      if (el.tagName === 'WEBABLE-UI' || el.tagName === 'SCRIPT') continue;
      const t = el.textContent || '';
      if (!t || !res.some((r) => r.test(t))) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.display !== 'none' && !el.querySelector('[aria-modal="true"], [role="dialog"]')) continue;
      el.style.setProperty('display', 'none', 'important');
      for (const prop of ['position', 'overflow', 'width', 'height', 'max-width', 'max-height', 'top']) body.style.removeProperty(prop);
      document.documentElement.style.removeProperty('overflow');
    }
  };
  const timer = setInterval(() => {
    sweep();
    if (++n > 120) clearInterval(timer);
  }, 250);
  document.addEventListener('DOMContentLoaded', sweep);
};

const PHASE_RANK = { idle: 0, reading: 1, tailored: 2, understood: 3, calm: 4 };
const rank = (p) => (p && p in PHASE_RANK ? PHASE_RANK[p] : -1);

// `pnpm eval -- --sites all` passes a lone "--" first; drop it so the flags after it still count.
const argv = process.argv.slice(2);
while (argv[0] === '--') argv.shift();

let opt;
let explicitSites = false;
try {
  const parsed = parseArgs({
    args: argv,
    allowNegative: true,
    tokens: true,
    options: {
      sites: { type: 'string', default: 'demo' },
      only: { type: 'string' },
      fit: { type: 'string', default: 'rosa' },
      viewport: { type: 'string', default: '1280x720' },
      size: { type: 'string' },
      dpr: { type: 'string', default: '1' },
      browser: { type: 'string', default: 'chromium' },
      'chrome-path': { type: 'string' },
      'sites-file': { type: 'string' },
      skip: { type: 'string', default: '' },
      ai: { type: 'boolean', default: true },
      'site-timeout': { type: 'string', default: '240' },
      rerender: { type: 'string' },
      headed: { type: 'boolean', default: false },
      quick: { type: 'boolean', default: false },
      ext: { type: 'string' },
      out: { type: 'string' },
      server: { type: 'boolean', default: true },
      check: { type: 'boolean', default: false },
      fitting: { type: 'boolean', default: false },
      larger: { type: 'string', default: '0' },
      interact: { type: 'boolean', default: false },
      adjust: { type: 'boolean', default: false },
      'interact-site': { type: 'string', default: 'alderra-refill' },
      struggle: { type: 'string', default: '75' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  opt = parsed.values;
  explicitSites = parsed.tokens.some((t) => t.kind === 'option' && (t.name === 'sites' || t.name === 'only'));
} catch (e) {
  console.error(`${e instanceof Error ? e.message : e}\n\n${HELP}`);
  process.exit(2);
}

const log = (...a) => console.log(...a);
const errText = (e) => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300);
const SKIP = new Set(String(opt.skip ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
for (const v of SKIP) {
  if (!['task', 'lens', 'calm'].includes(v)) {
    console.error(`--skip takes task, lens and calm (got "${v}").\n\n${HELP}`);
    process.exit(2);
  }
}

/* ------------------------------------------------------------------ site list */
/** sites.json, with --sites-file merged in (same name replaces, new names are appended in the file's order). */
function loadSiteList() {
  const base = JSON.parse(readFileSync(path.join(ROOT, 'scripts/eval/sites.json'), 'utf8'));
  if (!opt['sites-file']) return base;
  const file = path.resolve(opt['sites-file']);
  if (!existsSync(file)) throw new Error(`--sites-file ${file} does not exist.`);
  const extra = JSON.parse(readFileSync(file, 'utf8'));
  const merged = {};
  for (const group of ['demo', 'real']) {
    const list = [...(base[group] ?? [])];
    for (const s of extra[group] ?? []) {
      if (!s?.name || !s?.url) throw new Error(`--sites-file: every entry needs a name and a url (${JSON.stringify(s).slice(0, 80)}).`);
      const i = list.findIndex((x) => x.name === s.name);
      if (i >= 0) list[i] = { ...list[i], ...s };
      else list.push(s);
    }
    merged[group] = list;
  }
  return merged;
}

function pickSites() {
  const all = loadSiteList();
  const tag = (list, group) => (list ?? []).map((s) => ({ ...s, group }));
  const demo = tag(all.demo, 'demo');
  const real = tag(all.real, 'real');
  const everything = [...demo, ...real];
  if (opt.only) {
    const names = opt.only.split(',').map((s) => s.trim()).filter(Boolean);
    const picked = everything.filter((s) => names.includes(s.name));
    const missing = names.filter((n) => !picked.some((s) => s.name === n));
    if (missing.length) throw new Error(`Unknown site(s): ${missing.join(', ')}. Known: ${everything.map((s) => s.name).join(', ')}`);
    return picked;
  }
  if ((opt.fitting || opt.interact) && !explicitSites) return [];
  if (opt.sites === 'none') return [];
  if (opt.sites === 'demo') return demo;
  if (opt.sites === 'real') return real;
  if (opt.sites === 'all') return everything;
  throw new Error(`--sites must be demo, real, all or none (got "${opt.sites}").`);
}

function allSites() {
  const all = loadSiteList();
  return [...(all.demo ?? []).map((s) => ({ ...s, group: 'demo' })), ...(all.real ?? []).map((s) => ({ ...s, group: 'real' }))];
}

/* ------------------------------------------------------------------ extension control through the service worker */
function makeExtension(context, extensionId) {
  const prefix = `chrome-extension://${extensionId}/`;
  async function worker() {
    const live = context.serviceWorkers().find((w) => w.url().startsWith(prefix));
    if (live) return live;
    // A stopped worker restarts on the next extension event; opening the popup page is one.
    const p = await context.newPage();
    p.__webableEvalKeep = true;
    await p.goto(`${prefix}popup.html`).catch(() => {});
    const w = context.serviceWorkers().find((x) => x.url().startsWith(prefix)) ?? (await context.waitForEvent('serviceworker', { timeout: 8000 }));
    await p.close().catch(() => {});
    return w;
  }
  async function evaluate(fn, arg) {
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        const w = await worker();
        return await w.evaluate(fn, arg);
      } catch (e) {
        last = e;
        await sleep(400);
      }
    }
    throw last;
  }
  return {
    evaluate,
    /** Prefer the background's __webable hooks; fall back to the storage keys they wrap. */
    setFit: (fit) =>
      evaluate(async (f) => {
        const g = globalThis.__webable;
        if (g && typeof g.setFit === 'function') { await g.setFit(f); return 'hook'; }
        await chrome.storage.local.set({ fit: f });
        return 'storage';
      }, fit),
    setSettings: (patch, defaults) =>
      evaluate(async ({ patch: p, defaults: d }) => {
        const cur = (await chrome.storage.local.get('settings')).settings ?? {};
        const next = { ...d, ...cur, ...p };
        const g = globalThis.__webable;
        if (g && typeof g.setSettings === 'function') await g.setSettings(next);
        else await chrome.storage.local.set({ settings: next });
        return next;
      }, { patch, defaults }),
    /** The tab's zoom factor as Chrome reports it (WebAble's page zoom plus any of the person's own). */
    zoom: (tabId) =>
      tabId == null ? Promise.resolve(null) : evaluate((id) => chrome.tabs.getZoom(id).catch(() => null), tabId).catch(() => null),
    /** The TabReport for the tab showing `url` (or `tabId` if known). */
    report: (url, tabId) =>
      evaluate(async ({ url: u, tabId: known }) => {
        let id = known ?? null;
        if (id == null) {
          const tabs = await chrome.tabs.query({});
          const norm = (x) => String(x ?? '').split('#')[0];
          const origin = (() => { try { return new URL(u).origin; } catch { return ''; } })();
          const hit = tabs.find((t) => norm(t.url) === norm(u)) ?? tabs.find((t) => origin && String(t.url ?? '').startsWith(origin));
          id = hit?.id ?? null;
        }
        if (id == null) return { tabId: null, report: null };
        let rep = null;
        const g = globalThis.__webable;
        if (g && typeof g.getReport === 'function') {
          try { rep = (await g.getReport(id)) ?? null; } catch { rep = null; }
        }
        if (!rep) {
          const key = `report:${id}`;
          rep = (await chrome.storage.session.get(key))[key] ?? null;
        }
        return { tabId: id, report: rep };
      }, { url, tabId: tabId ?? null }),
  };
}

/* ------------------------------------------------------------------ one site */
/** In the page: bring the main task into view (WebAble's marked main action, else the ledger's label). */
const SCROLL_TO_TASK = (label) => {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4 && getComputedStyle(el).visibility !== 'hidden';
  };
  const want = norm(label).replace(/[….]+$/, '').toLowerCase().slice(0, 40);
  let el = [...document.querySelectorAll('[data-wa-main]')].find(shown) ?? null;
  let how = 'main action';
  if (!el && want) {
    el = [...document.querySelectorAll('button, a[href], input[type=submit], input[type=button], [role=button]')].find(
      (x) => shown(x) && norm(x.textContent || x.value || x.getAttribute('aria-label')).toLowerCase().includes(want),
    ) ?? null;
  }
  const y0 = scrollY;
  if (el) {
    const r = el.getBoundingClientRect();
    const inView = r.top >= 0 && r.bottom <= innerHeight;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const text = norm(el.textContent || el.value || el.getAttribute('aria-label')).slice(0, 50);
    return { how: inView && Math.abs(scrollY - y0) < 2 ? 'main action (already in view)' : how, label: text, y: Math.round(scrollY) };
  }
  window.scrollBy({ top: Math.round(innerHeight * 0.9), left: 0, behavior: 'instant' });
  how = Math.abs(scrollY - y0) < 2 ? 'no main action marked · the page would not scroll (a dialog may lock it)' : 'no main action marked · one screen down';
  return { how, label: null, y: Math.round(scrollY) };
};

async function evalSite(ctx, site) {
  const { context, ext, runDir, core } = ctx;
  const id = slug(site.name);
  const dir = path.join(runDir, id);
  mkdirSync(dir, { recursive: true });
  const res = {
    name: site.name, slug: id, group: site.group, url: site.url, finalUrl: null, note: site.note ?? '',
    shots: {}, shotNotes: {}, shotErrors: {}, errors: [], phases: {}, msToUnderstood: null, calmAuto: false,
    report: null, pageErrors: 0, firstScreen: {}, engine: null, tabZoom: null, task: null,
  };
  /** First-screen facts for one view; never lets a measuring problem stop the run. */
  const measure = async (kind, mainLabel) => {
    try {
      res.firstScreen[kind] = await measureView(page, kind, { mainLabel });
    } catch (e) {
      res.firstScreen[kind] = { kind, error: errText(e) };
    }
  };
  const settleMs = Number(site.settleMs) || (site.group === 'real' ? 6000 : 4000);
  const local = site.url.startsWith(SERVER_ORIGIN);
  const page = await context.newPage();
  page.__webableEvalKeep = true;
  ctx.current = page;
  let tabId = null;
  // Sites whose throwaway profile opens a blocking terms gate (cnn.com's "Legal Terms and Privacy"): hide that layer
  // and its scroll lock for the screenshots, so the page is judged as a returning visitor sees it. Nothing is clicked
  // and nothing is accepted.
  // `evalHideBlocks` hides test-profile artifacts the same way (a fresh profile has no DRM module, so cnn.com draws
  // "DRM System Not Supported" over its video thumbnails; a person's own Chrome plays them).
  if ((site.evalHide ?? []).length || (site.evalHideBlocks ?? []).length) {
    await page.addInitScript(HIDE_GATES, { gates: site.evalHide ?? [], blocks: site.evalHideBlocks ?? [] }).catch(() => {});
  }

  page.on('pageerror', (e) => {
    res.pageErrors += 1;
    if (local) res.errors.push(`page: ${errText(e)}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location()?.url ?? '';
    if (where.startsWith('chrome-extension://') || /webable/i.test(m.text())) res.errors.push(`extension: ${m.text().slice(0, 300)}`);
    else if (local && !/favicon/i.test(m.text())) res.errors.push(`console: ${m.text().slice(0, 300)}`);
  });

  const goto = async () => {
    try {
      const resp = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
      res.status = resp?.status() ?? null;
    } catch (e) {
      res.errors.push(`load: ${errText(e)}`);
    }
    res.finalUrl = page.url();
  };
  const getReport = async () => {
    try {
      const r = await ext.report(page.url(), tabId);
      if (r.tabId != null) tabId = r.tabId;
      return r.report;
    } catch (e) {
      res.errors.push(`report: ${errText(e)}`);
      return null;
    }
  };
  const waitFor = async (pred, timeoutMs) => {
    const t0 = Date.now();
    let rep = null;
    while (Date.now() - t0 < timeoutMs) {
      rep = await getReport();
      if (rep && pred(rep)) return { ok: true, ms: Date.now() - t0, report: rep };
      await sleep(300);
    }
    return { ok: false, ms: Date.now() - t0, report: rep };
  };
  const shot = async (key, note) => {
    const file = `${id}/${key}.png`;
    try {
      await page.mouse.move(-20, -20).catch(() => {});
      await shoot(page, path.join(runDir, file));
      res.shots[key] = file;
      if (note) res.shotNotes[key] = note;
    } catch (e) {
      res.shotErrors[key] = `Screenshot failed: ${errText(e)}`;
    }
  };
  /** Trusted key press from Playwright; first move focus off any text field (the shortcuts ignore those). */
  const press = async (combo) => {
    await page.bringToFront().catch(() => {});
    await page
      .evaluate(() => {
        const a = document.activeElement;
        if (a instanceof HTMLElement && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) a.blur();
      })
      .catch(() => {});
    await page.keyboard.press(combo);
  };
  /** What the Calm view is showing, from the report's redesign summary. */
  const calmNote = (r, prefix = '') => {
    const d = r?.redesign;
    const what = !d
      ? 'heuristic layout'
      : d.autoApply
        ? `AI layout "${d.chosen}" applied`
        : d.chosen === 'heuristic'
          ? 'heuristic layout (Jev kept it)'
          : `heuristic layout · AI "${d.chosen}" offered`;
    return prefix ? `${prefix} · ${what}` : what;
  };
  /** In Calm view the AI layout swaps in after 6 s without input; wait for it unless --quick. */
  const waitForCalmLayout = async (openedAt) => {
    if (opt.quick) { await sleep(1200); return; }
    const w = await waitFor((r) => r.redesign != null || r.phase === 'error', 16_000);
    const sinceOpen = Date.now() - openedAt;
    if (w.ok && sinceOpen < 7000) await sleep(7000 - sinceOpen);
    await sleep(900);
  };

  try {
    // 1) Before: WebAble paused on this origin.
    const origins = new Set([new URL(site.url).origin]);
    await ext.setSettings({ enabled: true, lens: false, pausedOrigins: [...origins] }, core.DEFAULT_SETTINGS);
    await goto();
    const landed = (() => { try { return new URL(page.url()).origin; } catch { return null; } })();
    if (landed && landed.startsWith('http') && !origins.has(landed)) {
      origins.add(landed);
      await ext.setSettings({ pausedOrigins: [...origins] }, core.DEFAULT_SETTINGS);
      await goto();
    }
    await sleep(settleMs);
    res.phases.before = (await getReport())?.phase ?? null;
    await shot('before', res.phases.before && res.phases.before !== 'idle' ? `phase ${res.phases.before} (expected idle)` : '');
    await measure('before', null);

    // 2) After: enabled, fitted. Wait for Jev's decisions (phase >= understood) or 15 s.
    await ext.setSettings({ pausedOrigins: [] }, core.DEFAULT_SETTINGS);
    const navAt = Date.now();
    await goto();
    const w = await waitFor((r) => rank(r.phase) >= PHASE_RANK.understood || r.phase === 'error', 15_000);
    res.msToUnderstood = w.ok && rank(w.report?.phase) >= PHASE_RANK.understood ? Date.now() - navAt : null;
    const calmSeenAt = w.report?.phase === 'calm' ? Date.now() : null;
    const left = settleMs - (Date.now() - navAt);
    if (left > 0) await sleep(left);
    await sleep(1200);
    let rep = await getReport();
    res.phases.after = rep?.phase ?? null;
    if (!w.ok) res.errors.push(`timing: no "understood" phase within 15 s (last phase: ${w.report?.phase ?? 'no report'})`);

    // Calm view may open by itself (structureLevel 2 on a busy page). Capture it, then close it for "after".
    let mainLabel = mainLabelFrom(rep);
    if (rep?.phase === 'calm') {
      res.calmAuto = true;
      if (!SKIP.has('calm')) {
        await waitForCalmLayout(calmSeenAt ?? navAt);
        rep = await getReport();
        mainLabel = mainLabelFrom(rep) ?? mainLabel;
        await shot('calm', calmNote(rep, 'opened by itself'));
        await measure('calm', mainLabel);
      }
      await press('Alt+Shift+KeyC');
      // The pill and the overlay bar settle about 2 s after Calm view closes (the pill moves only when it is sure).
      await sleep(2200);
      rep = await getReport();
    }
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })).catch(() => {});
    await sleep(300);
    res.tabZoom = await ext.zoom(tabId);
    res.engine = await engineState(page);
    const zoomNote = res.tabZoom != null ? ` · zoom ${Math.round(res.tabZoom * 100)}%` : '';
    await shot('after', rep ? `phase ${rep.phase}${zoomNote}${res.calmAuto ? ' · Calm view closed for this shot' : ''}` : 'no report');
    mainLabel = mainLabelFrom(rep) ?? mainLabel;
    res.mainLabel = mainLabel;
    await measure('after', mainLabel);

    // 2b) After, scrolled to the main task (or one screen down when the page has none), then back to the top.
    if (!SKIP.has('task')) {
      res.task = await page.evaluate(SCROLL_TO_TASK, mainLabel).catch((e) => ({ how: 'scroll failed', error: errText(e) }));
      await sleep(1200);
      await shot('task', res.task?.how ? `${res.task.how}${res.task.label ? ` “${res.task.label}”` : ''}` : '');
      await measure('task', mainLabel);
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })).catch(() => {});
      await sleep(600);
    }

    // 3) Jev Lens (Alt+Shift+L; Alt+J on round-1 builds), then off again.
    if (!SKIP.has('lens')) {
      const lensOn = async () => (await uiProbe(page)).lens;
      let lensKey = 'Alt+Shift+KeyL';
      await press(lensKey);
      await sleep(1500);
      if (!(await lensOn())) {
        lensKey = 'Alt+KeyJ';
        await press(lensKey);
        await sleep(1500);
      }
      await shot('lens');
      await measure('lens', mainLabel);
      await press(lensKey);
      await sleep(500);
    }

    // 4) Calm view (Alt+Shift+C) if it did not open by itself.
    if (!res.calmAuto && !SKIP.has('calm')) {
      await press('Alt+Shift+KeyC');
      const openedAt = Date.now();
      const c = await waitFor((r) => r.phase === 'calm' || r.phase === 'error', 8000);
      if (!c.ok || c.report?.phase !== 'calm') res.errors.push(`calm: Calm view did not report phase "calm" within 8 s (last: ${c.report?.phase ?? 'no report'})`);
      await waitForCalmLayout(openedAt);
      rep = await getReport();
      await shot('calm', c.ok ? calmNote(rep) : 'Calm view did not open');
      if (c.ok) await measure('calm', mainLabel);
      await press('Alt+Shift+KeyC');
      await sleep(400);
    }
    // 5) --adjust: the person's own page controls. Narrower (Alt+Shift+[), the panel, Larger text, then back.
    if (opt.adjust) {
      res.adjust = {};
      const colW = async () => (await engineState(page))?.column?.widthPx ?? null;
      // Wait for a settled new value (a width change passes through "no column" while the old one comes off).
      const waitChange = async (get, from, ms = 12000) => {
        const t0 = Date.now();
        let last = from;
        while (Date.now() - t0 < ms) {
          const v = await get();
          if (v !== from && v != null) {
            await sleep(700);
            const again = await get();
            if (again === v) return v;
          }
          last = v;
          await sleep(300);
        }
        return last;
      };
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })).catch(() => {});
      const w0 = await colW();
      await press('Alt+Shift+BracketLeft');
      const w1 = await waitChange(colW, w0);
      await sleep(1200);
      res.adjust.narrower = { from: w0, to: w1, tabZoom: await ext.zoom(tabId) };
      await shot('narrower', `Narrower: column ${w0 ?? 'off'} → ${w1 ?? 'off'} px`);
      await measure('narrower', mainLabel);
      await press('Alt+Shift+KeyW');
      await sleep(900);
      await shot('panel', 'WebAble panel: Text size and Page width');
      const zoomOf = async () => (await engineState(page))?.pageZoom ?? null;
      const z0 = await zoomOf();
      const clicked = await uiClick(page, ['button'], { re: 'Larger' }).catch(() => null);
      const z1 = clicked ? await waitChange(zoomOf, z0) : z0;
      // The page column is checked again for the new size (a few tries when it has to widen): wait for its ledger line.
      if (clicked) {
        const colLine = (r) => {
          const led = r?.ledger ?? [];
          const i = led.map((e) => e.title).findLastIndex((t) => /^Text (larger|smaller)/.test(t));
          return i >= 0 && led.slice(i + 1).some((e) => /column|full width/i.test(e.title));
        };
        await waitFor(colLine, 25_000);
        await sleep(1200);
      }
      res.adjust.larger = { clicked: !!clicked, tabZoomFrom: z0, tabZoomTo: z1, column: await colW() };
      await shot('larger', `Larger text: tab zoom ${z0} → ${z1}${clicked ? '' : ' (button not found)'}`);
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(600);
      await measure('larger', mainLabel);
    }
    res.report = await getReport();
    if (!res.engine) res.engine = await engineState(page);
  } catch (e) {
    res.errors.push(`harness: ${errText(e)}`);
    res.report = res.report ?? (await getReport());
  } finally {
    res.errors = [...new Set(res.errors)];
    writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(res.report, null, 2)}\n`);
    writeFileSync(
      path.join(dir, 'metrics.json'),
      `${JSON.stringify({ name: res.name, url: res.url, finalUrl: res.finalUrl, tabZoom: res.tabZoom, engine: res.engine, task: res.task, adjust: res.adjust ?? null, mainLabel: res.mainLabel ?? null, firstScreen: res.firstScreen }, null, 2)}\n`,
    );
    await page.close().catch(() => {});
  }
  return res;
}

/** summary.json: the run's meta and, per site, the metrics the claims scripts read (scripts/claims/summarize.mjs). */
function summaryOf(meta, results, fitting, interact) {
  return {
    ...meta,
    results: results.map((r) => ({
      name: r.name, url: r.url, finalUrl: r.finalUrl, status: r.status ?? null, phases: r.phases, msToUnderstood: r.msToUnderstood,
      calmAuto: r.calmAuto, shots: r.shots, shotErrors: r.shotErrors, pageErrors: r.pageErrors, mainLabel: r.mainLabel ?? null,
      tabZoom: r.tabZoom, engine: r.engine, task: r.task, firstScreen: r.firstScreen, timedOut: !!r.timedOut, ...siteMetrics(r),
      // For --rerender: what the contact sheet needs that the metrics above do not carry.
      sheet: { slug: r.slug, group: r.group, note: r.note, shotNotes: r.shotNotes, harnessErrors: r.errors },
    })),
    fitting,
    interact,
  };
}

/**
 * evalSite with a time limit: a page that hangs (an endless script, a stuck capture) is closed so the run moves on.
 * Closing the page makes every pending call in evalSite fail, so it still writes what it has.
 */
async function evalSiteGuarded(ctx, site, timeoutMs) {
  const work = evalSite(ctx, site);
  let timer = null;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
  const first = await Promise.race([work, late]);
  clearTimeout(timer);
  if (first !== 'timeout') return first;
  await ctx.current?.close().catch(() => {});
  const r = await Promise.race([work, sleep(20_000).then(() => null)]);
  const out = r ?? {
    name: site.name, slug: slug(site.name), group: site.group, url: site.url, finalUrl: null, note: site.note ?? '',
    shots: {}, shotNotes: {}, shotErrors: {}, errors: [], phases: {}, msToUnderstood: null, calmAuto: false,
    report: null, pageErrors: 0, firstScreen: {}, engine: null, tabZoom: null, task: null,
  };
  out.timedOut = true;
  out.errors = [...(out.errors ?? []), `harness: gave up on the site after ${Math.round(timeoutMs / 1000)} s`];
  return out;
}

/* ------------------------------------------------------------------ browser */
/** "Google Chrome 149.0.7827.201" → "149.0.7827.201", or null. */
function chromeVersion(exe) {
  try {
    const out = execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return /(\d+\.\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Start the browser with the extension. Chrome for Testing takes --load-extension; branded Google Chrome no longer
 * does, so it gets the extension through the DevTools protocol (Extensions.loadUnpacked, which needs
 * --enable-unsafe-extension-debugging and Playwright's pipe connection). Both run in a throwaway profile.
 */
async function launchBrowser(chromium, userDataDir, { viewport, dpr, extDir }) {
  const common = {
    headless: !opt.headed,
    viewport,
    deviceScaleFactor: dpr,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    locale: 'en-US',
  };
  if (opt.browser !== 'chrome') {
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...common,
      ...browserTarget(),
      userAgent: DESKTOP_UA,
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, ...dprArgs(dpr)],
    });
    return { context, extensionId: null, version: null, via: '--load-extension' };
  }
  const exe = path.resolve(opt['chrome-path'] ?? chromePath());
  if (!existsSync(exe)) throw new Error(`Google Chrome not found at ${exe}. Pass --chrome-path or set CHROME_PATH.`);
  const version = chromeVersion(exe);
  const major = version?.split('.')[0] ?? '149';
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...common,
    executablePath: exe,
    // Headless Chrome says "HeadlessChrome", which some sites refuse (Drugs.com answers 403); say what it is.
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', ...dprArgs(dpr)],
  });
  try {
    const browser = context.browser();
    if (!browser) throw new Error('no browser handle');
    const cdp = await browser.newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: extDir });
    await cdp.detach().catch(() => {});
    return { context, extensionId: id, version: version ? `Google Chrome ${version}` : 'Google Chrome', via: 'CDP Extensions.loadUnpacked' };
  } catch (e) {
    await context.close().catch(() => {});
    throw new Error(`Could not load the extension into Google Chrome over CDP: ${errText(e)}`);
  }
}

/* ------------------------------------------------------------------ rerender */
/** Rebuild a run's contact sheet from what it saved (after a change to the sheet or the verdicts). */
function rerender(dir) {
  const sum = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const results = (sum.results ?? []).map((x) => {
    const id = x.sheet?.slug ?? slug(x.name);
    let report = null;
    try {
      report = JSON.parse(readFileSync(path.join(dir, id, 'report.json'), 'utf8'));
    } catch {
      /* no report saved */
    }
    return {
      ...x, slug: id, group: x.sheet?.group, note: x.sheet?.note ?? '', shotNotes: x.sheet?.shotNotes ?? {},
      errors: x.sheet?.harnessErrors ?? [], report,
    };
  });
  setBaseDpr(sum.dpr ?? 1);
  const { results: _r, ...meta } = sum;
  writeFileSync(path.join(dir, 'index.html'), renderSheet(meta, results, { fitting: sum.fitting, interact: sum.interact }));
  log(`Contact sheet: ${path.join(dir, 'index.html')}`);
  return 0;
}

/* ------------------------------------------------------------------ main */
async function main() {
  if (opt.help) { log(HELP); return 0; }
  if (opt.check) {
    const r = await runDemoChecks({ headed: opt.headed, outDir: opt.out ? path.resolve(opt.out) : undefined });
    return r.ok ? 0 : 1;
  }
  if (opt.rerender) return rerender(path.resolve(opt.rerender));

  const startedAt = Date.now();
  const core = await loadCore();
  const fit = core.DEMO_FITS?.[opt.fit];
  if (!fit) throw new Error(`Unknown fit "${opt.fit}". Use rosa, typical or reader.`);
  const sites = pickSites();
  if (!sites.length && !opt.fitting && !opt.interact) throw new Error('No sites selected.');
  const interactSite = opt.interact ? allSites().find((s) => s.name === opt['interact-site']) : null;
  if (opt.interact && !interactSite) throw new Error(`Unknown --interact-site "${opt['interact-site']}".`);
  const viewport = parseViewport(opt.size ?? opt.viewport);
  const dpr = Number(opt.dpr);
  if (!(dpr >= 1 && dpr <= 4)) throw new Error(`--dpr must be between 1 and 4 (got "${opt.dpr}").`);
  setBaseDpr(dpr);
  if (opt.browser !== 'chromium' && opt.browser !== 'chrome') throw new Error(`--browser must be chromium or chrome (got "${opt.browser}").`);
  const extDir = path.resolve(opt.ext ?? EXT_DIR);
  if (!existsSync(path.join(extDir, 'manifest.json'))) {
    throw new Error(`No built extension at ${extDir}. Build it first: pnpm --filter @webable/extension build`);
  }
  const run = `${stamp()}-${opt.fit}${opt.browser === 'chrome' ? '-chrome' : ''}${dpr !== 1 ? `-dpr${dpr}` : ''}`;
  const runDir = path.resolve(opt.out ?? path.join(ROOT, 'eval-output', run));
  mkdirSync(runDir, { recursive: true });
  const extras = [opt.fitting ? 'fitting flow' : null, opt.interact ? `interactions on ${opt['interact-site']}` : null].filter(Boolean);
  log(`WebAble eval · ${sites.length} site(s)${extras.length ? ` + ${extras.join(' + ')}` : ''} · fit ${opt.fit} · ${viewport.width}×${viewport.height} @${dpr}x · ${opt.browser === 'chrome' ? 'Google Chrome' : 'Chrome for Testing'}`);
  log(`Output: ${runDir}`);

  let server = { started: false, stop: async () => {}, health: null };
  try {
    server = await ensureServer({ logFile: path.join(runDir, 'server.log'), start: opt.server, log });
  } catch (e) {
    if (opt.server) throw e;
    log(`Warning: ${errText(e)} Continuing; demo pages and Jev calls will fail.`);
  }
  const h = server.health ?? (await health());
  const serverLine = h
    ? `${server.started ? 'started for this run' : 'already running'}${h.jev ? ` · Jev ${h.jev.model ?? ''}${h.jev.warm ? ' warm' : ' cold'}` : ''}${typeof h.ai === 'string' ? ` · AI layouts ${h.ai === 'no_credits' ? 'off (no credits)' : h.ai}` : typeof h.openai === 'boolean' ? ` · OpenAI ${h.openai ? 'on' : 'off'}` : ''}`
    : 'not running';
  log(`Server: ${serverLine}`);

  const { chromium } = loadPlaywright();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'webable-eval-'));
  let context = null;
  let interrupted = false;
  const cleanup = async () => {
    await context?.close().catch(() => {});
    context = null;
    await server.stop().catch(() => {});
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  const onSignal = () => {
    if (interrupted) return;
    interrupted = true;
    log('\nInterrupted; closing the browser and server…');
    void cleanup().then(() => process.exit(130));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const results = [];
  let fitting = null;
  let interact = null;
  let extensionId = null;
  let browserVersion = null;
  let loadedVia = null;
  const runMeta = () => ({
    run, fit: opt.fit, fitTextPx: fit.text?.override ?? fit.text?.bodyPx ?? null, viewport, dpr: baseDpr(), extensionId, browser: browserVersion, loadedVia, server: serverLine,
    durationMs: Date.now() - startedAt, sites: opt.only ?? opt.sites, sitesFile: opt['sites-file'] ? path.resolve(opt['sites-file']) : null,
    ext: extDir, ai: opt.ai, skip: [...SKIP],
  });
  try {
    const launched = await launchBrowser(chromium, userDataDir, { viewport, dpr, extDir });
    context = launched.context;
    loadedVia = launched.via;
    // Close extension tabs we did not open (older builds opened the warm-up on install).
    context.on('page', (p) => {
      setTimeout(() => {
        if (!p.__webableEvalKeep && p.url().startsWith('chrome-extension://')) p.close().catch(() => {});
      }, 1500);
    });
    const ours = (w) => (launched.extensionId ? w.url().startsWith(`chrome-extension://${launched.extensionId}/`) : w.url().startsWith('chrome-extension://'));
    let sw = context.serviceWorkers().find(ours);
    const t0 = Date.now();
    while (!sw && Date.now() - t0 < 15_000) {
      await context.waitForEvent('serviceworker', { timeout: 3000 }).catch(() => null);
      sw = context.serviceWorkers().find(ours);
    }
    if (!sw) throw new Error('The extension did not start (no service worker). Is the build complete?');
    extensionId = new URL(sw.url()).host;
    browserVersion = launched.version ?? (await sw.evaluate(() => (/(?:Headless)?Chrome\/[\d.]+/.exec(navigator.userAgent) ?? [navigator.userAgent])[0]).catch(() => null));
    log(`Extension ${extensionId} · ${browserVersion ?? 'browser'} · ${loadedVia}`);
    const ext = makeExtension(context, extensionId);
    const how = await ext.setFit(fit);
    await ext.setSettings({ enabled: true, lens: false, pausedOrigins: [], ...(opt.ai ? {} : { aiLayouts: false, explain: false }) }, core.DEFAULT_SETTINGS);
    log(`Fit "${opt.fit}" set (${how}).${opt.ai ? '' : ' AI layouts and Explain off for this run (--no-ai).'}${SKIP.size ? ` Skipping: ${[...SKIP].join(', ')}.` : ''}`);
    await sleep(1600);
    for (const p of context.pages()) if (!p.__webableEvalKeep) await p.close().catch(() => {});

    if (opt.fitting && !interrupted) {
      log('\n→ fitting flow');
      const t0 = Date.now();
      fitting = await runFitting({ context, extensionId, runDir, larger: Math.max(0, Number(opt.larger) || 0), log });
      fitting.fit = await ext.evaluate(async () => (await chrome.storage.local.get('fit')).fit ?? null).catch(() => null);
      const bad = fitting.screens.filter((x) => !x.ok).length;
      log(`  ${fitting.screens.length} screens · ${bad} with problems · ${fitting.seconds ?? '—'} s to "Your fit" · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      // The fitting saved a measured fit: put the demo fit back for the pages.
      await ext.setFit(fit);
      await sleep(600);
    }

    const siteTimeoutMs = Math.max(60, Number(opt['site-timeout']) || 240) * 1000;
    for (const [i, site] of sites.entries()) {
      if (interrupted) break;
      log(`\n→ ${sites.length > 1 ? `[${i + 1}/${sites.length}] ` : ''}${site.name}  ${site.url}`);
      const t0 = Date.now();
      const r = await evalSiteGuarded({ context, ext, runDir, core, current: null }, site, siteTimeoutMs);
      const m = siteMetrics(r);
      log(`  phase ${m.phase ?? 'none'} · ${m.decisions ?? 0} Jev decisions · ${m.jevMs != null ? `${Math.round(m.jevMs)} ms` : '—'} · ${m.opsApplied} ops applied, ${m.opsReversed} reversed · ${m.checksFailed.length} checks failed · ${m.errors.length} errors · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      const rl = readingLine(r);
      if (rl) log(`  ${rl}`);
      for (const e of m.errors.slice(0, 4)) log(`    ! ${e}`);
      results.push(r);
      // Written after every site, so a long run that stops part-way still leaves numbers to read.
      try {
        writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summaryOf(runMeta(), results, fitting, interact), null, 2)}\n`);
      } catch (e) {
        log(`  (could not write summary.json: ${errText(e)})`);
      }
    }

    if (opt.interact && interactSite && !interrupted) {
      log(`\n→ interactions on ${interactSite.name}`);
      const t0 = Date.now();
      await ext.setSettings({ enabled: true, lens: false, pausedOrigins: [] }, core.DEFAULT_SETTINGS);
      interact = await runInteract({ context, runDir, site: interactSite, ext, health: h, struggleSeconds: Math.max(10, Number(opt.struggle) || 75), log });
      const bad = interact.steps.filter((x) => !x.ok).length;
      log(`  ${interact.steps.length} steps · ${bad} with a failed check · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      for (const e of interact.errors.slice(0, 4)) log(`    ! ${e}`);
    }
  } finally {
    const meta = runMeta();
    if (results.length || fitting || interact) {
      writeFileSync(path.join(runDir, 'index.html'), renderSheet(meta, results, { fitting, interact }));
      writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summaryOf(meta, results, fitting, interact), null, 2)}\n`);
    }
    await cleanup();
  }
  log(`\nContact sheet: ${path.join(runDir, 'index.html')}`);
  const problems =
    results.filter((r) => siteMetrics(r).errors.length > 0 || !r.shots.after).length +
    (fitting ? fitting.screens.filter((x) => !x.ok).length + fitting.errors.length : 0) +
    (interact ? interact.steps.filter((x) => !x.ok).length + interact.errors.length : 0);
  return problems ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`eval: ${errText(e)}`);
    process.exit(1);
  });
