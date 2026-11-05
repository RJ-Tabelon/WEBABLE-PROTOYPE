// First-screen checks: what a person sees before scrolling. All positions are reported in screen px at 1× (CSS px ×
// page zoom, where page zoom = devicePixelRatio ÷ the run's --dpr), so 140 px means 140 px of a DPR-1 screenshot
// and 280 px of a DPR-2 one.
import { baseDpr } from './common.mjs';
import { readingFacts, uiOverSite } from './pagefacts.mjs';
import { calmFacts, overlaps, uiProbe } from './ui.mjs';

/** Calm view first screen: the heading starts at most this far down (round-2 Calm brief §1). */
export const CALM_H1_MAX = 140;
/** Calm view: at most one filled button on the first screen. */
export const CALM_MAX_FILLED = 1;

const PAGE_SRC = (arg) => {
  const vw = innerWidth;
  const vh = innerHeight;
  // Page zoom: positions below are CSS px × this (screen px at 1×).
  const dpr = devicePixelRatio / (arg?.baseDpr || 1);
  const norm = (s) =>
    String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
  const isOurs = (el) => !!el && (el.tagName === 'WEBABLE-UI' || !!el.closest?.('webable-ui'));
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
  };
  const describe = (el) => {
    const words = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`
      .split(/[\s_-]+/)
      .filter((w) => /^[a-z]{3,}$/i.test(w))
      .slice(0, 2)
      .join(' ');
    const name = el.getAttribute('aria-label') || el.getAttribute('role') || '';
    return norm(`${el.tagName.toLowerCase()} ${words} ${name}`).slice(0, 48);
  };

  // Heading
  const h1 = [...document.querySelectorAll('h1')].find(shown) ?? null;
  const h1r = h1?.getBoundingClientRect() ?? null;

  // Main action: WebAble marks it with data-wa-main; otherwise look for the label from the ledger.
  let main = document.querySelector('[data-wa-main]');
  const want = norm(arg?.mainLabel || '')
    .replace(/[….]+$/, '')
    .toLowerCase();
  if (!main && want) {
    main =
      [...document.querySelectorAll('button, a[href], input[type=submit], input[type=button], [role=button]')].find(
        (el) =>
          shown(el) &&
          norm(el.textContent || el.value || el.getAttribute('aria-label'))
            .toLowerCase()
            .includes(want.slice(0, 40)),
      ) ?? null;
  }
  let mainInfo = null;
  if (main) {
    const r = main.getBoundingClientRect();
    const inView = r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw;
    let coveredBy = null;
    if (inView) {
      const pts = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 3, r.top + 3],
        [r.right - 3, r.bottom - 3],
      ];
      let hit = 0;
      for (const [x, y] of pts) {
        const top = document.elementFromPoint(x, y);
        if (top && (top === main || main.contains(top) || top.contains(main))) hit++;
        else if (top && !coveredBy) coveredBy = isOurs(top) ? 'WebAble' : describe(top);
      }
      if (hit >= 2) coveredBy = null;
    }
    mainInfo = {
      label: norm(main.textContent || main.value || main.getAttribute('aria-label')).slice(0, 60),
      top: Math.round(r.top * dpr),
      bottom: Math.round(r.bottom * dpr),
      inView,
      below: r.top >= vh,
      coveredBy,
    };
  }

  // Overlay coverage: a 32×18 grid of hit tests. A point is covered when the topmost element is (inside) a
  // position:fixed box (cookie banners, chat, modals, promo bars), or WebAble's own UI.
  const cols = 32;
  const rows = 18;
  let n = 0;
  let pageCov = 0;
  let ours = 0;
  const by = new Map();
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = ((i + 0.5) * vw) / cols;
      const y = ((j + 0.5) * vh) / rows;
      n++;
      const top = document.elementFromPoint(x, y);
      if (!top) continue;
      if (isOurs(top)) {
        ours++;
        continue;
      }
      let e = top;
      let fixed = null;
      while (e && e !== document.body && e !== document.documentElement) {
        if (getComputedStyle(e).position === 'fixed') fixed = e;
        e = e.parentElement;
      }
      if (fixed) {
        pageCov++;
        const k = describe(fixed);
        by.set(k, (by.get(k) ?? 0) + 1);
      }
    }
  }
  const top3 = [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => ({ what: k, pct: Math.round((100 * v) / n) }));

  // Page controls under a rectangle (the WebAble pill), if one is given.
  let under = [];
  if (arg?.pill) {
    const p = arg.pill;
    under = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], label')]
      .filter((el) => !isOurs(el) && shown(el))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const w = Math.min(r.right, p.x + p.w) - Math.max(r.left, p.x);
        const h = Math.min(r.bottom, p.y + p.h) - Math.max(r.top, p.y);
        return w > 4 && h > 4;
      })
      .map((el) => norm(el.textContent || el.getAttribute('aria-label') || el.value).slice(0, 40) || el.tagName.toLowerCase())
      .slice(0, 4);
  }

  return {
    vw,
    vh,
    dpr: devicePixelRatio,
    zoom: Math.round(dpr * 100) / 100,
    scrollY: Math.round(scrollY),
    h1: h1r ? { top: Math.round(h1r.top * dpr), text: norm(h1.textContent).slice(0, 80) } : null,
    main: mainInfo,
    overlayPct: Math.round((100 * pageCov) / n),
    overlayBy: top3,
    webablePct: Math.round((100 * ours) / n),
    pillOver: under,
    hScroll: document.documentElement.scrollWidth > vw + 2,
  };
};

/** The main action's label from the ledger ("Outlined “Confirm refill”, the main action (0.93)"). */
export function mainLabelFrom(report) {
  for (const e of report?.ledger ?? []) {
    const m = /“([^”]+)”[^“]*main action/i.exec(String(e?.title ?? ''));
    if (m) return m[1].replace(/…$/, '').trim();
  }
  return null;
}

/**
 * Page-level facts plus WebAble UI facts for the current view. `kind`: before | after | task | lens | calm.
 * before, after and task also get reading facts (zoom, body and heading sizes, column, overflow, overlapping text).
 */
export async function measureView(page, kind, opts = {}) {
  const out = { kind };
  const probe = kind === 'before' ? null : await uiProbe(page);
  try {
    out.page = await page.evaluate(PAGE_SRC, { mainLabel: opts.mainLabel ?? null, pill: probe?.pill ?? null, baseDpr: baseDpr() });
  } catch (e) {
    out.error = (e instanceof Error ? e.message : String(e)).split('\n')[0];
    return out;
  }
  if (kind === 'before' || kind === 'after' || kind === 'task') out.reading = await readingFacts(page);
  if (probe) {
    const zoom = (probe.dpr || 1) / baseDpr();
    out.ui = {
      lens: probe.lens,
      panel: probe.panel,
      calm: probe.calm,
      pill: probe.pill
        ? { x: Math.round(probe.pill.x), y: Math.round(probe.pill.y), w: Math.round(probe.pill.w), h: Math.round(probe.pill.h) }
        : null,
      // Physical size of the pill: CSS px × page zoom (it should stay the same whatever the zoom).
      pillScreenH: probe.pill ? Math.round(probe.pill.h * zoom) : null,
      pillScreenW: probe.pill ? Math.round(probe.pill.w * zoom) : null,
      floatOverlaps: overlaps(probe.floats ?? [], 16).map((p) => p.join(' × ')),
      floats: (probe.floats ?? []).map((f) => f.t || f.cls).slice(0, 8),
      floatRects: (probe.floats ?? []).slice(0, 12).map((f) => ({ x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h), t: f.t || f.cls })),
      overSite: kind === 'after' || kind === 'task' ? await uiOverSite(page, probe.floats ?? []) : [],
    };
    if (kind === 'lens') {
      const chips = probe.chips ?? [];
      out.lens = {
        on: probe.lens,
        head: probe.lensHead,
        chips: chips.length,
        overlapping: overlaps(chips, 4)
          .map((p) => p.join(' × '))
          .slice(0, 12),
      };
    }
  }
  if (kind === 'calm') {
    const c = await calmFacts(page, opts.mainLabel);
    out.calm = summarizeCalm(c);
  }
  return out;
}

/** Calm facts in screen px with pass/fail against the round-2 first-screen rules. */
export function summarizeCalm(c) {
  if (!c?.open) return { open: false, error: c?.error ?? null };
  const k = (c.dpr || 1) / baseDpr();
  const px = (v) => (typeof v === 'number' ? Math.round(v * k) : null);
  const floor = c.dockTop != null ? c.dockTop : c.vh;
  const h1Top = px(c.h1?.top);
  return {
    open: true,
    h1Top,
    h1Text: c.h1?.text ?? null,
    h1Ok: h1Top != null && h1Top <= CALM_H1_MAX,
    task: c.task ? { kind: c.task.kind, text: c.task.text, top: px(c.task.top), bottom: px(c.task.bottom) } : null,
    taskOk: !!c.task && c.task.top >= 0 && c.task.bottom <= (c.task.docked ? c.vh : floor) + 1,
    primary: c.primary
      ? { text: c.primary.text, top: px(c.primary.top), bottom: px(c.primary.bottom), disabled: c.primary.disabled }
      : null,
    primaryOk: !!c.primary && c.primary.top >= 0 && c.primary.bottom <= c.vh + 1,
    dockTop: px(c.dockTop),
    dockText: c.dockText,
    dockButtons: c.dockButtons,
    filled: c.filled,
    filledOk: (c.filled?.length ?? 0) <= CALM_MAX_FILLED,
    stepText: c.stepText,
    text: c.text,
  };
}
