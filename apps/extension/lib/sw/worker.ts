import { levelValue, toDay } from '@webable/core/learning/learners';
import { FRICTION_LR, K } from '@webable/core/learning/params';
import type { SiteRule, UserLearningState } from '@webable/core/learning/types';
import { OP_CATALOG, type OpId } from '@webable/core/ops/catalog';
import type { PageSignals } from '@webable/core/page/types';
import { buildPlan, type PolicyInput } from '@webable/core/policy/decide';
import type {
  AdaptationPlan,
  AnalysisLabel,
  AppliedChange,
  PlannedOp,
  RegionVerdict,
} from '@webable/core/policy/types';
import { fitProfileSchema } from '@webable/core/profile/schema';
import type { SystemSignals } from '@webable/core/profile/defaults';

import type { ContentReplies, HelloReply, PageEvidence } from '../protocol';
import { normalizeAccount, type AccountRecord } from '../storage/account';
import { offersToday } from '../storage/activity';
import { randomId } from '../storage/crypto';
import type { LocalStores } from '../storage';
import type { SiteRecord } from '../storage/sites';
import type { Settings } from '../storage/settings';
import { JsonStore } from '../storage/store';
import {
  analysisView,
  buildDecideRequest,
  cacheEntries,
  callDecide,
  keyAnswers,
  type AnalysisView,
  type DecideOutcome,
  type KeyedAnswers,
} from './analysis';
import type { AuthService } from './auth';
import { badgeFor } from './badge';
import {
  breakerFailure,
  breakerOpen,
  breakerSuccess,
  normalizeBreaker,
  type BreakerState,
} from './breaker';
import {
  pageAnswerKey,
  pageSignature,
  regionAnswerKey,
  siteKey,
} from './cachekeys';
import type { ChromePort } from './chrome';
import type { SwConfig } from './config';
import {
  applyRefinement,
  diffRefinement,
  HARD_TIMEOUT_MS,
  refinementMode,
} from './deadline';
import { classifyUrl } from './domain';
import { analysisConsumers, gate } from './gating';
import { stabilizeLevels } from './levels';
import { PageMemos, type PageMemo } from './pages';
import {
  ensureLearning,
  loadProfile,
  noteSystemSignals,
  recordEvents,
  type EventInput,
  type ProfileContext,
} from './profile';
import type { AccountSync } from './sync';
import {
  appliedChanges,
  freshTab,
  popupStatus,
  undoneByChecks,
  type TabRecord,
  TabRegistry,
} from './tabs';
import type { Prefs, TabDetail, WelcomeState } from './ui';
import { UndoHold, type UndoReason } from './undo';
import { KEYS } from '../storage/keys';

/** Site-access and registration operations (lib/sw/permissions.ts in production). */
export interface Registration {
  hasAllSites(): Promise<boolean>;
  reconcile(
    prePaint: readonly OpId[],
    pausedDomains: readonly string[],
  ): Promise<void>;
  inject(tabId: number, prePaint: readonly OpId[]): Promise<boolean>;
  /** Tabs that are open now (id and URL). */
  openTabs(): Promise<Array<{ id: number; url: string | undefined }>>;
}

export interface WorkerDeps {
  config: SwConfig;
  stores: LocalStores;
  tabs: TabRegistry;
  pages: PageMemos;
  /** Undo events held for the reason-chip window (storage.session). */
  undos: UndoHold;
  port: ChromePort;
  registration: Registration;
  auth: AuthService | null;
  sync: AccountSync | null;
  now: () => number;
  fetch?: typeof fetch;
}

interface Ctx {
  now: number;
  settings: Settings;
  account: AccountRecord | null;
  site: SiteRecord;
  /** Site rule with the "every site" levels filled in. */
  rule: SiteRule;
  profile: ProfileContext;
  learning: UserLearningState;
}

const PREPAINT_OPS: readonly OpId[] = ['focus_outline', 'calm_motion'];
const QUICK = {
  text: { ops: ['text_floor'] as OpId[], level: { text_floor: 2 } },
  targets: { ops: ['target_size'] as OpId[], level: { target_size: 2 } },
  calm: { ops: ['calm_motion', 'pause_media'] as OpId[], level: {} },
} as const;

const emptyPlan = (tabSession: string | null, now: number): AdaptationPlan => ({
  id: `plan-${tabSession ?? 'none'}-${Math.round(now)}`,
  createdAt: now,
  category: 'other',
  basis: 'local',
  ops: [],
});

/** The page-analysis label a change's decision rested on, if any. */
function aiLabelOf(c: {
  trace: PlannedOp['trace'];
}): AnalysisLabel | undefined {
  for (const e of c.trace.evidence)
    if (e.kind === 'region_role' && e.by === 'page_analysis' && e.label)
      return e.label;
  return undefined;
}

const pct = (factor: number): string => `${Math.round(factor * 100)}%`;

/** decide answered 503 without a retry time: pause page analysis this long. */
const UNAVAILABLE_BACKOFF_MS = 5 * 60_000;

/** A tab is injected at most once in this window (several paths can ask at once). */
const INJECT_DEDUPE_MS = 5_000;

/** No in-page offer in the first 10 s of a page view (personalization.md 5.2). */
export const OFFER_QUIET_MS = 10_000;
/** Friction that means the person is in the middle of something: the offer waits in the popup. */
const MID_INTERACTION: ReadonlySet<string> = new Set(['scroll_reversal']);

/** Whether a behaviour-triggered offer may appear on the page now. Pure. */
export function inPageOfferAllowed(
  signal: string,
  pageStartedAt: number,
  now: number,
): boolean {
  if (now - pageStartedAt < OFFER_QUIET_MS) return false;
  return !MID_INTERACTION.has(signal);
}

export class Worker {
  private readonly breaker: JsonStore<BreakerState>;
  private allSitesCache: boolean | null = null;
  private lastRegistration = '';
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly injectedAt = new Map<number, number>();
  private granting: Promise<void> | null = null;

  constructor(private readonly d: WorkerDeps) {
    this.breaker = new JsonStore(
      d.stores.local,
      KEYS.breaker,
      normalizeBreaker,
    );
  }

  private get now(): number {
    return this.d.now();
  }

  // =========================================================================
  // Context
  // =========================================================================

  private async context(domain: string): Promise<Ctx> {
    const now = this.now;
    const [settings, account, site] = await Promise.all([
      this.d.stores.settings.read(),
      this.d.stores.account.read(),
      this.d.stores.sites.get(domain),
    ]);
    const profile = await loadProfile(this.d.stores, now);
    const learning = await ensureLearning(this.d.stores, profile, now);
    const rule: SiteRule = {
      ...site.rule,
      levels: { ...settings.globalLevels, ...site.rule.levels },
    };
    return { now, settings, account, site, rule, profile, learning };
  }

  private async policyInput(
    c: Ctx,
    tab: TabRecord,
    signals: PageSignals,
    verdicts: Record<string, RegionVerdict>,
  ): Promise<PolicyInput> {
    const budget = await this.d.stores.offers.read();
    return {
      profile: c.profile.profile,
      needs: c.profile.needs,
      signals,
      verdicts,
      learning: c.learning,
      domain: c.site.state,
      site: c.rule,
      friction: tab.friction,
      offersToday: offersToday(budget, toDay(c.now)),
      offersThisPage: tab.offersShown,
      tabSession: tab.tabSession ?? 'none',
      now: c.now,
      profileConfidence: c.profile.confidence,
    };
  }

  /** Offers the person accepted this page view stay applied through re-plans. */
  private withAccepted(plan: AdaptationPlan, tab: TabRecord): AdaptationPlan {
    if (tab.acceptedOps.length === 0) return plan;
    const ops = plan.ops.map((p) =>
      tab.acceptedOps.includes(p.op) ? { ...p, mode: 'auto' as const } : p,
    );
    for (const op of tab.acceptedOps) {
      if (ops.some((p) => p.op === op)) continue;
      const prev = tab.plan?.ops.find((p) => p.op === op);
      if (prev) ops.push({ ...prev, mode: 'auto' });
    }
    return { ...plan, ops };
  }

