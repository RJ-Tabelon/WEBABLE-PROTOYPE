// Reach WebAble's in-page UI from Playwright. The UI lives in a closed shadow root under <webable-ui>, which page
// scripts cannot open; the DevTools protocol can (DOM.describeNode with pierce). Functions passed to uiCall run in
// the page with (roots, arg) where roots are every shadow root under the host. Clicks are real (trusted) mouse
// events at measured rectangles, so the UI sees them exactly as a person's.
import { sleep } from './common.mjs';

const HOST = 'webable-ui';

function collectRoots(node, out) {
  for (const s of node.shadowRoots ?? []) {
    out.push(s.backendNodeId);
    collectRoots(s, out);
  }
  for (const c of node.children ?? []) collectRoots(c, out);
  if (node.contentDocument) collectRoots(node.contentDocument, out);
}

/** Run `fnSrc` (a function source string `(roots, arg) => ...`) against WebAble's shadow roots. */
export async function uiCall(page, fnSrc, arg) {
  let cdp;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch (e) {
    return { error: `cdp: ${e instanceof Error ? e.message : e}` };
  }
  try {
    const ev = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(HOST)})` });
    const hostId = ev.result?.objectId;
    const ids = [];
    if (hostId) {
      const { node } = await cdp.send('DOM.describeNode', { objectId: hostId, depth: -1, pierce: true });
      collectRoots(node, ids);
    }
    const objs = [];
    for (const b of ids) {
      const r = await cdp.send('DOM.resolveNode', { backendNodeId: b }).catch(() => null);
      if (r?.object?.objectId) objs.push(r.object.objectId);
    }
    // Call on the host (or the document) so `this` is a page object; the roots come in as arguments.
    let target = hostId ?? objs[0];
    if (!target) {
      const d = await cdp.send('Runtime.evaluate', { expression: 'document' });
      target = d.result?.objectId;
    }
    const r = await cdp.send('Runtime.callFunctionOn', {
      objectId: target,
      functionDeclaration: `function(arg, ...roots){ return (${fnSrc})(roots, arg); }`,
      arguments: [{ value: arg ?? null }, ...objs.map((objectId) => ({ objectId }))],
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text };
    return r.result?.value ?? null;
  } catch (e) {
    return { error: (e instanceof Error ? e.message : String(e)).split('\n')[0] };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/* ------------------------------------------------------------------ in-page helpers, as source strings */

// Shared prelude for the probe functions below (kept as a string so it runs in the page).
const PRELUDE = `
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const shown = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    return true;
  };
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const all = (sel) => { const out = []; for (const r of roots) for (const el of r.querySelectorAll(sel)) out.push(el); return out; };
  const label = (el) => norm(el.getAttribute('aria-label') || el.innerText || el.textContent).slice(0, 120);
