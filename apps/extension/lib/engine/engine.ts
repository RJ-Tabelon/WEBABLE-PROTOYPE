import { offerQuestion } from '@webable/core/explain/templates';
import { OP_CATALOG, type OpId } from '@webable/core/ops/catalog';
import type {
  AdaptationPlan,
  AppliedChange,
  DecisionTrace,
  PlannedOp,
  VerifyCode,
} from '@webable/core/policy/types';

import type { EngineStatus } from '../protocol';
import { extract } from './extract';
import type { ViewportGuard } from './fitview/types';
import { LayerManager } from './ops/layer';
import { hasToken, MarkBook, setOffGate, tokenOp, tokensOf } from './ops/marks';
import { BISECT_ORDER, levelValue, OPS } from './ops/registry';
import { textPlanSummary, textScope } from './ops/text';
import {
  notNeeded,
  type AppliedOp,
  type OpEnv,
  type Prepared,
} from './ops/types';
import {
  FrictionDetector,
  installFriction,
  type FrictionSignal,
  type FrictionWiring,
} from './runtime/friction';
import { MutationScheduler, type FlushRoots } from './runtime/mutations';
import { RouteWatcher } from './runtime/route';
import type { Extraction, PageFacts, VocabPort } from './types';
import { InPageLayer, type OutlineGroup } from './ui/layer';
import { setColorParseFallback, type RGBA } from './util/color';
import {
  composedContains,
  isOurs,
  shadowRootsWithin,
  SKIP_TAGS,
} from './util/dom';
import type { Box } from './util/geometry';
import { Mutex, settle, whenIdle, yieldToMain } from './util/schedule';
import { readingAnchor, restoreAnchor, type Anchor } from './verify/anchor';
import {
  buildProbes,
  clippingContainers,
  diffSnapshots,
  isClipped,
  regionRootsOf,
  takeSnapshot,
  templateKey,
  viewportGuard,
  type Failure,
  type Snapshot,
} from './verify/checks';

/**
 * The in-page adaptation engine: a pure module over one document. It extracts
 * page structure, applies a plan's ops in one write, verifies them, rolls
 * back what fails, keeps them applied as the page changes, and renders
 * WebAble's in-page layer. It knows nothing about messaging; the content
 * script adapter connects it to the service worker.
 *
 * Invariants enforced here: host ARIA, accessible names, tabindex, focus
 * order and key handling are never modified; every change is removable on
 * its own and verified or rolled back; behaviour-triggered changes are only
 * ever offered.
 */

export interface EngineEvents {
  friction(signal: FrictionSignal, ops: readonly OpId[]): void;
  offerAnswer(op: OpId, answer: 'accept' | 'dismiss' | 'timeout'): void;
  /** The person pressed Undo in the toast; the engine has already undone these. */
  undone(changes: AppliedChange[], via: 'toast'): void;
  routeChanged(): void;
  /** Host content, styles, fonts or viewport changed; measure and decide again. */
  pageChanged?(): void;
  /** First real page interaction; late AI additions must stand down. */
  interacted?(): void;
  /** Show-on-page outlines were dismissed with Esc. */
  outlinesClosed?(): void;
}

export interface EngineOptions {
  doc?: Document;
  vocab: VocabPort;
  events: EngineEvents;
  /** chrome.dom.openOrClosedShadowRoot when available. */
  openClosed?: (el: Element) => ShadowRoot | null;
  /** Ops whose pre-paint stylesheet is registered for this profile. */
  prePaint?: readonly OpId[];
}

export interface EngineConfig {
  reduceMotion: boolean;
  shortcuts: { focusLayer: string; undoAll: string };
}

export interface ApplyOptions {
  /** Apply ops planned as offers (the person accepted). */
  acceptOffers?: boolean;
  /** Remove applied ops that are absent from this plan (a fresh decision). */
  replace?: boolean;
  /** Rebuild equal-level ops against newly measured elements/geometry. */
  refresh?: boolean;
  /** First auto changes on this site: show the toast. */
  announce?: boolean;
  /**
   * The page changed under an applied fit (content, route, viewport), not the
   * person's fit: never remove an applied op or change its level or scope;
   * add only ops new to this page view, and extend applied ops to text they
   * do not cover yet. Ignored with `replace`.
   */
  sticky?: boolean;
}

export interface VerifyReport {
  failures: Array<{ code: VerifyCode; ops: OpId[] }>;
  rolledBack: OpId[];
  busyMs: number;
}

export interface EnginePerf {
  extract: Extraction['perf'] | null;
  /** Busy time of the last verification (snapshots + diffs), ms. */
  verifyMs: number;
  /** ...split into probe building, the baseline, diffs and page-wide sweeps, ms. */
  verifyPhases: { probes: number; base: number; diff: number; sweep: number };
  /** Script time of the last write phase (marks, one replaceSync per layer, effects), ms. */
  writeMs: number;
  /** The single style and layout pass the write caused, ms. */
  layoutMs: number;
}

/** Order used to pick the toast's headline change. */
const TOAST_ORDER: readonly OpId[] = [
  'page_zoom',
  'text_floor',
  'target_size',
  'contrast',
  'line_spacing',
  'line_length',
  'calm_motion',
  'pause_media',
  'dim_distractions',
  'unpin_bars',
  'target_spacing',
  'menu_grace',
  'steady_clicks',
  'focus_view',
  'reading_guide',
];

const FALLBACK_QUESTION: Record<OpId, string> = {
  text_floor: 'Make text larger on this site?',
  page_zoom: 'Zoom this site so everything is larger?',
  line_spacing: 'Add space between lines of text here?',
  line_length: 'Keep lines of text shorter here?',
  contrast: 'Darken faint text on this site?',
  focus_outline: 'Show a clear focus outline on this site?',
  target_size: 'Buttons on this page are small. Make them bigger here?',
  target_spacing: 'Add room between controls on this page?',
  steady_clicks:
    'Count clicks on the button you pressed, even if the pointer slips?',
  menu_grace: 'Keep menus open a little longer here?',
  calm_motion: 'Stop moving things on this site?',
  pause_media: 'Pause videos that play on their own here?',
  dim_distractions: 'Fade busy areas on this page?',
  focus_view: 'Soften everything except the main content?',
  unpin_bars: 'Let bars stuck to the top scroll away here?',
  reading_guide: 'Show a reading guide on this page?',
};

/** "WebAble suggests ... here." for the status line when a chip appears. */
const SUGGESTS: Record<OpId, string> = {
  text_floor: 'larger text',
  page_zoom: 'zooming this site',
  line_spacing: 'more space between lines',
  line_length: 'shorter lines of text',
  contrast: 'darker faint text',
  focus_outline: 'a clear focus outline',
  target_size: 'bigger click targets',
  target_spacing: 'more room between controls',
  steady_clicks: 'steadier clicks',
  menu_grace: 'menus that stay open longer',
  calm_motion: 'stopping moving things',
  pause_media: 'pausing videos that play on their own',
  dim_distractions: 'fading busy areas',
  focus_view: 'softening everything except the main content',
  unpin_bars: 'letting stuck bars scroll away',
  reading_guide: 'a reading guide',
};

const lead = (s: string, fallback: number): number => {
  const m = /^\d+/.exec(s);
  return m ? Number(m[0]) : fallback;
};
const many = (n: number, one: string, more: string): string =>
  `${n}\u00a0${n === 1 ? one : more}`;

/** The toast's one line, worded as WebAble's action (design-final.md 13). */
const TOAST_LINE: Record<
  OpId,
  (fit: { before: string; after: string }, count: number) => string
> = {
  text_floor: (f) => `WebAble set text to ${f.after} here.`,
  // docs/10 §7: the scale's toast is also where Fit view is offered.
  page_zoom: () => 'Made this page bigger for your fit.',
  line_spacing: (f) => `WebAble set line spacing to ${f.after} here.`,
  line_length: (f) => `WebAble kept lines to ${f.after} here.`,
  contrast: (f) => `WebAble raised text contrast to ${f.after} here.`,
  focus_outline: () => 'WebAble turned on a clear focus outline here.',
  target_size: (f) => `WebAble enlarged click targets to ${f.after} here.`,
  target_spacing: (f) => `WebAble set ${f.after} between controls here.`,
  steady_clicks: () => 'WebAble steadied clicks on this page.',
  menu_grace: (f) => `WebAble kept menus open ${f.after} longer here.`,
  calm_motion: (f, n) =>
    `WebAble paused ${many(lead(f.before, n), 'moving thing', 'moving things')}.`,
  pause_media: (f, n) =>
    `WebAble paused ${many(lead(f.before, n), 'autoplaying video', 'autoplaying videos')}.`,
  dim_distractions: (f) => `WebAble faded busy areas to ${f.after} here.`,
  focus_view: () => 'WebAble softened everything except the main content.',
  unpin_bars: (_f, n) =>
    `WebAble let ${many(n, 'stuck bar', 'stuck bars')} scroll away here.`,
  reading_guide: () => 'WebAble turned on the reading guide.',
};

/** Targets show their original box (a dashed ghost) and a tinted fit box. */
const TARGET_OPS: ReadonlySet<OpId> = new Set([
  'target_size',
  'target_spacing',
]);

/**
 * Ops that fit around a failure: when one card clips or one line overflows,
 * only the elements involved are put back and the rest of the fit stays.
 * text_floor is not one of them (docs/10 §5.2): it decides per template
 * field, so a failure rolls the whole op back and nothing is left as a
 * patchwork. Ops whose prepare names droppable classes (target_size) roll
 * back one class at a time instead.
 */
const PARTIAL_OPS: ReadonlySet<OpId> = new Set(['line_spacing', 'line_length']);
/** Ops whose new content is marked inside the MutationObserver callback, before it paints. */
const SYNC_OPS: ReadonlySet<OpId> = new Set(['text_floor', 'line_spacing']);
/** Ops whose fit depends on the tab's zoom (page scale x own zoom): a new zoom measures them again. */
const SCALED_OPS: ReadonlySet<OpId> = new Set([
  'text_floor',
  'target_size',
  'page_zoom',
]);
/** Ops whose marks are checked for clipping across the whole page, not just near the viewport. */
const SWEPT_OPS: ReadonlySet<OpId> = new Set(['text_floor', 'target_size']);
/** Failures only a change of layout can cause (paint ops are never suspects). */
const LAYOUT_CODES: ReadonlySet<VerifyCode> = new Set([
  'overflow',
  'clip',
  'overlap',
  'truncation',
  'hierarchy',
  'inconsistent',
]);
/** Failures only a change of text size can cause. */
const SIZE_CODES: ReadonlySet<VerifyCode> = new Set([
  'hierarchy',
  'inconsistent',
]);
/** Failures whose boxes are remembered, so an unchanged page does not retry the fit. */
const REMEMBERED_CODES: ReadonlySet<VerifyCode> = new Set([
  'clip',
  'overflow',
  'overlap',
  'truncation',
  'hierarchy',
  'inconsistent',
]);
const EMPTY: ReadonlySet<string> = new Set();
/** Busy time allowed per MutationObserver callback for pre-paint marking, ms. */
const SYNC_BUDGET_MS = 6;
/** Quiet time after the last scroll before measuring or verifying again, ms. */
const SCROLL_QUIET_MS = 250;
/** Never wait longer than this for scrolling to stop, ms. */
const SCROLL_MAX_DEFER_MS = 3000;
/** Minimum spacing between fresh decisions the page asks for on its own, ms. */
const REPLAN_MIN_MS = 5000;
/** ...while content may still need a planned op, or a rejected fit's box moved. */
const REPLAN_EAGER_MS = 1200;
/** Added elements since the last decision that count as new content. */
const REPLAN_MIN_ADDED = 3;
/** Whole-op rollbacks after which a changed page no longer retries the op. */
const MAX_ROLLBACKS = 3;
/** Keys that scroll the page. */
const SCROLL_KEYS: ReadonlySet<string> = new Set([
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp',
  'Home',
  'End',
  ' ',
  'Spacebar',
]);

