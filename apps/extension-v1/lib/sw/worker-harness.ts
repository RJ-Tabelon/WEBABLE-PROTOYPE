import { FIXTURE_NOW, workedExamplePage } from '@webable/core/policy/fixtures';
import type { PageSignals } from '@webable/core/page/types';
import type {
  AdaptationPlan,
  AppliedChange,
  PlannedOp,
} from '@webable/core/policy/types';
import type { FitProfile } from '@webable/core/profile/schema';

import type { WorkerToContent } from '../protocol';
import type { AccountRecord } from '../storage/account';
import { memoryArea, type KvArea } from '../storage/area';
import { createStores, type LocalStores } from '../storage';
import type { AuthService } from './auth';
import type { BadgeState } from './badge';
import type { ChromePort } from './chrome';
import { readConfig } from './config';
import { ComposeInflight, FitViewStates } from './fitview';
import { PageMemos } from './pages';
import { TabRegistry } from './tabs';
import { UndoHold } from './undo';
import { Worker, type Registration } from './worker';

/**
 * Test support for the worker's v2 paths (page scale, Fit view, planner):
 * production Worker, policy, triage, storage over in-memory areas, and fakes
 * for the engine and Chrome. Never bundled (only *.test.ts files import it).
 */

export const TAB = 11;
export const URL_A = 'https://news.example.com/story';
export const DOMAIN = 'example.com';

export const ACCOUNT: AccountRecord = {
  userId: 'u1',
  email: 'person@example.com',
  cloudAnalysis: false,
  aiLayout: true,
  productLearning: false,
  theme: 'system',
  onboardingStep: 'connected',
  needsReauth: false,
  connectedAt: 0,
  lastSyncAt: 0,
};

