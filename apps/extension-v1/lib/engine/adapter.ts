import type { OpId } from '@webable/core/ops/catalog';
import type {
  AdaptationPlan,
  AppliedChange,
  PlannedOp,
} from '@webable/core/policy/types';
import type { TriageBlocker, TriageVerdict } from '@webable/core/triage/types';

import type {
  ContentReplies,
  ContentToWorker,
  FitViewEvent,
  FitViewOpenReason,
  FitViewOpenReply,
  FitViewUnavailable,
  HelloReply,
  WorkerReplies,
  WorkerToContent,
} from '../protocol';
import { Engine, type ApplyOptions, type EngineEvents } from './engine';
import {
  ENGINE_API_KEY,
  FITVIEW_RUNTIME_KEY,
  type EngineApi,
  type FitViewRuntime,
} from './fitview/types';
import { setOffGate } from './ops/marks';
import { RouteWatcher } from './runtime/route';
import { readSkeleton } from './skeleton';
import type { VocabPort } from './types';
import { isOurs } from './util/dom';
import { nextFrame, yieldToMain } from './util/schedule';

/**
 * Thin messaging adapter between the engine and the service worker. The
 * engine never sees chrome.* APIs; this file never touches the page beyond
 * reading whether it has settled.
 *
 * It also connects Fit view (docs/10 §4): it offers the engine to fitview.js
 * as an EngineApi (globalThis[ENGINE_API_KEY]), runs the open flow (read a
 * skeleton, cs:fitview-request, hand the reply to the Fit view runtime),
 * opens Fit view on arrival (docs/11 §2: an automatic restructure, or tab
 * mode), offers it where the worker says so, and reports the zoom guard
 * after a page-scale change.
 *
 * Arrival: when the page will open in Fit view, Tailor is held (frozen
 * before the plan applies, so the engine defers it) until the view opens or
 * the attempt ends; the person never sees Tailor's changes, or a page scale,
 * flash before the view.
 *
 * Zoom bookkeeping: `tabZoom` is the tab's absolute zoom factor (sw:zoom
 * `zoom`, the open reply's `zoom`); Fit view divides by it. `scale` is
 * WebAble's page scale relative to the person's own zoom (AdaptationPlan.zoom,
 * sw:zoom `scale`); the zoom guard checks and reports it. Tailor sizes from
 * the plan alone: ownZoom x zoom, the person's own zoom as the worker sent
 * it times the page scale, is the tab's zoom once the scale is on the tab
 * (`tabZoom` is not known before the first sw:zoom).
 */

export interface Transport {
  send<T extends ContentToWorker>(msg: T): Promise<ContentReplies[T['type']]>;
  /** Register a handler for service-worker messages; returns an unsubscribe. */
  listen(handler: (msg: unknown) => Promise<unknown> | undefined): () => void;
}

/**
 * Not in the shared protocol yet: the focus-layer command (chrome.commands
 * 'focus-layer') forwarded by the service worker. Handled defensively.
 */
type ExtraWorkerMessage = { type: 'sw:focus-layer' };
type Incoming = WorkerToContent | ExtraWorkerMessage;

const WORKER_TYPES = new Set<string>([
  'sw:plan',
  'sw:undo',
  'sw:set-level',
  'sw:pause',
  'sw:resume',
  'sw:show-on-page',
  'sw:reading-guide',
  'sw:offer',
  'sw:get-changes',
  'sw:focus-layer',
  'sw:offer-resolved',
  'sw:fitview',
  'sw:fitview-spec',
  'sw:zoom',
]);

export function isWorkerMessage(msg: unknown): msg is Incoming {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof (msg as { type?: unknown }).type === 'string' &&
    WORKER_TYPES.has((msg as { type: string }).type)
  );
}

export interface AdapterOptions {
  doc?: Document;
  transport: Transport;
  vocab: VocabPort;
  openClosed?: (el: Element) => ShadowRoot | null;
  /** False once this script's extension context is gone (extension reloaded). */
  alive?: () => boolean;
  /** Fit view waits, for tests (defaults: the documented periods). */
  timing?: { offerQuietMs?: number; tabQuietMs?: number };
}

/** Per-document guard on the isolated-world window: the running adapter. */
const RUNNING = Symbol.for('webable.engine');
type Guarded = { [RUNNING]?: ContentAdapter };

/** Tab mode opens Fit view once the DOM has been quiet this long (docs/10 §4.5). */
export const TAB_MODE_QUIET_MS = 500;
/** ...or after this long, on pages that never stop changing (tickers, clocks). */
const TAB_MODE_MAX_WAIT_MS = 4000;
/** Tab mode stops waiting for a blocking overlay or an empty page after this long. */
const TAB_MODE_GIVE_UP_MS = 60_000;
/** Requests tab mode may make while the worker still sees a blocking overlay. */
const TAB_MODE_ATTEMPTS = 6;
const TAB_MODE_RETRY_MS = 2000;
/** While blocked, tab mode looks again at least this often. */
const TAB_MODE_LOOK_MS = 2000;
/** No Fit view chip in the first 10 s of a page view (personalization.md 5.2, as for every in-page offer). */
export const FIT_VIEW_OFFER_QUIET_MS = 10_000;
/** A page-scale change shows up as a resize within this long... */
const ZOOM_START_MS = 1500;
/** ...and has settled once no resize came for this long. */
const ZOOM_QUIET_MS = 300;
/** Upper bound on waiting for a zoom's resizes to stop. */
const ZOOM_MAX_MS = 3000;

type CloseReason = Parameters<FitViewRuntime['close']>[0];

/** How an open attempt ended. `blocked`: a site overlay must be answered first. */
export type OpenOutcome = 'opened' | 'blocked' | 'unavailable' | 'failed';

/** Explicit opens tell the person when Fit view cannot open; automatic ones mostly stay quiet. */
const EXPLICIT: ReadonlySet<FitViewOpenReason> = new Set([
  'offer',
  'popup',
  'shortcut',
  'switch',
]);

/**
 * One calm line on why Fit view is offered, from the triage reasons. Never
 * page text, never a diagnosis.
 */
export function fitViewReason(t: TriageVerdict | undefined): string {
  const kinds = new Set(t?.reasons.map((r) => r.kind) ?? []);
  const why = kinds.has('cant_stretch')
    ? 'This page can’t grow enough for your fit on its own.'
    : kinds.has('small_text')
      ? 'Text on this page is small for your fit.'
      : kinds.has('small_targets') || kinds.has('crowded_targets')
        ? 'Buttons on this page are small for your fit.'
        : kinds.has('busy')
          ? 'This page is busy.'
          : kinds.has('covered')
            ? 'Bars cover much of this page.'
            : '';
  const what = 'Fit view shows the same page, laid out for you.';
  return why ? `${why} ${what}` : what;
}

