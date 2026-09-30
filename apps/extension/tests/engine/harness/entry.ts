/**
 * Test bundle: the engine without the service worker. Built as an IIFE by
 * global-setup and injected into fixture pages, it exposes
 * window.__webableEngine so Playwright can drive extract / apply / verify /
 * undo in real Chromium. Every method returns plain serializable data.
 */
import type { OpId } from '@webable/core/ops/catalog';
import { vocabFilter } from '@webable/core/page/vocab';
import type {
  AdaptationPlan,
  AppliedChange,
  PlannedOp,
} from '@webable/core/policy/types';

import {
  ContentAdapter,
  startOnce,
  type Transport,
} from '../../../lib/engine/adapter';
import { Engine, type ApplyOptions } from '../../../lib/engine/engine';
import { sel } from '../../../lib/engine/ops/marks';
import type { ContentToWorker, HelloReply } from '../../../lib/protocol';
import type { VocabPort } from '../../../lib/engine/types';
import { fallbackVocab } from './vocab-fallback';

interface HarnessEvent {
  type: string;
  detail: unknown;
}

/** Use the real vocabulary; fall back to the test list only while core's is unimplemented. */
function vocab(): VocabPort & { source: 'core' | 'fallback' } {
  try {
    vocabFilter('probe words', 2);
    return { vocabFilter, source: 'core' };
  } catch {
    return { vocabFilter: fallbackVocab, source: 'fallback' };
  }
}

const events: HarnessEvent[] = [];
const port = vocab();
let engine: Engine | null = null;

function ensure(prePaint: OpId[] = []): Engine {
  if (!engine) {
    engine = new Engine({
      vocab: port,
      prePaint,
      events: {
        friction: (signal, ops) =>
          events.push({ type: 'friction', detail: { signal, ops } }),
        offerAnswer: (op, answer) =>
          events.push({ type: 'offerAnswer', detail: { op, answer } }),
        undone: (changes) =>
          events.push({ type: 'undone', detail: changes.map((c) => c.op) }),
        routeChanged: () =>
          events.push({
            type: 'routeChanged',
            detail: location.pathname + location.search,
          }),
        outlinesClosed: () =>
          events.push({ type: 'outlinesClosed', detail: null }),
      },
    });
  }
  return engine;
}

let adapter: ContentAdapter | null = null;
let adaptersCreated = 0;
let workerHandler: ((msg: unknown) => Promise<unknown> | undefined) | null =
  null;
const sent: ContentToWorker[] = [];

/** A stand-in service worker: answers every content-script message. */
function fakeWorker(plan: AdaptationPlan, hello: HelloReply): Transport {
  return {
    send: (async (msg: ContentToWorker) => {
      sent.push(JSON.parse(JSON.stringify(msg)) as ContentToWorker);
      switch (msg.type) {
        case 'cs:hello':
          return hello;
        case 'cs:signals':
          return { plan, announce: true };
        case 'cs:friction':
          return { offer: null };
        case 'cs:offer-answer':
          return { plan: null };
        default:
          return { ok: true };
      }
    }) as Transport['send'],
    listen: (handler) => {
      workerHandler = handler;
      return () => {
        workerHandler = null;
      };
    },
  };
}

const api = {
  vocabSource: port.source,
  /** The page-view selector for an internal mark token (the attribute and token are random). */
  markSelector(token: string) {
    return sel(token);
  },
  /** The content-script flow end to end, with a fake service worker. */
  async runAdapter(plan: AdaptationPlan, hello: HelloReply) {
    adapter?.stop();
    sent.length = 0;
    adapter = new ContentAdapter({
      transport: fakeWorker(plan, hello),
      vocab: port,
    });
    await adapter.start();
    return sent.slice();
  },
  /** The entrypoint's path: startOnce on this window; a second call finds the guard. */
  async injectAdapter(plan: AdaptationPlan, hello: HelloReply) {
    const from = sent.length;
    const r = startOnce(window, () => {
      adaptersCreated++;
      return new ContentAdapter({
        transport: fakeWorker(plan, hello),
        vocab: port,
      });
    });
    adapter = r.adapter;
    await r.ready;
    return { created: r.created, adaptersCreated, sent: sent.slice(from) };
  },
  /** The adapter's engine: press a label in its layer (e.g. the toast's Undo). */
  adapterPress(label: string) {
    const e = (adapter as unknown as { engine: Engine | null } | null)?.engine;
    return e ? e.layer.press(label) : false;
  },
  async workerMessage(msg: unknown) {
    return workerHandler ? workerHandler(msg) : undefined;
  },
  sentMessages() {
    return sent.slice();
  },
  stopAdapter() {
    adapter?.stop();
    adapter = null;
    return true;
  },
  init(prePaint: OpId[] = []) {
    ensure(prePaint);
    return true;
  },
  async extract() {
    const x = await ensure().extract();
    return { signals: x.signals, evidence: x.evidence, perf: x.perf };
  },
  async apply(
    plan: AdaptationPlan,
    opts?: ApplyOptions,
  ): Promise<AppliedChange[]> {
    return ensure().apply(plan, opts);
  },
  async verify() {
    return ensure().verify();
  },
  async undo(op: OpId | 'all') {
    return ensure().undo(op);
  },
  async setLevel(op: OpId, level: number) {
    return ensure().setLevel(op, level);
  },
  changes() {
    return ensure().changes();
  },
  async preview(op: OpId, level: number, regions?: string[]) {
    return ensure().preview(op, level, regions ? { regions } : 'page');
  },
  applied() {
    return ensure().appliedOps();
  },
  status() {
    return ensure().status;
  },
  perf() {
    return ensure().perf;
  },
  async pause() {
    await ensure().pause();
    return true;
  },
  async resume() {
    return ensure().resume();
  },
  showOnPage(op: OpId | null, on: boolean) {
    ensure().showOnPage(op, on);
    return ensure().layer.inspect();
  },
  async readingGuide(on: boolean) {
    return ensure().readingGuide(on);
  },
  offer(planned: PlannedOp) {
    return ensure().offer(planned);
  },
  focusLayer() {
    return ensure().focusLayer();
  },
  layer() {
    return ensure().layer.inspect();
  },
  press(label: string) {
    return ensure().layer.press(label);
  },
  events() {
    return events.slice();
  },
  destroy() {
    engine?.destroy();
    engine = null;
    return true;
  },
};

declare global {
  interface Window {
    __webableEngine: typeof api;
  }
}

window.__webableEngine = api;
