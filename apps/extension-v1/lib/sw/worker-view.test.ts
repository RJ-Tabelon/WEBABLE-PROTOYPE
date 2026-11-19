// @vitest-environment node
import {
  articleSignals,
  FIXTURE_NOW,
  strongReaderProfile,
  workedExamplePage,
} from '@webable/core/policy/fixtures';
import type { AppliedChange, PlannedOp } from '@webable/core/policy/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerToContent } from '../protocol';
import { memoryArea } from '../storage/area';
import { createStores, type LocalStores } from '../storage';
import { listLocalSites, resetRule, SiteStore } from '../storage/sites';
import type { ChromePort } from './chrome';
import { readConfig } from './config';
import { ComposeInflight, FitViewStates } from './fitview';
import { PageMemos } from './pages';
import { TabRegistry } from './tabs';
import { REASON_WINDOW_MS, UndoHold } from './undo';
import { RESTORE_WAIT_MS, Worker, type Registration } from './worker';

/**
 * The popup's view contract, the bridge's site-rule paths, and back/forward
 * restores, against a scripted engine and a recording Chrome.
 */

const TAB = 7;
const URL_A = 'https://news.example.com/story';
const URL_B = 'https://shop.example.org/cart';

function applied(p: PlannedOp): AppliedChange {
  return {
    op: p.op,
    level: p.level,
    mode: p.mode,
    status: 'applied',
    count: 2,
    fit: { before: '13 px', after: '21 px' },
    trace: p.trace,
  };
}

class FakeEngine {
  changes: AppliedChange[] = [];
  readonly received: WorkerToContent[] = [];
  /** An engine runs in the tab's document (answers sw:* messages). */
  alive = true;

