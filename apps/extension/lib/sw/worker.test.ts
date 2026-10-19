// @vitest-environment node
import type { OpId } from '@webable/core/ops/catalog';
import {
  articleSignals,
  evidence,
  FIXTURE_NOW,
  focusProfile,
  strongReaderProfile,
  workedExamplePage,
} from '@webable/core/policy/fixtures';
import { REGION_ROLES } from '@webable/core/page/types';
import { CATALOG_VERSION, JEV_PINNED_MODEL } from '@webable/core/versions';
import type {
  AdaptationPlan,
  AppliedChange,
  PlannedOp,
} from '@webable/core/policy/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerToContent } from '../protocol';
import { memoryArea, type KvArea } from '../storage/area';
import { createStores, type LocalStores } from '../storage';
import type { BadgeState } from './badge';
import type { AuthService } from './auth';
import type { ChromePort } from './chrome';
import { E2E_SUPABASE_ORIGIN, readConfig } from './config';
import { ComposeInflight, FitViewStates } from './fitview';
import { PageMemos } from './pages';
import { TabRegistry } from './tabs';
import { REASON_WINDOW_MS, UndoHold } from './undo';
import {
  OFFER_QUIET_MS,
  inPageOfferAllowed,
  Worker,
  type Registration,
} from './worker';

/**
 * The worker's orchestration against fakes: the engine is a scripted
 * content script, Chrome is a recorder. Everything else is production code
 * (policy, learners, storage over an in-memory area).
 */

const TAB = 11;
const URL_A = 'https://news.example.com/story';

function applied(p: PlannedOp): AppliedChange {
  return {
    op: p.op,
    level: p.level,
    mode: p.mode,
    status: 'applied',
    count: 3,
    fit:
      p.op === 'contrast'
        ? { before: '2.9:1', after: '4.5:1' }
        : { before: '13 px', after: '21 px' },
    trace: p.trace,
  };
}

const NO_ENGINE_TAB = 77;

class FakeEngine {
  /** What the page currently has applied. */
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
      case 'sw:pause':
        this.changes = [];
        return { ok: true };
      case 'sw:resume':
        return { changes: this.changes };
      case 'sw:get-changes':
        return { changes: this.changes, status: 'ready' };
      default:
        return { ok: true };
    }
  }
}

interface SetupOptions {
  auth?: AuthService;
  fetch?: typeof fetch;
  localArea?: KvArea;
}

function fakeAuth(overrides: Partial<AuthService> = {}): AuthService {
  return {
    client: {} as AuthService['client'],
    async accessToken() {
      return 'jwt';
    },
    async session() {
      return { access_token: 'jwt' } as Awaited<
        ReturnType<AuthService['session']>
      >;
    },
    async connect() {
      return { ok: false, code: 'auth_failed' };
    },
    async signOut() {},
    async refresh() {
      return 'ok';
    },
    async refreshNow() {
      return false;
    },
    onLost() {},
    ...overrides,
  };
}

