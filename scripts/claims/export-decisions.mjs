#!/usr/bin/env node
// Export what Jev decided on each page, for blind human labelling and for the Jev-vs-GPT run. Read-only on the repo:
// it loads an unpacked build of the extension and writes only to --out.
//
//   node scripts/claims/export-decisions.mjs --urls scripts/claims/urls-jev-vs-gpt.txt --out <dir> [--ext <dir>]
//                                            [--fit rosa] [--headed] [--kit]
//
// Needs the WebAble server on 127.0.0.1:41741 (pnpm dev:server, or the shared one). AI layouts and Explain are
// switched OFF for the export, so the only spend is Jev (about $0.003 a page). Writes:
//   <out>/<slug>.json    digest (the redacted evidence Jev saw), understanding (every judgment and probability), decisions
//   <out>/to-label.csv   BLIND sheet: no Jev answers. One row per element to label, rows shuffled across pages.
//   <out>/pages-blind.csv BLIND sheet: one row per page, "main action" to fill in.
//   <out>/jev.csv        Jev's answers for the same rows (for score.mjs; never show it to the labellers).
//   <out>/pages-jev.csv  Jev's main-action pick per page (for score.mjs).
// With --kit, also the label kit (label-kit.mjs): while each page is open, WebAble shows the original page and every
// row gets a ringed crop, plus a full-page shot per page, then <out>/label-kit/label.html (+ images/) for the labeller.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BLIND_HEAD, PAGES_HEAD, captureKitPage, writeKit } from './label-kit.mjs';
import { evalCommon, toCsv } from './lib.mjs';

const { EXT_DIR, DESKTOP_UA, loadPlaywright, browserTarget, sleep, slug } = await evalCommon();