  handle(msg: WorkerToContent): unknown {
    if (!this.alive) return undefined;
    this.received.push(msg);
    switch (msg.type) {
      case 'sw:plan':
        this.changes = msg.plan.ops
          .filter((p) => p.op !== 'page_zoom' && p.mode === 'auto')
          .map(applied);
        return { changes: this.changes };
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

  types(): string[] {
    return this.received.map((m) => m.type);
  }
}

function setup() {
  let now = FIXTURE_NOW;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  const stores = createStores(memoryArea(), clock.now);
  const engine = new FakeEngine();
  const injected: number[] = [];
  let url = URL_A;
  const port: ChromePort = {
    async sendToTab(_tabId, msg) {
      return engine.handle(msg as WorkerToContent) as never;
    },
    async setBadge() {},
    async getZoom() {
      return 1;
    },
    async setZoom() {},
    async releaseZoom() {},
    async tabWidth() {
      return 1280;
    },
    async tabUrl() {
      return url;
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
    config: readConfig({ MODE: 'e2e' } as unknown as ImportMetaEnv),
    stores,
    tabs: new TabRegistry(memoryArea()),
    pages: new PageMemos(memoryArea()),
    undos: new UndoHold(memoryArea()),
    fitViews: new FitViewStates(memoryArea()),
    inflight: new ComposeInflight(memoryArea(), clock.now),
    port,
    registration,
    auth: null,
    sync: null,
    now: clock.now,
  });
  const setUrl = (next: string) => {
    url = next;
  };
  return { worker, stores, engine, injected, clock, setUrl };
}

type Env = ReturnType<typeof setup>;

async function seedProfile(stores: LocalStores) {
  await stores.profile.write({
    profile: strongReaderProfile(),
    source: 'account',
    version: 1,
    fetchedAt: 0,
  });
}

async function loadPage(e: Env, url = URL_A): Promise<void> {
  await e.worker.hello(TAB, 0, url);
  const reply = await e.worker.signals(TAB, 0, articleSignals(), {
    page: workedExamplePage(),
    regions: {},
  });
  const { changes } = e.engine.handle({
    type: 'sw:plan',
    plan: reply.plan,
    reason: 'settings',
  }) as { changes: AppliedChange[] };
  await e.worker.applied(TAB, 0, changes);
}

/** Pin text on the loaded page and return the engine's change for it. */
async function someApplied(e: Env): Promise<AppliedChange> {
  await e.worker.setLevel(TAB, 'text_floor', 3, 'site');
  const c = e.engine.changes.find((x) => x.op === 'text_floor');
  if (!c) throw new Error('nothing applied');
  return c;
}

let env: Env;
beforeEach(() => {
  env = setup();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('popup view contract', () => {
  it('shows first run until the fit is calibrated, signed in or not', async () => {
    await env.stores.account.write({
      userId: 'u1',
      email: 'a@b.co',
      cloudAnalysis: false,
      aiLayout: false,
      productLearning: false,
      theme: 'system',
      onboardingStep: 'connected',
      needsReauth: false,
      connectedAt: FIXTURE_NOW,
      lastSyncAt: FIXTURE_NOW - 60_000,
    });
    await loadPage(env);
    const first = await env.worker.view(TAB);
    expect(first.status).toBe('first_run');
    expect(first.lastSyncAt).toBe(FIXTURE_NOW - 60_000);

    await seedProfile(env.stores);
    await loadPage(env);
    expect((await env.worker.view(TAB)).status).not.toBe('first_run');
  });

  it('reports no sync time before the first sync', async () => {
    await loadPage(env);
    expect((await env.worker.view(TAB)).lastSyncAt).toBeNull();
  });

  it('lists pinned quick switches whose change the checks undid', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    const { trace } = await someApplied(env);
    await env.worker.quick(TAB, 'text', true);
    env.engine.changes = [
      {
        op: 'text_floor',
        level: 2,
        mode: 'auto',
        status: 'undone_by_checks',
        count: 0,
        trace,
      },
    ];
    await env.worker.applied(TAB, 0, env.engine.changes);
    const view = await env.worker.view(TAB);
    expect(view.quick.text).toBe(true);
    expect(view.quickUndone).toEqual(['text']);
  });

  it('remembers Show on page until the next page view', async () => {
    await loadPage(env);
    expect(await env.worker.showOnPage(TAB, null, true)).toEqual({ ok: true });
    expect((await env.worker.view(TAB)).showing).toBe(true);
    env.clock.advance(5_000);
    await env.worker.navigated(TAB, URL_B, env.clock.now(), ['link']);
    expect(
      (await env.worker.detail((await env.worker.tabRecord(TAB))!)).showing,
    ).toBe(false);
  });

  it('hides the all-sites line when asked, and keeps it in settings', async () => {
    await loadPage(env);
    expect((await env.worker.view(TAB)).allSitesAskHidden).toBe(false);
    await env.worker.setPrefs({ hideAllSitesAsk: true });
    expect((await env.worker.view(TAB)).allSitesAskHidden).toBe(true);
    expect((await env.stores.settings.read()).hideAllSitesAsk).toBe(true);
  });

  it('shows "every site" levels and clears them, re-planning open pages', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    await env.worker.setLevel(TAB, 'line_spacing', 2, 'everywhere');
    expect((await env.worker.view(TAB)).globalOverrides).toEqual({
      line_spacing: 2,
    });
    const before = env.engine.received.length;
    await env.worker.clearEverywhere();
    expect((await env.stores.settings.read()).globalLevels).toEqual({});
    expect((await env.worker.view(TAB)).globalOverrides).toEqual({});
    expect(
      env.engine.received
        .slice(before)
        .some((m) => m.type === 'sw:plan' && m.reason === 'settings'),
    ).toBe(true);
  });
});

describe('redo', () => {
  it('drops an undo still held for its reason window', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    const { op } = await someApplied(env);
    await env.worker.undo(TAB, op);
    expect((await env.worker.view(TAB)).undoneByYou).toContain(op);
    await env.worker.redo(TAB, op);
    const view = await env.worker.view(TAB);
    expect(view.undoneByYou).not.toContain(op);
    expect(
      view.changes.some((c) => c.op === op && c.status === 'applied'),
    ).toBe(true);
    env.clock.advance(REASON_WINDOW_MS + 1);
    await env.worker.flushUndos();
    const kinds = (await env.stores.events.list())
      .filter((e) => e.op === op)
      .map((e) => e.kind);
    expect(kinds).not.toContain('undo');
    expect(kinds).not.toContain('manual_on');
  });

  it('answers an undo already recorded with manual_on', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    const { op } = await someApplied(env);
    await env.worker.undo(TAB, op);
    env.clock.advance(REASON_WINDOW_MS + 1);
    await env.worker.flushUndos();
    await env.worker.redo(TAB, 'all');
    const kinds = (await env.stores.events.list())
      .filter((e) => e.op === op)
      .map((e) => e.kind);
    expect(kinds).toContain('undo');
    expect(kinds).toContain('manual_on');
    expect(env.engine.changes.some((c) => c.op === op)).toBe(true);
  });
});