function setup(opts: SetupOptions = {}) {
  let now = FIXTURE_NOW;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  const stores = createStores(opts.localArea ?? memoryArea(), clock.now);
  const engine = new FakeEngine();
  const zoom = new Map<number, number>();
  const badges = new Map<number, BadgeState>();
  const broadcasts: unknown[] = [];
  const port: ChromePort = {
    async sendToTab(tabId, msg) {
      // Tab 77 has no engine (a page opened before WebAble had access).
      if (tabId === NO_ENGINE_TAB) return undefined as never;
      return engine.handle(msg as WorkerToContent) as never;
    },
    async setBadge(tabId, state) {
      badges.set(tabId, state);
    },
    async getZoom(tabId) {
      return zoom.get(tabId) ?? 1;
    },
    async setZoom(tabId, factor) {
      zoom.set(tabId, factor);
    },
    async releaseZoom(tabId, factor) {
      if (factor === undefined) zoom.delete(tabId);
      else zoom.set(tabId, factor);
    },
    async tabWidth() {
      return 1280;
    },
    async tabUrl() {
      return URL_A;
    },
    async activeTabId() {
      return TAB;
    },
    async openTab() {},
    broadcast(msg) {
      broadcasts.push(msg);
    },
  };
  const injected: number[] = [];
  const registration: Registration = {
    async hasAllSites() {
      return true;
    },
    async reconcile() {},
    async inject(tabId) {
      injected.push(tabId);
      return true;
    },
    async injectFitView() {
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
    fitViews: new FitViewStates(memoryArea()),
    inflight: new ComposeInflight(memoryArea(), clock.now),
    port,
    registration,
    auth: opts.auth ?? null,
    sync: null,
    now: clock.now,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  return { worker, stores, engine, zoom, badges, broadcasts, clock, injected };
}

type Env = ReturnType<typeof setup>;

/** hello, signals, apply: what the content script does on a page load. */
async function loadPage(
  env: Env,
  signals = articleSignals(),
): Promise<{ plan: AdaptationPlan; announce: boolean }> {
  const hello = await env.worker.hello(TAB, 0, URL_A);
  expect(hello.enabled).toBe(true);
  const reply = await env.worker.signals(TAB, 0, signals, {
    page: workedExamplePage(),
    regions: {},
  });
  const changes = env.engine.handle({
    type: 'sw:plan',
    plan: reply.plan,
    reason: 'settings',
  }) as {
    changes: AppliedChange[];
  };
  await env.worker.applied(TAB, 0, changes.changes);
  return reply;
}

async function seedProfile(stores: LocalStores) {
  await stores.profile.write({
    profile: strongReaderProfile(),
    source: 'account',
    version: 1,
    fetchedAt: 0,
  });
}

let env: Env;
beforeEach(() => {
  env = setup();
});

it('an engine upgrade clears old verifier suppression while preserving saved user decisions', async () => {
  await seedProfile(env.stores);
  const day = Math.floor(env.clock.now() / 86_400_000);
  await env.stores.sites.update('example.com', (s) => {
    Object.assign(s, { engineVersion: 'engine-1.0.0' });
    s.rule.blocks = ['target_size'];
    s.rule.pins = ['text_floor'];
    s.state.ops.text_floor = {
      s: 2,
      f: 1,
      t: day,
      e: { s: 0, f: 10, t: day },
      engineUntil: day + 7,
      skipUntil: day + 7,
    };
    s.state.ops.line_spacing = { s: 1, f: 2, t: day, skipUntil: day + 9 };
    s.state.ops.contrast = {
      s: 0,
      f: 0,
      t: day,
      sessionOff: 'a-previous-page',
    };
  });
  const { plan } = await loadPage(env);
  expect(plan.ops.find((p) => p.op === 'text_floor')?.mode).toBe('auto');
  const site = await env.stores.sites.get('example.com');
  expect(site.state.ops.text_floor?.engineUntil).toBeUndefined();
  expect(site.state.ops.text_floor?.skipUntil).toBeUndefined();
  expect(site.state.ops.line_spacing?.skipUntil).toBe(day + 9);
  expect(site.rule.pins).toContain('text_floor');
  expect(site.rule.blocks).toEqual(
    expect.arrayContaining(['target_size', 'contrast']),
  );
  expect(
    plan.ops.some((p) => p.op === 'target_size' || p.op === 'contrast'),
  ).toBe(false);
});

describe('a page load', () => {
  it('upgrades existing saved fits without resetting feedback, blocks or learned levels', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    const before = await env.stores.learning.update((record) => {
      record.user!.ops.text_floor.src = 'none';
      record.user!.ops.text_floor.blocked = true;
      record.user!.ops.text_floor.c.f = 3;
      return record;
    });
    await env.worker.profileChanged();
    const after = await env.stores.learning.read();
    expect(after.user!.ops.text_floor).toEqual({
      ...before.user!.ops.text_floor,
      src: 'profile',
    });
    expect(after.user!.dims).toEqual(before.user!.dims);
    expect(after.seededFor).toBe(before.seededFor);
  });

  it('records the first interaction only for the current top-frame session', async () => {
    const hello = await env.worker.hello(TAB, 0, URL_A);
    await env.worker.interacted(TAB, 1, hello.tabSession);
    await env.worker.interacted(TAB, 0, 'previous-session');
    expect((await env.worker.tabRecord(TAB))?.interactedAt).toBeNull();
    await env.worker.interacted(TAB, 0, hello.tabSession);
    env.clock.advance(100);
    await env.worker.interacted(TAB, 0, hello.tabSession);
    expect((await env.worker.tabRecord(TAB))?.interactedAt).toBe(FIXTURE_NOW);
  });

  it('applies an ordinary saved minimum and replans tabs already open when the fit changes', async () => {
    await loadPage(env);
    const profile = strongReaderProfile();
    profile.vision.textMinPx.value = 16;
    profile.motor.minTargetPx.value = 32;
    await env.stores.profile.write({
      profile,
      source: 'account',
      version: 1,
      fetchedAt: 0,
    });
    await env.worker.profileChanged();
    const plan = env.engine.received.filter((m) => m.type === 'sw:plan').at(-1);
    expect(plan?.type === 'sw:plan' && plan.reason).toBe('settings');
    expect(
      plan?.type === 'sw:plan' &&
        plan.plan.ops.find((op) => op.op === 'text_floor'),
    ).toMatchObject({ mode: 'auto' });
    expect(env.engine.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'text_floor', status: 'applied' }),
      ]),
    );
  });

  it('persists the extraction identity across service-worker restarts', async () => {
    const area = memoryArea();
    const memo = {
      id: 'extraction-1',
      tabSession: 'view-1',
      signals: articleSignals(),
      evidence: { page: workedExamplePage(), regions: {} },
      answers: { regions: new Map() },
      cacheKeys: { site: 'site', region: {} },
    };
    await new PageMemos(area).set(TAB, memo);
    expect(await new PageMemos(area).get(TAB, 'view-1')).toEqual(memo);
    expect(await new PageMemos(area).get(TAB, 'view-2')).toBeNull();
  });

  it('answers hello with the pre-paint ops and a random page-view id', async () => {
    const a = await env.worker.hello(TAB, 0, URL_A);
    const b = await env.worker.hello(TAB, 0, URL_A);
    expect(a.enabled).toBe(true);
    expect(a.paused).toBe(false);
    expect(a.tabSession).not.toBe(b.tabSession);
    expect(a.tabSession).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('keeps sub-frames out (their changes could not be listed or undone from the popup)', async () => {
    expect((await env.worker.hello(TAB, 3, URL_A)).enabled).toBe(false);
  });

  it('never runs on Chrome’s own pages', async () => {
    const hello = await env.worker.hello(TAB, 0, 'chrome://settings');
    expect(hello.enabled).toBe(false);
  });

  it('plans from the fit, never zooms the tab, and lists every change', async () => {
    await seedProfile(env.stores);
    const { plan, announce } = await loadPage(env);
    expect(announce).toBe(true);
    // Small text gets a text floor; the tab's zoom is never touched.
    expect(plan.ops.find((p) => p.op === 'text_floor')?.mode).toBe('auto');
    expect(plan.ops.some((p) => p.op === 'page_zoom')).toBe(false);
    expect(env.zoom.has(TAB)).toBe(false);

    const view = await env.worker.view(TAB);
    expect(view.status).toBe('adapted');
    expect(view.domain).toBe('example.com');
    expect(view.changes.some((c) => c.op === 'text_floor')).toBe(true);
    const count = view.changes.filter((c) => c.status === 'applied').length;
    expect(env.badges.get(TAB)).toMatchObject({
      text: String(count),
      icon: 'ink',
    });
    // The first-time toast is shown once per site.
    await env.worker.hello(TAB, 0, URL_A);
    const again = await env.worker.signals(TAB, 0, articleSignals(), {
      page: workedExamplePage(),
      regions: {},
    });
    expect(again.announce).toBe(false);
  });

  it('counts the tab’s own zoom in the signals, not WebAble’s', async () => {
    await seedProfile(env.stores);
    env.zoom.set(TAB, 1.5);
    const { plan } = await loadPage(env);
    // Already zoomed to 150% by the person: WebAble adds no zoom.
    expect(
      plan.ops.some((p) => p.op === 'page_zoom' && p.mode === 'auto'),
    ).toBe(false);
    expect(env.zoom.get(TAB)).toBe(1.5);
  });

  it('records applied and verifier events locally, with the domain only on this device', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    const events = await env.stores.events.list();
    expect(
      events.some((e) => e.kind === 'applied' && e.op === 'text_floor'),
    ).toBe(true);
    expect(events.every((e) => e.domain === 'example.com')).toBe(true);
    const learning = await env.stores.learning.read();
    // Deltas for sync carry no domain.
    expect(JSON.stringify(learning.pending)).not.toContain('example.com');
  });
});