function appliedChange(p: PlannedOp): AppliedChange {
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

/** A scripted content script: applies plans (page_zoom is the worker's), records every message. */
export class FakeEngine {
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
          .map(appliedChange);
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

  of<T extends WorkerToContent['type']>(
    type: T,
  ): Array<Extract<WorkerToContent, { type: T }>> {
    return this.received.filter(
      (m): m is Extract<WorkerToContent, { type: T }> => m.type === type,
    );
  }
}

/**
 * Chrome's zoom as the worker drives it: per-tab factor and scope, and the
 * site's own (per-origin) factor a release returns to. A release keeps the
 * tab's factor for a site without one, as Chrome does, unless the worker
 * gives the person's own factor to go back to.
 */
export class FakeZoom {
  readonly origin = new Map<number, number>();
  readonly tab = new Map<number, number>();
  readonly scope = new Map<number, 'per-origin' | 'per-tab'>();
  readonly calls: Array<
    | { kind: 'set'; tabId: number; factor: number }
    | { kind: 'release'; tabId: number; factor?: number }
  > = [];

  factor(tabId: number): number {
    return (
      (this.scope.get(tabId) === 'per-tab' ? this.tab.get(tabId) : undefined) ??
      this.origin.get(tabId) ??
      1
    );
  }

  /** The person's own zoom on the site (what the tab shows per origin). */
  person(tabId: number, factor: number): void {
    this.origin.set(tabId, factor);
  }

  /** Chrome resets per-tab zoom on navigation. */
  navigate(tabId: number): void {
    this.scope.set(tabId, 'per-origin');
    this.tab.delete(tabId);
  }
}

export interface HarnessOptions {
  local?: KvArea;
  session?: KvArea;
  auth?: AuthService;
  fetch?: typeof fetch;
  /** Build environment (default: an e2e build pointed at the stub). */
  env?: Record<string, string>;
  font?: string | null;
  /** injectFitView answers false. */
  injectFails?: boolean;
  /** Width of the tab's content in DIP. */
  width?: number;
}

export function createHarness(opts: HarnessOptions = {}) {
  let now = FIXTURE_NOW;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  const local = opts.local ?? memoryArea();
  const session = opts.session ?? memoryArea();
  const stores = createStores(local, clock.now);
  const engine = new FakeEngine();
  const zoom = new FakeZoom();
  const badges = new Map<number, BadgeState>();
  const broadcasts: unknown[] = [];
  /** Order of the side effects Fit view tests care about. */
  const sequence: string[] = [];
  const port: ChromePort = {
    async sendToTab(_tabId, msg) {
      return engine.handle(msg as WorkerToContent) as never;
    },
    async setBadge(tabId, state) {
      badges.set(tabId, state);
    },
    async getZoom(tabId) {
      return zoom.factor(tabId);
    },
    async setZoom(tabId, factor) {
      zoom.calls.push({ kind: 'set', tabId, factor });
      zoom.scope.set(tabId, 'per-tab');
      zoom.tab.set(tabId, factor);
    },
    async releaseZoom(tabId, factor, own) {
      zoom.calls.push({
        kind: 'release',
        tabId,
        ...(factor !== undefined ? { factor } : {}),
      });
      // Leaving per-tab scope, Chrome writes the tab's factor for a site
      // with no zoom of its own; the port puts the person's own back first.
      if (zoom.scope.get(tabId) === 'per-tab' && !zoom.origin.has(tabId))
        zoom.origin.set(
          tabId,
          factor ?? own ?? (zoom.tab.get(tabId) as number),
        );
      zoom.scope.set(tabId, 'per-origin');
      zoom.tab.delete(tabId);
      if (factor !== undefined) zoom.origin.set(tabId, factor);
    },
    async tabWidth() {
      return opts.width ?? 1280;
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
  const registration: Registration = {
    async hasAllSites() {
      return true;
    },
    async reconcile() {},
    async inject() {
      return true;
    },
    async injectFitView(tabId) {
      await new Promise((r) => setTimeout(r, 1));
      if (opts.injectFails) return false;
      sequence.push(`inject:${tabId}`);
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
      ...opts.env,
    } as unknown as ImportMetaEnv),
    stores,
    tabs: new TabRegistry(session),
    pages: new PageMemos(session),
    undos: new UndoHold(session),
    fitViews: new FitViewStates(session),
    inflight: new ComposeInflight(session, clock.now),
    port,
    registration,
    auth: opts.auth ?? null,
    sync: null,
    now: clock.now,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    font: () => (opts.font === undefined ? 'd09GMgAB' : opts.font),
  });
  return {
    worker,
    stores,
    engine,
    zoom,
    badges,
    broadcasts,
    sequence,
    clock,
    local,
    session,
  };
}

export type Harness = ReturnType<typeof createHarness>;

export async function seedProfile(
  stores: LocalStores,
  profile: FitProfile,
): Promise<void> {
  await stores.profile.write({
    profile,
    source: 'account',
    version: 1,
    fetchedAt: 0,
  });
}

/** hello, signals, apply and report: what the content script does on a page load. */
export async function loadPage(
  h: Harness,
  signals: PageSignals,
  url = URL_A,
): Promise<{
  plan: AdaptationPlan;
  announce: boolean;
  fitViewOffer?: boolean;
  fitViewAuto?: boolean;
}> {
  const hello = await h.worker.hello(TAB, 0, url);
  if (!hello.enabled) throw new Error('WebAble is not enabled on this page');
  const reply = await h.worker.signals(
    TAB,
    0,
    signals,
    { page: workedExamplePage(), regions: {} },
    url,
  );
  const applied = h.engine.handle({
    type: 'sw:plan',
    plan: reply.plan,
    reason: 'settings',
  }) as { changes: AppliedChange[] };
  await h.worker.applied(TAB, 0, applied.changes);
  return reply;
}

/** Poll until a condition holds (for fire-and-forget work such as the planner). */
export async function until(
  check: () => boolean | Promise<boolean>,
  tries = 200,
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out');
}