/** The one line shown when Fit view cannot re-present a page. */
export function unavailableLine(
  why: FitViewUnavailable,
  blockers: readonly TriageBlocker[] = [],
): string {
  if (why === 'blocked_overlay' || blockers.includes('blocking_overlay'))
    return 'Answer the message on this page first, then open Fit view.';
  if (why === 'excluded') return 'Fit view is off for this site.';
  if (why === 'error' || why === 'stale')
    return 'Fit view couldn’t open on this page. Try again.';
  if (blockers.includes('video_player'))
    return 'Videos play best on the original page.';
  if (blockers.includes('editor') || blockers.includes('application'))
    return 'Editors and apps work best on the original page.';
  if (blockers.includes('password') || blockers.includes('payment'))
    return 'Sign-in and payment pages stay as they are.';
  if (blockers.includes('paywall'))
    return 'This page stays as the site shows it.';
  return 'Fit view isn’t available for this page.';
}

/**
 * One engine per document. A second injection into the same document finds
 * the running adapter under the guard, has it report what is applied
 * (cs:hello {restored} then cs:applied) and starts nothing. An adapter whose
 * extension context is gone is stopped and replaced.
 */
export function startOnce(
  view: Window,
  create: () => ContentAdapter,
): { adapter: ContentAdapter; created: boolean; ready: Promise<void> } {
  const slot = view as unknown as Guarded;
  const running = slot[RUNNING];
  if (running?.isLive) {
    return { adapter: running, created: false, ready: running.restored() };
  }
  running?.stop();
  const adapter = create();
  slot[RUNNING] = adapter;
  const ready = adapter.start().catch(() => adapter.stop());
  return { adapter, created: true, ready };
}

function domReady(doc: Document): Promise<void> {
  if (doc.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) =>
    doc.addEventListener('DOMContentLoaded', () => resolve(), { once: true }),
  );
}

/**
 * A prerendered page (Chrome preloads search results and address-bar
 * suggestions) speaks only once it is shown: until then the tab still shows
 * the page the person is on, and that page's record must stay as it is.
 */
function activated(doc: Document): Promise<void> {
  if (!(doc as Document & { prerendering?: boolean }).prerendering)
    return Promise.resolve();
  return new Promise((resolve) =>
    doc.addEventListener('prerenderingchange', () => resolve(), {
      once: true,
    }),
  );
}

function visible(doc: Document): Promise<void> {
  if (!doc.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const on = (): void => {
      if (doc.hidden) return;
      doc.removeEventListener('visibilitychange', on);
      resolve();
    };
    doc.addEventListener('visibilitychange', on);
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Page mutations only: WebAble's own hosts (layer, Fit view) do not count. */
function pageMutated(records: readonly MutationRecord[]): boolean {
  for (const r of records) {
    const t = r.target;
    const el = t.nodeType === 1 ? (t as Element) : t.parentElement;
    if (!el || isOurs(el)) continue;
    if (
      r.type === 'childList' &&
      [...r.addedNodes, ...r.removedNodes].every(
        (n) => n.nodeType === 1 && isOurs(n as Element),
      )
    )
      continue;
    return true;
  }
  return false;
}

/**
 * Resolves once the page's DOM has had no mutation for `quietMs`, or after
 * `maxMs` in all. `next` resolves at the first page mutation instead.
 */
function domQuiet(
  doc: Document,
  quietMs: number,
  maxMs: number,
  mode: 'quiet' | 'next' = 'quiet',
): Promise<void> {
  return new Promise((resolve) => {
    const root = doc.documentElement;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cap: ReturnType<typeof setTimeout> | null = null;
    let obs: MutationObserver | null = null;
    const done = (): void => {
      if (timer) clearTimeout(timer);
      if (cap) clearTimeout(cap);
      obs?.disconnect();
      resolve();
    };
    const arm = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    };
    cap = setTimeout(done, maxMs);
    if (!root) return done();
    obs = new MutationObserver((records) => {
      if (!pageMutated(records)) return;
      if (mode === 'next') done();
      else arm();
    });
    obs.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      // Waiting for a change: an overlay closing may only flip an attribute.
      ...(mode === 'next'
        ? {
            attributeFilter: ['open', 'hidden', 'aria-modal', 'class', 'style'],
          }
        : {}),
    });
    if (mode === 'quiet') arm();
  });
}

/** True when the page has something to show: main (or body) holds text or media. */
function hasContent(doc: Document): boolean {
  const main =
    doc.querySelector('main, [role="main"]') ?? doc.body ?? doc.documentElement;
  if (!main) return false;
  if ((main.textContent ?? '').trim().length > 0) return true;
  return (
    main.querySelector('img, picture, video, canvas, svg, iframe') !== null
  );
}

/** A modal the site has open now (a dialog in the top layer, or a visible aria-modal box). */
function modalOpen(doc: Document): boolean {
  try {
    if (doc.querySelector('dialog:modal')) return true;
  } catch {
    // :modal unsupported: fall through to the attribute check
  }
  for (const el of doc.querySelectorAll('[aria-modal="true"]')) {
    if (isOurs(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return true;
  }
  return false;
}

/**
 * The resizes a zoom change causes: true once they have settled, false when
 * none came within `startMs` (the zoom was already in effect, or none applied).
 */
function zoomSettled(view: Window, startMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let seen = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = setTimeout(() => finish(false), startMs);
    const cap = setTimeout(() => finish(true), ZOOM_MAX_MS);
    const onResize = (): void => {
      seen = true;
      clearTimeout(start);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(true), ZOOM_QUIET_MS);
    };
    const finish = (settled: boolean): void => {
      clearTimeout(start);
      clearTimeout(cap);
      if (timer) clearTimeout(timer);
      view.removeEventListener('resize', onResize);
      resolve(settled && seen);
    };
    view.addEventListener('resize', onResize, { passive: true });
  });
}

export class ContentAdapter {
  private engine: Engine | null = null;
  private unlisten: (() => void) | null = null;
  private hello: HelloReply | null = null;
  /** The last plan applied here, reported again on a restore. */
  private planId: string | null = null;
  private stopped = false;
  /** A start in flight (first load, or waking after WebAble was off). */
  private booting: Promise<void> | null = null;
  private planning: Promise<void> | null = null;
  private revision = 0;
  private requestedPlan = false;
  private offPageShow: (() => void) | null = null;
  private readonly doc: Document;

