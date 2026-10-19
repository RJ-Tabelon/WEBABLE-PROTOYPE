import { heuristicSpec } from '@webable/core/compose/heuristic';
import type {
  PageSpec,
  StoredSpec,
  ValidatedSpec,
} from '@webable/core/compose/spec';
import { validateSpec } from '@webable/core/compose/validate';
import { localVerdicts } from '@webable/core/decide/verdict';
import { solveFitLayout } from '@webable/core/fit/solver';
import type { FitLayout } from '@webable/core/fit/types';
import { initialLearningState, toDay } from '@webable/core/learning/learners';
import type { PageSignal, RegionRole } from '@webable/core/page/constants';
import type { PageSignals } from '@webable/core/page/types';
import { vocabFilter } from '@webable/core/page/vocab';
import { buildPlan } from '@webable/core/policy/decide';
import type { AdaptationPlan, AppliedChange } from '@webable/core/policy/types';
import { needLevels } from '@webable/core/profile/needs';
import type { FitProfile } from '@webable/core/profile/schema';
import {
  fromStoredSpec,
  nameKey,
  toStoredSpec,
} from '@webable/core/skeleton/locate';
import { toWireSkeleton } from '@webable/core/skeleton/to-wire';
import type { SkeletonNode } from '@webable/core/skeleton/types';
import { triage } from '@webable/core/triage/triage';
import {
  COMPOSE_PINNED_MODEL,
  COMPOSE_SCHEMA_VERSION,
} from '@webable/core/versions';
import type { TriageVerdict } from '@webable/core/triage/types';

import { Engine } from '../../lib/engine/engine';
import {
  createFitViewRuntime,
  type FitViewInspect,
} from '../../lib/engine/fitview/index';
import { createLive } from '../../lib/engine/fitview/live';
import {
  meets,
  measureSurface,
  scoreTargets,
  type SurfaceMetrics,
} from '../../lib/engine/fitview/metrics';
import { TIER_CLASS, TIER_NAMES } from '../../lib/engine/fitview/styles';
import type {
  CreateLive,
  EngineApi,
  FitViewRuntime,
  ProxyTarget,
  ViewportGuard,
} from '../../lib/engine/fitview/types';
import { readSkeleton, type SkeletonRead } from '../../lib/engine/skeleton';
import { HOST_TAG } from '../../lib/engine/util/dom';
import { viewportGuard } from '../../lib/engine/verify/checks';
import type {
  ContentReplies,
  ContentToWorker,
  FitViewEvent,
  FitViewOpenReply,
} from '../../lib/protocol';

/**
 * Real-site evaluation bundle (scripts/eval/run.mjs, docs/10 §10). Bundled by
 * the runner with esbuild into an IIFE and evaluated in a CDP isolated world,
 * as the extension's content scripts run, after start.ts installed the input
 * firewall there at document_start. Exposes `__wae`; every method returns
 * plain serializable data.
 *
 * It drives the production code end to end without the service worker:
 *
 *   read      Engine.extract (PageSignals with layout), core triage, and the
 *             policy's buildPlan for one persona, each timed
 *   tailor    Engine.apply of that plan after the runner set the page scale
 *             (CDP device metrics); snapshots measure what changed
 *   fit view  readSkeleton -> heuristicSpec (or a planner spec) ->
 *             validateSpec -> solveFitLayout -> createFitViewRuntime().open
 *             with a fake EngineApi and the real live layer (as WP5's
 *             openReal does), then render health and conservation
 *   scorecard fitview/metrics.ts measureSurface on the original document
 *             (before Fit view opens) and on the view's shadow root, with
 *             the docs/11 §4 targets for the persona's structure level
 *
 * Page text stays in this world: what goes back to the runner is numbers,
 * enums, ids and short element descriptions for the local report.
 */

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clean = (s: string | null | undefined): string =>
  (s ?? '').replace(/\s+/g, ' ').trim();
const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const now = (): number => performance.now();
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** A short, stable description of an element for the local report. */
function describe(el: Element | null, text = true): string {
  if (!el) return '(none)';
  const cls = (el.getAttribute('class') ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join('.');
  const id = el.id && el.id.length < 30 ? `#${el.id}` : '';
  const head = `${el.localName}${id}${cls ? `.${cls}` : ''}`;
  if (!text) return head;
  const t = clean(el.getAttribute('aria-label') ?? el.textContent).slice(0, 32);
  return t ? `${head} "${t}"` : head;
}

const visible = (el: Element): boolean => {
  const e = el as Element & {
    checkVisibility?: (o?: Record<string, boolean>) => boolean;
  };
  if (
    e.checkVisibility &&
    !e.checkVisibility({ visibilityProperty: true, opacityProperty: true })
  )
    return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

const siteLabel = (): string => location.hostname.replace(/^www\./, '');

// ---------------------------------------------------------------------------
// Read: extraction, triage, plan
// ---------------------------------------------------------------------------

const noEvents = {
  friction: () => undefined,
  offerAnswer: () => undefined,
  undone: () => undefined,
  routeChanged: () => undefined,
};

let engine: Engine | null = null;

function newEngine(): Engine {
  engine?.destroy();
  engine = new Engine({ vocab: { vocabFilter }, events: noEvents });
  return engine;
}

function planFor(
  profile: FitProfile,
  signals: PageSignals,
  verdict: TriageVerdict,
): AdaptationPlan {
  const t = Date.now();
  const needs = needLevels(profile);
  return buildPlan({
    profile,
    needs,
    signals,
    verdicts: localVerdicts(signals),
    learning: initialLearningState(profile, needs, toDay(t)),
    domain: undefined,
    site: undefined,
    friction: {},
    offersToday: 0,
    offersThisPage: 0,
    tabSession: 'eval',
    now: t,
    profileConfidence:
      profile.calibrationVersion === null ? null : profile.confidence,
    triage: verdict,
  });
}

function withTextMin(profile: FitProfile, px: number): FitProfile {
  const p = structuredClone(profile);
  p.vision.textMinPx = {
    value: px,
    source: 'measured',
    confidence: 0.85,
    measured: px,
  };
  return p;
}

function summarize(s: PageSignals): Record<string, unknown> {
  return {
    category: s.category,
    categoryConfidence: s.categoryConfidence,
    viewport: s.viewport,
    mainFontPx: s.text.mainFontPx,
    totalChars: s.text.totalChars,
    histogram: s.text.histogram.slice(0, 12),
    targets: s.targets,
    contrast: s.contrast,
    sticky: s.sticky,
    motion: s.motion,
    forms: s.forms,
    regions: s.regions.length,
    layout: s.layout ?? null,
  };
}

async function read(
  profile: FitProfile,
  sweep: number[] = [],
  sweepBase: FitProfile | null = null,
): Promise<Record<string, unknown>> {
  const e = newEngine();
  const t0 = now();
  const x = await e.extract();
  const extractWallMs = now() - t0;
  const t1 = now();
  const verdict = triage({ profile, signals: x.signals, zoom: 1 });
  const triageMs = now() - t1;
  const t2 = now();
  const plan = planFor(profile, x.signals, verdict);
  const planMs = now() - t2;
  const swept = sweep.map((F) => {
    const v = triage({
      profile: withTextMin(sweepBase ?? profile, F),
      signals: x.signals,
      zoom: 1,
    });
    return {
      F,
      verdict: v.verdict,
      k: v.k,
      zoom: v.zoom,
      residual: v.residual,
      text: v.needs.text,
      representable: v.representable,
    };
  });
  return {
    perf: {
      extractBusyMs: r2(x.perf.busyMs),
      extractWallMs: r2(extractWallMs),
      triageMs: r2(triageMs),
      planMs: r2(planMs),
      nodes: x.perf.nodes,
      truncated: x.perf.truncated,
    },
    verdict,
    plan,
    signals: summarize(x.signals),
    pageSignals: x.evidence.page.signals,
    sweep: swept,
  };
}

// ---------------------------------------------------------------------------
// Tailor
// ---------------------------------------------------------------------------

const slim = (cs: AppliedChange[]) =>
  cs.map((c) => ({
    op: c.op,
    level: c.level,
    mode: c.mode,
    status: c.status,
    vcode: c.vcode ?? null,
    count: c.count,
    fit: c.fit ?? null,
  }));

async function tailor(plan: AdaptationPlan): Promise<Record<string, unknown>> {
  const e = engine ?? newEngine();
  const t0 = now();
  const changes = await e.apply(plan, { replace: true });
  return {
    applyMs: r2(now() - t0),
    changes: slim(changes),
    perf: {
      verifyMs: r2(e.perf.verifyMs),
      writeMs: r2(e.perf.writeMs),
      layoutMs: r2(e.perf.layoutMs),
    },
  };
}

function changes(): ReturnType<typeof slim> {
  return engine ? slim(engine.changes()) : [];
}

async function undoAll(): Promise<boolean> {
  if (!engine) return false;
  await engine.undo('all');
  engine.destroy();
  engine = null;
  return true;
}

// ---------------------------------------------------------------------------
// Snapshots: hierarchy, consistency, truncation, overlap, rows
// ---------------------------------------------------------------------------

interface LeafRec {
  px: number;
  region: string;
  sig: string;
  trunc: boolean;
  text: string;
  /** Document y of the box top, CSS px. */
  top: number;
}

interface Snap {
  zoom: number;
  vw: number;
  vh: number;
  overflowPx: number;
  leaves: Map<number, LeafRec>;
  /** Element ids in the overlap band (text, controls, media). */
  band: Set<number>;
  overlaps: Set<string>;
  rows: Map<string, { sig: string; heights: number[] }>;
  guard: ViewportGuard;
}

const elIds = new WeakMap<Element, number>();
const byId = new Map<number, WeakRef<Element>>();
let nextElId = 1;
function idOf(el: Element): number {
  let i = elIds.get(el);
  if (!i) {
    i = nextElId++;
    elIds.set(el, i);
    byId.set(i, new WeakRef(el));
  }
  return i;
}

const SKIP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'math',
  'head',
  'title',
  'option',
  'select',
  'textarea',
  'iframe',
  'canvas',
  'video',
  'audio',
  'picture',
  HOST_TAG,
]);
const CONTROL =
  'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"]';