const FRICTION_REASON: Record<FrictionSignal, string> = {
  misclick_burst: 'You clicked just next to small buttons a few times.',
  rage_click: 'You clicked the same spot several times.',
  zoom_in: 'You zoomed in on this page.',
  scroll_reversal: 'You scrolled back over the same lines a few times.',
};

function offerCopy(planned: PlannedOp): { question: string; reason: string } {
  try {
    const q = offerQuestion(planned.trace);
    if (q.question) return q;
  } catch {
    // Templates not available: fall back to the op's own question.
  }
  const friction = planned.trace.evidence.find((e) => e.kind === 'friction');
  return {
    question: FALLBACK_QUESTION[planned.op],
    reason:
      friction && friction.kind === 'friction'
        ? FRICTION_REASON[friction.signal]
        : '',
  };
}

function canvasColorParser(doc: Document): (css: string) => RGBA | null {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const c = doc.createElement('canvas');
    c.width = 1;
    c.height = 1;
    ctx = c.getContext('2d', { willReadFrequently: true });
  } catch {
    ctx = null;
  }
  return (css) => {
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 255) / 255];
  };
}

const docBox = (el: Element, view: Window): Box => {
  const r = el.getBoundingClientRect();
  return {
    left: r.left + view.scrollX,
    top: r.top + view.scrollY,
    right: r.right + view.scrollX,
    bottom: r.bottom + view.scrollY,
  };
};

export class Engine {
  readonly doc: Document;
  readonly view: Window;
  private readonly marks = new MarkBook();
  private readonly layers: LayerManager;
  private readonly ui: InPageLayer;
  private readonly mutex = new Mutex();
  private readonly applied = new Map<OpId, AppliedOp>();
  private readonly reports = new Map<OpId, AppliedChange>();
  private prePaint: Set<OpId>;
  private facts: PageFacts | null = null;
  private lastExtraction: Extraction | null = null;
  private lastPlan: AdaptationPlan | null = null;
  private _status: EngineStatus = 'idle';
  private paused = false;
  private destroyed = false;
  private scheduler: MutationScheduler | null = null;
  private route: RouteWatcher | null = null;
  private friction: FrictionWiring | null = null;
  private maintenance: ReturnType<typeof setInterval> | null = null;
  private cancelIdle: (() => void) | null = null;
  private offerShownOnce = false;
  /** An offer waiting out the first-paint delay. */
  private offerWait: { op: OpId; timer: ReturnType<typeof setTimeout> } | null =
    null;
  /** The change the toast headlines (its [Undo] undoes just that one). */
  private toastOp: OpId | null = null;
  private readonly bornAt = performance.now();
  private escOff: (() => void) | null = null;
  private offPageChanges: (() => void) | null = null;
  private offInput: (() => void) | null = null;
  private lastInputAt = -Infinity;
  private readonly rejectedFits = new Map<
    OpId,
    {
      level: number;
      scope: PlannedOp['scope'];
      code: VerifyCode;
      checks: Map<Element, string>;
    }
  >();
  readonly perf: EnginePerf = {
    extract: null,
    verifyMs: 0,
    verifyPhases: { probes: 0, base: 0, diff: 0, sweep: 0 },
    writeMs: 0,
    layoutMs: 0,
  };
  /**
   * Elements each op was fitted around after a failure, with the native
   * constraints they failed under. Not marked again until those change (the
   * card grows, the line may wrap): then they are tried, and checked, again.
   */
  private readonly exempt = new Map<OpId, WeakMap<Element, string>>();
  /** Elements marked after their op was verified, waiting for a check. */
  private readonly unverified = new Set<Element>();
  /** Whole-op rollbacks this page view (a changed page retries only a few times). */
  private readonly rollbacks = new Map<OpId, number>();
  /** Last trusted wheel, touch, scroll-key or pointer input. */
  private lastUserScrollAt = -Infinity;
  /** Last scroll of any origin (person, page script, browser anchoring). */
  private lastScrollAt = -Infinity;
  /** When debounced work first waited for scrolling to stop (0: not waiting). */
  private deferredSince = 0;
  /** When the engine last applied a decision. */
  private lastPlanAt = -Infinity;
  /** Elements the page added since the last decision. */
  private addedSincePlan = 0;
  /** A fresh decision is owed: 'eager' when content or constraints call for one soon. */
  private replanWanted: 'eager' | 'normal' | null = null;
  private replanTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWidth = 0;
  /** Fit view is open (docs/10 §4.6): Tailor stays applied but untouched. */
  private frozen = false;
  /** Levels the person set while frozen, applied when it thaws. */
  private readonly pendingLevels = new Map<OpId, number>();
  /** The page changed while frozen: a full pass is owed when it thaws. */
  private missedWhileFrozen = false;
  /** A plan that arrived while frozen, applied when it thaws (the latest wins). */
  private deferred: { plan: AdaptationPlan; options: ApplyOptions } | null =
    null;
  /** Nesting depth of measure mode (extraction, Fit view reads, native reads). */
  private measureDepth = 0;
  /**
   * Template classes each op dropped on this page view (class-level
   * rollback): never marked again until the viewport width or route changes.
   */
  private readonly dropped = new Map<OpId, Set<string>>();

  constructor(private readonly opts: EngineOptions) {
    this.doc = opts.doc ?? document;
    const view = this.doc.defaultView;
    if (!view) throw new Error('Engine: document has no window');
    this.view = view;
    this.layers = new LayerManager(this.doc);
    this.prePaint = new Set(opts.prePaint ?? []);
    setColorParseFallback(canvasColorParser(this.doc));
    this.ui = new InPageLayer(this.doc, {
      offerAnswer: (op, answer) => this.opts.events.offerAnswer(op, answer),
      toastUndo: (all) => void this.undoFromToast(all),
    });
    // Listen before the first extraction or AI request can complete.
    const onInput = (e: Event): void => {
      if (!e.isTrusted) return;
      const first = this.lastInputAt === -Infinity;
      this.lastInputAt = performance.now();
      if (e.type !== 'keydown' || SCROLL_KEYS.has((e as KeyboardEvent).key))
        this.lastUserScrollAt = this.lastInputAt;
      if (first) this.opts.events.interacted?.();
    };
    const onScroll = (): void => {
      this.lastScrollAt = performance.now();
    };
    const inputs = [
      'pointerdown',
      'keydown',
      'wheel',
      'touchstart',
      'touchmove',
    ] as const;
    for (const type of inputs)
      this.view.addEventListener(type, onInput, {
        capture: true,
        passive: true,
      });
    // Capturing on the window also sees scrolls of inner scroll containers.
    this.view.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    this.offInput = () => {
      for (const type of inputs)
        this.view.removeEventListener(type, onInput, true);
      this.view.removeEventListener('scroll', onScroll, true);
    };
    this.lastWidth = this.view.innerWidth;
  }

  get status(): EngineStatus {
    return this._status;
  }

  get layer(): InPageLayer {
    return this.ui;
  }

  setPrePaint(ops: readonly OpId[]): void {
    this.prePaint = new Set(ops);
  }

  // ======================================================================
  // Extraction
  // ======================================================================

  async extract(): Promise<Extraction> {
    return this.mutex.run(() => this.extractNow());
  }

  private async extractNow(): Promise<Extraction> {
    const anchor = this.anchor();
    const offGate = this.doc.documentElement.getAttribute('data-wa-off');
    // Re-reading our own overrides would make policy conclude that the page
    // no longer needs them and oscillate between on and off.
    const measure = () => {
      this.measureOn();
      if (this.prePaint.has('calm_motion'))
        setOffGate(this.doc, 'calm_motion', true);
    };
    const restore = () => {
      this.measureOff();
      if (this.doc.documentElement.getAttribute('data-wa-off') === offGate)
        return;
      if (offGate === null)
        this.doc.documentElement.removeAttribute('data-wa-off');
      else this.doc.documentElement.setAttribute('data-wa-off', offGate);
    };
    measure();
    try {
      const x = await extract(this.doc, {
        vocab: this.opts.vocab,
        openClosed: this.opts.openClosed,
        previousFacts: this.facts ?? undefined,
        yieldMain: async () => {
          restore();
          await yieldToMain();
          if (!this.destroyed) measure();
        },
      });
      for (const active of this.applied.values()) {
        const held = active.handle?.heldMotion?.();
        if (held?.running) x.signals.motion.running += held.running;
        if (held?.autoplayMedia)
          x.signals.motion.autoplayMedia += held.autoplayMedia;
      }
      this.facts = x.facts;
      this.lastExtraction = x;
      this.perf.extract = x.perf;
      for (const scope of x.facts.scopes)
        if (scope instanceof ShadowRoot) {
          this.layers.addScope(scope);
          this.scheduler?.observe(scope);
        }
      return x;
    } catch (err) {
      this._status = 'unreadable';
      throw err;
    } finally {
      restore();
      this.restore(anchor);
    }
  }

  /** Enter measure mode (every op's CSS removed, synchronously); nests. */
  private measureOn(): void {
    if (this.measureDepth++ === 0) this.layers.measure(true);
  }

  private measureOff(): void {
    if (this.measureDepth === 0) return;
    if (--this.measureDepth === 0) this.layers.measure(false);
  }

  /**
   * Run `fn` with measure mode on (every op's CSS block removed, so reads see
   * the site's own styles), synchronously, restoring before returning.
   * Fit view's skeleton reads use it (docs/10 §4.6).
   */
  measured<T>(fn: () => T): T {
    this.measureOn();
    try {
      return fn();
    } finally {
      this.measureOff();
    }
  }

  /**
   * The reader's place before a write. At the very top of the page the top
   * is the place: nothing is anchored, so growing text below never scrolls
   * the page's header out of view.
   */
  private anchor(main = this.facts?.main ?? null): Anchor | null {
    if (this.view.scrollY <= 0) return null;
    return readingAnchor(this.doc, main);
  }