describe('undo', () => {
  it('a new explicit fit cancels a pending Undo so the reason timer cannot switch it off again', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    await env.worker.undo(TAB, 'text_floor');
    await env.worker.setLevel(TAB, 'text_floor', 1, 'site');
    env.clock.advance(REASON_WINDOW_MS + 100);
    await env.worker.flushUndos();
    const { plan } = await loadPage(env);
    expect(plan.ops.find((p) => p.op === 'text_floor')).toMatchObject({
      level: 1,
      mode: 'auto',
    });
    expect(
      (await env.stores.sites.get('example.com')).rule.blocks,
    ).not.toContain('text_floor');
  });

  it('keeps saved Undo after all session state is lost, using only local storage', async () => {
    const localArea = memoryArea();
    const first = setup({ localArea });
    await seedProfile(first.stores);
    await loadPage(first);
    await first.worker.undo(TAB, 'text_floor');
    const restarted = setup({ localArea });
    const { plan } = await loadPage(restarted);
    expect(plan.ops.some((p) => p.op === 'text_floor')).toBe(false);
    expect((await restarted.worker.view(TAB)).undoneByYou).toContain(
      'text_floor',
    );
    await restarted.worker.redo(TAB, 'text_floor');
    expect(restarted.engine.changes.some((c) => c.op === 'text_floor')).toBe(
      true,
    );
  });

  it('saves Undo immediately for the site, survives reload without a reason, and explicit Redo restores it', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    await env.worker.setLevel(TAB, 'text_floor', 3, 'site');
    env.clock.advance(60_000); // A deliberate late Undo must also stick.
    await env.worker.undo(TAB, 'text_floor');
    expect((await env.stores.sites.get('example.com')).rule.blocks).toContain(
      'text_floor',
    );
    const { plan } = await loadPage(env);
    expect(plan.ops.some((p) => p.op === 'text_floor')).toBe(false);
    expect((await env.worker.view(TAB)).undoneByYou).toContain('text_floor');
    await env.worker.redo(TAB, 'text_floor');
    expect(
      (await env.stores.sites.get('example.com')).rule.blocks,
    ).not.toContain('text_floor');
    expect(env.engine.changes.some((c) => c.op === 'text_floor')).toBe(true);
  });

  it('restores the page at once and holds the learning event for the reason window', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    await env.worker.setLevel(TAB, 'text_floor', 3, 'site');
    const before = await env.worker.view(TAB);
    const target = before.changes.find(
      (c) => c.status === 'applied' && c.op !== 'page_zoom',
    );
    expect(target, 'an engine change to undo').toBeDefined();
    const op = target!.op;

    await env.worker.undo(TAB, op);
    expect(env.engine.changes.some((c) => c.op === op)).toBe(false);
    const view = await env.worker.view(TAB);
    expect(
      view.changes.some((c) => c.op === op && c.status === 'applied'),
    ).toBe(false);
    expect(view.undoneByYou).toContain(op);
    expect(view.reasonOpen.map((r) => r.op)).toContain(op);
    // Marked off for this page view immediately: a re-plan cannot bring it back.
    const site = await env.stores.sites.get('example.com');
    expect(site.state.ops[op]?.sessionOff).toBeDefined();
    expect(
      (await env.stores.events.list()).some((e) => e.kind === 'undo'),
    ).toBe(false);

    await env.worker.undoReason(TAB, op, 'too_much');
    const undo = (await env.stores.events.list()).filter(
      (e) => e.kind === 'undo',
    );
    expect(undo).toHaveLength(1);
    expect(undo[0]).toMatchObject({ op, reason: 'too_much' });
  });

  it('applies the undo without a reason once the window ends', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    const targets = (await env.worker.view(TAB)).changes.filter(
      (c) => c.status === 'applied',
    );
    expect(targets.length).toBeGreaterThan(0);
    await env.worker.undo(TAB, 'all');
    expect(env.zoom.has(TAB)).toBe(false);
    expect(env.engine.changes).toEqual([]);
    expect(
      (await env.stores.events.list()).some((e) => e.kind === 'undo'),
    ).toBe(false);
    env.clock.advance(REASON_WINDOW_MS);
    await env.worker.flushUndos();
    const undo = (await env.stores.events.list()).filter(
      (e) => e.kind === 'undo',
    );
    expect(undo.map((e) => e.op).sort()).toEqual(
      targets.map((c) => c.op).sort(),
    );
    expect(undo.every((e) => e.reason === undefined)).toBe(true);
    expect((await env.worker.view(TAB)).status).toBe('nothing_to_change');
  });

  it('flushes held undos before the next page view starts', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    await env.worker.undo(TAB, 'text_floor');
    expect(
      (await env.stores.events.list()).some((e) => e.kind === 'undo'),
    ).toBe(false);
    await env.worker.hello(TAB, 0, URL_A);
    const kinds = (await env.stores.events.list()).map((e) => e.kind);
    expect(kinds).toContain('undo');
  });
});