const MEDIA = new Set(['img', 'svg', 'video', 'canvas', 'picture']);

function* walkAll(root: ParentNode): Generator<Element> {
  const stack: Element[] = Array.from(root.children).reverse();
  while (stack.length) {
    const el = stack.pop() as Element;
    if (el.localName === HOST_TAG) continue;
    yield el;
    if (SKIP.has(el.localName)) continue;
    const kids = Array.from(el.children);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as Element);
    const sr = (el as HTMLElement).shadowRoot;
    if (sr) {
      const sk = Array.from(sr.children);
      for (let i = sk.length - 1; i >= 0; i--) stack.push(sk[i] as Element);
    }
  }
}

function directText(el: Element): string {
  let s = '';
  for (const c of Array.from(el.childNodes))
    if (c.nodeType === 3) s += c.nodeValue ?? '';
  return clean(s);
}

function sigOf(el: Element): string {
  const part = (e: Element | null): string => {
    if (!e) return '';
    const cls = (e.getAttribute('class') ?? '')
      .trim()
      .split(/\s+/)
      .filter((c) => c && !/^(is-|has-|active|selected|hover|focus)/.test(c))
      .sort()
      .slice(0, 3)
      .join('.');
    return `${e.localName}${cls ? `.${cls}` : ''}`;
  };
  return `${part(el.parentElement)}>${part(el)}`;
}

function parentAcross(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function regionResolver(roots: Map<Element, string>): (el: Element) => string {
  const cache = new Map<Element, string>();
  return (el) => {
    const chain: Element[] = [];
    let n: Element | null = el;
    let key = 'page';
    while (n) {
      const hit = cache.get(n);
      if (hit) {
        key = hit;
        break;
      }
      const k = roots.get(n);
      if (k) {
        key = k;
        break;
      }
      chain.push(n);
      n = parentAcross(n);
    }
    for (const c of chain) cache.set(c, key);
    return key;
  };
}

function isTruncated(el: Element): boolean {
  let n: Element | null = el;
  for (let i = 0; n && i < 3; i++, n = n.parentElement) {
    const h = n as HTMLElement;
    const cs = getComputedStyle(n);
    if (
      cs.textOverflow === 'ellipsis' &&
      cs.overflowX !== 'visible' &&
      h.scrollWidth > h.clientWidth + 1
    )
      return true;
    const clamp = cs.getPropertyValue('-webkit-line-clamp');
    if (
      clamp &&
      clamp !== 'none' &&
      h.clientHeight > 0 &&
      h.scrollHeight > h.clientHeight + 1
    )
      return true;
    if (
      i <= 1 &&
      (cs.overflowY === 'hidden' || cs.overflowY === 'clip') &&
      h.clientHeight > 0 &&
      h.scrollHeight > h.clientHeight + 2 &&
      h.clientHeight < 6 * parseFloat(cs.fontSize || '16')
    )
      return true;
  }
  return false;
}

/** The part of an element's box its clipping ancestors leave visible (null: none). */
function clippedRect(
  el: Element,
  cache: Map<Element, DOMRect | null>,
): DOMRect | null {
  const r = el.getBoundingClientRect();
  let left = r.left;
  let top = r.top;
  let right = r.right;
  let bottom = r.bottom;
  let n = parentAcross(el);
  for (let i = 0; n && i < 14; i++, n = parentAcross(n)) {
    if (n === document.body || n === document.documentElement) break;
    let c = cache.get(n);
    if (c === undefined) {
      const cs = getComputedStyle(n);
      c =
        cs.overflowX !== 'visible' || cs.overflowY !== 'visible'
          ? n.getBoundingClientRect()
          : null;
      cache.set(n, c);
    }
    if (c) {
      left = Math.max(left, c.left);
      top = Math.max(top, c.top);
      right = Math.min(right, c.right);
      bottom = Math.min(bottom, c.bottom);
      if (right <= left || bottom <= top) return null;
    }
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

const snaps = new Map<string, Snap>();

function snapshot(name: string, zoom: number): Record<string, unknown> {
  const t0 = now();
  const vw = innerWidth;
  const vh = innerHeight;
  const sy = scrollY;
  const roots = engine?.regionKeys() ?? new Map<Element, string>();
  const regionOf = regionResolver(roots);
  const leaves = new Map<number, LeafRec>();
  const band = new Set<number>();
  const boxes: Array<{
    id: number;
    el: Element;
    r: DOMRect;
    text: boolean;
    /** Inline boxes in one line container never overlap each other visually. */
    line: Element | null;
  }> = [];
  const rows = new Map<string, { sig: string; heights: number[] }>();
  const clipCache = new Map<Element, DOMRect | null>();
  let rowParents = 0;
  for (const el of walkAll(document.body)) {
    if (leaves.size >= 2500 && boxes.length >= 1500) break;
    const t = SKIP.has(el.localName) ? '' : directText(el);
    const isCtrl = el.matches(CONTROL);
    const isMedia = MEDIA.has(el.localName);
    if (!t && !isCtrl && !isMedia && el.childElementCount < 4) continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const docTop = r.top + sy;
    const inBand = docTop < 2 * vh && r.bottom + sy > 0;
    if (t && leaves.size < 2500) {
      const id = idOf(el);
      const cs = getComputedStyle(el);
      leaves.set(id, {
        px: parseFloat(cs.fontSize) || 0,
        region: regionOf(el),
        sig: sigOf(el),
        trunc: docTop < 3 * vh ? isTruncated(el) : false,
        text: t.slice(0, 24),
        top: docTop,
      });
    }
    if (inBand && (t || isCtrl || isMedia) && boxes.length < 1500) {
      const id = idOf(el);
      band.add(id);
      // Overlap is judged on what is visible: clipped overflow does not count.
      const cr = clippedRect(el, clipCache);
      if (cr && cr.width * cr.height >= 16) {
        let line: Element | null = null;
        if (getComputedStyle(el).display.startsWith('inline')) {
          line = el.parentElement;
          while (
            line &&
            getComputedStyle(line).display.startsWith('inline') &&
            line.parentElement
          )
            line = line.parentElement;
        }
        boxes.push({ id, el, r: cr, text: !!t, line });
      }
    }
    if (
      el.childElementCount >= 4 &&
      docTop < 3 * vh &&
      rowParents < 300 &&
      !SKIP.has(el.localName)
    ) {
      const groups = new Map<string, number[]>();
      for (const c of Array.from(el.children)) {
        if (!visible(c)) continue;
        const s = sigOf(c);
        const list = groups.get(s) ?? [];
        list.push(c.getBoundingClientRect().height);
        groups.set(s, list);
      }
      for (const [s, hs] of groups)
        if (hs.length >= 4) {
          rows.set(`${idOf(el)}|${s}`, { sig: s, heights: hs });
          rowParents++;
        }
    }
  }
  // Overlap: a text box against any other box it neither contains nor sits in.
  const overlaps = new Set<string>();
  boxes.sort((a, b) => a.r.top - b.r.top);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      if (b.r.top >= a.r.bottom) break;
      if (!a.text && !b.text) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const hh = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w <= 0 || hh <= 0) continue;
      const inter = w * hh;
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (inter < Math.max(16, 0.3 * small)) continue;
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // Siblings on one line (an ellipsised run reports boxes past its cut).
      if (a.line && a.line === b.line) continue;
      overlaps.add(a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);
    }
  }
  const root = document.documentElement;
  const snap: Snap = {
    zoom,
    vw,
    vh,
    overflowPx: Math.max(0, Math.round(root.scrollWidth - root.clientWidth)),
    leaves,
    band,
    overlaps,
    rows,
    guard: viewportGuard(document),
  };
  snaps.set(name, snap);
  let truncated = 0;
  for (const l of leaves.values()) if (l.trunc) truncated++;
  return {
    name,
    ms: r1(now() - t0),
    vw,
    vh,
    leaves: leaves.size,
    band: band.size,
    overlaps: overlaps.size,
    truncated,
    rows: rows.size,
    overflowPx: snap.overflowPx,
    guard: snap.guard,
  };
}