  /** Keep the reader's place after a write, unless they scrolled since. */
  private restore(anchor: Anchor | null): number {
    return restoreAnchor(this.doc, anchor, this.lastUserScrollAt);
  }

  /** The person or the page is scrolling: measuring now would fight it. */
  private scrolling(now = performance.now()): boolean {
    return (
      now - Math.max(this.lastUserScrollAt, this.lastScrollAt) < SCROLL_QUIET_MS
    );
  }

  /** The box an element's fit failed in: its own width and its clipping ancestors' sizes. */
  private constraintKey(el: Element): string {
    const parts: number[] = [Math.round((el as HTMLElement).clientWidth)];
    let n: Element | null = el;
    for (let i = 0; n && i < 4; i++, n = n.parentElement) {
      if (n.localName === 'body' || n.localName === 'html') break;
      const cs = this.view.getComputedStyle(n);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')
        parts.push(Math.round(n.clientWidth), Math.round(n.clientHeight));
      if (cs.whiteSpace.startsWith('nowrap') || cs.whiteSpace === 'pre')
        parts.push(-1);
    }
    return parts.join(',');
  }

  private exemptAdd(op: OpId, el: Element): void {
    let map = this.exempt.get(op);
    if (!map) this.exempt.set(op, (map = new WeakMap()));
    map.set(el, this.constraintKey(el));
  }

  private isExempt(op: OpId, el: Element): boolean {
    const map = this.exempt.get(op);
    const key = map?.get(el);
    if (key === undefined) return false;
    if (key === this.constraintKey(el)) return true;
    map?.delete(el);
    return false;
  }

  /** A prepared fit without the elements this op was fitted around. */
  private withoutExempt(op: OpId, p: Prepared): Prepared {
    if (!this.exempt.has(op) || !p.marks || p.status !== 'ready') return p;
    const marks = p.marks.filter(([el]) => !this.isExempt(op, el));
    if (marks.length === p.marks.length) return p;
    if (marks.length === 0) return notNeeded('fitted around every element');
    const kept = new Set(marks.map(([el]) => el));
    return {
      ...p,
      marks,
      count: kept.size,
      show: p.show?.filter((el) => kept.has(el)),
    };
  }

  // ======================================================================
  // Apply
  // ======================================================================

  async apply(
    plan: AdaptationPlan,
    options: ApplyOptions = {},
  ): Promise<AppliedChange[]> {
    return this.mutex.run(async () => {
      if (this.destroyed) return [];
      if (this.frozen) {
        // Fit view covers the page: verification would be blind. Apply when
        // it closes; a fresh decision replaces an earlier deferred one.
        const prev = this.deferred;
        this.deferred =
          prev && !options.replace
            ? {
                plan: mergePlans(prev.plan, plan),
                options: {
                  acceptOffers:
                    prev.options.acceptOffers || options.acceptOffers,
                  replace: prev.options.replace,
                  refresh: prev.options.refresh || options.refresh,
                  announce: prev.options.announce || options.announce,
                  sticky: prev.options.sticky && options.sticky,
                },
              }
            : { plan, options };
        return this.changes();
      }
      const sticky = options.sticky === true && !options.replace;
      this.lastPlan =
        options.replace || !this.lastPlan
          ? plan
          : mergePlans(this.lastPlan, plan);
      if (this.paused) return this.changes();
      if (!this.facts) await this.extractNow();
      this._status = 'checking';
      const wanted = plan.ops.filter(
        (p) => p.mode === 'auto' || options.acceptOffers,
      );
      const wantedIds = new Set(wanted.map((p) => p.op));
      if (options.replace)
        for (const op of this.reports.keys())
          if (!wantedIds.has(op)) {
            this.reports.delete(op);
            this.rejectedFits.delete(op);
          }

      // Pre-paint stylesheets the plan does not want stand down.
      if (options.replace || this.reports.size === 0) {
        for (const op of this.prePaint) {
          if (!wantedIds.has(op) && !this.applied.has(op))
            setOffGate(this.doc, op, true);
        }
      }

      const removals: OpId[] = [];
      if (options.replace)
        for (const op of this.applied.keys())
          if (!wantedIds.has(op)) removals.push(op);
      // A step-down of the page scale (or a new zoom of the person's) keeps
      // the person's fit: ops sized in effective px are measured again at the
      // tab's new zoom, same level.
      const zoom = this.zoom();
      const rescaled = (a: AppliedOp): boolean =>
        SCALED_OPS.has(a.op) && Math.abs(a.zoom - zoom) > 0.001;
      const toApply: PlannedOp[] = [];
      for (const p of wanted) {
        const cur = this.applied.get(p.op);
        if (sticky && cur) {
          // The page changed, not the person's fit: keep this op as applied.
          if (cur.level === p.level && sameScope(cur.planned.scope, p.scope))
            cur.planned = p;
          if (rescaled(cur)) toApply.push(cur.planned);
          continue;
        }
        if (
          sticky &&
          !options.acceptOffers &&
          (this.rollbacks.get(p.op) ?? 0) >= MAX_ROLLBACKS
        )
          continue;
        if (!cur && !options.acceptOffers && this.sameRejectedFit(p)) {
          const report = this.reports.get(p.op);
          if (report)
            this.reports.set(p.op, { ...report, trace: p.trace, mode: p.mode });
          continue;
        }
        if (
          cur &&
          (!options.refresh ||
            [
              'calm_motion',
              'pause_media',
              'steady_clicks',
              'menu_grace',
              'reading_guide',
              'focus_outline',
            ].includes(p.op)) &&
          cur.level === p.level &&
          sameScope(cur.planned.scope, p.scope) &&
          !rescaled(cur)
        ) {
          cur.planned = p; // keep the newest trace
          continue;
        }
        toApply.push(p);
      }
      if (removals.length) {
        const anchor = this.anchor();
        for (const op of removals) {
          this.removeOp(op);
          this.reports.delete(op);
        }
        this.layers.flush();
        this.restore(anchor);
      }
      const results = toApply.length ? await this.batch(toApply) : [];
      // Extend what stays applied to text it does not cover yet.
      if (sticky) this.topUp(new Set(toApply.map((p) => p.op)));
      this.lastPlanAt = performance.now();
      this.addedSincePlan = 0;
      this.startRuntime();
      this._status = 'ready';
      if (options.announce) this.announce(results);
      return this.changes();
    });
  }

  private env(): OpEnv {
    const facts = this.facts as PageFacts;
    return {
      doc: this.doc,
      view: this.view,
      facts,
      marks: this.marks,
      layers: this.layers,
      overlay: this.ui,
      prePaint: this.prePaint,
      resolve: (scope) => this.resolve(scope),
      zoom: this.zoom(),
      scale: this.scale(),
      measured: (read) => this.measured(read),
      held: (op) => this.dropped.get(op) ?? EMPTY,
    };
  }

  /** WebAble's page scale in effect for this page view (AdaptationPlan.zoom). */
  private scale(): number {
    const z = this.lastPlan?.zoom;
    return typeof z === 'number' && Number.isFinite(z) && z > 0 ? z : 1;
  }

  /**
   * The tab's whole zoom the plan sizes for: the person's own zoom times
   * WebAble's page scale (AdaptationPlan.ownZoom x zoom). Levels are
   * effective px, so text_floor and target_size aim for level / this CSS px:
   * at 150% browser zoom an 18 px fit is 12 CSS px (docs/10 §3.2, §5.2).
   */
  private zoom(): number {
    const own = this.lastPlan?.ownZoom;
    const person =
      typeof own === 'number' && Number.isFinite(own) && own > 0 ? own : 1;
    return person * this.scale();
  }

  /** Roots whose text sizes are ranked: text_floor's scope. */
  private textScope(env: OpEnv): Element[] {
    const planned =
      this.applied.get('text_floor')?.planned.scope ??
      this.lastPlan?.ops.find((p) => p.op === 'text_floor')?.scope ??
      'page';
    return textScope(env, planned).roots;
  }

  /** Native constraints of a rejected fit; no text content is retained. */
  private rejectionKey(el: Element): string {
    const rect = el.getBoundingClientRect();
    const cs = this.view.getComputedStyle(el);
    return JSON.stringify([
      rect.width,
      rect.height,
      el.scrollWidth,
      el.scrollHeight,
      cs.overflowX,
      cs.overflowY,
      cs.fontSize,
      cs.lineHeight,
      cs.padding,
      cs.whiteSpace,
      cs.overflowWrap,
      cs.wordBreak,
      cs.display,
      cs.maxWidth,
      cs.wordSpacing,
      cs.letterSpacing,
      el.parentElement?.clientWidth,
      el.childElementCount,
      el.textContent?.length,
      this.view.innerWidth,
      this.view.innerHeight,
    ]);
  }

  /** Unrelated page activity must not keep painting a fit already rejected. */
  private sameRejectedFit(p: PlannedOp): boolean {
    const failed = this.rejectedFits.get(p.op);
    if (
      !failed ||
      failed.level !== p.level ||
      !sameScope(failed.scope, p.scope)
    )
      return false;
    this.layers.measure(true);
    try {
      const unchanged = [...failed.checks].every(
        ([el, key]) => el.isConnected && this.rejectionKey(el) === key,
      );
      if (!unchanged) this.rejectedFits.delete(p.op);
      return unchanged;
    } finally {
      this.layers.measure(false);
    }
  }

  /** Component keys -> live elements through the local registry. */
  private resolve(scope: PlannedOp['scope']): Element[] {
    if (scope === 'page' || !this.facts) return [];
    const out: Element[] = [];
    for (const key of scope.regions) {
      for (const f of this.facts.regions.get(key) ?? [])
        if (f.el.isConnected) out.push(f.el);
    }
    return out;
  }

