/**
 * v2 harness for the content-script adapter (WP3b): the real ContentAdapter
 * and Engine against a stand-in service worker and a stand-in Fit view
 * runtime, plus a bare RouteWatcher for the route spec. Exposes
 * window.__v2adapter; every method returns plain serializable data.
 */
import type { PageSpec } from '@webable/core/compose/spec';
import { VOCAB_V1, vocabFilter } from '@webable/core/page/vocab';
import type { AdaptationPlan } from '@webable/core/policy/types';
import { fromStoredSpec, toStoredSpec } from '@webable/core/skeleton/locate';
import { outlineTokens, wireOutline } from '@webable/core/skeleton/outline';
import { toWireSkeleton } from '@webable/core/skeleton/to-wire';
import type { SkeletonNode } from '@webable/core/skeleton/types';
import { wireSkeletonSchema } from '@webable/core/skeleton/wire';

import { ContentAdapter, type Transport } from '../../../lib/engine/adapter';
import type { Engine } from '../../../lib/engine/engine';
import {
  ENGINE_API_KEY,
  FITVIEW_RUNTIME_KEY,
  type EngineApi,
  type FitViewOpenInput,
  type FitViewRuntime,
} from '../../../lib/engine/fitview/types';
import { isRouteHash, RouteWatcher } from '../../../lib/engine/runtime/route';
import type {
  ContentToWorker,
  FitViewOpenReply,
  FitViewUnavailable,
  HelloReply,
} from '../../../lib/protocol';

type Sent = ContentToWorker & { at: number };

/** How the stand-in worker answers cs:fitview-request. */
type FitMode =
  | { mode: 'ok'; zoom?: number }
  /** Replies ok but never injects fitview.js. */
  | { mode: 'no-runtime' }
  | { mode: 'unavailable'; why: FitViewUnavailable };

interface RuntimeCall {
  type: 'open' | 'close' | 'setZoom' | 'offerSpec';
  at: number;
  reason?: string;
  /** The reply's one-time intro and "Always here" (open calls). */
  intro?: boolean;
  alwaysHere?: boolean;
  zoom?: number;
  source?: string;
  nodes?: number;
  extractionId?: string;
  registry?: boolean;
  engineApi?: boolean;
}

const sent: Sent[] = [];
const runtimeCalls: RuntimeCall[] = [];
let adapter: ContentAdapter | null = null;
let handler: ((msg: unknown) => Promise<unknown> | undefined) | null = null;
let fitMode: FitMode = { mode: 'ok' };
/** How the stand-in worker answers cs:signals. */
interface SignalsReply {
  plan: AdaptationPlan;
  announce?: boolean;
  fitViewOffer?: boolean;
  fitViewAuto?: boolean;
}
let signalsReply: SignalsReply | null = null;
let runtimeOpen = false;
let lastInput: FitViewOpenInput | null = null;

const g = globalThis as Record<symbol, unknown>;

/** The Fit view runtime fitview.js would register (WP5/WP6 stand-in). */
const runtime: FitViewRuntime = {
  async open(input) {
    lastInput = input;
    runtimeOpen = true;
    // Like fitview.js: the runtime freezes Tailor and reports its own lifecycle.
    input.engine.freeze(true);
    void input.engine
      .send({
        type: 'cs:fitview-event',
        event: {
          kind: 'opened',
          source: input.reply.envelope.source,
          reason: input.reason,
          ms: 1,
        },
      })
      .catch(() => undefined);
    runtimeCalls.push({
      type: 'open',
      at: performance.now(),
      reason: input.reason,
      intro: input.reply.intro === true,
      alwaysHere: input.reply.alwaysHere === true,
      nodes: input.skeleton.nodes.length,
      extractionId: input.skeleton.extractionId,
      registry: typeof input.registry.element === 'function',
      engineApi: input.engine === g[ENGINE_API_KEY],
    });
  },
  offerSpec(envelope) {
    runtimeCalls.push({
      type: 'offerSpec',
      at: performance.now(),
      source: envelope.source,
    });
  },
  close(reason) {
    runtimeCalls.push({ type: 'close', at: performance.now(), reason });
    if (!runtimeOpen) return;
    runtimeOpen = false;
    const api = lastInput?.engine;
    api?.freeze(false);
    void api
      ?.send({
        type: 'cs:fitview-event',
        event: { kind: 'closed', reason, afterMs: 1, actions: 0 },
      })
      .catch(() => undefined);
  },
  setZoom(zoom) {
    runtimeCalls.push({ type: 'setZoom', at: performance.now(), zoom });
  },
  isOpen: () => runtimeOpen,
};