function describeId(id: number): string {
  return describe(byId.get(id)?.deref() ?? null, false);
}

/**
 * What changed between two snapshots (docs/10 §10 Tailor gates): size-rank
 * inversions per region (Kendall tau-b on effective px), template
 * consistency, row heights, new truncation, new overlap, overflow.
 */
function compare(aName: string, bName: string): Record<string, unknown> {
  const a = snaps.get(aName);
  const b = snaps.get(bName);
  if (!a || !b) return { error: 'missing snapshot' };
  const TIE = 0.5;

  // Hierarchy: per region, pairs whose order of effective size flipped.
  const regions = new Map<
    string,
    Array<{
      id: number;
      x: number;
      y: number;
      sig: string;
      text: string;
      top: number;
    }>
  >();
  for (const [id, la] of a.leaves) {
    const lb = b.leaves.get(id);
    if (!lb || la.px <= 0 || lb.px <= 0) continue;
    const list = regions.get(la.region) ?? [];
    list.push({
      id,
      x: la.px * a.zoom,
      y: lb.px * b.zoom,
      sig: la.sig,
      text: la.text,
      top: la.top,
    });
    regions.set(la.region, list);
  }
  let inversions = 0;
  /** Inversions between texts within one screen height of each other (seen together). */
  let local = 0;
  let regionsWith = 0;
  let tauMin = 1;
  let paired = 0;
  const invExamples: string[] = [];
  const perRegion: Array<{
    region: string;
    n: number;
    tau: number;
    inversions: number;
  }> = [];
  for (const [region, all] of regions) {
    if (all.length < 2) continue;
    const step = Math.max(1, Math.ceil(all.length / 1200));
    const list = all.filter((_, i) => i % step === 0);
    let C = 0;
    let D = 0;
    let Ta = 0;
    let Tb = 0;
    let shown = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const q = list[j]!;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const tx = Math.abs(dx) < TIE;
        const ty = Math.abs(dy) < TIE;
        if (tx && ty) continue;
        if (tx) {
          Ta++;
          continue;
        }
        if (ty) {
          Tb++;
          continue;
        }
        if (dx * dy > 0) C++;
        else {
          D++;
          if (Math.abs(p.top - q.top) <= a.vh) local++;
          if (shown < 2 && invExamples.length < 12) {
            shown++;
            const [lo, hi] = dx < 0 ? [p, q] : [q, p];
            invExamples.push(
              `${region}: ${lo.sig} "${lo.text}" ${r1(lo.x)}→${r1(lo.y)} vs ${hi.sig} "${hi.text}" ${r1(hi.x)}→${r1(hi.y)}`,
            );
          }
        }
      }
    }
    const den = Math.sqrt((C + D + Ta) * (C + D + Tb));
    const tau = den > 0 ? (C - D) / den : 1;
    paired += list.length;
    inversions += D;
    if (D > 0) regionsWith++;
    tauMin = Math.min(tauMin, tau);
    perRegion.push({ region, n: list.length, tau: r2(tau), inversions: D });
  }
  perRegion.sort((x, y) => y.inversions - x.inversions);

  // Consistency: one size per template field before -> one size after.
  const groups = new Map<string, Array<{ x: number; y: number }>>();
  for (const [id, la] of a.leaves) {
    const lb = b.leaves.get(id);
    if (!lb) continue;
    const k = `${la.region}|${la.sig}`;
    const list = groups.get(k) ?? [];
    list.push({ x: la.px * a.zoom, y: lb.px * b.zoom });
    groups.set(k, list);
  }
  const half = (v: number): number => Math.round(v * 2) / 2;
  let checked = 0;
  let broken = 0;
  const consExamples: string[] = [];
  for (const [k, list] of groups) {
    if (list.length < 3) continue;
    const before = new Set(list.map((p) => half(p.x)));
    if (before.size !== 1) continue;
    checked++;
    const after = [...new Set(list.map((p) => half(p.y)))].sort(
      (x, y) => x - y,
    );
    if (after.length > 1 && (after.at(-1) ?? 0) - (after[0] ?? 0) >= 1) {
      broken++;
      if (consExamples.length < 8)
        consExamples.push(
          `${k} (${list.length}): ${[...before][0]} → ${after.slice(0, 6).join('/')}`,
        );
    }
  }

  // Row heights within a template.
  let rowsChecked = 0;
  let rowsBroken = 0;
  const rowExamples: string[] = [];
  for (const [k, ra] of a.rows) {
    const rb = b.rows.get(k);
    if (!rb || ra.heights.length !== rb.heights.length) continue;
    const ha = ra.heights.filter((h) => h > 0);
    const hb = rb.heights.filter((h) => h > 0);
    if (ha.length < 4 || hb.length < 4) continue;
    const spread = (hs: number[]): number =>
      Math.max(...hs) / Math.max(1, Math.min(...hs));
    if (spread(ha) > 1.08) continue;
    rowsChecked++;
    if (spread(hb) > 1.15) {
      rowsBroken++;
      if (rowExamples.length < 6)
        rowExamples.push(
          `${ra.sig}: ${Math.round(Math.min(...ha))}-${Math.round(Math.max(...ha))} → ${Math.round(Math.min(...hb))}-${Math.round(Math.max(...hb))}`,
        );
    }
  }

  // Truncation and overlap that are new in b.
  let truncA = 0;
  let truncB = 0;
  let truncNew = 0;
  const truncExamples: string[] = [];
  for (const l of a.leaves.values()) if (l.trunc) truncA++;
  for (const [id, lb] of b.leaves) {
    if (!lb.trunc) continue;
    truncB++;
    const la = a.leaves.get(id);
    if (la && !la.trunc) {
      truncNew++;
      if (truncExamples.length < 8)
        truncExamples.push(`${lb.sig} "${lb.text}"`);
    }
  }
  let overNew = 0;
  const overExamples: string[] = [];
  for (const key of b.overlaps) {
    if (a.overlaps.has(key)) continue;
    const [x, y] = key.split(':').map(Number) as [number, number];
    if (!a.band.has(x) || !a.band.has(y)) continue;
    overNew++;
    if (overExamples.length < 8)
      overExamples.push(`${describeId(x)} × ${describeId(y)}`);
  }

  return {
    hierarchy: {
      regions: perRegion.length,
      paired,
      inversions,
      localInversions: local,
      regionsWithInversions: regionsWith,
      tauMin: r2(tauMin),
      perRegion: perRegion.slice(0, 8),
      examples: invExamples,
    },
    consistency: { groups: checked, broken, examples: consExamples },
    rows: { groups: rowsChecked, broken: rowsBroken, examples: rowExamples },
    truncation: {
      before: truncA,
      after: truncB,
      new: truncNew,
      examples: truncExamples,
    },
    overlap: {
      before: a.overlaps.size,
      after: b.overlaps.size,
      new: overNew,
      examples: overExamples,
    },
    overflow: { before: a.overflowPx, after: b.overflowPx },
    guard: { before: a.guard, after: b.guard },
  };
}