  /**
   * One batch: read phase (every op measures), one write phase, settle,
   * verify, causally confirmed rollback, then real
   * "after" values. Returns the change records for this batch.
   */
  private async batch(planned: PlannedOp[]): Promise<AppliedChange[]> {
    const env = this.env();
    const now = performance.now();
    interface Item {
      p: PlannedOp;
      value: number;
      prepared: Prepared | null;
      error: boolean;
      applied: AppliedOp | null;
      vcode?: VerifyCode;
    }
    const items: Item[] = planned.map((p) => ({
      p,
      value: levelValue(p.op, p.level),
      prepared: null,
      error: false,
      applied: null,
    }));

    // Keep the previous fit installed until its replacement is ready. Prepare
    // against native styles synchronously; never yield with them exposed.
    this.layers.measure(true);
    try {
      // ---- Read phase ----
      for (const it of items) {
        try {
          const prepared = OPS[it.p.op].prepare(env, it.value, it.p.scope);
          it.prepared = PARTIAL_OPS.has(it.p.op)
            ? this.withoutExempt(it.p.op, prepared)
            : prepared;
        } catch {
          it.error = true;
        }
      }
      // What this prepare measured: marks elsewhere (content that arrived
      // after the last extraction) are kept rather than dropped.
      const scanned = new Set<Element>(env.facts.text.map((f) => f.el));
      const ready = items.filter(
        (it) => !it.error && it.prepared?.status === 'ready',
      );
      for (const it of ready) {
        const before = new Map<Element, Box>();
        for (const el of (it.prepared?.show ?? []).slice(0, 24))
          before.set(el, docBox(el, this.view));
        it.applied = {
          op: it.p.op,
          level: it.p.level,
          value: it.value,
          planned: it.p,
          prepared: it.prepared as Prepared,
          handle: null,
          before,
          appliedAt: now,
          zoom: env.zoom,
        };
      }
      let verifyBusy = 0;
      let t = performance.now();
      const probes = buildProbes({
        doc: this.doc,
        view: this.view,
        marked: ready.flatMap((it) => it.prepared?.marks ?? []),
        existing: this.marks.all(200),
        targets: env.facts.targets.map((t) => t.el),
        contrast: [
          ...env.facts.contrast.map((c) => c.el),
          ...ready
            .filter((it) => it.p.op === 'contrast')
            .flatMap((it) => (it.prepared?.marks ?? []).map(([el]) => el)),
        ],
        peers: env.facts.text.map((f) => f.el),
        textScope: this.textScope(env),
        regions: regionRootsOf(env.facts.regions),
      });
      const phases = {
        probes: performance.now() - t,
        base: 0,
        diff: 0,
        sweep: 0,
      };
      const base = takeSnapshot(this.doc, probes);
      verifyBusy += performance.now() - t;
      phases.base = verifyBusy - phases.probes;
      const anchor = this.anchor(env.facts.main);

      this.layers.measure(false);

      // ---- Write phase (one) ----
      t = performance.now();
      for (const it of items) {
        if (it.error) continue;
        const previous = this.applied.get(it.p.op);
        if (it.prepared?.status !== 'ready' || previous?.handle) {
          this.removeOp(it.p.op);
        }
      }
      for (const it of ready) {
        const a = it.applied as AppliedOp;
        if (a.prepared.css) this.layers.set(a.op, a.prepared.css);
        else this.layers.drop(a.op);
        const covers = a.prepared.covers ?? ((el: Element) => scanned.has(el));
        this.marks.replaceOp(
          a.op,
          a.prepared.marks ?? [],
          SYNC_OPS.has(a.op) ? (el) => !covers(el) : undefined,
        );
        this.applied.set(a.op, a);
      }
      this.layers.flush();
      this.layers.finishOwnedTransitions();
      for (const it of ready) {
        const a = it.applied as AppliedOp;
        if (!a.prepared.run) continue;
        try {
          const r = a.prepared.run();
          a.handle = typeof r === 'function' ? { undo: r } : r;
        } catch {
          it.error = true;
          it.vcode = 'apply_error';
          this.removeOp(a.op);
        }
      }
      this.layers.flush();
      this.perf.writeMs = performance.now() - t;
      // The first read after the write pays for the one style and layout pass.
      t = performance.now();
      this.restore(anchor);
      this.perf.layoutMs = performance.now() - t;

      // ---- Settle, verify, roll back ----
      await settle(this.doc);
      this.restore(anchor);
      const live = (): Item[] => ready.filter((it) => !it.error && !it.vcode);
      const ctx = () => ({
        contrastTarget: this.applied.has('contrast')
          ? (this.applied.get('contrast')?.value ?? 4.5)
          : 4.5,
        marked: this.marks.all(300),
        zoom: this.zoom(),
      });
      const diff = (): Failure[] => {
        const s = performance.now();
        try {
          return diffSnapshots(this.doc, probes, base, ctx());
        } finally {
          verifyBusy += performance.now() - s;
          phases.diff += performance.now() - s;
        }
      };
      let fails: Failure[];
      const rejected = new Map<OpId, Set<Element>>();
      try {
        fails = diff();
        for (let round = 0; round < 4 && fails.length; round++) {
          const culprits = new Map<
            OpId,
            { code: VerifyCode; caused: Failure[] }
          >();
          const trials = new Map<string, Failure[]>();
          for (const f of fails) {
            // Tokens locate nearby adaptations, not causes. Verify causality
            // against the current page before undoing any of them.
            for (const op of this.causes(live(), f, diff, trials)) {
              let c = culprits.get(op);
              if (!c) culprits.set(op, (c = { code: f.code, caused: [] }));
              c.caused.push(f);
            }
          }
          if (culprits.size === 0) break;
          for (const [op, { code, caused }] of culprits) {
            // Fit around the failure first: one clipped card or overflowing
            // line puts back only its own elements; the rest of the fit stays.
            if (this.fitAround(op, caused, diff) > 0) continue;
            // Ops that decide per template class drop the failing class.
            if (this.dropClasses(op, caused, diff) > 0) continue;
            for (const f of caused)
              if (REMEMBERED_CODES.has(f.code)) {
                let boxes = rejected.get(op);
                if (!boxes) rejected.set(op, (boxes = new Set()));
                boxes.add(f.el);
              }
            const it = ready.find((x) => x.p.op === op);
            if (it) it.vcode = code;
            this.rollbacks.set(op, (this.rollbacks.get(op) ?? 0) + 1);
            this.removeOp(op);
          }
          this.layers.flush();
          this.layers.finishOwnedTransitions();
          this.restore(anchor);
          fails = diff();
        }
      } catch {
        for (const it of live()) {
          it.vcode = 'apply_error';
          this.removeOp(it.p.op);
        }
        this.layers.flush();
      }
      // The probes cover the viewport and its surroundings; clipping
      // anywhere else on the page (a teaser card far below) is caught here.
      try {
        const t2 = performance.now();
        const fitted = this.clipSweep(
          live()
            .filter((it) => PARTIAL_OPS.has(it.p.op))
            .flatMap((it) => this.pairsFor(it.p.op)),
        );
        let emptied = false;
        for (const [op, boxes] of fitted) {
          if (this.marks.countFor(op) > 0) continue;
          // Nothing of this op fits anywhere: a whole-op rollback.
          const it = ready.find((x) => x.p.op === op);
          if (!it || it.vcode || it.error) continue;
          it.vcode = 'clip';
          let set = rejected.get(op);
          if (!set) rejected.set(op, (set = new Set()));
          for (const b of boxes) set.add(b);
          this.rollbacks.set(op, (this.rollbacks.get(op) ?? 0) + 1);
          this.removeOp(op);
          emptied = true;
        }
        // Ops that are never fitted around element by element: anything they
        // clip anywhere drops its class, or the whole op.
        for (const it of live()) {
          const op = it.p.op;
          if (!SWEPT_OPS.has(op)) continue;
          const fixed = this.sweepClip(op);
          if (fixed.length === 0) continue;
          const caused: Failure[] = fixed.map((el) => ({
            code: 'clip',
            el,
            ops: new Set([op]),
          }));
          const recheck = (): Failure[] =>
            caused.filter((f) => isClipped(f.el, this.view));
          if (this.dropClasses(op, caused, recheck) > 0) continue;
          it.vcode = 'clip';
          let set = rejected.get(op);
          if (!set) rejected.set(op, (set = new Set()));
          for (const b of fixed) set.add(b);
          this.rollbacks.set(op, (this.rollbacks.get(op) ?? 0) + 1);
          this.removeOp(op);
          emptied = true;
        }
        if (emptied) {
          this.layers.flush();
          this.restore(anchor);
        }
        verifyBusy += performance.now() - t2;
        phases.sweep = performance.now() - t2;
      } catch {
        // measurement only
      }
      this.perf.verifyMs = verifyBusy;
      this.perf.verifyPhases = phases;
      this.restore(anchor);

      // ---- Real after-values ----
      for (const it of live()) {
        const a = it.applied as AppliedOp;
        try {
          OPS[a.op].afterApply?.(env, a);
        } catch {
          // measurement only; the change stands
        }
        if (PARTIAL_OPS.has(a.op)) {
          a.prepared.count = this.marks.countFor(a.op);
          a.prepared.show = a.prepared.show?.filter(
            (el) => !this.isExempt(a.op, el),
          );
        }
      }
      this.ui.refresh();

      const out: AppliedChange[] = [];
      for (const it of items) {
        const change = this.report(
          it.p,
          it.prepared,
          it.error ? 'apply_error' : it.vcode,
        );
        this.reports.set(it.p.op, change);
        const boxes = rejected.get(it.p.op);
        if (it.vcode && boxes?.size) {
          // Root overflow can come from pseudo-elements whose host rect has
          // not moved. Track this op's native hosts, not unrelated body text.
          if (boxes.delete(this.doc.documentElement))
            for (const el of (it.prepared?.show ?? []).slice(0, 24))
              boxes.add(el);
          this.layers.measure(true);
          try {
            this.rejectedFits.set(it.p.op, {
              level: it.p.level,
              scope: it.p.scope,
              code: it.vcode,
              checks: new Map(
                [...boxes].map((el) => [el, this.rejectionKey(el)]),
              ),
            });
          } finally {
            this.layers.measure(false);
          }
        } else this.rejectedFits.delete(it.p.op);
        out.push(change);
      }
      return out;
    } finally {
      this.layers.measure(false);
    }
  }

  /**
   * Find the smallest responsible set, keeping the rest of the fit installed.
   * Every trial is a synchronous stylesheet-only read: no page mutations,
   * imperative side effects or rendered frames between removal and restore.
   */
  private causes(
    live: Array<{
      p: PlannedOp;
      applied: AppliedOp | null;
      vcode?: VerifyCode;
    }>,
    failure: Failure,
    diff: () => Failure[],
    trials: Map<string, Failure[]>,
  ): OpId[] {
    const geometry = LAYOUT_CODES.has(failure.code);
    const candidates = BISECT_ORDER.filter(
      (op) =>
        (!geometry ||
          !['contrast', 'dim_distractions', 'focus_view'].includes(op)) &&
        live.some((it) => it.p.op === op && it.applied?.prepared.css),
    );
    const remains = (disabled: OpId[]): boolean => {
      const key = disabled.join(',');
      let failures = trials.get(key);
      if (!failures) {
        failures = this.layers.without(disabled, diff);
        trials.set(key, failures);
      }
      return failures.some(
        (f) =>
          f.code === failure.code &&
          (f.code === 'overflow' || f.el === failure.el),
      );
    };
    if (!candidates.length || remains(candidates)) return []; // Host page activity.
    // Prefer a single causal rollback when it suffices.
    for (const op of candidates) if (!remains([op])) return [op];
    // Multiple independent causes: restore every op that is safe to keep.
    let disabled = [...candidates];
    for (const op of candidates) {
      const trial = disabled.filter((o) => o !== op);
      if (!remains(trial)) disabled = trial;
    }
    return disabled;
  }

