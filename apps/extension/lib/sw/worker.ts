import { heuristicSpec } from '@webable/core/compose/heuristic';
import type {
  SpecEnvelope,
  StoredSpec,
  ValidatedSpec,
} from '@webable/core/compose/spec';
import {
  validateSpec,
  type ValidateSpecContext,
} from '@webable/core/compose/validate';
import { triageLine } from '@webable/core/explain/templates';
import { solveFitLayout } from '@webable/core/fit/solver';
import { structureNeed } from '@webable/core/fit/structure';
import type { FitLayout } from '@webable/core/fit/types';
import { levelValue, toDay } from '@webable/core/learning/learners';
import { subtractCounts } from '@webable/core/learning/math';
import { FRICTION_LR, K, W } from '@webable/core/learning/params';
import type { SiteRule, UserLearningState } from '@webable/core/learning/types';
import { OP_CATALOG, RETIRED_OPS, type OpId } from '@webable/core/ops/catalog';
import { isExcludedSite } from '@webable/core/page/excluded';
import type { PageSignals } from '@webable/core/page/types';
import { buildPlan, type PolicyInput } from '@webable/core/policy/decide';
import type {
  AdaptationPlan,
  AnalysisLabel,
  AppliedChange,
  PlannedOp,
  RegionVerdict,
} from '@webable/core/policy/types';
import { fitUiVars } from '@webable/core/profile/describe';
import {
  fitProfileSchema,
  type FitProfile,
} from '@webable/core/profile/schema';
import type { SystemSignals } from '@webable/core/profile/defaults';
import { fromStoredSpec, toStoredSpec } from '@webable/core/skeleton/locate';
import { pathShape } from '@webable/core/skeleton/template';
import type { Skeleton } from '@webable/core/skeleton/types';
import { triage } from '@webable/core/triage/triage';
import type { TriageVerdict } from '@webable/core/triage/types';
import {
  COMPOSE_SCHEMA_VERSION,
  SKELETON_VERSION,
} from '@webable/core/versions';

import type {
  ContentReplies,
  FitViewEvent,
  FitViewOpenReason,
  FitViewOpenReply,
  FitViewUnavailable,
  HelloReply,
  PageEvidence,
} from '../protocol';
import { normalizeAccount, type AccountRecord } from '../storage/account';
import { offersToday } from '../storage/activity';
import { randomId } from '../storage/crypto';
import { addDefect, addKeep } from '../storage/fitlearning';
import type { LocalStores } from '../storage';
import { FIT_TEXT_STEPS_MAX, type Settings } from '../storage/settings';
import {
  pruneTemplates,
  type SiteRecord,
  type TemplateMemo,
  type TriagePrior,
} from '../storage/sites';
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
  composeKey,
  nameHasher,
  pageAnswerKey,
  pageSignature,
  regionAnswerKey,
  siteKey,
  templateKey,
} from './cachekeys';
import type { ChromePort } from './chrome';
import {
  buildComposeRequest,
  callCompose,
  type ComposeOutcome,
} from './compose';
import type { SwConfig } from './config';
import {
  applyRefinement,
  diffRefinement,
  HARD_TIMEOUT_MS,
  limitLateAnalysis,
  refinementMode,
} from './deadline';
import { classifyUrl } from './domain';
import {
  autoArrival,
  closeOutcome,
  countsFor,
  fitViewArrival,
  fitViewTabState,
  focusNode,
  forPageView,
  blockingOverlay,
  hasPasswordField,
  HARD_BLOCKERS,
  personOpened,
  regionRoles,
  type ComposeInflight,
  type FitViewState,
  type FitViewStates,
  type InflightWaiter,
} from './fitview';
import {
  analysisConsumers,
  CHECKOUT_P,
  composeGate,
  gate,
  isMailOrChat,
  PLANNER_UNAVAILABLE,
  type ComposeGateInput,
} from './gating';
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
import { neededKeys, UndoHold, type HeldUndo, type UndoReason } from './undo';
import {
  firstScale,
  fromPrior,
  guardVerdict,
  isZoomReset,
  noBodyText,
  OwnZoom,
  sameFactor,
  stepDown,
  tabFactor,
  toPrior,
  widthBucket,
  withScale,
  zoomLevel,
  type GuardReport,
} from './zoom';
import { KEYS } from '../storage/keys';

/** Site-access and registration operations (lib/sw/permissions.ts in production). */
export interface Registration {
  hasAllSites(): Promise<boolean>;
  reconcile(
    prePaint: readonly OpId[],
    pausedDomains: readonly string[],
  ): Promise<void>;
  inject(tabId: number, prePaint: readonly OpId[]): Promise<boolean>;
  /**
   * Fit view's renderer (isolated world) and key bridge (MAIN world) into the
   * tab's top frame; false when either could not be injected.
   */
  injectFitView(tabId: number): Promise<boolean>;
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
  /** Fit view state per tab (storage.session, one key per tab). */
  fitViews: FitViewStates;
  /** Layout-planner calls in flight, by cache key (storage.session). */
  inflight: ComposeInflight;
  port: ChromePort;
  registration: Registration;
  auth: AuthService | null;
  sync: AccountSync | null;
  now: () => number;
  fetch?: typeof fetch;
  /**
   * Fit view's face, Atkinson Hyperlegible Next (woff2, base64), or null when
   * the build has none. Sent once per document.
   */
  font?: () => string | null | Promise<string | null>;
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

const pct = (factor: number): string => `${Math.round(factor * 100)}%`;

/** A URL's host ('' when it has none). Used, never stored. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * The plan as the content script receives it. Its triage keeps what the page
 * acts on (the verdict, whether the page can be re-presented, the page scale
 * and the blockers); k, the need bands and the reasons derive from the fit,
 * which never reaches the page (docs/10 §4.2), so they are blanked: k null,
 * residual 1, every band 'fits', no reasons.
 */
export function toContent(plan: AdaptationPlan): AdaptationPlan {
  const t = plan.triage;
  if (!t) return plan;
  const needs = Object.fromEntries(
    Object.keys(t.needs).map((need) => [need, 'fits']),
  ) as TriageVerdict['needs'];
  return {
    ...plan,
    triage: {
      version: t.version,
      verdict: t.verdict,
      k: null,
      zoom: t.zoom,
      zMax: t.zoom,
      residual: 1,
      needs,
      reasons: [],
      representable: t.representable,
      blockers: [...t.blockers],
    },
  };
}

/** The fit with Fit view's own Text − / + override applied (docs/10 §7). */
function withTextStep(profile: FitProfile, step: number): FitProfile {
  const s = Math.max(
    -FIT_TEXT_STEPS_MAX,
    Math.min(FIT_TEXT_STEPS_MAX, Math.round(step)),
  );
  if (s === 0) return profile;
  const p = structuredClone(profile);
  p.vision.textMinPx.value =
    Math.round(p.vision.textMinPx.value * FIT_TEXT_STEP_RATIO ** s * 2) / 2;
  return p;
}

/** Each Text − / + press in Fit view (the view's own ratio). */
const FIT_TEXT_STEP_RATIO = 1.125;

/** The page-analysis label a change's decision rested on, if any. */
function aiLabelOf(c: {
  trace: PlannedOp['trace'];
}): AnalysisLabel | undefined {
  for (const e of c.trace.evidence)
    if (e.kind === 'region_role' && e.by === 'page_analysis' && e.label)
      return e.label;
  return undefined;
}

/** decide or compose answered 503 without a retry time: back off this long. */
const UNAVAILABLE_BACKOFF_MS = 5 * 60_000;

/** A cached planner spec is reused only when this share of its locators resolve (docs/10 §6). */
export const PLANNER_MIN_COVERAGE = 0.8;

/** One planner call: the reading it plans and where its answer goes. */
interface PlannerJob {
  tabId: number;
  tabSession: string;
  domain: string;
  /** HMAC site key (tags the cached spec for "Forget this site"). */
  site: string;
  /** Planner cache key of the template. */
  key: string;
  skeleton: Skeleton;
  hash: (key: string) => string;
  ctx: ValidateSpecContext;
}

interface PlannerResult {
  stored: StoredSpec;
  /** Validated against the job's own skeleton. */
  validated: ValidatedSpec;
}

/** A tab is injected at most once in this window (several paths can ask at once). */
const INJECT_DEDUPE_MS = 5_000;

/** A back/forward commit waits this long for a restored engine's hello. */
export const RESTORE_WAIT_MS = 2_000;

/** The op behind each popup quick switch. */
const QUICK_OP = {
  text: 'text_floor',
  targets: 'target_size',
  calm: 'calm_motion',
} as const satisfies Record<keyof typeof QUICK, OpId>;

/** Levels "Use these on every site" can set (the Adjust sliders). */
const GLOBAL_OVERRIDE_OPS = [
  'text_floor',
  'line_spacing',
  'target_size',
] as const;

/** The measurement a page memo came from: an SPA route change measures again. */
const memoId = (m: PageMemo): string => m.id;

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

/** chrome.commands, when this context has it (absent in unit tests). */
interface CommandsApi {
  getAll(): Promise<Array<{ name?: string; shortcut?: string }>>;
}

/** The two keyboard shortcuts as Chrome reports them now ('' when unset). */
async function commandShortcuts(): Promise<HelloReply['shortcuts']> {
  const api = (globalThis as { chrome?: { commands?: Partial<CommandsApi> } })
    .chrome?.commands;
  let all: Array<{ name?: string; shortcut?: string }> = [];
  try {
    if (typeof api?.getAll === 'function') all = await api.getAll();
  } catch {
    all = [];
  }
  const of = (name: string): string =>
    all.find((c) => c.name === name)?.shortcut ?? '';
  return {
    focusLayer: of('focus-layer'),
    undoAll: of('undo-all'),
    fitView: of('toggle-fit-view'),
  };
}

export class Worker {
  private readonly breaker: JsonStore<BreakerState>;
  /** The layout planner's own breaker (an OpenAI outage never silences page analysis). */
  private readonly composeBreaker: JsonStore<BreakerState>;
  /** Zoom factors WebAble just set, so their onZoomChange is not the person's. */
  private readonly ownZoom = new OwnZoom();
  /**
   * The last skeleton per tab (memory only): a planner spec that lands for
   * another tab's extraction is re-bound to it here.
   */
  private readonly skeletons = new Map<number, Skeleton>();
  private allSitesCache: boolean | null = null;
  private lastRegistration = '';
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly injectedAt = new Map<number, number>();
  private readonly analyzing = new Set<number>();
  /**
   * Per-tab queue for page-view boundaries. A navigation commit and the new
   * page's hello arrive close together; run concurrently, the commit's reset
   * could land after the hello and erase the new page view, which then never
   * adapts.
   */
  private readonly tabQueues = new Map<number, Promise<unknown>>();