  // Fit view --------------------------------------------------------------
  /** The EngineApi on globalThis while this adapter has an engine. */
  private api: EngineApi | null = null;
  /** The latest plan (its triage decides offers and tab mode). */
  private lastPlan: AdaptationPlan | null = null;
  /** The tab's absolute zoom factor as last reported (sw:zoom, open reply); 1 until known. */
  private tabZoom = 1;
  /** WebAble's page scale relative to the person's zoom (plan.zoom, sw:zoom scale); 1 = none. */
  private scale = 1;
  /** Bumped on every zoom or scale change, so an open in flight sees that the page reflowed. */
  private zoomEpoch = 0;
  /** The page scale the zoom guard last checked (once per value per page view). */
  private guardedZoom = 1;
  private guarding: Promise<void> | null = null;
  /** Tailor is frozen under an open Fit view. */
  private frozen = false;
  private opening: Promise<OpenOutcome> | null = null;
  /** Set by a close that arrives while an open is in flight. */
  private openCancelled = false;
  /** Tab mode (hello.fitViewTab): Fit view follows this tab until "Original page". */
  private tabMode = false;
  /** The open on arrival in progress (an automatic restructure or tab mode). */
  private arrivalTask: Promise<void> | null = null;
  /** The worker asked to restructure this page on arrival (cs:signals fitViewAuto). */
  private autoPending = false;
  /** An automatic open was tried in this document (once, as the worker decides it). */
  private autoTried = false;
  /** Tailor is held (frozen, its plan deferred) for an open on arrival. */
  private held = false;
  /** Tab mode has tried this page view and it cannot be re-presented. */
  private tabModeDone = false;
  /** The not-available line was shown for this page view. */
  private toldUnavailable = false;
  /** In-page offer: shown at most once per document, never again after "Not now". */
  private offerState: 'none' | 'waiting' | 'shown' | 'declined' = 'none';
  private offerTimer: ReturnType<typeof setTimeout> | null = null;
  /** When this page view began (start, or the last route change). */
  private viewStartedAt = performance.now();
  private readonly routeSubs = new Set<() => void>();
  private routeWatcher: RouteWatcher | null = null;
  private routeObserver: MutationObserver | null = null;

  constructor(private readonly opts: AdapterOptions) {
    this.doc = opts.doc ?? document;
  }

  /** document_start: hello, wait for the DOM, extract, plan, apply, report. */
  async start(): Promise<void> {
    // Tiny frames (ad slots, trackers, widgets) are adapted from their parent page.
    const view = this.doc.defaultView;
    if (
      view &&
      view !== view.top &&
      (view.innerWidth < 200 || view.innerHeight < 150)
    )
      return;
    this.unlisten = this.opts.transport.listen((msg) =>
      isWorkerMessage(msg) ? this.handle(msg) : undefined,
    );
    if (view) {
      // Back/forward cache: the page comes back with the engine still applied.
      const onShow = (e: PageTransitionEvent): void => {
        if (e.persisted) void this.restored();
      };
      view.addEventListener('pageshow', onShow);
      this.offPageShow = () => view.removeEventListener('pageshow', onShow);
    }
    await activated(this.doc);
    await this.boot();
  }

  /**
   * Hello, then (when WebAble may run here) create the engine and adapt. Also
   * how a dormant adapter wakes: a page that loaded while WebAble was off has
   * no engine until the worker resumes it or injects again.
   */
  private boot(): Promise<void> {
    if (this.engine || this.stopped) return Promise.resolve();
    this.booting ??= this.bootNow().finally(() => {
      this.booting = null;
    });
    return this.booting;
  }

  private async bootNow(): Promise<void> {
    let hello: HelloReply;
    try {
      hello = await this.opts.transport.send({ type: 'cs:hello' });
    } catch {
      // MV3 can restart between dispatch and delivery. Recover once without
      // requiring the person to open the popup or reload the page.
      await new Promise((r) => setTimeout(r, 150));
      if (this.stopped) return;
      try {
        hello = await this.opts.transport.send({ type: 'cs:hello' });
      } catch {
        return;
      }
    }
    if (this.stopped || !hello) return;
    this.hello = hello;
    this.tabMode = hello.fitViewTab === true;
    if (!hello.enabled) {
      setOffGate(this.doc, 'all', true);
      return;
    }
    setOffGate(this.doc, 'all', hello.paused);
    await domReady(this.doc);
    if (this.stopped || this.engine) return;
    this.engine = new Engine({
      doc: this.doc,
      vocab: this.opts.vocab,
      events: this.events(),
      openClosed: this.opts.openClosed,
      prePaint: hello.prePaint,
    });
    this.expose();
    this.configure(hello);
    if (hello.paused) {
      await this.engine.pause();
      return;
    }
    await visible(this.doc);
    if (this.stopped || this.engine?.isPaused) return;
    await this.plan(true);
  }

  /** Extract, ask for a plan, apply it as a fresh decision, report. One at a time. */
  private plan(first: boolean): Promise<void> {
    // Tailor is frozen under Fit view: it decides again once Fit view closes.
    if (this.frozen && !first) return Promise.resolve();
    this.revision++;
    this.requestedPlan = true;
    this.planning ??= (async () => {
      let announce = first;
      while (this.requestedPlan && !this.stopped) {
        this.requestedPlan = false;
        const revision = this.revision;
        await this.planNow(announce, revision);
        announce = false;
      }
    })().finally(() => {
      this.planning = null;
    });
    return this.planning;
  }