// ---------------------------------------------------------------------------
// Fit view
// ---------------------------------------------------------------------------

interface Reader {
  regionKeys: Map<Element, string>;
  verdicts: Record<string, RegionRole>;
  signals: PageSignal[];
}
let reader: Reader | null = null;

/** One extraction at the person's own zoom: region keys and rule verdicts for the skeleton. */
async function prepare(): Promise<Record<string, unknown>> {
  const e = new Engine({ vocab: { vocabFilter }, events: noEvents });
  try {
    const x = await e.extract();
    const verdicts: Record<string, RegionRole> = {};
    for (const [k, v] of Object.entries(localVerdicts(x.signals)))
      if (v.role) verdicts[k] = v.role;
    reader = {
      regionKeys: e.regionKeys(),
      verdicts,
      signals: x.evidence.page.signals,
    };
    return {
      regions: reader.regionKeys.size,
      verdicts: Object.keys(verdicts).length,
      pageSignals: reader.signals,
    };
  } finally {
    e.destroy();
  }
}

const hctx = () => ({
  verdicts: reader?.verdicts ?? {},
  signals: reader?.signals ?? [],
});

const readPage = (): Promise<SkeletonRead | null> =>
  readSkeleton(document, { regionKeys: reader?.regionKeys });

function specSummary(v: ValidatedSpec): Record<string, unknown> {
  return {
    page_type: v.spec.page_type,
    primary_task: v.spec.primary_task,
    primary: v.primary,
    sections: v.spec.sections.map((s) => ({
      kind: s.kind,
      importance: s.importance,
      layout: s.layout,
      ids: s.node_ids.length,
      heading: s.heading_ref !== null,
    })),
    collections: v.spec.collections.map((c) => ({
      list: c.list_id,
      item_kind: c.item_kind,
      open: c.open_slot !== null,
      roles: c.fields.map((f) => `${f.role}:${f.show}`),
    })),
    rest: v.rest.length,
    repairs: v.repairs.map((r) => r.kind),
  };
}

let planned: SkeletonRead | null = null;

/**
 * The skeleton the planner plans from (read once per page, at 100%), its
 * wire form, and the heuristic spec for the same extraction. The skeleton
 * (with its local labels) goes to the runner only to be frozen in the
 * gitignored output for the planner benchmark.
 */
async function plannerSkeleton(): Promise<Record<string, unknown>> {
  const t0 = now();
  const r = await readPage();
  const ms = now() - t0;
  if (!r) return { ok: false, why: 'unreadable' };
  planned = r;
  let wire: unknown = null;
  let wireError: string | null = null;
  try {
    wire = toWireSkeleton(r.skeleton);
  } catch (err) {
    wireError = String(err);
  }
  const t1 = now();
  const spec = heuristicSpec(r.skeleton, hctx());
  const t2 = now();
  const validated = validateSpec(spec, r.skeleton, {
    siteHost: location.hostname,
  });
  const t3 = now();
  return {
    ok: true,
    readMs: r1(ms),
    readBusyMs: r.skeleton.perf.ms,
    nodes: r.skeleton.nodes.length,
    truncated: r.skeleton.truncated,
    skeleton: r.skeleton,
    context: hctx(),
    wire,
    wireError,
    heuristic: {
      spec,
      specMs: r2(t2 - t1),
      validateMs: r2(t3 - t2),
      validated: validated ? specSummary(validated) : null,
    },
  };
}

/** A CSS selector for an element (ids where unique, else classes and nth-of-type). */
function selectorOf(el: Element): string {
  const parts: string[] = [];
  for (
    let n: Element | null = el;
    n && n !== document.body;
    n = n.parentElement
  ) {
    if (
      n.id &&
      /^[A-Za-z][\w-]*$/.test(n.id) &&
      document.querySelectorAll(`#${n.id}`).length === 1
    ) {
      parts.unshift(`#${n.id}`);
      break;
    }
    const cls = (n.getAttribute('class') ?? '')
      .trim()
      .split(/\s+/)
      .filter((c) => /^[A-Za-z][\w-]*$/.test(c))
      .slice(0, 2);
    let step = n.localName + cls.map((c) => `.${c}`).join('');
    const parent: Element | null = n.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.matches(step));
      if (same.length > 1)
        step += `:nth-of-type(${
          Array.from(parent.children)
            .filter((c) => c.localName === n!.localName)
            .indexOf(n) + 1
        })`;
    }
    parts.unshift(step);
    if (parts.length >= 6) break;
  }
  return parts.join(' > ');
}

/**
 * The planned skeleton as an indented outline with a selector per node, for
 * hand-labelling answer keys (scripts/eval/answer-key.mjs). Local only.
 */
function labelOutline(maxDepth = 7): string {
  const r = planned;
  if (!r) return 'no skeleton';
  const lines: string[] = [];
  for (const n of r.skeleton.nodes) {
    if (n.slot && n.kind !== 'heading' && n.kind !== 'control') continue;
    if (n.depth > maxDepth && n.kind !== 'collection' && n.kind !== 'input')
      continue;
    const el = r.registry.element(n.id);
    const label = clean(n.label).slice(0, 40);
    lines.push(
      `${'  '.repeat(Math.min(n.depth, 12))}${n.id} ${n.kind}${n.role ? `[${n.role}]` : ''} ${n.tag}${n.collection ? ` LIST n=${n.collection.count}` : ''}${n.slot ? ' slot' : ''} [${n.box.join(',')}]${label ? ` "${label}"` : ''}  ${el ? selectorOf(el) : ''}`,
    );
  }
  return lines.join('\n');
}

