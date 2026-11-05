#!/usr/bin/env node
// The label kit: pictures and one labelling page (label.html) for the blind sheets export-decisions.mjs writes, so a
// person labels from the screen instead of from page coordinates in a CSV.
//
//   node scripts/claims/export-decisions.mjs --urls <file> --out <dir> --kit     captures while each page is open
//   node scripts/claims/label-kit.mjs --in <dir>                                 rebuilds <dir>/label-kit/label.html
//
// After Jev's read, WebAble is switched to "show original" (every change undone, page zoom back to 100%, its own UI
// hidden), so the pictures show the page as the site intends. Rects: the export's "where (page px)" column is
// getBoundingClientRect() + scroll, so page coordinates, but measured on the fitted page (zoomed, folded, overlays
// tucked away). The kit measures again on the original page:
//   - crops: each element is scrolled into view and measured in viewport coordinates right before its shot, so scroll,
//     sticky headers and lazy loading can't shift the box;
//   - the page map and the main-action hotspots: measured at scroll 0 as rect + scroll (fixed elements where they sit
//     at the top), the same frame as the full-page screenshot.
// The site's own popups stay, with two exceptions the labeller is told about: a popup covering an element is moved
// aside for that element's crop only, and the full-page shot leaves out what floats over the page.
// Writes <dir>/label-kit/ (label.html + images/) and <dir>/kit-data.json. The kit holds no Jev answers: it is built
// from to-label.csv, pages-blind.csv and what each page itself shows. Hand the labeller the label-kit folder only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readCsv, sleep } from './lib.mjs';

export const BLIND_HEAD = ['page', 'url', 'id', 'tag', 'label', 'position', 'where (page px)', 'ad_promo_teaser_or_popup (y/n)', 'help_or_contact (y/n)', 'needed_for_the_main_task (y/n)'];
export const PAGES_HEAD = ['page', 'url', 'main action (label, or none)'];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, 'label-kit.template.html');
const VW = 1280;
const VH = 720;
const MAX_PAGE_H = 16000; // full-page screenshots stop here (Chrome captures up to about 16k px)

/* ------------------------------------------------------------------ */
/* Capture (runs while export-decisions.mjs has the page open)          */
/* ------------------------------------------------------------------ */

/** Scripts for the extension's isolated world (where __webableEngine lives). Every one returns null without it. */
const PRELUDE = `
const e = globalThis.__webableEngine;
if (!e) return null;
const VW = ${VW}, VH = ${VH};
const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
const shown = (x) => {
  if (!x || !x.isConnected || x.closest('webable-ui')) return false;
  const r = x.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  return x.checkVisibility ? x.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
};
const inView = (r) => r.right > 4 && r.left < VW - 4 && r.bottom > 4 && r.top < VH - 4;
const up = (x, ok) => { for (let a = x && x.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) if (ok(a)) return a; return null; };
// The element to outline: itself when it shows, else the nearest ancestor that does (a closed menu, a hidden slide).
const pick = (id) => {
  const el = e.elementFor(id);
  if (!el) return { el: null, target: null, status: 'gone' };
  if (shown(el)) return { el, target: el, status: 'ok' };
  return { el, target: up(el, shown), status: 'hidden' };
};
const box = (r, dx = 0, dy = 0) => [Math.round(r.left + dx), Math.round(r.top + dy), Math.round(r.width), Math.round(r.height)];
`;

const run = (body) => `(() => { ${PRELUDE}\n${body}\n})()`;