  /**
   * Clipping containers anywhere on the page that clip only because of `op`:
   * one counterfactual for the whole set, nothing painted in between.
   */
  private sweepClip(op: OpId): Element[] {
    const marked = this.marks
      .elementsFor(op)
      .filter((el) => el.isConnected)
      .slice(0, 300);
    if (marked.length === 0) return [];
    const clipped = clippingContainers(marked, this.view, 300).filter((c) =>
      isClipped(c, this.view),
    );
    if (clipped.length === 0) return [];
    return this.layers.without([op], () =>
      clipped.filter((c) => !isClipped(c, this.view)),
    );
  }

  /**
   * Class-level rollback (docs/10 §5.2): put back every instance of the
   * template classes the failures involve, keeping the rest of the op. Only
   * for ops whose prepare names droppable classes. Returns the number of
   * elements put back, or 0 when that does not clear every failure (or would
   * put back the whole op), so the caller rolls the whole op back.
   * Synchronous: nothing is painted between trial and verdict.
   */
  private dropClasses(
    op: OpId,
    caused: readonly Failure[],
    diff: () => Failure[],
  ): number {
    const p = this.applied.get(op)?.prepared;
    if (!p?.classOf || !p.droppable) return 0;
    const marked = this.marks.elementsFor(op).filter((el) => el.isConnected);
    if (marked.length === 0) return 0;
    const classes = new Set<string>();
    for (const f of caused) {
      const els = this.involved(f, marked);
      if (els.length === 0) return 0;
      for (const el of els) {
        const cls = p.classOf(el);
        if (cls === null || !p.droppable(cls)) return 0;
        classes.add(cls);
      }
    }
    const removed: Array<[Element, string]> = [];
    let kept = 0;
    for (const el of marked) {
      const toks = tokensOf(el).filter((t) => tokenOp(t) === op);
      const cls = p.classOf(el);
      if (cls !== null && classes.has(cls))
        for (const t of toks) removed.push([el, t]);
      else if (toks.length) kept++;
    }
    // Dropping every class is not a class rollback.
    if (removed.length === 0 || kept === 0) return 0;
    for (const [el, t] of removed) this.marks.unmark(el, t);
    this.layers.finishOwnedTransitions();
    let after: Failure[];
    try {
      after = diff();
    } catch {
      after = [...caused];
    }
    const cleared = caused.every(
      (f) =>
        !after.some(
          (g) => g.code === f.code && (f.code === 'overflow' || g.el === f.el),
        ),
    );
    if (!cleared) {
      for (const [el, t] of removed) this.marks.mark(el, t);
      this.layers.finishOwnedTransitions();
      return 0;
    }
    let set = this.dropped.get(op);
    if (!set) this.dropped.set(op, (set = new Set()));
    for (const cls of classes) set.add(cls);
    for (const [el] of removed) this.unverified.delete(el);
    return new Set(removed.map(([el]) => el)).size;
  }

  /** Every [element, token] `op` has marked on connected elements. */
  private pairsFor(op: OpId): Array<[Element, string]> {
    const out: Array<[Element, string]> = [];
    for (const el of this.marks.elementsFor(op)) {
      if (!el.isConnected) continue;
      for (const t of tokensOf(el)) if (tokenOp(t) === op) out.push([el, t]);
    }
    return out;
  }

  /**
   * Clip check over the given marks wherever they are on the page: a box
   * that clips with them and stops clipping without them gets them put back,
   * and their ops fit around those elements. One counterfactual for the set:
   * two layout reads, nothing painted in between.
   */
  private clipSweep(
    pairs: ReadonlyArray<[Element, string]>,
  ): Map<OpId, Element[]> {
    const fitted = new Map<OpId, Element[]>();
    if (pairs.length === 0) return fitted;
    const byEl = new Map<Element, string[]>();
    for (const [el, t] of pairs) {
      if (!el.isConnected) continue;
      const list = byEl.get(el);
      if (list) list.push(t);
      else byEl.set(el, [t]);
    }
    const marked = [...byEl.keys()];
    const clipped = clippingContainers(marked, this.view, 300).filter((c) =>
      isClipped(c, this.view),
    );
    if (clipped.length === 0) return fitted;
    const inside = new Map<Element, Element[]>();
    const trial = new Set<Element>();
    for (const c of clipped) {
      const els = this.involved(
        { code: 'clip', el: c, ops: new Set() },
        marked,
      );
      if (els.length === 0) continue;
      inside.set(c, els);
      for (const el of els) trial.add(el);
    }
    if (trial.size === 0) return fitted;
    const toggle = (on: boolean): void => {
      for (const el of trial)
        for (const t of byEl.get(el) ?? [])
          if (on) this.marks.mark(el, t);
          else this.marks.unmark(el, t);
    };
    toggle(false);
    let fixed: Element[];
    try {
      fixed = [...inside.keys()].filter((c) => !isClipped(c, this.view));
    } finally {
      toggle(true);
    }
    for (const c of fixed)
      for (const el of inside.get(c) ?? [])
        for (const t of byEl.get(el) ?? []) {
          this.marks.unmark(el, t);
          this.unverified.delete(el);
          const op = tokenOp(t);
          if (!op) continue;
          this.exemptAdd(op, el);
          const boxes = fitted.get(op) ?? [];
          if (!boxes.includes(c)) boxes.push(c);
          fitted.set(op, boxes);
        }
    this.layers.finishTransitionsOn(trial);
    return fitted;
  }

  /**
   * Element-level rollback: put back only `op`'s marks on the elements
   * involved in the failures it caused, keeping the rest of the fit. Returns
   * the number of elements put back, or 0 when that does not clear every
   * failure (or would put back most of the page), so the caller rolls the
   * whole op back. Synchronous: nothing is painted between trial and verdict.
   */
  private fitAround(
    op: OpId,
    caused: readonly Failure[],
    diff: () => Failure[],
  ): number {
    if (!PARTIAL_OPS.has(op)) return 0;
    const marked = this.marks.elementsFor(op).filter((el) => el.isConnected);
    if (marked.length === 0) return 0;
    const involved = new Set<Element>();
    for (const f of caused)
      for (const el of this.involved(f, marked)) involved.add(el);
    if (involved.size === 0) return 0;
    // Fitting around every element, or most of the page, is not a fit.
    if (
      involved.size >= marked.length ||
      involved.size > Math.max(8, marked.length * 0.5)
    )
      return 0;
    const removed: Array<[Element, string]> = [];
    for (const el of involved)
      for (const t of tokensOf(el))
        if (tokenOp(t) === op) removed.push([el, t]);
    if (removed.length === 0) return 0;
    for (const [el, t] of removed) this.marks.unmark(el, t);
    this.layers.finishOwnedTransitions();
    let after: Failure[];
    try {
      after = diff();
    } catch {
      after = [...caused];
    }
    const cleared = caused.every(
      (f) =>
        !after.some(
          (g) => g.code === f.code && (f.code === 'overflow' || g.el === f.el),
        ),
    );
    if (!cleared) {
      for (const [el, t] of removed) this.marks.mark(el, t);
      this.layers.finishOwnedTransitions();
      return 0;
    }
    for (const el of involved) this.exemptAdd(op, el);
    return involved.size;
  }

  /** The marked elements a failure involves (candidates for an element-level rollback). */
  private involved(f: Failure, marked: readonly Element[]): Element[] {
    const docEl = this.doc.documentElement;
    const near = (a: Element, b: Element): boolean =>
      a === b || composedContains(a, b) || composedContains(b, a);
    switch (f.code) {
      case 'clip': {
        const c = f.el;
        const inside = marked.filter(
          (el) => el === c || composedContains(c, el),
        );
        if (inside.length <= 12) return inside;
        // A large clipping box: just the elements that now reach past its edges.
        const r = c.getBoundingClientRect();
        const right = r.left + c.clientLeft + c.clientWidth;
        const bottom = r.top + c.clientTop + c.clientHeight;
        const out = inside.filter((el) => {
          const b = el.getBoundingClientRect();
          return (
            b.right > right + 1 ||
            b.bottom > bottom + 1 ||
            el.scrollWidth > el.clientWidth + 1
          );
        });
        return out.length ? out : inside.length <= 40 ? inside : [];
      }
      case 'overflow': {
        if (f.el !== docEl)
          return marked.filter((el) => near(el, f.el)).slice(0, 40);
        const width = docEl.clientWidth;
        return marked
          .filter((el) => {
            const b = el.getBoundingClientRect();
            return (
              b.right + this.view.scrollX > width + 1 ||
              el.scrollWidth > el.clientWidth + 1
            );
          })
          .slice(0, 40);
      }
      case 'overlap':
      case 'truncation':
      case 'hierarchy':
        return marked.filter((el) => near(el, f.el));
      case 'inconsistent': {
        // An instance of a field ended at another size: the field's class.
        const key = templateKey(f.el);
        return marked.filter((el) => near(el, f.el) || templateKey(el) === key);
      }
      case 'control_collapsed':
      case 'focus_hidden':
        return marked.filter(
          (el) => near(el, f.el) || (f.cover ? near(el, f.cover) : false),
        );
      default:
        return [];
    }
  }

  /** Remove one op completely: its rule block, its tokens, its imperative effects. */
  private removeOp(op: OpId): void {
    const a = this.applied.get(op);
    this.layers.drop(op);
    this.marks.unmarkOp(op);
    if (a?.handle) {
      try {
        a.handle.undo();
      } catch {
        // The page removed what we touched; nothing left to restore.
      }
      a.handle = null;
    }
    this.applied.delete(op);
  }

  private report(
    p: PlannedOp,
    prepared: Prepared | null,
    vcode?: VerifyCode,
  ): AppliedChange {
    const base = { op: p.op, level: p.level, mode: p.mode, trace: p.trace };
    if (vcode === 'apply_error')
      return { ...base, status: 'error', vcode, count: 0 };
    if (vcode)
      return {
        ...base,
        status: 'undone_by_checks',
        vcode,
        count: prepared?.count ?? 0,
      };
    if (!prepared || prepared.status === 'not_needed')
      return { ...base, status: 'not_needed', count: 0 };
    const change: AppliedChange = {
      ...base,
      status: 'applied',
      count: prepared.count,
    };
    if (prepared.fit) change.fit = { ...prepared.fit };
    return change;
  }

  changes(): AppliedChange[] {
    return [...this.reports.values()].map((c) => {
      const a = this.applied.get(c.op);
      if (!a || c.status !== 'applied') return c;
      // Counts can move as incremental content arrives.
      return {
        ...c,
        count: a.prepared.count,
        fit: a.prepared.fit ? { ...a.prepared.fit } : c.fit,
      };
    });
  }

  appliedOps(): OpId[] {
    return [...this.applied.keys()];
  }