  private async planNow(first: boolean, revision: number): Promise<void> {
    const engine = this.engine;
    if (!engine || this.stopped || engine.isPaused) return;
    let x;
    try {
      x = await engine.extract();
    } catch {
      return; // unreadable page: status says so; nothing applied
    }
    if (revision !== this.revision || this.stopped || engine.isPaused) return;
    const ask = () =>
      this.opts.transport
        .send({
          type: 'cs:signals',
          signals: x.signals,
          evidence: x.evidence,
        })
        .catch(() => undefined);
    // No answer usually means Chrome restarted the service worker mid-request:
    // ask once more rather than leave the page waiting.
    let reply = await ask();
    if (!reply?.plan && !this.stopped) {
      await new Promise((r) => setTimeout(r, 1000));
      reply = await ask();
    }
    if (
      !reply?.plan ||
      this.stopped ||
      engine.isPaused ||
      revision !== this.revision
    )
      return;
    // A page about to open in Fit view holds Tailor before anything applies.
    if (this.arrivesInFitView(reply)) this.hold();
    // The first decision replaces whatever ran before it. Later ones answer
    // the page changing (content, route, viewport) and are sticky: what is
    // applied stays exactly as it is, and they can only add. Only the person
    // (undo, levels, pause, settings) removes or resizes a change.
    const changes = await this.applyAndReport(
      reply.plan,
      first ? { replace: true, refresh: true } : { sticky: true },
    );
    // The toast is for the first automatic changes on a site; the service
    // worker decides (`announce` on the reply) and remembers where it has.
    if (first && reply.announce === true) engine.announce(changes);
    this.afterPlan(reply, first);
  }

  /** WebAble's own motion setting and shortcuts; older replies lack them. */
  private configure(hello: Partial<HelloReply>): void {
    this.engine?.configure({
      reduceMotion: hello.reduceMotion === true,
      shortcuts: {
        focusLayer: hello.shortcuts?.focusLayer ?? '',
        undoAll: hello.shortcuts?.undoAll ?? '',
      },
    });
  }

  /**
   * This document already has a running engine (a bfcache restore, or a
   * second injection found the guard): say so, then report the current plan
   * and changes. Before the first hello has been answered, start() reports.
   */
  async restored(): Promise<void> {
    if (this.stopped) return;
    // Dormant (it loaded while WebAble was off): start properly instead.
    if (!this.engine) return this.boot();
    if (!this.hello) return;
    let hello: HelloReply;
    try {
      hello = await this.opts.transport.send({
        type: 'cs:hello',
        restored: true,
      });
    } catch {
      return;
    }
    if (this.stopped) return;
    this.hello = hello;
    this.tabMode = hello?.fitViewTab === true;
    this.configure(hello ?? {});
    const engine = this.engine;
    if (!hello?.enabled || hello.paused) {
      this.cancelArrival(false);
      this.runtime()?.close('paused');
      this.thaw(false);
      await engine?.pause();
      return;
    }
    if (engine?.isPaused) {
      await engine.resume();
      await this.plan(false);
      return;
    }
    if (!engine || this.planId === null) return;
    await this.opts.transport
      .send({
        type: 'cs:applied',
        planId: this.planId,
        changes: engine.changes(),
      })
      .catch(() => undefined);
    if (this.tabMode && !this.isFitViewOpen()) this.arrive('tab_mode');
  }

  /** Running, and its extension context is still valid. */
  get isLive(): boolean {
    return !this.stopped && (this.opts.alive?.() ?? true);
  }

  private async applyAndReport(
    plan: AdaptationPlan,
    options: ApplyOptions,
  ): Promise<AppliedChange[]> {
    const engine = this.engine;
    if (!engine) return [];
    if (plan.ops.some((p) => p.op === 'page_zoom'))
      engine.suppressZoomFriction();
    const changes = await engine.apply(plan, options);
    this.planId = plan.id;
    this.notePlan(plan);
    await this.opts.transport
      .send({ type: 'cs:applied', planId: plan.id, changes })
      .catch(() => undefined);
    return changes;
  }

  private events(): EngineEvents {
    return {
      friction: (signal, ops) => {
        void this.opts.transport
          .send({ type: 'cs:friction', signal, ops: [...ops] })
          .then((r) => {
            if (r?.offer) this.engine?.offer(r.offer);
          })
          .catch(() => undefined);
      },
      offerAnswer: (op, answer) => {
        void this.opts.transport
          .send({ type: 'cs:offer-answer', op, answer })
          .then(async (r) => {
            if (answer === 'accept' && r?.plan)
              await this.applyAndReport(r.plan, { acceptOffers: true });
          })
          .catch(() => undefined);
      },
      // The toast's Undo all: one message; the worker records the undo events.
      undone: () => {
        this.revision++;
        this.requestedPlan = false;
        void this.opts.transport
          .send({ type: 'cs:undo-all', source: 'toast' })
          .catch(() => undefined);
      },
      routeChanged: () => {
        this.newPageView();
        void this.plan(false).catch(() => undefined);
      },
      pageChanged: () => void this.plan(false).catch(() => undefined),
      interacted: () => {
        if (!this.hello) return;
        void this.opts.transport
          .send({ type: 'cs:interaction', tabSession: this.hello.tabSession })
          .catch(() => undefined);
      },
    };
  }