/** One CDP session per page, evaluating in every isolated world until one answers (only WebAble's has the engine). */
async function engineWorld(page) {
  const cdp = await page.context().newCDPSession(page);
  const ctxs = new Map();
  cdp.on('Runtime.executionContextCreated', (ev) => ctxs.set(ev.context.id, ev.context));
  cdp.on('Runtime.executionContextDestroyed', (ev) => ctxs.delete(ev.executionContextId));
  cdp.on('Runtime.executionContextsCleared', () => ctxs.clear());
  await cdp.send('Runtime.enable');
  return {
    async eval(body, arg) {
      const expression = run(`const ARG = ${JSON.stringify(arg ?? null)};\n${body}`);
      for (const c of [...ctxs.values()].filter((x) => x.auxData?.type === 'isolated')) {
        const r = await cdp.send('Runtime.evaluate', { contextId: c.id, returnByValue: true, awaitPromise: true, expression }).catch(() => null);
        if (r?.result?.value) return r.result.value;
      }
      return null;
    },
    async close() {
      await cdp.send('Runtime.disable').catch(() => {});
      await cdp.detach().catch(() => {});
    },
  };
}

/** WebAble's own marks on the page: data-wa-* attributes and constructed sheets. Zero after "show original". */
const MARKS = `
const names = new Set();
let n = 0;
for (const el of document.querySelectorAll('*')) {
  let hit = false;
  for (const a of el.getAttributeNames()) if (a.startsWith('data-wa-')) { names.add(a); hit = true; }
  if (hit) n++;
}
const s = e.getState();
return { elements: n, attrs: [...names].sort(), sheets: document.adoptedStyleSheets.length, zoom: s.pageZoom, showingOriginal: s.showingOriginal };
`;

const SHOW_ORIGINAL = `
e.showOriginal(true);
return true;
`;

/** WebAble's in-page UI out of the pictures. Its layer is a popover in the top layer, so hiding the host isn't enough. */
const HIDE_UI = `
let n = 0;
for (const ui of document.querySelectorAll('webable-ui')) {
  ui.style.setProperty('visibility', 'hidden', 'important');
  ui.style.setProperty('display', 'none', 'important');
  let root = null;
  try { root = (globalThis.chrome && chrome.dom && chrome.dom.openOrClosedShadowRoot) ? chrome.dom.openOrClosedShadowRoot(ui) : ui.shadowRoot; } catch {}
  for (const c of (root ? root.children : [])) {
    try { if (c.matches(':popover-open')) c.hidePopover(); } catch {}
    if (c.style) { c.style.setProperty('display', 'none', 'important'); c.style.setProperty('visibility', 'hidden', 'important'); }
  }
  n++;
}
return { ui: n };
`;

/**
 * Some sites lock scrolling under a popup (CNN's consent wall sets body { height: 100vh; overflow: hidden }), which
 * clips the full-page shot to the first screen. Unlock it for the capture. The popup itself stays: FLOATING leaves it
 * out of the page shot only, and RING moves it aside only for crops it covers.
 */
const UNLOCK_SCROLL = `
const se = document.scrollingElement || document.documentElement;
const b = document.body;
if (!b) return { unlocked: false };
const tall = Math.max(b.scrollHeight, ...[...b.children].map((c) => c.getBoundingClientRect().bottom + scrollY));
if (se.scrollHeight > innerHeight + 8 || tall <= innerHeight + 100) return { unlocked: false };
const set = (el, k, v) => el.style.setProperty(k, v, 'important');
set(document.documentElement, 'overflow-y', 'auto'); set(document.documentElement, 'height', 'auto');
set(b, 'overflow-y', 'visible'); set(b, 'height', 'auto'); set(b, 'max-height', 'none');
if (getComputedStyle(b).position === 'fixed') { set(b, 'position', 'static'); set(b, 'top', 'auto'); }
return { unlocked: se.scrollHeight > innerHeight + 8 };
`;

/**
 * Popups and backdrops out of the way, without touching layout: opacity 0 (children can't undo it the way they can
 * undo visibility), no hits, and no ::backdrop for a modal <dialog>. restoreHidden puts every one back.
 */
