// Owner: C2; round 4: P (click outcomes for the passive fit). Live struggle signals (research-struggle.md §2, §3, §5).
//
// Stage 1 of the struggle pipeline: local, cheap features from capture-phase, passive listeners.
// Stage 2 (core `gate`) decides whether a Jev check is worth asking; stage 3 is one Jev call through the
// background; stage 4 (core `decideOffers`) applies thresholds, timing and the interruption budget.
//
// Privacy: nothing typed is read. Keys are only compared against the find and zoom shortcuts and Escape;
// field edits are seen only as "an insertion" or "a deletion" (InputEvent.inputType). No page text, labels,
// URLs or coordinates leave this file: Jev only ever sees window aggregates built by core `toSignals`.

import {
  decideOffers, gate, initialCusum, initialOfferMemory, resetCusum, snoozeOffer, toSignals, turnOffOffer,
  type BgRequest, type CusumState, type FitProfile, type Offer, type OfferKind, type OfferMemory,
  type StruggleCounts, type StruggleJudgment, type StruggleKind, type StruggleSignals,
} from '@webable/core';
import { askExt, type ZoomInfo } from './bus';
import { onMovingPart, type PointerOutcome } from './passive';

export interface SignalsHost {
  elementFor(id: string): Element | null;
  fit(): FitProfile | null;
  pageKind(): string;
  onJudgment(j: StruggleJudgment, waiting: StruggleKind[], offers: Offer[]): void;
  ask<T>(req: BgRequest): Promise<T>;
  isOurUi(target: EventTarget | null): boolean;
  /**
   * Round 4 (passive fit): each pointer click's outcome on an ordinary page (canvas, game and map pages excluded): it
   * landed just beside a control, slipped off one while pressing, or hit. Counts only; no coordinates or timings.
   */
  onPointerOutcome?(o: PointerOutcome): void;
}

/* ------------------------------------------------------------------ */
/* Constants. Sources and exact wording: research-struggle.md §2, §5.  */
/* ------------------------------------------------------------------ */

export const SIG = {
  /** Sliding window of active time (page visible and focused). */
  WINDOW_MS: 60_000,
  /** Run the core gate this often (active time). */
  EVAL_EVERY_MS: 30_000,
  /** Run the gate early, at the next idle moment, after this many retries. */
  RETRIES_FOR_EARLY_GATE: 3,

  // P1 near-miss + correction
  NEAR_MISS_PX: 24,
  NEAR_MISS_RINGS: [8, 16, 24] as readonly number[],
  TOUCH_RINGS: [8, 16, 24, 32, 40, 48] as readonly number[],
  CORRECT_MS: 2000,
  /** An activation counts as a retry if a lost click happened in the last 3 s. */
  LOST_LOOKBACK_MS: 3000,
  /** Drop the near-miss if a layout shift happened within 500 ms before the press. */
  LAYOUT_SHIFT_GUARD_MS: 500,
  // P2 lost click
  SLIP_MIN_PX: 3,
  SLIP_MAX_PX: 40,
  LOST_MAX_MS: 800,
  // P4 accidental double activation
  DOUBLE_MS: 250,
  UNDO_MS: 2000,
  TOGGLE_SETTLE_MS: 300,
  // P5 re-entries: a movement segment starts after a click or a pause of at least 1 s; trail kept 3 s
  SEGMENT_PAUSE_MS: 1000,
  TRAIL_MS: 3000,
  // S1 dead click
  DEAD_MS: 1000,
  DEAD_PAUSE_MS: 10_000,
  // R1 browser zoom, R2 pinch, P9 pinch-to-tap
  ZOOM_IN_RATIO: 1.10,
  ZOOM_HOLD_MS: 5000,
  ZOOM_HINT_MS: 2500,
  PINCH_SCALE: 1.25,
  PINCH_REARM_SCALE: 1.10,
  PINCH_HOLD_MS: 2000,
  PINCH_TAP_MS: 3000,
  // R3 full re-read (backtrack)
  BACKTRACK_MIN_PX: 100,
  BACKTRACK_RETURN_SLACK_PX: 50,
  BACKTRACK_STAY_MS: 15_000,
  BACKTRACK_GUARD_MS: 500,
  BACKTRACK_EXPIRE_MS: 120_000,
  SAME_PASSAGE_OVERLAP: 0.5,
  SAME_PASSAGE_WINDOW_MS: 180_000,
  // F1 hunting
  HOVER_ITEM_MS: 300,
  HUNT_NO_ACTION_MS: 20_000,
  HUNT_MIN_ITEMS: 6,
  // M1-M3 forms
  FIELD_PAUSE_MS: 20_000,
  FIELD_RETURNS: 3,
  FIELD_ERRORS: 2,
  // F4 quick back
  QUICK_BACK_MS: 10_000,
  // Engineering choices for fields the struggle brief does not define (documented on summarize()).
  SELECT_MIN_CHARS: 40,
  CORRECTION_MERGE_MS: 1000,
  SIDEWAYS_MIN_PX: 50,
  SIDEWAYS_GAP_MS: 500,
  LONG_PAUSE_MIN_MS: 10_000,
  LONG_PAUSE_MAX_MS: 120_000,
  SHORT_TEXT_MAX_WORDS: 80,
  SHORT_TEXT_MIN_WORDS: 3,
  USUAL_WPM: 238,
  // §5.3 idle moment
  IDLE_KEY_MS: 2000,
  IDLE_SCROLL_MS: 1000,
  // §5.1 Jev budget
  JEV_MIN_GAP_MS: 15_000,
  JEV_MAX_PER_HOUR: 20,
  // §5.2 hold band: re-ask once after more evidence
  REASK_MS: 60_000,
  REASK_CUSUM: 4.5,
  // §4.5 after-check
  AFTER_CHECK_ACTIVATIONS: 8,
  AFTER_CHECK_MS: 60_000,
  // §5.3 undo within 10 s of applying: type off on this site for 24 h; "Not now": 30 min on this site
  FAST_UNDO_MS: 10_000,
  FAST_UNDO_OFF_MS: 24 * 3_600_000,
  // memory budget
  LOG_KEEP_MS: 600_000,
  LOG_CAP: 4000,
} as const;

/** Interactive selector from research-struggle.md §2. */
export const INTERACTIVE = [
  'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary', 'label[for]',
  '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=switch]', '[role=tab]',
  '[role=menuitem]', '[role=option]', '[contenteditable=""]', '[contenteditable=true]', '[tabindex]:not([tabindex^="-"])',
].join(',');
/** Drag-capable exclusions from research-struggle.md §2. */
export const DRAG_OK = 'input[type=range],[draggable=true],canvas,svg,video,[role=slider],[role=scrollbar]';
const MEDIA = 'img,picture,canvas,svg,video,iframe,[role=img],[role=application]';
const FIELD = [
  'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image])' +
    ':not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file])',
  'select', 'textarea', '[contenteditable=""]', '[contenteditable=true]',
].join(',');
const DIALOG = 'dialog,[role=dialog],[role=alertdialog],[aria-modal=true]';
const NOT_OVERLAY = 'header,nav,[role=navigation],[role=banner],[role=menu],[role=menubar],[role=listbox],[role=toolbar]';
const CAROUSEL = '[aria-roledescription*="carousel"],[class*="carousel"],[class*="slider"],[class*="swiper"],[class*="slick"],[role=tablist],[role=listbox]';
/** X2: canvas, game and map pages disable the pointing gates. */
const POINTING_OFF_KINDS = /canvas|game|map|draw|paint|whiteboard|design tool/i;

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for tests; no DOM access)                    */
/* ------------------------------------------------------------------ */

export interface RectLike { left: number; top: number; right: number; bottom: number }

/** Distance from a point to a rectangle (0 inside or on the edge). */
export function rectDistance(x: number, y: number, r: RectLike): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

/** Overlap of two [low, high] ranges, relative to the shorter one. */
export function overlapRatio(a: readonly [number, number], b: readonly [number, number]): number {
  const inter = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
  return inter / Math.max(1, Math.min(a[1] - a[0], b[1] - b[0]));
}

export function wordCount(s: string): number {
  let n = 0;
  for (const w of s.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(w)) n++;
  return n;
}

export interface PressFacts {
  distPx: number;
  durMs: number;
  releasedInside: boolean;
  selecting: boolean;
  dragCapable: boolean;
  pointerType: string;
}

/** P2: the press began on control A and was released off A, 3-40 px away, within 800 ms. */
export function isLostClick(p: PressFacts): boolean {
  return p.pointerType !== 'touch' && !p.releasedInside && !p.selecting && !p.dragCapable &&
    p.distPx >= SIG.SLIP_MIN_PX && p.distPx <= SIG.SLIP_MAX_PX && p.durMs <= SIG.LOST_MAX_MS;
}

/** How long a still viewport of `words` short text must last to count as a long pause (pace <= 0.5x usual). */
export function longPauseThresholdMs(words: number, wpm: number = SIG.USUAL_WPM): number {
  const expected = (Math.max(0, words) / Math.max(60, wpm)) * 60_000;
  return Math.max(SIG.LONG_PAUSE_MIN_MS, 2 * expected);
}

export function progressBand(progressEvents: number, msSinceProgress: number, windowMs: number): StruggleCounts['progress'] {
  if (msSinceProgress >= SIG.HUNT_NO_ACTION_MS && windowMs >= SIG.HUNT_NO_ACTION_MS) return 'none';
  if (progressEvents >= 3 && msSinceProgress < 10_000) return 'steady';
  return 'some';
}