  private serial<T>(tabId: number, run: () => Promise<T>): Promise<T> {
    const next = (this.tabQueues.get(tabId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(run);
    this.tabQueues.set(tabId, next);
    void next
      .catch(() => undefined)
      .then(() => {
        if (this.tabQueues.get(tabId) === next) this.tabQueues.delete(tabId);
      });
    return next;
  }
  private granting: Promise<void> | null = null;

  constructor(private readonly d: WorkerDeps) {
    this.breaker = new JsonStore(
      d.stores.local,
      KEYS.breaker,
      normalizeBreaker,
    );
    this.composeBreaker = new JsonStore(
      d.stores.local,
      KEYS.composeBreaker,
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
    verdict: TriageVerdict | undefined,
    scale: number,
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
      ...(verdict ? { triage: verdict } : {}),
      scale,
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
   * The page scale is triage's for this page, frozen for the page view, never
   * a learned level, so it takes no part in the level hysteresis. `scale` is
   * WebAble's page scale when the page was read (PageMemo.scale).
   */
  private async planFor(
    c: Ctx,
    tab: TabRecord,
    view: AnalysisView,
    persist: boolean,
    verdict: TriageVerdict | undefined,
    scale: number,
  ): Promise<AdaptationPlan> {
    const raw = buildPlan(
      await this.policyInput(
        c,
        tab,
        view.signals,
        view.verdicts,
        verdict,
        scale,
      ),
    );
    const { plan, memo } = stabilizeLevels({
      plan: { ...raw, ops: raw.ops.filter((p) => p.op !== 'page_zoom') },
      memo: c.site.levelMemo,
      seed: c.profile.identity,
      tabSession: tab.tabSession ?? 'none',
      manual: c.rule.levels,
    });
    const held = new Map(plan.ops.map((p) => [p.op, p] as const));
    const ops = raw.ops.map((p) => held.get(p.op) ?? p);
    if (
      persist &&
      tab.domain &&
      JSON.stringify(memo) !== JSON.stringify(c.site.levelMemo)
    ) {
      await this.d.stores.sites.update(tab.domain, (s) => {
        s.levelMemo = memo;
      });
    }
    return this.withAccepted({ ...plan, ops }, tab);
  }

  // =========================================================================
  // Triage and page scale (docs/10 §3, §5.1)
  // =========================================================================

  /**
   * The cached verdict for this page's template, for hysteresis (same profile
   * identity only): as it stood when this page view first read the template,
   * so a reading taken while the page was still loading never holds back the
   * readings after it.
   */
  private priorOf(c: Ctx, tab: TabRecord): TriageVerdict | null {
    const key = tab.template?.key;
    const prior =
      key && tab.viewPrior?.key === key
        ? tab.viewPrior.prior
        : this.storedPrior(c, key);
    return prior ? fromPrior(prior) : null;
  }

  private storedPrior(c: Ctx, key: string | undefined): TriagePrior | null {
    const memo = key ? c.site.templates[key] : undefined;
    return memo?.prior && memo.id === c.profile.identity ? memo.prior : null;
  }

  /**
   * Triage for a reading of this page view. Once the page view has decided
   * its page scale, every later plan carries that scale (frozen: no re-zoom
   * on SPA routes or re-plans). Before that, a scale already on the tab
   * (applied at hello on a repeat visit) is kept when triage's choice is
   * within one preset of it. A page view whose scale waited for body text
   * (an SPA shell, settleScale) and that the person has used since keeps
   * the scale the tab shows: nothing jumps under their pointer.
   */
  private verdictFor(
    c: Ctx,
    tab: TabRecord,
    signals: PageSignals,
    scale: number,
  ): TriageVerdict {
    const raw = triage({
      profile: c.profile.profile,
      signals,
      zoom: signals.viewport.zoom,
      prior: this.priorOf(c, tab),
      scale,
    });
    if (tab.scale) return withScale(raw, tab.scale.z);
    const held = tab.zoom && !tab.zoom.legacy ? tab.zoom.z : null;
    const waited = tab.plan !== null && noBodyText(tab.plan.triage);
    if (waited && tab.interactedAt !== null) return withScale(raw, held ?? 1);
    return withScale(raw, firstScale(raw.zoom, held));
  }

  /** A plan for the page view's last reading, with its triage (re-plans, friction, refinement). */
  private async planMemo(
    c: Ctx,
    tab: TabRecord,
    memo: PageMemo,
    persist: boolean,
  ): Promise<AdaptationPlan> {
    const view = analysisView(
      memo.signals,
      memo.evidence.regions,
      memo.answers,
    );
    const scale = memo.scale ?? 1;
    const verdict = this.verdictFor(c, tab, view.signals, scale);
    const plan = await this.planFor(c, tab, view, persist, verdict, scale);
    return tab.scale ? this.withFrozenScale(plan, tab) : plan;
  }

  /**
   * A later plan keeps the page view's scale. Triage already carries it; this
   * covers a plan whose page_zoom changed mode for another reason (the scale
   * stays as applied, or stays off).
   */
  private withFrozenScale(
    plan: AdaptationPlan,
    tab: TabRecord,
  ): AdaptationPlan {
    const z = tab.scale?.z ?? 1;
    const auto = plan.ops.find(
      (p) => p.op === 'page_zoom' && p.mode === 'auto',
    );
    if (z > 1 && tab.zoom && !auto) {
      const prev = tab.plan?.ops.find((p) => p.op === 'page_zoom');
      if (!prev) return plan;
      return {
        ...plan,
        ops: [
          ...plan.ops.filter((p) => p.op !== 'page_zoom'),
          { ...prev, mode: 'auto' },
        ],
        zoom: z,
      };
    }
    if (!(z > 1) && auto)
      return {
        ...plan,
        ops: plan.ops.filter((p) => p.op !== 'page_zoom'),
        zoom: 1,
      };
    return plan;
  }

  /**
   * After a page view's first plan with body text (or a re-decision the
   * person asked for): freeze its page scale and put it on the tab, or take
   * a scale that no longer applies off. Later plans leave the tab's zoom
   * alone, except that a frozen scale missing from the tab goes back on
   * (reapplyScale).
   */
  private async settleScale(
    tabId: number,
    plan: AdaptationPlan,
  ): Promise<AdaptationPlan> {
    await this.reapplyScale(tabId, plan);
    const tab = await this.d.tabs.get(tabId);
    if (tab.scale) return this.withFrozenScale(plan, tab);
    // Fit view holds the tab at the person's zoom: decide once it closes.
    if (tab.zoom?.suspended) return plan;
    // No body text yet (an SPA's shell, its content still to render): the
    // scale is decided at the first reading that has some, never frozen at
    // 1 by an empty page. A scale already on the tab (hello's, on a repeat
    // visit) stays there undecided; the plan names none, so the page guards
    // the scale once it is decided, with its content in place.
    if (noBodyText(plan.triage))
      return {
        ...plan,
        ops: plan.ops.filter((p) => p.op !== 'page_zoom'),
        zoom: 1,
      };
    const op = plan.ops.find((p) => p.op === 'page_zoom' && p.mode === 'auto');
    const z = op ? levelValue('page_zoom', op.level) : 1;
    await this.d.tabs.update(tabId, (t) => {
      t.scale = { z, stepped: false, checked: false };
    });
    if (op && z > 1) await this.applyZoom(tabId, op, z);
    else if (tab.zoom) await this.restoreZoom(tabId);
    return plan;
  }

  /**
   * A page view's frozen scale that is not on the tab (pausing or turning
   * WebAble off took it off, keeping the decision) goes back on, as `plan`
   * applies it; without page_zoom in the plan it is 1 from now on.
   */
  private async reapplyScale(
    tabId: number,
    plan: AdaptationPlan | null,
  ): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.scale || !(tab.scale.z > 1) || tab.zoom) return;
    const op = plan?.ops.find((p) => p.op === 'page_zoom' && p.mode === 'auto');
    if (op) await this.applyZoom(tabId, op, tab.scale.z);
    await this.d.tabs.update(tabId, (t) => {
      if (t.scale && !t.zoom) t.scale = { ...t.scale, z: 1, checked: false };
    });
  }

  /**
   * A page view about to open in Fit view (docs/10 §4.6, docs/11 §2): Fit
   * view holds the tab at the person's own zoom, so the page scale is not put
   * on the tab now. It stays undecided until the view closes (the next plan
   * settles it); the plan carries the scale already on the tab, if any.
   */
  private async holdScale(
    tabId: number,
    plan: AdaptationPlan,
  ): Promise<AdaptationPlan> {
    const tab = await this.d.tabs.get(tabId);
    if (tab.scale) return this.withFrozenScale(plan, tab);
    // A scale already on the tab (hello's, on a repeat visit) stays there
    // until the view suspends it.
    if (tab.zoom && !tab.zoom.suspended) return { ...plan, zoom: tab.zoom.z };
    return {
      ...plan,
      ops: plan.ops.filter((p) => p.op !== 'page_zoom'),
      zoom: 1,
    };
  }

  /**
   * Remember this template's verdict (the next visit's hysteresis prior) and
   * the page scale that holds here for this window width (applied at hello
   * on the next visit). Kept for the profile identity they belong to.
   */
  private async rememberTemplate(
    tabId: number,
    identity: string,
    verdict: TriageVerdict | undefined,
  ): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    const template = tab.template;
    if (!tab.domain || !template) return;
    // A scale held for Fit view is triage's choice, not yet decided here.
    const z = tab.scale?.z ?? verdict?.zoom ?? 1;
    await this.d.stores.sites.update(tab.domain, (s) => {
      const prev = s.templates[template.key];
      const memo: TemplateMemo =
        prev && prev.id === identity
          ? { ...prev, at: this.now }
          : { at: this.now, id: identity };
      if (verdict) memo.prior = toPrior(withScale(verdict, z));
      else if (memo.prior) memo.prior = { ...memo.prior, zoom: z };
      if (template.bucket !== null) {
        const zoom = { ...memo.zoom };
        delete zoom[String(template.bucket)];
        if (z > 1) zoom[String(template.bucket)] = z;
        const kept = Object.entries(zoom).slice(-4);
        if (kept.length > 0) memo.zoom = Object.fromEntries(kept);
        else delete memo.zoom;
      }
      s.templates = pruneTemplates({ ...s.templates, [template.key]: memo });
    });
  }

  /** This page's template key (site + path shape, hashed) and window-width bucket. */
  private async templateOf(
    domain: string,
    url: string | undefined,
    widthDip: number | null,
  ): Promise<{ key: string; bucket: number | null }> {
    const install = await this.d.stores.install.get();
    const site = await siteKey(install.secret, domain);
    const key = await templateKey(install.secret, site, pathShape(url ?? ''));
    return { key, bucket: widthBucket(widthDip) };
  }

  /**
   * Put a page scale on the tab: the person's own zoom times z, per tab.
   * Records the page_zoom change (and its 'applied' event the first time).
   */
  private async applyZoom(
    tabId: number,
    planned: PlannedOp,
    z: number,
  ): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    const previous = tab.zoom?.previous ?? (await this.d.port.getZoom(tabId));
    const factor = tabFactor(previous, z);
    if (!tab.zoom || !sameFactor(tab.zoom.factor, factor)) {
      this.ownZoom.expect(tabId, factor, this.now);
      try {
        await this.d.port.setZoom(tabId, factor);
      } catch {
        return;
      }
      this.zoomMessage(tabId, factor, 'webable', z);
    }
    const level = zoomLevel(z);
    const change: AppliedChange = {
      op: 'page_zoom',
      level,
      mode: planned.mode,
      status: 'applied',
      count: 1,
      fit: { before: pct(previous), after: pct(factor) },
      trace: { ...planned.trace, level },
    };
    const fresh = !tab.changes.some(
      (c) => c.op === 'page_zoom' && c.status === 'applied',
    );
    await this.d.tabs.update(tabId, (t) => {
      t.zoom = {
        level,
        z,
        factor,
        previous,
        early: false,
        suspended: false,
      };
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

  /**
   * The person changed what the page scale rests on (its level, the fit, a
   * redo): the next plan of these tabs decides the scale again.
   */
  private async unfreezeScale(tabIds: readonly number[]): Promise<void> {
    for (const id of tabIds)
      await this.d.tabs.update(id, (t) => {
        t.scale = null;
      });
  }

  /**
   * The person's own zoom in this tab: the tab's zoom without WebAble's page
   * scale (their per-origin factor, the baseline the scale multiplies).
   */
  private async personZoom(tabId: number): Promise<number> {
    const tab = await this.d.tabs.get(tabId);
    return tab.zoom ? tab.zoom.previous : this.d.port.getZoom(tabId);
  }

  /**
   * A plan as the page receives it (toContent), with the person's own zoom:
   * the engine sizes effective-px levels against the tab's whole zoom,
   * ownZoom x zoom, not WebAble's page scale alone (docs/10 §3.2, §5.2).
   */
  private async forPage(
    tabId: number,
    plan: AdaptationPlan,
  ): Promise<AdaptationPlan> {
    return { ...toContent(plan), ownZoom: await this.personZoom(tabId) };
  }

  /**
   * Tell the page its zoom changed (Fit view re-sizes; Tailor measures
   * again): the tab's absolute factor, and WebAble's page scale relative to
   * the person's own zoom when this change set it (1: none on the tab).
   */
  private zoomMessage(
    tabId: number,
    zoom: number,
    owner: 'webable' | 'person',
    scale?: number,
  ): void {
    void this.d.port
      .sendToTab(tabId, {
        type: 'sw:zoom',
        zoom,
        owner,
        ...(scale !== undefined ? { scale } : {}),
      })
      .catch(() => undefined);
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
    return this.serial(tabId, () => this.helloNow(tabId, frameId, url));
  }

  private async helloNow(
    tabId: number,
    frameId: number,
    url: string | undefined,
  ): Promise<HelloReply> {
    const now = this.now;
    const ui = await this.layerOptions();
    if (frameId !== 0)
      return {
        enabled: false,
        paused: true,
        prePaint: [],
        tabSession: randomId(12),
        ...ui,
      };
    await this.flushUndos();
    await this.endPageView(tabId);
    const access = classifyUrl(url);
    const settings = await this.d.stores.settings.read();
    const domain = access.kind === 'web' ? access.domain : null;
    // Chrome resets per-tab zoom when a tab navigates. A hello without that
    // (a second injection into the same document) finds WebAble's scale
    // still on the tab: keep track of it, for the first plan to confirm.
    const before = await this.d.tabs.peek(tabId);
    const old =
      before?.zoom &&
      !before.zoom.suspended &&
      !before.zoom.legacy &&
      before.domain === domain
        ? before.zoom
        : null;
    const stillOn =
      old !== null && sameFactor(await this.d.port.getZoom(tabId), old.factor);
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
        personalSite: url ? isMailOrChat(hostOf(url)) : false,
      });
      if (stillOn && old) t.zoom = { ...old, early: true };
    });
    await this.d.pages.delete(tabId);
    const live = settings.enabled && access.kind === 'web' && !paused;
    let fitViewTab = false;
    if (live && domain && site) {
      const fit = await this.d.fitViews.get(tabId);
      fitViewTab = fit.tabMode || site.rule.view === 'fit';
      await this.earlyZoom(tabId, domain, url, site, fit).catch(
        () => undefined,
      );
    }
    void this.refreshBadge(tabId);
    this.d.port.broadcast({ type: 'ui:changed', tabId });
    return {
      enabled: settings.enabled && access.kind === 'web',
      paused,
      prePaint,
      tabSession,
      ...ui,
      fitViewTab,
    };
  }