  /** Every WorkerToContent message, answered with its WorkerReplies shape. */
  async handle(msg: Incoming): Promise<unknown> {
    const engine = this.engine;
    if (msg.type === 'sw:get-changes') {
      const reply: WorkerReplies['sw:get-changes'] = {
        changes: engine?.changes() ?? [],
        status: engine?.status ?? 'idle',
      };
      return reply;
    }
    if (!engine) {
      // Dormant: WebAble was off when this page loaded. Wake on resume or a plan.
      if (msg.type === 'sw:resume' || msg.type === 'sw:plan') {
        void this.boot().catch(() => undefined);
        return msg.type === 'sw:resume'
          ? ({
              changes: [],
              restarting: true,
            } satisfies WorkerReplies['sw:resume'])
          : { changes: [] };
      }
      if (msg.type === 'sw:pause') setOffGate(this.doc, 'all', true);
      if (msg.type === 'sw:fitview')
        return { ok: false } satisfies WorkerReplies['sw:fitview'];
      if (msg.type === 'sw:zoom') {
        this.tabZoom = msg.zoom;
        if (typeof msg.scale === 'number' && msg.scale > 0)
          this.scale = msg.scale;
      }
      return msg.type === 'sw:pause' ||
        msg.type === 'sw:show-on-page' ||
        msg.type === 'sw:reading-guide' ||
        msg.type === 'sw:offer' ||
        msg.type === 'sw:focus-layer' ||
        msg.type === 'sw:offer-resolved' ||
        msg.type === 'sw:fitview-spec' ||
        msg.type === 'sw:zoom'
        ? { ok: true }
        : { changes: [] };
    }
    switch (msg.type) {
      case 'sw:plan': {
        if (msg.reason !== 'refine') {
          this.revision++;
          this.requestedPlan = false;
        }
        if (msg.reason === 'refine') {
          // A fast response can arrive before the instant plan finishes.
          await this.planning;
          if (
            this.stopped ||
            engine.isPaused ||
            (msg.basePlanId && msg.basePlanId !== this.planId)
          )
            return { changes: engine.changes() };
        }
        const plan =
          msg.reason === 'refine' && engine.hasInteracted
            ? {
                ...msg.plan,
                ops: msg.plan.ops.filter((p) =>
                  engine.appliedOps().includes(p.op),
                ),
              }
            : msg.plan;
        if (msg.plan.ops.some((p) => p.op === 'page_zoom'))
          engine.suppressZoomFriction();
        const changes = await engine.apply(plan, {
          acceptOffers: msg.reason === 'offer_accepted',
          replace: msg.reason === 'settings',
        });
        this.planId =
          msg.reason === 'refine'
            ? (msg.basePlanId ?? this.planId ?? msg.plan.id)
            : msg.plan.id;
        this.notePlan(msg.plan);
        return { changes } satisfies WorkerReplies['sw:plan'];
      }
      case 'sw:undo':
        if (msg.basePlanId && msg.basePlanId !== this.planId)
          return { changes: engine.changes() };
        this.revision++;
        this.requestedPlan = false;
        return {
          changes: await engine.undo(msg.op),
        } satisfies WorkerReplies['sw:undo'];
      case 'sw:set-level':
        this.revision++;
        this.requestedPlan = false;
        return {
          changes: await engine.setLevel(msg.op, msg.level),
        } satisfies WorkerReplies['sw:set-level'];
      case 'sw:pause':
        this.revision++;
        this.requestedPlan = false;
        this.cancelOffer();
        this.cancelArrival(false);
        this.runtime()?.close('paused');
        this.thaw(false);
        await engine.pause();
        return { ok: true } satisfies WorkerReplies['sw:pause'];
      case 'sw:resume': {
        const changes = await engine.resume();
        // The DOM may have changed while paused. Always measure it again.
        void this.plan(this.planId === null).catch(() => undefined);
        return {
          changes,
          restarting: true,
        } satisfies WorkerReplies['sw:resume'];
      }
      case 'sw:show-on-page':
        engine.showOnPage(msg.op, msg.on);
        return { ok: true } satisfies WorkerReplies['sw:show-on-page'];
      case 'sw:reading-guide':
        await engine.readingGuide(msg.on);
        return { ok: true } satisfies WorkerReplies['sw:reading-guide'];
      case 'sw:offer':
        engine.offer(msg.offer);
        return { ok: true } satisfies WorkerReplies['sw:offer'];
      case 'sw:focus-layer':
        return { ok: engine.focusLayer() };
      case 'sw:offer-resolved':
        engine.resolveOffer(msg.op);
        return { ok: true } satisfies WorkerReplies['sw:offer-resolved'];
      case 'sw:fitview': {
        if (!this.isTop)
          return { ok: false } satisfies WorkerReplies['sw:fitview'];
        if (msg.action === 'close') {
          const was = this.isFitViewOpen() || this.opening !== null;
          if (this.opening) this.openCancelled = true;
          // Closing from the popup or the shortcut is the person choosing the original page.
          const why: CloseReason =
            msg.reason === 'route' ? 'route' : 'original';
          if (why === 'original') {
            this.tabMode = false;
            this.cancelArrival();
          }
          this.runtime()?.close(why);
          this.thaw();
          return { ok: was } satisfies WorkerReplies['sw:fitview'];
        }
        if (engine.isPaused) return { ok: false };
        void this.openFitView(msg.reason === 'original' ? 'popup' : msg.reason);
        return { ok: true } satisfies WorkerReplies['sw:fitview'];
      }
      case 'sw:fitview-spec':
        if (this.isFitViewOpen()) this.runtime()?.offerSpec(msg.envelope);
        return { ok: true } satisfies WorkerReplies['sw:fitview-spec'];
      case 'sw:zoom':
        this.onZoom(msg.zoom, msg.owner, msg.scale);
        return { ok: true } satisfies WorkerReplies['sw:zoom'];
    }
  }

  stop(): void {
    this.stopped = true;
    this.revision++;
    this.requestedPlan = false;
    this.unlisten?.();
    this.unlisten = null;
    this.offPageShow?.();
    this.offPageShow = null;
    this.cancelOffer();
    this.autoPending = false;
    this.held = false;
    // A Fit view left behind would drive a page whose engine is gone.
    if (this.isFitViewOpen()) this.runtime()?.close('error');
    this.routeSubs.clear();
    this.stopRouteWatch();
    const g = globalThis as Record<symbol, unknown>;
    if (this.api && g[ENGINE_API_KEY] === this.api) delete g[ENGINE_API_KEY];
    this.api = null;
    const slot = this.doc.defaultView as unknown as Guarded | null;
    if (slot?.[RUNNING] === this) delete slot[RUNNING];
    this.engine?.destroy();
    this.engine = null;
  }

  /** For diagnostics: the prePaint list the service worker reported. */
  get prePaint(): readonly OpId[] {
    return this.hello?.prePaint ?? [];
  }

  // ======================================================================
  // Fit view
  // ======================================================================

  /** The top document (not a frame): the only one Fit view and the zoom guard concern. */
  private get isTop(): boolean {
    const view = this.doc.defaultView;
    try {
      return view !== null && view.top === view;
    } catch {
      return false;
    }
  }

  /** The Fit view runtime, once the worker has injected fitview.js. */
  private runtime(): FitViewRuntime | null {
    const r = (globalThis as Record<symbol, unknown>)[FITVIEW_RUNTIME_KEY];
    return r && typeof (r as FitViewRuntime).open === 'function'
      ? (r as FitViewRuntime)
      : null;
  }

  private isFitViewOpen(): boolean {
    try {
      return this.runtime()?.isOpen() === true;
    } catch {
      return false;
    }
  }

  /** Offer the engine to fitview.js (same isolated world, found by symbol). */
  private expose(): void {
    const engine = this.engine;
    // Fit view is the top document's: frames never offer, open or guard it.
    if (!engine || !this.isTop) return;
    const api: EngineApi = {
      skeleton: async () => {
        const e = this.engine;
        if (!e || this.stopped) return null;
        return readSkeleton(this.doc, {
          openClosed: this.opts.openClosed,
          measured: <T>(fn: () => T): T => e.measured(fn),
          regionKeys: e.regionKeys(),
          yieldMain: yieldToMain,
        });
      },
      freeze: (on) => this.setFrozen(on),
      send: <T extends ContentToWorker>(
        msg: T,
      ): Promise<ContentReplies[T['type']]> => {
        // The runtime reports its own closes; Tailor comes back with them.
        const m = msg as ContentToWorker;
        if (m.type === 'cs:fitview-event' && m.event.kind === 'closed') {
          const event = m.event;
          queueMicrotask(() => this.closed(event));
        }
        return this.opts.transport.send(msg);
      },
      onRoute: (cb) => this.subscribeRoute(cb),
      measured: <T>(fn: () => T): T =>
        this.engine ? this.engine.measured(fn) : fn(),
    };
    this.api = api;
    (globalThis as Record<symbol, unknown>)[ENGINE_API_KEY] = api;
  }