/** Pointer positions for the last 3 s (never sent anywhere). Fixed-size ring buffer. */
export class PointerTrail {
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly ts: Float64Array;
  private head = 0;
  private size = 0;
  constructor(private readonly cap = 1024) {
    this.xs = new Float64Array(cap);
    this.ys = new Float64Array(cap);
    this.ts = new Float64Array(cap);
  }
  push(x: number, y: number, t: number): void {
    const i = (this.head + this.size) % this.cap;
    this.xs[i] = x;
    this.ys[i] = y;
    this.ts[i] = t;
    if (this.size < this.cap) this.size++;
    else this.head = (this.head + 1) % this.cap;
  }
  /** The current movement segment: samples since `sinceT` (the last click) and since the last pause of >= 1 s. */
  segment(sinceT: number, nowT: number): Array<{ x: number; y: number; t: number }> {
    const out: Array<{ x: number; y: number; t: number }> = [];
    let later: number | null = null;
    for (let k = this.size - 1; k >= 0; k--) {
      const i = (this.head + k) % this.cap;
      const t = this.ts[i] ?? 0;
      if (t < sinceT || nowT - t > SIG.TRAIL_MS) break;
      if (later !== null && later - t >= SIG.SEGMENT_PAUSE_MS) break;
      out.push({ x: this.xs[i] ?? 0, y: this.ys[i] ?? 0, t });
      later = t;
    }
    return out.reverse();
  }
  /** P5: outside-to-inside transitions of `r` during the current movement segment. */
  reentries(r: RectLike, sinceT: number, nowT: number): number {
    let inside = false;
    let n = 0;
    for (const s of this.segment(sinceT, nowT)) {
      const ins = rectDistance(s.x, s.y, r) === 0;
      if (ins && !inside) n++;
      inside = ins;
    }
    return n;
  }
}

export type ToggleOutcome = 'double' | 'undone' | null;
export interface ToggleClick { t: number; pre: string; post: string | null }

/**
 * P4 for one toggle. `pre` is the state just before each click; `settle` gives the state after it.
 * 'double': two clicks within 250 ms flipped it twice, then the person set it again within 2 s.
 * 'undone': one click flipped it and a separate click (250 ms - 2 s later) set it back.
 */
export class ToggleHistory {
  private e: ToggleClick[] = [];
  click(t: number, pre: string): ToggleClick {
    this.e = this.e.filter((x) => t - x.t <= SIG.UNDO_MS + 1000);
    const c: ToggleClick = { t, pre, post: null };
    this.e.push(c);
    return c;
  }
  settle(c: ToggleClick, post: string): ToggleOutcome {
    c.post = post;
    const k = this.e.indexOf(c);
    if (k < 0) return null;
    const b = this.e[k - 1];
    const a = this.e[k - 2];
    if (a && b && b.t - a.t <= SIG.DOUBLE_MS && c.t - b.t <= SIG.UNDO_MS &&
        a.pre !== b.pre && c.pre === a.pre && post === b.pre) {
      this.e = [];
      return 'double';
    }
    if (b && c.t - b.t > SIG.DOUBLE_MS && c.t - b.t <= SIG.UNDO_MS && b.pre !== c.pre && post === b.pre) {
      this.e = [];
      return 'undone';
    }
    return null;
  }
}

/** R2 + P9: a pinch to >= 125% held 2 s and not followed by a tap within 3 s is a reading zoom; with a tap it is pointing. */
export class PinchWatch {
  private start: { t: number; belowAt: number | null; max: number; media: boolean; tapped: boolean } | null = null;
  private armed = true;
  scale(s: number, t: number, onMedia: () => boolean): void {
    const st = this.start;
    if (st) {
      if (s < SIG.PINCH_SCALE && st.belowAt === null) st.belowAt = t;
      st.max = Math.max(st.max, s);
    } else if (this.armed && s >= SIG.PINCH_SCALE) {
      this.start = { t, belowAt: null, max: s, media: onMedia(), tapped: false };
      this.armed = false;
    }
    if (!this.start && s < SIG.PINCH_REARM_SCALE) this.armed = true;
  }
  /** A tap or click on a control. True when it follows a pinch within 3 s (P9, a pointing signal). */
  tap(t: number): boolean {
    const st = this.start;
    if (st && !st.tapped && t - st.t <= SIG.PINCH_TAP_MS) {
      st.tapped = true;
      return true;
    }
    return false;
  }
  /** Finalise an episode 3 s after it began. */
  tick(t: number, currentScale: number): { to: number } | null {
    const st = this.start;
    if (!st || t - st.t < SIG.PINCH_TAP_MS) return null;
    this.start = null;
    if (currentScale < SIG.PINCH_REARM_SCALE) this.armed = true;
    const held = (st.belowAt ?? t) - st.t >= SIG.PINCH_HOLD_MS;
    return held && !st.tapped && !st.media ? { to: st.max } : null;
  }
}

/**
 * R1: browser zoom-in. A change counts when new/old >= 1.10, the person made it (a zoom gesture just before:
 * Ctrl/Cmd + '=' / '+' / '-' / '0' or Ctrl + wheel; or the background says the person changed it), and it is
 * still in place 5 s later. Zoom changes WebAble made itself only move the reference.
 */
export class ZoomWatch {
  ref: number;
  current: number;
  private hintAt = Number.NEGATIVE_INFINITY;
  private cand: { from: number; t: number } | null = null;
  constructor(initial = 1) {
    this.ref = initial;
    this.current = initial;
  }
  get pending(): boolean { return this.cand !== null; }
  hint(t: number): void { this.hintAt = t; }
  observe(f: number, t: number, byPerson: boolean | null = null): void {
    if (!(f > 0)) return;
    this.current = f;
    if (this.cand && f < this.cand.from * SIG.ZOOM_IN_RATIO - 1e-6) this.cand = null;
    const isIn = f >= this.ref * SIG.ZOOM_IN_RATIO - 1e-6;
    if (isIn && !this.cand) {
      if (byPerson === true || t - this.hintAt <= SIG.ZOOM_HINT_MS) this.cand = { from: this.ref, t };
      else this.ref = f;
    }
    if (!this.cand && f < this.ref) this.ref = f;
  }
  /** Call after a fresh reading; returns the confirmed zoom-in once it has held 5 s. */
  tick(t: number): { from: number; to: number } | null {
    const c = this.cand;
    if (!c || t - c.t < SIG.ZOOM_HOLD_MS) return null;
    this.cand = null;
    if (this.current >= c.from * SIG.ZOOM_IN_RATIO - 1e-6) {
      this.ref = this.current;
      return { from: c.from, to: this.current };
    }
    return null;
  }
}

/**
 * R3 full re-read on one scroller (Smadja et al. 2019): an upward scroll from `start` to its minimum `end`
 * with start - end >= 100 px, a later return to >= start - 50 px, and a 15 s stay there.
 * Upward runs within 500 ms of a hash change, find-in-page or layout shift are dropped.
 */
export class Backtracker {
  private lastY: number | null = null;
  private bt: { start: number; end: number; at: number; void: boolean } | null = null;
  private pending: { range: [number, number]; start: number; at: number } | null = null;
  private guardAt = Number.NEGATIVE_INFINITY;
  guard(at: number): void {
    this.guardAt = at;
    if (this.bt && Math.abs(this.bt.at - at) <= SIG.BACKTRACK_GUARD_MS) this.bt.void = true;
  }
  feed(y: number, at: number): void {
    if (this.lastY === null) {
      this.lastY = y;
      return;
    }
    const d = y - this.lastY;
    this.lastY = y;
    if (Math.abs(d) < 2) return;
    if (d < 0) {
      if (this.pending && y < this.pending.start - SIG.BACKTRACK_RETURN_SLACK_PX) this.pending = null;
      if (!this.bt || at - this.bt.at > SIG.BACKTRACK_EXPIRE_MS) {
        this.bt = { start: y - d, end: y, at, void: Math.abs(at - this.guardAt) <= SIG.BACKTRACK_GUARD_MS };
      } else {
        this.bt.end = Math.min(this.bt.end, y);
      }
    } else if (this.bt && this.bt.start - this.bt.end >= SIG.BACKTRACK_MIN_PX &&
               y >= this.bt.start - SIG.BACKTRACK_RETURN_SLACK_PX) {
      if (!this.bt.void) this.pending = { range: [this.bt.end, this.bt.start], start: this.bt.start, at };
      this.bt = null;
    }
  }
  /** Returns the re-read range once the 15 s stay has passed. */
  tick(at: number): [number, number] | null {
    if (this.pending && at - this.pending.at >= SIG.BACKTRACK_STAY_MS) {
      const r = this.pending.range;
      this.pending = null;
      return r;
    }
    return null;
  }
}

/** Accumulates time only while the page is visible and focused. */
export class ActiveClock {
  private acc = 0;
  private since: number | null = null;
  set(active: boolean, nowW: number): void {
    if (active && this.since === null) this.since = nowW;
    else if (!active && this.since !== null) {
      this.acc += nowW - this.since;
      this.since = null;
    }
  }
  at(nowW: number): number { return this.acc + (this.since === null ? 0 : nowW - this.since); }
}

/** One local observation. `at` is active time, `t` is performance.now(). Never leaves the device. */
export type SigEvent =
  | { k: 'act'; at: number; t: number; hit: 'near' | 'lost' | 'pinch' | null; reentries: number; sizePx: number }
  | { k: 'lost'; at: number; t: number }
  | { k: 'double'; at: number; t: number }
  | { k: 'undone'; at: number; t: number }
  | { k: 'dead'; at: number; t: number }
  | { k: 'zoom'; at: number; t: number; from: number; to: number }
  | { k: 'reread'; at: number; t: number; range: [number, number] }
  | { k: 'sideways'; at: number; t: number }
  | { k: 'pause'; at: number; t: number; words: number; ms: number }
  | { k: 'select'; at: number; t: number }
  | { k: 'popup'; at: number; t: number }
  | { k: 'hunt'; at: number; t: number }
  | { k: 'stuck'; at: number; t: number; why: 'pause' | 'returns' | 'errors' }
  | { k: 'correction'; at: number; t: number }
  | { k: 'progress'; at: number; t: number };