  /**
   * Dry run of one op's read phase: what it would change, without writing.
   * Used by diagnostics and tests; never mutates the page.
   */
  async preview(
    op: OpId,
    level: number,
    scope: PlannedOp['scope'] = 'page',
  ): Promise<{
    status: Prepared['status'];
    count: number;
    fit?: Prepared['fit'];
    reason?: string;
    tokens: string[];
    /** text_floor: the curve it would use (body, floor, exponents, classes). */
    text?: ReturnType<typeof textPlanSummary>;
  }> {
    return this.mutex.run(async () => {
      if (!this.facts) await this.extractNow();
      // Against the site's own styles, as a batch reads them.
      const p = this.measured(() =>
        OPS[op].prepare(this.env(), levelValue(op, level), scope),
      );
      return {
        status: p.status,
        count: p.count,
        fit: p.fit,
        reason: p.reason,
        tokens: (p.marks ?? []).map(
          ([el, t]) => `${el.localName}${el.id ? `#${el.id}` : ''}:${t}`,
        ),
        ...(op === 'text_floor' ? { text: textPlanSummary(p) } : {}),
      };
    });
  }

  // ======================================================================
  // Verify on demand (the harness and "deep" re-checks)
  // ======================================================================

  /**
   * Re-verify everything currently applied against native measurements,
   * replacing the fit in one write, then rolling back failures.
   */
  async verify(): Promise<VerifyReport> {
    return this.mutex.run(async () => {
      const ops = [...this.applied.values()];
      // Under Fit view every hit test is blind: verified when it closes.
      if (ops.length === 0 || !this.facts || this.frozen)
        return { failures: [], rolledBack: [], busyMs: 0 };
      const anchor = this.anchor(this.facts.main);
      const planned = ops.map((a) => a.planned);
      const results = await this.batch(planned);
      this.restore(anchor);
      const rolledBack = results
        .filter((r) => r.status === 'undone_by_checks')
        .map((r) => r.op);
      return {
        failures: results
          .filter((r) => r.vcode)
          .map((r) => ({ code: r.vcode as VerifyCode, ops: [r.op] })),
        rolledBack,
        busyMs: this.perf.verifyMs,
      };
    });
  }

  // ======================================================================
  // Undo, levels, pause
  // ======================================================================

  async undo(op: OpId | 'all'): Promise<AppliedChange[]> {
    return this.mutex.run(async () => this.undoNow(op));
  }

  private undoNow(op: OpId | 'all'): AppliedChange[] {
    const ids = op === 'all' ? [...this.applied.keys()] : [op];
    const anchor = this.anchor();
    for (const id of ids) {
      this.removeOp(id);
      this.reports.delete(id);
      this.rejectedFits.delete(id);
      if (this.prePaint.has(id)) setOffGate(this.doc, id, true);
    }
    if (op === 'all') {
      for (const id of this.prePaint) setOffGate(this.doc, id, true);
      this.reports.clear();
      this.rejectedFits.clear();
    }
    this.layers.flush();
    this.restore(anchor);
    if (op === 'all') this.unverified.clear();
    this.ui.hideOutlines();
    this.ui.refresh();
    return this.changes();
  }

  /** [Undo] undoes the toast's change; [Undo all] every applied change on the page. */
  private async undoFromToast(all: boolean): Promise<void> {
    const op = this.toastOp;
    this.toastOp = null;
    const applied = this.changes().filter((c) => c.status === 'applied');
    const undone = all ? applied : applied.filter((c) => c.op === op);
    if (undone.length === 0) return;
    await this.undo(all ? 'all' : (undone[0] as AppliedChange).op);
    this.opts.events.undone(undone, 'toast');
  }

  async setLevel(op: OpId, level: number): Promise<AppliedChange[]> {
    return this.mutex.run(async () => {
      if (this.frozen) {
        this.pendingLevels.set(op, level);
        return this.changes();
      }
      const cur = this.applied.get(op);
      const planned: PlannedOp | undefined =
        cur?.planned ??
        this.lastPlan?.ops.find((p) => p.op === op) ??
        undefined;
      if (!planned) return this.changes();
      if (!this.facts) await this.extractNow();
      await this.batch([
        { ...planned, level, trace: { ...planned.trace, level } },
      ]);
      return this.changes();
    });
  }

  /** Stop everything on this page and restore it exactly. */
  async pause(): Promise<void> {
    return this.mutex.run(async () => {
      this.paused = true;
      this.undoNow('all');
      setOffGate(this.doc, 'all', true);
      this.stopRuntime();
      this.ui.destroy();
      this._status = 'idle';
    });
  }

  async resume(): Promise<AppliedChange[]> {
    const plan = this.lastPlan;
    await this.mutex.run(async () => {
      this.paused = false;
      setOffGate(this.doc, 'all', false);
      await this.extractNow();
    });
    if (!plan) return this.changes();
    return this.apply(plan, { replace: true });
  }

  get isPaused(): boolean {
    return this.paused;
  }

  // ======================================================================
  // In-page layer
  // ======================================================================