  /**
   * A repeat visit: Chrome reset the tab's zoom on navigation, so the page
   * scale that held for this template at this window width goes back on now,
   * before the page is read (docs/10 §5.1). Also how a page restored from the
   * back/forward cache or a prerender gets it back. The first plan confirms
   * it (or takes it off).
   */
  private async earlyZoom(
    tabId: number,
    domain: string,
    url: string | undefined,
    site: SiteRecord,
    fit: FitViewState,
  ): Promise<void> {
    const template = await this.templateOf(
      domain,
      url,
      await this.d.port.tabWidth(tabId),
    );
    await this.d.tabs.update(tabId, (t) => {
      t.template = template;
    });
    if (site.rule.blocks.includes('page_zoom') || template.bucket === null)
      return;
    const memo = site.templates[template.key];
    const profile = await loadProfile(this.d.stores, this.now);
    const z = memo?.zoom?.[String(template.bucket)];
    if (!memo || memo.id !== profile.identity || !z || !(z > 1)) return;
    // This page will most likely open in Fit view, which holds the tab at the
    // person's own zoom: zooming first would only flash (docs/11 §2).
    if (
      memo.prior &&
      (await this.arrivesInFitView(domain, site, fit, fromPrior(memo.prior)))
    )
      return;
    const carried = (await this.d.tabs.get(tabId)).zoom;
    const previous = carried?.previous ?? (await this.d.port.getZoom(tabId));
    const factor = tabFactor(previous, z);
    if (carried && sameFactor(carried.factor, factor)) return;
    this.ownZoom.expect(tabId, factor, this.now);
    await this.d.port.setZoom(tabId, factor);
    await this.d.tabs.update(tabId, (t) => {
      t.zoom = {
        level: zoomLevel(z),
        z,
        factor,
        previous,
        early: true,
        suspended: false,
      };
    });
    this.zoomMessage(tabId, factor, 'webable', z);
  }

  /**
   * Fit view will open on this page by itself, from this template's last
   * verdict: tab mode or "Always here" on a page it can show, or an automatic
   * restructure (docs/11 §2). Used at hello, before the page is read.
   */
  private async arrivesInFitView(
    domain: string,
    site: SiteRecord,
    fit: FitViewState,
    verdict: TriageVerdict,
  ): Promise<boolean> {
    if (isExcludedSite(domain) || !verdict.representable) return false;
    if (fit.tabMode || site.rule.view === 'fit') return true;
    const settings = await this.d.stores.settings.read();
    const profile = await loadProfile(this.d.stores, this.now);
    return autoArrival({
      verdict,
      structure: structureNeed(profile.profile).level,
      autoSimplify: settings.autoSimplify,
      excluded: false,
      alwaysHere: false,
      tabMode: false,
      offerDeclined: fit.offerDeclined,
      declinedHere: fit.declinedSite === domain,
      autoDone: false,
      offersThisPage: 0,
      offersToday: 0,
      offersPerDay: K.OFFERS_PER_DAY,
      site: site.fitView,
      pageType: undefined,
      today: toDay(this.now),
    });
  }

  /**
   * How WebAble's own in-page layer behaves: still when the setting or the
   * fit's motion need asks for it, and the shortcuts it announces as Chrome
   * reports them ('' when unset).
   */
  private async layerOptions(): Promise<
    Pick<HelloReply, 'reduceMotion' | 'shortcuts'>
  > {
    const [settings, profile, shortcuts] = await Promise.all([
      this.d.stores.settings.read(),
      loadProfile(this.d.stores, this.now),
      commandShortcuts(),
    ]);
    const reduceMotion =
      settings.reduceMotion ||
      fitUiVars(profile.profile).attributes['data-wa-motion'] === 'reduce';
    return { reduceMotion, shortcuts };
  }

  async signals(
    tabId: number,
    frameId: number,
    signals: PageSignals,
    evidence: PageEvidence,
    url?: string,
  ): Promise<ContentReplies['cs:signals'] & { announce: boolean }> {
    return this.serial(tabId, () =>
      this.signalsNow(tabId, frameId, signals, evidence, url),
    );
  }

  private async signalsNow(
    tabId: number,
    frameId: number,
    signals: PageSignals,
    evidence: PageEvidence,
    url: string | undefined,
  ): Promise<ContentReplies['cs:signals'] & { announce: boolean }> {
    let tab = await this.d.tabs.get(tabId);
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

    // A zoom an older WebAble set (it recorded no page scale) goes back now.
    if (tab.zoom?.legacy) {
      await this.restoreZoom(tabId);
      tab = await this.d.tabs.get(tabId);
    }

    // The engine sees only pinch zoom. The person's own zoom is the tab's
    // without WebAble's page scale; the scale in effect is triage's `scale`.
    const own = tab.zoom ? tab.zoom.previous : await this.d.port.getZoom(tabId);
    const scale = tab.zoom && !tab.zoom.suspended ? tab.zoom.z : 1;
    const pinch = signals.viewport.zoom > 0 ? signals.viewport.zoom : 1;
    const measured: PageSignals = {
      ...signals,
      viewport: {
        ...signals.viewport,
        zoom: Math.round(own * pinch * 1000) / 1000,
      },
    };
    const template = await this.templateOf(
      domain,
      url,
      signals.viewport.width * own * scale,
    );
    const viewPrior =
      tab.viewPrior?.key === template.key
        ? tab.viewPrior
        : { key: template.key, prior: this.storedPrior(c, template.key) };
    tab = await this.d.tabs.update(tabId, (t) => {
      t.template = template;
      t.viewPrior = viewPrior;
      if (url) t.personalSite = isMailOrChat(hostOf(url));
      // The zoom guard compares with navigation as read at WebAble's scale 1,
      // by the reading that decides the scale (an SPA shell's has none yet).
      if (t.scale === null && scale === 1)
        t.navBaseline = signals.layout
          ? {
              links: signals.layout.nav.primaryLinks,
              search: signals.layout.nav.searchVisible,
            }
          : null;
    });
    const memo = {
      ...(await this.lookup(domain, tabSession, measured, evidence)),
      scale,
    };
    const view = analysisView(measured, evidence.regions, memo.answers);
    const verdict = this.verdictFor(c, tab, view.signals, scale);
    let plan = await this.planFor(c, tab, view, true, verdict, scale);
    if (
      tab.plan &&
      tab.signalsAt !== null &&
      refinementMode({
        dclAt: tab.signalsAt,
        answeredAt: c.now,
        interactedAt: tab.interactedAt,
      }) === 'cache_only'
    ) {
      plan = limitLateAnalysis(
        tab.plan,
        plan,
        appliedChanges(tab.changes).map((change) => change.op),
      );
    }
    await this.d.pages.set(tabId, memo);

    // How Fit view reaches this page (docs/11 §2), decided before Tailor's
    // page scale so a page that opens in Fit view is never zoomed first.
    const fit = forPageView(await this.d.fitViews.get(tabId), tabSession);
    const [budget, learned] = await Promise.all([
      this.d.stores.offers.read(),
      this.d.stores.fitLearning.read(),
    ]);
    const excluded = isExcludedSite(domain);
    const alwaysHere = c.site.rule.view === 'fit';
    const arrival = fitViewArrival({
      verdict: plan.triage,
      structure: structureNeed(c.profile.profile).level,
      autoSimplify: c.settings.autoSimplify,
      excluded,
      alwaysHere,
      tabMode: fit.tabMode,
      offerDeclined: fit.offerDeclined,
      declinedHere: fit.declinedSite === domain,
      autoDone: fit.autoSession === tabSession,
      offersThisPage: tab.offersShown,
      offersToday: offersToday(budget, toDay(c.now)),
      offersPerDay: K.OFFERS_PER_DAY,
      site: c.site.fitView,
      pageType: countsFor(learned.pageTypes, view.signals.category),
      today: toDay(c.now),
    });
    if (arrival === 'auto')
      await this.d.fitViews.update(tabId, (s) => ({
        ...forPageView(s, tabSession),
        autoSession: tabSession,
      }));
    // Tab mode and "Always here" reopen Fit view on a page it can show.
    const inFitView =
      arrival === 'auto' ||
      (!excluded &&
        (fit.tabMode || alwaysHere) &&
        plan.triage?.representable === true);

    // The page scale is decided once per page view and put on the tab before
    // the plan reaches the page; later plans (SPA routes, re-reads) keep it.
    // A page about to open in Fit view decides it once the view closes.
    plan = inFitView
      ? await this.holdScale(tabId, plan)
      : await this.settleScale(tabId, plan);
    const offer = plan.ops.find((p) => p.mode === 'offer') ?? null;
    tab = await this.d.tabs.update(tabId, (t) => {
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
    // An empty reading (an SPA's shell) is no verdict for the template's
    // next visit: it would hold that visit's scale at 1 too.
    if (!noBodyText(verdict))
      await this.rememberTemplate(tabId, c.profile.identity, verdict);

    void this.maybeAnalyze(tabId, tabSession, memo).catch(() => undefined);
    this.d.port.broadcast({ type: 'ui:changed', tabId });
    return {
      plan: await this.forPage(tabId, plan),
      announce: !c.site.announced,
      ...(arrival === 'offer' ? { fitViewOffer: true } : {}),
      ...(arrival === 'auto' ? { fitViewAuto: true } : {}),
    };
  }

  async applied(
    tabId: number,
    frameId: number,
    changes: AppliedChange[],
    viewport?: GuardReport,
  ): Promise<void> {
    if (frameId !== 0) return;
    await this.processChanges(tabId, changes);
    if (viewport) await this.zoomGuard(tabId, viewport);
  }

  /**
   * The zoom guard's report after a page scale settled (docs/10 §5.1). If the
   * page now overflows sideways, or primary navigation or the search field
   * disappeared compared with 100%, the scale steps down one preset (once per
   * page view) and the page is planned again at the new scale. A scale that
   * holds counts as the verifier passing it.
   */
  private async zoomGuard(tabId: number, report: GuardReport): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    const zoom = tab.zoom;
    if (!zoom || zoom.suspended || !tab.scale || !tab.domain) return;
    // A report about a scale that is no longer on the tab.
    if (
      !sameFactor(report.zoom, zoom.z) &&
      !sameFactor(report.zoom, zoom.factor)
    )
      return;
    const change = tab.changes.find(
      (c) => c.op === 'page_zoom' && c.status === 'applied',
    );
    const base = change
      ? {
          cat: tab.category,
          op: 'page_zoom' as const,
          level: change.level,
          src:
            change.mode === 'offer' ? ('offer' as const) : change.trace.source,
        }
      : null;
    const verdict = guardVerdict(report, tab.navBaseline);
    if (verdict === 'ok') {
      if (tab.scale.checked) return;
      await this.d.tabs.update(tabId, (t) => {
        if (t.scale) t.scale.checked = true;
      });
      if (base)
        await this.record(tab, [{ ...base, kind: 'verifier', pass: true }]);
      return;
    }
    if (tab.scale.stepped) return;
    const next = stepDown(zoom.z);
    await this.d.tabs.update(tabId, (t) => {
      t.scale = { z: next, stepped: true, checked: false };
    });
    if (next > 1) {
      const factor = tabFactor(zoom.previous, next);
      const level = zoomLevel(next);
      this.ownZoom.expect(tabId, factor, this.now);
      await this.d.port.setZoom(tabId, factor).catch(() => undefined);
      await this.d.tabs.update(tabId, (t) => {
        t.zoom = { ...zoom, level, z: next, factor, early: false };
        t.changes = t.changes.map((c) =>
          c.op === 'page_zoom' && c.status === 'applied'
            ? {
                ...c,
                level,
                vcode: verdict,
                fit: { before: pct(zoom.previous), after: pct(factor) },
                trace: { ...c.trace, level },
              }
            : c,
        );
        // The plan's scale follows, so re-plans compare against it.
        if (t.plan)
          t.plan = {
            ...t.plan,
            zoom: next,
            ops: t.plan.ops.map((p) =>
              p.op === 'page_zoom'
                ? { ...p, level, trace: { ...p.trace, level } }
                : p,
            ),
          };
      });
      this.zoomMessage(tabId, factor, 'webable', next);
    } else {
      this.ownZoom.expect(tabId, zoom.previous, this.now);
      await this.d.port
        .releaseZoom(tabId, undefined, zoom.previous)
        .catch(() => undefined);
      await this.d.tabs.update(tabId, (t) => {
        t.zoom = null;
        t.changes = t.changes.map((c) =>
          c.op === 'page_zoom' && c.status === 'applied'
            ? { ...c, status: 'undone_by_checks', vcode: verdict }
            : c,
        );
      });
      this.zoomMessage(tabId, zoom.previous, 'webable', 1);
    }
    if (base)
      await this.record(tab, [
        { ...base, kind: 'verifier', pass: false, vcode: verdict },
      ]);
    const profile = await loadProfile(this.d.stores, this.now);
    await this.rememberTemplate(tabId, profile.identity, undefined);
    // Text and targets were planned for the larger scale: plan again.
    if (!(await this.replan(tabId))) await this.afterChange(tabId);
  }

  async interacted(
    tabId: number,
    frameId: number,
    tabSession: string,
  ): Promise<void> {
    if (frameId !== 0) return;
    await this.d.tabs.update(tabId, (t) => {
      if (t.tabSession === tabSession) t.interactedAt ??= this.now;
    });
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
      await this.restoreZoom(tabId);
      await this.d.tabs.update(tabId, (t) => {
        if (!t.undoneByYou.includes('page_zoom'))
          t.undoneByYou.push('page_zoom');
      });
    }
    await this.holdUndos(tab, events);
    await this.syncSiteCount(tabId);
    await this.reflectSavedUndo(
      tab,
      events.map((e) => e.op),
    );
    await this.afterChange(tabId);
  }