/** Answer-key selectors resolved to node ids of the planned skeleton. */
interface KeySel {
  main?: string[];
  search?: string[];
  nav?: string[];
  lists?: Array<{ sel: string; title?: string }>;
  clutter?: string[];
}

function resolveKey(key: KeySel): Record<string, unknown> {
  const r = planned;
  if (!r) return { error: 'no skeleton' };
  const idByEl = new Map<Element, string>();
  for (const n of r.skeleton.nodes) {
    const el = r.registry.element(n.id);
    if (el && !n.slot) idByEl.set(el, n.id);
  }
  const nodes = new Map(r.skeleton.nodes.map((n) => [n.id, n] as const));
  const first = (sels: string[] | undefined): Element | null => {
    for (const s of sels ?? []) {
      let all: Element[] = [];
      try {
        all = Array.from(document.querySelectorAll(s));
      } catch {
        continue;
      }
      const el = all.find(visible) ?? null;
      if (el) return el;
    }
    return null;
  };
  /** The node for an element: itself, else its nearest kept ancestor. */
  const up = (el: Element | null): string | null => {
    for (let n = el; n; n = parentAcross(n)) {
      const id = idByEl.get(n);
      if (id) return id;
    }
    return null;
  };
  /** Highest kept descendant of an element (when the element itself was folded away). */
  const down = (el: Element | null): string | null => {
    if (!el) return null;
    let best: SkeletonNode | null = null;
    for (const [e, id] of idByEl) {
      if (!el.contains(e)) continue;
      const n = nodes.get(id);
      if (n && (!best || n.depth < best.depth)) best = n;
    }
    return best?.id ?? null;
  };
  const missing: string[] = [];
  const one = (name: string, sels?: string[]): string | null => {
    if (!sels?.length) return null;
    const el = first(sels);
    const id = el ? (idByEl.get(el) ?? down(el) ?? up(el)) : null;
    if (!id) missing.push(name);
    return id;
  };
  const many = (name: string, sels?: string[]): string[] => {
    const out: string[] = [];
    for (const s of sels ?? []) {
      const id = one(`${name}:${s}`, [s]);
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  };
  const lists = (key.lists ?? []).map((l) => {
    const el = first([l.sel]);
    let listId: string | null = null;
    if (el) {
      // The collection node inside or around the list element.
      for (const n of r.skeleton.nodes) {
        if (n.kind !== 'collection') continue;
        const ce = r.registry.element(n.id);
        if (ce && (ce === el || el.contains(ce) || ce.contains(el))) {
          listId = n.id;
          break;
        }
      }
    }
    if (!listId) missing.push(`list:${l.sel}`);
    let title: string | null = null;
    const node = listId ? nodes.get(listId) : undefined;
    const exId = node?.collection?.exemplar;
    const exEl = exId ? r.registry.element(exId) : null;
    if (exEl && l.title) {
      const tEl = exEl.matches(l.title) ? exEl : exEl.querySelector(l.title);
      if (tEl) {
        // Slot nodes: the exemplar subtree's ids map to the first member's elements.
        let best: SkeletonNode | null = null;
        for (const n of r.skeleton.nodes) {
          if (!n.slot) continue;
          const se = r.registry.element(n.id);
          if (!se) continue;
          if (se === tEl || tEl.contains(se) || se.contains(tEl)) {
            if (
              !best ||
              (se === tEl && r.registry.element(best.id) !== tEl) ||
              n.depth > best.depth
            )
              best = n;
          }
        }
        title = best?.id ?? null;
      }
      if (!title) missing.push(`title:${l.sel}`);
    }
    return { id: listId, title };
  });
  return {
    main: one('main', key.main),
    search: one('search', key.search),
    nav: many('nav', key.nav),
    lists,
    clutter: many('clutter', key.clutter),
    missing,
  };
}

// --- The planner spec, stored as production caches it ---------------------

/** Stand-in for the worker's HMAC of a name (any stable hash keeps locators comparable). */
function nameHash(label: string): string {
  let h = 2166136261;
  const k = nameKey(label);
  for (let i = 0; i < k.length; i++) {
    h ^= k.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

let stored: StoredSpec | null = null;

/**
 * The planner's answer for the planned extraction, validated and stored as
 * locators (core/skeleton/locate.ts), as the worker caches it. Every render
 * re-binds it to a fresh skeleton: the "Switch" path and later opens.
 */
function storePlannerSpec(spec: PageSpec): Record<string, unknown> {
  const r = planned;
  if (!r) return { ok: false, why: 'no skeleton' };
  const t0 = now();
  const validated = validateSpec(spec, r.skeleton, {
    siteHost: location.hostname,
  });
  const t1 = now();
  if (!validated) return { ok: false, why: 'not_representable' };
  stored = toStoredSpec(validated, r.skeleton, nameHash, {
    schema: COMPOSE_SCHEMA_VERSION,
    model: COMPOSE_PINNED_MODEL,
    createdAt: Date.now(),
  });
  return {
    ok: true,
    validateMs: r2(t1 - t0),
    validated: specSummary(validated),
    repairDetail: validated.repairs,
  };
}

// --- The view ---------------------------------------------------------------

type Runtime = FitViewRuntime & FitViewInspect;
let runtime: Runtime | null = null;
let current: SkeletonRead | null = null;
let currentLayout: FitLayout | null = null;
let currentValidated: ValidatedSpec | null = null;
let binds = new Map<HTMLElement, ProxyTarget>();
let actionsTaken: () => number = () => 0;
const events: FitViewEvent[] = [];

const recordingLive: CreateLive = (surface, input) => {
  const live = createLive(surface, input);
  const bind = live.proxies.bind.bind(live.proxies);
  live.proxies.bind = (control, target) => {
    binds.set(control, target);
    bind(control, target);
  };
  actionsTaken = () => live.proxies.actions();
  return live;
};

const fakeEngine: EngineApi = {
  async skeleton() {
    return readPage();
  },
  freeze() {
    // No Tailor runs while the eval has Fit view open.
  },
  async send<T extends ContentToWorker>(
    msg: T,
  ): Promise<ContentReplies[T['type']]> {
    if (msg.type === 'cs:fitview-event') {
      events.push(
        (msg as Extract<ContentToWorker, { type: 'cs:fitview-event' }>).event,
      );
      return { ok: true } as ContentReplies[T['type']];
    }
    if (msg.type === 'cs:fitview-request') {
      // The worker's heuristic path for a fresh skeleton (route changes).
      const m = msg as Extract<ContentToWorker, { type: 'cs:fitview-request' }>;
      const spec = heuristicSpec(m.skeleton, hctx());
      const validated = validateSpec(spec, m.skeleton, {
        siteHost: location.hostname,
      });
      const reply: FitViewOpenReply =
        validated && currentLayout
          ? {
              ok: true,
              envelope: {
                source: 'heuristic',
                extractionId: m.skeleton.extractionId,
                validated,
                createdAt: Date.now(),
              },
              layout: currentLayout,
              zoom: 1,
              site: {
                label: siteLabel(),
                secure: location.protocol === 'https:',
              },
              plannerPending: false,
            }
          : { ok: false, why: 'not_representable' };
      return reply as ContentReplies[T['type']];
    }
    return { ok: true } as unknown as ContentReplies[T['type']];
  },
  onRoute(cb) {
    const on = (): void => cb();
    addEventListener('popstate', on);
    addEventListener('hashchange', on);
    return () => {
      removeEventListener('popstate', on);
      removeEventListener('hashchange', on);
    };
  },
  measured<T>(fn: () => T): T {
    return fn();
  },
};

interface OpenOpts {
  profile: FitProfile;
  /** 'planner' renders the stored planner spec (storePlannerSpec) re-bound to a fresh read. */
  source: 'heuristic' | 'planner';
  font?: string;
}

async function openFitView(o: OpenOpts): Promise<Record<string, unknown>> {
  if (runtime?.isOpen()) runtime.close('original');
  runtime = null;
  events.length = 0;
  binds = new Map();
  actionsTaken = () => 0;
  const t0 = now();
  const r = await readPage();
  const t1 = now();
  if (!r) return { ok: false, why: 'unreadable' };
  let coverage: number | null = null;
  let spec: PageSpec | null = null;
  if (o.source === 'heuristic') spec = heuristicSpec(r.skeleton, hctx());
  else if (stored) {
    const back = fromStoredSpec(stored, r.skeleton, nameHash);
    spec = back.spec;
    coverage = r2(back.coverage);
  }
  const t2 = now();
  if (!spec) return { ok: false, why: 'no_spec' };
  const validated = validateSpec(spec, r.skeleton, {
    siteHost: location.hostname,
  });
  const t3 = now();
  if (!validated) return { ok: false, why: 'not_representable' };
  const layout = solveFitLayout(o.profile);
  const t4 = now();
  currentLayout = layout;
  currentValidated = validated;
  current = r;
  runtime = createFitViewRuntime({
    shadowMode: 'closed',
    createLive: recordingLive,
  });
  try {
    await runtime.open({
      reply: {
        ok: true,
        envelope: {
          source: o.source,
          extractionId: r.skeleton.extractionId,
          validated,
          createdAt: Date.now(),
        },
        layout,
        zoom: 1,
        site: { label: siteLabel(), secure: location.protocol === 'https:' },
        plannerPending: false,
        ...(o.font ? { font: o.font } : {}),
      },
      skeleton: r.skeleton,
      registry: r.registry,
      engine: fakeEngine,
      reason: 'popup',
    });
  } catch (err) {
    return { ok: false, why: 'render_error', error: String(err).slice(0, 300) };
  }
  const t5 = now();
  return {
    ok: true,
    ms: {
      read: r1(t1 - t0),
      spec: r2(t2 - t1),
      validate: r2(t3 - t2),
      solve: r2(t4 - t3),
      open: r1(t5 - t4),
      total: r1(t5 - t0),
      /** The pipeline without the bounded wait for the face (fonts.ts). */
      readBusy: r.skeleton.perf.ms,
    },
    coverage,
    nodes: r.skeleton.nodes.length,
    truncated: r.skeleton.truncated,
    spec: specSummary(validated),
  };
}

const OPERABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], label.fv-check';

function ownControl(el: Element): boolean {
  return (
    el.classList.contains('fv-wa') ||
    el.classList.contains('fv-skip') ||
    el.closest('.fv-onpage') !== null
  );
}

/** Mirrors health.ts: controls that are not separate targets. */
function exemptControl(el: Element): boolean {
  if (el.classList.contains('fv-inline') && !el.closest('.fv-meta'))
    return true;
  if (el.localName === 'input' && el.closest('label.fv-check')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  return false;
}

function viewRoot(): ShadowRoot | null {
  return runtime?.surface()?.root ?? null;
}

function fitMetrics(): Record<string, unknown> {
  const s = runtime?.surface();
  if (!runtime || !s) return { open: false };
  const root = s.root;
  const health = runtime.health();
  const cons = runtime.conservation();
  const layout = runtime.layout();
  const kinds = Array.from(root.querySelectorAll<HTMLElement>('[data-kind]'))
    .map((el) => el.dataset.kind ?? '')
    .filter(Boolean);
  const records = root.querySelectorAll('li.fv-rec').length;
  let controls = 0;
  let boundCount = 0;
  let own = 0;
  const unbound: string[] = [];
  let smallest = Infinity;
  let smallestWhat = '';
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(OPERABLE))) {
    const r = el.getBoundingClientRect();
    if (ownControl(el)) {
      own++;
    } else {
      controls++;
      const row = el.closest('label');
      const inner = el.matches('label')
        ? el.querySelector<HTMLElement>('input')
        : null;
      if (
        binds.has(el) ||
        (row && binds.has(row as HTMLElement)) ||
        (inner && binds.has(inner)) ||
        el.closest('[aria-hidden="true"]')
      )
        boundCount++;
      else if (unbound.length < 6) unbound.push(describe(el));
    }
    if (exemptControl(el) || (r.width === 0 && r.height === 0)) continue;
    const m = Math.min(r.width, r.height);
    if (m < smallest) {
      smallest = m;
      smallestWhat = describe(el);
    }
  }
  const view = root.host.ownerDocument.defaultView ?? window;
  const tiers: Record<string, number | null> = {};
  for (const name of TIER_NAMES) {
    const el = root.querySelector(`.${TIER_CLASS[name]}`);
    tiers[name] = el
      ? r1(parseFloat(view.getComputedStyle(el).fontSize))
      : null;
  }
  const primary = root.querySelector<HTMLElement>('[data-primary="true"]');
  const sr = s.scroller.getBoundingClientRect();
  const primaryTop = primary
    ? Math.round(
        primary.getBoundingClientRect().top - sr.top + s.scroller.scrollTop,
      )
    : null;
  const rest = root.querySelector('.fv-rest');
  return {
    open: true,
    sections: kinds,
    records,
    controls,
    own,
    bound: boundCount,
    boundCalls: runtime.bound(),
    unbound,
    smallestControlPx: Number.isFinite(smallest) ? r1(smallest) : null,
    smallestControl: smallestWhat,
    T: layout?.target.minPx ?? null,
    F: layout?.type.body.px ?? null,
    layoutTiers: layout
      ? Object.fromEntries(
          TIER_NAMES.map((n) => [
            n,
            { px: layout.type[n].px, weight: layout.type[n].weight },
          ]),
        )
      : null,
    renderedTiers: tiers,
    health: health
      ? {
          ok: health.ok,
          overflowPx: health.overflowPx,
          controls: health.controls,
          small: health.small.length,
          smallExamples: health.small.slice(0, 5),
          bodyPx: health.bodyPx,
          failures: health.failures,
          tiers: health.tiers.map((t) => ({
            pair: `${t.upper}/${t.lower}`,
            ratio: r2(t.ratio),
            ok: t.ok,
          })),
        }
      : null,
    conservation: cons
      ? {
          ok: cons.ok,
          checked: cons.checked,
          missing: cons.missing.length,
          missingExamples: cons.missing
            .slice(0, 6)
            .map((id) => describeNode(id)),
          lists: cons.lists,
        }
      : null,
    primaryTop,
    viewportH: s.scroller.clientHeight,
    rest: {
      ids: currentValidated?.rest.length ?? 0,
      controls: rest ? rest.querySelectorAll(OPERABLE).length : 0,
      collapsed: rest
        ? rest.querySelector('[aria-expanded="false"]') !== null
        : null,
    },
    scrollHeight: s.scroller.scrollHeight,
    events: events.map((e) => e.kind),
    proxyFailed: events.filter((e) => e.kind === 'proxy_failed'),
    actions: actionsTaken(),
  };
}

// ---------------------------------------------------------------------------
// Restructure scorecard (docs/11 §4)
// ---------------------------------------------------------------------------

let before: SurfaceMetrics | null = null;

const screen = () => ({ width: innerWidth, height: innerHeight });

/**
 * The original page's scorecard, measured as the person meets it: at 100%,
 * scrolled to the top, with no WebAble changes. Its primary content is the
 * heuristic spec's primary section (the one Fit view puts first).
 */
async function measureOriginal(
  F: number,
  T: number,
): Promise<SurfaceMetrics | { ok: false }> {
  const r = await readPage();
  let primary: Element | null = null;
  if (r) {
    const v = validateSpec(heuristicSpec(r.skeleton, hctx()), r.skeleton, {
      siteHost: location.hostname,
    });
    const sec = v?.spec.sections[v.primary];
    let top = Infinity;
    for (const id of sec?.node_ids ?? []) {
      const el = r.registry.element(id);
      const t = el?.getBoundingClientRect().top ?? Infinity;
      if (el && t < top) {
        top = t;
        primary = el;
      }
    }
  }
  before = measureSurface(document, screen(), { F, T, primary });
  return before;
}

/** Fit view's scorecard on its shadow root, against the original's. */
function measureView(): Record<string, unknown> {
  const s = runtime?.surface();
  const layout = runtime?.layout();
  if (!s || !layout) return { open: false };
  const after = measureSurface(s.root, screen(), {
    F: layout.type.body.px,
    T: layout.target.minPx,
    explain: true,
    // Fit view's own strip controls are counted apart (docs/11 §4).
    own: '.fv-wa-controls',
  });
  const targets = before
    ? scoreTargets(layout.structure.level, before, layout.structure)
    : null;
  return {
    level: layout.structure.level,
    structure: layout.structure,
    before,
    after,
    targets,
    meets: targets ? meets(after, targets) : null,
  };
}

function describeNode(id: string): string {
  const n = current?.skeleton.nodes.find((x) => x.id === id);
  const el = current?.registry.element(id) ?? null;
  return n ? `${id} ${n.kind} ${describe(el)}` : id;
}

function scrollView(fraction = 0.9): number {
  const s = runtime?.surface();
  if (!s) return 0;
  s.scroller.scrollTop += s.scroller.clientHeight * fraction;
  return s.scroller.scrollTop;
}

function closeFitView(): Record<string, unknown> {
  const was = runtime?.isOpen() ?? false;
  const m = was ? { actions: actionsTaken() } : {};
  if (runtime?.isOpen()) runtime.close('original');
  runtime = null;
  return { closed: was, ...m, events: events.map((e) => e.kind) };
}

// --- DOM signature (Fit view must leave the site's DOM as it was) ---------

/** Per element (by identity): its attributes, sorted. */
const sigs = new Map<string, Map<Element, string>>();

function domSig(name: string): number {
  const out = new Map<Element, string>();
  const visit = (root: ParentNode): void => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.localName === HOST_TAG || el.closest(HOST_TAG)) continue;
      out.set(
        el,
        Array.from(el.attributes)
          .map((a) => `${a.name}=${a.value.slice(0, 120)}`)
          .sort()
          .join('\u0001'),
      );
      const sr = (el as HTMLElement).shadowRoot;
      if (sr) visit(sr);
    }
  };
  visit(document);
  sigs.set(name, out);
  return out.size;
}

