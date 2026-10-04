// @vitest-environment node
import type { OpId } from '@webable/core/ops/catalog';
import {
  articleSignals,
  FIXTURE_NOW,
  focusProfile,
  makeRegion,
  strongReaderProfile,
  workedExamplePage,
} from '@webable/core/policy/fixtures';
import type {
  AdaptationPlan,
  AppliedChange,
  PlannedOp,
} from '@webable/core/policy/types';
import type { FitProfile } from '@webable/core/profile/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerToContent } from '../protocol';
import { memoryArea } from '../storage/area';
import { createStores } from '../storage';
import type { ChromePort } from './chrome';
import { readConfig } from './config';
import { PageMemos } from './pages';
import { TabRegistry } from './tabs';
import { REASON_WINDOW_MS, UndoHold } from './undo';
import { OFFER_QUIET_MS, Worker, type Registration } from './worker';

/**
 * Offers, turn-on paths, the toast's Undo all and "I needed that", against
 * the same fakes as worker.test.ts: a scripted engine and a Chrome recorder.
 */

const TAB = 11;
const URL_A = 'https://news.example.com/story';
const DOMAIN = 'example.com';

function applied(p: PlannedOp): AppliedChange {
  return {
    op: p.op,
    level: p.level,
    mode: p.mode,
    status: 'applied',
    count: 3,
    fit: { before: '13 px', after: '21 px' },
    trace: p.trace,
  };
}

class FakeEngine {
  changes: AppliedChange[] = [];
  readonly received: WorkerToContent[] = [];

  handle(msg: WorkerToContent): unknown {
    this.received.push(msg);
    switch (msg.type) {
      case 'sw:plan': {
        const add = msg.plan.ops
          .filter(
            (p) =>
              p.op !== 'page_zoom' &&
              (p.mode === 'auto' || msg.reason === 'offer_accepted'),
          )
          .map(applied);
        const keep =
          msg.reason === 'settings'
            ? []
            : this.changes.filter((c) => !add.some((a) => a.op === c.op));
        this.changes = [...keep, ...add];
        return { changes: this.changes };
      }
      case 'sw:undo':
        this.changes =
          msg.op === 'all' ? [] : this.changes.filter((c) => c.op !== msg.op);
        return { changes: this.changes };
      case 'sw:resume':
        return { changes: this.changes };
      case 'sw:get-changes':
        return { changes: this.changes, status: 'ready' };
      default:
        return { ok: true };
    }
  }
}

function setup() {
  let now = FIXTURE_NOW;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  const stores = createStores(memoryArea(), clock.now);
  const engine = new FakeEngine();
  const zoom = new Map<number, number>();
  const port: ChromePort = {
    async sendToTab(_tabId, msg) {
      return engine.handle(msg as WorkerToContent) as never;
    },
    async setBadge() {},
    async getZoom(tabId) {
      return zoom.get(tabId) ?? 1;
    },
    async setZoom(tabId, factor) {
      zoom.set(tabId, factor);
    },
    async tabUrl() {
      return URL_A;
    },
    async activeTabId() {
      return TAB;
    },
    async openTab() {},
    broadcast() {},
  };
  const registration: Registration = {
    async hasAllSites() {
      return true;
    },
    async reconcile() {},
    async inject() {
      return true;
    },
    async openTabs() {
      return [];
    },
  };
  const worker = new Worker({
    config: readConfig({
      MODE: 'e2e',
      WXT_SUPABASE_URL: 'https://project.supabase.co',
      WXT_SUPABASE_PUBLISHABLE_KEY: 'pk',
    } as unknown as ImportMetaEnv),
    stores,
    tabs: new TabRegistry(memoryArea()),
    pages: new PageMemos(memoryArea()),
    undos: new UndoHold(memoryArea()),
    port,
    registration,
    auth: null,
    sync: null,
    now: clock.now,
  });
  return { worker, stores, engine, zoom, clock };
}

type Env = ReturnType<typeof setup>;

async function seed(e: Env, profile: FitProfile = strongReaderProfile()) {
  await e.stores.profile.write({
    profile,
    source: 'account',
    version: 1,
    fetchedAt: 0,
  });
  // A previously undone target adjustment is offered before it runs again.
  // Otherwise the saved target minimum now applies automatically.
  await e.stores.sites.update(DOMAIN, (site) => {
    site.state.ops.target_size = { s: 0, f: 0, t: site.state.t, demoted: true };
    return site;
  });
}

/** hello, signals, apply: what the content script does on a page load. */
async function loadPage(
  e: Env,
  signals = articleSignals(),
): Promise<AdaptationPlan> {
  const hello = await e.worker.hello(TAB, 0, URL_A);
  expect(hello.enabled).toBe(true);
  const reply = await e.worker.signals(TAB, 0, signals, {
    page: workedExamplePage(),
    regions: {},
  });
  const changes = e.engine.handle({
    type: 'sw:plan',
    plan: reply.plan,
    reason: 'settings',
  }) as { changes: AppliedChange[] };
  await e.worker.applied(TAB, 0, changes.changes);
  return reply.plan;
}