const FIXED_ROOT = `
// The outermost layer an element sits in above the page: fixed or sticky boxes, and absolute ones stacked very high
// (Qualtrics' backdrop is position: absolute at z-index 2000000004).
const highLayer = (cs) => cs.position === 'absolute' && parseInt(cs.zIndex, 10) >= 1000;
const fixedRoot = (x) => {
  let root = null;
  for (let a = x; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.position === 'fixed' || cs.position === 'sticky' || highLayer(cs)) root = a;
  }
  if (!root && x && x.matches && x.matches(':modal, :popover-open')) root = x;
  const text = (document.body && document.body.innerText || '').length;
  if (root && text > 200 && (root.innerText || '').length > 0.5 * text) return null; // the page's own shell
  return root;
};
// A fixed wrapper can be 0 x 0 with its popup overflowing it (Medicare's sign-up modal): size it by its contents.
const effRect = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width >= 2 && r.height >= 2) return r;
  try { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); } catch { return r; }
};
const HIDE_ATTR = 'data-labelkit-hide';
const hideFor = (el) => {
  if (!globalThis.__waKitSheet) {
    try {
      const sh = new CSSStyleSheet();
      sh.replaceSync('[' + HIDE_ATTR + '] { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; } [' + HIDE_ATTR + ']::backdrop { display: none !important; }');
      globalThis.__waKitSheet = sh;
    } catch {}
  }
  if (globalThis.__waKitSheet && !document.adoptedStyleSheets.includes(globalThis.__waKitSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, globalThis.__waKitSheet];
  if (!globalThis.__waKitHidden) globalThis.__waKitHidden = [];
  globalThis.__waKitHidden.push(el);
  el.setAttribute(HIDE_ATTR, '');
};
const isHidden = (x) => (globalThis.__waKitHidden || []).some((h) => h.contains(x));
const restoreHidden = () => {
  for (const el of (globalThis.__waKitHidden || [])) el.removeAttribute(HIDE_ATTR);
  globalThis.__waKitHidden = [];
};
`;

/**
 * For the full-page shot only: leave out everything that floats over the page (popups, backdrops, cookie bars, chat
 * buttons). A full-page shot draws them where they sit at scroll 0, on top of content that is really below them.
 * Kept: a fixed header at the top, and a fixed shell that holds the page itself.
 */
const FLOATING = `${FIXED_ROOT}
const bodyText = (document.body && document.body.innerText || '').length;
const gone = [];
let hidden = 0;
for (const el of (document.body ? document.body.querySelectorAll('*') : [])) {
  if (gone.some((g) => g.contains(el)) || el.closest('webable-ui') || el.id === 'wa-kit-ring') continue;
  const cs = getComputedStyle(el);
  if ((cs.position !== 'fixed' && !highLayer(cs)) || cs.display === 'none' || cs.visibility === 'hidden') continue;
  const b = effRect(el);
  if (b.width < 2 || b.height < 2) continue;
  const area = Math.max(0, Math.min(VW, b.right) - Math.max(0, b.left)) * Math.max(0, Math.min(VH, b.bottom) - Math.max(0, b.top));
  if (cs.position !== 'fixed' && area < 0.25 * VW * VH) continue; // a high absolute layer counts only as a backdrop
  if (b.top <= 2 && b.height < VH * 0.35 && area < 0.25 * VW * VH) continue; // a pinned header
  if (bodyText > 200 && (el.innerText || '').length > 0.5 * bodyText) continue; // the page's own shell
  hideFor(el);
  gone.push(el);
  hidden++;
}
return { hidden };
`;

const RESTORE_POPUPS = `${FIXED_ROOT}
restoreHidden();
return true;
`;

/** At scroll 0: page title and size, and each row element's page rect (rect + scroll; fixed ones as at the top). */
const MEASURE_ROWS = `
const sx = scrollX, sy = scrollY;
const docH = (document.scrollingElement || document.documentElement).scrollHeight;
const rects = {};
for (const id of ARG.ids) {
  const p = pick(id);
  rects[id] = p.target ? { status: p.status, rect: box(p.target.getBoundingClientRect(), sx, sy) } : { status: p.status, rect: null };
}
return { title: clean(document.title).slice(0, 160), docH, rects };
`;