const SENSITIVE =
  /^(aria-|role$|tabindex$|inert$|hidden$|style$|data-wa|data-webable|contenteditable$|disabled$)/;

/**
 * What changed between two signatures, by element identity: elements the
 * site added or removed, and attributes changed on elements present in both
 * (the only kind of change Fit view itself could make). Sensitive attribute
 * changes on existing elements are counted per attribute name.
 */
function domDiff(a: string, b: string): Record<string, unknown> {
  const x = sigs.get(a);
  const y = sigs.get(b);
  if (!x || !y) return { error: 'missing signature' };
  let removed = 0;
  let added = 0;
  let changed = 0;
  const examples: string[] = [];
  const attrNames = new Map<string, number>();
  for (const [el, attrs] of x) {
    const now2 = y.get(el);
    if (now2 === undefined) {
      removed++;
      continue;
    }
    if (now2 === attrs) continue;
    changed++;
    const before = new Map(
      attrs
        .split('\u0001')
        .filter(Boolean)
        .map((kv) => {
          const i = kv.indexOf('=');
          return [kv.slice(0, i), kv.slice(i + 1)] as const;
        }),
    );
    const after = new Map(
      now2
        .split('\u0001')
        .filter(Boolean)
        .map((kv) => {
          const i = kv.indexOf('=');
          return [kv.slice(0, i), kv.slice(i + 1)] as const;
        }),
    );
    const names = new Set([...before.keys(), ...after.keys()]);
    const diffs: string[] = [];
    for (const n of names) {
      if (before.get(n) === after.get(n)) continue;
      diffs.push(n);
      if (SENSITIVE.test(n)) attrNames.set(n, (attrNames.get(n) ?? 0) + 1);
    }
    if (examples.length < 6)
      examples.push(`${describe(el, false)}: ${diffs.join(',')}`);
  }
  for (const el of y.keys()) if (!x.has(el)) added++;
  return {
    removed,
    added,
    changed,
    examples,
    sensitiveAttrs: Object.fromEntries(attrNames),
  };
}