/** A misclick burst after the quiet period: the fixture offers bigger targets. */
async function frictionOffer(e: Env): Promise<PlannedOp> {
  e.clock.advance(OFFER_QUIET_MS + 1);
  const { offer } = await e.worker.friction(TAB, 'misclick_burst', [
    'target_size',
  ]);
  expect(offer?.op).toBe('target_size');
  return offer!;
}

const kinds = async (e: Env, op: OpId) =>
  (await e.stores.events.list()).filter((x) => x.op === op).map((x) => x.kind);

let env: Env;
beforeEach(() => {
  env = setup();
});

describe('friction offers', () => {
  it('replace a quieter instant-plan offer, and accepting applies that op', async () => {
    await seed(env);
    const plan = await loadPage(env);
    // The instant plan already holds an offer for another op.
    const quiet = plan.ops.find((p) => p.mode === 'offer');
    expect(quiet).toBeDefined();
    expect(quiet!.op).not.toBe('target_size');

    await frictionOffer(env);
    expect((await env.worker.view(TAB)).offer?.op).toBe('target_size');
    const reply = await env.worker.offerAnswer(
      TAB,
      'target_size',
      'accept',
      'page',
    );
    expect(reply.plan?.ops.map((p) => p.op)).toEqual(['target_size']);
    const tab = await env.worker.tabRecord(TAB);
    expect(tab?.plan?.ops.find((p) => p.op === 'target_size')?.mode).toBe(
      'auto',
    );
    expect(await kinds(env, 'target_size')).toEqual(
      expect.arrayContaining(['offered', 'offer_accepted']),
    );
    // The chip's own answer needs no echo.
    expect(
      env.engine.received.some((m) => m.type === 'sw:offer-resolved'),
    ).toBe(false);
  });

  it('tells the page when the popup answered or the offer expired', async () => {
    await seed(env);
    await loadPage(env);
    await frictionOffer(env);
    await env.worker.offerAnswer(TAB, 'target_size', 'dismiss', 'popup');
    expect(env.engine.received.at(-1)).toEqual({
      type: 'sw:offer-resolved',
      op: 'target_size',
    });

    const e2 = setup();
    await seed(e2);
    await loadPage(e2);
    await frictionOffer(e2);
    await e2.worker.offerAnswer(TAB, 'target_size', 'timeout', 'page');
    expect(e2.engine.received).toContainEqual({
      type: 'sw:offer-resolved',
      op: 'target_size',
    });
  });
});

describe('turning an op back on', () => {
  it('lifts "Don’t suggest this here": the replan and the next page load apply it', async () => {
    await seed(env);
    await loadPage(env);
    await frictionOffer(env);
    await env.worker.offerAnswer(TAB, 'target_size', 'never_here', 'popup');
    let site = await env.stores.sites.get(DOMAIN);
    expect(site.state.ops.target_size?.block).toBe(true);
    expect(env.engine.received).toContainEqual({
      type: 'sw:offer-resolved',
      op: 'target_size',
    });

    await env.worker.quick(TAB, 'targets', true);
    site = await env.stores.sites.get(DOMAIN);
    expect(site.state.ops.target_size?.block).toBeUndefined();
    expect(site.rule.blocks).not.toContain('target_size');
    expect(await kinds(env, 'target_size')).toContain('site_enable');
    const replan = env.engine.received
      .filter(
        (m): m is Extract<WorkerToContent, { type: 'sw:plan' }> =>
          m.type === 'sw:plan',
      )
      .at(-1);
    expect(replan?.plan.ops.map((p) => p.op)).toContain('target_size');
    expect(env.engine.changes.some((c) => c.op === 'target_size')).toBe(true);

    const next = await loadPage(env);
    expect(next.ops.find((p) => p.op === 'target_size')?.mode).toBe('auto');
  });

  it('a level change lifts the block too', async () => {
    await seed(env);
    await loadPage(env);
    await frictionOffer(env);
    await env.worker.offerAnswer(TAB, 'target_size', 'never_here', 'popup');
    await env.worker.setLevel(TAB, 'target_size', 2, 'site');
    const site = await env.stores.sites.get(DOMAIN);
    expect(site.state.ops.target_size?.block).toBeUndefined();
    expect(await kinds(env, 'target_size')).toContain('site_enable');
    expect(env.engine.changes.some((c) => c.op === 'target_size')).toBe(true);
    const next = await loadPage(env);
    expect(next.ops.find((p) => p.op === 'target_size')?.mode).toBe('auto');
  });
});