/** At scroll 0: every visible button, link and field, for the main-action question's hotspots. */
const MEASURE_HOTSPOTS = `
const sx = scrollX, sy = scrollY;
// Digest labels for the hotspots, so a click fills in exactly the words the score compares.
const labelOf = new Map();
for (const d of (e.getState().digest?.elements || [])) { const el = e.elementFor(d.id); if (el && d.label) labelOf.set(el, d.label); }
const same = (a, b) => Math.abs(a.left - b.left) < 3 && Math.abs(a.top - b.top) < 3 && Math.abs(a.width - b.width) < 3 && Math.abs(a.height - b.height) < 3;
const own = (el) => clean(el.getAttribute('aria-label')) || clean(el.innerText).slice(0, 100) || clean(el.value) || clean(el.getAttribute('title'))
  || clean(el.getAttribute('placeholder')) || clean(el.querySelector && el.querySelector('img[alt]')?.alt);
const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=search]';
const hotspots = [];
const seen = new Set();
for (const el of document.querySelectorAll(SEL)) {
  if (hotspots.length >= 600 || !shown(el)) continue;
  const r = el.getBoundingClientRect();
  const x = r.left + sx, y = r.top + sy;
  if (x + r.width < 0 || x > VW || y + r.height < 0 || y > ${MAX_PAGE_H}) continue;
  let label = labelOf.get(el);
  if (!label) for (const [d, l] of labelOf) if ((d.contains(el) || el.contains(d)) && same(d.getBoundingClientRect(), r)) { label = l; break; }
  label = clean(label || own(el)).slice(0, 140);
  if (!label) continue;
  const key = label + '|' + Math.round(x / 4) + '|' + Math.round(y / 4);
  if (seen.has(key)) continue;
  seen.add(key);
  hotspots.push([...box(r, sx, sy), label]);
}
return { hotspots };
`;

/** Scroll the row's element into view (inner scrollers too). Returns what it is and what it says. */
const FOCUS = `
const p = pick(ARG.id);
const out = { status: p.status };
if (p.el) {
  const el = p.el;
  const tag = el.tagName.toLowerCase();
  let text = clean(el.innerText) || clean(el.textContent);
  const more = [];
  for (const a of ['aria-label', 'title', 'alt', 'placeholder']) { const v = clean(el.getAttribute(a)); if (v && !text.includes(v)) more.push(v); }
  const img = el.querySelector && el.querySelector('img[alt]');
  if (img && clean(img.alt) && !text.includes(clean(img.alt))) more.push('picture: ' + clean(img.alt));
  if (tag === 'input' && /^(submit|button|reset)$/i.test(el.type || '') && el.value) more.push(clean(el.value));
  const link = el.closest('a[href]');
  let href = '';
  try { if (link) { const u = new URL(link.href, location.href); href = (u.host === location.host ? '' : u.host) + u.pathname; } } catch {}
  Object.assign(out, { tag, role: clean(el.getAttribute('role')), type: tag === 'input' ? clean(el.type) : '', text: text.slice(0, 320),
    more: more.join(' · ').slice(0, 200), href: href.slice(0, 90) });
}
if (p.target) {
  const r = p.target.getBoundingClientRect();
  const tall = r.height > VH * 0.85;
  // A popup or pinned bar (a fixed box that fits on screen, not a scroll lock on body or a fixed page shell): picture
  // it over the first screen, where a visitor meets it.
  let pinned = false;
  for (let a = p.target; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    if (getComputedStyle(a).position !== 'fixed') continue;
    const fr = a.getBoundingClientRect();
    pinned = fr.height <= VH + 2 && fr.width <= VW + 2;
    break;
  }
  if (pinned) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  else try { p.target.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'center', behavior: 'instant' }); } catch { p.target.scrollIntoView(); }
}
return out;
`;

/**
 * Measure again (viewport coordinates), move popups that cover the element out of the way for this one picture
 * (UNRING puts them back), choose the crop and draw the red ring above everything, top layer included.
 */
