// Owner: L. Jev Lens. v2: a scrim with holes over what Jev kept, two-tone outlines, chips that show the number the
// policy acted on, a hover card, a one-row header, a side sheet, and "vs plain rule".
// v3, when Jev sent them: the kind of page on the header, a calm frame on the region the page exists to show,
// fine-role chips, importance as outline weight, fine-role bars and importance on the card, and a Page tab.
// Missing or empty round-7 fields leave the v2 view as it was.
//
// Layout runs as read-all-rects → decide (pure place.ts) → write, on answers, on scroll (rAF only while scrolling),
// and on a slow tick for pages that move by themselves. The overlay never takes the pointer; hover is hit-tested
// against the cached rects.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { EngineApi, EngineState } from '../../contracts';
import { fmtCost, fmtCount, fmtMs, fmtTokens, jevTotals } from '../panel/format';
import { Card } from './Card';
import { CLASS_WEIGHT, fineChipFace, fineChipPriority, lensItems, mergedChip, type LensClass, type LensItem } from './display';
import { ClassIcon, IChevronRight, IClose, IDiamond, IRule } from './icons';
import { cellRegions, chipBudget, placeChips, rectsPath, type ChipPlan, type PlaceItem, type Rect } from './place';
import { compareRule, plainRule } from './rule';
import { Paras } from './Paras';
import { paraSummary } from './paragraphs';
import { Sheet, type RowStatus, type SheetTab } from './Sheet';
import { usePageZoom } from '../zoom';
import type { TodayMeter } from './today';
import { hasPageRead, mainRegionPick, purposeLine, regionLabel, type FineFamily } from './words';

interface Props {
  api: EngineApi;
  s: EngineState;
  reduce: boolean;
  /** Unused since v2: the Today total lives in the panel ("Today, new answers only"). Kept so callers still compile. */
  today?: TodayMeter | null;
  /** Px kept free at the bottom right for the pill and its stack. */
  bottomReserve: number;
}

type ChipCls = LensClass | 'rule' | 'page' | FineFamily;
interface PlannedChip extends ChipPlan { words: string; num: string; icon: ChipCls }
interface Plan {
  sig: string;
  chips: PlannedChip[];
  listed: Set<string>;
  status: Map<string, RowStatus>;
  rects: Map<string, Rect | null>;
  scrim: string;
  hatch: string;
  ruleRect: Rect | null;
  /** The region that holds what the page is for, or null when Jev did not pick one. */
  regionRect: Rect | null;
  card: { x: number; y: number } | null;
}

const EMPTY_PLAN: Plan = { sig: '', chips: [], listed: new Set(), status: new Map(), rects: new Map(), scrim: '', hatch: '', ruleRect: null, regionRect: null, card: null };
const CHIP_CLASSES = new Set<LensClass>(['main', 'popup', 'folded', 'guarded', 'unsure']);
const OUTSET = 3;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const RULE_WEIGHT = 5.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const f2 = (p: number) => clamp(p, 0, 1).toFixed(2);

/** A number that counts up (600 ms, ease-out) to its target: from 0 on entry (`key`), from where it was on updates. */
function useCount(target: number, key: number, reduce: boolean): number {
  const [v, setV] = useState(reduce ? target : 0);
  const shown = useRef(reduce ? target : 0);
  const lastKey = useRef(key);
  useEffect(() => {
    if (reduce || target <= 0) {
      shown.current = target;
      setV(target);
      return;
    }
    if (lastKey.current !== key) {
      lastKey.current = key;
      shown.current = 0;
    }
    const from = shown.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = clamp((now - t0) / 600, 0, 1);
      const val = from + (target - from) * (1 - Math.pow(1 - k, 3));
      shown.current = val;
      setV(val);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, key, reduce]);
  return v;
}

type CheckVis = (o?: { checkVisibilityCSS?: boolean; visibilityProperty?: boolean }) => boolean;

/** Ancestors that clip their content (overflow other than visible), so carousel slides out of view count as hidden. */
function clipChain(el: Element): Element[] {
  const out: Element[] = [];
  let p = el.parentElement;
  for (let i = 0; p && i < 14 && p !== document.body && p !== document.documentElement; i++, p = p.parentElement) {
    let cs: CSSStyleDeclaration;
    try {
      cs = getComputedStyle(p);
    } catch {
      break;
    }
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') out.push(p);
    if (cs.position === 'fixed') break;
  }
  return out;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w >= 1 && h >= 1 ? { x, y, w, h } : null;
}

const COVER_KINDS: Array<[RegExp, string]> = [
  [/chat|messag|assistant|livechat|intercom|drift|zendesk/i, 'Covered by a chat panel'],
  [/cookie|consent|gdpr|privacy|onetrust|cmp/i, 'Covered by the cookie notice'],
  [/newsletter|subscribe|signup|sign-up/i, 'Covered by a sign-up box'],
  [/survey|feedback|qualtrics|medallia/i, 'Covered by a survey'],
  [/modal|dialog|popup|pop-up|overlay|lightbox|interstitial/i, 'Covered by a popup'],
  [/promo|announce|offer|deal/i, 'Covered by a promo bar'],
  [/header|navbar|nav|masthead|toolbar|sticky/i, 'Covered by a sticky header'],
];
const OVERLAY_KIND_NOTE: Record<string, string> = {
  chat: 'Covered by a chat panel',
  consent: 'Covered by the cookie notice',
  survey: 'Covered by a survey',
  newsletter: 'Covered by a sign-up box',
  promo_bar: 'Covered by a promo bar',
  warning: 'Covered by a warning',
  modal: 'Covered by a popup',
  header: 'Covered by a sticky header',
};