// --- Interaction smoke (the runner clicks with real mouse input) ----------

let chosen: { control: HTMLElement; target: ProxyTarget } | null = null;

function originalOf(t: ProxyTarget): Element | null {
  const reg = current?.registry;
  if (!reg) return null;
  if (t.record) {
    const { listId, key, slotId } = t.record;
    const member = reg
      .members(listId)
      .find((m) => reg.recordKey(listId, m) === key);
    if (!member) return null;
    return reg.slot(listId, member, slotId) ?? member;
  }
  return reg.element(t.id) ?? reg.resolve(t.locator);
}

function stateOf(el: Element | null): Record<string, unknown> {
  if (!el) return { connected: false };
  const pick = (n: string): string | null => el.getAttribute(n);
  return {
    connected: el.isConnected,
    selected: pick('aria-selected'),
    pressed: pick('aria-pressed'),
    checked: pick('aria-checked'),
    current: pick('aria-current'),
    expanded: pick('aria-expanded'),
    cls: (el.getAttribute('class') ?? '').slice(0, 120),
    value: el instanceof HTMLInputElement ? el.value : null,
  };
}

const CHIP_KINDS = [
  'tabs',
  'filters',
  'sort_and_view',
  'secondary_nav',
  'primary_nav',
  'breadcrumbs',
];

/**
 * Pick a view control for the runner to click with the mouse and return its
 * centre (viewport px), after scrolling it into the middle of the view.
 */
/** The page's own title text for a rendered record (answer-key selector), or null. */
function truthTitle(
  li: Element | null,
  titleSel: string | null,
): string | null {
  const reg = current?.registry;
  const v = currentValidated;
  const key = (li as HTMLElement | null)?.dataset.key;
  if (!li || !reg || !v || !titleSel || !key) return null;
  for (const c of v.spec.collections) {
    for (const m of reg.members(c.list_id)) {
      if (reg.recordKey(c.list_id, m) !== key) continue;
      let t: Element | null = null;
      try {
        t = m.matches(titleSel) ? m : m.querySelector(titleSel);
      } catch {
        return null;
      }
      return clean(t?.textContent) || null;
    }
  }
  return null;
}

/**
 * Record fidelity in the primary section: rendered records, records with a
 * title, and titles that match the page's own title for that record (by
 * record key, through the answer key's title selector).
 */