const RING = `${FIXED_ROOT}
document.getElementById('wa-kit-ring')?.remove();
restoreHidden();
const p = pick(ARG.id);
let t = p.target, status = p.status;
if (!t) return { status, crop: null };
let r = t.getBoundingClientRect();
if (!inView(r)) {
  const a = up(t, (x) => shown(x) && inView(x.getBoundingClientRect()));
  if (!a) return { status: 'offscreen', crop: null };
  t = a; status = status === 'ok' ? 'offscreen' : status; r = t.getBoundingClientRect();
}
const vx0 = Math.max(0, r.left), vy0 = Math.max(0, r.top), vx1 = Math.min(VW, r.right), vy1 = Math.min(VH, r.bottom);
let moved = 0;
for (let round = 0; round < 4; round++) {
  let hit = null;
  for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]]) {
    const top = document.elementFromPoint(vx0 + (vx1 - vx0) * fx, vy0 + (vy1 - vy0) * fy);
    if (!top || t.contains(top) || top.contains(t) || top.closest('webable-ui') || isHidden(top)) continue;
    const root = fixedRoot(top);
    if (root && !root.contains(t) && !t.contains(root)) { hit = root; break; }
  }
  if (!hit) break;
  hideFor(hit);
  moved++;
}
const m = Math.round(Math.min(220, Math.max(90, 0.5 * Math.max(vx1 - vx0, vy1 - vy0))));
let x0 = vx0 - m, y0 = vy0 - m, x1 = vx1 + m, y1 = vy1 + m;
const grow = (a, b, min) => { if (b - a >= min) return [a, b]; const c = (a + b) / 2; return [c - min / 2, c + min / 2]; };
[x0, x1] = grow(x0, x1, 640);
[y0, y1] = grow(y0, y1, 360);
const fit = (a, b, max) => { if (b - a >= max) return [0, max]; if (a < 0) return [0, b - a]; if (b > max) return [a - (b - max), max]; return [a, b]; };
[x0, x1] = fit(x0, x1, VW);
[y0, y1] = fit(y0, y1, VH);
const ring = document.createElement('div');
ring.id = 'wa-kit-ring';
const dashed = status !== 'ok';
ring.style.cssText = 'all: initial; position: fixed; box-sizing: border-box; pointer-events: none; z-index: 2147483647; margin: 0; padding: 0; overflow: visible; '
  + 'left: ' + (r.left - 4) + 'px; top: ' + (r.top - 4) + 'px; width: ' + (r.width + 8) + 'px; height: ' + (r.height + 8) + 'px; '
  + 'border: 4px ' + (dashed ? 'dashed' : 'solid') + ' #ff1a1a; border-radius: 3px; background: transparent; '
  + 'box-shadow: 0 0 0 2px #ffffff, 0 0 0 9999px rgba(0, 0, 0, 0.16);';
try { ring.setAttribute('popover', 'manual'); document.documentElement.appendChild(ring); ring.showPopover(); }
catch { ring.removeAttribute('popover'); document.documentElement.appendChild(ring); }
return { status, crop: { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) }, cut: r.bottom > VH + 4, moved };
`;

const UNRING = `${FIXED_ROOT}
document.getElementById('wa-kit-ring')?.remove();
restoreHidden();
return true;
`;

/** Scroll the whole page once so lazy images and late sections load, then go back to the top. */
async function warmScroll(page) {
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)).catch(() => 0);
  for (let y = 0; y < Math.min(h, MAX_PAGE_H); y += 600) {
    await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y).catch(() => {});
    await sleep(110);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })).catch(() => {});
  await sleep(1200);
}