function okReply(
  msg: Extract<ContentToWorker, { type: 'cs:fitview-request' }>,
  zoom: number,
): FitViewOpenReply {
  return {
    ok: true,
    envelope: {
      source: 'heuristic',
      extractionId: msg.skeleton.extractionId,
      validated: {
        spec: {
          v: 1,
          page_type: 'other',
          primary_task: 'read',
          sections: [],
          collections: [],
        },
        primary: 0,
        rest: [],
        repairs: [],
      },
      createdAt: Date.now(),
    },
    // The renderer is a stand-in: it never reads the layout.
    layout: {} as never,
    zoom,
    site: { label: 'example.test', secure: false },
    plannerPending: false,
    alwaysHere: false,
    // As the worker: the first automatic restructure ever says what happened.
    ...(msg.reason === 'auto' ? { intro: true } : {}),
  };
}

function worker(hello: HelloReply): Transport {
  return {
    send: (async (msg: ContentToWorker) => {
      sent.push({
        ...(JSON.parse(JSON.stringify(msg)) as ContentToWorker),
        at: performance.now(),
      });
      switch (msg.type) {
        case 'cs:hello':
          return hello;
        case 'cs:signals':
          return signalsReply;
        case 'cs:friction':
          return { offer: null };
        case 'cs:offer-answer':
          return { plan: null };
        case 'cs:fitview-request': {
          const m = fitMode;
          if (m.mode === 'unavailable') return { ok: false, why: m.why };
          // The worker injects fitview.js before it answers ok.
          if (m.mode === 'ok') g[FITVIEW_RUNTIME_KEY] = runtime;
          return okReply(msg, m.mode === 'ok' ? (m.zoom ?? 1) : 1);
        }
        default:
          return { ok: true };
      }
    }) as Transport['send'],
    listen: (h) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
  };
}

const engineOf = (): Engine | null =>
  (adapter as unknown as { engine: Engine | null } | null)?.engine ?? null;

/** Stand-in for the worker's keyed name HMAC (a seeded FNV-1a). */
const nameHash = (label: string): string => {
  let h = 0x811c9dc5 ^ 0x5eed;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `h${h.toString(16)}`;
};

let kept: {
  read: NonNullable<Awaited<ReturnType<EngineApi['skeleton']>>>;
  spec: PageSpec;
  stored: ReturnType<typeof toStoredSpec>;
} | null = null;

const engineApi = (): EngineApi | null =>
  (g[ENGINE_API_KEY] as EngineApi | undefined) ?? null;

/** Ids of `root` and everything below it. */
function subtree(nodes: readonly SkeletonNode[], root: string): Set<string> {
  const ids = new Set([root]);
  for (const n of nodes)
    if (n.parent !== null && ids.has(n.parent)) ids.add(n.id);
  return ids;
}

// Route watcher for route.spec.ts --------------------------------------------
let routes: RouteWatcher | null = null;
const routeEvents: string[] = [];