export function Lens({ api, s, reduce, bottomReserve }: Props) {
  const items = useMemo(() => lensItems(s.digest, s.decisions, s.understanding), [s.digest, s.decisions, s.understanding]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const line = useMemo(() => purposeLine(s.understanding?.purpose), [s.understanding]);
  const region = useMemo(() => mainRegionPick(s.understanding?.mainRegion), [s.understanding]);
  const regionId = region && region.id !== 'none' ? region.id : null;
  const answered = s.decisions.length > 0;
  const asking = !answered && Boolean(s.digest) && (s.phase === 'reading' || s.phase === 'tailored');
  // The same page-zoom reading as the rest of our UI (the engine's, confirmed with the tab's).
  const zoom = usePageZoom(api);
  const bodyPx = s.fit?.text?.override ?? s.fit?.text?.bodyPx ?? 16;
  // One design pixel in CSS px: chips keep their physical size at any tab zoom, a little larger for large text.
  const scale = clamp(bodyPx / 18, 1, 1.25) / (zoom > 0 ? zoom : 1);

  const [sheetOpen, setSheetOpen] = useState(() => window.innerWidth >= 1440);
  const [tab, setTab] = useState<SheetTab>('elements');
  const [ruleOn, setRuleOn] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [rowHot, setRowHot] = useState<string | null>(null);
  const [rowFocus, setRowFocus] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [enterKey, setEnterKey] = useState(0);
  const [steady, setSteady] = useState(false);
  const fitRef = useRef(0);

  const rule = useMemo(() => plainRule(s.digest), [s.digest]);
  const diff = useMemo(() => (answered ? compareRule(rule, items) : null), [rule, items, answered]);
  const mainItem = items.find((i) => i.cls === 'main') ?? null;

  const cardId = pinnedId ?? rowFocus ?? hoverId;
  const cardItem = cardId ? itemById.get(cardId) ?? null : null;

  // Refs the layout pass reads (latest values without re-subscribing listeners).
  const live = useRef({ items, itemById, ruleOn, rule, rowHot, pinnedId, cardId, scale, zoom, answered, bottomReserve, enter: true, overlays: s.overlays, regionId, regionP: region?.p ?? 0 });
  live.current = { items, itemById, ruleOn, rule, rowHot, pinnedId, cardId, scale, zoom, answered, bottomReserve, enter: !steady, overlays: s.overlays, regionId, regionP: region?.p ?? 0 };

  const planRef = useRef<Plan>(EMPTY_PLAN);
  const renderedSig = useRef('');
  const prevSlots = useRef(new Map<string, { dx: number; dy: number }>());
  const covered = useRef(new Map<string, string>());
  const clips = useRef(new Map<string, Element[]>());
  const order = useRef(new Map<string, number>());
  const needOrder = useRef(true);
  const lastCss = useRef(new WeakMap<Element, string>());
  const widthCache = useRef(new Map<string, number>());
  /** Real chip widths read back from the DOM after a render, so placement uses the font the page actually drew. */
  const measured = useRef(new Map<string, number>());
  const lbottom = useRef('');
  /** Round 9: where the paragraph tags are, so element chips keep clear of them. */
  const paraTags = useRef<Rect[]>([]);
  const ctx = useRef<CanvasRenderingContext2D | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const ruleBoxRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const hatchRef = useRef<HTMLDivElement>(null);
  const boxEls = useRef(new Map<string, HTMLDivElement>());
  const chipEls = useRef(new Map<string, HTMLDivElement>());
  const leadEls = useRef(new Map<string, SVGLineElement>());

  /* ---------------------------------------------------------------- measuring chip text */
  const textW = (text: string, weight: number, px: number): number => {
    const k = `${weight}|${px}|${text}`;
    const hit = widthCache.current.get(k);
    if (hit !== undefined) return hit;
    if (!ctx.current) {
      try {
        ctx.current = document.createElement('canvas').getContext('2d');
      } catch {
        ctx.current = null;
      }
    }
    let w = text.length * px * 0.56;
    if (ctx.current) {
      ctx.current.font = `${weight} ${px}px ${FONT}`;
      w = ctx.current.measureText(text).width;
    }
    widthCache.current.set(k, w);
    return w;
  };

  const chipText = (cls: string, ids: string[]): { words: string; num: string } => {
    const L = live.current;
    if (cls === 'page') return { words: 'What this page is for ·', num: f2(L.regionP) };
    if (cls === 'rule') {
      const same = L.items.find((i) => i.cls === 'main')?.id === ids[0];
      return { words: same ? 'Plain rule: same pick' : 'Plain rule: main action', num: '' };
    }
    const its = ids.map((id) => L.itemById.get(id)).filter((i): i is LensItem => Boolean(i));
    const fine = cls.startsWith('fine:') ? fineChipFace(its) : null;
    if (fine) return fine;
    if (its.length > 1) return mergedChip(its);
    const it = its[0];
    if (!it) return { words: '', num: '' };
    return { words: it.chip, num: it.num };
  };

  const chipKey = (cls: string, words: string, num: string, sc: number) => `${cls}|${words}|${num}|${sc.toFixed(4)}`;
  const chipSize = (cls: string, ids: string[]): { w: number; h: number } => {
    const sc = live.current.scale;
    const big = cls === 'main' || cls === 'page';
    const fs = big ? 13 : 12;
    const { words, num } = chipText(cls, ids);
    const h = Math.round((cls === 'page' ? 28 : cls === 'main' ? 26 : 22) * sc);
    const real = measured.current.get(chipKey(cls, words, num, sc));
    if (real) return { w: real, h };
    const icon = big ? 13 : 12;
    const inner = 8 + icon + 5 + textW(words, 600, fs) + (num ? 5 + textW(num, 700, fs) : 0) + 9 + 6;
    const max = cls === 'page' ? 340 : cls === 'main' ? 260 : 260;
    return { w: Math.ceil(Math.min(inner, max) * sc), h };
  };

  /* ---------------------------------------------------------------- write helpers */
  // Style writes are skipped when nothing changed for that very node (boxes remount when their class changes).
  const write = (_key: string, el: Element | null | undefined, css: string) => {
    if (!el || lastCss.current.get(el) === css) return;
    lastCss.current.set(el, css);
    (el as HTMLElement).style.cssText = css;
  };

  const applyGeometry = (plan: Plan) => {
    const L = live.current;
    for (const it of L.items) {
      const el = boxEls.current.get(it.id);
      const r = plan.rects.get(it.id) ?? null;
      const st = plan.status.get(it.id);
      const d = order.current.get(it.id) ?? 0;
      if (!r || st === 'hidden') {
        write(`b${it.id}`, el, 'display:none');
        continue;
      }
      write(
        `b${it.id}`,
        el,
        `transform:translate3d(${Math.round(r.x - OUTSET)}px,${Math.round(r.y - OUTSET)}px,0);width:${Math.round(r.w + 2 * OUTSET)}px;height:${Math.round(r.h + 2 * OUTSET)}px;--d:${d}ms`,
      );
    }
    const rr = plan.ruleRect;
    write(
      'rule',
      ruleBoxRef.current,
      rr ? `transform:translate3d(${Math.round(rr.x - 7)}px,${Math.round(rr.y - 7)}px,0);width:${Math.round(rr.w + 14)}px;height:${Math.round(rr.h + 14)}px` : 'display:none',
    );
    const rg = plan.regionRect;
    const rout = 8;
    write(
      'region',
      regionRef.current,
      rg
        ? `transform:translate3d(${Math.round(rg.x - rout)}px,${Math.round(rg.y - rout)}px,0);width:${Math.round(rg.w + 2 * rout)}px;height:${Math.round(rg.h + 2 * rout)}px`
        : 'display:none',
    );
    if (pathRef.current && pathRef.current.getAttribute('d') !== plan.scrim) pathRef.current.setAttribute('d', plan.scrim);
    write('hatch', hatchRef.current, plan.hatch ? `clip-path:path("${plan.hatch}")` : 'display:none');
    plan.chips.forEach((c, rank) => {
      const delay = L.enter ? 200 + Math.min(rank, 16) * 28 : 0;
      write(`c${c.key}`, chipEls.current.get(c.key), `transform:translate3d(${Math.round(c.x)}px,${Math.round(c.y)}px,0);--cd:${delay}ms`);
      const ln = leadEls.current.get(c.key);
      if (ln && c.leader) {
        const k = `${Math.round(c.leader.x1)},${Math.round(c.leader.y1)},${Math.round(c.leader.x2)},${Math.round(c.leader.y2)}`;
        if (lastCss.current.get(ln) !== k) {
          lastCss.current.set(ln, k);
          ln.setAttribute('x1', String(Math.round(c.leader.x1)));
          ln.setAttribute('y1', String(Math.round(c.leader.y1)));
          ln.setAttribute('x2', String(Math.round(c.leader.x2)));
          ln.setAttribute('y2', String(Math.round(c.leader.y2)));
        }
      }
    });
    write('card', cardRef.current, plan.card ? `transform:translate3d(${Math.round(plan.card.x)}px,${Math.round(plan.card.y)}px,0)` : 'visibility:hidden');
  };

  /* ---------------------------------------------------------------- the layout pass */
  const pass = () => {
    const L = live.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Read everything first.
    const rects = new Map<string, Rect | null>();
    const status = new Map<string, RowStatus>();
    for (const it of L.items) {
      const el = api.elementFor(it.id);
      let r: Rect | null = null;
      if (el && el.isConnected) {
        const b = el.getBoundingClientRect();
        let vis = b.width >= 1 && b.height >= 1;
        if (vis) {
          const cv = (el as Element & { checkVisibility?: CheckVis }).checkVisibility;
          if (typeof cv === 'function') {
            try {
              vis = cv.call(el, { checkVisibilityCSS: true, visibilityProperty: true });
            } catch {
              /* older engine */
            }
          }
        }
        if (vis) {
          r = { x: b.left, y: b.top, w: b.width, h: b.height };
          let chain = clips.current.get(it.id);
          if (!chain) {
            chain = clipChain(el);
            clips.current.set(it.id, chain);
          }
          for (const a of chain) {
            if (!r) break;
            if (!a.isConnected) continue;
            const ab = a.getBoundingClientRect();
            r = intersect(r, { x: ab.left, y: ab.top, w: ab.width, h: ab.height });
          }
        }
      }
      rects.set(it.id, r);
      if (!r) status.set(it.id, 'hidden');
      else if (r.y + r.h <= 0) status.set(it.id, 'up');
      else if (r.y >= vh) status.set(it.id, 'down');
      else if (r.x + r.w <= 0 || r.x >= vw) status.set(it.id, 'hidden');
      else status.set(it.id, 'shown');
    }
    // The main-information region may be a digest region that is not itself an element row.
    let regionRect: Rect | null = null;
    if (L.answered && L.regionId) {
      if (rects.has(L.regionId)) regionRect = rects.get(L.regionId) ?? null;
      else {
        const el = api.elementFor(L.regionId);
        if (el && el.isConnected) {
          const b = el.getBoundingClientRect();
          if (b.width >= 1 && b.height >= 1) regionRect = { x: b.left, y: b.top, w: b.width, h: b.height };
        }
      }
      if (regionRect && (regionRect.y + regionRect.h <= 0 || regionRect.y >= vh || regionRect.x + regionRect.w <= 0 || regionRect.x >= vw)) {
        regionRect = null;
      }
    }
    const ruleRect: Rect | null = L.ruleOn && L.rule.mainId && status.get(L.rule.mainId) !== 'hidden' ? rects.get(L.rule.mainId) ?? null : null;
    const chrome: Rect[] = [];
    const host = rootRef.current;
    // The rest of our chrome lives in the zoomed chrome layer (pill, panel, offers, chips, the cookie bar): each part
    // is marked data-wa-chrome. Its rects come back in page CSS px like everything here. Siblings in our own layer
    // count too.
    const scope = host?.getRootNode();
    const marked = scope && 'querySelectorAll' in scope ? Array.from((scope as ShadowRoot).querySelectorAll('[data-wa-chrome]')) : [];
    for (const ch of [...marked, ...Array.from(host?.parentElement?.children ?? [])]) {
      if (ch === host || ch.classList.contains('wa-sr') || ch.contains(host ?? null)) continue;
      const b = ch.getBoundingClientRect();
      if (b.width < 2 || b.height < 2 || b.width * b.height > vw * vh * 0.5) continue;
      chrome.push({ x: b.left, y: b.top, w: b.width, h: b.height });
    }
    const hb = headRef.current?.getBoundingClientRect();
    const sb = sheetRef.current?.getBoundingClientRect();
    const cardEl = cardRef.current;
    const cw = cardEl ? cardEl.offsetWidth : 0;
    const ch = cardEl ? cardEl.offsetHeight : 0;

    // Reading order for the entry cascade (8 ms apart, 360 ms at most).
    if (needOrder.current) {
      needOrder.current = false;
      const shown = L.items
        .filter((i) => status.get(i.id) === 'shown')
        .map((i) => ({ id: i.id, r: rects.get(i.id)! }))
        .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
      const m = new Map<string, number>();
      shown.forEach((x, k) => m.set(x.id, Math.min(k * 8, 360)));
      order.current = m;
    }

    // Decide.
    const sc = L.scale;
    const reserved: Rect[] = [];
    if (hb && hb.width > 0) reserved.push({ x: hb.left - 6, y: hb.top - 6, w: hb.width + 12, h: hb.height + 12 });
    if (sb && sb.width > 0) reserved.push({ x: sb.left - 6, y: sb.top - 6, w: sb.width + 12, h: sb.height + 12 });
    // The rest of our chrome (pill, panel, offers, toasts, overlay chips), wherever the app put it.
    for (const r of chrome) reserved.push({ x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 });
    for (const r of paraTags.current) reserved.push({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 });
    if (chrome.length === 0) {
      const pillW = 190 * sc;
      reserved.push({ x: vw - pillW, y: vh - L.bottomReserve, w: pillW, h: L.bottomReserve });
    }
    // The sheet stops above any of our chrome that sits under its column (the pill, an offer card).
    const sheetX0 = vw - Math.min(360 * sc, vw - 20 * sc) - 10 * sc;
    // Stop above our chrome in the sheet's column only while the sheet keeps at least 60% of the height.
    let bottom = 10 * sc;
    for (const r of chrome) {
      if (r.x + r.w <= sheetX0 || r.y <= vh * 0.4) continue;
      const b = vh - r.y + 8;
      if (vh - 10 * sc - b >= vh * 0.6) bottom = Math.max(bottom, b);
    }
    const lb = `${Math.round(bottom)}px`;
    if (lb !== lbottom.current && rootRef.current) {
      lbottom.current = lb;
      rootRef.current.style.setProperty('--lbottom', lb);
    }
    const mainIt = L.items.find((i) => i.cls === 'main');
    const mainR = mainIt ? rects.get(mainIt.id) ?? null : null;
    if (mainR) reserved.push({ x: mainR.x - 6, y: mainR.y - 6, w: mainR.w + 12, h: mainR.h + 12 });

    const forced = new Set([L.rowHot, L.pinnedId].filter((x): x is string => Boolean(x)));
    const placeItems: PlaceItem[] = [];
    if (L.answered) {
      for (const it of L.items) {
        const r = rects.get(it.id);
        if (!r || status.get(it.id) !== 'shown') continue;
        const isForced = forced.has(it.id);
        const tag = it.ev.tag;
        const hint = (it.ev.role_hint || '').toLowerCase();
        const field = tag === 'input' || tag === 'select' || tag === 'textarea' || /textbox|combobox|searchbox/.test(hint);
        // A fine role replaces the policy chip. The main region speaks through its own label, not a fine-role chip.
        if (it.fine && it.fineName && it.id !== L.regionId) {
          if (covered.current.has(it.id) && !isForced) continue;
          placeItems.push({
            id: it.id,
            cls: `fine:${it.fine}`,
            box: r,
            priority: fineChipPriority(it),
            field,
            forced: isForced,
          });
          continue;
        }
        if (!CHIP_CLASSES.has(it.cls) && !isForced) continue;
        if (covered.current.has(it.id) && it.cls !== 'main' && !isForced) continue;
        placeItems.push({
          id: it.id,
          cls: it.cls,
          box: r,
          priority: CLASS_WEIGHT[it.cls] * 10 + (it.p ?? 0),
          field,
          forced: isForced,
        });
      }
      if (ruleRect && L.rule.mainId && status.get(L.rule.mainId) === 'shown') {
        placeItems.push({ id: `rule:${L.rule.mainId}`, cls: 'rule', box: { x: ruleRect.x - 4, y: ruleRect.y - 4, w: ruleRect.w + 8, h: ruleRect.h + 8 }, priority: RULE_WEIGHT * 10 });
      }
      if (regionRect && L.regionId) {
        placeItems.push({ id: `page:${L.regionId}`, cls: 'page', box: regionRect, priority: 80, forced: true });
      }
    }
    const stripId = (x: string) => (x.startsWith('rule:') ? x.slice(5) : x.startsWith('page:') ? x.slice(5) : x);
    const sizeFor = (cls: string, ids: string[]) => chipSize(cls, ids.map(stripId));
    const res = placeChips(placeItems, {
      vw,
      vh,
      reserved,
      budget: chipBudget(vw * L.zoom, vh * L.zoom),
      prev: prevSlots.current,
      size: sizeFor,
      mergePx: 48,
    });
    const chips: PlannedChip[] = res.chips.map((c) => {
      const ids = c.ids.map(stripId);
      const t = chipText(c.cls, ids);
      const first = L.itemById.get(ids[0] ?? '');
      let icon: ChipCls = 'kept';
      if (c.cls === 'rule') icon = 'rule';
      else if (c.cls === 'page') icon = 'page';
      else if (c.cls.startsWith('fine:')) icon = first?.family ?? 'other';
      else icon = first?.cls ?? 'kept';
      return { ...c, ids, words: t.words, num: t.num, icon };
    });
    const nextPrev = new Map<string, { dx: number; dy: number }>();
    for (const c of chips) nextPrev.set(c.key, { dx: c.x - c.anchor.x, dy: c.y - c.anchor.y });
    prevSlots.current = nextPrev;

    // Scrim: holes over everything Jev kept; folded and unsure stay under it. Folded spots also get the hatch.
    // Each spot takes the decision of the smallest element over it, so a kept button inside a folded block is lit.
    let scrim = '';
    let hatch = '';
    if (L.answered) {
      const regions = cellRegions(
        vw,
        vh,
        L.items
          .filter((i) => status.get(i.id) === 'shown' && i.cls !== 'pending')
          .map((i) => {
            const r = rects.get(i.id)!;
            const kind = i.cls === 'folded' ? (covered.current.has(i.id) ? 'dim' : 'hatch') : i.cls === 'unsure' ? 'dim' : 'lit';
            return { r: { x: r.x - OUTSET, y: r.y - OUTSET, w: r.w + 2 * OUTSET, h: r.h + 2 * OUTSET }, kind };
          }),
      );
      scrim = `M0 0H${Math.round(vw)}V${Math.round(vh)}H0Z${rectsPath(regions.get('lit') ?? [])}`;
      hatch = rectsPath(regions.get('hatch') ?? []);
    }

    // Card: right of the element, else left, else below, else above; never over the main action or our chrome.
    let card: Plan['card'] = null;
    const cid = L.cardId;
    const cr = cid && status.get(cid) === 'shown' ? rects.get(cid) ?? null : null;
    if (cr && cw > 0 && ch > 0) {
      // Below our header, left of the sheet, off the main action and off the rest of our chrome.
      const top = hb && hb.width > 0 ? hb.bottom + 8 : 8;
      const right = sb && sb.width > 0 ? sb.left - 8 : vw - 8;
      const avoid: Rect[] = [...chrome];
      if (mainR && cid !== mainIt?.id) avoid.push({ x: mainR.x - 4, y: mainR.y - 4, w: mainR.w + 8, h: mainR.h + 8 });
      const g = 12;
      const yAlign = clamp(cr.y, top, Math.max(top, vh - ch - 8));
      const xAlign = clamp(cr.x, 8, Math.max(8, right - cw));
      // For each side, try the element's own top first, then slide up or down to clear our chrome.
      const ys = (y0: number) => [y0, top, ...avoid.map((a) => a.y - ch - 8), ...avoid.map((a) => a.y + a.h + 8), vh - ch - 8];
      const cands: Array<[number, number]> = [
        ...ys(yAlign).map((y): [number, number] => [cr.x + cr.w + g, y]),
        ...ys(yAlign).map((y): [number, number] => [cr.x - cw - g, y]),
        [xAlign, cr.y + cr.h + g],
        [xAlign, cr.y - ch - g],
      ];
      const fits = (x: number, y: number) => x >= 8 && y >= top && x + cw <= right && y + ch <= vh - 8;
      const covers = (x: number, y: number) => {
        let area = 0;
        for (const a of avoid) {
          const w = Math.min(x + cw, a.x + a.w) - Math.max(x, a.x);
          const h = Math.min(y + ch, a.y + a.h) - Math.max(y, a.y);
          if (w > 0 && h > 0) area += w * h;
        }
        return area;
      };
      // The first slot that fits and covers none of our chrome; else the one that covers the least of it.
      let pick: [number, number] = cands[0]!;
      let best = Infinity;
      for (const c of cands) {
        if (!fits(c[0], c[1])) continue;
        const a = covers(c[0], c[1]);
        if (a < best) {
          best = a;
          pick = c;
          if (a === 0) break;
        }
      }
      card = { x: clamp(pick[0], 8, Math.max(8, right - cw)), y: clamp(pick[1], top, Math.max(top, vh - ch - 8)) };
    }

    const sig = [
      chips.map((c) => `${c.key}:${c.cls}:${c.ids.join(',')}:${c.words}:${c.num}:${c.leader ? 1 : 0}`).join('|'),
      [...res.listed].sort().join(','),
      [...status.entries()].map(([k, v]) => `${k}${v[0]}`).join(''),
      [...covered.current.entries()].map(([k, v]) => `${k}${v.length}`).join(''),
      regionRect ? 'R' : '',
    ].join('#');
    const plan: Plan = { sig, chips, listed: new Set(res.listed), status, rects, scrim, hatch, ruleRect, regionRect, card };
    planRef.current = plan;
    if (sig !== renderedSig.current) {
      renderedSig.current = sig;
      setTick((t) => (t + 1) % 1_000_000);
    } else {
      applyGeometry(plan);
    }
  };

  /** Occlusion: 5 probes per element; 3 or more landing on something else means it is covered. */
  const probe = () => {
    const L = live.current;
    const plan = planRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const next = new Map<string, string>();
    const top = (x: number, y: number): Element | null => {
      let hit: Element | null = null;
      try {
        hit = document.elementFromPoint(x, y);
        if (hit && hit.tagName === 'WEBABLE-UI') hit = document.elementsFromPoint(x, y).find((e) => e.tagName !== 'WEBABLE-UI') ?? null;
      } catch {
        hit = null;
      }
      return hit;
    };
    for (const it of L.items) {
      if (plan.status.get(it.id) !== 'shown') continue;
      const r = plan.rects.get(it.id);
      const el = api.elementFor(it.id);
      if (!r || !el) continue;
      const pts: Array<[number, number]> = [
        [r.x + r.w / 2, r.y + r.h / 2],
        [r.x + r.w * 0.2, r.y + r.h * 0.2],
        [r.x + r.w * 0.8, r.y + r.h * 0.2],
        [r.x + r.w * 0.2, r.y + r.h * 0.8],
        [r.x + r.w * 0.8, r.y + r.h * 0.8],
      ];
      let hits = 0;
      let valid = 0;
      let coverer: Element | null = null;
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
        valid++;
        const h = top(x, y);
        if (!h || h === el || el.contains(h) || h.contains(el)) continue;
        hits++;
        coverer = coverer ?? h;
      }
      if (valid >= 3 && hits >= 3 && coverer) next.set(it.id, coverNote(coverer, L.overlays));
    }
    covered.current = next;
  };

  const coverNote = (hit: Element, overlays: EngineState['overlays']): string => {
    for (const o of overlays ?? []) {
      const oe = api.elementFor(o.id);
      if (oe && oe.contains(hit)) return OVERLAY_KIND_NOTE[o.kind] ?? 'Covered by another layer';
    }
    let el: Element | null = hit;
    for (let i = 0; el && i < 12 && el !== document.body; i++, el = el.parentElement) {
      const words = `${el.id} ${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('role') ?? ''}`;
      for (const [re, note] of COVER_KINDS) if (re.test(words)) return note;
    }
    return 'Covered by another layer';
  };

  /* ---------------------------------------------------------------- scheduling */
  const passRef = useRef(pass);
  passRef.current = pass;
  const probeRef = useRef(probe);
  probeRef.current = probe;

  useEffect(() => {
    let raf = 0;
    let lastMove = 0;
    let settleT = 0;
    let alive = true;
    const frame = () => {
      raf = 0;
      if (!alive) return;
      try {
        passRef.current();
      } catch {
        /* an element vanished mid-frame; the next pass catches up */
      }
      if (performance.now() - lastMove < 150) raf = requestAnimationFrame(frame);
    };
    const onMove = () => {
      lastMove = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
      window.clearTimeout(settleT);
      settleT = window.setTimeout(() => {
        if (!alive) return;
        try {
          probeRef.current();
          passRef.current();
        } catch {
          /* ignore */
        }
      }, 160);
    };
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove, { passive: true });
    let n = 0;
    const tick = window.setInterval(() => {
      if (document.hidden || !alive) return;
      try {
        if (++n % 2 === 0) probeRef.current();
        passRef.current();
      } catch {
        /* ignore */
      }
    }, 800);
    const first = window.setTimeout(() => {
      try {
        probeRef.current();
        passRef.current();
      } catch {
        /* ignore */
      }
    }, 450);
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(settleT);
      window.clearTimeout(first);
      window.clearInterval(tick);
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
    };
  }, []);

  // Hover: hit-test the pointer against cached rects (smallest wins). The overlay itself never takes the pointer.
  useEffect(() => {
    let cand: string | null = null;
    let t = 0;
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const target = e.target as Element | null;
      const ours = Boolean(target && target.tagName === 'WEBABLE-UI');
      let best: string | null = null;
      if (!ours) {
        const plan = planRef.current;
        let area = Infinity;
        for (const [id, r] of plan.rects) {
          if (!r || plan.status.get(id) !== 'shown') continue;
          if (e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h) {
            const a = r.w * r.h;
            if (a < area) {
              area = a;
              best = id;
            }
          }
        }
      }
      if (best === cand) return;
      cand = best;
      window.clearTimeout(t);
      t = window.setTimeout(() => setHoverId(cand), cand ? 90 : 220);
    };
    window.addEventListener('pointermove', onPointer, { capture: true, passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointermove', onPointer, { capture: true });
    };
  }, []);

  // Esc closes a pinned card first.
  useEffect(() => {
    if (!pinnedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPinnedId(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pinnedId]);

  // The Page tab exists only while Jev sent a purpose or a main region.
  useEffect(() => {
    if (tab === 'page' && !hasPageRead(s.understanding)) setTab('elements');
  }, [tab, s.understanding]);

  // Entry: replay when Jev's answers land (or when the Lens opens on answers that are already here).
  useEffect(() => {
    needOrder.current = true;
    lastCss.current = new WeakMap();
    setSteady(false);
    setEnterKey((k) => k + 1);
    const t = window.setTimeout(() => setSteady(true), 1400);
    return () => window.clearTimeout(t);
  }, [answered]);

  // New answers: lay out, probe what covers what, lay out again, all before the first paint (no hatch over a chat panel).
  useLayoutEffect(() => {
    try {
      clips.current.clear();
      pass();
      probe();
      pass();
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // A new hover, a toggled rule or sheet: lay out again before paint.
  useLayoutEffect(() => {
    try {
      pass();
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleOn, rowHot, pinnedId, cardId, sheetOpen, scale, zoom, bottomReserve, tab]);

  // After every render, the DOM nodes for the current plan exist: write their geometry, then read the chips'
  // real widths; if the font drew them wider or narrower than estimated, lay out once more with the real sizes.
  useLayoutEffect(() => {
    applyGeometry(planRef.current);
    let changed = false;
    for (const c of planRef.current.chips) {
      const el = chipEls.current.get(c.key);
      if (!el) continue;
      const w = el.offsetWidth;
      const k = chipKey(c.cls, c.words, c.num, live.current.scale);
      if (w > 0 && Math.abs(w - c.w) > 1 && measured.current.get(k) !== w) {
        measured.current.set(k, w);
        changed = true;
      }
    }
    if (changed) {
      try {
        pass();
      } catch {
        /* ignore */
      }
    }
  });

  // Header: drop the least important numbers when the row does not fit.
  const t = jevTotals(s);
  const statsKey = `${t.decisions}|${t.cached}|${t.headlineMs}|${t.costUsd}|${asking}|${sheetOpen}|${Math.round(window.innerWidth / 40)}|${scale.toFixed(3)}|${line?.sentence ?? ''}`;

  const decisionsShown = useCount(t.decisions, enterKey, reduce);
  const plan = planRef.current;
  const listedCount = [...plan.listed].filter((id) => plan.status.get(id) === 'shown').length;
  // Header: drop the least important numbers, one step at a time, until the row fits.
  useLayoutEffect(() => {
    const h = headRef.current;
    if (!h) return;
    let lvl = 0;
    h.removeAttribute('data-clip');
    for (; lvl < 7; lvl++) {
      h.setAttribute('data-fit', String(lvl));
      if (h.scrollWidth <= h.clientWidth + 1) break;
    }
    fitRef.current = lvl;
    h.setAttribute('data-fit', String(lvl));
    if (h.scrollWidth > h.clientWidth + 1) h.setAttribute('data-clip', '1');
  }, [statsKey, items.length, listedCount, answered, ruleOn]);
  const focusId = rowHot;

  const pendingText = !s.digest
    ? 'Reading the page…'
    : asking
      ? `Asking Jev about ${items.length} elements…`
      : !answered
        ? 'Jev did not answer for this page. Only page-wide changes from the fit are applied.'
        : null;

  const raw = useMemo(() => {
    const u = s.understanding;
    if (!u) return null;
    return {
      model: u.metrics?.model,
      cached: u.cached,
      metrics: u.metrics,
      firstRead: u.firstRead ?? null,
      sent: s.digest ? { page: s.digest.page, elements: s.digest.elements } : null,
      answered: {
        elements: u.elements,
        mainPick: u.mainPick,
        ...(u.purpose ? { purpose: u.purpose } : {}),
        ...(u.mainRegion ? { mainRegion: u.mainRegion } : {}),
      },
      decisions: s.decisions.map((d) => ({ id: d.id, verdict: d.verdict, reasons: d.reasons })),
    };
  }, [s.understanding, s.digest, s.decisions]);

  const rowClick = (id: string) => {
    const el = api.elementFor(id);
    if (el && planRef.current.status.get(id) !== 'hidden') {
      try {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      } catch {
        el.scrollIntoView();
      }
    }
    setPinnedId(pinnedId === id ? null : id);
  };

  const paraClick = (id: string) => {
    const el = api.elementFor(id);
    if (!el) return;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    } catch {
      el.scrollIntoView();
    }
  };
  const paraLine = paraSummary(s.reword);

  const chips = [...plan.chips].sort((a, b) => Number(a.icon === 'page') - Number(b.icon === 'page'));
  const showCard = Boolean(cardItem && plan.status.get(cardItem.id) === 'shown');
  const tabShown: SheetTab = tab === 'page' && !hasPageRead(s.understanding) ? 'elements' : tab;
  const regionName = region ? regionLabel(region.id, new Map(items.map((i) => [i.id, i.label])), s.digest) : '';

  return (
    <div
      class="wa-lens"
      ref={rootRef}
      data-wa-lens=""
      data-state={answered ? 'answered' : asking ? 'asking' : 'none'}
      data-phase={steady ? 'steady' : 'enter'}
      data-motion={reduce ? 'reduce' : 'full'}
      data-focus={focusId ? 'on' : undefined}
      data-rule={ruleOn ? 'on' : undefined}
      style={{ '--lu': `${scale}px`, '--lbottom': lbottom.current || `${Math.round(10 * scale)}px` }}
    >
      <div class="wa-lpage" aria-hidden="true" key={`e${enterKey}`}>
        {answered && (
          <svg class="wa-lscrim" width="100%" height="100%">
            <path ref={pathRef} fill-rule="evenodd" d={plan.scrim} />
          </svg>
        )}
        {answered && <div class="wa-lhatch" ref={hatchRef} />}
        <div class="wa-lboxes">
          {plan.regionRect && <div class="wa-lregion" ref={regionRef} />}
          {items.map((it) => (
            <div
              key={`${it.id}:${it.cls}`}
              class="wa-lbox"
              data-c={it.cls}
              data-weight={regionId === it.id ? undefined : it.weight ?? undefined}
              data-rank={it.importance != null ? String(it.importance) : undefined}
              data-frame={regionId === it.id ? 'outer' : undefined}
              data-covered={covered.current.has(it.id) ? 'true' : undefined}
              data-hot={focusId === it.id || cardId === it.id ? 'true' : undefined}
              ref={(el) => {
                if (el) boxEls.current.set(it.id, el);
                else boxEls.current.delete(it.id);
              }}
            />
          ))}
          {ruleOn && rule.mainId && <div class="wa-lbox wa-lrulebox" data-c="rule" ref={ruleBoxRef} />}
        </div>
        <svg class="wa-lleads" width="100%" height="100%">
          {chips
            .filter((c) => c.leader)
            .map((c) => (
              <line
                key={c.key}
                data-c={c.icon}
                ref={(el) => {
                  if (el) leadEls.current.set(c.key, el);
                  else leadEls.current.delete(c.key);
                }}
              />
            ))}
        </svg>
        <div class="wa-lchips">
          {chips.map((c) => (
            <div
              key={c.key}
              class="wa-lchip"
              data-c={c.icon}
              data-hot={c.ids.includes(focusId ?? '') || c.ids.includes(cardId ?? '') ? 'true' : undefined}
              ref={(el) => {
                if (el) chipEls.current.set(c.key, el);
                else chipEls.current.delete(c.key);
              }}
            >
              <ClassIcon cls={c.icon} size={c.cls === 'main' ? 13 : 12} />
              <span class="wa-lchip-t">{c.words}</span>
              {c.num && <b class="wa-lchip-n">{c.num}</b>}
            </div>
          ))}
        </div>
      </div>

      <Paras
        api={api}
        reword={s.reword}
        scale={scale}
        avoid={() => [headRef.current, sheetRef.current, cardRef.current]}
        onTags={(r) => {
          paraTags.current = r;
        }}
      />

      {showCard && cardItem && (
        <Card
          item={cardItem}
          pinned={pinnedId === cardItem.id}
          covered={covered.current.get(cardItem.id) ?? null}
          onClose={() => setPinnedId(null)}
          cardRef={cardRef}
        />
      )}

      <div class="wa-lhead-wrap" data-sheet={sheetOpen ? 'open' : undefined}>
        <div
          class="wa-lhead"
          ref={headRef}
          role="region"
          aria-label="Jev Lens"
          data-fit={String(fitRef.current)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') api.toggleLens(false);
          }}
        >
          <span class="wa-lbrand">
            <IDiamond size={13} />
            Jev Lens
          </span>
          <span class="wa-lsep" aria-hidden="true" />
          {line && (
            <>
              <span class="wa-lpurpose" title={line.spoken}>
                Jev read this as {line.article} <em>{line.name}</em> ({f2(line.p)})
              </span>
              <span class="wa-lsep" aria-hidden="true" />
            </>
          )}
          {answered && t.decisions > 0 ? (
            <span class="wa-lstats">
              <span>
                <b class="wa-lcount" style={{ minWidth: `${fmtCount(t.decisions).length}ch` }}>{fmtCount(decisionsShown)}</b> decisions
              </span>
              {t.cached ? (
                <>
                  <i>·</i>
                  <span class="wa-lcache">from cache</span>
                  <i data-o="4">·</i>
                  <span data-o="4" class="wa-lcache">
                    first read {fmtMs(t.headlineMs)}, {fmtCost(t.costUsd)}
                  </span>
                  <i data-o="7">·</i>
                  <span data-o="7" class="wa-lcache">
                    this view <b>{fmtCost(t.viewUsd)}</b>
                  </span>
                </>
              ) : (
                <>
                  <i data-o="4">·</i>
                  <span data-o="4">
                    {t.calls} {t.calls === 1 ? 'call' : 'calls in parallel'}
                  </span>
                  <i>·</i>
                  <span>
                    <b>{fmtMs(t.headlineMs)}</b>
                    {t.serverMs != null && <span data-o="2"> (server {fmtMs(t.serverMs)})</span>}
                  </span>
                  {t.inputTokens > 0 && (
                    <>
                      <i data-o="1">·</i>
                      <span data-o="1">{fmtTokens(t.inputTokens)}</span>
                    </>
                  )}
                  <i data-o="7">·</i>
                  <b data-o="7">{fmtCost(t.costUsd)}</b>
                </>
              )}
              <i data-o="3">·</i>
              <span data-o="3" class="wa-lmodel">{t.model}</span>
            </span>
          ) : (
            <span class="wa-lstats wa-lpending">
              {asking && <span class="wa-lbreath" aria-hidden="true" />}
              {pendingText}
            </span>
          )}
          <span class="wa-lsep" aria-hidden="true" />
          <span class="wa-lbtns">
            <button
              class="wa-lbtn"
              aria-expanded={sheetOpen}
              onClick={() => {
                setSheetOpen(!sheetOpen);
                if (!sheetOpen) setTab('elements');
              }}
              title="List every element Jev was asked about"
            >
              <span>
                {items.length}
                <span data-o="6"> elements</span>
              </span>
              {listedCount > 0 && <span class="wa-lbadge" data-o="5">+{listedCount} in list</span>}
              <IChevronRight size={12} />
            </button>
            <button
              class="wa-lbtn"
              aria-pressed={ruleOn}
              disabled={!answered}
              onClick={() => {
                const on = !ruleOn;
                setRuleOn(on);
                if (on) {
                  setSheetOpen(true);
                  setTab('elements');
                }
              }}
              title="Compare Jev's choices with a three-line rule on the same evidence"
            >
              <IRule size={12} />
              <span>
                vs <span data-o="6">plain </span>rule
              </span>
            </button>
            <button class="wa-lx" aria-label="Close Jev Lens" title="Close Jev Lens" onClick={() => api.toggleLens(false)}>
              <IClose size={15} />
            </button>
          </span>
        </div>
      </div>

      {sheetOpen && (
        <Sheet
          items={items}
          status={plan.status}
          covered={covered.current}
          listed={plan.listed}
          tab={tabShown}
          onTab={setTab}
          hotId={rowHot ?? cardId}
          pinnedId={pinnedId}
          revealId={hoverId}
          onRowHover={setRowHot}
          onRowFocus={setRowFocus}
          onRowClick={rowClick}
          onClose={() => setSheetOpen(false)}
          ruleOn={ruleOn}
          diff={diff}
          digest={s.digest}
          understanding={s.understanding}
          raw={raw}
          pendingText={pendingText}
          sheetRef={sheetRef}
          reword={s.reword}
          onParaClick={paraClick}
          compose={s.compose}
        />
      )}
      <span class="wa-lsr" role="status">
        {answered && t.decisions > 0
          ? `Jev Lens: ${line ? `${line.spoken} ` : ''}${fmtCount(t.decisions)} decisions${t.cached ? ', from cache' : `, ${fmtMs(t.headlineMs)}, ${fmtCost(t.costUsd)}`}.${region ? ` What this page is for: ${regionName}, Jev's probability ${f2(region.p)}.` : ''}${mainItem ? ` Main action: ${mainItem.label}, Jev's probability ${f2(mainItem.p ?? 0)}.` : ''}`
          : `${line ? `${line.spoken} ` : ''}${pendingText ?? ''}`}
        {paraLine ? ` Paragraphs: ${paraLine}.` : ''}
      </span>
    </div>
  );
}