/** A small JPEG of the full-page shot, scaled in a blank page's canvas (no image library needed). */
async function thumbnail(context, jpeg, width) {
  const helper = await context.newPage();
  try {
    const b64 = await helper.evaluate(async ({ src, w }) => {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${src}`;
      await img.decode();
      const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.82).split(',')[1];
    }, { src: jpeg.toString('base64'), w: width });
    return Buffer.from(b64, 'base64');
  } finally {
    await helper.close().catch(() => {});
  }
}

/**
 * Capture one open page for the kit: show the original page, a full-page shot and thumbnail, the hotspots for the
 * main-action question, and a ringed crop per row element. Writes images under <kitDir>/images/<name>/ and returns
 * the page's entry for kit-data.json. Leaves WebAble showing the original page (the caller closes the page next).
 */
export async function captureKitPage(page, { name, url, ids, kitDir, log = console.log }) {
  const imgRel = `images/${name}`;
  const imgDir = path.join(kitDir, imgRel);
  mkdirSync(imgDir, { recursive: true });
  const world = await engineWorld(page);
  const t0 = Date.now();
  try {
    await sleep(1500); // let changes still in flight land, so "show original" undoes them too
    const before = await world.eval(MARKS);
    if (!(await world.eval(SHOW_ORIGINAL))) throw new Error('WebAble engine not reachable');
    const until = Date.now() + 10000;
    let after = null;
    while (Date.now() < until) {
      after = await world.eval(MARKS);
      const dpr = await page.evaluate(() => window.devicePixelRatio).catch(() => 0);
      if (after?.zoom === 1 && dpr === 1 && after.elements === 0) break;
      await sleep(400);
    }
    await sleep(1000);
    after = await world.eval(MARKS);
    const dpr = await page.evaluate(() => window.devicePixelRatio).catch(() => 0);
    const clean = after && after.elements === 0 && after.zoom === 1 && dpr === 1;
    if (!clean) log(`  ${name}: original page not fully restored (zoom ${after?.zoom}, dpr ${dpr}, ${after?.elements} marked elements: ${after?.attrs?.join(' ')})`);
    const ui = await world.eval(HIDE_UI);

    const lock = (await world.eval(UNLOCK_SCROLL)) ?? {};
    await warmScroll(page);
    const m = (await world.eval(MEASURE_ROWS, { ids })) ?? { title: '', docH: VH, rects: {} };
    // The page picture (for the main-action question and the map) without what floats over it.
    const big = (await world.eval(FLOATING)) ?? { hidden: 0 };
    await sleep(300);
    const hs = (await world.eval(MEASURE_HOTSPOTS)) ?? { hotspots: [] };
    const shotH = Math.max(VH, Math.min(m.docH || VH, MAX_PAGE_H));
    const full = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 72, clip: { x: 0, y: 0, width: VW, height: shotH }, timeout: 90000 });
    writeFileSync(path.join(imgDir, 'page.jpg'), full);
    writeFileSync(path.join(imgDir, 'thumb.jpg'), await thumbnail(page.context(), full, 320));
    await world.eval(RESTORE_POPUPS);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })).catch(() => {});

    const els = {};
    let crops = 0;
    for (const id of ids) {
      const entry = { status: 'gone', pageRect: m.rects[id]?.rect ?? null, crop: null };
      try {
        const f = await world.eval(FOCUS, { id });
        if (f) Object.assign(entry, f);
        if (f && f.status !== 'gone') {
          await sleep(350);
          const ring = await world.eval(RING, { id });
          if (ring?.crop && ring.crop.width > 8 && ring.crop.height > 8) {
            const file = `${id}.jpg`;
            writeFileSync(path.join(imgDir, file), await page.screenshot({ clip: ring.crop, type: 'jpeg', quality: 84, timeout: 30000 }));
            Object.assign(entry, { status: ring.status, crop: `${imgRel}/${file}`, cropW: ring.crop.width, cropH: ring.crop.height, cut: !!ring.cut, moved: ring.moved || 0 });
            crops++;
          } else if (ring) entry.status = ring.status;
          await world.eval(UNRING);
        }
      } catch (err) {
        entry.status = entry.status === 'gone' ? 'gone' : 'error';
        log(`  ${name} ${id}: crop failed (${String(err?.message ?? err).split('\n')[0]})`);
        await world.eval(UNRING).catch(() => {});
      }
      delete entry.tall;
      els[id] = entry;
    }
    const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
    const moved = Object.values(els).filter((x) => x.moved).length;
    log(`  ${name}: kit ${crops}/${ids.length} crops (${moved} with a covering popup moved) · ${hs.hotspots.length} hotspots · page ${shotH}px${m.docH > MAX_PAGE_H ? ` of ${m.docH}` : ''}${lock.unlocked ? ' · scroll unlocked' : ''}${big.hidden ? ` · ${big.hidden} floating box(es) left out of the page shot` : ''} · WebAble marks ${before?.elements ?? '?'} → ${after?.elements ?? '?'}, UI hidden ${ui?.ui ?? 0} · ${Math.round((Date.now() - t0) / 1000)} s`);
    return { page: name, url, host, title: m.title, restored: !!clean, unlocked: !!lock.unlocked, popupsHidden: big.hidden, img: { page: `${imgRel}/page.jpg`, thumb: `${imgRel}/thumb.jpg`, w: VW, h: shotH }, docH: m.docH, hotspots: hs.hotspots, els };
  } finally {
    await world.close();
  }
}

/* ------------------------------------------------------------------ */
/* The labelling page                                                   */
/* ------------------------------------------------------------------ */

const sameHead = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Write <outDir>/kit-data.json and <outDir>/label-kit/label.html. `rows` are the blind sheet's rows in sheet order
 * (BLIND_HEAD columns), `pages` the page sheet's rows (PAGES_HEAD columns), `shots` the captureKitPage entries by page.
 */
export function writeKit(outDir, { rows, pages, shots }) {
  for (const r of rows) if (r.length !== BLIND_HEAD.length) throw new Error('label kit: a to-label row has the wrong number of columns');
  for (const p of pages) if (p.length !== PAGES_HEAD.length) throw new Error('label kit: a pages-blind row has the wrong number of columns');
  const kitDir = path.join(outDir, 'label-kit');
  mkdirSync(kitDir, { recursive: true });
  const data = { v: 1, kit: path.basename(path.resolve(outDir)), made: new Date().toISOString(), head: BLIND_HEAD, pagesHead: PAGES_HEAD, rows, pages, shots };
  writeFileSync(path.join(outDir, 'kit-data.json'), JSON.stringify({ ...data, rows: undefined, pages: undefined }, null, 1));
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  const html = readFileSync(TEMPLATE, 'utf8').replace('/*__KIT_DATA__*/null', () => json);
  writeFileSync(path.join(kitDir, 'label.html'), html);
  return path.join(kitDir, 'label.html');
}

/** Rebuild label.html from an export dir: the blind sheets plus kit-data.json (never jev.csv or pages-jev.csv). */
function rebuild(dir) {
  const toLabel = path.join(dir, 'to-label.csv');
  const pagesBlind = path.join(dir, 'pages-blind.csv');
  const kitData = path.join(dir, 'kit-data.json');
  for (const f of [toLabel, pagesBlind, kitData]) if (!existsSync(f)) throw new Error(`missing ${f}`);
  const headOf = (f) => Object.keys(readCsv(f)[0] ?? {});
  if (!sameHead(headOf(toLabel), BLIND_HEAD)) throw new Error(`${toLabel} is not the blind sheet (unexpected columns)`);
  if (!sameHead(headOf(pagesBlind), PAGES_HEAD)) throw new Error(`${pagesBlind} is not the blind page sheet (unexpected columns)`);
  const rows = readCsv(toLabel).map((o) => BLIND_HEAD.map((h) => o[h] ?? ''));
  const pages = readCsv(pagesBlind).map((o) => PAGES_HEAD.map((h) => o[h] ?? ''));
  const { shots } = JSON.parse(readFileSync(kitData, 'utf8'));
  return writeKit(dir, { rows, pages, shots });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { in: { type: 'string' } } });
  if (!values.in) {
    console.error('usage: node scripts/claims/label-kit.mjs --in <export dir made with export-decisions.mjs --kit>');
    process.exit(2);
  }
  console.log(`wrote ${rebuild(path.resolve(values.in))}`);
}