  showOnPage(op: OpId | null, on: boolean): void {
    if (!on) {
      this.ui.hideOutlines();
      this.escOff?.();
      this.escOff = null;
      return;
    }
    const groups: OutlineGroup[] = [];
    const ops = op ? [op] : [...this.applied.keys()];
    for (const id of ops) {
      const a = this.applied.get(id);
      if (!a) continue;
      const target = TARGET_OPS.has(id);
      // More candidates than are drawn: the layer outlines the first three in view.
      const items = (a.prepared.show ?? [])
        .filter((el) => el.isConnected && !this.isExempt(id, el))
        .slice(0, 24)
        .map((el) => {
          const now = docBox(el, this.view);
          const fit = a.prepared.fitBox ? a.prepared.fitBox(el, now) : now;
          const was = target ? a.before.get(el) : undefined;
          // Targets only: the original size, anchored where the element is now,
          // kept when the adapted box contains it (design-final.md 8). Text
          // changes never get a ghost; their "before" lives in the tag.
          const ghost = was
            ? {
                left: now.left,
                top: now.top,
                right: now.left + (was.right - was.left),
                bottom: now.top + (was.bottom - was.top),
              }
            : null;
          const keep =
            ghost !== null &&
            contains(fit, ghost) &&
            !(
              Math.abs(ghost.right - fit.right) < 1 &&
              Math.abs(ghost.bottom - fit.bottom) < 1 &&
              Math.abs(ghost.left - fit.left) < 1 &&
              Math.abs(ghost.top - fit.top) < 1
            );
          return { ghost: keep ? ghost : null, fit };
        });
      const report = this.reports.get(id);
      groups.push({
        items,
        fill: target,
        tag: report?.fit
          ? { label: OP_CATALOG[id].label, ...report.fit }
          : undefined,
      });
    }
    this.ui.showOutlines(groups);
    if (!this.escOff) {
      // Passive observer: the page's own key handling is untouched.
      const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        this.showOnPage(null, false);
        this.opts.events.outlinesClosed?.();
      };
      this.view.addEventListener('keydown', onKey, {
        capture: true,
        passive: true,
      });
      this.escOff = () => this.view.removeEventListener('keydown', onKey, true);
    }
  }

  async readingGuide(on: boolean): Promise<AppliedChange[]> {
    if (!on) return this.undo('reading_guide');
    const trace: DecisionTrace = {
      op: 'reading_guide',
      mode: 'auto',
      source: 'manual',
      level: 0,
      p: null,
      pOk: null,
      why: 'manual',
      evidence: [],
    };
    const plan: AdaptationPlan = {
      id: `manual-${Date.now()}`,
      createdAt: Date.now(),
      category: this.lastExtraction?.signals.category ?? 'other',
      basis: 'local',
      ops: [
        { op: 'reading_guide', level: 0, mode: 'auto', scope: 'page', trace },
      ],
    };
    return this.apply(plan);
  }

  /**
   * The offer for `op` was answered in the popup or expired (sw:offer-resolved):
   * hide the chip if it shows that op. Sends nothing back.
   */
  resolveOffer(op: OpId): void {
    if (this.offerWait?.op === op) {
      clearTimeout(this.offerWait.timer);
      this.offerWait = null;
    }
    if (this.ui.offerShown === op || this.ui.offerPending === op)
      this.ui.hideOffer();
  }

  /**
   * From the hello reply: WebAble's own reduce-motion setting (the layer host
   * gets data-motion='reduce') and the keyboard shortcuts the layer announces.
   */
  configure(opts: EngineConfig): void {
    this.ui.configure(opts);
  }

  /**
   * A behaviour-triggered offer: shown at most once per page, never on first
   * paint, and held by the layer while the person is typing, dragging or scrolling.
   */
  offer(planned: PlannedOp): boolean {
    if (this.paused || this.destroyed || this.offerShownOnce) return false;
    // Fit view covers the page: a chip under it would be shown to nobody.
    if (this.frozen) return false;
    if (this.applied.has(planned.op)) return false;
    const copy = offerCopy(planned);
    const show = (): void => {
      this.offerWait = null;
      if (this.paused || this.destroyed) return;
      this.offerShownOnce = true;
      this.ui.showOffer({
        op: planned.op,
        question: copy.question,
        reason: copy.reason,
        spoken: `WebAble suggests ${SUGGESTS[planned.op]} here.`,
      });
    };
    const age = performance.now() - this.bornAt;
    if (this.offerWait) clearTimeout(this.offerWait.timer);
    this.offerWait = null;
    if (age < 1500)
      this.offerWait = { op: planned.op, timer: setTimeout(show, 1500 - age) };
    else show();
    return true;
  }

  focusLayer(): boolean {
    return this.ui.focusLayer();
  }

  // ======================================================================
  // Fit view seams (fitview/types.ts)
  // ======================================================================

  /**
   * Fit view opened (true) or closed (false) (docs/10 §4.6). While frozen,
   * Tailor stays applied but untouched: no replans, no marks on arriving
   * content, no verification (its hit tests would be blind under the view),
   * no offers or friction. Plans and level changes that arrive meanwhile
   * wait. Thawing re-verifies once, applies what waited, and catches up with
   * content that arrived.
   */
  freeze(on: boolean): void {
    if (this.destroyed || on === this.frozen) return;
    this.frozen = on;
    if (!on) {
      void this.thaw().catch(() => undefined);
      return;
    }
    if (this.replanTimer) clearTimeout(this.replanTimer);
    this.replanTimer = null;
    if (this.offerWait) {
      clearTimeout(this.offerWait.timer);
      this.offerWait = null;
    }
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  private async thaw(): Promise<void> {
    if (this.paused || this.destroyed || this.frozen) return;
    await this.verify();
    const levels = [...this.pendingLevels];
    this.pendingLevels.clear();
    for (const [op, level] of levels) {
      if (this.frozen) return;
      await this.setLevel(op, level);
    }
    const pending = this.deferred;
    this.deferred = null;
    if (pending && !this.frozen)
      await this.apply(pending.plan, pending.options);
    if (this.frozen || this.paused || this.destroyed) return;
    if (this.missedWhileFrozen) {
      this.missedWhileFrozen = false;
      this.scheduler?.requestAll();
    }
    if (this.replanWanted) this.requestReplan(this.replanWanted);
  }

  /**
   * The zoom guard's reading (docs/10 §5.1), taken after a page-scale change
   * settles: horizontal overflow, visible primary-nav links and whether a
   * search field is visible.
   */
  viewportGuard(): ViewportGuard {
    return viewportGuard(this.doc);
  }

  /** Component key per region root element from the last extraction (for the skeleton reader). */
  regionKeys(): Map<Element, string> {
    const out = new Map<Element, string>();
    for (const [key, list] of this.facts?.regions ?? [])
      for (const f of list) if (f.el.isConnected) out.set(f.el, key);
    return out;
  }

  /** Show the first-time toast for the headline automatic change. */
  announce(results: AppliedChange[] = this.changes()): void {
    if (this.frozen) return;
    const auto = results.filter(
      (c) => c.status === 'applied' && c.mode === 'auto',
    );
    const headline = TOAST_ORDER.map((op) =>
      auto.find((c) => c.op === op && c.fit),
    ).find(Boolean);
    if (!headline?.fit) return;
    const applied = this.changes().filter((c) => c.status === 'applied');
    this.toastOp = headline.op;
    this.ui.showToast({
      message: TOAST_LINE[headline.op](headline.fit, headline.count),
      undo: applied.length > 1 ? 'all' : 'one',
    });
  }

  // ======================================================================
  // Runtime: mutations, routes, friction
  // ======================================================================

  private startRuntime(): void {
    if (this.paused || this.destroyed) return;
    if (!this.scheduler) {
      this.scheduler = new MutationScheduler(
        (roots, added) => this.mutex.run(() => this.onMutations(roots, added)),
        undefined,
        () => this.route?.check(),
        (added, restyled) => this.markNow(added, restyled),
      );
      this.scheduler.observe(this.doc);
      for (const s of this.layers.scopes())
        if (s instanceof ShadowRoot) this.scheduler.observe(s);
    }
    if (!this.route) {
      this.route = new RouteWatcher(this.view, () => {
        this.ui.hideToast();
        this.ui.hideOffer();
        // A new view may fit what the last one could not.
        this.rollbacks.clear();
        this.dropped.clear();
        this.opts.events.routeChanged();
      });
    }
    if (!this.friction) {
      const detector = new FrictionDetector((signal, ops) => {
        // While Fit view is open the person is working in it, not the page.
        if (!this.frozen) this.opts.events.friction(signal, ops);
      });
      this.friction = installFriction(this.view, detector);
    }
    if (!this.offPageChanges) {
      const changed = (): void => this.scheduler?.requestAll();
      // Width changes reflow text (breakpoints); height-only changes (mobile
      // toolbars, devtools) do not, and image loads never change what text needs.
      const resized = (): void => {
        const width = this.view.innerWidth;
        if (width === this.lastWidth) return;
        this.lastWidth = width;
        this.exempt.clear();
        this.rollbacks.clear();
        this.dropped.clear();
        changed();
      };
      const loaded = (e: Event): void => {
        const el = e.target;
        if (el instanceof Element && /^(link|style)$/.test(el.localName))
          changed();
      };
      const onFonts = (): void => changed();
      this.view.addEventListener('resize', resized, { passive: true });
      this.doc.addEventListener('load', loaded, true);
      this.doc.fonts?.addEventListener('loadingdone', onFonts);
      this.offPageChanges = () => {
        this.view.removeEventListener('resize', resized);
        this.doc.removeEventListener('load', loaded, true);
        this.doc.fonts?.removeEventListener('loadingdone', onFonts);
      };
    }
    if (!this.maintenance) {
      // Style-layer watchdog (pages that reassign adoptedStyleSheets) and mark
      // pruning, in idle time about every two seconds.
      this.maintenance = setInterval(() => {
        this.cancelIdle?.();
        this.cancelIdle = whenIdle(() => {
          if (this.applied.size === 0) return;
          this.layers.watchdog();
          this.marks.prune();
        }, 1000);
      }, 2000);
    }
  }

  /** The service worker is about to change the tab zoom: do not read it as friction. */
  suppressZoomFriction(ms = 2000): void {
    this.friction?.suppressZoom(ms);
  }

  private stopRuntime(): void {
    this.offPageChanges?.();
    this.offPageChanges = null;
    if (this.replanTimer) clearTimeout(this.replanTimer);
    this.replanTimer = null;
    this.replanWanted = null;
    this.unverified.clear();
    if (this.maintenance) clearInterval(this.maintenance);
    this.maintenance = null;
    this.cancelIdle?.();
    this.cancelIdle = null;
    this.scheduler?.disconnect();
    this.scheduler = null;
    this.route?.dispose();
    this.route = null;
    this.friction?.dispose();
    this.friction = null;
    this.escOff?.();
    this.escOff = null;
  }

  get hasInteracted(): boolean {
    return this.lastInputAt !== -Infinity;
  }

  /**
   * Marks for content under `roots` from the given applied ops: everything
   * read first, then written once (no layout thrash). Ops with `retoken`
   * give every element they examine its complete token set, so restyled
   * content never keeps a stale size; the others only add. An op whose block
   * gained a rule for new content gets its block re-installed first.
   * Returns the elements whose marks changed.
   */
  private extend(
    roots: readonly Element[],
    ops: readonly AppliedOp[],
    budget?: { start: number; ms: number },
  ): Set<Element> {
    const changed = new Set<Element>();
    if (roots.length === 0 || ops.length === 0) return changed;
    const env = this.env();
    const adds: Array<[Element, string, OpId]> = [];
    const sets: Array<[Element, string[], OpId]> = [];
    const blocks = new Map<AppliedOp, Prepared['css']>();
    for (const a of ops) {
      const impl = OPS[a.op];
      blocks.set(a, a.prepared.css);
      try {
        if (impl.retoken)
          for (const [el, toks] of impl.retoken(env, a, roots))
            sets.push([el, toks, a.op]);
        else
          for (const [el, tok] of impl.incremental?.(env, a, roots) ?? [])
            adds.push([el, tok, a.op]);
      } catch {
        // Best effort: a later pass covers anything missed here.
      }
      if (budget && performance.now() - budget.start > budget.ms) break;
    }
    let restyled = false;
    for (const [a, css] of blocks)
      if (
        a.prepared.css &&
        a.prepared.css !== css &&
        this.applied.get(a.op) === a
      ) {
        this.layers.set(a.op, a.prepared.css);
        restyled = true;
      }
    if (restyled) this.layers.flush();
    for (const [el, tok, op] of adds) {
      if (this.isExempt(op, el) || hasToken(el, tok)) continue;
      this.marks.mark(el, tok);
      this.unverified.add(el);
      changed.add(el);
    }
    for (const [el, toks, op] of sets) {
      if (this.isExempt(op, el)) continue;
      const cur = tokensOf(el).filter((t) => tokenOp(t) === op);
      if (cur.length === toks.length && cur.every((t) => toks.includes(t)))
        continue;
      for (const t of cur) if (!toks.includes(t)) this.marks.unmark(el, t);
      for (const t of toks) if (!cur.includes(t)) this.marks.mark(el, t);
      if (toks.length) this.unverified.add(el);
      else this.unverified.delete(el);
      changed.add(el);
    }
    return changed;
  }

  /** Applied ops that mark content arriving after them. */
  private extending(filter?: (op: OpId) => boolean): AppliedOp[] {
    return [...this.applied.values()].filter(
      (a) =>
        (OPS[a.op].retoken !== undefined ||
          OPS[a.op].incremental !== undefined) &&
        (!filter || filter(a.op)),
    );
  }

  /**
   * Inside the MutationObserver callback, before the browser renders the
   * change: new and re-rendered content gets the applied fit straight away,
   * so it never paints at its native size first. Bounded; anything left is
   * reached by the debounced pass. Marks made here are checked later.
   */
  private markNow(
    added: readonly Element[],
    restyled: readonly Element[],
  ): void {
    if (this.paused || this.destroyed || this.frozen || !this.facts) return;
    const ops = this.extending((op) => SYNC_OPS.has(op));
    if (ops.length === 0) return;
    const start = performance.now();
    const roots: Element[] = [];
    for (const el of [...added, ...restyled]) {
      if (!el.isConnected || SKIP_TAGS.has(el.localName) || isOurs(el))
        continue;
      roots.push(el);
      if (roots.length >= 80) break;
    }
    if (roots.length === 0) return;
    const fresh = this.extend(roots, ops, { start, ms: SYNC_BUDGET_MS });
    if (fresh.size === 0) return;
    // Reading the native size gave the browser a "before" value: a page
    // transition (`transition: all` on links) would animate from it.
    this.layers.finishTransitionsOn(fresh);
    // Ops fitted element by element put back clipped elements at once;
    // text_floor's new marks are checked whole in the debounced pass.
    const partial: Array<[Element, string]> = [];
    for (const el of fresh)
      for (const t of tokensOf(el)) {
        const op = tokenOp(t);
        if (op && PARTIAL_OPS.has(op)) partial.push([el, t]);
      }
    if (
      partial.length &&
      partial.length <= 160 &&
      performance.now() - start < SYNC_BUDGET_MS
    )
      this.clipSweep(partial);
  }

  /**
   * Check marks added after their op was verified, counterfactually and
   * synchronously (nothing paints in between): read the page with the new
   * marks, then without them. Ops fitted element by element put back the
   * elements whose marks cause a failure and fit around them for the rest
   * of this page view. text_floor never does: a class first seen in the new
   * content is dropped as a class, and anything else rolls the whole op back.
   */
  private verifyNew(): void {
    if (this.frozen || this.unverified.size === 0) return;
    const els = [...this.unverified]
      .filter((el) => el.isConnected)
      .slice(0, 150);
    this.unverified.clear();
    const checked = (op: OpId | null): op is OpId =>
      op !== null &&
      this.applied.has(op) &&
      (PARTIAL_OPS.has(op) || OPS[op].retoken !== undefined);
    const collect = (): Array<[Element, string]> => {
      const out: Array<[Element, string]> = [];
      for (const el of els)
        for (const t of tokensOf(el))
          if (checked(tokenOp(t))) out.push([el, t]);
      return out;
    };
    // Clipping anywhere on the page first, then the viewport's full checks.
    this.clipSweep(
      collect().filter(([, t]) => PARTIAL_OPS.has(tokenOp(t) as OpId)),
    );
    const pairs = collect();
    if (pairs.length === 0 || !this.facts) return;
    const env = this.env();
    const probes = buildProbes({
      doc: this.doc,
      view: this.view,
      marked: pairs,
      existing: [],
      targets: [],
      contrast: [],
      peers: [...this.facts.text.map((t) => t.el), ...els],
      textScope: this.textScope(env),
      regions: regionRootsOf(this.facts.regions),
    });
    const sizedPairs = pairs.filter(
      ([, t]) => !PARTIAL_OPS.has(tokenOp(t) as OpId),
    );
    // Resized text anywhere on the page (new cards preloaded far below) must
    // not start clipping either.
    const far = clippingContainers(
      sizedPairs.map(([el]) => el),
      this.view,
      150,
    ).filter((c) => isClipped(c, this.view));
    let base: Snapshot;
    let unclipped: Element[] = [];
    for (const [el, t] of pairs) this.marks.unmark(el, t);
    try {
      base = takeSnapshot(this.doc, probes);
      unclipped = far.filter((c) => !isClipped(c, this.view));
    } finally {
      for (const [el, t] of pairs) this.marks.mark(el, t);
      this.layers.finishOwnedTransitions();
    }
    const ctx = {
      contrastTarget: 4.5,
      marked: pairs.map(([el]) => el),
      zoom: this.zoom(),
    };
    const diff = (): Failure[] => [
      ...diffSnapshots(this.doc, probes, base, ctx),
      ...unclipped
        .filter((c) => isClipped(c, this.view))
        .map((el): Failure => ({ code: 'clip', el, ops: new Set() })),
    ];
    let fails: Failure[];
    try {
      fails = diff();
    } catch {
      return;
    }
    if (fails.length === 0) return;
    const docEl = this.doc.documentElement;
    const width = docEl.clientWidth;
    const resized: Failure[] = [];
    for (const f of fails) {
      const hit = pairs.filter(([el]) => {
        if (f.code === 'overflow' && f.el === docEl) {
          const b = el.getBoundingClientRect();
          return (
            b.right + this.view.scrollX > width + 1 ||
            el.scrollWidth > el.clientWidth + 1
          );
        }
        return (
          el === f.el ||
          composedContains(f.el, el) ||
          composedContains(el, f.el) ||
          (f.cover !== undefined && composedContains(f.cover, el))
        );
      });
      // An overflow none of the new elements explains: put them all back.
      // Size order and consistency only change with sizes.
      const own = hit.length
        ? hit
        : f.code === 'overflow'
          ? pairs
          : SIZE_CODES.has(f.code)
            ? sizedPairs
            : [];
      for (const [el, t] of own) {
        const op = tokenOp(t);
        if (!op || !PARTIAL_OPS.has(op)) continue;
        this.marks.unmark(el, t);
        this.exemptAdd(op, el);
      }
      if (own.some(([, t]) => tokenOp(t) === 'text_floor')) resized.push(f);
    }
    this.layers.finishOwnedTransitions();
    if (resized.length && this.applied.has('text_floor')) {
      if (this.dropClasses('text_floor', resized, diff) === 0)
        this.rollbackLive('text_floor', resized);
    }
  }

  /**
   * Roll back an applied op whose later marks failed their check: the whole
   * op, reported as undone by checks. The failing boxes are remembered, so a
   * fresh decision does not re-apply it while they stay as they are; asking
   * for one tells the service worker.
   */
  private rollbackLive(op: OpId, caused: readonly Failure[]): void {
    const a = this.applied.get(op);
    if (!a) return;
    const anchor = this.anchor();
    const count = a.prepared.count;
    this.removeOp(op);
    this.layers.flush();
    this.restore(anchor);
    const vcode = caused[0]?.code ?? 'clip';
    this.rollbacks.set(op, (this.rollbacks.get(op) ?? 0) + 1);
    const p = a.planned;
    this.reports.set(op, {
      op,
      level: p.level,
      mode: p.mode,
      trace: p.trace,
      status: 'undone_by_checks',
      vcode,
      count,
    });
    const boxes = caused
      .filter((f) => REMEMBERED_CODES.has(f.code))
      .map((f) => f.el)
      .filter((el) => el.isConnected && el !== this.doc.documentElement);
    if (boxes.length)
      this.measured(() =>
        this.rejectedFits.set(op, {
          level: p.level,
          scope: p.scope,
          code: vcode,
          checks: new Map(boxes.map((el) => [el, this.rejectionKey(el)])),
        }),
      );
    this.ui.refresh();
    this.requestReplan('eager');
  }

  /**
   * Extend applied ops to text they do not cover yet (content that arrived,
   * or text a restyle changed), then check just the new marks. Covers the
   * last extraction's text and its subtrees.
   */
  private topUp(skip: ReadonlySet<OpId>): void {
    if (!this.facts || this.frozen) return;
    const ops = this.extending((op) => !skip.has(op));
    if (ops.length === 0) return;
    const roots = this.facts.text
      .map((t) => t.el)
      .filter((el) => el.isConnected);
    const marked = new Set<Element>();
    for (const a of ops) {
      // retoken reads native sizes in one measure pass per chunk.
      const chunk = OPS[a.op].retoken ? 1000 : 200;
      for (let i = 0; i < roots.length; i += chunk)
        for (const el of this.extend(roots.slice(i, i + chunk), [a]))
          marked.add(el);
    }
    if (marked.size) {
      this.layers.finishTransitionsOn(marked);
      this.verifyNew();
    }
    this.recount();
  }

  /** Counts move as later content is marked. */
  private recount(): void {
    for (const a of this.applied.values())
      if (PARTIAL_OPS.has(a.op) || OPS[a.op].retoken)
        a.prepared.count = this.marks.countFor(a.op);
  }

  /**
   * The debounced pass: reach what the pre-paint pass could not (bursts,
   * inline style changes, deep subtrees), check new marks, run imperative
   * ops' handlers, and ask for a fresh decision when the page really
   * changed. Waits while the person scrolls: never measure under them.
   */
  private async onMutations(rootsIn: FlushRoots, added = 0): Promise<void> {
    if (this.paused || this.destroyed || !this.facts) return;
    this.addedSincePlan += added;
    if (this.frozen) {
      // Fit view is open: catch up in one full pass when it closes.
      this.missedWhileFrozen = true;
      return;
    }
    const now = performance.now();
    if (this.scrolling(now)) {
      if (!this.deferredSince) this.deferredSince = now;
      if (now - this.deferredSince < SCROLL_MAX_DEFER_MS) {
        this.scheduler?.requeue(rootsIn, SCROLL_QUIET_MS);
        return;
      }
    }
    this.deferredSince = 0;
    this.layers.watchdog();
    this.marks.prune();
    const all = rootsIn === 'all';
    const roots = all
      ? [this.doc.body]
      : rootsIn.filter(
          (r) => r.isConnected && !SKIP_TAGS.has(r.localName) && !isOurs(r),
        );
    if (roots.length === 0) return;
    // Shadow roots that arrived with the new content get a layer.
    for (const root of roots) {
      for (const s of shadowRootsWithin(root, this.opts.openClosed)) {
        this.layers.addScope(s);
        this.scheduler?.observe(s);
        if (!this.facts.scopes.includes(s)) this.facts.scopes.push(s);
      }
    }
    this.layers.flush();

    const deep =
      all || roots.some((r) => r.getElementsByTagName('*').length > 400);
    if (deep) this.topUp(new Set());
    if (!all) {
      const marked = this.extend(roots, this.extending());
      if (marked.size) this.layers.finishTransitionsOn(marked);
    }
    this.verifyNew();
    for (const a of this.applied.values()) {
      try {
        a.handle?.onAdded?.(roots);
      } catch {
        // ignore: the page removed what it inserted
      }
    }
    this.recount();
    this.ui.refresh();

    // A fresh decision when content arrived, a rejected fit's box changed,
    // or a full pass is owed. Applied ops are sticky; it can only add.
    const rejectedMoved =
      !all &&
      [...this.rejectedFits.values()].some((r) =>
        [...r.checks.keys()].some((el) =>
          roots.some(
            (root) =>
              el === root ||
              composedContains(el, root) ||
              composedContains(root, el),
          ),
        ),
      );
    // The last reading found no text at all (an app shell before its
    // content renders): text arriving is worth a reading at once, however
    // few nodes carry it (a framework mounts its whole app as one).
    const firstText =
      !all &&
      !this.facts.text.some((t) => !t.icon) &&
      roots.some((r) => /\S/.test(r.textContent ?? ''));
    if (all || rejectedMoved || firstText || this.wantsContent())
      this.requestReplan('eager');
    else if (this.addedSincePlan >= REPLAN_MIN_ADDED)
      this.requestReplan('normal');
  }

  /** Something planned did nothing yet: content that needs it may still be arriving. */
  private wantsContent(): boolean {
    if (this.addedSincePlan < REPLAN_MIN_ADDED) return false;
    if (this.applied.size === 0) return true;
    return [...this.reports.values()].some(
      (c) => c.mode === 'auto' && c.status === 'not_needed',
    );
  }

  /**
   * Ask the service worker to decide again, at most every few seconds and
   * never while the person scrolls. The adapter applies the answer sticky.
   */
  private requestReplan(kind: 'eager' | 'normal'): void {
    if (!this.opts.events.pageChanged || this.paused || this.destroyed) return;
    if (this.replanWanted !== 'eager') this.replanWanted = kind;
    // Fit view is open: the decision is owed, and asked for when it closes.
    if (this.frozen) return;
    const due =
      this.lastPlanAt +
      (this.replanWanted === 'eager' ? REPLAN_EAGER_MS : REPLAN_MIN_MS);
    const fire = (): void => {
      this.replanTimer = null;
      if (this.paused || this.destroyed || this.frozen || !this.replanWanted)
        return;
      if (this.scrolling()) {
        this.replanTimer = setTimeout(fire, SCROLL_QUIET_MS);
        return;
      }
      this.replanWanted = null;
      this.addedSincePlan = 0;
      this.lastPlanAt = performance.now();
      this.opts.events.pageChanged?.();
    };
    if (this.replanTimer) clearTimeout(this.replanTimer);
    this.replanTimer = setTimeout(fire, Math.max(0, due - performance.now()));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.undoNow('all');
    } finally {
      this.stopRuntime();
      this.offInput?.();
      this.offInput = null;
      this.marks.clear();
      this.layers.clear();
      this.ui.destroy();
      setColorParseFallback(null);
    }
  }
}