export interface LiveFacts {
  windowMs: number;
  /** Active seconds since signals started (core `gate` uses it as its clock). */
  timeOnPageSec: number;
  zoomLevel: number;
  msSinceProgress: number;
  pointingOff: boolean;
}

/**
 * Aggregates over (fromAt, toAt] of active time, for core `gate`, `toSignals` and `decideOffers`.
 * - clicks: pointer activations of interactive elements (Bernoulli trials); modifier and keyboard clicks excluded.
 * - nearMissClicks: activations preceded by a confirmed near-miss (P1) or a pinch (P9).
 * - lostClicks: P2 lost clicks. (The activation right after a lost click is its retry; it is not counted again.)
 * - repeatClicks: P4 confirmed accidental double activations of a toggle.
 * - deadClicks: S1 dead clicks. Trials within 10 s after a dead click are dropped (the CUSUM pause).
 * - wrongThenUndone: a toggle flipped and set back by a separate click within 2 s, or a quick back (F4).
 * - pathWobble: share of activations whose final approach entered the target 2 or more times (P5).
 * - zoomInEvents: R1 browser zoom-ins held 5 s, plus R2 pinches held 2 s; never on media; not a pinch-to-tap.
 * - zoomLevel: browser zoom factor x pinch scale, now.
 * - scrollBacks: R3 full re-reads of the same passage: the size of the largest group of re-reads within 3 min that
 *   overlap >= 50% and has a member in the window. 0 when no passage was re-read twice.
 * - sidewaysScrolls: horizontal scroll runs of >= 50 px on the page or a text container (not carousels).
 * - longPausesOnShortText: still viewports with 3-80 words in the middle 60% that lasted between
 *   max(10 s, 2x the reading time at 238 wpm) and 2 min, ended by a scroll or an action (R4 pace <= 0.5x usual);
 *   not while a field is focused, and not while the pointer inspected 3+ controls (that is hunting).
 * - textSelections: selections of >= 40 characters outside fields.
 * - popupsDismissed: dialogs or fixed overlays that went away within 1 s of a click inside them, or of Escape.
 * - hoverHunts: F1 hunting episodes: stretches of >= 20 s without an action (activation, key or selection) during
 *   which >= 6 distinct interactive items were each dwelt on >= 300 ms without being activated.
 * - longFieldDwells: fields that got stuck: >= 20 s focused without typing (M1), a 3rd return (M2), a 2nd error (M3).
 * - typingCorrections: deletion runs after typing in a field (deletions within 1 s of each other are one run).
 * - progress: activations, typing and new scroll depth; 'none' after >= 20 s without any.
 * Canvas, game and map pages (and a page view where Jev found the activity deliberate) zero the pointing counts.
 */
export function summarize(log: readonly SigEvent[], fromAt: number, toAt: number, live: LiveFacts): StruggleCounts {
  const deadTs: number[] = [];
  const rereads: Array<Extract<SigEvent, { k: 'reread' }>> = [];
  for (const e of log) {
    if (e.k === 'dead') deadTs.push(e.t);
    else if (e.k === 'reread') rereads.push(e);
  }
  const paused = (t: number): boolean => deadTs.some((d) => t >= d && t - d <= SIG.DEAD_PAUSE_MS);
  const inWin = (e: SigEvent): boolean => e.at > fromAt && e.at <= toAt;

  let clicks = 0, near = 0, lost = 0, repeat = 0, dead = 0, undone = 0, wobbly = 0, zoom = 0, sideways = 0;
  let pauses = 0, selections = 0, popups = 0, hunts = 0, stuck = 0, corrections = 0, progress = 0, scrollBacks = 0;

  for (const e of log) {
    if (!inWin(e)) continue;
    switch (e.k) {
      case 'act':
        progress++;
        if (paused(e.t)) break;
        clicks++;
        if (e.hit === 'near' || e.hit === 'pinch') near++;
        if (e.reentries >= 2) wobbly++;
        break;
      case 'lost': if (!paused(e.t)) lost++; break;
      case 'double': repeat++; break;
      case 'undone': undone++; break;
      case 'dead': dead++; break;
      case 'zoom': zoom++; break;
      case 'reread': {
        const group = 1 + rereads.filter((o) => o !== e && Math.abs(o.at - e.at) <= SIG.SAME_PASSAGE_WINDOW_MS &&
          overlapRatio(o.range, e.range) >= SIG.SAME_PASSAGE_OVERLAP).length;
        if (group >= 2) scrollBacks = Math.max(scrollBacks, group);
        break;
      }
      case 'sideways': sideways++; break;
      case 'pause': pauses++; break;
      case 'select': selections++; break;
      case 'popup': popups++; break;
      case 'hunt': hunts++; break;
      case 'stuck': stuck++; break;
      case 'correction': corrections++; break;
      case 'progress': progress++; break;
    }
  }
  if (live.pointingOff) {
    near = 0; lost = 0; repeat = 0; undone = 0; wobbly = 0;
  }
  return {
    windowMs: Math.max(0, Math.round(live.windowMs)),
    timeOnPageSec: Math.round(live.timeOnPageSec),
    clicks,
    nearMissClicks: near,
    lostClicks: lost,
    repeatClicks: repeat,
    deadClicks: dead,
    wrongThenUndone: undone,
    pathWobble: clicks ? Math.round((wobbly / clicks) * 100) / 100 : 0,
    zoomInEvents: zoom,
    zoomLevel: Math.round(live.zoomLevel * 100) / 100,
    scrollBacks,
    sidewaysScrolls: sideways,
    longPausesOnShortText: pauses,
    textSelections: selections,
    popupsDismissed: popups,
    hoverHunts: hunts,
    longFieldDwells: stuck,
    typingCorrections: corrections,
    progress: progressBand(progress, live.msSinceProgress, live.windowMs),
  };
}

/**
 * Counts for core `gate`: the 60 s window, except the CUSUM trials (clicks, near-misses, lost clicks), which are only
 * those since the previous gate run, with windowMs set to that span in whole seconds (the same clock as
 * timeOnPageSec). Core scales the CUSUM update by the share of the window that is new; with this span that share is
 * exactly 1, so every trial enters the statistic once ("never on fewer than 3 retries", research-struggle §0.4).
 */
export function gateCounts(log: readonly SigEvent[], lastGateAt: number, toAt: number, live: LiveFacts): StruggleCounts {
  const win = summarize(log, toAt - SIG.WINDOW_MS, toAt, live);
  const fresh = summarize(log, lastGateAt, toAt, live);
  const spanSec = Math.max(1, Math.round(toAt / 1000) - Math.round(lastGateAt / 1000));
  return { ...win, windowMs: spanSec * 1000, clicks: fresh.clicks, nearMissClicks: fresh.nearMissClicks, lostClicks: fresh.lostClicks };
}

/** Parse the background's zoom answer (a number, or an object carrying one). */
export function parseZoom(raw: unknown): number | null {
  let f: unknown = raw;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    f = o.factor ?? o.zoom ?? o.zoomFactor ?? o.value;
  }
  return typeof f === 'number' && Number.isFinite(f) && f >= 0.25 && f <= 5 ? f : null;
}

export function isJudgment(x: unknown): x is StruggleJudgment {
  if (!x || typeof x !== 'object') return false;
  const j = x as Partial<StruggleJudgment>;
  return typeof j.level === 'number' && !!j.kinds && typeof j.kinds === 'object' && !!j.metrics;
}

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