describe('the toast’s Undo all', () => {
  it('records every change as undone and sends nothing back', async () => {
    await seed(env, focusProfile());
    await loadPage(env);
    const before = (await env.worker.view(TAB)).changes
      .filter((c) => c.status === 'applied')
      .map((c) => c.op)
      .sort();
    expect(before.length).toBeGreaterThan(1);

    // The engine already put the page back before it said so.
    env.engine.changes = [];
    const sent = env.engine.received.length;
    await env.worker.undoAllOnPage(TAB, 0);
    expect(env.engine.received.slice(sent).map((m) => m.type)).not.toContain(
      'sw:undo',
    );
    expect(env.zoom.has(TAB)).toBe(false);
    const view = await env.worker.view(TAB);
    expect(view.changes.filter((c) => c.status === 'applied')).toEqual([]);
    expect([...view.undoneByYou].sort()).toEqual(before);

    env.clock.advance(REASON_WINDOW_MS);
    await env.worker.flushUndos();
    // A new page view: nothing undone is counted as kept.
    await env.worker.hello(TAB, 0, URL_A);
    const events = await env.stores.events.list();
    expect(
      events
        .filter((x) => x.kind === 'undo')
        .map((x) => x.op)
        .sort(),
    ).toEqual(before);
    expect(events.some((x) => x.kind === 'session_end' && x.kept)).toBe(false);
  });
});

describe('“I needed that”', () => {
  it('makes every region the dimming targeted an exception on this site', async () => {
    const profile = focusProfile();
    profile.attention.distraction = {
      mean: 1.5,
      sd: 0.1,
      confidence: 1,
      sources: ['behavior'],
    };
    await seed(env, profile);
    await env.stores.sites.update(DOMAIN, (s) => {
      s.rule.pins = ['dim_distractions'];
    });
    const promo = (key: string) =>
      makeRegion(key, {
        zone: 'right_rail',
        areaPct: 12,
        ruleRole: 'promo_ad',
        rulePrecision: 0.98,
        ruleId: 'ad-iframe',
      });
    const signals = articleSignals({}, [promo('k-ad'), promo('k-ad2')]);
    const plan = await loadPage(env, signals);
    const dim = plan.ops.find((p) => p.op === 'dim_distractions');
    expect(dim?.scope).toEqual({
      regions: expect.arrayContaining(['k-ad', 'k-ad2']),
    });

    await env.worker.undo(TAB, 'dim_distractions');
    await env.worker.undoReason(TAB, 'dim_distractions', 'needed_that');
    const undo = (await env.stores.events.list()).find(
      (x) => x.kind === 'undo' && x.op === 'dim_distractions',
    );
    expect(undo).toMatchObject({ reason: 'needed_that' });
    expect(['k-ad', 'k-ad2']).toContain(undo?.componentKey);
    const site = await env.stores.sites.get(DOMAIN);
    expect(site.state.exceptions).toEqual(
      expect.arrayContaining(['k-ad', 'k-ad2']),
    );

    const next = await loadPage(env, signals);
    const scope = next.ops.find((p) => p.op === 'dim_distractions')?.scope;
    const keys = scope && scope !== 'page' ? scope.regions : [];
    expect(keys).not.toContain('k-ad');
    expect(keys).not.toContain('k-ad2');
  });
});

describe('hello', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tells the layer to stay still, from the setting or the fit', async () => {
    const still = { ...focusProfile() };
    still.attention = { ...still.attention, systemReducedMotion: true };
    expect((await env.worker.hello(TAB, 0, URL_A)).reduceMotion).toBe(false);
    await env.stores.settings.update((s) => ({ ...s, reduceMotion: true }));
    expect((await env.worker.hello(TAB, 0, URL_A)).reduceMotion).toBe(true);
    // Sub-frames get the same answer.
    expect((await env.worker.hello(TAB, 2, URL_A)).reduceMotion).toBe(true);

    const e2 = setup();
    await seed(e2, still);
    expect((await e2.worker.hello(TAB, 0, URL_A)).reduceMotion).toBe(true);
  });

  it('reports the shortcuts Chrome has, and none without the API', async () => {
    expect((await env.worker.hello(TAB, 0, URL_A)).shortcuts).toEqual({
      focusLayer: '',
      undoAll: '',
    });
    vi.stubGlobal('chrome', {
      commands: {
        getAll: async () => [
          { name: 'focus-layer', shortcut: 'Alt+Shift+W' },
          { name: 'undo-all', shortcut: '' },
          { name: '_execute_action', shortcut: 'Alt+W' },
        ],
      },
    });
    await env.stores.settings.update((s) => ({ ...s, enabled: false }));
    const hello = await env.worker.hello(TAB, 0, URL_A);
    expect(hello.enabled).toBe(false);
    expect(hello.shortcuts).toEqual({
      focusLayer: 'Alt+Shift+W',
      undoAll: '',
    });
  });
});
