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

/** Remembers which sites have seen the first-time toast (on device only). */
export interface AnnounceStore {
  firstTime(): Promise<boolean>;
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
  announce?: AnnounceStore;
  openClosed?: (el: Element) => ShadowRoot | null;
}

function domReady(doc: Document): Promise<void> {
  if (doc.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) =>
    doc.addEventListener('DOMContentLoaded', () => resolve(), { once: true }),
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
  private category: AdaptationPlan['category'] = 'other';
  private stopped = false;
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
    let hello: HelloReply;
    try {
      hello = await this.opts.transport.send({ type: 'cs:hello' });
    } catch {
      return; // no service worker (extension reloading): leave the page untouched
    }
    this.hello = hello;
    if (!hello.enabled) {
      setOffGate(this.doc, 'all', true);
      return;
    }
    if (hello.paused) setOffGate(this.doc, 'all', true);
    await domReady(this.doc);
    if (this.stopped) return;
    this.engine = new Engine({
      doc: this.doc,
      vocab: this.opts.vocab,
      events: this.events(),
      openClosed: this.opts.openClosed,
      prePaint: hello.prePaint,
    });
    if (hello.paused) {
      await this.engine.pause();
      return;
    }
    await visible(this.doc);
    await this.plan(true);
  }

  /** Extract, ask for a plan, apply it as a fresh decision, report. */
  private async plan(first: boolean): Promise<void> {
    const engine = this.engine;
    if (!engine || this.stopped || engine.isPaused) return;
    let x;
    try {
      x = await engine.extract();
    } catch {
      return; // unreadable page: status says so; nothing applied
    }
    const reply = await this.opts.transport.send({
      type: 'cs:signals',
      signals: x.signals,
      evidence: x.evidence,
    });
    if (!reply?.plan || this.stopped) return;
    this.category = reply.plan.category;
    const changes = await this.applyAndReport(reply.plan, { replace: true });
    // The toast is for the first automatic changes on a site. The service
    // worker may decide (`announce` on the reply); otherwise the local store does,
    // and it is only consulted when something was actually changed.
    const flag = (reply as { announce?: unknown }).announce;
    const visible = changes.some(
      (c) => c.status === 'applied' && c.mode === 'auto' && c.fit,
    );
    if (!first || !visible) return;
    const announce =
      typeof flag === 'boolean'
        ? flag
        : (await this.opts.announce?.firstTime()) === true;
    if (announce) engine.announce(changes);
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
      undone: (changes) => {
        for (const c of changes) this.sendUndoEvent(c);
      },
      routeChanged: () => void this.plan(false).catch(() => undefined),
    };
  }

  private sendUndoEvent(c: AppliedChange): void {
    void this.opts.transport
      .send({
        type: 'cs:event',
        event: {
          cat: this.category,
          op: c.op,
          level: c.level,
          src: c.mode === 'offer' ? 'offer' : c.trace.source,
          kind: 'undo',
        },
      })
      .catch(() => undefined);
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
      if (msg.type === 'sw:pause') setOffGate(this.doc, 'all', true);
      return msg.type === 'sw:pause' ||
        msg.type === 'sw:show-on-page' ||
        msg.type === 'sw:reading-guide' ||
        msg.type === 'sw:offer' ||
        msg.type === 'sw:focus-layer'
        ? { ok: true }
        : { changes: [] };
    }
    switch (msg.type) {
      case 'sw:plan': {
        if (msg.plan.ops.some((p) => p.op === 'page_zoom'))
          engine.suppressZoomFriction();
        const changes = await engine.apply(msg.plan, {
          acceptOffers: msg.reason === 'offer_accepted',
          replace: msg.reason === 'settings',
        });
        return { changes } satisfies WorkerReplies['sw:plan'];
      }
      case 'sw:undo':
        return {
          changes: await engine.undo(msg.op),
        } satisfies WorkerReplies['sw:undo'];
      case 'sw:set-level':
        return {
          changes: await engine.setLevel(msg.op, msg.level),
        } satisfies WorkerReplies['sw:set-level'];
      case 'sw:pause':
        await engine.pause();
        return { ok: true } satisfies WorkerReplies['sw:pause'];
      case 'sw:resume':
        return {
          changes: await engine.resume(),
        } satisfies WorkerReplies['sw:resume'];
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
    }
  }

  stop(): void {
    this.stopped = true;
    this.unlisten?.();
    this.unlisten = null;
    this.engine?.destroy();
    this.engine = null;
  }

  /** For diagnostics: the prePaint list the service worker reported. */
  get prePaint(): readonly OpId[] {
    return this.hello?.prePaint ?? [];
  }
}

export type { PlannedOp };