describe('pause and off', () => {
  it('pauses a site: the page is restored, the badge greys, and the rule is kept', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    await env.worker.pauseSite(TAB, true);
    expect(env.engine.changes).toEqual([]);
    expect(env.zoom.has(TAB)).toBe(false);
    const view = await env.worker.view(TAB);
    expect(view.status).toBe('paused');
    expect(env.badges.get(TAB)).toMatchObject({ icon: 'paused', text: '' });
    const hello = await env.worker.hello(TAB, 0, URL_A);
    expect(hello.paused).toBe(true);
  });

  it('turns WebAble off everywhere and back on', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    await env.worker.setEnabled(false);
    expect((await env.worker.view(TAB)).status).toBe('off');
    expect((await env.worker.hello(TAB, 0, URL_A)).enabled).toBe(false);
    await env.worker.setEnabled(true);
    expect((await env.worker.hello(TAB, 0, URL_A)).enabled).toBe(true);
  });
});

describe('offers', () => {
  it('never shows an in-page offer in the first 10 s, or mid-scroll', () => {
    expect(inPageOfferAllowed('misclick_burst', 0, OFFER_QUIET_MS - 1)).toBe(
      false,
    );
    expect(inPageOfferAllowed('misclick_burst', 0, OFFER_QUIET_MS)).toBe(true);
    expect(inPageOfferAllowed('scroll_reversal', 0, OFFER_QUIET_MS * 3)).toBe(
      false,
    );
  });

  it('asks once per page view, and "Try it" applies exactly that op', async () => {
    await seedProfile(env.stores);
    const { plan } = await loadPage(env);
    const offered = plan.ops.find((p) => p.mode === 'offer');
    expect(offered, 'the fixture page has an offer').toBeDefined();
    const op = offered!.op as OpId;

    const view = await env.worker.view(TAB);
    expect(view.offer?.op).toBe(op);
    await env.worker.markOfferShown(TAB);
    await env.worker.offerAnswer(TAB, op, 'accept', 'popup');
    expect(env.engine.changes.some((c) => c.op === op)).toBe(true);
    const after = await env.worker.view(TAB);
    expect(after.offer).toBeNull();
    const kinds = (await env.stores.events.list())
      .filter((e) => e.op === op)
      .map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['offered', 'offer_accepted']),
    );
    expect((await env.stores.offers.read()).count).toBe(1);
  });

  it('"Don’t suggest this here" blocks the op on this site', async () => {
    await seedProfile(env.stores);
    const { plan } = await loadPage(env);
    const op = plan.ops.find((p) => p.mode === 'offer')!.op;
    await env.worker.offerAnswer(TAB, op, 'never_here', 'popup');
    expect((await env.stores.sites.get('example.com')).rule.blocks).toContain(
      op,
    );
  });
});