const { values: opt } = parseArgs({
  options: {
    urls: { type: 'string' },
    out: { type: 'string', default: './export' },
    ext: { type: 'string' },
    fit: { type: 'string', default: 'rosa' },
    headed: { type: 'boolean', default: false },
    sample: { type: 'string', default: '10' }, // extra random "kept" elements per page, for calibration
    wait: { type: 'string', default: '20000' },
    kit: { type: 'boolean', default: false }, // pictures + label.html for the labeller (label-kit.mjs)
  },
});
if (!opt.urls) {
  console.error('usage: node scripts/claims/export-decisions.mjs --urls urls.txt --out <dir> [--ext <unpacked build>]');
  process.exit(2);
}
const extDir = path.resolve(opt.ext ?? EXT_DIR);
if (!existsSync(path.join(extDir, 'manifest.json'))) throw new Error(`No unpacked extension at ${extDir}`);
const urls = readFileSync(opt.urls, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
const outDir = path.resolve(opt.out);
mkdirSync(outDir, { recursive: true });

/** Evaluate in the extension's isolated world (where __webableEngine lives). */
async function inEngine(page, expression) {
  const cdp = await page.context().newCDPSession(page);
  const ctxs = [];
  cdp.on('Runtime.executionContextCreated', (e) => ctxs.push(e.context));
  try {
    await cdp.send('Runtime.enable');
    for (const c of ctxs.filter((x) => x.auxData?.type === 'isolated')) {
      const r = await cdp.send('Runtime.evaluate', { contextId: c.id, returnByValue: true, expression });
      if (r?.result?.value) return r.result.value;
    }
    return null;
  } finally {
    await cdp.send('Runtime.disable').catch(() => {});
    await cdp.detach().catch(() => {});
  }
}

const GRAB = `(() => {
  const e = globalThis.__webableEngine;
  if (!e) return null;
  const s = e.getState();
  if (!s.understanding || !s.digest) return { phase: s.phase };
  const rect = (id) => { const el = e.elementFor ? e.elementFor(id) : null; if (!el) return null;
    const r = el.getBoundingClientRect(); return [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)]; };
  return {
    phase: s.phase,
    digest: s.digest,
    understanding: s.understanding,
    decisions: (s.decisions || []).map((d) => ({ id: d.id, verdict: d.verdict, reasons: d.reasons })),
    rects: Object.fromEntries((s.digest.elements || []).map((x) => [x.id, rect(x.id)])),
  };
})()`;

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const { chromium } = loadPlaywright();
const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'webable-export-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: !opt.headed, viewport: { width: 1280, height: 720 }, userAgent: DESKTOP_UA, locale: 'en-US', ...browserTarget(),
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const labelRows = [];
const jevRows = [];
const pageRows = [];
const kitShots = {};
try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  await sw.evaluate(async (fitName) => {
    const g = globalThis.__webable;
    await g.setFit(fitName);
    const cur = (await chrome.storage.local.get('settings')).settings ?? {};
    await g.setSettings({ ...cur, enabled: true, lens: false, aiLayouts: false, explain: false, pausedOrigins: [] });
  }, opt.fit);
  await sleep(1500);
  for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close().catch(() => {});

  for (const url of urls) {
    const u0 = new URL(url);
    const name = slug(u0.hostname.replace(/^www\./, '') + u0.pathname).slice(0, 60);
    const page = await context.newPage();
    const t0 = Date.now();
    let got = null;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      while (Date.now() - t0 < Number(opt.wait)) {
        got = await inEngine(page, GRAB).catch(() => null);
        if (got?.understanding) break;
        await sleep(500);
      }
    } catch (e) {
      console.log(`  ${name}: load failed (${String(e.message).split('\n')[0]})`);
    }
    if (!got?.understanding) {
      console.log(`${name}: no Jev read (phase ${got?.phase ?? 'none'})`);
      await page.close().catch(() => {});
      continue;
    }
    writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ url, ...got }, null, 1));
    const u = got.understanding;
    const els = new Map(got.digest.elements.map((e) => [e.id, e]));
    const verdict = new Map(got.decisions.map((d) => [d.id, d.verdict]));
    const acted = got.decisions.filter((d) => d.verdict !== 'keep').map((d) => d.id);
    const keptPool = shuffle(u.elements.map((j) => j.id).filter((id) => !acted.includes(id))).slice(0, Number(opt.sample));
    const helpish = u.elements.filter((j) => j.help >= 0.3 || j.role === 'help_contact').map((j) => j.id);
    const ids = [...new Set([...acted, ...helpish, ...keptPool])];
    const rowIds = [];
    for (const id of ids) {
      const e = els.get(id);
      const j = u.elements.find((x) => x.id === id);
      if (!e || !j) continue;
      rowIds.push(id);
      const r = got.rects[id];
      labelRows.push([name, url, id, e.tag, e.label, e.position, r ? `x${r[0]} y${r[1]} ${r[2]}x${r[3]}` : '', '', '', '']);
      const foldP = (j.roleProbs.advertising ?? 0) + (j.roleProbs.recommendations ?? 0) + (j.roleProbs.popup_overlay ?? 0);
      jevRows.push([name, id, verdict.get(id) ?? 'keep', j.role, j.roleP, foldP.toFixed(3), j.help, j.task, j.main]);
    }
    const mp = u.mainPick;
    pageRows.push([name, url, '', mp.id === 'none' ? 'none' : els.get(mp.id)?.label ?? mp.id, mp.p]);
    const m = u.firstRead ?? u.metrics;
    console.log(`${name}: ${u.elements.length} elements · ${m.questions} decisions · ${m.wallMs} ms${u.cached ? ' (cached; first read shown)' : ''} · $${m.costUsd?.toFixed(4)} · ${acted.length} acted on · main ${mp.id} ${mp.p}`);
    if (opt.kit) {
      // Only the row ids go in: the kit never sees Jev's verdicts or probabilities.
      kitShots[name] = await captureKitPage(page, { name, url, ids: rowIds, kitDir: path.join(outDir, 'label-kit') }).catch((err) => {
        console.log(`  ${name}: no kit pictures (${String(err?.message ?? err).split('\n')[0]})`);
        return null;
      });
    }
    await page.close().catch(() => {});
  }
} finally {
  await context.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
}
const blindRows = shuffle(labelRows);
writeFileSync(path.join(outDir, 'to-label.csv'), toCsv([BLIND_HEAD, ...blindRows]));
writeFileSync(path.join(outDir, 'jev.csv'), toCsv([['page', 'id', 'verdict', 'role', 'roleP', 'foldP', 'help', 'task', 'main'], ...jevRows]));
// The labeller fills "main action (label or none)" in pages-blind.csv without seeing pages-jev.csv.
writeFileSync(path.join(outDir, 'pages-blind.csv'), toCsv([PAGES_HEAD, ...pageRows.map((r) => r.slice(0, 3))]));
writeFileSync(path.join(outDir, 'pages-jev.csv'), toCsv([['page', 'url', '', 'jev_main', 'jev_main_p'], ...pageRows]));
console.log(`\n${pageRows.length} pages · ${labelRows.length} rows to label → ${path.join(outDir, 'to-label.csv')}`);
if (opt.kit) {
  const shots = Object.fromEntries(Object.entries(kitShots).filter(([, v]) => v));
  console.log(`label kit (${Object.keys(shots).length} pages with pictures) → ${writeKit(outDir, { rows: blindRows, pages: pageRows.map((r) => r.slice(0, 3)), shots })}`);
}