function recordFidelity(titleSel: string | null): Record<string, unknown> {
  const root = viewRoot();
  if (!root) return { open: false };
  let rendered = 0;
  let titled = 0;
  let checked = 0;
  let matched = 0;
  const mismatched: string[] = [];
  for (const li of Array.from(
    root.querySelectorAll<HTMLElement>('[data-primary="true"] li.fv-rec'),
  )) {
    rendered++;
    const shown = clean(li.querySelector('.fv-rec-title')?.textContent);
    if (shown) titled++;
    const truth = truthTitle(li, titleSel);
    if (!truth) continue;
    checked++;
    if (shown && (truth.includes(shown) || shown.includes(truth))) matched++;
    else if (mismatched.length < 4)
      mismatched.push(`"${shown.slice(0, 30)}" for "${truth.slice(0, 30)}"`);
  }
  return { rendered, titled, checked, matched, mismatched };
}

function pick(
  kind: 'search' | 'chip' | 'title',
  /** For titles: the n-th usable record title (0 = first). */
  nth = 0,
  /** For titles: the answer key's title selector, to report the page's own title. */
  titleSel: string | null = null,
): Record<string, unknown> {
  const root = viewRoot();
  if (!root) return { ok: false, why: 'closed' };
  let covered: string | null = null;
  /** Shown, bound, and actually under the pointer at its centre once scrolled into view. */
  const usable = (c: HTMLElement): boolean => {
    if (!binds.has(c) || ownControl(c) || c.closest('.fv-rest')) return false;
    if (c.getClientRects().length === 0) return false;
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const hit = root.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    const ok = !!hit && (hit === c || c.contains(hit));
    if (!ok && covered === null)
      covered = `${describe(c)} under ${hit ? describe(hit) : 'nothing (view hidden)'}`;
    return ok;
  };
  let el: HTMLElement | null = null;
  if (kind === 'search') {
    el =
      Array.from(root.querySelectorAll<HTMLElement>('.fv-search input')).find(
        usable,
      ) ?? null;
  } else if (kind === 'title') {
    const cands = Array.from(
      root.querySelectorAll<HTMLElement>(
        '[data-primary="true"] li.fv-rec .fv-rec-title a[href], [data-primary="true"] li.fv-rec .fv-rec-title button.fv-open, [data-primary="true"] li.fv-rec a[href]:not([aria-hidden="true"]), li.fv-rec .fv-rec-title a[href], li.fv-rec .fv-rec-title button.fv-open, [data-primary="true"] .fv-prose a[href]',
      ),
    );
    let seen = 0;
    el =
      cands.find((c) => {
        if (!usable(c)) return false;
        return seen++ === nth;
      }) ?? null;
  } else {
    for (const k of CHIP_KINDS) {
      const pills = Array.from(
        root.querySelectorAll<HTMLElement>(
          `[data-kind="${k}"] .fv-pill, [data-kind="${k}"] a[href], [data-kind="${k}"] button`,
        ),
      ).filter(
        (p) =>
          p.getAttribute('aria-pressed') !== 'true' &&
          p.getAttribute('aria-current') === null &&
          !/fv-disclosure|fv-collapsed/.test(p.className),
      );
      // Skip the first pill (usually the current view: "Home", "All").
      el =
        pills.slice(1).find(usable) ?? pills.slice(0, 1).find(usable) ?? null;
      if (el) break;
    }
  }
  if (!el)
    return {
      ok: false,
      why: covered
        ? `${kind} control covered: ${covered}`
        : `no ${kind} control in the view`,
    };
  const target = binds.get(el) ?? null;
  if (!target) return { ok: false, why: `${kind} control is not bound` };
  chosen = { control: el, target };
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const orig = originalOf(target);
  return {
    ok: true,
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    w: r1(r.width),
    h: r1(r.height),
    label: clean(
      el.getAttribute('aria-label') ??
        el.getAttribute('placeholder') ??
        el.textContent,
    ).slice(0, 60),
    href: el instanceof HTMLAnchorElement ? el.href : null,
    role: target.role,
    original: describe(orig),
    originalHref:
      orig instanceof HTMLAnchorElement
        ? orig.href
        : ((orig?.closest('a[href]') as HTMLAnchorElement | null)?.href ??
          null),
    state: stateOf(orig),
    truth:
      kind === 'title' ? truthTitle(el.closest('li.fv-rec'), titleSel) : null,
  };
}

/** Debug: view elements matching `sel`, with size, binding and hit test. */
function probe(sel: string): Array<Record<string, unknown>> {
  const root = viewRoot();
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(sel))
    .slice(0, 12)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const hit = root.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return {
        el: describe(el),
        rect: [r1(r.left), r1(r.top), r1(r.width), r1(r.height)],
        bound: binds.has(el),
        hit: hit ? describe(hit) : null,
        inRest: !!el.closest('.fv-rest'),
      };
    });
}

/** Text inputs on the page (light DOM and open shadow roots) holding `value`. */
function inputsWith(value: string): string[] {
  const out: string[] = [];
  for (const el of walkAll(document.body)) {
    if (
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      el.value === value
    )
      out.push(`${describe(el, false)}${el.isConnected ? '' : ' (detached)'}`);
  }
  return out;
}

/** The view's own state: notices shown and whether a mirrored menu sheet is open. */
function viewState(): Record<string, unknown> {
  const root = viewRoot();
  if (!root) return { open: false };
  const sheet = root.querySelector<HTMLElement>('.fv-sheet');
  const notice = Array.from(
    root.querySelectorAll<HTMLElement>('[role="status"], .fv-notice'),
  )
    .map((n) => clean(n.textContent))
    .filter(Boolean);
  const back = root.querySelector<HTMLElement>('.fv-peek button');
  const br = back?.getBoundingClientRect();
  return {
    open: true,
    peeking: !!back && !!br && br.width > 0,
    peekBack:
      back && br && br.width > 0
        ? {
            x: Math.round(br.left + br.width / 2),
            y: Math.round(br.top + br.height / 2),
          }
        : null,
    sheetOpen: !!sheet && !sheet.hidden,
    sheetRows: sheet ? sheet.querySelectorAll('button').length : 0,
    notices: notice.slice(0, 3),
  };
}

function chosenState(): Record<string, unknown> {
  if (!chosen) return { ok: false };
  const orig = originalOf(chosen.target);
  return {
    ok: true,
    href: location.href,
    state: stateOf(orig),
    viewOpen: runtime?.isOpen() ?? false,
    actions: actionsTaken(),
    events: events.map((e) => e.kind),
    proxyFailed: events.filter((e) => e.kind === 'proxy_failed'),
  };
}

// ---------------------------------------------------------------------------

const api = {
  version: 1,
  firewall: () =>
    Object.getOwnPropertySymbols(window).map((s) => s.description ?? ''),
  read,
  tailor,
  changes,
  undoAll,
  snapshot,
  compare,
  guard: () => viewportGuard(document),
  prepare,
  plannerSkeleton,
  resolveKey,
  labelOutline,
  storePlannerSpec,
  openFitView,
  fitMetrics,
  measureOriginal,
  measureView,
  scrollView,
  closeFitView,
  domSig,
  domDiff,
  pick,
  chosenState,
  inputsWith,
  viewState,
  probe,
  recordFidelity,
  isOpen: () => runtime?.isOpen() ?? false,
  scrollTop: () => {
    scrollTo(0, 0);
    return scrollY;
  },
  sleep,
};

declare global {
  interface Window {
    __wae: typeof api;
  }
}

window.__wae = api;

export type EvalApi = typeof api;