/** `outer` contains `inner`, with half a pixel of rounding. */
function contains(outer: Box, inner: Box): boolean {
  return (
    inner.left >= outer.left - 0.5 &&
    inner.top >= outer.top - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.bottom <= outer.bottom + 0.5
  );
}

function sameScope(a: PlannedOp['scope'], b: PlannedOp['scope']): boolean {
  if (a === 'page' || b === 'page') return a === b;
  return (
    a.regions.length === b.regions.length &&
    a.regions.every((k) => b.regions.includes(k))
  );
}

/**
 * A refine/offer plan updates the ops it names and keeps the rest. The page
 * scale is the page view's, and the person's own zoom the last one the
 * worker sent: a plan that does not name them keeps them.
 */
export function mergePlans(
  prev: AdaptationPlan,
  next: AdaptationPlan,
): AdaptationPlan {
  const ops = new Map(prev.ops.map((p) => [p.op, p] as const));
  for (const p of next.ops) ops.set(p.op, p);
  const zoom = next.zoom ?? prev.zoom;
  const ownZoom = next.ownZoom ?? prev.ownZoom;
  return {
    ...next,
    ...(zoom !== undefined ? { zoom } : {}),
    ...(ownZoom !== undefined ? { ownZoom } : {}),
    ops: [...ops.values()],
  };
}

export const __test = { offerCopy, sameScope, TOAST_LINE };
