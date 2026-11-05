// Owner: P (round 4). The passive fit, in the page: what happened here that says something about a need.
//
// WebAble learns the need, never the cause. This file notices outcomes on the page and choices the person made:
//  - a zoom the person held ≥ 5 s (the background says which zoom changes were theirs, not WebAble's or a
//    navigation's), with code-computed evidence about what was in the middle of the view, so Jev can say whether the
//    zoom was for text (zoom_reason);
//  - each pointer click's outcome on this page view (landed just beside a button, slipped off one while pressing, or
//    clean), summed per page with the ±2 cap, Jev saying whether the misses were ordinary slips or the page's own doing
//    (miss_reason);
//  - the person's own text size choices on a site (A−/A+, a "larger text" offer taken);
//  - the OS preferences the page can see (reduced motion, more contrast, forced colours, colour scheme, pointer,
//    languages), reported to the background, which keeps Chrome's own settings.
// It never reads what is typed, never keeps coordinates or timings, never computes tremor, typing rhythm or age.
// Everything goes to the background (`passiveEvidence`), which keeps it on this laptop.
import {
  attributionWeight, compositeOver, contrastRatio, fallbackMissWeight, fallbackZoomWeight, pageClickWeight, parseColor, siteName,
} from '@webable/core';
import type {
  AttributionAnswer, AttributionQuestion, BgRequest, BrowserSettings, FitDimension, PassiveFitState, PassiveRecord, Rgba,
} from '@webable/core';
import { askExt, type ZoomInfo } from './bus';

/* ------------------------------------------------------------------ */
/* Settings the page can see                                           */
/* ------------------------------------------------------------------ */

export type MediaFacts = Partial<Pick<BrowserSettings,
  'reducedMotion' | 'contrastMore' | 'forcedColors' | 'colorScheme' | 'reducedTransparency' | 'languages' | 'pointer' | 'anyHover'>>;

function mq(q: string): boolean {
  try {
    return matchMedia(q).matches;
  } catch {
    return false;
  }
}

/** The OS and browser preferences any page sees (P0), for the background's BrowserSettings. */
export function readMediaFacts(): MediaFacts {
  let languages: string[] = [];
  try {
    languages = [...(navigator.languages ?? [navigator.language])].filter(Boolean).slice(0, 8);
  } catch {
    languages = [];
  }
  return {
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    contrastMore: mq('(prefers-contrast: more)'),
    forcedColors: mq('(forced-colors: active)'),
    colorScheme: mq('(prefers-color-scheme: dark)') ? 'dark' : 'light',
    reducedTransparency: mq('(prefers-reduced-transparency: reduce)'),
    languages,
    pointer: mq('(pointer: coarse)') ? 'coarse' : mq('(pointer: fine)') ? 'fine' : 'none',
    anyHover: mq('(any-hover: hover)'),
  };
}