  /**
   * Freeze Tailor while Fit view is open. Thawing measures the page again
   * (sticky: it can only add), since routes, lazy content and proxied actions
   * may have changed it underneath.
   */
  private setFrozen(on: boolean, replan = true): void {
    if (on === this.frozen) return;
    this.frozen = on;
    this.engine?.freeze(on);
    if (on) {
      this.cancelOffer();
      this.engine?.layer.withdrawFitView();
      return;
    }
    if (replan && !this.stopped && this.engine && !this.engine.isPaused)
      void this.plan(false).catch(() => undefined);
  }

  private thaw(replan = true): void {
    if (this.frozen) this.setFrozen(false, replan);
  }

  /** The runtime reported a close: Tailor comes back, tab mode ends on "Original page". */
  private closed(event: Extract<FitViewEvent, { kind: 'closed' }>): void {
    if (event.reason === 'original') this.tabMode = false;
    this.thaw();
  }

  /**
   * Open Fit view: read a skeleton at the person's own zoom, ask the worker,
   * then hand the reply to the runtime fitview.js registered. One at a time;
   * a second call joins the first.
   */
  openFitView(reason: FitViewOpenReason): Promise<OpenOutcome> {
    if (this.opening) return this.opening;
    this.openCancelled = false;
    this.opening = this.openNow(reason)
      .catch((): OpenOutcome => 'failed')
      .finally(() => {
        this.opening = null;
      });
    return this.opening;
  }

  private async openNow(reason: FitViewOpenReason): Promise<OpenOutcome> {
    const engine = this.engine;
    const api = this.api;
    if (!engine || !api || this.stopped || engine.isPaused) return 'failed';
    // "Switch" replaces the open view with a fresh read and the layout that
    // is ready; any other open of an open view does nothing.
    const replacing = this.isFitViewOpen();
    if (replacing && reason !== 'switch') return 'opened';
    const explicit = EXPLICIT.has(reason);
    const view = this.doc.defaultView;
    const epoch = this.zoomEpoch;
    // Tailor holds still from here: the worker may return the tab to the
    // person's zoom while it answers, and nothing should replan under that.
    this.setFrozen(true);
    const fail = (
      outcome: OpenOutcome,
      why?: FitViewUnavailable,
    ): OpenOutcome => {
      // The open view stays as it is; a held Tailor waits for its arrival
      // to end. Otherwise measure again only if the page reflowed meanwhile.
      if (replacing) return outcome;
      if (!this.held) this.thaw(this.zoomEpoch !== epoch);
      const tell =
        explicit ||
        (reason === 'tab_mode' && why !== 'error' && !this.toldUnavailable);
      if (why && tell && !this.stopped) {
        if (reason === 'tab_mode') this.toldUnavailable = true;
        this.notice(unavailableLine(why, this.lastPlan?.triage?.blockers));
      }
      return outcome;
    };

    // Read, ask; when the worker returned the tab to the person's zoom while
    // answering, the page reflowed: read it again there (docs/10 §4.6).
    for (let attempt = 1; ; attempt++) {
      const before = {
        width: view?.innerWidth ?? 0,
        dpr: view?.devicePixelRatio ?? 1,
        epoch: this.zoomEpoch,
      };
      const read = await api.skeleton().catch(() => null);
      if (this.stopped || this.openCancelled) return fail('failed');
      if (!read) {
        // Pages with password or payment fields are never read.
        if (explicit)
          this.notice(unavailableLine('not_representable', ['password']));
        return fail('unavailable');
      }
      let reply: FitViewOpenReply | undefined;
      try {
        reply = await this.opts.transport.send({
          type: 'cs:fitview-request',
          skeleton: read.skeleton,
          reason,
        });
      } catch {
        reply = undefined;
      }
      if (this.stopped || this.openCancelled) return fail('failed');
      if (!reply) return fail('failed', 'error');
      if (!reply.ok) {
        if (reply.why === 'stale' && attempt < 2) continue;
        // On arrival a blocking overlay is waited out, not announced.
        if (
          reply.why === 'blocked_overlay' &&
          (reason === 'tab_mode' || reason === 'auto')
        )
          return fail('blocked');
        return fail(
          reply.why === 'error' || reply.why === 'stale'
            ? 'failed'
            : 'unavailable',
          reply.why,
        );
      }
      if (attempt < 2 && view && (await this.reflowed(view, before))) continue;
      if (this.stopped || this.openCancelled) return fail('failed');

      const runtime = this.runtime();
      if (!runtime) {
        this.report({
          kind: 'closed',
          reason: 'error',
          afterMs: 0,
          actions: 0,
        });
        return fail('failed', 'error');
      }
      this.tabZoom = reply.zoom;
      // The runtime reports its own lifecycle (opened, closed, defects).
      try {
        await runtime.open({
          reply,
          skeleton: read.skeleton,
          registry: read.registry,
          engine: api,
          reason,
        });
      } catch {
        return fail('failed', 'error');
      }
      if (!this.isFitViewOpen()) return fail('failed');
      // Fit view now follows this tab until the person picks Original page,
      // the offer has done its job for this document, and the view (not the
      // arrival) keeps Tailor frozen from here.
      this.tabMode = true;
      this.offerState = 'shown';
      this.autoPending = false;
      this.held = false;
      // Closed from the popup while it was opening: honour that now.
      if (this.openCancelled) {
        runtime.close('original');
        this.tabMode = false;
        this.thaw();
        return 'failed';
      }
      return 'opened';
    }
  }

  private report(event: FitViewEvent): void {
    void this.opts.transport
      .send({ type: 'cs:fitview-event', event })
      .catch(() => undefined);
  }