  /**
   * The plan for a page view: policy, then level hysteresis across page views
   * (the memo is saved when `persist`), then offers the person accepted here.
   */
  private async planFor(
    c: Ctx,
    tab: TabRecord,
    view: AnalysisView,
    persist: boolean,
  ): Promise<AdaptationPlan> {
    const raw = buildPlan(
      await this.policyInput(c, tab, view.signals, view.verdicts),
    );
    const { plan, memo } = stabilizeLevels({
      plan: raw,
      memo: c.site.levelMemo,
      seed: c.profile.identity,
      tabSession: tab.tabSession ?? 'none',
      manual: c.rule.levels,
    });
    if (
      persist &&
      tab.domain &&
      JSON.stringify(memo) !== JSON.stringify(c.site.levelMemo)
    ) {
      await this.d.stores.sites.update(tab.domain, (s) => {
        s.levelMemo = memo;
      });
    }
    return this.withAccepted(plan, tab);
  }

  async allSites(): Promise<boolean> {
    if (this.allSitesCache === null)
      this.allSitesCache = await this.d.registration.hasAllSites();
    return this.allSitesCache;
  }

  // =========================================================================
  // Registration (engine + pre-paint CSS)
  // =========================================================================

  /** Ops whose pre-paint stylesheet the profile wants on every page. */
  async prePaintOps(): Promise<OpId[]> {
    const settings = await this.d.stores.settings.read();
    if (!settings.enabled) return [];
    const profile = await loadProfile(this.d.stores, this.now);
    const learning = await ensureLearning(this.d.stores, profile, this.now);
    return PREPAINT_OPS.filter((op) => {
      const o = learning.ops[op];
      return o !== undefined && !o.blocked && o.src !== 'none';
    });
  }

  async reconcileRegistration(force = false): Promise<void> {
    this.allSitesCache = null;
    const [prePaint, sites, allSites] = await Promise.all([
      this.prePaintOps(),
      this.d.stores.sites.all(),
      this.allSites(),
    ]);
    const paused = Object.entries(sites)
      .filter(([, r]) => r.rule.paused)
      .map(([d]) => d)
      .sort();
    const signature = JSON.stringify({ prePaint, paused, allSites });
    if (!force && signature === this.lastRegistration) return;
    this.lastRegistration = signature;
    await this.d.registration.reconcile(prePaint, paused).catch(() => {
      this.lastRegistration = '';
    });
  }

  // =========================================================================
  // Content script messages
  // =========================================================================

  async hello(
    tabId: number,
    frameId: number,
    url: string | undefined,
  ): Promise<HelloReply> {
    const now = this.now;
    if (frameId !== 0)
      return {
        enabled: false,
        paused: true,
        prePaint: [],
        tabSession: randomId(12),
      };
    await this.flushUndos();
    await this.endPageView(tabId);
    const access = classifyUrl(url);
    const settings = await this.d.stores.settings.read();
    const domain = access.kind === 'web' ? access.domain : null;
    const site = domain ? await this.d.stores.sites.get(domain) : null;
    const paused = site?.rule.paused ?? false;
    const prePaint = await this.prePaintOps();
    const tabSession = randomId(12);
    await this.d.tabs.update(tabId, (t) => {
      Object.assign(t, freshTab(tabId), {
        domain,
        access: access.kind,
        tabSession,
        engine: true,
        phase: paused || !settings.enabled ? 'ready' : 'checking',
        checkingSince: now,
        startedAt: now,
        needsReload: paused,
      });
    });
    await this.d.pages.delete(tabId);
    void this.refreshBadge(tabId);
    this.d.port.broadcast({ type: 'ui:changed', tabId });
    return {
      enabled: settings.enabled && access.kind === 'web',
      paused,
      prePaint,
      tabSession,
    };
  }

  async signals(
    tabId: number,
    frameId: number,
    signals: PageSignals,
    evidence: PageEvidence,
  ): Promise<ContentReplies['cs:signals'] & { announce: boolean }> {
    const tab = await this.d.tabs.get(tabId);
    if (frameId !== 0 || !tab.domain || !tab.tabSession)
      return { plan: emptyPlan(tab.tabSession, this.now), announce: false };
    const domain = tab.domain;
    const tabSession = tab.tabSession;

    await this.noteEnv(signals.env);
    const c = await this.context(domain);
    if (!c.settings.enabled || c.rule.paused) {
      await this.d.tabs.update(tabId, (t) => {
        t.phase = 'ready';
        t.checkingSince = null;
      });
      return { plan: emptyPlan(tabSession, c.now), announce: false };
    }

    // The engine sees only pinch zoom; the tab's own zoom (without WebAble's) comes from Chrome.
    const browserZoom = tab.zoom
      ? tab.zoom.previous
      : await this.d.port.getZoom(tabId);
    const pinch = signals.viewport.zoom > 0 ? signals.viewport.zoom : 1;
    const measured: PageSignals = {
      ...signals,
      viewport: {
        ...signals.viewport,
        zoom: Math.round(browserZoom * pinch * 1000) / 1000,
      },
    };
    const memo = await this.lookup(domain, tabSession, measured, evidence);
    const view = analysisView(measured, evidence.regions, memo.answers);
    const plan = await this.planFor(c, tab, view, true);
    await this.d.pages.set(tabId, memo);

    const offer = plan.ops.find((p) => p.mode === 'offer') ?? null;
    await this.d.tabs.update(tabId, (t) => {
      t.category = view.signals.category;
      t.plan = plan;
      t.signalsAt ??= c.now;
      t.needsReload = false;
      t.analysis.used = view.used;
      if (
        !t.offer &&
        t.offersShown === 0 &&
        offer &&
        !t.acceptedOps.includes(offer.op)
      )
        t.offer = offer;
    });

    const zoom = plan.ops.find((p) => p.op === 'page_zoom');
    if (zoom && zoom.mode === 'auto') await this.applyZoom(tabId, zoom);
    else await this.resetZoom(tabId);

    void this.maybeAnalyze(tabId, tabSession, memo).catch(() => undefined);
    this.d.port.broadcast({ type: 'ui:changed', tabId });
    return { plan, announce: !c.site.announced };
  }

  async applied(
    tabId: number,
    frameId: number,
    changes: AppliedChange[],
  ): Promise<void> {
    if (frameId !== 0) return;
    await this.processChanges(tabId, changes);
  }