describe('settings from the popup', () => {
  it('a text size for this site pins the op and re-plans the page', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    await env.worker.setLevel(TAB, 'text_floor', 3, 'site');
    const site = await env.stores.sites.get('example.com');
    expect(site.rule.levels.text_floor).toBe(3);
    expect(site.rule.pins).toContain('text_floor');
    const last = env.engine.received.filter((m) => m.type === 'sw:plan').at(-1);
    expect(last).toMatchObject({ type: 'sw:plan', reason: 'settings' });
    expect(env.engine.changes.find((c) => c.op === 'text_floor')?.level).toBe(
      3,
    );
    expect(env.zoom.has(TAB)).toBe(false);
  });

  it('opening the popup on a page without the engine starts it there (activeTab)', async () => {
    const view = await env.worker.view(NO_ENGINE_TAB);
    expect(env.injected).toContain(NO_ENGINE_TAB);
    expect(view.status).toBe('checking');
  });
});

describe('local data', () => {
  it('seeds and resets only in e2e builds', async () => {
    expect((await env.worker.e2eSeed({ profile: { v: 99 } })).ok).toBe(false);
    expect(
      (
        await env.worker.e2eSeed({
          profile: strongReaderProfile(),
          reset: true,
        })
      ).ok,
    ).toBe(true);
    expect((await env.stores.profile.read())?.source).toBe('account');
  });
});