  /**
   * After the worker's reply: did the page reflow under the read (a zoom
   * change)? Waits for the resizes to settle before saying yes.
   */
  private async reflowed(
    view: Window,
    before: { width: number; dpr: number; epoch: number },
  ): Promise<boolean> {
    await nextFrame(50);
    const moved = (): boolean =>
      view.innerWidth !== before.width || view.devicePixelRatio !== before.dpr;
    if (this.zoomEpoch === before.epoch && !moved()) return false;
    await zoomSettled(view, ZOOM_QUIET_MS);
    return moved() || this.zoomEpoch !== before.epoch;
  }

  /** One calm line in WebAble's layer (WebAble's own words, never page text). */
  private notice(text: string): void {
    this.engine?.layer.notice(text);
  }

  // ---------------------------------------------------------------- plans

  /** Track the page scale a plan brings (relative to the person's zoom). */
  private notePlan(plan: AdaptationPlan): void {
    this.lastPlan = plan;
    const z = plan.zoom;
    if (typeof z === 'number' && Number.isFinite(z) && z > 0) this.setScale(z);
  }

  /**
   * WebAble's page scale changed (a plan, or sw:zoom's scale): start the zoom
   * guard when it scales the page. Never while Tailor is frozen: the guard
   * runs on the first plan after it thaws.
   */
  private setScale(z: number): void {
    if (z !== this.scale) this.zoomEpoch++;
    this.scale = z;
    if (z <= 1) this.guardedZoom = z;
    else if (z !== this.guardedZoom && this.isTop && !this.frozen)
      this.guard(z);
  }

  /** This plan's page opens in Fit view on arrival: an automatic restructure, or tab mode on a page it can show. */
  private arrivesInFitView(reply: ContentReplies['cs:signals']): boolean {
    if (!this.isTop || this.stopped || this.isFitViewOpen()) return false;
    if (this.frozen && !this.held) return false;
    return (
      (reply.fitViewAuto === true && !this.autoTried) ||
      (this.tabMode &&
        !this.tabModeDone &&
        reply.plan.triage?.representable === true)
    );
  }

  /** Hold Tailor for an open on arrival: the engine defers the plan until it thaws. */
  private hold(): void {
    if (this.held) return;
    this.held = true;
    this.setFrozen(true);
  }

  /** The arrival ended without an open: Tailor applies, and reports, now. */
  private release(): void {
    if (!this.held || this.isFitViewOpen()) return;
    this.held = false;
    this.thaw(true);
  }

  /** The person closed Fit view, or paused WebAble: no open on arrival after that. */
  private cancelArrival(replan = true): void {
    this.autoPending = false;
    this.tabModeDone = true;
    if (!this.held) return;
    this.held = false;
    if (!this.isFitViewOpen()) this.thaw(replan);
  }

  /** After a plan: the open on arrival (automatic or tab mode), or the offer the worker allows. */
  private afterPlan(reply: ContentReplies['cs:signals'], first: boolean): void {
    if (!this.isTop || this.stopped || this.isFitViewOpen()) return;
    if (this.frozen && !this.held) return;
    if (reply.fitViewAuto === true && !this.autoTried) {
      this.autoTried = true;
      this.autoPending = true;
      this.arrive('auto');
      return;
    }
    if (this.tabMode) {
      this.arrive('tab_mode');
      return;
    }
    const t = reply.plan.triage;
    if (reply.fitViewOffer === true && t?.representable) this.offer(t, first);
  }

  /**
   * The in-page offer (docs/10 §7): on the first-visit toast when it shows,
   * as "Made this page bigger for your fit · Undo · Open Fit view"; otherwise
   * a chip after the quiet period, held while the person is busy, at most
   * once per document and never after "Not now".
   */
  private offer(t: TriageVerdict, first: boolean): void {
    const engine = this.engine;
    if (!engine || this.offerState !== 'none') return;
    const view = {
      reason: fitViewReason(t),
      open: () => {
        this.offerState = 'shown';
        void this.openFitView('offer');
      },
      declined: () => {
        this.offerState = 'declined';
      },
    };
    if (first && engine.layer.toastShown) {
      if (engine.layer.offerFitView(view) === 'toast') {
        this.offerState = 'shown';
        return;
      }
    }
    this.offerState = 'waiting';
    const quiet = this.opts.timing?.offerQuietMs ?? FIT_VIEW_OFFER_QUIET_MS;
    const wait = Math.max(0, quiet - (performance.now() - this.viewStartedAt));
    this.offerTimer = setTimeout(() => {
      this.offerTimer = null;
      const e = this.engine;
      if (
        !e ||
        this.stopped ||
        this.frozen ||
        e.isPaused ||
        this.isFitViewOpen() ||
        this.offerState !== 'waiting'
      )
        return;
      // A chip already showing wins; the popup stays the way in.
      this.offerState = e.layer.offerFitView(view) ? 'shown' : 'none';
    }, wait);
  }

  private cancelOffer(): void {
    if (this.offerTimer) clearTimeout(this.offerTimer);
    this.offerTimer = null;
    if (this.offerState === 'waiting') this.offerState = 'none';
  }

  /** A route change starts a new page view: offers and notices belong to the old one. */
  private newPageView(): void {
    this.viewStartedAt = performance.now();
    this.toldUnavailable = false;
    this.tabModeDone = false;
    this.cancelOffer();
    this.engine?.layer.withdrawFitView();
  }

  /**
   * Open on arrival: an automatic restructure (docs/11 §2, reason 'auto') or
   * tab mode (docs/10 §4.5, 'tab_mode'). Fit view opens once the first plan
   * has applied (or been held), the DOM has been quiet for 500 ms, main has
   * content and no blocking overlay is open; once per page view. In tab mode
   * a page that cannot be re-presented gets one line instead. A held Tailor
   * applies when the attempt ends without an open.
   */
  private arrive(reason: 'auto' | 'tab_mode'): void {
    if (this.arrivalTask) return;
    this.arrivalTask = this.arriveNow(reason)
      .catch(() => undefined)
      .finally(() => {
        this.arrivalTask = null;
        // Once per page view: a later plan on this one does not try again.
        if (reason === 'auto') this.autoPending = false;
        else if (!this.isFitViewOpen()) this.tabModeDone = true;
        this.release();
      });
  }

