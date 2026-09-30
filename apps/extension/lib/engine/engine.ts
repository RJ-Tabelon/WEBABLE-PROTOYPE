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
import { LayerManager } from './ops/layer';
import { MarkBook, setOffGate } from './ops/marks';
import { BISECT_ORDER, levelValue, OPS } from './ops/registry';
import type { AppliedOp, OpEnv, Prepared } from './ops/types';
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
import { shadowRootsWithin, SKIP_TAGS } from './util/dom';
import type { Box } from './util/geometry';
import { Mutex, settle, whenIdle } from './util/schedule';
import { readingAnchor, restoreAnchor, type Anchor } from './verify/anchor';
import {
  buildProbes,
  diffSnapshots,
  takeSnapshot,
  type Failure,
  type ProbeSet,
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
  /** First auto changes on this site: show the toast. */
  announce?: boolean;
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
  /** Script time of the last write phase (marks, one replaceSync per layer, effects), ms. */
  writeMs: number;
  /** The single style and layout pass the write caused, ms. */
  layoutMs: number;
}

/** Order used to pick the toast's headline change. */
const TOAST_ORDER: readonly OpId[] = [
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
  page_zoom: (f) => `WebAble zoomed this site to ${f.after}.`,
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
  readonly perf: EnginePerf = {
    extract: null,
    verifyMs: 0,
    writeMs: 0,
    layoutMs: 0,
  };

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
    try {
      const x = await extract(this.doc, {
        vocab: this.opts.vocab,
        openClosed: this.opts.openClosed,
      });
      this.facts = x.facts;
      this.lastExtraction = x;
      this.perf.extract = x.perf;
      for (const scope of x.facts.scopes)
        if (scope instanceof ShadowRoot) this.layers.addScope(scope);
      return x;
    } catch (err) {
      this._status = 'unreadable';
      throw err;
    }
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
      const toApply: PlannedOp[] = [];
      for (const p of wanted) {
        const cur = this.applied.get(p.op);
        if (
          cur &&
          cur.level === p.level &&
          sameScope(cur.planned.scope, p.scope)
        ) {
          cur.planned = p; // keep the newest trace
          continue;
        }
        if (cur) removals.push(p.op);
        toApply.push(p);
      }
      if (removals.length) {
        const anchor = readingAnchor(this.doc, this.facts?.main ?? null);
        for (const op of removals) {
          this.removeOp(op);
          this.reports.delete(op);
        }
        this.layers.flush();
        restoreAnchor(this.doc, anchor);
      }
      const results = toApply.length ? await this.batch(toApply) : [];
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
    };
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
   * verify, per-op rollback, bisection for unattributed failures, then real
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

    // ---- Read phase ----
    for (const it of items) {
      try {
        it.prepared = OPS[it.p.op].prepare(env, it.value, it.p.scope);
      } catch {
        it.error = true;
      }
    }
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
    });
    const base = takeSnapshot(this.doc, probes);
    verifyBusy += performance.now() - t;
    const anchor = readingAnchor(this.doc, env.facts.main);

    // ---- Write phase (one) ----
    t = performance.now();
    for (const it of ready) {
      const a = it.applied as AppliedOp;
      if (a.prepared.css) this.layers.set(a.op, a.prepared.css);
      for (const [el, tok] of a.prepared.marks ?? []) this.marks.mark(el, tok);
      this.applied.set(a.op, a);
    }
    this.layers.flush();
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
    restoreAnchor(this.doc, anchor);
    this.perf.layoutMs = performance.now() - t;

    // ---- Settle, verify, roll back ----
    await settle(this.doc);
    restoreAnchor(this.doc, anchor);
    const live = (): Item[] => ready.filter((it) => !it.error && !it.vcode);
    const ctx = () => ({
      contrastTarget: this.applied.has('contrast')
        ? (this.applied.get('contrast')?.value ?? 4.5)
        : 4.5,
      marked: this.marks.all(300),
    });
    const diff = (): Failure[] => {
      const s = performance.now();
      try {
        return diffSnapshots(this.doc, probes, base, ctx());
      } finally {
        verifyBusy += performance.now() - s;
      }
    };
    let fails: Failure[];
    try {
      fails = diff();
      for (let round = 0; round < 3 && fails.length; round++) {
        const inBatch = new Set(live().map((it) => it.p.op));
        const culprits = new Map<OpId, VerifyCode>();
        for (const f of fails) {
          for (const op of f.ops)
            if (inBatch.has(op) && !culprits.has(op)) culprits.set(op, f.code);
        }
        if (culprits.size === 0) break;
        for (const [op, code] of culprits) {
          const it = ready.find((x) => x.p.op === op);
          if (it) it.vcode = code;
          this.removeOp(op);
        }
        this.layers.flush();
        restoreAnchor(this.doc, anchor);
        await settle(this.doc);
        fails = diff();
      }
      if (fails.length) await this.bisect(live(), fails, diff, anchor);
    } catch {
      for (const it of live()) {
        it.vcode = 'apply_error';
        this.removeOp(it.p.op);
      }
      this.layers.flush();
    }
    this.perf.verifyMs = verifyBusy;
    restoreAnchor(this.doc, anchor);

    // ---- Real after-values ----
    for (const it of live()) {
      const a = it.applied as AppliedOp;
      try {
        OPS[a.op].afterApply?.(env, a);
      } catch {
        // measurement only; the change stands
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
      out.push(change);
    }
    return out;
  }

  /**
   * Failures nobody's tokens explain: roll back batch ops riskiest-first,
   * one at a time; the first whose removal clears the failures is the culprit.
   * Ops whose removal did not help are re-applied.
   */
  private async bisect(
    live: Array<{
      p: PlannedOp;
      applied: AppliedOp | null;
      vcode?: VerifyCode;
    }>,
    fails: Failure[],
    diff: () => Failure[],
    anchor: Anchor | null,
  ): Promise<void> {
    const same = (a: Failure, b: Failure): boolean =>
      a.code === b.code && a.el === b.el;
    for (const op of BISECT_ORDER) {
      const it = live.find((x) => x.p.op === op);
      if (!it?.applied) continue;
      this.removeOp(op);
      this.layers.flush();
      await settle(this.doc);
      const now = diff();
      if (!now.some((f) => fails.some((g) => same(f, g)))) {
        it.vcode = fails[0]?.code ?? 'layout_shift';
        restoreAnchor(this.doc, anchor);
        return;
      }
      this.reapply(it.applied);
    }
    // Nothing in this batch explains it: page activity, not WebAble. Keep the batch.
  }

  private reapply(a: AppliedOp): void {
    if (a.prepared.css) this.layers.set(a.op, a.prepared.css);
    for (const [el, tok] of a.prepared.marks ?? [])
      if (el.isConnected) this.marks.mark(el, tok);
    this.layers.flush();
    if (a.prepared.run) {
      const r = a.prepared.run();
      a.handle = typeof r === 'function' ? { undo: r } : r;
    }
    this.applied.set(a.op, a);
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
  }> {
    return this.mutex.run(async () => {
      if (!this.facts) await this.extractNow();
      const p = OPS[op].prepare(this.env(), levelValue(op, level), scope);
      return {
        status: p.status,
        count: p.count,
        fit: p.fit,
        reason: p.reason,
        tokens: (p.marks ?? []).map(
          ([el, t]) => `${el.localName}${el.id ? `#${el.id}` : ''}:${t}`,
        ),
      };
    });
  }

  // ======================================================================
  // Verify on demand (the harness and "deep" re-checks)
  // ======================================================================

  /**
   * Re-verify everything currently applied: take a baseline with every op
   * removed, re-apply in one write, diff, and roll back failures.
   */
  async verify(): Promise<VerifyReport> {
    return this.mutex.run(async () => {
      const ops = [...this.applied.values()];
      if (ops.length === 0 || !this.facts)
        return { failures: [], rolledBack: [], busyMs: 0 };
      const anchor = readingAnchor(this.doc, this.facts.main);
      for (const a of ops) this.removeOp(a.op);
      this.layers.flush();
      const planned = ops.map((a) => a.planned);
      const results = await this.batch(planned);
      restoreAnchor(this.doc, anchor);
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
    const anchor = readingAnchor(this.doc, this.facts?.main ?? null);
    for (const id of ids) {
      this.removeOp(id);
      this.reports.delete(id);
      if (this.prePaint.has(id)) setOffGate(this.doc, id, true);
    }
    if (op === 'all') {
      for (const id of this.prePaint) setOffGate(this.doc, id, true);
      this.reports.clear();
    }
    this.layers.flush();
    restoreAnchor(this.doc, anchor);
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
      const cur = this.applied.get(op);
      const planned: PlannedOp | undefined =
        cur?.planned ??
        this.lastPlan?.ops.find((p) => p.op === op) ??
        undefined;
      if (!planned) return this.changes();
      if (cur) this.removeOp(op);
      this.layers.flush();
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
        .filter((el) => el.isConnected)
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

  /** Show the first-time toast for the headline automatic change. */
  announce(results: AppliedChange[] = this.changes()): void {
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
        (roots) => this.mutex.run(() => this.onMutations(roots)),
        undefined,
        () => this.route?.check(),
      );
      this.scheduler.observe(this.doc);
      for (const s of this.layers.scopes())
        if (s instanceof ShadowRoot) this.scheduler.observe(s);
    }
    if (!this.route) {
      this.route = new RouteWatcher(this.view, () => {
        this.ui.hideToast();
        this.ui.hideOffer();
        this.opts.events.routeChanged();
      });
    }
    if (!this.friction) {
      const detector = new FrictionDetector((signal, ops) =>
        this.opts.events.friction(signal, ops),
      );
      this.friction = installFriction(this.view, detector);
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

  /** New subtrees: mark them with the ops already applied, verify just those marks. */
  private async onMutations(rootsIn: FlushRoots): Promise<void> {
    if (this.paused || this.destroyed || !this.facts) return;
    this.layers.watchdog();
    this.marks.prune();
    const roots =
      rootsIn === 'all'
        ? [this.doc.body]
        : rootsIn.filter((r) => r.isConnected && !SKIP_TAGS.has(r.localName));
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

    const env = this.env();
    const incoming: Array<[OpId, Element, string]> = [];
    for (const a of this.applied.values()) {
      const impl = OPS[a.op];
      if (impl.incremental) {
        try {
          for (const [el, tok] of impl.incremental(env, a, roots))
            incoming.push([a.op, el, tok]);
        } catch {
          // Incremental marking is best effort; the op stays as it was.
        }
      }
      try {
        a.handle?.onAdded?.(roots);
      } catch {
        // ignore: the page removed what it inserted
      }
    }
    if (incoming.length === 0) return;
    const probes: ProbeSet = buildProbes({
      doc: this.doc,
      view: this.view,
      marked: incoming.map(([, el, tok]) => [el, tok] as const),
      existing: [],
      targets: [],
      contrast: [],
    });
    const base: Snapshot = takeSnapshot(this.doc, probes);
    const anchor = readingAnchor(this.doc, this.facts.main);
    for (const [, el, tok] of incoming) this.marks.mark(el, tok);
    restoreAnchor(this.doc, anchor);
    await settle(this.doc);
    const fails = diffSnapshots(this.doc, probes, base, {
      contrastTarget: 4.5,
      marked: incoming.map(([, el]) => el),
    });
    // Scoped rollback: drop just the new marks near each failure.
    for (const f of fails) {
      for (const [op, el] of incoming) {
        if (el === f.el || f.el.contains(el) || el.contains(f.el))
          this.marks.unmarkOpOn(el, op);
      }
    }
    restoreAnchor(this.doc, anchor);
    for (const a of this.applied.values())
      a.prepared.count = Math.max(a.prepared.count, this.marks.countFor(a.op));
    this.ui.refresh();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.undoNow('all');
    } finally {
      this.stopRuntime();
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

/** A refine/offer plan updates the ops it names and keeps the rest. */
export function mergePlans(
  prev: AdaptationPlan,
  next: AdaptationPlan,
): AdaptationPlan {
  const ops = new Map(prev.ops.map((p) => [p.op, p] as const));
  for (const p of next.ops) ops.set(p.op, p);
  return { ...next, ops: [...ops.values()] };
}

export const __test = { offerCopy, sameScope, TOAST_LINE };
