// Reading facts for one view, measured in the page's main world without any help from WebAble, so they hold
// WebAble to account: page zoom, body text size, heading-to-body ratios, the content column and its side margins,
// horizontal overflow, and text that overlaps other text (line boxes from Range.getClientRects()).
//
// Units: "css" is what the site's CSS says; "screen px" is CSS px × page zoom, which is what a person sees on a 1×
// display (the DPR-2 screenshots are twice that). Font sizes do not change with browser zoom, so heading-to-body
// ratios before and after compare directly.
import { baseDpr } from './common.mjs';

/** The minimum heading ramp the round-3 plan asks for, as multiples of body text. */
export const RAMP = { h1: 1.75, h2: 1.4, h3: 1.2 };

/** Line-box pairs smaller than this many CSS px² do not count as overlapping text. */
export const OVERLAP_MIN_AREA = 4;

const FACTS_SRC = (arg) => {
  const t0 = performance.now();
  const base = arg?.baseDpr || 1;
  const MAX_NODES = arg?.maxNodes || 9000;
  const de = document.documentElement;
  const body = document.body;
  const vw = de.clientWidth || innerWidth;
  const vh = innerHeight;
  const dpr = devicePixelRatio;
  const zoom = dpr / base;
  // WebAble's page column draws <body> at a CSS zoom (a narrower virtual window, with the tab's zoom raised to match):
  // text is shown at the tab's zoom × that.
  const bodyZoom = (() => {
    const z = document.body?.currentCSSZoom;
    return typeof z === 'number' && Number.isFinite(z) && z > 0 ? z : 1;
  })();
  const textZoom = zoom * bodyZoom;
  const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
  const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
  const scr = (css) => (css == null || !Number.isFinite(css) ? null : Math.round(css * zoom));
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const isOurs = (el) => !!el && (el.tagName === 'WEBABLE-UI' || !!el.closest?.('webable-ui'));
  if (!body) return { error: 'no body' };

  const csCache = new Map();
  const cs = (el) => {
    let c = csCache.get(el);
    if (!c) {
      c = getComputedStyle(el);
      csCache.set(el, c);
    }
    return c;
  };
  const describe = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const words = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`
      .split(/[\s_-]+/)
      .filter((w) => /^[a-z]{3,}$/i.test(w))
      .slice(0, 2)
      .join(' ');
    return norm(`${el.tagName.toLowerCase()} ${words}`).slice(0, 40);
  };

  // Layer: 'fixed' when the element or an ancestor is fixed or sticky (overlays and pinned bars, legitimately
  // stacked over the page); 'abs' inside an absolutely positioned box; 'flow' otherwise.
  const FLOW = { kind: 'flow', at: null };
  const layerCache = new Map();
  const layerOf = (el) => {
    if (!el || el === body || el === de || el.nodeType !== 1) return FLOW;
    let v = layerCache.get(el);
    if (v) return v;
    const parent = layerOf(el.parentElement);
    const p = cs(el).position;
    if (parent.kind === 'fixed') v = parent;
    else if (p === 'fixed' || p === 'sticky') v = { kind: 'fixed', at: el };
    else if (p === 'absolute') v = { kind: 'abs', at: el };
    else v = parent;
    layerCache.set(el, v);
    return v;
  };

  // The region where an element's content can paint: every overflow-clipping ancestor box, and its own.
  const ALL = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
  const meet = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const clipCache = new Map();
  const clipOf = (el) => {
    if (!el || el === body || el === de || el.nodeType !== 1) return ALL;
    let v = clipCache.get(el);
    if (v) return v;
    v = clipOf(el.parentElement);
    const c = cs(el);
    if (c.overflowX !== 'visible' || c.overflowY !== 'visible' || /paint|strict|content/.test(c.contain || '')) {
      const b = el.getBoundingClientRect();
      v = meet(v, { l: b.left, t: b.top, r: b.right, b: b.bottom });
    }
    clipCache.set(el, v);
    return v;
  };

  const visCache = new Map();
  const visible = (el) => {
    let v = visCache.get(el);
    if (v !== undefined) return v;
    v = typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
      : cs(el).visibility !== 'hidden' && cs(el).display !== 'none';
    visCache.set(el, v);
    return v;
  };

  const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|OPTION|TITLE|SELECT)$/;
  const nodes = [];
  let total = 0;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if (!p || SKIP_TAGS.test(p.tagName) || isOurs(p)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    total++;
    if (nodes.length < MAX_NODES) nodes.push(n);
  }

  /* ---------------------------------------------------------- body text size */
  const EXCLUDE_AREA =
    'footer, nav, aside, header, dialog, [role="contentinfo"], [role="navigation"], [role="complementary"], [role="banner"], [role="dialog"], [role="alertdialog"], [aria-modal="true"], [aria-hidden="true"], label, button, a[role="button"], figcaption, small, sup, sub';
  const EXCLUDE_WORDS = /legal|fine-?print|disclaim|cookie|consent|promo|chat|footnote|copyright|advert|sponsor|caption|credit|byline|breadcrumb|badge|meta/i;
  const excludedCache = new Map();
  const excludedByName = (el) => {
    if (!el || el === body || el.nodeType !== 1) return false;
    let v = excludedCache.get(el);
    if (v !== undefined) return v;
    const name = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
    v = EXCLUDE_WORDS.test(name) || excludedByName(el.parentElement);
    excludedCache.set(el, v);
    return v;
  };
  const blockCache = new Map();
  const blockOf = (el) => {
    let e = el;
    const chain = [];
    while (e && e !== body) {
      const hit = blockCache.get(e);
      if (hit) {
        for (const c of chain) blockCache.set(c, hit);
        return hit;
      }
      chain.push(e);
      const d = cs(e).display;
      if (d !== 'inline' && d !== 'contents') break;
      e = e.parentElement;
    }
    const b = e && e !== body ? e : body;
    for (const c of chain) blockCache.set(c, b);
    return b;
  };
  const mainEl = document.querySelector('main, [role="main"]');
  const blocks = new Map(); // block -> { chars, sizes: [[px, chars]], inMain }
  for (const n of nodes) {
    const el = n.parentElement;
    const len = norm(n.nodeValue).length;
    if (len < 1) continue;
    const blk = blockOf(el);
    let rec = blocks.get(blk);
    if (!rec) {
      rec = { chars: 0, sizes: [], el: blk };
      blocks.set(blk, rec);
    }
    rec.chars += len;
    rec.sizes.push([parseFloat(cs(el).fontSize) || 0, len, el]);
  }
  const usable = (rec) => {
    const el = rec.el;
    if (el === body) return false;
    if (layerOf(el).kind === 'fixed') return false;
    if (el.closest(EXCLUDE_AREA) || el.closest('h1,h2,h3,h4,h5,h6,[role="heading"]')) return false;
    if (excludedByName(el)) return false;
    if (!visible(el)) return false;
    const b = el.getBoundingClientRect();
    return b.width >= 40 && b.height >= 8;
  };
  const weighted = (recs) => {
    const xs = [];
    let chars = 0;
    for (const r of recs) for (const [px, len, el] of r.sizes) {
      if (px < 12 || !visible(el)) continue;
      xs.push([px, len]);
      chars += len;
    }
    if (!chars) return null;
    xs.sort((a, b) => a[0] - b[0]);
    let acc = 0;
    for (const [px, len] of xs) {
      acc += len;
      if (acc >= chars / 2) return { px, chars };
    }
    return { px: xs[xs.length - 1][0], chars };
  };
  const recs = [...blocks.values()];
  const tiers = [
    ['main · blocks ≥ 60 chars', (r) => mainEl && mainEl.contains(r.el) && r.chars >= 60 && usable(r)],
    ['page · blocks ≥ 60 chars', (r) => r.chars >= 60 && usable(r)],
    ['page · blocks ≥ 25 chars', (r) => r.chars >= 25 && usable(r)],
    ['all text', (r) => r.el !== body],
  ];
  let bodyText = null;
  let bodyBlocks = [];
  for (const [basis, pick] of tiers) {
    const chosen = recs.filter(pick);
    const w = weighted(chosen);
    if (w && (w.chars >= 120 || basis === 'all text')) {
      bodyText = { css: r1(w.px), screen: r1(w.px * textZoom), chars: w.chars, blocks: chosen.length, basis };
      bodyBlocks = chosen;
      break;
    }
  }
  // Spacing in running text: word and letter spacing (px, 'normal' = 0) and line height ÷ font size.
  const medOf = (xs) => {
    const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  const sp = bodyBlocks
    .slice()
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 60)
    .map((rec) => {
      const c = cs(rec.el);
      const f = parseFloat(c.fontSize) || 16;
      const lh = parseFloat(c.lineHeight);
      return { word: parseFloat(c.wordSpacing) || 0, letter: parseFloat(c.letterSpacing) || 0, lh: Number.isFinite(lh) ? lh / f : null, em: f };
    });
  if (bodyText) {
    bodyText.wordPx = r1(medOf(sp.map((x) => x.word)));
    bodyText.wordEm = r2(medOf(sp.map((x) => x.word / x.em)));
    bodyText.letterPx = r2(medOf(sp.map((x) => x.letter)));
    bodyText.lineHeight = r2(medOf(sp.map((x) => x.lh)));
  }

  /* ---------------------------------------------------------- headings */
  const HEAD_AWAY = 'footer, nav, aside, dialog, [role="contentinfo"], [role="navigation"], [role="complementary"], [role="dialog"], [aria-modal="true"]';
  const levelOf = (h) => {
    const m = /^H([1-6])$/.exec(h.tagName);
    if (m) return Number(m[1]);
    const a = Number(h.getAttribute('aria-level'));
    return Number.isFinite(a) && a >= 1 ? a : 2;
  };
  const allHeads = [...document.querySelectorAll('h1, h2, h3, [role="heading"]')]
    .filter((h) => !isOurs(h) && levelOf(h) <= 3)
    .filter((h) => !h.closest(HEAD_AWAY) && layerOf(h).kind !== 'fixed' && visible(h))
    .filter((h) => {
      const b = h.getBoundingClientRect();
      return b.width >= 4 && b.height >= 4 && norm(h.textContent).length >= 2;
    });
  const inMain = mainEl ? allHeads.filter((h) => mainEl.contains(h)) : [];
  const heads = inMain.length ? inMain : allHeads;
  const byLevel = { h1: [], h2: [], h3: [] };
  for (const h of heads) {
    // The heading's size is its largest visible text (headline spans often carry the size, not the h element).
    let px = 0;
    let weight = 0;
    const w = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!/\S/.test(n.nodeValue || '') || !n.parentElement || !visible(n.parentElement)) continue;
      const c = cs(n.parentElement);
      const f = parseFloat(c.fontSize) || 0;
      if (f > px) {
        px = f;
        weight = Number(c.fontWeight) || 400;
      }
    }
    if (!px) continue;
    byLevel[`h${levelOf(h)}`]?.push({ px, weight, text: norm(h.textContent).slice(0, 60) });
  }
  const med = (xs) => {
    const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const headings = {};
  for (const [k, list] of Object.entries(byLevel)) {
    if (!list.length) continue;
    const px = med(list.map((x) => x.px));
    headings[k] = {
      n: list.length,
      css: r1(px),
      screen: r1(px * textZoom),
      max: r1(Math.max(...list.map((x) => x.px))),
      weight: med(list.map((x) => x.weight)),
      ratio: bodyText?.css ? r2(px / bodyText.css) : null,
      text: list[0].text,
    };
  }

  /* ---------------------------------------------------------- line boxes (shared by overlap and column) */
  const range = document.createRange();
  const lines = [];
  for (const n of nodes) {
    const el = n.parentElement;
    const layer = layerOf(el);
    if (layer.kind === 'fixed' || !visible(el)) continue;
    range.selectNodeContents(n);
    const rects = range.getClientRects();
    if (!rects.length) continue;
    const clip = clipOf(el);
    for (const q of rects) {
      if (q.width < 1 || q.height < 3) continue;
      // The glyph core: trim the inline box (ascent + descent) to roughly cap height down to the baseline, so tight
      // but correct line spacing between neighbouring blocks does not read as an overlap.
      const inset = q.height * 0.18;
      const box = meet({ l: q.left, t: q.top + inset, r: q.right, b: q.bottom - inset }, clip);
      if (box.r - box.l < 1 || box.b - box.t < 1) continue;
      lines.push({ ...box, el, layer, full: q });
    }
  }

  /* ---------------------------------------------------------- overlapping text */
  const sorted = lines.slice().sort((a, b) => a.t - b.t);
  const pairs = new Map();
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length && sorted[j].t < a.b; j++) {
      const b = sorted[j];
      if (a.el === b.el) continue;
      const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (w < 2 || h < 2 || w * h <= arg.minArea) continue;
      const [x, y] = a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? [a, b] : [b, a];
      let rec = pairs.get(x.el);
      if (!rec) {
        rec = new Map();
        pairs.set(x.el, rec);
      }
      const cur = rec.get(y.el);
      const box = { l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) };
      if (!cur || w * h > cur.area) rec.set(y.el, { a: x, b: y, area: w * h, box });
    }
  }
  const opaqueAt = (e) => {
    if (/^(IMG|VIDEO|CANVAS|IFRAME|PICTURE|svg)$/i.test(e.tagName)) return true;
    const c = cs(e);
    const m = /rgba?\(([^)]+)\)/.exec(c.backgroundColor || '');
    const alpha = m ? (m[1].split(/[ ,/]+/).filter(Boolean).map(Number)[3] ?? 1) : 0;
    return alpha >= 0.9 || (c.backgroundImage && c.backgroundImage !== 'none');
  };
  const found = [];
  let hidden = 0;
  for (const rec of pairs.values()) {
    for (const p of rec.values()) {
      const { a, b, box } = p;
      const cx = (box.l + box.r) / 2;
      const cy = (box.t + box.b) / 2;
      const inView = cx >= 0 && cx <= vw && cy >= 0 && cy <= vh;
      // Text painted under an opaque box (a carousel's back slide, a card over a card) is hidden, not overlapping.
      if (inView) {
        const stack = document.elementsFromPoint(cx, cy).filter((e) => !isOurs(e));
        const ia = stack.findIndex((e) => e === a.el || a.el.contains(e));
        const ib = stack.findIndex((e) => e === b.el || b.el.contains(e));
        if (ia >= 0 && ib >= 0) {
          const [hi, lo, loEl] = ia < ib ? [ia, ib, b.el] : [ib, ia, a.el];
          let covered = false;
          for (let k = hi; k < lo; k++) {
            const e = stack[k];
            if (e.contains(loEl) || loEl.contains(e)) continue;
            if (opaqueAt(e)) { covered = true; break; }
          }
          if (covered) { hidden++; continue; }
        }
      }
      const sameBox = a.layer.kind === 'abs' && a.layer === b.layer;
      const kind = (a.layer.kind === 'flow' && b.layer.kind === 'flow') || sameBox ? 'flow' : 'positioned';
      found.push({
        kind,
        area: Math.round(p.area),
        a: norm(a.el.textContent).slice(0, 48) || describe(a.el),
        b: norm(b.el.textContent).slice(0, 48) || describe(b.el),
        aWhere: describe(a.el),
        bWhere: describe(b.el),
        inView,
        rect: { x: r1(box.l), y: r1(box.t), w: r1(box.r - box.l), h: r1(box.b - box.t) },
      });
    }
  }
  found.sort((x, y) => (x.kind === y.kind ? y.area - x.area : x.kind === 'flow' ? -1 : 1));
  const overlap = {
    flow: found.filter((f) => f.kind === 'flow').length,
    positioned: found.filter((f) => f.kind === 'positioned').length,
    hidden,
    lines: lines.length,
    nodes: nodes.length,
    totalNodes: total,
    truncated: total > nodes.length,
    pairs: found.slice(0, 16),
    boxes: found.filter((f) => f.inView).slice(0, 40).map((f) => ({ ...f.rect, kind: f.kind })),
  };

  /* ---------------------------------------------------------- text spilling out of its box */
  // A line whose glyphs reach past its block's border box, or past the box of an in-flow ancestor (a 40 px card
  // header whose flex item grew to two lines): text grown inside a fixed height or width. It reads as broken even
  // with nothing under it. Lines are already clipped to every overflow-clipping ancestor, so hidden text never counts.
  // Above the line's own block only vertical spill counts (negative-margin rows legitimately overhang sideways), and
  // the walk stops at out-of-flow boxes and floats, which may sit outside their parents by design.
  const spills = [];
  const spillSeen = new Set();
  const boxCache = new Map();
  const boxOf = (el) => {
    let b = boxCache.get(el);
    if (!b) {
      b = el.getBoundingClientRect();
      boxCache.set(el, b);
    }
    return b;
  };
  for (const l of lines) {
    if (l.el instanceof SVGElement) continue;
    let e = blockOf(l.el);
    for (let depth = 0; e && e !== body && depth < 5; depth++) {
      const c = cs(e);
      const b = boxOf(e);
      if (b.width >= 2 && b.height >= 2 && !spillSeen.has(e)) {
        const down = l.b - b.bottom;
        const up = b.top - l.t;
        const right = depth === 0 ? l.r - b.right : 0;
        const left = depth === 0 ? b.left - l.l : 0;
        const px = Math.max(down, up, right, left);
        if (px >= 3) {
          spillSeen.add(e);
          const dir = px === down ? 'below' : px === up ? 'above' : px === right ? 'right of' : 'left of';
          const cx = (l.l + l.r) / 2;
          const cy = (l.t + l.b) / 2;
          spills.push({
            kind: l.layer.kind === 'flow' ? 'flow' : 'positioned',
            text: norm(l.el.textContent).slice(0, 48) || describe(l.el),
            where: describe(e),
            px: Math.round(px),
            dir,
            inView: cx >= 0 && cx <= vw && cy >= 0 && cy <= vh,
            rect: { x: r1(l.l), y: r1(l.t), w: r1(l.r - l.l), h: r1(l.b - l.t) },
          });
          break;
        }
      }
      if (c.position === 'absolute' || c.position === 'fixed' || c.float !== 'none') break;
      e = e.parentElement ? blockOf(e.parentElement) : null;
    }
  }
  spills.sort((x, y) => (x.kind === y.kind ? y.px - x.px : x.kind === 'flow' ? -1 : 1));
  overlap.spill = spills.filter((x) => x.kind === 'flow').length;
  overlap.spillPositioned = spills.length - overlap.spill;
  overlap.spills = spills.slice(0, 12);
  for (const x of spills.filter((q) => q.inView).slice(0, 20)) overlap.boxes.push({ ...x.rect, kind: 'spill' });

  /* ---------------------------------------------------------- the column on this screen */
  const onScreen = (l) => l.b > 0 && l.t < vh;
  const xs = [];
  for (const l of lines) if (l.layer.kind === 'flow' && onScreen(l)) xs.push([l.l, l.r]);
  for (const el of document.querySelectorAll('img, video, canvas, iframe, picture, input:not([type="hidden"]), select, textarea, button')) {
    if (isOurs(el) || layerOf(el).kind !== 'flow' || !visible(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 24 || b.height < 16 || b.bottom <= 0 || b.top >= vh) continue;
    const c = clipOf(el);
    const l = Math.max(b.left, c.l);
    const r = Math.min(b.right, c.r);
    if (r - l >= 8) xs.push([l, r]);
  }
  let content = null;
  if (xs.length) {
    const ls = xs.map((x) => x[0]).sort((a, b) => a - b);
    const rs = xs.map((x) => x[1]).sort((a, b) => a - b);
    const trim = Math.min(2, Math.floor(xs.length * 0.02));
    const left = Math.max(0, ls[trim]);
    const right = Math.min(vw, rs[rs.length - 1 - trim]);
    content = { left: scr(left), right: scr(right), width: scr(right - left) };
  }
  const bb = body.getBoundingClientRect();
  const bodyBox = { left: scr(bb.left), width: scr(bb.width), right: scr(bb.right) };
  const bodyCs = cs(body);
  const narrowed = bb.width < vw - 16;
  const colour = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return (p[3] ?? 1) < 0.05 ? null : `rgb(${p[0]}, ${p[1]}, ${p[2]})`;
  };
  const canvas = colour(cs(de).backgroundColor) ?? colour(bodyCs.backgroundColor) ?? 'rgb(255, 255, 255)';
  // What shows in the side margins: sample a few points just inside each edge and take the first element in the
  // hit-test stack that paints there (a background, an image, a control). Transparent full-width wrappers do not
  // count: at that point the person sees the page's own background.
  const paints = (e) => {
    if (/^(IMG|VIDEO|CANVAS|IFRAME|PICTURE|INPUT|SELECT|TEXTAREA|BUTTON)$/i.test(e.tagName) || e instanceof SVGElement) return true;
    const c = cs(e);
    return colour(c.backgroundColor) != null || (c.backgroundImage && c.backgroundImage !== 'none');
  };
  const sideAt = (x) => {
    const out = [];
    for (const f of [0.3, 0.5, 0.7, 0.9]) {
      const stack = document.elementsFromPoint(x, vh * f).filter((e) => !isOurs(e));
      const top = stack.find((e) => e === de || e === body || paints(e)) ?? null;
      if (!top || top === de || top === body) out.push('page');
      else if (layerOf(top).kind === 'fixed') out.push('overlay');
      else out.push(describe(top));
    }
    return out;
  };
  const sideL = sideAt(4);
  const sideR = sideAt(vw - 5);
  const sides = [...sideL, ...sideR];
  const pageShare = sides.filter((s) => s === 'page').length / sides.length;
  // In-flow boxes that escape a narrowed body (full-bleed heroes, 100vw rows): they break the column.
  const escapes = [];
  if (narrowed) {
    let seen = 0;
    for (const el of body.querySelectorAll('*')) {
      if (++seen > 6000) break;
      if (isOurs(el) || layerOf(el).kind !== 'flow') continue;
      const b = el.getBoundingClientRect();
      if (b.width < 40 || b.height < 8 || b.bottom < -vh || b.top > 2 * vh) continue;
      if (b.left < bb.left - 8 || b.right > bb.right + 8) {
        if (!visible(el)) continue;
        if (escapes.some((x) => x.el.contains(el))) continue;
        escapes.push({ el, what: describe(el), left: scr(b.left), right: scr(b.right) });
        if (escapes.length >= 12) break;
      }
    }
  }
  const marginL = content ? content.left : null;
  const marginR = content ? scr(vw) - content.right : null;
  const column = {
    viewport: scr(vw),
    body: bodyBox,
    bodyMaxWidth: bodyCs.maxWidth,
    narrowed,
    content,
    marginL,
    marginR,
    centredBy: marginL != null && marginR != null ? marginR - marginL : null,
    canvas,
    sides: { left: sideL, right: sideR, pageShare: r2(pageShare) },
    escapes: escapes.slice(0, 6).map(({ what, left, right }) => ({ what, left, right })),
    escapeCount: escapes.length,
  };

  /* ---------------------------------------------------------- horizontal overflow */
  // body.scrollWidth is in the body's own CSS px: under the page column (a zoomed, centred body) its overflow is
  // drawn at bodyZoom from the body's left edge, inside the margins, not past the window.
  const scrollW = Math.abs(bodyZoom - 1) > 0.005
    ? Math.max(de.scrollWidth, Math.round(body.getBoundingClientRect().left + scrollX + body.scrollWidth * bodyZoom))
    : Math.max(de.scrollWidth, body.scrollWidth);
  const ox = `${cs(de).overflowX}/${bodyCs.overflowX}`;
  const clipsX = /hidden|clip/.test(ox);
  const culprits = [];
  if (scrollW > vw + 2 || clipsX) {
    let seen = 0;
    for (const el of body.querySelectorAll('*')) {
      if (++seen > 8000) break;
      if (isOurs(el) || layerOf(el).kind === 'fixed') continue;
      const b = el.getBoundingClientRect();
      if (b.right <= vw + 2 || b.width < 8 || b.height < 4) continue;
      const c = clipOf(el.parentElement);
      if (c.r <= vw + 2) continue; // clipped by an ancestor (carousels)
      if (!visible(el) || culprits.some((x) => x.el.contains(el))) continue;
      culprits.push({ el, what: describe(el), right: scr(b.right) });
      if (culprits.length >= 8) break;
    }
  }
  const overflow = {
    px: scr(Math.max(0, scrollW - vw)),
    scroll: scrollW > vw + 2 && !clipsX,
    clippedBy: clipsX ? ox : null,
    culprits: culprits.slice(0, 4).map(({ what, right }) => ({ what, right })),
    culpritCount: culprits.length,
  };

  // What is drawn at the top of the window (a header that vanished can be traced to the layer that hides it).
  const topProbe = [0.06, 0.2].map((fy) => {
    const hit = document.elementFromPoint(vw / 2, vh * fy);
    const chain = [];
    for (let n = hit, d = 0; n && n !== de && d < 7; n = n.parentElement, d++) {
      const c = cs(n);
      const b = n.getBoundingClientRect();
      chain.push(`${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}.${String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className).split(/\s+/).slice(0, 2).join('.')}`
        + ` pos=${c.position} tr=${c.transform === 'none' ? '-' : c.transform.slice(0, 40)} op=${c.opacity} vis=${c.visibility} [${Math.round(b.top)},${Math.round(b.height)}]`
        + `${[...n.attributes].filter((a) => a.name.startsWith('data-wa')).map((a) => ` ${a.name}=${a.value}`).join('')}`);
    }
    return { y: Math.round(vh * fy), chain };
  });

  return {
    topProbe,
    vw: scr(vw),
    vh: scr(vh),
    cssW: Math.round(vw),
    cssH: Math.round(vh),
    dpr,
    zoom: r2(zoom),
    textZoom: r2(textZoom),
    bodyZoom: r2(bodyZoom),
    scrollY: Math.round(scrollY),
    body: bodyText,
    headings,
    overlap,
    column,
    overflow,
    ms: Math.round(performance.now() - t0),
  };
};

/** Reading facts for the current view. Never throws; a failure comes back as { error }. */
export async function readingFacts(page, opts = {}) {
  try {
    return await page.evaluate(FACTS_SRC, { baseDpr: opts.baseDpr ?? baseDpr(), maxNodes: opts.maxNodes ?? 9000, minArea: OVERLAP_MIN_AREA });
  } catch (e) {
    return { error: (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200) };
  }
}

const UI_SITE_SRC = (arg) => {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const isOurs = (el) => !!el && (el.tagName === 'WEBABLE-UI' || !!el.closest?.('webable-ui'));
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    return typeof el.checkVisibility === 'function' ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
  };
  const fixedish = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  };
  const controls = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], iframe')]
    .filter((el) => !isOurs(el) && shown(el));
  const out = [];
  for (const f of arg.floats) {
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, f.x + f.w) - Math.max(r.left, f.x);
      const h = Math.min(r.bottom, f.y + f.h) - Math.max(r.top, f.y);
      if (w <= 4 || h <= 4 || w * h < 64) continue;
      out.push({
        ours: f.t || f.cls,
        site: (norm(el.getAttribute('aria-label') || el.textContent || el.value || el.title) || el.tagName.toLowerCase()).slice(0, 40),
        siteFixed: fixedish(el),
        area: Math.round(w * h),
      });
    }
  }
  return out.sort((a, b) => Number(b.siteFixed) - Number(a.siteFixed) || b.area - a.area).slice(0, 12);
};

/** Site controls under WebAble's floating UI (pill, chips, toasts, offers, consent bar). */
export async function uiOverSite(page, floats) {
  if (!floats?.length) return [];
  try {
    return await page.evaluate(UI_SITE_SRC, { floats });
  } catch {
    return [];
  }
}

/**
 * WebAble's own engine state (column, text step, page zoom) from the content script's isolated world, through the
 * DevTools protocol. Null when the engine is not reachable (older builds, extension pages).
 */
export async function engineState(page) {
  let cdp = null;
  try {
    cdp = await page.context().newCDPSession(page);
    const ctxs = [];
    cdp.on('Runtime.executionContextCreated', (e) => ctxs.push(e.context));
    await cdp.send('Runtime.enable');
    const frame = (await cdp.send('Page.getFrameTree').catch(() => null))?.frameTree?.frame?.id ?? null;
    const iso = ctxs.filter(
      (c) => c.auxData?.type === 'isolated' && (!frame || c.auxData?.frameId === frame) && (/^chrome-extension:/.test(c.origin ?? '') || /webable/i.test(c.name ?? '')),
    );
    for (const c of iso) {
      const r = await cdp.send('Runtime.evaluate', {
        contextId: c.id,
        returnByValue: true,
        expression: `(() => {
          const e = globalThis.__webableEngine;
          if (!e || typeof e.getState !== 'function') return null;
          const s = e.getState();
          return {
            phase: s.phase,
            column: s.column ?? null,
            textStep: s.textStep ?? null,
            pageZoom: s.pageZoom ?? null,
            showingOriginal: !!s.showingOriginal,
            ops: (s.ops ?? []).map((o) => ({ kind: o.kind, status: o.status })),
            // Failed checks with the elements they name, so a reversal can be traced to what the page drew.
            fails: (s.checks ?? []).filter((c) => !c.pass).slice(-12).map((c) => {
              const ids = [...new Set((String(c.detail).match(/\\b[nv]\\d+\\b/g) || []))].slice(0, 3);
              const els = ids.map((id) => {
                const el = typeof e.elementFor === 'function' ? e.elementFor(id) : null;
                if (!el) return { id };
                const r = el.getBoundingClientRect();
                return { id, tag: el.tagName, cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 60),
                  text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
              });
              return { name: c.name, opId: c.opId ?? null, detail: c.detail, els };
            }),
          };
        })()`,
      });
      const v = r?.result?.value;
      if (v) return v;
    }
    return null;
  } catch {
    return null;
  } finally {
    await cdp?.send('Runtime.disable').catch(() => {});
    await cdp?.detach().catch(() => {});
  }
}

/* ------------------------------------------------------------------ verdicts used by the console line and the sheet */

/**
 * Heading verdict per level, heading size ÷ body size before and after. Zoom keeps the site's ratios, so:
 * 'good' when the ratio held (within 0.05) or rose, or a weak level was raised to the ramp; 'warn' when it lost
 * ground but stays at or above the ramp, or slipped a little below it; 'bad' when it lost ground and fell below the
 * ramp (the page flattened, as in Caden's 1.webp).
 */
export function headingVerdicts(before, after) {
  const out = {};
  for (const k of ['h1', 'h2', 'h3']) {
    const b = before?.headings?.[k]?.ratio ?? null;
    const a = after?.headings?.[k]?.ratio ?? null;
    if (a == null) continue;
    const ramp = RAMP[k];
    let tone;
    if (b == null) tone = a >= ramp - 0.02 ? 'good' : 'warn';
    else if (a >= b - 0.05) tone = 'good';
    else if (a >= ramp - 0.02) tone = 'warn';
    else tone = a < b - 0.1 ? 'bad' : 'warn';
    out[k] = { before: b, after: a, ramp, tone };
  }
  return out;
}

/**
 * Column verdict: is the page held to a centred column with the page's own colour at the sides? `source` says who
 * holds it: WebAble (engine state says the column is on), a narrowed body, or the site's own layout. At 100% zoom
 * a site's own off-centre layout is reported but not judged.
 */
export function columnVerdict(r, engineColumn = null) {
  const c = r?.column;
  if (!c?.content) return { tone: '', text: 'no content measured', held: false };
  const zoomed = (r.zoom ?? 1) > 1.05;
  const held = c.narrowed || (c.marginL >= 48 && c.marginR >= 48);
  const source = engineColumn?.on ? 'WebAble' : c.narrowed ? 'narrowed body' : 'site layout';
  if (!held) return { tone: zoomed && c.viewport >= 1100 ? 'warn' : '', text: 'full width', held: false, source: null };
  const centred = Math.abs(c.centredBy ?? 0) <= Math.max(24, 0.04 * c.viewport);
  const pageSides = (c.sides?.pageShare ?? 0) >= 0.75;
  const clean = centred && pageSides && c.escapeCount === 0;
  const tone = clean ? 'good' : source === 'site layout' && !zoomed ? '' : 'warn';
  const width = c.narrowed && c.body?.width ? c.body.width : c.content.width;
  return { tone, held: true, centred, pageSides, width, source, text: `${width} px` };
}