/** Call `onChange` when one of the preferences that change a fit flips (the person changed a system setting). */
export function watchMedia(onChange: () => void): () => void {
  const queries = ['(prefers-reduced-motion: reduce)', '(prefers-contrast: more)', '(forced-colors: active)', '(prefers-color-scheme: dark)'];
  const offs: Array<() => void> = [];
  for (const q of queries) {
    try {
      const m = matchMedia(q);
      const fn = () => onChange();
      m.addEventListener('change', fn);
      offs.push(() => m.removeEventListener('change', fn));
    } catch {
      /* not supported */
    }
  }
  return () => offs.forEach((f) => f());
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export interface PointerOutcome {
  /** near: landed just beside a control, then a corrective click; slip: pressed on it, released off it; clean: a hit. */
  kind: 'near' | 'slip' | 'clean';
  /** The control's smaller side, CSS px. */
  sizePx: number;
  /** Time since the page's last layout shift, ms (null when none was seen). */
  shiftMs: number | null;
  /** The control sits in a carousel, slider or animated region. */
  moving: boolean;
}

export interface PassiveHost {
  ask<T>(req: BgRequest, timeoutMs?: number): Promise<T>;
  /** The page's body text size (CSS px at 100%), or null before the page was read. */
  bodyPx(): number | null;
  /** The text share of a tab zoom (tab zoom ÷ the page column's multiplier). */
  textZoom(tab: number): number;
  /** WebAble's own text zoom on this page and the person's own zoom at load (equal when WebAble did not zoom). */
  zooms(): { fit: number; own: number };
  pageKind(): string;
  isOurUi(t: EventTarget | null): boolean;
  /** A need whose fix is already running on this page: its click evidence would only measure the fix. */
  confounded(dim: FitDimension): boolean;
  /** The background stored evidence: the new state. */
  onState(s: PassiveFitState): void;
}

const SIG_ZOOM_IN = 1.1;
const ZOOM_HOLD_MS = 5000;
const FLUSH_EVERY_MS = 60_000;
/** A page's clicks are sent this long after the latest one (and every minute, and when the page is left). */
const FLUSH_AFTER_CLICK_MS = 4000;
const MAX_MISS_ASKS = 3;

function pct(z: number): string {
  return `${Math.round(z * 100)}%`;
}

const half = (v: number): number => Math.round(v * 2) / 2;

function pageId(): string {
  const r = Math.random().toString(36).slice(2, 10);
  return `p${Date.now().toString(36)}${r}`;
}

function here(): string {
  return siteName(location.hostname) ?? 'this site';
}

/** The page's body size when the reader has not measured it: the char-weighted median of paragraph font sizes. */
function quickBodyPx(): number {
  const sizes: Array<[number, number]> = [];
  const ps = document.querySelectorAll('p, li, dd, blockquote');
  for (let i = 0; i < ps.length && sizes.length < 60; i++) {
    const el = ps[i] as Element;
    const n = (el.textContent ?? '').trim().length;
    if (n < 60) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (Number.isFinite(px) && px >= 12) sizes.push([px, n]);
  }
  if (!sizes.length) return 16;
  sizes.sort((a, b) => a[0] - b[0]);
  const total = sizes.reduce((a, s) => a + s[1], 0);
  let acc = 0;
  for (const [px, n] of sizes) {
    acc += n;
    if (acc >= total / 2) return px;
  }
  return sizes[sizes.length - 1]?.[0] ?? 16;
}

function opaqueBackground(el: Element | null): Rgba {
  let cur: Element | null = el;
  for (let i = 0; cur && i < 30; i++) {
    const c = parseColor(getComputedStyle(cur).backgroundColor);
    if (c && c.a >= 0.5) return c.a >= 1 ? c : compositeOver(c, { r: 255, g: 255, b: 255, a: 1 });
    cur = cur.parentElement;
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

const MEDIA_SEL = 'img, picture, video, canvas, svg, iframe, [role="img"]';
const CONTROL_SEL = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], summary';
const MOVING_SEL = '[aria-roledescription*="carousel"], [class*="carousel"], [class*="slider"], [class*="swiper"], [class*="slick"], marquee';

/** What was in the middle of the view, in words Jev reads (never the text itself). */
function centreKind(el: Element | null): string {
  if (!el) return 'other';
  // A consent screen or sign-in box in front of the page is neither the page's text nor a picture.
  if (el.closest('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return 'dialog over the page';
  const frame = el.closest('iframe');
  if (frame) {
    const r = frame.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    return r.width * r.height >= 0.5 * vw * vh ? 'dialog over the page' : 'embedded frame';
  }
  const media = el.closest('video') ? 'video' : el.closest('canvas') ? 'map or canvas' : el.closest('img, picture, svg, [role="img"]') ? 'image' : null;
  if (media) return media;
  if (el.closest('input, select, textarea, form, button')) return 'form';
  if (el.closest('h1, h2, h3, h4, h5, h6, [role="heading"]')) return 'heading';
  if (el.closest('table')) return 'table';
  const block = el.closest('p, li, blockquote, dd, figcaption, article, td, pre');
  if (block && (block.textContent ?? '').trim().length >= 40) return 'paragraph text';
  if (el.closest('nav, header, [role="navigation"], [role="menu"], [role="menubar"]')) return 'navigation';
  if ((el.textContent ?? '').trim().length >= 40) return 'paragraph text';
  return 'other';
}

/* ------------------------------------------------------------------ */
/* The observer                                                        */
/* ------------------------------------------------------------------ */

type ZoomReply = ZoomInfo & { personAt?: number; personFrom?: number; personTo?: number };

export class PassiveObserver {
  private running = false;
  private page = pageId();
  private outcomes: PointerOutcome[] = [];
  private lastSentKey = '';
  private missW: number | null = null;
  private missAskedAt = 0;
  private missAsks = 0;
  private zoomRef: number | null = null;
  private cand: { from: number; lastPersonAt: number } | null = null;
  private lastDpr = 1;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly offs: Array<() => void> = [];
  private checking = false;

  constructor(private readonly host: PassiveHost) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastDpr = devicePixelRatio;
    const onResize = () => {
      if (devicePixelRatio === this.lastDpr) return;
      this.lastDpr = devicePixelRatio;
      this.later(450, () => void this.checkZoom());
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') void this.flush('hidden');
    };
    const onPageHide = () => void this.flush('pagehide');
    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    this.offs.push(
      () => window.removeEventListener('resize', onResize),
      () => document.removeEventListener('visibilitychange', onHide),
      () => window.removeEventListener('pagehide', onPageHide),
    );
    this.interval = setInterval(() => void this.flush('timer'), FLUSH_EVERY_MS);
    void this.readZoom().then((z) => {
      if (z && this.zoomRef === null) this.zoomRef = this.host.textZoom(z.factor);
    });
  }

  stop(): void {
    if (!this.running) return;
    void this.flush('stop');
    this.running = false;
    for (const off of this.offs.splice(0)) off();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    if (this.clickTimer) clearTimeout(this.clickTimer);
    this.clickTimer = null;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  /** A new page view (SPA navigation): send this one's clicks, then start counting again. */
  newPage(): void {
    void this.flush('navigation');
    this.page = pageId();
    this.outcomes = [];
    this.lastSentKey = '';
    this.missW = null;
    this.missAsks = 0;
    this.missAskedAt = 0;
  }

  /** WebAble changed the zoom itself (its fit, a text step, the column): the reference moves with it. */
  syncZoom(tab: number): void {
    if (!this.cand && Number.isFinite(tab) && tab > 0) this.zoomRef = this.host.textZoom(tab);
  }

  private later(ms: number, fn: () => void): void {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (this.running) fn();
    }, ms);
    this.timers.add(id);
  }

  /* ---------------- clicks ---------------- */

  noteClick(o: PointerOutcome): void {
    if (!this.running) return;
    this.outcomes.push(o);
    if (this.outcomes.length > 2000) this.outcomes.splice(0, this.outcomes.length - 2000);
    if (this.clickTimer) clearTimeout(this.clickTimer);
    this.clickTimer = setTimeout(() => {
      this.clickTimer = null;
      if (this.running) void this.flush('clicks');
    }, FLUSH_AFTER_CLICK_MS);
  }

  private missEvidence(): Record<string, string | number | boolean> {
    const misses = this.outcomes.filter((o) => o.kind !== 'clean');
    const sizes = misses.map((o) => o.sizePx).filter((s) => s > 0).sort((a, b) => a - b);
    const med = sizes.length ? sizes[sizes.length >> 1] ?? 0 : 0;
    return {
      page_kind: this.host.pageKind().slice(0, 40),
      clicks: this.outcomes.length,
      misses: misses.length,
      near_misses: misses.filter((o) => o.kind === 'near').length,
      slips: misses.filter((o) => o.kind === 'slip').length,
      median_target_px: Math.round(med),
      misses_on_small_targets: misses.filter((o) => o.sizePx > 0 && o.sizePx < 24).length,
      misses_after_layout_shift: misses.filter((o) => o.shiftMs !== null && o.shiftMs <= 1000).length,
      misses_on_moving_parts: misses.filter((o) => o.moving).length,
      pointer: mq('(pointer: coarse)') ? 'touch screen' : 'mouse or trackpad',
    };
  }

  /** P(the misses on this page were ordinary slips), from Jev when it can be asked; else from code. Asked ≤ 3 times a page. */
  private async missWeight(): Promise<number> {
    const ev = this.missEvidence();
    const misses = Number(ev.misses) || 0;
    if (!misses) return 1;
    const fallback = fallbackMissWeight(ev);
    if (this.missW !== null && (this.missAsks >= MAX_MISS_ASKS || misses === this.missAskedAt)) return this.missW;
    this.missAsks++;
    this.missAskedAt = misses;
    try {
      const q: AttributionQuestion = { kind: 'miss_reason', evidence: ev };
      const a = await this.host.ask<AttributionAnswer & { agree?: boolean }>({ type: 'attribute', question: q }, 7000);
      this.missW = attributionWeight(a, fallback);
    } catch {
      this.missW = this.missW ?? fallback;
    }
    return this.missW;
  }

  /**
   * Send this page view's click outcomes (its running, capped totals; a later flush replaces them). When the page is
   * being left there is no time to ask Jev: the last answer, or the code-only weight, is used and the message goes out
   * synchronously, before the document is gone.
   */
  async flush(reason: string): Promise<void> {
    if (!this.running && reason !== 'stop') return;
    const n = this.outcomes.length;
    if (!n) return;
    const near = this.outcomes.filter((o) => o.kind === 'near').length;
    const slip = this.outcomes.filter((o) => o.kind === 'slip').length;
    const key = `${this.page}|${n}|${near}|${slip}`;
    if (key === this.lastSentKey) return;
    if (n < 3 && near + slip === 0) return; // one or two clean clicks say almost nothing yet
    this.lastSentKey = key;
    const leaving = reason === 'pagehide' || reason === 'hidden' || reason === 'stop' || reason === 'navigation';
    const w = !(near + slip) ? 1 : leaving ? (this.missW ?? fallbackMissWeight(this.missEvidence())) : await this.missWeight();
    const site = here();
    const at = new Date().toISOString();
    const items: PassiveRecord[] = [];
    if (!this.host.confounded('targets')) {
      const seq = this.outcomes.filter((o) => o.kind !== 'slip').map((o) => o.kind === 'near');
      items.push({
        dim: 'targets', kind: 'clicks', weight: pageClickWeight(seq, w), clicks: n, misses: near, page: this.page, site, at, layer: 'now',
        what: near ? `${near} of ${n} clicks on ${site} landed just beside a button` : `${n} clicks on ${site}, none beside a button`,
      });
    }
    if (!this.host.confounded('steady_clicks')) {
      const seq = this.outcomes.filter((o) => o.kind !== 'near').map((o) => o.kind === 'slip');
      items.push({
        dim: 'steady_clicks', kind: 'clicks', weight: pageClickWeight(seq, w), clicks: n, misses: slip, page: this.page, site, at, layer: 'now',
        what: slip ? `${slip} of ${n} clicks on ${site} slipped off the button` : `${n} clicks on ${site}, none slipped`,
      });
    }
    if (items.length) await this.send(items);
  }

  private async send(items: PassiveRecord[]): Promise<void> {
    try {
      const s = await this.host.ask<PassiveFitState>({ type: 'passiveEvidence', items }, 5000);
      if (s && s.v === 'passive.1') this.host.onState(s);
    } catch {
      /* the background is away (extension reloaded): the evidence is dropped, never queued with page data */
    }
  }

  /* ---------------- the person's own text size choices ---------------- */

  /** A text size the person chose on this site (A−/A+, or a "larger text" offer taken here). */
  noteSize(zoom: number, kind: 'step' | 'accept', dir: -1 | 1): void {
    if (!this.running || !(zoom > 0)) return;
    const body = this.host.bodyPx() ?? quickBodyPx();
    const site = here();
    const what = kind === 'accept'
      ? `You took larger text on ${site} (${pct(zoom)})`
      : dir > 0 ? `You made text larger on ${site} (${pct(zoom)})` : `You made text smaller on ${site} (${pct(zoom)})`;
    void this.send([{ dim: 'text_size', kind, weight: 1, value: half(body * zoom), zoom: Math.round(zoom * 100) / 100, bodyPx: body, site, at: new Date().toISOString(), layer: 'now', what }]);
  }

  /** The person undid a change that came from what WebAble learned (−3, and it is no longer locked). */
  noteUndo(dim: FitDimension, noun: string): void {
    void this.send([{ dim, kind: 'undo', weight: -3, site: here(), at: new Date().toISOString(), layer: 'usual', what: `You undid ${noun} on ${here()}` }]);
  }

  /** An explicit "no" to WebAble's question about one need: it stays off until the person says otherwise. */
  noteNo(dim: FitDimension): void {
    void this.send([{ dim, kind: 'answer_no', weight: 0, site: here(), at: new Date().toISOString(), layer: 'usual', what: 'You answered no' }]);
  }

  /* ---------------- held zooms ---------------- */

  private async readZoom(): Promise<ZoomReply | null> {
    try {
      const z = await askExt<ZoomReply>({ type: 'zoomInfo' }, 3000);
      return z && Number.isFinite(z.factor) && z.factor > 0 ? z : null;
    } catch {
      return null;
    }
  }

  /** The zoom changed: if the person did it, wait until it has held 5 s at its last level. */
  private async checkZoom(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const z = await this.readZoom();
      if (!z || !this.running) return;
      const text = this.host.textZoom(z.factor);
      const personAt = typeof z.personAt === 'number' ? z.personAt : 0;
      const fresh = personAt > 0 && Date.now() - personAt < ZOOM_HOLD_MS;
      if (!fresh) {
        if (!this.cand) this.zoomRef = text;
        return;
      }
      if (!this.cand) {
        const from = this.zoomRef ?? (typeof z.personFrom === 'number' ? this.host.textZoom(z.personFrom) : 1);
        this.cand = { from, lastPersonAt: personAt };
      } else this.cand.lastPersonAt = Math.max(this.cand.lastPersonAt, personAt);
      if (this.holdTimer) clearTimeout(this.holdTimer);
      const wait = Math.max(500, ZOOM_HOLD_MS - (Date.now() - this.cand.lastPersonAt) + 200);
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        if (this.running) void this.confirmHold();
      }, wait);
    } finally {
      this.checking = false;
    }
  }

  private async confirmHold(): Promise<void> {
    const c = this.cand;
    if (!c) return;
    const z = await this.readZoom();
    if (!z || !this.running) return;
    const personAt = typeof z.personAt === 'number' ? z.personAt : 0;
    if (personAt > c.lastPersonAt + 1) {
      // Another change of theirs since: wait for that one to hold.
      c.lastPersonAt = personAt;
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        if (this.running) void this.confirmHold();
      }, Math.max(500, ZOOM_HOLD_MS - (Date.now() - personAt) + 200));
      return;
    }
    this.cand = null;
    const text = this.host.textZoom(z.factor);
    this.zoomRef = text;
    const zs = this.host.zooms();
    if (text >= c.from * SIG_ZOOM_IN - 0.002) await this.recordZoom(c.from, text, 'in');
    // A zoom back out of an enlargement WebAble made is the person saying it was too big.
    else if (text <= c.from / SIG_ZOOM_IN + 0.002 && zs.fit > zs.own + 0.005) await this.recordZoom(c.from, text, 'out');
  }

  /** Code-computed, structure-only evidence about what the held zoom was for. */
  zoomEvidence(from: number, to: number, body: number): Record<string, string | number | boolean> {
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    let centre = document.elementFromPoint(vw / 2, vh / 2);
    if (centre && this.host.isOurUi(centre)) centre = null;
    // What is in the middle of the view: 9 points over its central half, so one picture beside headlines does not
    // decide it. The most common kind is reported (text kinds pooled), with the counts.
    const TEXT_KINDS = new Set(['paragraph text', 'heading', 'table']);
    const MEDIA_KINDS = new Set(['image', 'video', 'map or canvas', 'embedded frame']);
    const kinds: string[] = [];
    for (const fx of [0.3, 0.5, 0.7]) {
      for (const fy of [0.3, 0.5, 0.7]) {
        let el = document.elementFromPoint(vw * fx, vh * fy);
        if (el && this.host.isOurUi(el)) el = null;
        kinds.push(centreKind(el));
      }
    }
    const textPoints = kinds.filter((k) => TEXT_KINDS.has(k)).length;
    const mediaPoints = kinds.filter((k) => MEDIA_KINDS.has(k)).length;
    const counts = new Map<string, number>();
    for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
    let kind = centreKind(centre);
    if (textPoints >= mediaPoints && textPoints >= 3) {
      // Mostly text: the commonest text kind (a heading or paragraph at the very centre wins ties).
      if (!TEXT_KINDS.has(kind)) kind = [...counts.entries()].filter(([k]) => TEXT_KINDS.has(k)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? kind;
    } else if (mediaPoints > textPoints && mediaPoints >= 5) kind = [...counts.entries()].filter(([k]) => MEDIA_KINDS.has(k)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? kind;
    if (!centre || !TEXT_KINDS.has(centreKind(centre))) {
      // Measure text size and contrast on a text point when the very centre is not text.
      for (const fx of [0.5, 0.3, 0.7]) {
        for (const fy of [0.5, 0.3, 0.7]) {
          const el = document.elementFromPoint(vw * fx, vh * fy);
          if (el && !this.host.isOurUi(el) && TEXT_KINDS.has(centreKind(el))) {
            centre = el;
            break;
          }
        }
        if (centre && TEXT_KINDS.has(centreKind(centre))) break;
      }
    }
    let textPx = 0;
    let contrast = 0;
    if (centre && !MEDIA_KINDS.has(centreKind(centre))) {
      const cs = getComputedStyle(centre);
      textPx = parseFloat(cs.fontSize) || 0;
      const fg = parseColor(cs.color);
      if (fg) contrast = Math.round(contrastRatio(fg.a >= 1 ? fg : compositeOver(fg, opaqueBackground(centre)), opaqueBackground(centre)) * 10) / 10;
    }
    let mediaArea = 0;
    let textArea = 0;
    const area = Math.max(1, vw * vh);
    const clip = (r: DOMRect) => Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const media = document.querySelectorAll(MEDIA_SEL);
    for (let i = 0; i < media.length && i < 300; i++) {
      const el = media[i] as Element;
      if (this.host.isOurUi(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 48 || r.height < 48) continue;
      // A frame over most of the view is a consent screen or sign-in box, not a picture.
      if (el.tagName === 'IFRAME' && clip(r) >= 0.5 * area) continue;
      mediaArea += clip(r);
    }
    const blocks = document.querySelectorAll('p, li, h1, h2, h3, h4, blockquote, dd, figcaption');
    for (let i = 0; i < blocks.length && i < 600; i++) {
      const el = blocks[i] as Element;
      if ((el.textContent ?? '').trim().length < 20) continue;
      textArea += clip(el.getBoundingClientRect());
    }
    let controls = 0;
    const ctl = document.querySelectorAll(CONTROL_SEL);
    for (let i = 0; i < ctl.length && i < 800 && controls < 50; i++) {
      const r = (ctl[i] as Element).getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      if (r.width > 0 && Math.hypot(cx - vw / 2, cy - vh / 2) <= 160) controls++;
    }
    return {
      page_kind: this.host.pageKind().slice(0, 40),
      zoom_from_pct: Math.round(from * 100),
      zoom_to_pct: Math.round(to * 100),
      held_seconds: ZOOM_HOLD_MS / 1000,
      centre_kind: kind,
      centre_text_points: textPoints,
      centre_media_points: mediaPoints,
      centre_text_px: Math.round(textPx * 10) / 10,
      page_body_px: Math.round(body * 10) / 10,
      centre_contrast: contrast,
      image_share_pct: Math.min(100, Math.round((mediaArea / area) * 100)),
      text_share_pct: Math.min(100, Math.round((textArea / area) * 100)),
      controls_near_centre: controls,
      text_px_after_zoom: Math.round(body * to * 10) / 10,
    };
  }

  private async recordZoom(from: number, to: number, dir: 'in' | 'out'): Promise<void> {
    const body = this.host.bodyPx() ?? quickBodyPx();
    const site = here();
    let w = 1;
    if (dir === 'in') {
      const ev = this.zoomEvidence(from, to, body);
      const fallback = fallbackZoomWeight(ev);
      try {
        const a = await this.host.ask<AttributionAnswer & { agree?: boolean }>({ type: 'attribute', question: { kind: 'zoom_reason', evidence: ev } }, 7000);
        w = attributionWeight(a, fallback);
      } catch {
        w = fallback;
      }
      if (!this.running) return;
    }
    const what = dir === 'in' ? `You zoomed in to ${pct(to)} on ${site}` : `You zoomed back out to ${pct(to)} on ${site}`;
    await this.send([{
      dim: 'text_size', kind: 'zoom', weight: Math.round(w * 1000) / 1000, value: half(body * to), zoom: Math.round(to * 100) / 100,
      bodyPx: Math.round(body * 2) / 2, site, at: new Date().toISOString(), layer: 'now', what,
    }]);
  }
}

/** The controls a press can miss, and whether they sit on moving parts (for the click outcomes in signals.ts). */
export function onMovingPart(el: Element): boolean {
  try {
    return !!el.closest(MOVING_SEL);
  } catch {
    return false;
  }
}