describe('back/forward restores', () => {
  it('keeps the page view until a hello re-binds the tab', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    const session = (await env.worker.tabRecord(TAB))?.tabSession;
    env.clock.advance(5_000);
    await env.worker.navigated(TAB, URL_A, env.clock.now(), ['forward_back']);
    const waiting = await env.worker.tabRecord(TAB);
    expect(waiting?.tabSession).toBe(session);
    expect(waiting?.restoring).not.toBeNull();
    expect(
      (await env.stores.events.list()).some((e) => e.kind === 'session_end'),
    ).toBe(false);

    await env.worker.hello(TAB, 0, URL_A);
    const bound = await env.worker.tabRecord(TAB);
    expect(bound?.restoring).toBeNull();
    expect(bound?.tabSession).not.toBe(session);
    expect(
      (await env.stores.events.list()).some((e) => e.kind === 'session_end'),
    ).toBe(true);
  });

  it('ends the page view when no engine says hello in time', async () => {
    vi.useFakeTimers();
    await seedProfile(env.stores);
    await loadPage(env);
    env.clock.advance(5_000);
    env.setUrl(URL_B);
    await env.worker.navigated(TAB, URL_B, env.clock.now(), ['forward_back']);
    await vi.advanceTimersByTimeAsync(RESTORE_WAIT_MS + 10);
    const tab = await env.worker.tabRecord(TAB);
    expect(tab?.restoring).toBeNull();
    expect(tab?.tabSession).toBeNull();
    expect(tab?.domain).toBe('example.org');
  });

  it('never injects a second engine into a page whose engine answers', async () => {
    await env.worker.view(TAB);
    expect(env.injected).toEqual([]);
    const tab = await env.worker.tabRecord(TAB);
    expect(tab?.engine).toBe(true);
    expect(tab?.phase).toBe('checking');

    const other = setup();
    other.engine.alive = false;
    await other.worker.view(TAB);
    expect(other.injected).toEqual([TAB]);
  });

  it('adapts a tab after its site is granted', async () => {
    env.engine.alive = false;
    await env.worker.grantSite(TAB);
    expect(env.injected).toEqual([TAB]);
    expect((await env.worker.tabRecord(TAB))?.engine).toBe(true);
  });
});

describe('site rules from the web app', () => {
  it('pauses and resumes every open page on the site', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    await someApplied(env);
    await env.stores.sites.update('example.com', (s) => {
      s.rule.paused = true;
    });
    await env.worker.pauseDomain('example.com');
    expect(env.engine.types()).toContain('sw:pause');
    expect((await env.worker.tabRecord(TAB))?.changes).toEqual([]);

    await env.stores.sites.update('example.com', (s) => {
      s.rule.paused = false;
    });
    await env.worker.resumeDomain('example.com');
    expect(env.engine.types()).toContain('sw:resume');
    expect(env.engine.changes.length).toBeGreaterThan(0);
  });

  it('takes a blocked op off the site’s open pages', async () => {
    await seedProfile(env.stores);
    await loadPage(env);
    const { op } = await someApplied(env);
    await env.stores.sites.update('example.com', (s) => {
      s.rule.blocks = [...s.rule.blocks, op];
    });
    await env.worker.blockOnDomain('example.com', op);
    expect(
      env.engine.received.some((m) => m.type === 'sw:undo' && m.op === op),
    ).toBe(true);
    expect(env.engine.changes.some((c) => c.op === op)).toBe(false);
  });

  it('lists only sites with a rule, and a reset removes every rule', async () => {
    const sites = new SiteStore(memoryArea(), () => FIXTURE_NOW);
    await sites.update('visited.com', (s) => {
      s.lastVisit = FIXTURE_NOW;
    });
    await sites.update('levels.com', (s) => {
      s.rule.levels = { text_floor: 3 };
    });
    await sites.update('learned.com', (s) => {
      s.state.ops.contrast = { s: 0, f: 0, t: 0, block: true };
    });
    expect(
      listLocalSites(await sites.all())
        .map((s) => s.domain)
        .sort(),
    ).toEqual(['learned.com', 'levels.com']);
    for (const d of ['levels.com', 'learned.com'])
      await sites.update(d, (s) => resetRule(s, FIXTURE_NOW));
    expect(listLocalSites(await sites.all())).toEqual([]);
  });
});