  private async arriveNow(reason: 'auto' | 'tab_mode'): Promise<void> {
    const deadline = performance.now() + TAB_MODE_GIVE_UP_MS;
    const live = (): boolean =>
      !this.stopped &&
      (reason === 'auto'
        ? this.autoPending
        : this.tabMode && !this.tabModeDone) &&
      (!this.frozen || this.held) &&
      this.engine !== null &&
      !this.engine.isPaused &&
      !this.isFitViewOpen();
    let attempts = 0;
    while (live() && performance.now() < deadline) {
      await domQuiet(
        this.doc,
        this.opts.timing?.tabQuietMs ?? TAB_MODE_QUIET_MS,
        TAB_MODE_MAX_WAIT_MS,
      );
      if (!live()) return;
      const t = this.lastPlan?.triage;
      const blockers = t?.blockers ?? [];
      if (
        t &&
        !t.representable &&
        blockers.some((b) => b !== 'blocking_overlay')
      ) {
        // One line, once per page view: "Videos play best on the original
        // page". An automatic restructure says nothing: nobody asked.
        if (reason === 'tab_mode') {
          if (!this.toldUnavailable) {
            this.toldUnavailable = true;
            this.notice(unavailableLine('not_representable', blockers));
          }
          this.tabModeDone = true;
        }
        return;
      }
      if (!modalOpen(this.doc) && hasContent(this.doc)) {
        attempts++;
        const outcome = await this.openFitView(reason);
        if (outcome === 'blocked' && attempts < TAB_MODE_ATTEMPTS) {
          await sleep(TAB_MODE_RETRY_MS);
        } else {
          // Opened, or this page view cannot be: try again on the next one.
          if (outcome !== 'opened' && reason === 'tab_mode')
            this.tabModeDone = true;
          return;
        }
      }
      // Wait for the page to change (the overlay answered, content arrived),
      // looking again every couple of seconds in any case.
      if (!live()) return;
      await domQuiet(
        this.doc,
        0,
        Math.min(TAB_MODE_LOOK_MS, Math.max(0, deadline - performance.now())),
        'next',
      );
    }
  }

  // ---------------------------------------------------------------- zoom

  /**
   * The zoom guard (docs/10 §5.1): once a page scale has applied and its
   * resizes have settled, report overflow and what navigation is still
   * visible, so the worker can step down a level if the scale hid them.
   */
  private guard(zoom: number): void {
    this.guardedZoom = zoom;
    const view = this.doc.defaultView;
    if (!view) return;
    const run = async (): Promise<void> => {
      await zoomSettled(view, ZOOM_START_MS);
      await nextFrame();
      const engine = this.engine;
      if (
        !engine ||
        this.stopped ||
        engine.isPaused ||
        this.frozen ||
        this.scale !== zoom ||
        this.planId === null
      )
        return;
      const g = engine.viewportGuard();
      await this.opts.transport
        .send({
          type: 'cs:applied',
          planId: this.planId,
          changes: engine.changes(),
          viewport: {
            zoom,
            overflowPx: g.overflowPx,
            navLinks: g.navLinks,
            searchVisible: g.searchVisible,
            newlyEllipsised: g.newlyEllipsised,
            titlesShown: g.titlesShown,
          },
        })
        .catch(() => undefined);
    };
    // One guard at a time: a step-down waits for the check before it.
    const job = (this.guarding ?? Promise.resolve())
      .then(run)
      .catch(() => undefined);
    this.guarding = job;
    void job.finally(() => {
      if (this.guarding === job) this.guarding = null;
    });
  }

  /**
   * sw:zoom: the tab's zoom changed. Fit view re-sizes to the absolute
   * factor; Tailor treats it as a width change (measure again once it
   * settles); a WebAble scale change (a step-down, the scale coming back
   * after Fit view) is guarded again.
   */
  private onZoom(
    zoom: number,
    owner: 'webable' | 'person',
    scale?: number,
  ): void {
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    this.zoomEpoch++;
    this.tabZoom = zoom;
    const scaled =
      typeof scale === 'number' && Number.isFinite(scale) && scale > 0;
    if (this.isFitViewOpen()) {
      if (scaled) this.scale = scale;
      this.runtime()?.setZoom(zoom);
      return;
    }
    const engine = this.engine;
    if (!engine) return;
    if (owner === 'webable') engine.suppressZoomFriction();
    if (scaled) this.setScale(scale);
    const view = this.doc.defaultView;
    if (!view || this.frozen) return;
    void zoomSettled(view, ZOOM_START_MS).then((resized) => {
      // The engine measures resizes itself; this covers a zoom that changed
      // while the tab was hidden or before its resize reached this frame.
      if (!resized && !this.stopped && this.tabZoom === zoom)
        void this.plan(false).catch(() => undefined);
    });
  }

  // ---------------------------------------------------------------- routes

  /** Route changes for Fit view: its own watcher, debounced, live while anyone listens. */
  private subscribeRoute(cb: () => void): () => void {
    this.routeSubs.add(cb);
    const view = this.doc.defaultView;
    if (!this.routeWatcher && view) {
      this.routeWatcher = new RouteWatcher(view, () => {
        this.newPageView();
        for (const fn of [...this.routeSubs]) {
          try {
            fn();
          } catch {
            // one listener's failure never stops the others
          }
        }
      });
      // DOM activity extends the quiet wait, as for the engine's own watcher.
      this.routeObserver = new MutationObserver((records) => {
        if (pageMutated(records)) this.routeWatcher?.check();
      });
      if (this.doc.documentElement)
        this.routeObserver.observe(this.doc.documentElement, {
          childList: true,
          subtree: true,
        });
    }
    return () => {
      this.routeSubs.delete(cb);
      if (this.routeSubs.size === 0) this.stopRouteWatch();
    };
  }

  private stopRouteWatch(): void {
    this.routeObserver?.disconnect();
    this.routeObserver = null;
    this.routeWatcher?.dispose();
    this.routeWatcher = null;
  }

  /** Test and diagnostics view of the Fit view state (no page data). */
  fitViewState(): {
    exposed: boolean;
    frozen: boolean;
    /** Tailor is held for an open on arrival. */
    held: boolean;
    tabMode: boolean;
    offer: 'none' | 'waiting' | 'shown' | 'declined';
    /** The tab's absolute zoom factor. */
    zoom: number;
    /** WebAble's page scale relative to the person's zoom. */
    scale: number;
    routeListeners: number;
  } {
    return {
      exposed:
        this.api !== null &&
        (globalThis as Record<symbol, unknown>)[ENGINE_API_KEY] === this.api,
      frozen: this.frozen,
      held: this.held,
      tabMode: this.tabMode,
      offer: this.offerState,
      zoom: this.tabZoom,
      scale: this.scale,
      routeListeners: this.routeSubs.size,
    };
  }
}

export type { PlannedOp };