`;

/** Find the first shown element matching a selector list and (optionally) a text/regex. Returns its rect. */
export const FIND_SRC = `(roots, q) => {
  ${PRELUDE}
  const re = q.re ? new RegExp(q.re, 'i') : null;
  for (const sel of [].concat(q.sel)) {
    for (const el of all(sel)) {
      if (!shown(el)) continue;
      const t = label(el) + ' ' + norm(el.textContent);
      if (q.text && !t.toLowerCase().includes(q.text.toLowerCase())) continue;
      if (re && !re.test(t)) continue;
      if (q.enabled && el.disabled) continue;
      return { ...rect(el), text: label(el), disabled: !!el.disabled, sel };
    }
  }
  return null;
}`;

/** Everything the eval wants to know about WebAble's UI right now. */
export const PROBE_SRC = `(roots, arg) => {
  ${PRELUDE}
  const vw = innerWidth, vh = innerHeight;
  const first = (sels) => { for (const s of sels) for (const el of all(s)) if (shown(el) && !el.closest('.wa-calm')) return el; return null; };
  // The Calm view uses .wa-panel for its own cards, so the WebAble panel is only looked for outside it.
  const panelEl = first(['.wa-panel', '[data-wa-panel]', '[role="region"][aria-label="WebAble"]', '[role="dialog"][aria-label^="WebAble"]']);
  let lensEl = first(['[aria-label^="Jev Lens"]', '.wa-lhead', '[class*="lens-head"]', '[class*="lenshead"]', '[data-wa-lens]']);
  if (!lensEl) {
    for (const el of all('header, [role="toolbar"], [role="region"], div')) {
      if (!shown(el) || el.closest('.wa-panel')) continue;
      const b = el.getBoundingClientRect();
      if (b.height > 140) continue;
      if (/^\\W*Jev Lens/.test(norm(el.innerText || el.textContent))) { lensEl = el; break; }
    }
  }
  let calmEl = null;
  for (const s of ['.wa-calm', '[aria-label="Calm view"][role="dialog"]', '[data-wa-calm]']) { calmEl = all(s).find(shown) ?? null; if (calmEl) break; }
  const pillEl = first(['.wa-pill', '[data-wa-pill]']);
  const chipSels = ['.wa-lchip', '[data-lens-chip]', '.wa-lens-chip', '[class*="lchip"]', '[class*="lens-chip"]'];
  const seen = new Set();
  const chips = [];
  for (const s of chipSels) for (const el of all(s)) {
    if (seen.has(el) || !shown(el)) continue;
    // a chip nested in a chip (its label part) is the same chip
    if ([...seen].some((p) => p.contains(el) || el.contains(p))) continue;
    seen.add(el);
    const r = rect(el);
    if (r.y + r.h < 0 || r.y > vh || r.x + r.w < 0 || r.x > vw) continue;
    chips.push({ ...r, t: label(el).slice(0, 60) });
  }
  // Floating pieces of WebAble's own UI: the pill, overlay and AI chips, toasts, offers, the consent bar. Known
  // classes first, then anything else small and position: fixed in our roots (a stack item a later build added).
  const floatSels = ['.wa-pill', '.wa-floatchip', '.wa-offer-chip', '.wa-offer', '.wa-toast', '.wa-ochip', '[class*="overlay-chip"]', '[class*="aichip"]', '[class*="ai-chip"]', '.wa-cbar', '[class*="consent-bar"]', '.wa-ex-pill', '[data-wa-float]'];
  const notFloat = '.wa-calm, .wa-panel, .wa-lens, .wa-lcard, .wa-ex, [aria-label^="Jev Lens"], [role="dialog"]';
  const fseen = new Set();
  const floats = [];
  const addFloat = (el, cls) => {
    if (fseen.has(el) || !shown(el)) return;
    if ([...fseen].some((p) => p.contains(el) || el.contains(p))) return;
    fseen.add(el);
    floats.push({ ...rect(el), cls, t: label(el).slice(0, 60) });
  };
  for (const s of floatSels) for (const el of all(s)) if (!el.closest(notFloat) || el.matches('.wa-ex-pill')) addFloat(el, s);
  for (const el of all('*')) {
    if (fseen.has(el) || el.closest(notFloat) || getComputedStyle(el).position !== 'fixed' || !shown(el)) continue;
    const r = rect(el);
    if (r.w * r.h > 0.2 * vw * vh || r.w < 12 || r.h < 12) continue;
    addFloat(el, 'fixed');
  }
  const offerEl = first(['.wa-offer', '[data-wa-offer]', '.wa-offer-chip']);
  const exEl = first(['.wa-ex', '[data-wa-explain]']);
  const toastEls = all('.wa-toast, [data-wa-toast]').filter(shown);
  return {
    hasUi: roots.length > 0,
    lens: !!lensEl,
    lensHead: lensEl ? norm(lensEl.innerText || lensEl.textContent).slice(0, 300) : null,
    panel: !!panelEl,
    panelText: panelEl ? norm(panelEl.innerText || panelEl.textContent).slice(0, 2000) : null,
    calm: !!calmEl,
    pill: pillEl ? { ...rect(pillEl), t: label(pillEl) } : null,
    chips,
    floats,
    offer: offerEl ? { ...rect(offerEl), t: norm(offerEl.innerText || offerEl.textContent).slice(0, 600) } : null,
    explain: exEl ? { ...rect(exEl), t: norm(exEl.innerText || exEl.textContent).slice(0, 900), loading: !!exEl.querySelector('.wa-ex-loading, [aria-busy="true"]') } : null,
    toasts: toastEls.map((el) => norm(el.innerText || el.textContent).slice(0, 200)),
    vw, vh, dpr: devicePixelRatio,
  };
}`;

/** First-screen facts about the Calm view (all in CSS px of the page; multiply by dpr for screen px). */
export const CALM_SRC = `(roots, arg) => {
  ${PRELUDE}
  const vh = innerHeight;
  let calm = null;
  for (const s of ['.wa-calm', '[aria-label="Calm view"][role="dialog"]', '[data-wa-calm]']) { calm = all(s).find(shown) ?? null; if (calm) break; }
  if (!calm) return { open: false };
  const inCalm = (sel) => [...calm.querySelectorAll(sel)].filter(shown);
  const h1 = inCalm('h1')[0] ?? null;
  const dock = inCalm('.wa-dock, [role="region"][aria-label^="Main action"]')[0] ?? null;
  const dockTop = dock ? dock.getBoundingClientRect().top : vh;
  const strip = inCalm('.wa-strip, header')[0] ?? null;
  const isSearch = (el) => el.type === 'search' || /search/i.test((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.name || ''));
  // Visually hidden inputs (custom checkboxes) stand for their label's box.
  const box = (el) => {
    const b = el.getBoundingClientRect();
    return b.width < 4 || b.height < 4 ? el.closest('label') ?? el : el;
  };
  const fields = [...calm.querySelectorAll('input:not([type=hidden]), select, textarea, [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"]')]
    .filter((el) => !el.closest('.wa-strip, .wa-substrip, .wa-dock, header, nav, [role="search"]') && !isSearch(el))
    .map(box)
    .filter(shown);
  const want = norm(arg?.mainLabel || '').replace(/[…\\.]+$/, '').toLowerCase();
  const buttons = inCalm('button, a[href], [role="button"]').filter((el) => !el.closest('.wa-strip, header'));
  let primary = null;
  const docked = dock ? [...dock.querySelectorAll('button, a[href]')].filter(shown) : [];
  if (want) primary = docked.find((b) => label(b).toLowerCase().includes(want.slice(0, 40))) ?? buttons.find((b) => label(b).toLowerCase().includes(want.slice(0, 40))) ?? null;
  if (!primary) primary = docked[0] ?? null;
  if (!primary) primary = buttons.find((b) => /primary/.test(b.className)) ?? null;
  const task = fields[0] ?? primary ?? null;
  const lum = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return { a: 0, l: 1 };
    const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);
    const ch = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return { a: p.length > 3 ? p[3] : 1, l: 0.2126 * ch(p[0]) + 0.7152 * ch(p[1]) + 0.0722 * ch(p[2]) };
  };
  const filled = buttons.filter((b) => {
    const r = b.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= vh) return false;
    const c = lum(getComputedStyle(b).backgroundColor);
    return c.a >= 0.8 && c.l <= 0.4;
  }).map((b) => label(b).slice(0, 40));
  const stepText = (norm(calm.innerText || calm.textContent).match(/Step \\d+ of \\d+/) || [null])[0];
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  return {
    open: true,
    h1: h1 ? { top: r(h1).top, bottom: r(h1).bottom, text: label(h1).slice(0, 80) } : null,
    stripBottom: strip ? r(strip).bottom : null,
    dockTop: dock ? dockTop : null,
    dockText: dock ? norm(dock.innerText || dock.textContent).slice(0, 200) : null,
    dockButtons: dock ? [...dock.querySelectorAll('button, a[href]')].filter(shown).map((b) => ({ t: label(b).slice(0, 60), disabled: !!b.disabled || b.getAttribute('aria-disabled') === 'true' })) : [],
    task: task ? { top: r(task).top, bottom: r(task).bottom, kind: task.tagName.toLowerCase(), text: label(task).slice(0, 60), docked: !!(dock && dock.contains(task)) } : null,
    primary: primary ? { top: r(primary).top, bottom: r(primary).bottom, text: label(primary).slice(0, 60), disabled: !!primary.disabled } : null,
    filled,
    stepText,
    text: norm(calm.innerText || calm.textContent).slice(0, 3000),
    vh, dpr: devicePixelRatio,
  };
}`;

/* ------------------------------------------------------------------ actions */

export async function uiFind(page, sel, opts = {}) {
  const r = await uiCall(page, FIND_SRC, { sel, text: opts.text ?? null, re: opts.re ?? null, enabled: !!opts.enabled });
  return r && !r.error ? r : null;
}

export async function uiProbe(page) {
  const r = await uiCall(page, PROBE_SRC, null);
  return r && !r.error ? r : { hasUi: false, error: r?.error ?? 'no result', chips: [], floats: [], toasts: [] };
}

export async function calmFacts(page, mainLabel) {
  const r = await uiCall(page, CALM_SRC, { mainLabel: mainLabel ?? null });
  return r && !r.error ? r : { open: false, error: r?.error ?? null };
}

/**
 * A trusted click at the centre of a rect. Input coordinates are CSS px of the page, the same space as
 * getBoundingClientRect, even when WebAble has zoomed the tab (DevTools maps them through the zoom).
 */
export async function clickRect(page, r) {
  if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.y)) return false;
  const vp = await page.evaluate(() => ({ width: innerWidth, height: innerHeight })).catch(() => ({ width: 1280, height: 720 }));
  const x = r.x + r.w / 2;
  const y = r.y + r.h / 2;
  if (y < 0 || y > vp.height || x < 0 || x > vp.width) return false;
  await page.mouse.move(x, y, { steps: 4 });
  await sleep(60);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  return true;
}

export async function uiClick(page, sel, opts = {}) {
  const r = await uiFind(page, sel, opts);
  if (!r) return null;
  return (await clickRect(page, r)) ? r : null;
}

export async function waitUi(page, sel, opts = {}, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await uiFind(page, sel, opts);
    if (r) return { ...r, ms: Date.now() - t0 };
    await sleep(250);
  }
  return null;
}

/** Trusted key press. First moves focus off any text field (WebAble's shortcuts ignore those). */
export async function pressKey(page, combo) {
  await page.bringToFront().catch(() => {});
  await page
    .evaluate(() => {
      const a = document.activeElement;
      if (a instanceof HTMLElement && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) a.blur();
    })
    .catch(() => {});
  await page.keyboard.press(combo);
}

/** Count rectangle pairs that overlap by more than `minArea` px². */
export function overlaps(rects, minArea = 4) {
  const pairs = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w > 0 && h > 0 && w * h > minArea) pairs.push([a.t ?? a.cls ?? i, b.t ?? b.cls ?? j]);
    }
  }
  return pairs;
}