  async contentEvent(
    tabId: number,
    frameId: number,
    input: EventInput,
  ): Promise<void> {
    if (frameId !== 0) return;
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || !tab.tabSession) return;
    const now = this.now;
    const change = tab.changes.find((c) => c.op === input.op);
    const label = change ? aiLabelOf(change) : undefined;
    const ev: EventInput = {
      ...input,
      ...(input.kind === 'undo' &&
      input.dtApplyMs === undefined &&
      tab.appliedAt[input.op] !== undefined
        ? { dtApplyMs: now - tab.appliedAt[input.op]! }
        : {}),
      ...(input.aiLabel === undefined && label ? { aiLabel: label } : {}),
    };
    if (ev.kind !== 'undo') {
      await this.record(tab, [ev]);
      await this.afterChange(tabId);
      return;
    }
    // An undo on the page (the toast's Undo): the page already put the change back.
    const events: EventInput[] = [ev];
    await this.d.tabs.update(tabId, (t) => {
      if (!t.undoneByYou.includes(ev.op)) t.undoneByYou.push(ev.op);
      t.changes = t.changes.filter(
        (c) => c.op !== ev.op || c.status !== 'applied',
      );
    });
    // The toast's Undo is "undo all": the tab zoom goes with the engine's changes.
    const after = await this.d.tabs.get(tabId);
    const engineLeft = appliedChanges(after.changes).filter(
      (c) => c.op !== 'page_zoom',
    );
    if (engineLeft.length === 0 && after.zoom) {
      const zoomChange = after.changes.find((c) => c.op === 'page_zoom');
      if (zoomChange) events.push(this.undoEvent(after, zoomChange));
      await this.resetZoom(tabId);
      await this.d.tabs.update(tabId, (t) => {
        if (!t.undoneByYou.includes('page_zoom'))
          t.undoneByYou.push('page_zoom');
      });
    }
    await this.holdUndos(tab, events);
    await this.syncSiteCount(tabId);
    await this.afterChange(tabId);
  }

  async friction(
    tabId: number,
    signal: keyof typeof FRICTION_LR,
    ops: readonly OpId[],
  ): Promise<ContentReplies['cs:friction']> {
    const now = this.now;
    const tab = await this.d.tabs.update(tabId, (t) => {
      t.interactedAt ??= now;
      const lr = FRICTION_LR[signal] ?? 1;
      for (const op of ops) t.friction[op] = Math.max(t.friction[op] ?? 1, lr);
    });
    if (!tab.domain || !tab.tabSession || tab.offersShown > 0)
      return { offer: null };
    const memo = await this.d.pages.get(tabId, tab.tabSession);
    if (!memo) return { offer: null };
    const c = await this.context(tab.domain);
    if (!c.settings.enabled || c.rule.paused) return { offer: null };
    const view = analysisView(
      memo.signals,
      memo.evidence.regions,
      memo.answers,
    );
    const plan = await this.planFor(c, tab, view, false);
    const offer = plan.ops.find(
      (p) =>
        p.mode === 'offer' &&
        ops.includes(p.op) &&
        !tab.acceptedOps.includes(p.op) &&
        !appliedChanges(tab.changes).some((c2) => c2.op === p.op),
    );
    if (!offer) return { offer: null };
    await this.d.tabs.update(tabId, (t) => {
      t.offer ??= offer;
    });
    this.d.port.broadcast({ type: 'ui:changed', tabId });
    // Never interrupt: no chip in the first 10 s of a page, and none while the
    // person is mid-scroll. The question waits in the popup instead.
    const since = tab.startedAt ?? tab.signalsAt ?? now;
    if (!inPageOfferAllowed(signal, since, now)) return { offer: null };
    await this.markOfferShown(tabId);
    return { offer };
  }

  /** An offer was put in front of the person (in-page chip or popup): count it once. */
  async markOfferShown(tabId: number): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.offer || tab.offersShown > 0 || !tab.domain || !tab.tabSession)
      return;
    const offer = tab.offer;
    const day = toDay(this.now);
    await this.d.tabs.update(tabId, (t) => {
      t.offersShown += 1;
    });
    await this.d.stores.offers.update((b) =>
      b.day === day ? { day, count: b.count + 1 } : { day, count: 1 },
    );
    await this.record(tab, [
      {
        cat: tab.category,
        op: offer.op,
        level: offer.level,
        src: offer.trace.source,
        kind: 'offered',
        ...(offer.trace.evidence.find((e) => e.kind === 'friction')
          ? {
              friction: (
                offer.trace.evidence.find((e) => e.kind === 'friction') as {
                  signal: NonNullable<EventInput['friction']>;
                }
              ).signal,
            }
          : {}),
      },
    ]);
  }

  async offerAnswer(
    tabId: number,
    op: OpId,
    answer: 'accept' | 'dismiss' | 'never_here' | 'timeout',
    via: 'page' | 'popup',
  ): Promise<ContentReplies['cs:offer-answer']> {
    const tab = await this.d.tabs.get(tabId);
    const offer = tab.offer?.op === op ? tab.offer : null;
    if (!offer || !tab.domain || !tab.tabSession) return { plan: null };
    if (via === 'popup') await this.markOfferShown(tabId);
    const base = {
      cat: tab.category,
      op,
      level: offer.level,
      src: 'offer' as const,
    };
    await this.d.tabs.update(tabId, (t) => {
      t.offer = null;
    });

    if (answer === 'timeout') {
      await this.record(tab, [{ ...base, kind: 'offer_ignored' }]);
      await this.afterChange(tabId);
      return { plan: null };
    }
    if (answer === 'dismiss') {
      await this.record(tab, [{ ...base, kind: 'offer_dismissed' }]);
      await this.afterChange(tabId);
      return { plan: null };
    }
    if (answer === 'never_here') {
      await this.d.stores.sites.update(tab.domain, (s) => {
        s.rule.blocks = [...new Set([...s.rule.blocks, op])];
        s.rule.pins = s.rule.pins.filter((p) => p !== op);
        s.rule.updatedAt = this.now;
      });
      await this.record(tab, [{ ...base, kind: 'site_disable' }]);
      await this.afterChange(tabId);
      return { plan: null };
    }

    // Accept: apply exactly this op now.
    await this.record(tab, [{ ...base, kind: 'offer_accepted' }]);
    await this.d.tabs.update(tabId, (t) => {
      if (!t.acceptedOps.includes(op)) t.acceptedOps.push(op);
      t.plan = t.plan
        ? {
            ...t.plan,
            ops: [
              ...t.plan.ops.filter((p) => p.op !== op),
              { ...offer, mode: 'auto' },
            ],
          }
        : t.plan;
    });
    const plan: AdaptationPlan = {
      id: `plan-${tab.tabSession}-${Math.round(this.now)}-offer`,
      createdAt: this.now,
      category: tab.category,
      basis: tab.plan?.basis ?? 'local',
      ops: [offer],
    };
    if (op === 'page_zoom') {
      await this.applyZoom(tabId, { ...offer, mode: 'offer' });
      await this.afterChange(tabId);
      return { plan: null };
    }
    if (via === 'page') return { plan };
    const reply = await this.d.port.sendToTab(tabId, {
      type: 'sw:plan',
      plan,
      reason: 'offer_accepted',
    });
    if (reply) await this.processChanges(tabId, reply.changes);
    return { plan: null };
  }

  // =========================================================================
  // Changes, zoom, events
  // =========================================================================

  private undoEvent(tab: TabRecord, c: AppliedChange): EventInput {
    const at = tab.appliedAt[c.op];
    const label = aiLabelOf(c);
    return {
      cat: tab.category,
      op: c.op,
      level: c.level,
      src: c.mode === 'offer' ? 'offer' : c.trace.source,
      kind: 'undo',
      ...(at !== undefined ? { dtApplyMs: Math.max(0, this.now - at) } : {}),
      ...(label ? { aiLabel: label } : {}),
    };
  }

  private async record(tab: TabRecord, inputs: EventInput[]): Promise<void> {
    if (!tab.domain || !tab.tabSession || inputs.length === 0) return;
    const profile = await loadProfile(this.d.stores, this.now);
    await recordEvents(
      this.d.stores,
      profile,
      tab.domain,
      tab.tabSession,
      inputs,
      this.now,
    );
  }

  // =========================================================================
  // Undo hold (reason chips)
  // =========================================================================

  /**
   * Hold undo events for the 8 s reason window. The op is marked off for this
   * page view at once, so a re-plan inside the window never brings it back.
   */
  private async holdUndos(
    tab: TabRecord,
    events: readonly EventInput[],
  ): Promise<void> {
    const domain = tab.domain;
    const tabSession = tab.tabSession;
    if (!domain || !tabSession || events.length === 0) return;
    const day = toDay(this.now);
    await this.d.stores.sites.update(domain, (s) => {
      for (const ev of events) {
        const dop = (s.state.ops[ev.op] ??= { s: 0, f: 0, t: day });
        dop.sessionOff = tabSession;
      }
    });
    await this.d.undos.hold(
      events.map((input) => ({ tabId: tab.tabId, domain, tabSession, input })),
      this.now,
    );
    this.scheduleUndoFlush();
  }

  private scheduleUndoFlush(): void {
    if (this.undoTimer) return;
    void this.d.undos.nextDue().then((due) => {
      if (due === null || this.undoTimer) return;
      this.undoTimer = setTimeout(
        () => {
          this.undoTimer = null;
          void this.flushUndos().catch(() => undefined);
        },
        Math.max(0, due - this.now) + 25,
      );
    });
  }

  /**
   * Apply held undos that are due (and every held undo of a page view that is
   * ending). Runs on a timer and whenever the worker wakes.
   */
  async flushUndos(endingSession?: string): Promise<void> {
    const due = await this.d.undos.takeDue(this.now, endingSession);
    if (due.length > 0) {
      const profile = await loadProfile(this.d.stores, this.now);
      for (const h of due)
        await recordEvents(
          this.d.stores,
          profile,
          h.domain,
          h.tabSession,
          [h.input],
          this.now,
        ).catch(() => undefined);
    }
    if ((await this.d.undos.nextDue()) !== null) this.scheduleUndoFlush();
  }

  /** A reason chip was answered for an undo on this tab. */
  async undoReason(tabId: number, op: OpId, reason: UndoReason): Promise<void> {
    const outcome = await this.d.undos.reason({ tabId, op }, reason, this.now);
    if (outcome.kind === 'attach') {
      await this.flushUndos();
    } else if (outcome.kind === 'late') {
      const profile = await loadProfile(this.d.stores, this.now);
      await recordEvents(
        this.d.stores,
        profile,
        outcome.entry.domain,
        outcome.entry.tabSession,
        [outcome.event],
        this.now,
      );
    }
    this.d.port.broadcast({ type: 'ui:changed', tabId });
  }

  /** The site's "changes on the last visit" count follows the tab. */
  private async syncSiteCount(tabId: number): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain) return;
    const count = appliedChanges(tab.changes).length;
    await this.d.stores.sites.update(tab.domain, (s) => {
      s.lastChanges = count;
    });
  }

  /** The engine's report (from cs:applied or a sw:* reply) becomes the tab's changes. */
  async processChanges(
    tabId: number,
    engineChanges: readonly AppliedChange[],
  ): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || !tab.tabSession) return;
    const now = this.now;
    const prevApplied = new Set(appliedChanges(tab.changes).map((c) => c.op));
    const prevUndone = new Set(undoneByChecks(tab.changes).map((c) => c.op));
    const zoomChange = tab.zoom
      ? tab.changes.find((c) => c.op === 'page_zoom' && c.status === 'applied')
      : undefined;
    const next = engineChanges.filter((c) => c.op !== 'page_zoom');
    if (zoomChange) next.push(zoomChange);

    const events: EventInput[] = [];
    const appliedAt: Partial<Record<OpId, number>> = {};
    for (const c of next) {
      const base = {
        cat: tab.category,
        op: c.op,
        level: c.level,
        src: c.mode === 'offer' ? ('offer' as const) : c.trace.source,
      };
      const label = aiLabelOf(c);
      if (c.status === 'applied' && !prevApplied.has(c.op)) {
        appliedAt[c.op] = now;
        events.push({
          ...base,
          kind: 'applied',
          ...(label ? { aiLabel: label } : {}),
        });
        if (c.op !== 'page_zoom')
          events.push({ ...base, kind: 'verifier', pass: true });
      } else if (c.status === 'undone_by_checks' && !prevUndone.has(c.op)) {
        events.push({
          ...base,
          kind: 'verifier',
          pass: false,
          ...(c.vcode ? { vcode: c.vcode } : {}),
        });
      }
    }
    await this.d.tabs.update(tabId, (t) => {
      t.changes = next;
      t.phase = 'ready';
      t.checkingSince = null;
      Object.assign(t.appliedAt, appliedAt);
    });
    const count = appliedChanges(next).length;
    const visibleAuto = next.some(
      (c) => c.status === 'applied' && c.mode === 'auto' && c.fit,
    );
    await this.d.stores.sites.update(tab.domain, (s) => {
      s.lastVisit = now;
      s.lastChanges = count;
      if (visibleAuto) s.announced = true;
    });
    await this.record(tab, events);
    await this.afterChange(tabId);
  }

  private async applyZoom(tabId: number, planned: PlannedOp): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    const levels = OP_CATALOG.page_zoom.levels;
    const level = Math.max(0, Math.min(levels.length - 1, planned.level));
    const factor = levels[level] ?? 1;
    if (tab.zoom?.factor === factor) return;
    const previous = tab.zoom?.previous ?? (await this.d.port.getZoom(tabId));
    try {
      await this.d.port.setZoom(tabId, factor);
    } catch {
      return;
    }
    const change: AppliedChange = {
      op: 'page_zoom',
      level,
      mode: planned.mode,
      status: 'applied',
      count: 1,
      fit: { before: pct(previous), after: pct(factor) },
      trace: planned.trace,
    };
    const fresh = !tab.zoom;
    await this.d.tabs.update(tabId, (t) => {
      t.zoom = { level, factor, previous };
      t.changes = [...t.changes.filter((c) => c.op !== 'page_zoom'), change];
      if (fresh) t.appliedAt.page_zoom = this.now;
    });
    if (fresh)
      await this.record(tab, [
        {
          cat: tab.category,
          op: 'page_zoom',
          level,
          src: planned.mode === 'offer' ? 'offer' : planned.trace.source,
          kind: 'applied',
        },
      ]);
  }

  private async resetZoom(tabId: number): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.zoom) return;
    const previous = tab.zoom.previous;
    await this.d.tabs.update(tabId, (t) => {
      t.zoom = null;
      t.changes = t.changes.filter((c) => c.op !== 'page_zoom');
    });
    await this.d.port.setZoom(tabId, previous).catch(() => undefined);
  }

  /** Close the current page view: session_end and episode_end events. */
  async endPageView(tabId: number): Promise<void> {
    const tab = await this.d.tabs.peek(tabId);
    if (!tab?.tabSession || !tab.domain) return;
    await this.flushUndos(tab.tabSession);
    const now = this.now;
    const events: EventInput[] = [];
    for (const c of appliedChanges(tab.changes)) {
      const at = tab.appliedAt[c.op];
      const label = aiLabelOf(c);
      events.push({
        cat: tab.category,
        op: c.op,
        level: c.level,
        src: c.mode === 'offer' ? 'offer' : c.trace.source,
        kind: 'session_end',
        kept: true,
        ...(at !== undefined ? { keptMs: now - at } : {}),
        acceptedThisSession: tab.acceptedOps.includes(c.op),
        autoApplied: c.mode === 'auto' && !tab.acceptedOps.includes(c.op),
        visibleEffect: c.fit !== undefined,
        ...(label ? { aiLabel: label } : {}),
      });
    }
    for (const [op, edit] of Object.entries(tab.levelEdits) as Array<
      [OpId, { from: number; to: number; at: number }]
    >) {
      if (edit.from === edit.to) continue;
      events.push({
        cat: tab.category,
        op,
        level: edit.to,
        src: 'manual',
        kind: 'episode_end',
        fromLevel: edit.from,
        toLevel: edit.to,
        settledValue: levelValue(op, edit.to),
        keptMs: now - edit.at,
        dir: edit.to > edit.from ? 1 : -1,
      });
    }
    const closing = { ...tab };
    await this.d.tabs.update(tabId, (t) => {
      t.tabSession = null;
      t.engine = false;
    });
    await this.d.pages.delete(tabId);
    await this.record(closing, events).catch(() => undefined);
  }

  /** A top-frame navigation committed (the new document may have no engine). */
  async navigated(
    tabId: number,
    url: string | undefined,
    committedAt: number,
  ): Promise<void> {
    const tab = await this.d.tabs.peek(tabId);
    // The new page's engine already said hello: this commit is not news.
    if (
      tab?.engine &&
      tab.checkingSince !== null &&
      tab.checkingSince >= committedAt - 50
    )
      return;
    await this.endPageView(tabId);
    const access = classifyUrl(url);
    await this.d.tabs.update(tabId, (t) => {
      Object.assign(t, freshTab(tabId), {
        domain: access.kind === 'web' ? access.domain : null,
        access: access.kind,
      });
    });
    await this.refreshBadge(tabId);
    this.d.port.broadcast({ type: 'ui:changed', tabId });
  }

  async tabClosed(tabId: number): Promise<void> {
    await this.endPageView(tabId);
    await this.d.tabs.remove(tabId);
    await this.d.pages.delete(tabId);
  }

  private async afterChange(tabId: number): Promise<void> {
    await this.refreshBadge(tabId);
    this.d.port.broadcast({ type: 'ui:changed', tabId });
  }

  async refreshBadge(tabId: number): Promise<void> {
    const tab = await this.d.tabs.peek(tabId);
    if (!tab) return;
    const [settings, account, profile] = await Promise.all([
      this.d.stores.settings.read(),
      this.d.stores.account.read(),
      loadProfile(this.d.stores, this.now),
    ]);
    const paused = tab.domain
      ? (await this.d.stores.sites.get(tab.domain)).rule.paused
      : false;
    const status = popupStatus(tab, {
      enabled: settings.enabled,
      paused,
      allSites: await this.allSites(),
      firstRun: !account && !profile.calibrated,
      now: this.now,
    });
    await this.d.port
      .setBadge(
        tabId,
        badgeFor({
          status,
          count: appliedChanges(tab.changes).length,
          needsReauth: account?.needsReauth ?? false,
        }),
      )
      .catch(() => undefined);
  }

  async refreshAllBadges(): Promise<void> {
    for (const tab of await this.d.tabs.all())
      await this.refreshBadge(tab.tabId);
  }

  // =========================================================================
  // Page analysis
  // =========================================================================

  private async lookup(
    domain: string,
    tabSession: string,
    signals: PageSignals,
    evidence: PageEvidence,
  ): Promise<PageMemo> {
    const install = await this.d.stores.install.get();
    const site = await siteKey(install.secret, domain);
    const candidates = evidence.mainCandidates ?? [];
    const regionKeys = Object.keys(evidence.regions).filter(
      (k) => !candidates.includes(k),
    );
    const region: Record<string, string> = {};
    for (const k of regionKeys)
      region[k] = await regionAnswerKey(install.secret, site, k);
    const sig = pageSignature(evidence.page, evidence.regions);
    const main =
      candidates.length >= 2
        ? await pageAnswerKey(
            install.secret,
            site,
            'main',
            sig,
            [...candidates].sort(),
          )
        : undefined;
    const page = await pageAnswerKey(install.secret, site, 'page', sig);
    const got = await this.d.stores.answers.getMany([
      ...Object.values(region),
      ...(main ? [main] : []),
      page,
    ]);
    const answers: KeyedAnswers = { regions: new Map() };
    for (const [ck, hk] of Object.entries(region)) {
      const a = got.get(hk);
      if (a?.kind === 'region') answers.regions.set(ck, a.answer);
    }
    const m = main ? got.get(main) : undefined;
    if (m?.kind === 'main') answers.main = m.pick;
    const p = got.get(page);
    if (p?.kind === 'page') answers.pageType = p.dist;
    void signals;
    return {
      tabSession,
      signals,
      evidence,
      answers:
        answers.regions.size || answers.main || answers.pageType
          ? answers
          : null,
      cacheKeys: { site, region, ...(main ? { main } : {}), page },
    };
  }

  private async maybeAnalyze(
    tabId: number,
    tabSession: string,
    memo: PageMemo,
  ): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || tab.tabSession !== tabSession) return;
    const domain = tab.domain;
    const { signals, evidence } = memo;
    const c = await this.context(domain);
    const auth = this.d.auth;
    const candidates = evidence.mainCandidates ?? [];
    const regionKeys = Object.keys(memo.cacheKeys.region);
    const uncached = regionKeys.filter((k) => !memo.answers?.regions.has(k));
    const mainUncached = candidates.length >= 2 && !memo.answers?.main;
    const askPageType =
      signals.categoryConfidence < 0.75 && !memo.answers?.pageType;
    const breaker = await this.breaker.read();
    const consumers = analysisConsumers({
      learning: c.learning,
      domain: c.site.state,
      site: c.rule,
      profile: c.profile.profile,
      needs: c.profile.needs,
      category: signals.category,
      profileConfidence: c.profile.confidence,
      now: c.now,
    });
    const verdict = gate({
      configured:
        auth !== null &&
        Boolean(this.d.config.decideUrl && this.d.config.publishableKey),
      signedIn: c.account !== null,
      needsReauth: c.account?.needsReauth ?? false,
      cloudAnalysis: c.account?.cloudAnalysis ?? false,
      consumesAnalysis: consumers.length > 0,
      excludedSite: false,
      signals,
      ambiguousRegions: regionKeys.length,
      uncachedRegions: uncached.length,
      mainUncached,
      breakerOpen: breakerOpen(breaker, c.now),
      tab: { calls: tab.analysis.calls, lastCallAt: tab.analysis.lastCallAt },
      now: c.now,
    });
    if (!verdict.call || !auth) return;
    const built = buildDecideRequest(evidence, {
      regionKeys: uncached,
      ...(mainUncached ? { mainCandidates: candidates } : {}),
      askPageType,
    });
    if (!built) return;
    const token = await auth.accessToken();
    if (!token) return;

    const sentAt = this.now;
    await this.d.stores.receipts.add({
      id: randomId(12),
      at: sentAt,
      domain,
      destination: 'page_analysis',
      bytes: new TextEncoder().encode(built.body).byteLength,
      body: JSON.parse(built.body) as unknown,
    });
    await this.d.tabs.update(tabId, (t) => {
      t.analysis.calls += 1;
      t.analysis.lastCallAt = sentAt;
      t.analysis.lastSentAt = sentAt;
    });
    this.d.port.broadcast({ type: 'ui:changed', tabId });

    const outcome = await callDecide({
      url: this.d.config.decideUrl,
      publishableKey: this.d.config.publishableKey,
      accessToken: token,
      body: built.body,
      timeoutMs: HARD_TIMEOUT_MS,
      ...(this.d.fetch ? { fetch: this.d.fetch } : {}),
    });
    if (!outcome.ok) {
      await this.decideFailed(outcome);
      return;
    }
    await this.breaker.write(breakerSuccess());

    const fresh = keyAnswers(outcome.data, built.ridToKey, built.cidToKey);
    await this.d.stores.answers.putMany(
      cacheEntries(fresh, {
        region: new Map(Object.entries(memo.cacheKeys.region)),
        ...(memo.cacheKeys.main ? { main: memo.cacheKeys.main } : {}),
        ...(memo.cacheKeys.page ? { page: memo.cacheKeys.page } : {}),
      }),
      memo.cacheKeys.site,
    );
    const merged: KeyedAnswers = {
      regions: new Map([...(memo.answers?.regions ?? []), ...fresh.regions]),
    };
    const main = fresh.main ?? memo.answers?.main;
    if (main) merged.main = main;
    const pageType = fresh.pageType ?? memo.answers?.pageType;
    if (pageType) merged.pageType = pageType;
    await this.refine(tabId, tabSession, { ...memo, answers: merged });
  }

  /**
   * decide said no (ai-architecture 7). Nothing on the page waits for this:
   * local rules already decided. 401: the session is refreshed, or the person
   * is asked to sign in again. 403 consent_required: consent is off on the
   * server, so stop calling and pull the account. 503 and quota: back off.
   */
  private async decideFailed(
    outcome: Extract<DecideOutcome, { ok: false }>,
  ): Promise<void> {
    if (outcome.reason === 'unauthorized') {
      const refreshed = (await this.d.auth?.refreshNow()) ?? false;
      if (!refreshed)
        await this.d.stores.account.update((a) =>
          a ? { ...a, needsReauth: true } : a,
        );
      await this.refreshAllBadges();
      return;
    }
    if (outcome.reason === 'consent_required') {
      await this.d.stores.account.update((a) =>
        a ? { ...a, cloudAnalysis: false } : a,
      );
      void this.d.sync?.refresh().catch(() => undefined);
      return;
    }
    const retry =
      outcome.retryAfterMs ??
      (outcome.status === 503 ? UNAVAILABLE_BACKOFF_MS : undefined);
    await this.breaker.update((b) => breakerFailure(b, this.now, retry));
  }

  /** Apply page-analysis answers to the page view under the deadline rules. */
  private async refine(
    tabId: number,
    tabSession: string,
    memo: PageMemo,
  ): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (tab.tabSession !== tabSession || !tab.plan || !tab.domain) return;
    await this.d.pages.set(tabId, memo);
    const answeredAt = this.now;
    const mode = refinementMode({
      dclAt: tab.signalsAt ?? answeredAt,
      answeredAt,
      interactedAt: tab.interactedAt,
    });
    const c = await this.context(tab.domain);
    if (!c.settings.enabled || c.rule.paused) return;
    const view = analysisView(
      memo.signals,
      memo.evidence.regions,
      memo.answers,
    );
    const refined = await this.planFor(c, tab, view, true);
    const diff = diffRefinement(tab.plan, refined, mode, view.protectedKeys);
    for (const op of diff.undo) {
      const reply = await this.d.port.sendToTab(tabId, { type: 'sw:undo', op });
      if (reply) await this.processChanges(tabId, reply.changes);
    }
    if (diff.ops.length > 0) {
      const reply = await this.d.port.sendToTab(tabId, {
        type: 'sw:plan',
        plan: { ...refined, ops: diff.ops },
        reason: 'refine',
      });
      if (reply) await this.processChanges(tabId, reply.changes);
    }
    await this.d.tabs.update(tabId, (t) => {
      if (t.tabSession !== tabSession || !t.plan) return;
      t.plan = applyRefinement(
        t.plan,
        diff,
        view.used ? 'page_analysis' : t.plan.basis,
      );
      t.analysis.used = view.used;
      const offer = diff.offers[0];
      if (!t.offer && t.offersShown === 0 && offer) t.offer = offer;
    });
    await this.afterChange(tabId);
  }

  // =========================================================================
  // Popup
  // =========================================================================

  async prefs(): Promise<Prefs> {
    const [settings, profile] = await Promise.all([
      this.d.stores.settings.read(),
      this.d.stores.profile.read(),
    ]);
    return {
      theme: settings.theme,
      reduceMotion: settings.reduceMotion,
      profile: profile?.profile ?? null,
    };
  }

  links(): TabDetail['links'] {
    const o = this.d.config.webOrigin;
    return {
      fit: `${o}/app`,
      tune: `${o}/tune`,
      help: `${o}/help`,
      connect: `${o}/connect`,
      privacy: `${o}/app/privacy`,
    };
  }

  async view(tabId: number): Promise<TabDetail> {
    let tab = await this.d.tabs.get(tabId);
    const settings = await this.d.stores.settings.read();
    if (!tab.engine) {
      const access = classifyUrl(await this.d.port.tabUrl(tabId));
      tab = await this.d.tabs.update(tabId, (t) => {
        t.access = access.kind;
        t.domain = access.kind === 'web' ? access.domain : null;
      });
      // Opening WebAble on a page grants activeTab: adapt this page now.
      if (settings.enabled && tab.access === 'web' && tab.domain) {
        const site = await this.d.stores.sites.get(tab.domain);
        if (!site.rule.paused) {
          const ok = await this.injectOnce(tabId);
          if (ok)
            tab = await this.d.tabs.update(tabId, (t) => {
              t.engine = true;
              t.phase = 'checking';
              t.checkingSince = this.now;
            });
        }
      }
    } else {
      const reply = await this.d.port.sendToTab(
        tabId,
        { type: 'sw:get-changes' },
        1500,
      );
      if (reply?.status === 'unreadable') {
        tab = await this.d.tabs.update(tabId, (t) => {
          t.phase = 'unreadable';
          t.checkingSince = null;
        });
      } else if (
        reply &&
        reply.status === 'ready' &&
        tab.phase !== 'unreadable'
      ) {
        const same =
          JSON.stringify(reply.changes.filter((c) => c.op !== 'page_zoom')) ===
          JSON.stringify(tab.changes.filter((c) => c.op !== 'page_zoom'));
        if (!same) await this.processChanges(tabId, reply.changes);
        tab = await this.d.tabs.get(tabId);
      }
    }
    return this.detail(tab);
  }

  async detail(tab: TabRecord): Promise<TabDetail> {
    const now = this.now;
    const [settings, account, profile, allSites] = await Promise.all([
      this.d.stores.settings.read(),
      this.d.stores.account.read(),
      loadProfile(this.d.stores, now),
      this.allSites(),
    ]);
    const site = tab.domain ? await this.d.stores.sites.get(tab.domain) : null;
    const rule = site?.rule;
    const paused = rule?.paused ?? false;
    const firstRun = !account && !profile.calibrated;
    const status = popupStatus(tab, {
      enabled: settings.enabled,
      paused,
      allSites,
      firstRun,
      now,
    });
    const planned = (op: OpId): number | undefined =>
      appliedChanges(tab.changes).find((c) => c.op === op)?.level ??
      tab.plan?.ops.find((p) => p.op === op)?.level;
    const level = (op: OpId, fallback: number): number =>
      rule?.levels[op] ?? settings.globalLevels[op] ?? planned(op) ?? fallback;
    const pins = rule?.pins ?? [];
    const offer =
      tab.offer &&
      !tab.acceptedOps.includes(tab.offer.op) &&
      status !== 'paused' &&
      status !== 'off'
        ? tab.offer
        : null;
    return {
      tabId: tab.tabId,
      domain: tab.domain,
      status,
      changes: tab.changes.filter(
        (c) => c.status === 'applied' || c.status === 'undone_by_checks',
      ),
      offer,
      account: {
        signedIn: account !== null && !account.needsReauth,
        email: account?.email ?? null,
        needsReauth: account?.needsReauth ?? false,
        cloudAnalysis: account?.cloudAnalysis ?? false,
        calibrated: profile.calibrated,
      },
      allSites,
      enabled: settings.enabled,
      analyzed: tab.analysis.used,
      lastSentAt: tab.analysis.lastSentAt,
      undoneByYou: tab.undoneByYou,
      reasonOpen: await this.d.undos.openFor(tab.tabId, now),
      site: {
        paused,
        pins,
        blocks: rule?.blocks ?? [],
        levels: rule?.levels ?? {},
      },
      levels: {
        text_floor: level('text_floor', 2),
        line_spacing: level('line_spacing', 0),
        target_size: level('target_size', 2),
      },
      quick: {
        text: pins.includes('text_floor'),
        targets: pins.includes('target_size'),
        calm: pins.includes('calm_motion'),
      },
      needsReload: tab.needsReload && !paused,
      onDeviceOnly:
        account === null || !account.cloudAnalysis || account.needsReauth,
      prefs: {
        theme: settings.theme,
        reduceMotion: settings.reduceMotion,
        profile: profile.profile,
      },
      links: this.links(),
    };
  }

  async undo(tabId: number, op: OpId | 'all'): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || !tab.tabSession) return;
    const applied = appliedChanges(tab.changes);
    const targets = op === 'all' ? applied : applied.filter((c) => c.op === op);
    if (targets.length === 0) return;
    const events = targets.map((c) => this.undoEvent(tab, c));
    if (targets.some((c) => c.op === 'page_zoom')) await this.resetZoom(tabId);
    const engineTargets = targets.filter((c) => c.op !== 'page_zoom');
    let engineChanges: AppliedChange[] | null = null;
    if (engineTargets.length > 0) {
      const reply = await this.d.port.sendToTab(tabId, {
        type: 'sw:undo',
        op: op === 'all' ? 'all' : op,
      });
      engineChanges = reply?.changes ?? null;
    }
    const undone = new Set(targets.map((c) => c.op));
    await this.d.tabs.update(tabId, (t) => {
      for (const o of undone)
        if (!t.undoneByYou.includes(o)) t.undoneByYou.push(o);
      const kept = (engineChanges ?? t.changes).filter(
        (c) => c.op !== 'page_zoom',
      );
      const zoom = t.changes.find((c) => c.op === 'page_zoom');
      t.changes = [
        ...kept.filter((c) => !(undone.has(c.op) && c.status === 'applied')),
        ...(zoom && t.zoom ? [zoom] : []),
      ];
    });
    await this.holdUndos(tab, events);
    await this.syncSiteCount(tabId);
    await this.afterChange(tabId);
  }

  /** Re-plan the current page view after a settings change, or report that a reload is needed. */
  private async replan(tabId: number): Promise<boolean> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || !tab.tabSession || !tab.engine) return false;
    const memo = await this.d.pages.get(tabId, tab.tabSession);
    if (!memo) return false;
    const c = await this.context(tab.domain);
    const view = analysisView(
      memo.signals,
      memo.evidence.regions,
      memo.answers,
    );
    const plan = await this.planFor(c, tab, view, true);
    await this.d.tabs.update(tabId, (t) => {
      t.plan = plan;
    });
    const zoom = plan.ops.find(
      (p) => p.op === 'page_zoom' && p.mode === 'auto',
    );
    if (zoom) await this.applyZoom(tabId, zoom);
    else await this.resetZoom(tabId);
    const reply = await this.d.port.sendToTab(tabId, {
      type: 'sw:plan',
      plan,
      reason: 'settings',
    });
    if (reply) await this.processChanges(tabId, reply.changes);
    else await this.afterChange(tabId);
    return true;
  }

  /** Clear "undone this session" so an explicit turn-on applies right away. */
  private async clearSessionOff(
    domain: string,
    ops: readonly OpId[],
  ): Promise<void> {
    await this.d.stores.sites.update(domain, (s) => {
      for (const op of ops) {
        const dop = s.state.ops[op];
        if (dop) delete dop.sessionOff;
      }
    });
    await this.d.tabs.all().then(async (all) => {
      for (const t of all)
        if (t.domain === domain)
          await this.d.tabs.update(t.tabId, (x) => {
            x.undoneByYou = x.undoneByYou.filter((o) => !ops.includes(o));
          });
    });
  }

  async setLevel(
    tabId: number,
    op: OpId,
    level: number,
    scope: 'site' | 'everywhere',
  ): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    const max = OP_CATALOG[op].levels.length - 1;
    const next = Math.max(0, Math.min(max, Math.round(level)));
    const current =
      appliedChanges(tab.changes).find((c) => c.op === op)?.level ??
      tab.plan?.ops.find((p) => p.op === op)?.level ??
      next;
    if (scope === 'everywhere') {
      await this.d.stores.settings.update((s) => ({
        ...s,
        globalLevels: { ...s.globalLevels, [op]: next },
      }));
    }
    if (tab.domain) {
      await this.d.stores.sites.update(tab.domain, (s) => {
        if (scope === 'site') s.rule.levels = { ...s.rule.levels, [op]: next };
        if (!s.rule.pins.includes(op)) s.rule.pins = [...s.rule.pins, op];
        s.rule.blocks = s.rule.blocks.filter((b) => b !== op);
        s.rule.updatedAt = this.now;
      });
      await this.clearSessionOff(tab.domain, [op]);
      await this.d.tabs.update(tabId, (t) => {
        const prev = t.levelEdits[op];
        t.levelEdits[op] = {
          from: prev?.from ?? current,
          to: next,
          at: this.now,
        };
      });
      await this.record(tab, [
        {
          cat: tab.category,
          op,
          level: next,
          src: 'manual',
          kind: 'intensity_change',
          fromLevel: current,
          toLevel: next,
          dir: next >= current ? 1 : -1,
        },
      ]);
    }
    if (!(await this.replan(tabId)))
      await this.d.port.sendToTab(tabId, {
        type: 'sw:set-level',
        op,
        level: next,
      });
    await this.afterChange(tabId);
  }

  async toggleOps(
    tabId: number,
    ops: readonly OpId[],
    on: boolean,
    scope: 'site' | 'everywhere',
    levels: Partial<Record<OpId, number>> = {},
  ): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    const events: EventInput[] = [];
    for (const op of ops) {
      const base = {
        cat: tab.category,
        op,
        level: levels[op] ?? 0,
        src: 'manual' as const,
      };
      if (on) {
        events.push({ ...base, kind: 'manual_on' });
        if (scope === 'everywhere')
          events.push({ ...base, kind: 'promotion_answer', answer: 'yes' });
      } else {
        events.push({
          ...base,
          kind: scope === 'everywhere' ? 'global_disable' : 'site_disable',
        });
      }
    }
    if (tab.domain) {
      await this.d.stores.sites.update(tab.domain, (s) => {
        const set = new Set(ops);
        if (on) {
          s.rule.pins = [...new Set([...s.rule.pins, ...ops])];
          s.rule.blocks = s.rule.blocks.filter((b) => !set.has(b));
          for (const [op, l] of Object.entries(levels) as Array<[OpId, number]>)
            if (s.rule.levels[op] === undefined)
              s.rule.levels = { ...s.rule.levels, [op]: l };
        } else {
          s.rule.pins = s.rule.pins.filter((p) => !set.has(p));
          if (scope === 'site')
            s.rule.blocks = [...new Set([...s.rule.blocks, ...ops])];
        }
        s.rule.updatedAt = this.now;
      });
      if (on) await this.clearSessionOff(tab.domain, ops);
      await this.record(tab, events);
    }
    if (scope === 'everywhere') await this.reconcileRegistration();
    await this.replan(tabId);
    await this.afterChange(tabId);
  }

  /** "Use these on every site": this site's levels and switches become the default. */
  async useEverywhere(tabId: number): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain) return;
    const site = await this.d.stores.sites.get(tab.domain);
    await this.d.stores.settings.update((s) => ({
      ...s,
      globalLevels: { ...s.globalLevels, ...site.rule.levels },
    }));
    if (site.rule.pins.length > 0)
      await this.toggleOps(
        tabId,
        site.rule.pins,
        true,
        'everywhere',
        site.rule.levels,
      );
    else await this.afterChange(tabId);
  }

  async quick(
    tabId: number,
    key: keyof typeof QUICK,
    on: boolean,
  ): Promise<void> {
    const q = QUICK[key];
    await this.toggleOps(
      tabId,
      q.ops,
      on,
      'site',
      q.level as Partial<Record<OpId, number>>,
    );
  }

  async pauseSite(tabId: number, paused: boolean): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain) return;
    await this.d.stores.sites.update(tab.domain, (s) => {
      s.rule.paused = paused;
      s.rule.updatedAt = this.now;
    });
    if (paused) {
      await this.resetZoom(tabId);
      await this.d.port.sendToTab(tabId, { type: 'sw:pause' });
      await this.d.tabs.update(tabId, (t) => {
        t.changes = [];
        t.offer = null;
      });
    } else if (!tab.engine) {
      // The page loaded while paused, so the engine never ran here: start it now
      // (opening the popup granted this tab to WebAble).
      await this.reconcileRegistration();
      const settings = await this.d.stores.settings.read();
      const ok =
        settings.enabled &&
        tab.access === 'web' &&
        (await this.injectOnce(tabId));
      await this.d.tabs.update(tabId, (t) => {
        if (ok) {
          t.engine = true;
          t.phase = 'checking';
          t.checkingSince = this.now;
          t.needsReload = false;
        } else t.needsReload = true;
      });
    } else {
      const reply = await this.d.port.sendToTab(tabId, { type: 'sw:resume' });
      const replanned = await this.replan(tabId);
      if (!replanned) {
        if (reply && reply.changes.length > 0)
          await this.processChanges(tabId, reply.changes);
        else
          await this.d.tabs.update(tabId, (t) => {
            t.needsReload = true;
          });
      }
    }
    await this.reconcileRegistration();
    await this.afterChange(tabId);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.d.stores.settings.update((s) => ({ ...s, enabled }));
    for (const tab of await this.d.tabs.all()) {
      if (!tab.engine) continue;
      if (!enabled) {
        await this.resetZoom(tab.tabId);
        await this.d.port.sendToTab(tab.tabId, { type: 'sw:pause' });
        await this.d.tabs.update(tab.tabId, (t) => {
          t.changes = [];
          t.offer = null;
        });
      } else {
        await this.d.port.sendToTab(tab.tabId, { type: 'sw:resume' });
        if (!(await this.replan(tab.tabId)))
          await this.d.tabs.update(tab.tabId, (t) => {
            t.needsReload = true;
          });
      }
    }
    await this.reconcileRegistration();
    await this.refreshAllBadges();
    this.d.port.broadcast({ type: 'ui:changed', tabId: null });
  }

  async rate(
    tabId: number,
    op: OpId,
    rating: 'helped' | 'not_helped',
  ): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    const c = tab.changes.find((x) => x.op === op);
    await this.record(tab, [
      {
        cat: tab.category,
        op,
        level: c?.level ?? 0,
        src: 'manual',
        kind: 'rating',
        rating,
      },
    ]);
  }

  async setPrefs(p: {
    theme?: Settings['theme'];
    reduceMotion?: boolean;
  }): Promise<Prefs> {
    await this.d.stores.settings.update((s) => ({
      ...s,
      ...(p.theme ? { theme: p.theme } : {}),
      ...(typeof p.reduceMotion === 'boolean'
        ? { reduceMotion: p.reduceMotion }
        : {}),
    }));
    this.d.port.broadcast({ type: 'ui:changed', tabId: null });
    return this.prefs();
  }

  async system(signals: SystemSignals): Promise<void> {
    const changed = await noteSystemSignals(this.d.stores, signals, this.now);
    if (changed) await this.reconcileRegistration();
  }

  /** A page's own environment reports OS preferences too (no popup needed). */
  private async noteEnv(env: PageSignals['env']): Promise<void> {
    const prev = await this.d.stores.system.read();
    const next: SystemSignals = {
      reducedMotion: env.reducedMotion,
      colorScheme: env.colorScheme,
      forcedColors: env.forcedColors,
      moreContrast: prev?.moreContrast ?? false,
      deviceClass: prev?.deviceClass ?? 'laptop',
      input: prev?.input ?? 'mouse',
    };
    await this.system(next);
  }

  async welcome(): Promise<WelcomeState> {
    this.allSitesCache = null;
    const [account, settings] = await Promise.all([
      this.d.stores.account.read(),
      this.d.stores.settings.read(),
    ]);
    return {
      allSites: await this.allSites(),
      connected: account !== null && !account.needsReauth,
      email: account?.email ?? null,
      enabled: settings.enabled,
      links: this.links(),
      prefs: await this.prefs(),
    };
  }

  /** After the person granted all-sites access: register, then adapt open tabs. */
  /**
   * Inject the engine into one open tab, at most once per few seconds per tab:
   * the welcome page, the popup and permissions.onAdded can all ask at once,
   * and two engines on one page must never happen.
   */
  private async injectOnce(
    tabId: number,
    prePaint?: readonly OpId[],
  ): Promise<boolean> {
    const last = this.injectedAt.get(tabId);
    if (last !== undefined && this.now - last < INJECT_DEDUPE_MS) return true;
    this.injectedAt.set(tabId, this.now);
    const ok = await this.d.registration.inject(
      tabId,
      prePaint ?? (await this.prePaintOps()),
    );
    if (!ok) this.injectedAt.delete(tabId);
    return ok;
  }

  async grantedAllSites(): Promise<WelcomeState> {
    this.granting ??= this.grantAll().finally(() => {
      this.granting = null;
    });
    await this.granting;
    return this.welcome();
  }

  private async grantAll(): Promise<void> {
    await this.reconcileRegistration(true);
    const prePaint = await this.prePaintOps();
    const settings = await this.d.stores.settings.read();
    if (settings.enabled && (await this.allSites())) {
      for (const t of await this.d.registration.openTabs()) {
        const access = classifyUrl(t.url);
        if (access.kind !== 'web') continue;
        const known = await this.d.tabs.peek(t.id);
        if (known?.engine) continue;
        const alive = await this.d.port.sendToTab(
          t.id,
          { type: 'sw:get-changes' },
          500,
        );
        if (alive) continue;
        await this.injectOnce(t.id, prePaint);
      }
    }
    await this.refreshAllBadges();
  }

  /**
   * Site access changed in Chrome (the welcome page, the popup, or Chrome's own
   * settings). A new all-sites grant also adapts the tabs already open, even if
   * the page that asked closed before the prompt returned.
   */
  async permissionsChanged(): Promise<void> {
    const before = this.allSitesCache;
    this.allSitesCache = null;
    const now = await this.allSites();
    if (now && before !== true) await this.grantedAllSites();
    else {
      await this.reconcileRegistration(true);
      await this.refreshAllBadges();
    }
    this.d.port.broadcast({ type: 'ui:changed', tabId: null });
  }

  async focusLayer(tabId: number): Promise<void> {
    await this.d.port.sendToTab(tabId, { type: 'sw:focus-layer' });
  }

  // =========================================================================
  // Account events
  // =========================================================================

  /** The profile or learning sources changed (sync, recalibration, sign-in). */
  async profileChanged(): Promise<void> {
    const profile = await loadProfile(this.d.stores, this.now);
    await ensureLearning(this.d.stores, profile, this.now);
    await this.reconcileRegistration();
    await this.refreshAllBadges();
    this.d.port.broadcast({ type: 'ui:changed', tabId: null });
  }

  /**
   * Test-only (e2e builds; the router refuses `e2e:*` otherwise): reset local
   * state, seed a calibrated profile, and optionally an account mirror (no
   * session: page analysis stays off).
   */
  async e2eSeed(input: {
    profile?: unknown;
    reset?: boolean;
    account?: unknown;
  }): Promise<{ ok: boolean }> {
    if (!this.d.config.e2e) return { ok: false };
    if (input.reset) {
      const s = this.d.stores;
      await Promise.all([
        s.sites.clear(),
        s.events.clear(),
        s.learning.clear(),
        s.offers.clear(),
        s.profile.clear(),
        s.settings.clear(),
        s.account.clear(),
        s.answers.clear(),
        s.receipts.clear(),
        s.activity.clear(),
        this.breaker.clear(),
        this.d.undos.clear(),
        s.local.remove([KEYS.auth]),
      ]);
    }
    if (input.account !== undefined) {
      const account = normalizeAccount(input.account);
      if (input.account !== null && !account) return { ok: false };
      await this.d.stores.account.write(account);
    }
    if (input.profile !== undefined) {
      const parsed = fitProfileSchema.safeParse(input.profile);
      if (!parsed.success) return { ok: false };
      await this.d.stores.profile.write({
        profile: parsed.data,
        source: 'account',
        version: 1,
        fetchedAt: this.now,
      });
      await this.d.stores.learning.clear();
    }
    await this.profileChanged();
    return { ok: true };
  }

  /** How long a still-open checking state has lasted, for tests and diagnostics. */
  async tabRecord(tabId: number): Promise<TabRecord | undefined> {
    return this.d.tabs.peek(tabId);
  }

  offerBudgetLeft(budgetToday: number): boolean {
    return budgetToday < K.OFFERS_PER_DAY;
  }
}
