import type { OpId } from '@webable/core/ops/catalog';
import type {
  AdaptationPlan,
  AppliedChange,
  PlannedOp,
} from '@webable/core/policy/types';

import type {
  ContentReplies,
  ContentToWorker,
  HelloReply,
  WorkerReplies,
  WorkerToContent,
} from '../protocol';
import { Engine, type ApplyOptions, type EngineEvents } from './engine';
import { setOffGate } from './ops/marks';
import type { VocabPort } from './types';

/**
 * Thin messaging adapter between the engine and the service worker. The
 * engine never sees chrome.* APIs; this file never touches the page.
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
}

/** Per-document guard on the isolated-world window: the running adapter. */
const RUNNING = Symbol.for('webable.engine');
type Guarded = { [RUNNING]?: ContentAdapter };

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
    this.configure(hello ?? {});
    const engine = this.engine;
    if (!hello?.enabled || hello.paused) {
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
      routeChanged: () => void this.plan(false).catch(() => undefined),
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
      return msg.type === 'sw:pause' ||
        msg.type === 'sw:show-on-page' ||
        msg.type === 'sw:reading-guide' ||
        msg.type === 'sw:offer' ||
        msg.type === 'sw:focus-layer' ||
        msg.type === 'sw:offer-resolved'
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
    const slot = this.doc.defaultView as unknown as Guarded | null;
    if (slot?.[RUNNING] === this) delete slot[RUNNING];
    this.engine?.destroy();
    this.engine = null;
  }

  /** For diagnostics: the prePaint list the service worker reported. */
  get prePaint(): readonly OpId[] {
    return this.hello?.prePaint ?? [];
  }
}

export type { PlannedOp };