function parentComposed(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function closestComposed(el: Element | null, sel: string): Element | null {
  let cur: Element | null = el;
  while (cur) {
    const hit = cur.closest(sel);
    if (hit) return hit;
    const root = cur.getRootNode();
    cur = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

/** The interactive element a press on `el` would activate, if any (a label counts when it has a control). */
function interactiveOf(el: Element | null): Element | null {
  if (!el) return null;
  const hit = closestComposed(el, INTERACTIVE);
  if (hit) return hit;
  const lab = closestComposed(el, 'label');
  return lab instanceof HTMLLabelElement && lab.control ? lab : null;
}

function composedTarget(e: Event): Element | null {
  const first = e.composedPath()[0];
  if (first instanceof Element) return first;
  if (first instanceof Node && first.parentElement) return first.parentElement;
  return e.target instanceof Element ? e.target : null;
}

function deepElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  for (let i = 0; el?.shadowRoot && i < 8; i++) {
    const inner: Element | null = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

function containsComposed(outer: Element, inner: Element): boolean {
  let cur: Element | null = inner;
  while (cur) {
    if (cur === outer || outer.contains(cur)) return true;
    const root = cur.getRootNode();
    cur = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

function hasModifier(e: MouseEvent): boolean { return e.ctrlKey || e.metaKey || e.shiftKey || e.altKey; }

function isPrivateField(el: Element): boolean {
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase();
  return (el instanceof HTMLInputElement && el.type === 'password') || /(^|\s)cc-/.test(ac) || ac.includes('one-time-code');
}

function fieldOf(el: Element | null): Element | null {
  if (!el || !el.matches(FIELD)) return null;
  return isPrivateField(el) ? null : el;
}

function deepActiveElement(): Element | null {
  let a = document.activeElement;
  for (let i = 0; a?.shadowRoot?.activeElement && i < 8; i++) a = a.shadowRoot.activeElement;
  return a;
}

/** The state of a toggle, or null if `el` is not one (P4: checkbox, aria-pressed, aria-checked, aria-expanded, details). */
function toggleState(el: Element): string | null {
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked ? 'on' : 'off';
  if (el.localName === 'summary' && el.parentElement instanceof HTMLDetailsElement) return el.parentElement.open ? 'open' : 'shut';
  for (const a of ['aria-pressed', 'aria-checked', 'aria-expanded']) {
    const v = el.getAttribute(a);
    if (v !== null) return `${a}=${v}`;
  }
  return null;
}

function flipped(state: string): string {
  return state === 'on' ? 'off' : state === 'off' ? 'on' : state;
}

/** The dialog or fixed overlay a click inside might close. */
function overlayContainer(start: Element): Element | null {
  let el: Element | null = start;
  for (let depth = 0; el && el !== document.body && el !== document.documentElement && depth < 25; depth++) {
    if (el.matches(DIALOG)) return el;
    if (el.matches(NOT_OVERLAY)) return null;
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') {
      const r = el.getBoundingClientRect();
      return r.width * r.height >= 0.02 * innerWidth * innerHeight ? el : null;
    }
    el = parentComposed(el);
  }
  return null;
}

function overlayGone(box: Element, area0: number): boolean {
  if (!box.isConnected) return true;
  if (box instanceof HTMLDialogElement && !box.open) return true;
  const cs = getComputedStyle(box);
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return true;
  const r = box.getBoundingClientRect();
  return r.width * r.height < 0.25 * area0;
}

function visibleDialogs(isOurs: (t: EventTarget | null) => boolean): Element[] {
  const out: Element[] = [];
  document.querySelectorAll(DIALOG).forEach((d) => {
    if (isOurs(d)) return;
    const r = d.getBoundingClientRect();
    if (r.width * r.height > 0) out.push(d);
  });
  return out;
}

function mediaAtViewportCenter(): boolean {
  const vv = window.visualViewport;
  const x = vv ? vv.offsetLeft + vv.width / 2 : innerWidth / 2;
  const y = vv ? vv.offsetTop + vv.height / 2 : innerHeight / 2;
  return !!closestComposed(deepElementFromPoint(x, y), MEDIA);
}

type CaretDoc = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** Words of running text crossing the middle 60% of the viewport (counted here, never sent). */
function visibleWords(isOurs: (t: EventTarget | null) => boolean): number {
  const d = document as CaretDoc;
  const caret = (x: number, y: number): Node | null => {
    if (typeof d.caretPositionFromPoint === 'function') return d.caretPositionFromPoint(x, y)?.offsetNode ?? null;
    if (typeof d.caretRangeFromPoint === 'function') return d.caretRangeFromPoint(x, y)?.startContainer ?? null;
    return null;
  };
  const seen = new Set<Element>();
  let words = 0;
  for (const fx of [0.25, 0.5, 0.75]) {
    for (const fy of [0.25, 0.4, 0.55, 0.7]) {
      const n = caret(fx * innerWidth, fy * innerHeight);
      if (!n || n.nodeType !== Node.TEXT_NODE) continue;
      const parent = n.parentElement;
      if (!parent || isOurs(parent) || parent.closest(FIELD)) continue;
      const block = parent.closest('p,li,dd,dt,td,th,blockquote,figcaption,h1,h2,h3,h4,h5,h6,label,legend,pre');
      const box = block && (block.textContent ?? '').length <= 4000 ? block : parent;
      if (seen.has(box)) continue;
      seen.add(box);
      words += wordCount((box.textContent ?? '').slice(0, 4000));
      if (words > 400) return words;
    }
  }
  return words;
}

type StorageArea = { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
function chromeStorage(): StorageArea | null {
  try {
    const c = (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome;
    return c?.storage?.local ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Offer memory persistence (daily cap, spacing, "Not now", "Don't suggest") */
/* ------------------------------------------------------------------ */

const MEM_KEY = 'webable.offerMemory.v1';
interface StoredMem {
  /** core's OfferMemory.day: the local date `today` counts. */
  day: string;
  lastOfferAt: number | null;
  today: number;
  off: string[];
  sites: Record<string, { snoozedUntil: Record<string, number> }>;
}
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

let activeEngine: SignalEngine | null = null;
/** F4: the last same-site link the person followed, to notice a quick return (survives SPA restarts). */
let lastLink: { t: number; from: string } | null = null;

export type OfferOutcome = 'accepted' | 'not_now' | 'never' | 'undone';

/**
 * Tell the struggle loop what happened to an offer (call from acceptOffer / dismissOffer / undoOp).
 * Resets the CUSUM (§3); records "Not now" (30 min on this site), "Don't suggest this" (off everywhere) and a fast
 * undo (off on this site for 24 h); schedules the after-check (§4.5) for an accepted offer.
 */
export function noteOfferOutcome(kind: OfferKind, outcome: OfferOutcome): void {
  activeEngine?.offerOutcome(kind, outcome);
}

/** The current 60 s window counts, for "Why this?" and debugging. Null when signals are not running. */
export function currentCounts(): StruggleCounts | null {
  return activeEngine?.snapshot() ?? null;
}

/** The exact signals sent with the most recent Jev struggle call (for "Why this?": what was sent). */
export function lastSentSignals(): StruggleSignals | null {
  return activeEngine?.lastSent ?? null;
}

export function startSignals(ctx: { api: SignalsHost }): () => void {
  activeEngine?.stop();
  const engine = new SignalEngine(ctx.api);
  activeEngine = engine;
  try {
    engine.start();
  } catch {
    engine.stop();
  }
  return () => {
    engine.stop();
    if (activeEngine === engine) activeEngine = null;
  };
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

type EvalReason = 'timer' | 'early' | 'reask' | 'after_check';

interface ScrollState {
  bt: Backtracker | null;
  lastX: number;
  maxY: number;
  h: { sum: number; t: number; counted: boolean } | null;
  textual: boolean | null;
}

class SignalEngine {
  lastSent: StruggleSignals | null = null;
  private running = false;
  private readonly clock = new ActiveClock();
  private readonly trail = new PointerTrail();
  private readonly pinch = new PinchWatch();
  private readonly zoom = new ZoomWatch(1);
  private log: SigEvent[] = [];
  private readonly offs: Array<() => void> = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private perfObs: PerformanceObserver | null = null;
  private mo: MutationObserver | null = null;

  private readonly startedW = performance.now();
  private cusum: CusumState | null = null;
  private mem: OfferMemory | null = null;
  private history: StruggleJudgment[] = [];
  private calls: number[] = [];
  private inflight = false;
  private lastEvalAt = 0;
  private lastGateAt = 0;
  private pendingCheck = false;
  private retriesSinceGate = 0;
  private trigger = false;
  private pointingSuppressed = false;
  /** §5.2 rule 4: a hold re-asks once (CUSUM >= 4.5 or 60 s later); a second hold drops the episode. */
  private reaskAt: number | null = null;
  private reasked = false;
  private deferred: { memBefore: OfferMemory; counts: StruggleCounts; until: number } | null = null;
  private afterCheck: { kind: OfferKind; at: number; acts: number; acceptedAt: number } | null = null;
  private actCount = 0;

  // pointer
  private down: { x: number; y: number; t: number; el: Element; id: number } | null = null;
  private buttonDown = false;
  private pendingNear: Array<{ el: Element; t: number }> = [];
  private lostAt = Number.NEGATIVE_INFINITY;
  private lastClickT = 0;
  private forward: { c: Element; t: number } | null = null;
  private readonly toggles = new WeakMap<Element, ToggleHistory>();
  private lastLayoutShiftW = Number.NEGATIVE_INFINITY;
  // hover hunting
  private lastMoveTarget: EventTarget | null = null;
  private hoverEl: Element | null = null;
  private hoverSinceW = 0;
  private readonly hoverItems = new Map<Element, number>();
  private huntOpen = false;
  // page responses (dead clicks)
  private lastResponseW = Number.NEGATIVE_INFINITY;
  private watchUntilW = 0;
  private leaving = false;
  // keys, scroll, actions, zoom
  private lastKeyW = Number.NEGATIVE_INFINITY;
  private lastScrollW = Number.NEGATIVE_INFINITY;
  private lastActionAt = 0;
  private lastProgressAt = 0;
  private lastCtrlWheelW = Number.NEGATIVE_INFINITY;
  private lastDpr = 1;
  private zoomReading = false;
  private zoomConfirmScheduled = false;
  private zoomInfoWorks = true;
  private readonly scrollers = new Map<object, ScrollState>();
  private still: { since: number; words: number | null } = { since: 0, words: null };
  private lastSelectionKey = '';
  // forms
  private field: { el: Element; focusAt: number; typed: boolean; inserted: boolean; stuck: boolean } | null = null;
  private readonly touched = new WeakSet<Element>();
  private readonly returns = new WeakMap<Element, number>();
  private readonly errors = new WeakMap<Element, number>();
  private lastDeleteW = Number.NEGATIVE_INFINITY;

  constructor(private readonly host: SignalsHost) {}

  /* ---------------- lifecycle ---------------- */

  start(): void {
    this.running = true;
    try { this.cusum = initialCusum(); } catch { this.cusum = null; }
    try { this.mem = initialOfferMemory(); } catch { this.mem = null; }
    this.lastDpr = devicePixelRatio;
    this.syncClock();
    const opt = { capture: true, passive: true } as const;
    this.on(window, 'pointermove', (e) => this.onPointerMove(e as PointerEvent), opt);
    this.on(window, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent), opt);
    this.on(window, 'pointerup', (e) => this.onPointerUp(e as PointerEvent), opt);
    this.on(window, 'pointercancel', () => { this.down = null; this.buttonDown = false; }, opt);
    this.on(window, 'click', (e) => this.onClick(e as MouseEvent), opt);
    this.on(window, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent), opt);
    this.on(window, 'wheel', (e) => this.onWheel(e as WheelEvent), opt);
    this.on(window, 'scroll', (e) => this.onScroll(e), opt);
    this.on(window, 'focusin', (e) => this.onFocusIn(e), opt);
    this.on(window, 'focusout', (e) => this.onFocusOut(e), opt);
    this.on(window, 'input', (e) => this.onInput(e), opt);
    this.on(window, 'mouseup', () => this.later(0, () => this.checkSelection()), opt);
    this.on(window, 'keyup', () => this.later(0, () => this.checkSelection()), opt);
    for (const type of ['change', 'toggle', 'play', 'pause', 'submit', 'reset']) {
      this.on(window, type, (e) => { if (!this.ours(e.target)) this.lastResponseW = performance.now(); }, opt);
    }
    this.on(document, 'selectionchange', () => { this.lastResponseW = performance.now(); }, opt);
    this.on(window, 'hashchange', () => { this.lastResponseW = performance.now(); this.guardBacktracks(); }, opt);
    this.on(window, 'popstate', () => { this.lastResponseW = performance.now(); this.checkQuickBack(); }, opt);
    this.on(window, 'pageshow', (e) => {
      if ((e as PageTransitionEvent).persisted) { this.leaving = false; this.checkQuickBack(); }
    }, opt);
    this.on(window, 'pagehide', () => { this.leaving = true; }, opt);
    this.on(window, 'beforeunload', () => { this.leaving = true; }, opt);
    this.on(window, 'resize', () => this.onResize(), opt);
    this.on(document, 'visibilitychange', () => this.syncClock(), opt);
    this.on(window, 'focus', () => this.syncClock(), opt);
    this.on(window, 'blur', () => this.syncClock(), opt);
    const vv = window.visualViewport;
    if (vv) this.on(vv, 'resize', () => this.onVisualViewport(), opt);
    const nav = (window as { navigation?: EventTarget }).navigation;
    if (nav) this.on(nav, 'navigate', () => { this.lastResponseW = performance.now(); }, opt);
    try {
      this.perfObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!(e as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput) {
            this.lastLayoutShiftW = e.startTime;
            this.guardBacktracks();
          }
        }
      });
      this.perfObs.observe({ type: 'layout-shift', buffered: false });
    } catch {
      this.perfObs = null;
    }
    this.interval = setInterval(() => {
      if (!this.running) return;
      try { this.tick(); } catch { /* never break the page */ }
    }, 1000);
    void this.loadMem();
    void this.readZoom(true);
    this.checkQuickBack();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const off of this.offs.splice(0)) off();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.perfObs?.disconnect();
    this.mo?.disconnect();
    this.mo = null;
  }

  private on(target: EventTarget, type: string, fn: (e: Event) => void, opt: AddEventListenerOptions): void {
    const wrapped = (e: Event): void => {
      if (!this.running) return;
      try { fn(e); } catch { /* never break the page */ }
    };
    target.addEventListener(type, wrapped, opt);
    this.offs.push(() => target.removeEventListener(type, wrapped, opt));
  }

  private later(ms: number, fn: () => void): void {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.running) return;
      try { fn(); } catch { /* ignore */ }
    }, ms);
    this.timers.add(id);
  }

  private isActive(): boolean { return !document.hidden && document.hasFocus(); }
  private syncClock(): void { this.clock.set(this.isActive(), performance.now()); }
  private nowAt(nowW = performance.now()): number { return this.clock.at(nowW); }

  private push(e: SigEvent): void {
    this.log.push(e);
    if (this.log.length > SIG.LOG_CAP) this.log.splice(0, this.log.length - SIG.LOG_CAP);
  }

  private ours(t: EventTarget | null): boolean {
    try { return this.host.isOurUi(t); } catch { return false; }
  }

  private pointingOff(): boolean {
    let kind = '';
    try { kind = this.host.pageKind(); } catch { /* unknown */ }
    return this.pointingSuppressed || POINTING_OFF_KINDS.test(kind);
  }

  private markAction(nowW: number, progress: boolean): void {
    const at = this.nowAt(nowW);
    this.endStill(at);
    this.lastActionAt = at;
    this.hoverItems.clear();
    this.huntOpen = false;
    if (progress) this.markProgress(nowW);
  }

  private markProgress(nowW: number): void {
    const at = this.nowAt(nowW);
    this.lastProgressAt = at;
    this.push({ k: 'progress', at, t: nowW });
  }

  /* ---------------- pointer ---------------- */

  private onPointerMove(e: PointerEvent): void {
    if (!e.isTrusted) return;
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    if (evs.length) for (const c of evs) this.trail.push(c.clientX, c.clientY, c.timeStamp);
    else this.trail.push(e.clientX, e.clientY, e.timeStamp);
    if (e.pointerType === 'touch' || e.target === this.lastMoveTarget) return;
    this.lastMoveTarget = e.target;
    const el = e.target instanceof Element && !this.ours(e.target) ? interactiveOf(e.target) : null;
    if (el !== this.hoverEl) {
      const nowW = performance.now();
      this.endHover(nowW);
      this.hoverEl = el;
      this.hoverSinceW = nowW;
    }
  }

  private endHover(nowW: number): void {
    if (this.hoverEl && nowW - this.hoverSinceW >= SIG.HOVER_ITEM_MS) {
      this.hoverItems.set(this.hoverEl, this.nowAt(nowW));
      if (this.hoverItems.size > 200) {
        const first = this.hoverItems.keys().next().value;
        if (first) this.hoverItems.delete(first);
      }
    }
    this.hoverEl = null;
  }

  private onPointerDown(e: PointerEvent): void {
    if (!e.isTrusted || e.button !== 0) return;
    const nowW = performance.now();
    this.buttonDown = true;
    this.down = null;
    if (this.ours(e.target)) return;
    const target = composedTarget(e);
    if (!target) return;
    const el = interactiveOf(target);
    if (el) {
      this.down = { x: e.clientX, y: e.clientY, t: nowW, el, id: e.pointerId };
      return;
    }
    // P1: a press with no interactive ancestor, near a control. Confirmed only by a corrective click.
    if (hasModifier(e) || closestComposed(target, DRAG_OK) || this.pointingOff()) return;
    if (nowW - this.lastLayoutShiftW <= SIG.LAYOUT_SHIFT_GUARD_MS) return;
    const near = this.nearestInteractive(e.clientX, e.clientY, e.pointerType);
    if (near) {
      this.pendingNear = this.pendingNear.filter((p) => nowW - p.t <= SIG.CORRECT_MS);
      this.pendingNear.push({ el: near, t: nowW });
    }
  }

  /** Nearest interactive element 0 < d <= 24 px away: probes on rings of 8/16/24 px (touch: up to max(24, size/2)). */
  private nearestInteractive(x: number, y: number, pointerType: string): Element | null {
    const touch = pointerType === 'touch';
    const rings = touch ? SIG.TOUCH_RINGS : SIG.NEAR_MISS_RINGS;
    let best: { el: Element; d: number } | null = null;
    const tried = new Set<Element>();
    for (const r of rings) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 2 * Math.PI;
        const px = x + r * Math.cos(a);
        const py = y + r * Math.sin(a);
        if (px < 0 || py < 0 || px >= innerWidth || py >= innerHeight) continue;
        const hit = deepElementFromPoint(px, py);
        if (!hit || this.ours(hit)) continue;
        const el = interactiveOf(hit);
        if (!el || tried.has(el)) continue;
        tried.add(el);
        const rect = el.getBoundingClientRect();
        const d = rectDistance(x, y, rect);
        const maxD = touch ? Math.max(SIG.NEAR_MISS_PX, 0.5 * Math.min(rect.width, rect.height)) : SIG.NEAR_MISS_PX;
        if (d > 0 && d <= maxD && (!best || d < best.d)) best = { el, d };
      }
    }
    return best?.el ?? null;
  }

  private onPointerUp(e: PointerEvent): void {
    if (!e.isTrusted) return;
    if (e.buttons === 0) this.buttonDown = false;
    const d = this.down;
    this.down = null;
    if (!d || e.pointerId !== d.id) return;
    const nowW = performance.now();
    const up = deepElementFromPoint(e.clientX, e.clientY);
    const sel = window.getSelection();
    const facts: PressFacts = {
      distPx: Math.hypot(e.clientX - d.x, e.clientY - d.y),
      durMs: nowW - d.t,
      releasedInside: !!up && containsComposed(d.el, up),
      selecting: !!sel && !sel.isCollapsed,
      dragCapable: !!closestComposed(d.el, DRAG_OK),
      pointerType: e.pointerType,
    };
    if (!this.pointingOff() && isLostClick(facts)) {
      this.lostAt = nowW;
      this.retriesSinceGate++;
      this.trigger = true;
      this.push({ k: 'lost', at: this.nowAt(nowW), t: nowW });
      this.outcome('slip', d.el, nowW);
    }
  }

  private onClick(e: MouseEvent): void {
    if (!e.isTrusted || e.button !== 0) return;
    const nowW = performance.now();
    if (this.ours(e.target)) return;
    const target = composedTarget(e);
    if (!target) return;
    this.watchPopup(target);
    const el = interactiveOf(target);
    if (!el) return;
    // A click on a label is forwarded by the browser to its control: one activation, not two.
    const fwd = this.forward;
    if (fwd && nowW - fwd.t < 100 && (el === fwd.c || fwd.c.contains(el))) {
      this.forward = null;
      return;
    }
    const control = el instanceof HTMLLabelElement ? el.control : null;
    this.forward = control ? { c: control, t: nowW } : null;

    this.markAction(nowW, true);
    this.actCount++;
    this.watchDead(el, nowW);
    this.trackToggle(control ?? el, control !== null, nowW);
    this.noteLink(el);

    const pointer = e.detail > 0 && !hasModifier(e);
    if (!pointer || this.pointingOff()) return;
    const at = this.nowAt(nowW);
    const r = el.getBoundingClientRect();
    const nm = this.pendingNear.findIndex((p) => nowW - p.t <= SIG.CORRECT_MS &&
      (p.el === el || p.el.contains(el) || el.contains(p.el) || (control !== null && p.el === control)));
    const pinchTap = this.pinch.tap(nowW);
    let hit: 'near' | 'lost' | 'pinch' | null = null;
    if (nm >= 0) hit = 'near';
    else if (pinchTap) hit = 'pinch';
    else if (nowW - this.lostAt <= SIG.LOST_LOOKBACK_MS) hit = 'lost';
    this.pendingNear = this.pendingNear.filter((p, i) => i !== nm && nowW - p.t <= SIG.CORRECT_MS);
    if (hit === 'near' || hit === 'pinch') {
      this.retriesSinceGate++;
      this.trigger = true;
    }
    const reentries = this.trail.reentries(r, this.lastClickT, nowW);
    this.lastClickT = nowW;
    this.push({ k: 'act', at, t: nowW, hit, reentries, sizePx: Math.round(Math.min(r.width, r.height)) });
    // A retry right after a slip was counted as the slip; a pinch-then-tap is a touch gesture, not an aim.
    if (hit === 'near') this.outcome('near', el, nowW);
    else if (hit === null) this.outcome('clean', el, nowW);
  }

  /** Round 4: one click's outcome for the passive fit (the control's size, whether the page had just shifted). */
  private outcome(kind: PointerOutcome['kind'], el: Element, nowW: number): void {
    const fn = this.host.onPointerOutcome;
    if (!fn) return;
    let sizePx = 0;
    try {
      const r = el.getBoundingClientRect();
      sizePx = Math.round(Math.min(r.width, r.height));
    } catch {
      sizePx = 0;
    }
    const shift = Number.isFinite(this.lastLayoutShiftW) ? Math.max(0, Math.round(nowW - this.lastLayoutShiftW)) : null;
    try {
      fn({ kind, sizePx, shiftMs: shift, moving: onMovingPart(el) });
    } catch {
      /* never break the page */
    }
  }

  /* ---------------- P4 toggles, F4 quick backs ---------------- */

  private trackToggle(el: Element, viaLabel: boolean, nowW: number): void {
    const st = toggleState(el);
    if (st === null) return;
    // A native checkbox has already flipped when its own click is dispatched; for a label click it has not yet.
    const pre = el instanceof HTMLInputElement && !viaLabel ? flipped(st) : st;
    let h = this.toggles.get(el);
    if (!h) {
      h = new ToggleHistory();
      this.toggles.set(el, h);
    }
    const hist = h;
    const entry = hist.click(nowW, pre);
    this.later(SIG.TOGGLE_SETTLE_MS, () => {
      const post = toggleState(el);
      if (post === null) return;
      const out = hist.settle(entry, post);
      const t = performance.now();
      if (out === 'double') this.push({ k: 'double', at: this.nowAt(t), t });
      else if (out === 'undone') this.push({ k: 'undone', at: this.nowAt(t), t });
    });
  }

  private noteLink(el: Element): void {
    if (!(el instanceof HTMLAnchorElement) || !el.href || (el.target && el.target !== '_self')) return;
    try {
      const u = new URL(el.href, location.href);
      const here = new URL(location.href);
      if (u.origin !== here.origin) return;
      if (u.pathname === here.pathname && u.search === here.search) return; // same page (hash only)
      lastLink = { t: Date.now(), from: location.href };
    } catch {
      /* bad href */
    }
  }

  private checkQuickBack(): void {
    const l = lastLink;
    if (!l) return;
    if (Date.now() - l.t > SIG.QUICK_BACK_MS) {
      lastLink = null;
      return;
    }
    if (location.href === l.from) {
      lastLink = null;
      const t = performance.now();
      this.push({ k: 'undone', at: this.nowAt(t), t });
    }
  }

  /* ---------------- S1 dead clicks ---------------- */

  private watchDead(el: Element, t0: number): void {
    if (el.matches(FIELD) || el.matches('input[type=file],input[type=color]')) return;
    if (el instanceof HTMLAnchorElement) {
      if ((el.target && el.target !== '_self') || el.hasAttribute('download')) return;
      const href = el.getAttribute('href') ?? '';
      if (/^\s*(mailto|tel|sms|facetime|callto):/i.test(href)) return;
    }
    this.watchUntilW = Math.max(this.watchUntilW, t0 + SIG.DEAD_MS + 50);
    if (!this.mo) {
      this.mo = new MutationObserver((recs) => {
        for (const r of recs) {
          if (!this.ours(r.target)) {
            this.lastResponseW = performance.now();
            break;
          }
        }
      });
      this.mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    this.later(SIG.DEAD_MS, () => {
      if (performance.now() >= this.watchUntilW - 60) {
        this.mo?.disconnect();
        this.mo = null;
      }
      if (this.leaving || document.hidden || this.lastResponseW >= t0) return;
      this.push({ k: 'dead', at: this.nowAt(t0), t: t0 });
    });
  }

  /* ---------------- popups ---------------- */

  private watchPopup(target: Element): void {
    const box = overlayContainer(target);
    if (!box || this.ours(box)) return;
    const r0 = box.getBoundingClientRect();
    const area0 = r0.width * r0.height;
    if (area0 <= 0) return;
    this.later(SIG.DEAD_MS, () => {
      if (!this.leaving && overlayGone(box, area0)) {
        const t = performance.now();
        this.push({ k: 'popup', at: this.nowAt(t), t });
      }
    });
  }

  /* ---------------- keys, wheel, zoom ---------------- */

  private onKeyDown(e: KeyboardEvent): void {
    if (!e.isTrusted) return;
    const nowW = performance.now();
    this.lastKeyW = nowW;
    const k = e.key;
    if (k === 'Shift' || k === 'Control' || k === 'Meta' || k === 'Alt' || k === 'CapsLock') return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (k === 'f' || k === 'F') {
        this.guardBacktracks();
        return;
      }
      if (k === '=' || k === '+' || k === '-' || k === '_' || k === '0') {
        this.zoom.hint(nowW);
        this.later(400, () => void this.readZoom());
      }
      return;
    }
    if (this.ours(e.target)) return;
    if (k === 'Escape') {
      const before = visibleDialogs((t) => this.ours(t));
      if (before.length) {
        this.later(500, () => {
          if (before.some((d) => overlayGone(d, 1))) {
            const t = performance.now();
            this.push({ k: 'popup', at: this.nowAt(t), t });
          }
        });
      }
    }
    this.markAction(nowW, false);
  }

  private onWheel(e: WheelEvent): void {
    if (!e.isTrusted || !e.ctrlKey || e.deltaY >= 0) return;
    const nowW = performance.now();
    if (nowW - this.lastCtrlWheelW > 300) {
      this.zoom.hint(nowW);
      this.later(400, () => void this.readZoom());
    }
    this.lastCtrlWheelW = nowW;
  }

  private onResize(): void {
    const dpr = devicePixelRatio;
    if (dpr !== this.lastDpr) {
      this.lastDpr = dpr;
      this.later(300, () => void this.readZoom());
    }
  }

  /** Read the tab's zoom. Prefers `zoomInfo` (it says whether the person changed it), falls back to `getZoom`. */
  private async fetchZoom(): Promise<{ factor: number; byPerson: boolean | null } | null> {
    if (this.zoomInfoWorks) {
      try {
        const info = await askExt<ZoomInfo>({ type: 'zoomInfo' });
        const f = parseZoom(info);
        if (f !== null) {
          const ours = info && typeof info.ours === 'number' ? info.ours : null;
          const byPerson = info && typeof info.personChanged === 'boolean'
            ? info.personChanged && (ours === null || Math.abs(ours - f) > 1e-3)
            : null;
          return { factor: f, byPerson };
        }
        this.zoomInfoWorks = false;
      } catch {
        this.zoomInfoWorks = false;
      }
    }
    try {
      const f = parseZoom(await this.host.ask<unknown>({ type: 'getZoom' }));
      return f === null ? null : { factor: f, byPerson: null };
    } catch {
      return null;
    }
  }

  private async readZoom(initial = false): Promise<void> {
    if (this.zoomReading) return;
    this.zoomReading = true;
    try {
      const z = await this.fetchZoom();
      if (!z || !this.running) return;
      if (initial) {
        this.zoom.ref = z.factor;
        this.zoom.current = z.factor;
        return;
      }
      const nowW = performance.now();
      this.zoom.observe(z.factor, nowW, z.byPerson);
      const ev = this.zoom.tick(nowW);
      if (ev && !mediaAtViewportCenter()) {
        // zooming to look at an image, chart or map is not a reading signal
        this.push({ k: 'zoom', at: this.nowAt(nowW), t: nowW, from: ev.from, to: ev.to });
        this.trigger = true;
      }
      if (this.zoom.pending && !this.zoomConfirmScheduled) {
        this.zoomConfirmScheduled = true;
        this.later(SIG.ZOOM_HOLD_MS + 150, () => {
          this.zoomConfirmScheduled = false;
          void this.readZoom();
        });
      }
    } finally {
      this.zoomReading = false;
    }
  }

  private onVisualViewport(): void {
    const vv = window.visualViewport;
    if (vv) this.pinch.scale(vv.scale, performance.now(), mediaAtViewportCenter);
  }

  /* ---------------- scrolling ---------------- */

  private guardBacktracks(): void {
    const at = this.nowAt();
    for (const s of this.scrollers.values()) s.bt?.guard(at);
  }

  private onScroll(e: Event): void {
    if (!e.isTrusted) return;
    const nowW = performance.now();
    this.lastScrollW = nowW;
    this.lastResponseW = nowW;
    const tgt = e.target;
    if (this.ours(tgt)) return;
    let y: number, x: number, vh: number, key: object, main: boolean;
    if (tgt === document || tgt === document.documentElement || tgt === document.body) {
      y = window.scrollY; x = window.scrollX; vh = innerHeight; key = document; main = true;
    } else if (tgt instanceof Element) {
      y = tgt.scrollTop; x = tgt.scrollLeft; vh = tgt.clientHeight; key = tgt; main = vh >= 0.5 * innerHeight;
    } else {
      return;
    }
    const at = this.nowAt(nowW);
    let st = this.scrollers.get(key);
    if (!st) {
      if (this.scrollers.size >= 24) {
        const first = this.scrollers.keys().next().value;
        if (first) this.scrollers.delete(first);
      }
      st = { bt: main ? new Backtracker() : null, lastX: x, maxY: y, h: null, textual: null };
      st.bt?.feed(y, at);
      this.scrollers.set(key, st);
    }
    if (st.bt) {
      st.bt.feed(y, at);
      if (y > st.maxY + 0.5 * vh) {
        st.maxY = y;
        this.markProgress(nowW);
      }
    }
    const dx = x - st.lastX;
    st.lastX = x;
    if (Math.abs(dx) >= 1 && this.sidewaysEligible(key, st)) {
      if (!st.h || nowW - st.h.t > SIG.SIDEWAYS_GAP_MS) st.h = { sum: 0, t: nowW, counted: false };
      st.h.sum += Math.abs(dx);
      st.h.t = nowW;
      if (!st.h.counted && st.h.sum >= SIG.SIDEWAYS_MIN_PX) {
        st.h.counted = true;
        this.push({ k: 'sideways', at, t: nowW });
      }
    }
    this.endStill(at);
  }

  private sidewaysEligible(key: object, st: ScrollState): boolean {
    if (key === document) return true;
    if (st.textual === null) {
      const el = key as Element;
      st.textual = !el.closest(CAROUSEL) && (el.textContent ?? '').trim().length >= 200;
    }
    return st.textual;
  }

  /** A still viewport ended (a scroll or an action): was it a long pause on short text? */
  private endStill(at: number): void {
    const dur = at - this.still.since;
    const words = this.still.words;
    // The pointer inspecting several controls meanwhile is hunting (F1), not a pause over the text.
    let inspected = 0;
    for (const t of this.hoverItems.values()) if (t >= this.still.since) inspected++;
    if (words !== null && words >= SIG.SHORT_TEXT_MIN_WORDS && words <= SIG.SHORT_TEXT_MAX_WORDS &&
        dur >= longPauseThresholdMs(words) && dur <= SIG.LONG_PAUSE_MAX_MS && !this.field && inspected < 3) {
      this.push({ k: 'pause', at, t: performance.now(), words, ms: Math.round(dur) });
    }
    this.still = { since: at, words: null };
  }

  /* ---------------- selections ---------------- */

  private checkSelection(): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      this.lastSelectionKey = '';
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node instanceof Element ? node : node.parentElement;
    if (!el || this.ours(el) || el.closest(FIELD)) return;
    const len = sel.toString().length;
    if (len < SIG.SELECT_MIN_CHARS) return;
    const key = `${len}:${range.startOffset}:${range.endOffset}`;
    if (key === this.lastSelectionKey) return;
    this.lastSelectionKey = key;
    const nowW = performance.now();
    this.push({ k: 'select', at: this.nowAt(nowW), t: nowW });
    this.markAction(nowW, false);
  }

  /* ---------------- forms ---------------- */

  private onFocusIn(e: Event): void {
    this.lastResponseW = performance.now();
    if (this.ours(e.target)) return;
    const f = fieldOf(composedTarget(e));
    if (!f) return;
    if (this.touched.has(f)) {
      const n = (this.returns.get(f) ?? 0) + 1;
      this.returns.set(f, n);
      if (n === SIG.FIELD_RETURNS) this.stuck('returns');
    }
    this.touched.add(f);
    this.field = { el: f, focusAt: this.nowAt(), typed: false, inserted: false, stuck: false };
  }

  private onFocusOut(e: Event): void {
    this.lastResponseW = performance.now();
    const cur = this.field;
    const f = composedTarget(e);
    if (!cur || !f || cur.el !== f) return;
    this.field = null;
    const typed = cur.typed;
    // M3: errors counted on blur only (never on every keystroke); :invalid only after the person typed.
    this.later(300, () => {
      const invalid = (typed && f.matches(':invalid')) || f.getAttribute('aria-invalid') === 'true';
      if (!invalid) return;
      const n = (this.errors.get(f) ?? 0) + 1;
      this.errors.set(f, n);
      if (n === SIG.FIELD_ERRORS) this.stuck('errors');
    });
  }

  private onInput(e: Event): void {
    const nowW = performance.now();
    this.lastResponseW = nowW;
    const cur = this.field;
    if (!cur || this.ours(e.target)) return;
    const f = composedTarget(e);
    if (!f || (f !== cur.el && !cur.el.contains(f))) return;
    const type = (e as InputEvent).inputType ?? '';
    if (type.startsWith('delete') || type === 'historyUndo') {
      if (cur.inserted && nowW - this.lastDeleteW > SIG.CORRECTION_MERGE_MS) {
        this.push({ k: 'correction', at: this.nowAt(nowW), t: nowW });
      }
      this.lastDeleteW = nowW;
    } else {
      cur.inserted = true;
    }
    if (!cur.typed) {
      cur.typed = true;
      this.markProgress(nowW);
    }
    this.markAction(nowW, false);
  }

  private stuck(why: 'pause' | 'returns' | 'errors'): void {
    const t = performance.now();
    this.push({ k: 'stuck', at: this.nowAt(t), t, why });
    this.trigger = true;
  }

  /* ---------------- the 1 s tick ---------------- */

  private tick(): void {
    const nowW = performance.now();
    this.syncClock();
    if (!this.isActive()) return;
    const at = this.nowAt(nowW);

    // F1: dwell on the element under a resting pointer
    if (this.hoverEl && nowW - this.hoverSinceW >= SIG.HOVER_ITEM_MS && !this.hoverItems.has(this.hoverEl)) {
      this.hoverItems.set(this.hoverEl, at);
    }
    // F1: >= 20 s without an action and >= 6 items inspected without choosing any: one hunting episode
    if (!this.huntOpen && at - this.lastActionAt >= SIG.HUNT_NO_ACTION_MS) {
      let items = 0;
      for (const t of this.hoverItems.values()) if (t > at - SIG.WINDOW_MS) items++;
      if (items >= SIG.HUNT_MIN_ITEMS) {
        this.huntOpen = true;
        this.push({ k: 'hunt', at, t: nowW });
        this.trigger = true;
      }
    }
    // M1: a focused field with no typing for 20 s of active time
    const f = this.field;
    if (f && !f.typed && !f.stuck && at - f.focusAt >= SIG.FIELD_PAUSE_MS) {
      f.stuck = true;
      this.stuck('pause');
    }
    // R3: the 15 s stay after a return
    for (const s of this.scrollers.values()) {
      const range = s.bt?.tick(at);
      if (range) {
        this.push({ k: 'reread', at, t: nowW, range });
        this.trigger = true;
      }
    }
    // R2: pinch episodes
    const p = this.pinch.tick(nowW, window.visualViewport?.scale ?? 1);
    if (p) {
      this.push({ k: 'zoom', at, t: nowW, from: 1, to: p.to });
      this.trigger = true;
    }
    // R4: measure the words of a still viewport once, shortly before the shortest long-pause threshold
    if (this.still.words === null && at - this.still.since >= SIG.LONG_PAUSE_MIN_MS - 2000 && nowW - this.lastScrollW > 1000) {
      this.still.words = visibleWords((t) => this.ours(t));
    }
    this.prune(at, nowW);

    const idle = this.idle(nowW);
    if (this.deferred) this.redoDeferred(nowW, idle.strict);
    if (this.inflight) return;
    const slot = this.jevSlotFree(nowW);
    const ac = this.afterCheck;
    if (ac && slot && idle.strict && (this.actCount - ac.acts >= SIG.AFTER_CHECK_ACTIVATIONS || at - ac.at >= SIG.AFTER_CHECK_MS)) {
      this.afterCheck = null;
      void this.evaluate('after_check');
      return;
    }
    if (this.reaskAt !== null && slot && idle.strict && (at >= this.reaskAt || (this.cusum?.s ?? 0) >= SIG.REASK_CUSUM)) {
      this.reaskAt = null;
      this.reasked = true;
      void this.evaluate('reask');
      return;
    }
    if (this.pendingCheck && slot) {
      void this.evaluate('early');
      return;
    }
    if (at - this.lastEvalAt >= SIG.EVAL_EVERY_MS) void this.evaluate('timer');
    else if ((this.retriesSinceGate >= SIG.RETRIES_FOR_EARLY_GATE || this.trigger) && idle.strict) void this.evaluate('early');
  }

  private prune(at: number, nowW: number): void {
    const cut = at - SIG.LOG_KEEP_MS;
    if (this.log.length && (this.log[0]?.at ?? at) < cut) this.log = this.log.filter((e) => e.at >= cut);
    for (const [el, t] of this.hoverItems) if (t < at - SIG.WINDOW_MS) this.hoverItems.delete(el);
    const hourAgo = nowW - 3_600_000;
    if (this.calls.length && (this.calls[0] ?? nowW) < hourAgo) this.calls = this.calls.filter((c) => c >= hourAgo);
  }

  /** §5.3: no key in 2 s, no button held, no scroll in 1 s, no text field focused (the form offer may show beside a field). */
  private idle(nowW: number): { strict: boolean; form: boolean } {
    const base = this.isActive() && nowW - this.lastKeyW >= SIG.IDLE_KEY_MS && !this.buttonDown &&
      nowW - this.lastScrollW >= SIG.IDLE_SCROLL_MS;
    const a = deepActiveElement();
    const fieldFocused = !!this.field || (!!a && a.matches(FIELD));
    return { strict: base && !fieldFocused, form: base };
  }

  /** §5.1: at most 1 Jev call per 15 s per tab and 20 per page-hour. */
  private jevSlotFree(nowW: number): boolean {
    const last = this.calls[this.calls.length - 1];
    if (last !== undefined && nowW - last < SIG.JEV_MIN_GAP_MS) return false;
    return this.calls.filter((c) => nowW - c < 3_600_000).length < SIG.JEV_MAX_PER_HOUR;
  }

  /* ---------------- counts, gate, Jev, offers ---------------- */

  private live(at: number): LiveFacts {
    const vv = window.visualViewport;
    return {
      windowMs: Math.min(SIG.WINDOW_MS, at),
      timeOnPageSec: at / 1000,
      zoomLevel: this.zoom.current * (vv ? vv.scale : 1),
      msSinceProgress: at - this.lastProgressAt,
      pointingOff: this.pointingOff(),
    };
  }

  snapshot(): StruggleCounts {
    const nowW = performance.now();
    const at = this.nowAt(nowW);
    return summarize(this.log, at - SIG.WINDOW_MS, at, this.live(at));
  }

  private async evaluate(reason: EvalReason): Promise<void> {
    const nowW = performance.now();
    const at = this.nowAt(nowW);
    const fit = this.host.fit();
    if (!fit || this.inflight || !this.isActive()) return;
    this.lastEvalAt = at;
    this.trigger = false;
    // Jev and the offer policy see the last 60 s of active time; the gate sees the same window with the CUSUM
    // trials limited to those since its previous run (see gateCounts). The gate runs on schedule even while the
    // Jev budget is spent, so the statistic stays current (the hold band re-asks at CUSUM >= 4.5).
    const live = this.live(at);
    const counts = summarize(this.log, at - SIG.WINDOW_MS, at, live);
    let check = reason === 'reask' || reason === 'after_check' || this.pendingCheck;
    if ((reason === 'timer' || reason === 'early') && this.cusum) {
      if (Math.round(at / 1000) === Math.round(this.lastGateAt / 1000)) {
        this.trigger = true; // same second as the previous gate run: try again on the next tick
      } else {
        try {
          const g = gate(this.cusum, gateCounts(this.log, this.lastGateAt, at, live), fit);
          this.cusum = g.state;
          check = check || g.check;
        } catch {
          /* keep the previous state */
        }
        this.lastGateAt = at;
        this.retriesSinceGate = 0;
      }
    }
    if (!check) return;
    if (!this.jevSlotFree(nowW)) {
      this.pendingCheck = true; // ask as soon as the 15 s / 20 per hour budget allows
      return;
    }
    this.pendingCheck = false;
    let signals: StruggleSignals;
    try {
      signals = toSignals(counts, fit, this.host.pageKind());
    } catch {
      return;
    }
    this.inflight = true;
    this.calls.push(nowW);
    this.lastSent = signals;
    let j: unknown;
    try {
      j = await this.host.ask<StruggleJudgment>({ type: 'struggle', signals });
    } catch {
      return;
    } finally {
      this.inflight = false;
    }
    if (!this.running || !isJudgment(j)) return;
    this.judged(j, counts);
  }

  private judged(j: StruggleJudgment, counts: StruggleCounts): void {
    const nowW = performance.now();
    this.history.push(j);
    if (this.history.length > 12) this.history.shift();
    // §5.2 rule 2: deliberate activity explains the pointer pattern; suppress pointing gates for this page view.
    if ((j.kinds.deliberate ?? 0) >= 0.40 && counts.nearMissClicks + counts.lostClicks + counts.repeatClicks > 0) {
      this.pointingSuppressed = true;
    }
    this.deferred = null;
    const memBefore = this.mem;
    if (!memBefore) {
      this.host.onJudgment(j, [], []);
      return;
    }
    const idle = this.idle(nowW);
    let r: { offers: Offer[]; waiting: StruggleKind[]; mem: OfferMemory };
    try {
      r = decideOffers(this.history, counts, memBefore, Date.now(), nowW - this.startedW, idle.strict || idle.form);
    } catch {
      this.host.onJudgment(j, [], []);
      return;
    }
    let offers = r.offers;
    if (offers.length && !idle.strict) {
      // A text field is focused: no offer appears now. Decide again at the next idle moment.
      offers = [];
      this.deferred = { memBefore, counts, until: nowW + 30_000 };
    } else {
      this.mem = r.mem;
      if (offers.length) void this.saveMem();
      else if (!idle.strict) this.deferred = { memBefore, counts, until: nowW + 30_000 };
    }
    if (r.waiting.length) {
      if (!this.reasked && this.reaskAt === null) this.reaskAt = this.nowAt(nowW) + SIG.REASK_MS;
    } else {
      this.reaskAt = null;
      this.reasked = false;
    }
    this.host.onJudgment(j, r.waiting, offers);
  }

  /** The person was busy when Jev answered: make the same decision again at the first idle moment. */
  private redoDeferred(nowW: number, idleNow: boolean): void {
    const d = this.deferred;
    if (!d) return;
    if (nowW > d.until) {
      this.deferred = null;
      return;
    }
    if (!idleNow) return;
    this.deferred = null;
    const latest = this.history[this.history.length - 1];
    if (!latest) return;
    try {
      const r = decideOffers(this.history, d.counts, d.memBefore, Date.now(), nowW - this.startedW, true);
      if (!r.offers.length) return;
      this.mem = r.mem;
      void this.saveMem();
      this.host.onJudgment(latest, r.waiting, r.offers);
    } catch {
      /* keep quiet */
    }
  }

  offerOutcome(kind: OfferKind, outcome: OfferOutcome): void {
    const now = Date.now();
    const m = this.mem;
    if (m) {
      let next: OfferMemory = m;
      try {
        if (outcome === 'not_now') next = snoozeOffer(m, kind, now);
        if (outcome === 'never') next = turnOffOffer(m, kind);
      } catch {
        next = m;
      }
      if (outcome === 'undone' && this.afterCheck?.kind === kind && now - this.afterCheck.acceptedAt <= SIG.FAST_UNDO_MS) {
        next = { ...next, snoozedUntil: { ...next.snoozedUntil, [kind]: now + SIG.FAST_UNDO_OFF_MS } };
      }
      this.mem = next;
      void this.saveMem();
    }
    if (outcome === 'accepted') {
      this.afterCheck = { kind, at: this.nowAt(), acts: this.actCount, acceptedAt: now };
    } else if (outcome === 'undone' || outcome === 'never') {
      this.afterCheck = null;
    }
    try { this.cusum = this.cusum ? resetCusum(this.cusum) : initialCusum(); } catch { /* keep the old state */ }
    this.reaskAt = null;
    this.reasked = false;
    this.pendingCheck = false;
    this.deferred = null;
    this.retriesSinceGate = 0;
  }

  /* ---------------- offer memory persistence ---------------- */

  private async loadMem(): Promise<void> {
    const st = chromeStorage();
    if (!st || !this.mem) return;
    try {
      const got = await st.get(MEM_KEY);
      const v = got[MEM_KEY];
      const base = this.mem;
      if (!isObj(v) || !base || !this.running) return;
      const sites = isObj(v.sites) ? v.sites : {};
      const site = sites[location.origin];
      const snoozed = isObj(site) && isObj(site.snoozedUntil) ? site.snoozedUntil : {};
      const snoozedUntil: Record<string, number> = { ...base.snoozedUntil };
      for (const [k, t] of Object.entries(snoozed)) if (typeof t === 'number' && t > Date.now()) snoozedUntil[k] = t;
      const off = Array.isArray(v.off) ? v.off.filter((x): x is string => typeof x === 'string') : [];
      this.mem = {
        ...base,
        lastOfferAt: typeof v.lastOfferAt === 'number' ? v.lastOfferAt : base.lastOfferAt,
        // core resets `today` itself when `day` is not today's date
        day: typeof v.day === 'string' ? v.day : base.day,
        today: typeof v.today === 'number' ? v.today : base.today,
        off: Array.from(new Set([...base.off, ...off])),
        snoozedUntil,
      };
    } catch {
      /* storage unavailable */
    }
  }

  private async saveMem(): Promise<void> {
    const st = chromeStorage();
    const m = this.mem;
    if (!st || !m) return;
    try {
      const got = await st.get(MEM_KEY);
      const prev = got[MEM_KEY];
      const now = Date.now();
      const sites: StoredMem['sites'] = {};
      const prevSites = isObj(prev) && isObj(prev.sites) ? prev.sites : {};
      for (const [origin, s] of Object.entries(prevSites)) {
        const su = isObj(s) && isObj(s.snoozedUntil) ? s.snoozedUntil : {};
        const kept: Record<string, number> = {};
        for (const [k, t] of Object.entries(su)) if (typeof t === 'number' && t > now) kept[k] = t;
        if (Object.keys(kept).length) sites[origin] = { snoozedUntil: kept };
      }
      const mine: Record<string, number> = {};
      for (const [k, t] of Object.entries(m.snoozedUntil)) if (t > now) mine[k] = t;
      if (Object.keys(mine).length) sites[location.origin] = { snoozedUntil: mine };
      else delete sites[location.origin];
      const stored: StoredMem = { day: m.day ?? '', lastOfferAt: m.lastOfferAt, today: m.today, off: [...m.off], sites };
      await st.set({ [MEM_KEY]: stored });
    } catch {
      /* storage unavailable */
    }
  }
}