  /**
   * The toast's Undo all (cs:undo-all). The engine already put the page back
   * and sends no per-change undo events: every applied change here, the tab
   * zoom included, becomes an undo held for the reason window, and nothing
   * is echoed to the page.
   */
  async undoAllOnPage(tabId: number, frameId: number): Promise<void> {
    if (frameId !== 0) return;
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || !tab.tabSession) return;
    const targets = appliedChanges(tab.changes);
    if (targets.length === 0) return;
    const events = targets.map((c) => this.undoEvent(tab, c));
    if (tab.zoom) await this.restoreZoom(tabId);
    const undone = new Set(targets.map((c) => c.op));
    await this.d.tabs.update(tabId, (t) => {
      for (const o of undone)
        if (!t.undoneByYou.includes(o)) t.undoneByYou.push(o);
      t.changes = t.changes.filter(
        (c) => !(undone.has(c.op) && c.status === 'applied'),
      );
    });
    await this.holdUndos(tab, events);
    await this.syncSiteCount(tabId);
    await this.reflectSavedUndo(
      tab,
      events.map((e) => e.op),
    );
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
    const plan = await this.planMemo(c, tab, memo, false);
    const offer = plan.ops.find(
      (p) =>
        p.mode === 'offer' &&
        ops.includes(p.op) &&
        !tab.acceptedOps.includes(p.op) &&
        !appliedChanges(tab.changes).some((c2) => c2.op === p.op),
    );
    if (!offer) return { offer: null };
    // Nothing was shown yet (offersShown is 0): the offer this behaviour is
    // evidence for replaces a quieter one from the instant plan, so the
    // answer finds the op the chip asked about.
    await this.d.tabs.update(tabId, (t) => {
      t.offer = offer;
    });
    this.d.port.broadcast({ type: 'ui:changed', tabId });
    // Never interrupt: no chip in the first 10 s of a page, and none while the
    // person is mid-scroll. The question waits in the popup instead.
    const since = tab.startedAt ?? tab.signalsAt ?? now;
    if (!inPageOfferAllowed(signal, since, now)) return { offer: null };
    await this.markOfferShown(tabId, offer);
    return { offer };
  }

  /**
   * An offer was put in front of the person (in-page chip or popup): count it
   * once. `shown` is the offer that was returned to the page, when known.
   */
  async markOfferShown(tabId: number, shown?: PlannedOp): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    const offer = shown ?? tab.offer;
    if (!offer || tab.offersShown > 0 || !tab.domain || !tab.tabSession) return;
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
    // Answered in the popup, or expired: the page hides a chip still asking.
    // Nothing waits on the page for this.
    if (via === 'popup' || answer === 'timeout')
      void this.d.port
        .sendToTab(tabId, { type: 'sw:offer-resolved', op })
        .catch(() => undefined);

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
    if (RETIRED_OPS.has(op)) return { plan: null };
    if (op === 'page_zoom') {
      // The person chose the page scale: it goes on the tab, frozen for this
      // page view, and the page is planned again at it.
      const z = levelValue('page_zoom', offer.level);
      await this.d.tabs.update(tabId, (t) => {
        t.scale = { z, stepped: false, checked: false };
      });
      await this.applyZoom(tabId, { ...offer, mode: 'offer' }, z);
      if (!(await this.replan(tabId))) await this.afterChange(tabId);
      return { plan: null };
    }
    const plan: AdaptationPlan = {
      id: `plan-${tab.tabSession}-${Math.round(this.now)}-offer`,
      createdAt: this.now,
      category: tab.category,
      basis: tab.plan?.basis ?? 'local',
      ops: [offer],
    };
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
        if (!s.rule.blocks.includes(ev.op)) s.rule.blocks.push(ev.op);
      }
      s.rule.updatedAt = this.now;
    });
    await this.d.tabs.update(tab.tabId, (t) => {
      const off = new Set(events.map((e) => e.op));
      t.acceptedOps = t.acceptedOps.filter((op) => !off.has(op));
      if (t.offer && off.has(t.offer.op)) t.offer = null;
    });
    // Region-scoped ops keep the keys they targeted, for "I needed that".
    const regionsOf = (op: OpId): string[] => {
      const scope = tab.plan?.ops.find((p) => p.op === op)?.scope;
      return scope && scope !== 'page' ? [...scope.regions] : [];
    };
    await this.d.undos.hold(
      events.map((input) => {
        const regions = regionsOf(input.op);
        return {
          tabId: tab.tabId,
          domain,
          tabSession,
          input,
          ...(regions.length > 0 ? { regions } : {}),
        };
      }),
      this.now,
    );
    this.scheduleUndoFlush();
  }

  /** A saved site decision also applies to its other already-open pages. */
  private async reflectSavedUndo(
    tab: TabRecord,
    ops: readonly OpId[],
  ): Promise<void> {
    if (!tab.domain) return;
    for (const other of await this.domainTabs(tab.domain)) {
      if (other.tabId === tab.tabId || !other.engine) continue;
      await this.d.tabs.update(other.tabId, (t) => {
        t.acceptedOps = t.acceptedOps.filter((op) => !ops.includes(op));
        if (t.offer && ops.includes(t.offer.op)) t.offer = null;
      });
      for (const op of ops) {
        if (op === 'page_zoom') await this.restoreZoom(other.tabId);
        else {
          const reply = await this.d.port.sendToTab(other.tabId, {
            type: 'sw:undo',
            op,
          });
          if (reply) await this.processChanges(other.tabId, reply.changes);
        }
      }
      await this.afterChange(other.tabId);
    }
  }

  /**
   * "I needed that" on a region-scoped op: every region it targeted becomes an
   * exception on this site (the event carries the first; core caps the list).
   */
  private async noteExceptions(h: HeldUndo): Promise<void> {
    const keys = neededKeys(h);
    if (keys.length < 2) return;
    await this.d.stores.sites.update(h.domain, (s) => {
      const list = (s.state.exceptions ??= []);
      for (const k of keys) if (!list.includes(k)) list.push(k);
    });
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
      for (const h of due) {
        await recordEvents(
          this.d.stores,
          profile,
          h.domain,
          h.tabSession,
          [h.input],
          this.now,
        ).catch(() => undefined);
        await this.noteExceptions(h).catch(() => undefined);
      }
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
      await this.noteExceptions(outcome.entry);
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
    // page_zoom is the worker's own change (the engine never reports it): it
    // stays while the scale is on the tab, or as undone by the zoom guard.
    const zoomChange = tab.changes.find(
      (c) =>
        c.op === 'page_zoom' &&
        ((c.status === 'applied' && tab.zoom) ||
          c.status === 'undone_by_checks'),
    );
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

  /**
   * Take WebAble's page scale off the tab: Chrome's per-origin zoom comes
   * back, which is the person's own (Undo restores their zoom, not 100%). The
   * page view's scale becomes 1 for its later plans, unless `keep`: pausing
   * or turning WebAble off is no Undo, so resuming puts the same scale back
   * (reapplyScale).
   */
  private async restoreZoom(tabId: number, keep = false): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.zoom) return;
    const previous = tab.zoom.previous;
    await this.d.tabs.update(tabId, (t) => {
      t.zoom = null;
      t.changes = t.changes.filter((c) => c.op !== 'page_zoom');
      if (t.scale && !keep) t.scale = { ...t.scale, z: 1, checked: false };
    });
    this.ownZoom.expect(tabId, previous, this.now);
    await this.d.port
      .releaseZoom(tabId, undefined, previous)
      .catch(() => undefined);
    this.zoomMessage(tabId, previous, 'webable', 1);
  }

  /**
   * Fit view opened: the tab goes back to the person's own zoom while it is
   * open (docs/10 §4.6; the reflow happens hidden under the view). Returns
   * the tab's zoom factor now.
   */
  private async suspendZoom(tabId: number): Promise<number> {
    const tab = await this.d.tabs.get(tabId);
    const zoom = tab.zoom;
    if (!zoom) return this.d.port.getZoom(tabId);
    if (zoom.suspended) return zoom.previous;
    this.ownZoom.expect(tabId, zoom.previous, this.now);
    await this.d.port.setZoom(tabId, zoom.previous).catch(() => undefined);
    await this.d.tabs.update(tabId, (t) => {
      if (t.zoom) t.zoom.suspended = true;
    });
    this.zoomMessage(tabId, zoom.previous, 'webable', 1);
    return zoom.previous;
  }

  /** Fit view closed: Tailor's page scale comes back. */
  private async resumeZoom(tabId: number): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    const zoom = tab.zoom;
    if (!zoom?.suspended) return;
    this.ownZoom.expect(tabId, zoom.factor, this.now);
    await this.d.port.setZoom(tabId, zoom.factor).catch(() => undefined);
    await this.d.tabs.update(tabId, (t) => {
      if (t.zoom) t.zoom.suspended = false;
    });
    this.zoomMessage(tabId, zoom.factor, 'webable', zoom.z);
  }

  /**
   * Chrome reported a zoom change (tabs.onZoomChange). WebAble's own set
   * calls are recognised and ignored; so is Chrome putting a site's zoom
   * back on navigation. A change to any other factor while WebAble's scale
   * is on the tab is the person's: Chrome's zoom-bubble Reset (or Ctrl+0)
   * counts as Undo; any other factor means the person owns zoom here, so
   * their factor is kept (per-origin, as Chrome would), and page_zoom stops
   * on the site until they turn it on again.
   */
  async zoomChanged(
    tabId: number,
    oldFactor: number,
    newFactor: number,
    settings: { scope?: string; defaultZoomFactor?: number } = {},
  ): Promise<void> {
    if (!(newFactor > 0) || Math.abs(newFactor - oldFactor) < 0.005) return;
    if (this.ownZoom.consume(tabId, newFactor, this.now)) return;
    const tab = await this.d.tabs.peek(tabId);
    if (!tab?.engine || !tab.tabSession || !tab.domain) return;
    const zoom = tab.zoom;
    if (!zoom) {
      // WebAble's scale is not on this tab: the zoom is the person's own.
      this.zoomMessage(tabId, newFactor, 'person');
      return;
    }
    // Per-tab zoom is reset to the site's on navigation; the new page view
    // starts without WebAble's scale.
    if (settings.scope === 'per-origin') return;
    const current = zoom.suspended ? zoom.previous : zoom.factor;
    if (sameFactor(newFactor, current)) return;
    const reset = isZoomReset(
      newFactor,
      zoom.previous,
      settings.defaultZoomFactor,
    );
    const change = tab.changes.find(
      (c) => c.op === 'page_zoom' && c.status === 'applied',
    );
    await this.d.tabs.update(tabId, (t) => {
      t.zoom = null;
      t.changes = t.changes.filter((c) => c.op !== 'page_zoom');
      if (t.scale) t.scale = { ...t.scale, z: 1, checked: false };
      if (reset && !t.undoneByYou.includes('page_zoom'))
        t.undoneByYou.push('page_zoom');
    });
    // Their factor, for the site, as Chrome would keep it without WebAble.
    this.ownZoom.expect(tabId, newFactor, this.now);
    await this.d.port.releaseZoom(tabId, newFactor).catch(() => undefined);
    if (reset && change) {
      await this.holdUndos(tab, [this.undoEvent(tab, change)]);
    } else {
      await this.d.stores.sites.update(tab.domain, (s) => {
        if (!s.rule.blocks.includes('page_zoom'))
          s.rule.blocks.push('page_zoom');
        s.rule.updatedAt = this.now;
      });
    }
    const profile = await loadProfile(this.d.stores, this.now);
    await this.rememberTemplate(tabId, profile.identity, undefined);
    this.zoomMessage(tabId, newFactor, 'person', 1);
    await this.syncSiteCount(tabId);
    // The site's other pages lose WebAble's scale too.
    await this.reflectSavedUndo(tab, ['page_zoom']);
    // Text was planned for the scale: plan again at the person's zoom.
    if (zoom.suspended || !(await this.replan(tabId)))
      await this.afterChange(tabId);
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
    // Left the page while reading it in Fit view (through the view, most
    // likely): Fit view was kept.
    const fit = await this.d.fitViews.get(tabId);
    if (fit.session === closing.tabSession && fit.open) {
      await this.d.fitViews.update(tabId, (f) => {
        f.open = false;
      });
      await this.noteFitOutcome(closing, 'keep').catch(() => undefined);
    }
    this.skeletons.delete(tabId);
  }

  /** A top-frame navigation committed (the new document may have no engine). */
  async navigated(
    tabId: number,
    url: string | undefined,
    committedAt: number,
    qualifiers: readonly string[] = [],
  ): Promise<void> {
    return this.serial(tabId, () =>
      this.navigatedNow(tabId, url, committedAt, qualifiers),
    );
  }

  private async navigatedNow(
    tabId: number,
    url: string | undefined,
    committedAt: number,
    qualifiers: readonly string[],
  ): Promise<void> {
    const tab = await this.d.tabs.peek(tabId);
    // The new page's engine already said hello: this commit is not news.
    if (
      tab?.engine &&
      !tab.restoring &&
      Math.max(tab.checkingSince ?? 0, tab.startedAt ?? 0) >= committedAt - 50
    )
      return;
    const access = classifyUrl(url);
    const domain = access.kind === 'web' ? access.domain : null;
    if (qualifiers.includes('forward_back') && tab?.tabSession) {
      // Back or forward: the document may come from the back/forward cache
      // with its engine still running. The page view that was left ends when
      // that engine says hello (it re-binds the tab), or when the wait runs out.
      await this.d.tabs.update(tabId, (t) => {
        t.restoring = { at: committedAt, domain, access: access.kind };
        t.showing = false;
      });
      setTimeout(() => {
        void this.settleRestore(tabId, committedAt).catch(() => undefined);
      }, RESTORE_WAIT_MS);
      return;
    }
    await this.endPageView(tabId);
    this.injectedAt.delete(tabId);
    await this.d.tabs.update(tabId, (t) => {
      Object.assign(t, freshTab(tabId), { domain, access: access.kind });
    });
    await this.refreshBadge(tabId);
    this.d.port.broadcast({ type: 'ui:changed', tabId });
  }

  /**
   * No engine re-bound the tab after a back/forward commit (or the popup needs
   * a view now): end the page view that was left. `at` limits this to one
   * commit, so a later navigation is left alone.
   */
  private settleRestore(tabId: number, at?: number): Promise<void> {
    return this.serial(tabId, () => this.settleRestoreNow(tabId, at));
  }

  private async settleRestoreNow(tabId: number, at?: number): Promise<void> {
    const r = (await this.d.tabs.peek(tabId))?.restoring;
    if (!r || (at !== undefined && r.at !== at)) return;
    await this.endPageView(tabId);
    let settled = false;
    await this.d.tabs.update(tabId, (t) => {
      // A hello that arrived meanwhile owns the tab now.
      if (t.restoring?.at !== r.at) return;
      Object.assign(t, freshTab(tabId), { domain: r.domain, access: r.access });
      settled = true;
    });
    if (!settled) return;
    await this.refreshBadge(tabId);
    this.d.port.broadcast({ type: 'ui:changed', tabId });
  }

  async tabClosed(tabId: number): Promise<void> {
    await this.endPageView(tabId);
    await this.d.tabs.remove(tabId);
    await this.d.pages.delete(tabId);
    await this.d.fitViews.delete(tabId);
    this.ownZoom.forget(tabId);
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
      firstRun: !profile.calibrated,
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
  ): Promise<PageMemo & { id: string }> {
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
      id: randomId(9),
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
    if (this.analyzing.has(tabId)) return;
    this.analyzing.add(tabId);
    try {
      await this.analyzeNow(tabId, tabSession, memo);
    } finally {
      this.analyzing.delete(tabId);
    }
  }

  private async analyzeNow(
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
      excludedSite: isExcludedSite(domain),
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
    const latest = await this.d.pages.get(tabId, tabSession);
    if (!latest || latest.id !== memo.id) return;

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
    const basePlanId = tab.plan.id;
    // An SPA route change measured the page again while analysis was out:
    // these answers belong to a page that is gone.
    const current = await this.d.pages.get(tabId, tabSession);
    if (!current || memoId(current) !== memoId(memo)) return;
    await this.d.pages.set(tabId, memo);
    const answeredAt = this.now;
    const mode = refinementMode({
      dclAt: tab.signalsAt ?? answeredAt,
      answeredAt,
      interactedAt: tab.interactedAt,
    });
    const c = await this.context(tab.domain);
    if (!c.settings.enabled || c.rule.paused) return;
    const latestTab = await this.d.tabs.peek(tabId);
    const latestMemo = await this.d.pages.get(tabId, tabSession);
    if (latestTab?.plan?.id !== tab.plan.id || latestMemo?.id !== memo.id)
      return;
    const view = analysisView(
      memo.signals,
      memo.evidence.regions,
      memo.answers,
    );
    const scale = memo.scale ?? 1;
    const refined = this.withFrozenScale(
      await this.planFor(
        c,
        tab,
        view,
        true,
        this.verdictFor(c, tab, view.signals, scale),
        scale,
      ),
      tab,
    );
    const diff = diffRefinement(tab.plan, refined, mode, view.protectedKeys);
    for (const op of diff.undo) {
      const reply = await this.d.port.sendToTab(tabId, {
        type: 'sw:undo',
        op,
        basePlanId: tab.plan.id,
      });
      if (reply) await this.processChanges(tabId, reply.changes);
    }
    if (diff.ops.length > 0) {
      const reply = await this.d.port.sendToTab(tabId, {
        type: 'sw:plan',
        plan: await this.forPage(tabId, { ...refined, ops: diff.ops }),
        reason: 'refine',
        basePlanId: tab.plan.id,
      });
      if (reply) await this.processChanges(tabId, reply.changes);
    }
    await this.d.tabs.update(tabId, (t) => {
      if (t.tabSession !== tabSession || t.plan?.id !== basePlanId) return;
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
  // Fit view (docs/10 §4, §6, §7)
  // =========================================================================

  /** Fit view's face for a document that has not registered it yet. */
  private async fontBytes(): Promise<string | null> {
    try {
      return (await this.d.font?.()) ?? null;
    } catch {
      return null;
    }
  }

  /** The person's Fit view layout: solved from the fit, with Fit view's Text − / + override. */
  private async fitLayout(
    c: Ctx,
    colorScheme: 'light' | 'dark' | undefined,
  ): Promise<FitLayout> {
    const scheme =
      colorScheme ?? (await this.d.stores.system.read())?.colorScheme;
    return solveFitLayout(
      withTextStep(c.profile.profile, c.settings.fitTextStep),
      scheme ? { colorScheme: scheme } : {},
    );
  }

  /**
   * A cached planner spec for this template that resolves on this page: the
   * variant with the best locator coverage (at least 80%) that the validator
   * accepts on this skeleton (docs/10 §6 "Cache").
   */
  private async cachedPlannerSpec(
    key: string,
    skeleton: Skeleton,
    hash: (k: string) => string,
    ctx: ValidateSpecContext,
  ): Promise<{ validated: ValidatedSpec; stored: StoredSpec } | null> {
    const ranked = (await this.d.stores.compose.get(key))
      .map((stored) => ({ stored, ...fromStoredSpec(stored, skeleton, hash) }))
      .filter((v) => v.coverage >= PLANNER_MIN_COVERAGE)
      .sort((a, b) => b.coverage - a.coverage);
    for (const v of ranked) {
      const validated = validateSpec(v.spec, skeleton, ctx);
      if (validated) return { validated, stored: v.stored };
    }
    return null;
  }

  /** The parts of the planner gate that do not depend on this open. */
  private async plannerBase(
    c: Ctx,
    domain: string,
    tab: TabRecord,
    memo: PageMemo | null,
  ): Promise<Omit<ComposeGateInput, 'personOpened' | 'cached'>> {
    const signals = memo?.signals;
    return {
      mailOrChat: tab.personalSite,
      excludedSite: isExcludedSite(domain),
      sensitive:
        signals !== undefined &&
        (signals.forms.hasPassword ||
          signals.forms.hasPayment ||
          signals.layout?.kind.password === true ||
          signals.layout?.kind.payment === true),
      checkout:
        signals !== undefined &&
        signals.category === 'form_checkout' &&
        signals.categoryConfidence >= CHECKOUT_P,
      configured:
        this.d.auth !== null &&
        Boolean(this.d.config.composeUrl && this.d.config.publishableKey),
      signedIn: c.account !== null,
      needsReauth: c.account?.needsReauth ?? false,
      aiLayout: c.account?.aiLayout ?? false,
      devPlanner: this.d.config.devPlanner && c.settings.devPlanner,
      breakerOpen: breakerOpen(await this.composeBreaker.read(), c.now),
    };
  }

  /**
   * cs:fitview-request: build or recall the spec for this reading, validate
   * it, solve the layout from the fit (the fit stays here), put Fit view's
   * scripts in the page, return the tab to the person's own zoom, then reply.
   * A planner call, when one may run, starts after the reply.
   */
  async fitViewRequest(
    tabId: number,
    frameId: number,
    skeleton: Skeleton,
    reason: FitViewOpenReason,
    url: string | undefined,
  ): Promise<FitViewOpenReply> {
    if (frameId !== 0) return { ok: false, why: 'error' };
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || !tab.tabSession || !tab.engine)
      return { ok: false, why: 'stale' };
    const domain = tab.domain;
    const tabSession = tab.tabSession;
    const refuse = async (
      why: FitViewUnavailable,
    ): Promise<FitViewOpenReply> => {
      await this.d.fitViews.update(tabId, (s) => ({
        ...forPageView(s, tabSession),
        why,
      }));
      this.d.port.broadcast({ type: 'ui:changed', tabId });
      return { ok: false, why };
    };
    // A reading from an engine of another version is read again.
    if (skeleton.version !== SKELETON_VERSION) return refuse('stale');
    const c = await this.context(domain);
    if (!c.settings.enabled || c.rule.paused || isExcludedSite(domain))
      return refuse('excluded');
    const memo = await this.d.pages.get(tabId, tabSession);
    const blockers = tab.plan?.triage?.blockers ?? [];
    if (
      blockers.some((b) => HARD_BLOCKERS.has(b)) ||
      memo?.signals.forms.hasPassword === true ||
      memo?.signals.forms.hasPayment === true ||
      hasPasswordField(skeleton)
    )
      return refuse('not_representable');
    if (blockingOverlay(skeleton)) return refuse('blocked_overlay');

    // The spec: a cached planner spec that resolves here, else the heuristic.
    const install = await this.d.stores.install.get();
    const site = await siteKey(install.secret, domain);
    const key = await composeKey(install.secret, site, pathShape(url ?? ''));
    const hash = await nameHasher(install.secret, skeleton);
    const ctx: ValidateSpecContext = {
      focusId: focusNode(skeleton),
      siteHost: domain,
    };
    const cached = await this.cachedPlannerSpec(key, skeleton, hash, ctx).catch(
      () => null,
    );
    let validated: ValidatedSpec | null = cached?.validated ?? null;
    if (!validated) {
      const view = memo
        ? analysisView(memo.signals, memo.evidence.regions, memo.answers)
        : null;
      try {
        validated = validateSpec(
          heuristicSpec(skeleton, {
            verdicts: view ? regionRoles(view.verdicts) : {},
            ...(memo ? { signals: memo.evidence.page.signals } : {}),
          }),
          skeleton,
          ctx,
        );
      } catch {
        validated = null;
      }
    }
    if (!validated) return refuse('not_representable');
    const envelope: SpecEnvelope = {
      source: cached ? 'planner' : 'heuristic',
      extractionId: skeleton.extractionId,
      validated,
      ...(cached ? { model: cached.stored.model } : {}),
      templateKey: key,
      createdAt: cached ? cached.stored.createdAt : this.now,
    };
    const layout = await this.fitLayout(c, memo?.signals.env.colorScheme);

    // Fit view's scripts are in the page before the reply, once per document.
    const state = forPageView(await this.d.fitViews.get(tabId), tabSession);
    if (
      state.injected !== tabSession &&
      !(await this.d.registration.injectFitView(tabId))
    )
      return refuse('error');
    // The page may have moved on while this was prepared.
    if ((await this.d.tabs.get(tabId)).tabSession !== tabSession)
      return { ok: false, why: 'stale' };

    // The person's own zoom while Fit view is open (docs/10 §4.6).
    const zoom = await this.suspendZoom(tabId);
    const base = await this.plannerBase(c, domain, tab, memo);
    const planner = composeGate({
      ...base,
      checkout:
        base.checkout || validated.spec.page_type === 'form_or_checkout',
      personOpened: personOpened(reason, c.site.rule.view === 'fit'),
      cached: cached !== null,
    });
    const font = state.font !== tabSession ? await this.fontBytes() : null;
    await this.d.fitViews.update(tabId, (s) => {
      const cur = forPageView(s, tabSession);
      return {
        ...cur,
        extractionId: skeleton.extractionId,
        templateKey: key,
        variant: cached ? cached.stored.createdAt : null,
        reason,
        why: null,
        injected: tabSession,
        font: font ? tabSession : cur.font,
        planner: cached
          ? 'ready'
          : planner.call
            ? 'pending'
            : cur.templateKey === key
              ? cur.planner
              : 'idle',
      };
    });
    this.skeletons.set(tabId, skeleton);
    if (planner.call) {
      const job: PlannerJob = {
        tabId,
        tabSession,
        domain,
        site,
        key,
        skeleton,
        hash,
        ctx,
      };
      setTimeout(() => {
        void this.runPlanner(job).catch(() => undefined);
      }, 0);
    }
    this.d.port.broadcast({ type: 'ui:changed', tabId });
    return {
      ok: true,
      envelope,
      layout,
      zoom,
      // The eTLD+1 as the worker computed it (punycode shown raw).
      site: { label: domain, secure: url?.startsWith('https:') === true },
      plannerPending: planner.call,
      // Excluded sites never get here, so every site may have "Always here".
      alwaysHere: c.site.rule.view === 'fit',
      // The first restructure WebAble ever makes on its own says what happened.
      ...(reason === 'auto' && !c.settings.simplifyIntroShown
        ? { intro: true }
        : {}),
      ...(font ? { font } : {}),
    };
  }

  /**
   * One planner call per template at a time (deduped in storage.session, so
   * a worker restart does not repeat it); other tabs opening the same
   * template meanwhile wait for it.
   */
  private async runPlanner(job: PlannerJob): Promise<void> {
    const waiter: InflightWaiter = {
      tabId: job.tabId,
      extractionId: job.skeleton.extractionId,
    };
    if (!(await this.d.inflight.claim(job.key, waiter))) return;
    let result: PlannerResult | null = null;
    try {
      result = await this.composeNow(job);
    } catch {
      result = null;
    }
    const waiters = await this.d.inflight.release(job.key);
    for (const w of waiters.length > 0 ? waiters : [waiter])
      await this.deliverPlanner(w, job, result).catch(() => undefined);
  }

  /**
   * The planner call (docs/10 §6): the wire skeleton only; the receipt is
   * written before anything leaves the device; the answer is validated
   * against the skeleton it was planned from and cached as locators.
   */
  private async composeNow(job: PlannerJob): Promise<PlannerResult | null> {
    const c = await this.context(job.domain);
    const dev = this.d.config.devPlanner && c.settings.devPlanner;
    const built = buildComposeRequest(job.skeleton);
    if (!built) return null;
    const token = dev ? null : ((await this.d.auth?.accessToken()) ?? null);
    if (!dev && !token) return null;
    // Only for the page view the skeleton came from.
    if ((await this.d.tabs.peek(job.tabId))?.tabSession !== job.tabSession)
      return null;

    const sentAt = this.now;
    await this.d.stores.receipts.add({
      id: randomId(12),
      at: sentAt,
      domain: job.domain,
      destination: 'layout_planning',
      bytes: new TextEncoder().encode(built.body).byteLength,
      body: JSON.parse(built.body) as unknown,
    });
    await this.d.tabs.update(job.tabId, (t) => {
      t.layoutSentAt = sentAt;
    });
    this.d.port.broadcast({ type: 'ui:changed', tabId: job.tabId });

    const outcome = await callCompose({
      url: this.d.config.composeUrl,
      ...(dev ? {} : { publishableKey: this.d.config.publishableKey }),
      accessToken: token,
      body: built.body,
      ...(this.d.fetch ? { fetch: this.d.fetch } : {}),
    });
    if (!outcome.ok) {
      await this.composeFailed(outcome, dev);
      return null;
    }
    await this.composeBreaker.write(breakerSuccess());
    const validated = validateSpec(outcome.data.spec, job.skeleton, job.ctx);
    if (!validated) return null;
    const stored = toStoredSpec(validated, job.skeleton, job.hash, {
      schema: COMPOSE_SCHEMA_VERSION,
      model: outcome.data.model,
      createdAt: this.now,
    });
    await this.d.stores.compose.put(job.key, job.site, stored);
    return { stored, validated };
  }

  /**
   * compose said no. 401: refresh the session or ask to sign in again. 403
   * consent_required: the consent is off on the server, so stop and pull the
   * account. Anything else backs the planner off (its own breaker).
   */
  private async composeFailed(
    outcome: Extract<ComposeOutcome, { ok: false }>,
    dev: boolean,
  ): Promise<void> {
    if (!dev && outcome.reason === 'unauthorized') {
      const refreshed = (await this.d.auth?.refreshNow()) ?? false;
      if (!refreshed)
        await this.d.stores.account.update((a) =>
          a ? { ...a, needsReauth: true } : a,
        );
      await this.refreshAllBadges();
      return;
    }
    if (!dev && outcome.reason === 'consent_required') {
      await this.d.stores.account.update((a) =>
        a ? { ...a, aiLayout: false } : a,
      );
      void this.d.sync?.refresh().catch(() => undefined);
      return;
    }
    const retry =
      outcome.retryAfterMs ??
      (outcome.status === 503 ? UNAVAILABLE_BACKOFF_MS : undefined);
    await this.composeBreaker.update((b) => breakerFailure(b, this.now, retry));
  }

  /**
   * A planner answer for a tab that asked (or waited): if Fit view is still
   * open on that very extraction, offer it ("A better layout is ready"); it
   * never replaces a view under someone reading. Otherwise the cache keeps it
   * for the next open.
   */
  private async deliverPlanner(
    w: InflightWaiter,
    job: PlannerJob,
    result: PlannerResult | null,
  ): Promise<void> {
    const tab = await this.d.tabs.peek(w.tabId);
    const state = await this.d.fitViews.get(w.tabId);
    if (
      !tab?.tabSession ||
      !tab.domain ||
      state.session !== tab.tabSession ||
      state.templateKey !== job.key
    )
      return;
    if (!result) {
      if (state.planner === 'pending') {
        await this.d.fitViews.update(w.tabId, (s) => ({
          ...s,
          planner: 'failed',
        }));
        this.d.port.broadcast({ type: 'ui:changed', tabId: w.tabId });
      }
      return;
    }
    const skeleton =
      w.tabId === job.tabId && w.extractionId === job.skeleton.extractionId
        ? job.skeleton
        : this.skeletons.get(w.tabId);
    let validated: ValidatedSpec | null = null;
    if (
      state.open &&
      state.extractionId === w.extractionId &&
      skeleton?.extractionId === w.extractionId
    ) {
      if (skeleton === job.skeleton) validated = result.validated;
      else {
        const install = await this.d.stores.install.get();
        const hash = await nameHasher(install.secret, skeleton);
        const { spec, coverage } = fromStoredSpec(
          result.stored,
          skeleton,
          hash,
        );
        if (coverage >= PLANNER_MIN_COVERAGE)
          validated = validateSpec(spec, skeleton, {
            focusId: focusNode(skeleton),
            siteHost: tab.domain,
          });
      }
    }
    await this.d.fitViews.update(w.tabId, (s) => ({ ...s, planner: 'ready' }));
    if (validated)
      await this.d.port.sendToTab(w.tabId, {
        type: 'sw:fitview-spec',
        envelope: {
          source: 'planner',
          extractionId: w.extractionId,
          validated,
          model: result.stored.model,
          templateKey: job.key,
          createdAt: result.stored.createdAt,
        },
      });
    this.d.port.broadcast({ type: 'ui:changed', tabId: w.tabId });
  }

  /** Fit view kept or undone on a site and its page type (Beta-Bernoulli, local only). */
  private async noteFitOutcome(
    tab: TabRecord,
    outcome: 'keep' | 'undo',
  ): Promise<void> {
    if (!tab.domain) return;
    const kept = outcome === 'keep';
    await this.d.stores.sites.update(tab.domain, (s) => {
      s.fitView = { ...s.fitView, ...addKeep(s.fitView, kept) };
    });
    await this.d.stores.fitLearning.update((rec) => ({
      ...rec,
      pageTypes: {
        ...rec.pageTypes,
        [tab.category]: addKeep(countsFor(rec.pageTypes, tab.category), kept),
      },
    }));
  }

  /** cs:fitview-event: Fit view's lifecycle, offers and defects (docs/10 §7). */
  async fitViewEvent(
    tabId: number,
    frameId: number,
    event: FitViewEvent,
  ): Promise<void> {
    if (frameId !== 0) return;
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || !tab.tabSession) return;
    const domain = tab.domain;
    const tabSession = tab.tabSession;
    const state = forPageView(await this.d.fitViews.get(tabId), tabSession);
    switch (event.kind) {
      case 'opened':
        await this.d.fitViews.update(tabId, (s) => ({
          ...forPageView(s, tabSession),
          open: true,
          tabMode: true,
          openedAt: this.now,
          source: event.source,
          reason: event.reason,
          why: null,
          declinedSite: null,
        }));
        // The one-time line has been seen once an automatic open rendered.
        if (event.reason === 'auto')
          await this.d.stores.settings.update((s) =>
            s.simplifyIntroShown ? s : { ...s, simplifyIntroShown: true },
          );
        break;
      case 'closed': {
        // "Original page": this site is not simplified on its own again in
        // this tab, and tab mode ends.
        const original = event.reason === 'original';
        await this.d.fitViews.update(tabId, (s) => ({
          ...forPageView(s, tabSession),
          open: false,
          tabMode: original ? false : s.tabMode,
          declinedSite: original ? domain : s.declinedSite,
        }));
        // Tailor's page scale comes back with Tailor.
        await this.resumeZoom(tabId);
        const outcome = closeOutcome(event);
        if (outcome) await this.noteFitOutcome(tab, outcome);
        // A planner spec the person left at once is not reused.
        if (
          outcome === 'undo' &&
          state.source === 'planner' &&
          state.templateKey
        )
          await this.d.stores.compose.evict(
            state.templateKey,
            state.variant ?? undefined,
          );
        break;
      }
      case 'peek':
        return;
      case 'proxy_failed':
      case 'conservation_failed': {
        const at = this.now;
        await this.d.stores.fitLearning.update((rec) =>
          addDefect(
            rec,
            {
              at,
              kind: event.kind,
              source: state.source ?? 'heuristic',
              cat: tab.category,
              ...(event.kind === 'proxy_failed'
                ? { role: event.role, why: event.why }
                : { missing: event.missing }),
            },
            at,
          ),
        );
        if (state.source === 'planner' && state.templateKey)
          await this.d.stores.compose.evict(
            state.templateKey,
            state.variant ?? undefined,
          );
        break;
      }
      case 'offer': {
        const today = toDay(this.now);
        await this.d.stores.sites.update(domain, (s) => {
          const sameDay = s.fitView.offerDay === today;
          s.fitView = {
            ...s.fitView,
            offerDay: today,
            offerAccepted:
              event.answer === 'accept' || (sameDay && s.fitView.offerAccepted),
          };
        });
        // v1's offer conventions: one in-page offer per page view, a few a day.
        if (tab.offersShown === 0) {
          await this.d.tabs.update(tabId, (t) => {
            t.offersShown += 1;
          });
          await this.d.stores.offers.update((b) =>
            b.day === today
              ? { day: today, count: b.count + 1 }
              : { day: today, count: 1 },
          );
        }
        // "Not now": no more Fit view offers in this tab.
        if (event.answer === 'dismiss')
          await this.d.fitViews.update(tabId, (s) => ({
            ...s,
            offerDeclined: true,
          }));
        break;
      }
      case 'always':
        // The top strip's "Always here": as the popup's, without reopening.
        await this.setAlwaysHere(tabId, event.on, false);
        break;
      case 'text_nudge':
        // Text − / + inside Fit view: kept as Fit view's own text override.
        await this.d.stores.settings.update((s) => ({
          ...s,
          fitTextStep: Math.max(
            -FIT_TEXT_STEPS_MAX,
            Math.min(FIT_TEXT_STEPS_MAX, s.fitTextStep + event.step),
          ),
        }));
        break;
    }
    await this.afterChange(tabId);
  }

  /**
   * ui:fit-view. scope 'page': open or close Fit view in this tab (tab mode
   * follows). scope 'site': "Always here" on or off; turning it on opens Fit
   * view here too.
   */
  async fitView(
    tabId: number,
    on: boolean,
    scope: 'page' | 'site',
  ): Promise<void> {
    if (scope === 'site') {
      await this.setAlwaysHere(tabId, on, true);
      await this.afterChange(tabId);
      return;
    }
    if (on) await this.openFitView(tabId, 'popup');
    else await this.closeFitView(tabId);
    await this.afterChange(tabId);
  }

  /**
   * "Always here" on or off for the tab's site. Turning it on opens Fit view
   * here too when `open` asks for it and it is not open yet.
   */
  private async setAlwaysHere(
    tabId: number,
    on: boolean,
    open: boolean,
  ): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || isExcludedSite(tab.domain)) return;
    await this.d.stores.sites.update(tab.domain, (s) => {
      if (on) s.rule.view = 'fit';
      else delete s.rule.view;
      s.rule.updatedAt = this.now;
    });
    const state = await this.d.fitViews.get(tabId);
    if (open && on && !(state.open && state.session === tab.tabSession))
      await this.openFitView(tabId, 'popup');
  }

  /** ui:fit-view-switch: take the planner layout that is ready ("Switch"). */
  async fitViewSwitch(tabId: number): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    const state = await this.d.fitViews.get(tabId);
    if (
      !tab.tabSession ||
      state.session !== tab.tabSession ||
      !state.open ||
      state.planner !== 'ready' ||
      state.source === 'planner'
    )
      return;
    await this.d.port.sendToTab(tabId, {
      type: 'sw:fitview',
      action: 'open',
      reason: 'switch',
    });
  }

  /** The toggle-fit-view command: open Fit view in the tab, or go back to the original page. */
  async toggleFitView(tabId: number): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.engine || !tab.tabSession) return;
    const state = forPageView(await this.d.fitViews.get(tabId), tab.tabSession);
    if (state.open) await this.closeFitView(tabId);
    else await this.openFitView(tabId, 'shortcut');
    await this.afterChange(tabId);
  }

  private async openFitView(
    tabId: number,
    reason: FitViewOpenReason,
  ): Promise<void> {
    await this.d.fitViews.update(tabId, (s) => ({ ...s, tabMode: true }));
    await this.d.port.sendToTab(tabId, {
      type: 'sw:fitview',
      action: 'open',
      reason,
    });
  }

  /** "Original page" from the popup or the shortcut: tab mode ends. */
  private async closeFitView(tabId: number): Promise<void> {
    await this.d.fitViews.update(tabId, (s) => ({ ...s, tabMode: false }));
    await this.d.port.sendToTab(tabId, {
      type: 'sw:fitview',
      action: 'close',
      reason: 'original',
    });
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
      devPlanner: this.d.config.devPlanner ? settings.devPlanner : null,
      fitTextStep: settings.fitTextStep,
      autoSimplify: settings.autoSimplify,
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

  /**
   * Start the engine in a tab that has none on record: unless the site is
   * paused or WebAble is off. An engine that is already running (a page
   * restored from the back/forward cache, or an injection whose hello is on
   * its way) answers first, and a second one never starts. True when an
   * engine runs there now.
   */
  private async startEngine(tabId: number): Promise<boolean> {
    const settings = await this.d.stores.settings.read();
    const access = classifyUrl(await this.d.port.tabUrl(tabId));
    const tab = await this.d.tabs.update(tabId, (t) => {
      t.access = access.kind;
      t.domain = access.kind === 'web' ? access.domain : null;
    });
    if (!settings.enabled || tab.access !== 'web' || !tab.domain) return false;
    const site = await this.d.stores.sites.get(tab.domain);
    if (site.rule.paused) return false;
    const alive = await this.d.port.sendToTab(
      tabId,
      { type: 'sw:get-changes' },
      500,
    );
    if (!alive && !(await this.injectOnce(tabId))) return false;
    // An engine that answers but never planned here (the page loaded while
    // WebAble was off, or paused): wake it; it reports like a fresh load.
    if (alive && alive.status === 'idle' && alive.changes.length === 0)
      await this.d.port.sendToTab(tabId, { type: 'sw:resume' });
    await this.d.tabs.update(tabId, (t) => {
      t.engine = true;
      t.phase = alive?.status === 'unreadable' ? 'unreadable' : 'checking';
      t.checkingSince = t.phase === 'checking' ? this.now : null;
      t.needsReload = false;
    });
    return true;
  }

  /** Recovery for missed document_start injection; ordinary visits need no popup. */
  async pageLoaded(tabId: number): Promise<void> {
    const tab = await this.d.tabs.peek(tabId);
    if (tab?.engine) return;
    await this.startEngine(tabId);
  }

  async view(tabId: number): Promise<TabDetail> {
    await this.settleRestore(tabId);
    let tab = await this.d.tabs.get(tabId);
    if (!tab.engine) {
      // Opening WebAble on a page grants activeTab: adapt this page now.
      await this.startEngine(tabId);
      tab = await this.d.tabs.get(tabId);
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
    const firstRun = !profile.calibrated;
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
    const pins = (rule?.pins ?? []).filter((op) => !rule?.blocks.includes(op));
    const fitView =
      status === 'paused' || status === 'off'
        ? undefined
        : await this.fitViewFor(tab, site);
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
        aiLayout: account?.aiLayout ?? false,
        calibrated: profile.calibrated,
      },
      allSites,
      enabled: settings.enabled,
      analyzed: tab.analysis.used,
      lastSentAt:
        Math.max(tab.analysis.lastSentAt ?? 0, tab.layoutSentAt ?? 0) || null,
      ...(fitView ? { fitView } : {}),
      undoneByYou: [...new Set([...tab.undoneByYou, ...(rule?.blocks ?? [])])],
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
      quickUndone: (
        Object.keys(QUICK_OP) as Array<keyof typeof QUICK_OP>
      ).filter(
        (k) =>
          pins.includes(QUICK_OP[k]) &&
          tab.changes.find((c) => c.op === QUICK_OP[k])?.status ===
            'undone_by_checks',
      ),
      showing: tab.showing,
      globalOverrides: Object.fromEntries(
        GLOBAL_OVERRIDE_OPS.flatMap((op) => {
          const l = settings.globalLevels[op];
          return l === undefined ? [] : [[op, l]];
        }),
      ),
      lastSyncAt: account && account.lastSyncAt > 0 ? account.lastSyncAt : null,
      allSitesAskHidden: settings.hideAllSitesAsk,
      needsReload: tab.needsReload && !paused,
      onDeviceOnly:
        account === null || !account.cloudAnalysis || account.needsReauth,
      triageLine:
        tab.plan?.triage && status !== 'paused' && status !== 'off'
          ? triageLine(tab.plan.triage)
          : null,
      prefs: {
        theme: settings.theme,
        reduceMotion: settings.reduceMotion,
        profile: profile.profile,
        devPlanner: this.d.config.devPlanner ? settings.devPlanner : null,
        fitTextStep: settings.fitTextStep,
        autoSimplify: settings.autoSimplify,
      },
      links: this.links(),
    };
  }

  /** The popup's Fit view block (absent while the page is still being read). */
  private async fitViewFor(
    tab: TabRecord,
    site: SiteRecord | null,
  ): Promise<TabDetail['fitView']> {
    if (!tab.plan || !tab.tabSession || !tab.domain || !site) return undefined;
    const [c, memo, state] = await Promise.all([
      this.context(tab.domain),
      this.d.pages.get(tab.tabId, tab.tabSession),
      this.d.fitViews.get(tab.tabId),
    ]);
    const gate = composeGate({
      ...(await this.plannerBase(c, tab.domain, tab, memo)),
      personOpened: true,
      cached: false,
    });
    return fitViewTabState({
      state,
      tabSession: tab.tabSession,
      verdict: tab.plan.triage,
      excluded: isExcludedSite(tab.domain),
      alwaysHere: site.rule.view === 'fit',
      plannerUnavailable: !gate.call && PLANNER_UNAVAILABLE.has(gate.reason),
      needsConsent: !gate.call && gate.reason === 'no_consent',
    });
  }

  async undo(tabId: number, op: OpId | 'all'): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || !tab.tabSession) return;
    const applied = appliedChanges(tab.changes);
    const targets = op === 'all' ? applied : applied.filter((c) => c.op === op);
    if (targets.length === 0) return;
    const events = targets.map((c) => this.undoEvent(tab, c));
    // Save the explicit site decision before any page message can cause a
    // re-plan. The optional reason window delays only the learning event.
    await this.holdUndos(tab, events);
    if (targets.some((c) => c.op === 'page_zoom'))
      await this.restoreZoom(tabId);
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
    await this.syncSiteCount(tabId);
    await this.reflectSavedUndo(tab, [...undone]);
    // Text was sized for the page scale just undone: size it again without.
    if (
      undone.has('page_zoom') &&
      appliedChanges((await this.d.tabs.get(tabId)).changes).length > 0
    )
      await this.replan(tabId);
    await this.afterChange(tabId);
  }

  /** Re-plan the current page view after a settings change, or report that a reload is needed. */
  private async replan(tabId: number): Promise<boolean> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || !tab.tabSession || !tab.engine) return false;
    const memo = await this.d.pages.get(tabId, tab.tabSession);
    if (!memo) return false;
    const c = await this.context(tab.domain);
    let plan = await this.planMemo(c, tab, memo, true);
    // A scale the person's own action released is decided again here.
    plan = await this.settleScale(tabId, plan);
    await this.d.tabs.update(tabId, (t) => {
      t.plan = plan;
    });
    const reply = await this.d.port.sendToTab(tabId, {
      type: 'sw:plan',
      plan: await this.forPage(tabId, plan),
      reason: 'settings',
    });
    if (reply) await this.processChanges(tabId, reply.changes);
    else await this.afterChange(tabId);
    return true;
  }

  /**
   * An explicit turn-on lifts this site's block: the rule's and the learned
   * one ("Don't suggest this here"), in the caller's sites.update. The block's
   * own evidence goes with it (site_disable counted W.siteBlockDomainF
   * failures here, which would keep a pinned op below the auto threshold).
   * Returns the ops that were blocked, for their 'site_enable' events.
   */
  private unblock(s: SiteRecord, ops: readonly OpId[]): OpId[] {
    const day = toDay(this.now);
    const was = ops.filter(
      (op) => s.rule.blocks.includes(op) || s.state.ops[op]?.block === true,
    );
    s.rule.blocks = s.rule.blocks.filter((b) => !ops.includes(b));
    for (const op of ops) {
      const dop = s.state.ops[op];
      if (!dop?.block) continue;
      Object.assign(dop, subtractCounts(dop, 0, W.siteBlockDomainF, day));
      delete dop.block;
    }
    return was;
  }

  /** Clear "undone this session" so an explicit turn-on applies right away. */
  private async clearSessionOff(
    domain: string,
    ops: readonly OpId[],
  ): Promise<void> {
    await this.d.undos.cancel(domain, ops);
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
      let unblocked: OpId[] = [];
      await this.d.stores.sites.update(tab.domain, (s) => {
        if (scope === 'site') s.rule.levels = { ...s.rule.levels, [op]: next };
        if (!s.rule.pins.includes(op)) s.rule.pins = [...s.rule.pins, op];
        unblocked = this.unblock(s, [op]);
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
        ...unblocked.map((o): EventInput => ({
          cat: tab.category,
          op: o,
          level: next,
          src: 'manual',
          kind: 'site_enable',
        })),
      ]);
    }
    if (op === 'page_zoom') await this.unfreezeScale([tabId]);
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
      let unblocked: OpId[] = [];
      await this.d.stores.sites.update(tab.domain, (s) => {
        const set = new Set(ops);
        if (on) {
          unblocked = this.unblock(s, ops);
          s.rule.pins = [...new Set([...s.rule.pins, ...ops])];
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
      for (const op of unblocked)
        events.push({
          cat: tab.category,
          op,
          level: levels[op] ?? 0,
          src: 'manual',
          kind: 'site_enable',
        });
      if (on) await this.clearSessionOff(tab.domain, ops);
      await this.record(tab, events);
    }
    if (scope === 'everywhere') await this.reconcileRegistration();
    if (ops.includes('page_zoom')) await this.unfreezeScale([tabId]);
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
      await this.restoreZoom(tabId, true);
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
      await this.resumeTab(tabId);
    }
    await this.reconcileRegistration();
    await this.afterChange(tabId);
  }

  /**
   * Resume a tab's engine after a pause or WebAble being off. An engine that
   * never planned on this page plans now (`restarting`) and reports like a
   * fresh load; otherwise the page re-plans from its last reading.
   */
  private async resumeTab(tabId: number): Promise<void> {
    // The page scale first, as on a first plan: text comes back on it.
    await this.reapplyScale(tabId, (await this.d.tabs.get(tabId)).plan);
    const reply = await this.d.port.sendToTab(tabId, { type: 'sw:resume' });
    if (reply?.restarting) {
      await this.d.tabs.update(tabId, (t) => {
        t.phase = 'checking';
        t.checkingSince = this.now;
        t.needsReload = false;
      });
      return;
    }
    if (await this.replan(tabId)) return;
    if (reply && reply.changes.length > 0)
      await this.processChanges(tabId, reply.changes);
    else if (!reply && (await this.startEngine(tabId))) return;
    else
      await this.d.tabs.update(tabId, (t) => {
        t.needsReload = true;
      });
  }

  /** Show on page (the popup's toggle); the tab remembers it until the next page view. */
  async showOnPage(
    tabId: number,
    op: OpId | null,
    on: boolean,
  ): Promise<{ ok: boolean }> {
    const reply = await this.d.port.sendToTab(tabId, {
      type: 'sw:show-on-page',
      op,
      on,
    });
    if (!reply) return { ok: false };
    await this.d.tabs.update(tabId, (t) => {
      t.showing = on;
    });
    return reply;
  }

  /**
   * Cancel superseded Undo decisions on this site, including another tab's
   * pending reason. Returns the pending learning events dropped.
   */
  private async dropHeldUndos(
    tab: TabRecord,
    ops: readonly OpId[],
  ): Promise<Set<OpId>> {
    return tab.domain ? this.d.undos.cancel(tab.domain, ops) : new Set<OpId>();
  }

  /**
   * Put back what was undone on this page ('all' after Undo all). An undo
   * still held for its reason window is dropped, as if it never happened; one
   * already recorded is answered with manual_on. A learned block here is
   * lifted (site_enable), and the page re-plans.
   */
  async redo(tabId: number, op: OpId | 'all'): Promise<void> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain || !tab.tabSession) return;
    const saved = await this.d.stores.sites.get(tab.domain);
    const ops =
      op === 'all'
        ? [...new Set([...tab.undoneByYou, ...saved.rule.blocks])]
        : [op];
    if (ops.length === 0) return;
    const dropped = await this.dropHeldUndos(tab, ops);
    const base = (o: OpId) => ({
      cat: tab.category,
      op: o,
      level: tab.plan?.ops.find((p) => p.op === o)?.level ?? 0,
      src: 'manual' as const,
    });
    let enabled: OpId[] = [];
    await this.d.stores.sites.update(tab.domain, (s) => {
      for (const o of ops) delete s.state.ops[o]?.sessionOff;
      enabled = this.unblock(s, ops);
      s.rule.updatedAt = this.now;
    });
    await this.d.tabs.update(tabId, (t) => {
      t.undoneByYou = t.undoneByYou.filter((o) => !ops.includes(o));
    });
    if (ops.includes('page_zoom'))
      await this.unfreezeScale(
        (await this.domainTabs(tab.domain)).map((t) => t.tabId),
      );
    await this.record(tab, [
      ...ops
        .filter((o) => !dropped.has(o))
        .map((o): EventInput => ({ ...base(o), kind: 'manual_on' })),
      ...enabled.map((o): EventInput => ({
        ...base(o),
        kind: 'site_enable',
      })),
    ]);
    if (!(await this.replan(tabId)) && tab.plan) {
      const reply = await this.d.port.sendToTab(tabId, {
        type: 'sw:plan',
        plan: await this.forPage(tabId, tab.plan),
        reason: 'settings',
      });
      if (reply) await this.processChanges(tabId, reply.changes);
    }
    await this.syncSiteCount(tabId);
    for (const other of await this.domainTabs(tab.domain))
      if (other.tabId !== tabId && other.engine)
        await this.replanLive(other.tabId);
    await this.afterChange(tabId);
  }

  /**
   * The popup's own permission request for this site succeeded: register the
   * engine for every granted origin, then adapt the tab.
   */
  async grantSite(tabId: number): Promise<void> {
    await this.reconcileRegistration(true);
    const tab = await this.d.tabs.get(tabId);
    if (tab.engine) {
      if (await this.replanLive(tabId)) return;
    } else await this.startEngine(tabId);
    await this.afterChange(tabId);
  }

  /** Clear the "Use these on every site" levels; open pages re-plan without them. */
  async clearEverywhere(): Promise<void> {
    await this.d.stores.settings.update((s) => ({ ...s, globalLevels: {} }));
    for (const tab of await this.d.tabs.all())
      if (tab.engine) await this.replanLive(tab.tabId);
    await this.refreshAllBadges();
    this.d.port.broadcast({ type: 'ui:changed', tabId: null });
  }

  /** Re-plan a page unless WebAble is off or its site is paused. */
  private async replanLive(tabId: number): Promise<boolean> {
    const tab = await this.d.tabs.get(tabId);
    if (!tab.domain) return false;
    const [settings, site] = await Promise.all([
      this.d.stores.settings.read(),
      this.d.stores.sites.get(tab.domain),
    ]);
    if (!settings.enabled || site.rule.paused) return false;
    return this.replan(tabId);
  }

  /** Open tabs on a site (the web app's Sites page changes a rule there). */
  private async domainTabs(domain: string): Promise<TabRecord[]> {
    return (await this.d.tabs.all()).filter((t) => t.domain === domain);
  }

  /** The site was paused from the web app: its open pages go back to the original. */
  async pauseDomain(domain: string): Promise<void> {
    for (const tab of await this.domainTabs(domain)) {
      await this.restoreZoom(tab.tabId, true);
      if (tab.engine)
        await this.d.port.sendToTab(tab.tabId, { type: 'sw:pause' });
      await this.d.tabs.update(tab.tabId, (t) => {
        t.changes = [];
        t.offer = null;
      });
      await this.afterChange(tab.tabId);
    }
  }

  /** The site was unpaused from the web app: its open pages resume and re-plan. */
  async resumeDomain(domain: string): Promise<void> {
    const settings = await this.d.stores.settings.read();
    if (!settings.enabled) return;
    for (const tab of await this.domainTabs(domain)) {
      if (!tab.engine) {
        // The page loaded while paused: start it where WebAble may run.
        if (!(await this.startEngine(tab.tabId)))
          await this.d.tabs.update(tab.tabId, (t) => {
            t.needsReload = true;
          });
      } else {
        await this.resumeTab(tab.tabId);
      }
      await this.afterChange(tab.tabId);
    }
  }

  /** An op was blocked on the site from the web app: it comes off the site's open pages. */
  async blockOnDomain(domain: string, op: OpId): Promise<void> {
    for (const tab of await this.domainTabs(domain)) {
      if (!tab.engine || !tab.tabSession) continue;
      await this.d.tabs.update(tab.tabId, (t) => {
        t.acceptedOps = t.acceptedOps.filter((o) => o !== op);
        if (t.offer?.op === op) t.offer = null;
      });
      if (op === 'page_zoom') await this.restoreZoom(tab.tabId);
      else {
        const reply = await this.d.port.sendToTab(tab.tabId, {
          type: 'sw:undo',
          op,
        });
        if (reply) await this.processChanges(tab.tabId, reply.changes);
      }
      if (!(await this.replanLive(tab.tabId)))
        await this.afterChange(tab.tabId);
    }
  }

  /** Another rule changed on the site (unblock, pin, reset): its open pages re-plan. */
  async replanDomain(domain: string): Promise<void> {
    for (const tab of await this.domainTabs(domain))
      if (tab.engine && !(await this.replanLive(tab.tabId)))
        await this.afterChange(tab.tabId);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.d.stores.settings.update((s) => ({ ...s, enabled }));
    // Turning on registers the engine first, so tabs without one can start it.
    if (enabled) await this.reconcileRegistration();
    for (const tab of await this.d.tabs.all()) {
      if (!enabled) {
        if (!tab.engine) continue;
        await this.restoreZoom(tab.tabId, true);
        await this.d.port.sendToTab(tab.tabId, { type: 'sw:pause' });
        await this.d.tabs.update(tab.tabId, (t) => {
          t.changes = [];
          t.offer = null;
        });
        continue;
      }
      if (tab.access !== 'web' || !tab.domain) continue;
      const site = await this.d.stores.sites.get(tab.domain);
      if (site.rule.paused) continue;
      // Pages that loaded while WebAble was off adapt now, without a reload.
      if (!tab.engine) await this.startEngine(tab.tabId);
      else await this.resumeTab(tab.tabId);
      await this.refreshBadge(tab.tabId);
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
    hideAllSitesAsk?: boolean;
    devPlanner?: boolean;
    fitTextStep?: number;
    autoSimplify?: boolean;
  }): Promise<Prefs> {
    await this.d.stores.settings.update((s) => ({
      ...s,
      ...(p.theme ? { theme: p.theme } : {}),
      ...(typeof p.reduceMotion === 'boolean'
        ? { reduceMotion: p.reduceMotion }
        : {}),
      ...(typeof p.hideAllSitesAsk === 'boolean'
        ? { hideAllSitesAsk: p.hideAllSitesAsk }
        : {}),
      ...(typeof p.autoSimplify === 'boolean'
        ? { autoSimplify: p.autoSimplify }
        : {}),
      // Only a build with a local dev planner has the switch.
      ...(typeof p.devPlanner === 'boolean' && this.d.config.devPlanner
        ? { devPlanner: p.devPlanner }
        : {}),
      ...(typeof p.fitTextStep === 'number' && Number.isFinite(p.fitTextStep)
        ? {
            fitTextStep: Math.max(
              -FIT_TEXT_STEPS_MAX,
              Math.min(FIT_TEXT_STEPS_MAX, Math.round(p.fitTextStep)),
            ),
          }
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
    // A fit saved from Tune must take effect on pages already open. Previously
    // only the badges changed, leaving their basic-fit plans in place. The
    // page scale derives from the fit, so it is decided again.
    for (const tab of await this.d.tabs.all()) {
      if (!tab.engine) continue;
      await this.unfreezeScale([tab.tabId]);
      await this.replanLive(tab.tabId);
    }
    if (await this.allSites()) await this.grantedAllSites();
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
        s.compose.clear(),
        s.fitLearning.clear(),
        s.receipts.clear(),
        s.activity.clear(),
        this.breaker.clear(),
        this.composeBreaker.clear(),
        this.d.undos.clear(),
        this.d.fitViews.clear(),
        this.d.inflight.clear(),
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