describe('page analysis', () => {
  const ACCOUNT = {
    userId: 'u1',
    email: 'person@example.com',
    cloudAnalysis: true,
    aiLayout: false,
    productLearning: false,
    theme: 'system' as const,
    onboardingStep: 'connected' as const,
    needsReauth: false,
    connectedAt: 0,
    lastSyncAt: 0,
  };
  const role = (top: (typeof REGION_ROLES)[number]) =>
    Object.fromEntries(
      REGION_ROLES.map((r) => [r, r === top ? 0.91 : 0.01]),
    ) as Record<string, number>;
  const okBody = {
    v: 1,
    ok: true,
    catalog: CATALOG_VERSION,
    model: JEV_PINNED_MODEL,
    regions: { r0: { role: role('promo_ad'), task: 0.04 } },
    inputTokens: 700,
    ms: { jev: 90, edge: 15 },
  };
  const EVIDENCE = {
    page: workedExamplePage(),
    regions: { 'k-rail': evidence() },
  };

  async function until(check: () => Promise<boolean>): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('timed out');
  }

  async function analysedLoad(e: Env) {
    await e.worker.hello(TAB, 0, URL_A);
    const reply = await e.worker.signals(TAB, 0, articleSignals(), EVIDENCE);
    e.engine.handle({ type: 'sw:plan', plan: reply.plan, reason: 'settings' });
    return reply;
  }

  it('sends structure only, records the exact body, caches answers by component, and refines', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(okBody), { status: 200 }),
    );
    const e = setup({
      auth: fakeAuth(),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await e.stores.profile.write({
      profile: focusProfile(),
      source: 'account',
      version: 1,
      fetchedAt: 0,
    });
    await e.stores.account.write(ACCOUNT);
    await analysedLoad(e);
    await until(async () => (await e.stores.answers.size()) > 0);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${E2E_SUPABASE_ORIGIN}/functions/v1/decide`);
    const [receipt] = await e.stores.receipts.list();
    expect(receipt).toMatchObject({
      destination: 'page_analysis',
      domain: 'example.com',
    });
    // The receipt is exactly what left the device, and it carries no site, URL or profile.
    expect(JSON.stringify(receipt!.body)).toBe(init.body);
    expect(String(init.body)).not.toMatch(
      /example\.com|https?:|k-rail|textMinPx/,
    );

    const view = await e.worker.view(TAB);
    expect(view.lastSentAt).toBe(receipt!.at);

    // The same page structure again: answered from the cache, nothing sent.
    await analysedLoad(e);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await e.worker.view(TAB)).analyzed).toBe(true);
  });

  it('sends nothing without consent, and stops when the server says consent is off', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'consent_required' } }), {
          status: 403,
        }),
    );
    const e = setup({
      auth: fakeAuth(),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await e.stores.profile.write({
      profile: focusProfile(),
      source: 'account',
      version: 1,
      fetchedAt: 0,
    });
    await e.stores.account.write({ ...ACCOUNT, cloudAnalysis: false });
    await analysedLoad(e);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetch).not.toHaveBeenCalled();
    expect(await e.stores.receipts.list()).toEqual([]);

    await e.stores.account.write(ACCOUNT);
    await analysedLoad(e);
    await until(
      async () => (await e.stores.account.read())?.cloudAnalysis === false,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks for a new sign-in when the server rejects the session and it cannot be refreshed', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 401 }));
    const e = setup({
      auth: fakeAuth(),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await e.stores.profile.write({
      profile: focusProfile(),
      source: 'account',
      version: 1,
      fetchedAt: 0,
    });
    await e.stores.account.write(ACCOUNT);
    await analysedLoad(e);
    await until(
      async () => (await e.stores.account.read())?.needsReauth === true,
    );
    expect(e.badges.get(TAB)).toMatchObject({ text: '!' });
  });

  it('opens the breaker after repeated failures, falling back to local rules', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const e = setup({
      auth: fakeAuth(),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await e.stores.profile.write({
      profile: focusProfile(),
      source: 'account',
      version: 1,
      fetchedAt: 0,
    });
    await e.stores.account.write(ACCOUNT);
    for (let i = 0; i < 4; i++) {
      const reply = await analysedLoad(e);
      expect(reply.plan.basis).toBe('local');
      await new Promise((r) => setTimeout(r, 20));
    }
    // Three failures open the breaker: the fourth page view sends nothing.
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