const api = {
  /** Start the adapter with a stand-in worker; resolves after the first plan. */
  async start(opts: {
    hello: HelloReply;
    plan: AdaptationPlan;
    announce?: boolean;
    /** The worker allows the in-page offer on this page (cs:signals fitViewOffer). */
    offer?: boolean;
    /** The worker restructures this page on arrival (cs:signals fitViewAuto). */
    auto?: boolean;
    fit?: FitMode;
    timing?: { offerQuietMs?: number; tabQuietMs?: number };
  }) {
    adapter?.stop();
    sent.length = 0;
    runtimeCalls.length = 0;
    runtimeOpen = false;
    delete g[FITVIEW_RUNTIME_KEY];
    fitMode = opts.fit ?? { mode: 'ok' };
    signalsReply = {
      plan: opts.plan,
      announce: opts.announce,
      ...(opts.offer ? { fitViewOffer: true } : {}),
      ...(opts.auto ? { fitViewAuto: true } : {}),
    };
    adapter = new ContentAdapter({
      transport: worker(opts.hello),
      vocab: { vocabFilter },
      timing: opts.timing,
    });
    await adapter.start();
    return true;
  },
  setFit(mode: FitMode) {
    fitMode = mode;
    return true;
  },
  setPlan(
    plan: AdaptationPlan,
    announce?: boolean,
    extra: { offer?: boolean; auto?: boolean } = {},
  ) {
    signalsReply = {
      plan,
      announce,
      ...(extra.offer ? { fitViewOffer: true } : {}),
      ...(extra.auto ? { fitViewAuto: true } : {}),
    };
    return true;
  },
  /** What WebAble has applied to the page right now (Tailor held: nothing new). */
  applied() {
    return (
      engineOf()
        ?.changes()
        .filter((c) => c.status === 'applied')
        .map((c) => c.op) ?? []
    );
  },
  async workerMessage(msg: unknown) {
    return handler ? handler(msg) : undefined;
  },
  sent(): Sent[] {
    return sent.slice();
  },
  runtimeCalls(): RuntimeCall[] {
    return runtimeCalls.slice();
  },
  runtimeOpen() {
    return runtimeOpen;
  },
  /** The runtime closes itself (the person picked Original page, or a route it cannot show). */
  closeFromRuntime(reason: 'original' | 'route' | 'not_representable') {
    runtime.close(reason);
    return true;
  },
  state() {
    return adapter?.fitViewState() ?? null;
  },
  layer() {
    return engineOf()?.layer.inspect() ?? null;
  },
  press(label: string) {
    return engineOf()?.layer.press(label) ?? false;
  },
  /** The EngineApi fitview.js would find, exercised from the page. */
  async engineApi() {
    const e = g[ENGINE_API_KEY] as EngineApi | undefined;
    if (!e) return null;
    const read = await e.skeleton();
    return {
      methods: Object.keys(e).sort(),
      skeleton: read
        ? {
            nodes: read.skeleton.nodes.length,
            extractionId: read.skeleton.extractionId,
            first:
              read.registry.element(read.skeleton.nodes[0]!.id)?.localName ??
              null,
          }
        : null,
      measured: e.measured(() => 41 + 1),
    };
  },
  /** Subscribe to EngineApi.onRoute; returns a handle to read and unsubscribe. */
  subscribeRoutes() {
    const e = g[ENGINE_API_KEY] as EngineApi | undefined;
    if (!e) return false;
    const w = window as unknown as {
      __v2routeHits: number;
      __v2routeOff: () => void;
    };
    w.__v2routeHits = 0;
    w.__v2routeOff = e.onRoute(() => {
      w.__v2routeHits++;
    });
    return true;
  },
  stop() {
    adapter?.stop();
    adapter = null;
    return true;
  },

  // The wire (core/skeleton) on a real read of this page ---------------------
  /** Read through the EngineApi, then build what would leave the device. */
  async wire() {
    const read = await engineApi()?.skeleton();
    if (!read) return null;
    const wire = toWireSkeleton(read.skeleton);
    const outline = wireOutline(wire);
    const labels = wire.nodes.flatMap((n) => n.l ?? []);
    return {
      json: JSON.stringify(wire),
      outline,
      tokens: outlineTokens(outline),
      parsed: wireSkeletonSchema.safeParse(wire).success,
      nodes: wire.nodes.length,
      collections: wire.nodes.filter((n) => n.k === 'collection').length,
      labels,
      unknownWords: labels.filter((w) => w !== '·' && !VOCAB_V1.has(w)),
      typed: read.skeleton.typed.length,
    };
  },
  /** Store a spec for this page as the cache would (locators, no ids). */
  async storeSpec() {
    const api = engineApi();
    const a = await api?.skeleton();
    if (!api || !a) return null;
    const nodes = a.skeleton.nodes;
    const pick = (ok: (n: SkeletonNode) => boolean) => nodes.find(ok);
    // The page's main list: the collection with the richest records.
    const slotsOf = (n: SkeletonNode): SkeletonNode[] => {
      const inside = subtree(nodes, n.collection!.exemplar);
      return nodes.filter((x) => x.slot && inside.has(x.id));
    };
    const list = nodes
      .filter((n) => n.kind === 'collection')
      .sort((x, y) => slotsOf(y).length - slotsOf(x).length)[0]!;
    const slots = slotsOf(list).slice(0, 16);
    const sections = (
      [
        ['header', pick((n) => n.role === 'banner')],
        ['primary_nav', pick((n) => n.role === 'navigation')],
        ['page_heading', pick((n) => n.tag === 'h1')],
        ['main_list', list],
      ] as const
    ).filter(([, n]) => n);
    const spec: PageSpec = {
      v: 1,
      page_type: 'inbox_or_messages',
      primary_task: 'triage_messages',
      sections: sections.map(([kind, n]) => ({
        kind,
        importance: kind === 'main_list' ? 'primary' : 'secondary',
        node_ids: [n!.id],
        heading_ref: null,
        layout: 'as_is',
      })),
      collections: [
        {
          list_id: list.id,
          item_kind: 'message',
          open_slot: slots.find((n) => n.kind === 'control')?.id ?? null,
          card: 'message',
          media: 'none',
          lead: 'none',
          fields: slots.map((n) => ({
            slot_id: n.id,
            role: 'other',
            show: 'always',
          })),
        },
      ],
    };
    const stored = toStoredSpec(
      { spec, primary: sections.length - 1, rest: [], repairs: [] },
      a.skeleton,
      nameHash,
      { schema: 'wa-compose-2.0.0', model: 'gpt-6-sol', createdAt: 1 },
    );
    kept = { read: a, spec, stored };
    return {
      stored: JSON.stringify(stored),
      sections: spec.sections.length,
      fields: spec.collections[0]!.fields.length,
    };
  },
  /** Read the page again and re-bind the stored spec: which elements came back. */
  async rebind() {
    const api = engineApi();
    const b = await api?.skeleton();
    if (!kept || !b) return null;
    const { read: a, spec, stored } = kept;
    const back = fromStoredSpec(stored, b.skeleton, nameHash);
    const same = back.spec.sections.map((s, i) => {
      const before = a.registry.element(spec.sections[i]!.node_ids[0]!);
      return before !== null && before === b.registry.element(s.node_ids[0]!);
    });
    // Slots are exemplar-relative: the same field, perhaps of another record.
    const fieldOf = (reg: typeof a.registry, id: string): string => {
      const el = reg.element(id);
      return el ? `${el.localName}.${el.className}` : 'missing';
    };
    const fieldsBack = back.spec.collections[0]?.fields ?? [];
    return {
      coverage: back.coverage,
      sections: back.spec.sections.length,
      same,
      fieldsBack: fieldsBack.length,
      fieldsSame: spec.collections[0]!.fields.map(
        (f, i) =>
          fieldOf(a.registry, f.slot_id) ===
          fieldOf(b.registry, fieldsBack[i]?.slot_id ?? ''),
      ),
      differentIds: a.skeleton.extractionId !== b.skeleton.extractionId,
    };
  },

  // Route watcher ----------------------------------------------------------
  watchRoutes(quietMs = 100) {
    routes?.dispose();
    routeEvents.length = 0;
    routes = new RouteWatcher(
      window,
      () =>
        routeEvents.push(location.pathname + location.search + location.hash),
      quietMs,
      1000,
    );
    return true;
  },
  routeEvents() {
    return routeEvents.slice();
  },
  isRouteHash(hash: string) {
    return isRouteHash(hash, document);
  },
  unwatchRoutes() {
    routes?.dispose();
    routes = null;
    return true;
  },
};

declare global {
  interface Window {
    __v2adapter: typeof api;
  }
}

window.__v2adapter = api;
