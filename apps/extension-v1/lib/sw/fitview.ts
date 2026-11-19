import type { StructureLevel } from '@webable/core/fit/structure';
import type { PageCategory, RegionRole } from '@webable/core/page/types';
import type { RegionVerdict } from '@webable/core/policy/types';
import type { Skeleton } from '@webable/core/skeleton/types';
import type { TriageBlocker, TriageVerdict } from '@webable/core/triage/types';

import type {
  FitViewEvent,
  FitViewOpenReason,
  FitViewTabState,
  FitViewUnavailable,
} from '../protocol';
import type { KvArea } from '../storage/area';
import type { KeepCounts } from '../storage/fitlearning';
import { KEYS } from '../storage/keys';
import { isRecord } from '../storage/store';

/**
 * Fit view in the worker (docs/10 §4-7): per-tab state, the planner's
 * in-flight register, and the pure rules for refusing an open, offering Fit
 * view, and learning from how a view ended. The orchestration (spec, solver,
 * injection, zoom, planner call) lives in worker.ts.
 */

// ---------------------------------------------------------------------------
// Per-tab state (storage.session, one key per tab)
// ---------------------------------------------------------------------------

export type PlannerPhase = 'idle' | 'pending' | 'ready' | 'failed';

export interface FitViewState {
  /**
   * Tab mode: Fit view follows navigation in this tab until the person picks
   * Original page (docs/10 §4.5). Survives page views.
   */
  tabMode: boolean;
  /** "Not now" on a Fit view offer in this tab: no more offers here. */
  offerDeclined: boolean;
  /**
   * The site (eTLD+1) where the person last picked "Original page" in this
   * tab: it is not simplified on its own again in this tab (an offer may
   * still show). Survives page views.
   */
  declinedSite: string | null;
  /** The page view (tabSession) an automatic open was decided for: once per page view. */
  autoSession: string | null;
  /** The page view (tabSession) the fields below belong to. */
  session: string | null;
  open: boolean;
  openedAt: number | null;
  reason: FitViewOpenReason | null;
  source: 'heuristic' | 'planner' | null;
  /** The extraction the open (or opening) view was built from. */
  extractionId: string | null;
  /** Planner cache key of this page's template. */
  templateKey: string | null;
  /** createdAt of the cached planner variant in use (to evict exactly that one). */
  variant: number | null;
  planner: PlannerPhase;
  /** The last refusal, for the popup. */
  why: FitViewUnavailable | null;
  /** The document (tabSession) Fit view's scripts and font were sent to. */
  injected: string | null;
  font: string | null;
}

export function freshFitViewState(): FitViewState {
  return {
    tabMode: false,
    offerDeclined: false,
    declinedSite: null,
    autoSession: null,
    session: null,
    open: false,
    openedAt: null,
    reason: null,
    source: null,
    extractionId: null,
    templateKey: null,
    variant: null,
    planner: 'idle',
    why: null,
    injected: null,
    font: null,
  };
}

/** The page-view part of a state, reset for a new page view in the same tab. */
export function forPageView(
  state: FitViewState,
  tabSession: string,
): FitViewState {
  if (state.session === tabSession) return state;
  return {
    ...freshFitViewState(),
    tabMode: state.tabMode,
    offerDeclined: state.offerDeclined,
    declinedSite: state.declinedSite,
    autoSession: state.autoSession,
    session: tabSession,
    // The scripts and the font belong to the document, which a restored page
    // view (back/forward) keeps; a new document re-injects (both guard).
    injected: state.injected,
    font: state.font,
  };
}

const PHASES: ReadonlySet<string> = new Set([
  'idle',
  'pending',
  'ready',
  'failed',
]);
const REASONS: ReadonlySet<string> = new Set([
  'offer',
  'popup',
  'shortcut',
  'auto',
  'tab_mode',
  'route',
  'switch',
]);
const WHYS: ReadonlySet<string> = new Set([
  'not_representable',
  'blocked_overlay',
  'excluded',
  'stale',
  'error',
]);

const strOrNull = (v: unknown, max = 128): string | null =>
  typeof v === 'string' && v.length <= max ? v : null;

export function normalizeFitViewState(raw: unknown): FitViewState {
  const fresh = freshFitViewState();
  if (!isRecord(raw)) return fresh;
  return {
    tabMode: raw.tabMode === true,
    offerDeclined: raw.offerDeclined === true,
    declinedSite: strOrNull(raw.declinedSite, 253),
    autoSession: strOrNull(raw.autoSession),
    session: strOrNull(raw.session),
    open: raw.open === true,
    openedAt: typeof raw.openedAt === 'number' ? raw.openedAt : null,
    reason:
      typeof raw.reason === 'string' && REASONS.has(raw.reason)
        ? (raw.reason as FitViewOpenReason)
        : null,
    source:
      raw.source === 'heuristic' || raw.source === 'planner'
        ? raw.source
        : null,
    extractionId: strOrNull(raw.extractionId, 64),
    templateKey: strOrNull(raw.templateKey, 64),
    variant: typeof raw.variant === 'number' ? raw.variant : null,
    planner:
      typeof raw.planner === 'string' && PHASES.has(raw.planner)
        ? (raw.planner as PlannerPhase)
        : 'idle',
    why:
      typeof raw.why === 'string' && WHYS.has(raw.why)
        ? (raw.why as FitViewUnavailable)
        : null,
    injected: strOrNull(raw.injected),
    font: strOrNull(raw.font),
  };
}

/**
 * Fit view state per tab, in memory and mirrored to storage.session under its
 * own key (`wa.fitview:<tabId>`), never in the wa.tabs snapshot that is
 * rewritten on every change. Updates per tab are serialised.
 */
export class FitViewStates {
  private readonly mem = new Map<number, FitViewState>();
  private readonly queues = new Map<number, Promise<unknown>>();

  constructor(private readonly session: KvArea) {}

  private key(tabId: number): string {
    return `${KEYS.fitViewPrefix}${tabId}`;
  }

  async get(tabId: number): Promise<FitViewState> {
    const cached = this.mem.get(tabId);
    if (cached) return structuredClone(cached);
    let state = freshFitViewState();
    try {
      const got = await this.session.getMany([this.key(tabId)]);
      state = normalizeFitViewState(got[this.key(tabId)]);
    } catch {
      // Session storage unavailable: start fresh.
    }
    if (!this.mem.has(tabId)) this.mem.set(tabId, state);
    return structuredClone(this.mem.get(tabId)!);
  }

  /** Read-modify-write one tab's state (serialised per tab). Returns the new state. */
  update(
    tabId: number,
    fn: (s: FitViewState) => FitViewState | void,
  ): Promise<FitViewState> {
    const run = async (): Promise<FitViewState> => {
      const cur = await this.get(tabId);
      const next = fn(cur) ?? cur;
      this.mem.set(tabId, next);
      await this.session
        .set({ [this.key(tabId)]: next })
        .catch(() => undefined);
      return structuredClone(next);
    };
    const prev = this.queues.get(tabId) ?? Promise.resolve();
    const job = prev.catch(() => undefined).then(run);
    this.queues.set(tabId, job);
    void job
      .catch(() => undefined)
      .then(() => {
        if (this.queues.get(tabId) === job) this.queues.delete(tabId);
      });
    return job;
  }

  async delete(tabId: number): Promise<void> {
    this.mem.delete(tabId);
    await this.session.remove([this.key(tabId)]).catch(() => undefined);
  }

  /** Every tab with a state in memory or session storage. */
  async tabIds(): Promise<number[]> {
    const ids = new Set(this.mem.keys());
    try {
      for (const k of Object.keys(await this.session.getAll()))
        if (k.startsWith(KEYS.fitViewPrefix)) {
          const id = Number(k.slice(KEYS.fitViewPrefix.length));
          if (Number.isInteger(id)) ids.add(id);
        }
    } catch {
      // Memory only.
    }
    return [...ids];
  }

  async clear(): Promise<void> {
    for (const id of await this.tabIds()) await this.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Planner calls in flight (storage.session, by cache key)
// ---------------------------------------------------------------------------

/** A call still counts as in flight this long (its timeout plus slack). */
export const INFLIGHT_MS = 20_000;

export interface InflightWaiter {
  tabId: number;
  extractionId: string;
}

interface Inflight {
  at: number;
  waiters: InflightWaiter[];
}

/**
 * Dedupe for planner calls by cache key, in storage.session so a worker
 * restart does not send the same template twice. Another tab opening the
 * same template meanwhile waits for the call in progress.
 */
export class ComposeInflight {
  constructor(
    private readonly session: KvArea,
    private readonly now: () => number,
  ) {}

  private async read(): Promise<Record<string, Inflight>> {
    try {
      const raw = (await this.session.getMany([KEYS.composeInflight]))[
        KEYS.composeInflight
      ];
      if (!isRecord(raw)) return {};
      const t = this.now();
      const out: Record<string, Inflight> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (!isRecord(v) || typeof v.at !== 'number' || t - v.at > INFLIGHT_MS)
          continue;
        const waiters = Array.isArray(v.waiters)
          ? v.waiters.filter(
              (w): w is InflightWaiter =>
                isRecord(w) &&
                typeof w.tabId === 'number' &&
                typeof w.extractionId === 'string',
            )
          : [];
        out[k] = { at: v.at, waiters };
      }
      return out;
    } catch {
      return {};
    }
  }

  private async write(all: Record<string, Inflight>): Promise<void> {
    await this.session
      .set({ [KEYS.composeInflight]: all })
      .catch(() => undefined);
  }

  private queue: Promise<unknown> = Promise.resolve();

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.queue.catch(() => undefined).then(fn);
    this.queue = job;
    return job;
  }

  /**
   * Claim the call for a key: true when this caller should make it; false
   * when one is already in flight (the waiter is added to it).
   */
  claim(key: string, waiter: InflightWaiter): Promise<boolean> {
    return this.serial(async () => {
      const all = await this.read();
      const cur = all[key];
      if (cur) {
        if (
          !cur.waiters.some(
            (w) =>
              w.tabId === waiter.tabId &&
              w.extractionId === waiter.extractionId,
          )
        )
          cur.waiters.push(waiter);
        await this.write(all);
        return false;
      }
      all[key] = { at: this.now(), waiters: [waiter] };
      await this.write(all);
      return true;
    });
  }

  /** The call for a key ended: release it and return who was waiting. */
  release(key: string): Promise<InflightWaiter[]> {
    return this.serial(async () => {
      const all = await this.read();
      const waiters = all[key]?.waiters ?? [];
      delete all[key];
      await this.write(all);
      return waiters;
    });
  }

  async pending(key: string): Promise<boolean> {
    return (await this.read())[key] !== undefined;
  }

  clear(): Promise<void> {
    return this.serial(() => this.write({}));
  }
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

/** "Original page" this soon after opening, with no proxied action, counts as an undo (docs/10 §7). */
export const QUICK_EXIT_MS = 30_000;

/**
 * Blockers that rule Fit view out on a page whatever the person asks: it would
 * proxy an editor, an app, a canvas or a player, show what a paywall
 * withholds, or touch password or payment fields. (A page with little
 * structure can still open when asked; a blocking overlay is read from the
 * fresh skeleton instead.)
 */
export const HARD_BLOCKERS: ReadonlySet<TriageBlocker> = new Set([
  'editor',
  'application',
  'canvas',
  'video_player',
  'paywall',
  'password',
  'payment',
]);

/** Share of the viewport a fixed dialog or consent box must cover to block the page. */
export const OVERLAY_MIN_SHARE = 0.4;

/**
 * A consent wall or modal dialog is open over the page, as read now: a fixed
 * or sticky dialog, or consent markup, covering much of the viewport.
 */
export function blockingOverlay(skeleton: Skeleton): boolean {
  const area = Math.max(1, skeleton.viewport.width * skeleton.viewport.height);
  return skeleton.nodes.some((n) => {
    const pinned = n.flags.includes('fixed') || n.flags.includes('sticky');
    const modal =
      n.role === 'dialog' ||
      n.role === 'alertdialog' ||
      n.flags.includes('consenthint');
    if (!pinned || !modal) return false;
    const [, , w, h] = n.box;
    return (Math.max(0, w) * Math.max(0, h)) / area >= OVERLAY_MIN_SHARE;
  });
}

/** The innermost node holding focus (the validator never folds its section). */
export function focusNode(skeleton: Skeleton): string | null {
  let found: string | null = null;
  for (const n of skeleton.nodes) if (n.flags.includes('focus')) found = n.id;
  return found;
}

/** Password fields in the skeleton (the extractor refuses such pages; checked again). */
export function hasPasswordField(skeleton: Skeleton): boolean {
  return skeleton.nodes.some((n) => n.inputType === 'password');
}

/** Region roles from local rules and Jev, by component key, for the heuristic spec. */
export function regionRoles(
  verdicts: Record<string, RegionVerdict>,
): Record<string, RegionRole> {
  const out: Record<string, RegionRole> = {};
  for (const [key, v] of Object.entries(verdicts))
    if (v.role) out[key] = v.role;
  return out;
}

/** The person (or their "Always here") asked for this open: the planner may run. */
export function personOpened(
  reason: FitViewOpenReason,
  alwaysHere: boolean,
): boolean {
  return reason !== 'auto' || alwaysHere;
}

/**
 * What a close teaches (docs/10 §7): "Original page" within 30 s with no
 * proxied action is an undo; a proxied action (a navigation through the
 * view) is a keep; a route change, an error or a pause is neither, and so is
 * leaving after a while without acting.
 */
export function closeOutcome(
  event: Extract<FitViewEvent, { kind: 'closed' }>,
): 'keep' | 'undo' | null {
  if (event.reason === 'route' || event.reason === 'error') return null;
  if (event.actions > 0) return 'keep';
  if (event.reason === 'original' && event.afterMs < QUICK_EXIT_MS)
    return 'undo';
  return null;
}

/** Posterior mean of keep under Beta(1 + keep, 1 + undo). */
export function keepRate(c: KeepCounts): number {
  return (1 + c.keep) / (2 + c.keep + c.undo);
}

/** † Offers stop on a site whose views are mostly undone (with enough evidence). */
export const OFFER_SITE_MIN_KEEP = 0.3;
export const OFFER_SITE_MIN_N = 3;
/** † ...and on a page type where they are, across sites. */
export const OFFER_TYPE_MIN_KEEP = 0.25;
export const OFFER_TYPE_MIN_N = 5;

export interface OfferInput {
  verdict: TriageVerdict | undefined;
  /** The person's structure need (core `structureNeed`, docs/11 §2); 0 when absent. */
  structure?: StructureLevel;
  excluded: boolean;
  /** "Always here": Fit view opens by itself, nothing to offer. */
  alwaysHere: boolean;
  tabMode: boolean;
  offerDeclined: boolean;
  /** In-page offers already shown on this page view (v1's one per page). */
  offersThisPage: number;
  /** Offers shown today across sites (v1's daily budget). */
  offersToday: number;
  offersPerDay: number;
  /** This site's last offer day and whether it was accepted. */
  site: {
    offerDay: number;
    offerAccepted: boolean;
    keep: number;
    undo: number;
  };
  pageType: KeepCounts | undefined;
  today: number;
}

/** The page is busy for this person: triage's clutter need is not "fits" (docs/11 §2). */
export const busyFor = (t: TriageVerdict): boolean =>
  t.needs.clutter !== 'fits';

/**
 * Fit view is worth offering here (docs/11 §2): triage says compose, or the
 * page is busy for a person whose fit shows structure helps them (level 1
 * or 2; a level-2 page that is not simplified on its own is offered).
 */
export function offerWarranted(
  t: TriageVerdict,
  structure: StructureLevel = 0,
): boolean {
  return t.verdict === 'compose' || (structure >= 1 && busyFor(t));
}

/**
 * Whether this page view may offer Fit view (docs/10 §7): it is warranted
 * and the page can be re-presented; at most one offer per site per day unless
 * one was accepted; never after "Not now" in this tab; within v1's offer
 * budget; and not where the person's views here are mostly undone.
 */
export function fitViewOfferAllowed(i: OfferInput): boolean {
  const t = i.verdict;
  if (!t || !t.representable || !offerWarranted(t, i.structure)) return false;
  if (i.excluded || i.alwaysHere || i.tabMode || i.offerDeclined) return false;
  if (i.offersThisPage > 0 || i.offersToday >= i.offersPerDay) return false;
  if (i.site.offerDay === i.today && !i.site.offerAccepted) return false;
  if (
    i.site.keep + i.site.undo >= OFFER_SITE_MIN_N &&
    keepRate(i.site) < OFFER_SITE_MIN_KEEP
  )
    return false;
  if (
    i.pageType &&
    i.pageType.keep + i.pageType.undo >= OFFER_TYPE_MIN_N &&
    keepRate(i.pageType) < OFFER_TYPE_MIN_KEEP
  )
    return false;
  return true;
}

/**
 * † A site goes back to an offer after this many quick "Original page" exits,
 * unless Fit view is kept there at least this often (Beta posterior mean).
 */
export const AUTO_SITE_MAX_UNDO = 2;
export const AUTO_SITE_MIN_KEEP = 0.5;
/** † ...and a page type does, across sites, with this much evidence. */
export const AUTO_TYPE_MIN_N = 5;
export const AUTO_TYPE_MIN_KEEP = 0.4;

export interface ArrivalInput extends OfferInput {
  /** settings.autoSimplify: "Simplify busy pages automatically". */
  autoSimplify: boolean;
  /** "Original page" was picked on this site in this tab. */
  declinedHere: boolean;
  /** An automatic open was already decided in this page view. */
  autoDone: boolean;
}

/**
 * The person's views on this site, or on this page type, are mostly undone:
 * Fit view goes back to being offered there (docs/10 §7, docs/11 §2).
 */
export function learnedOffer(
  site: KeepCounts,
  pageType: KeepCounts | undefined,
): boolean {
  if (site.undo >= AUTO_SITE_MAX_UNDO && keepRate(site) < AUTO_SITE_MIN_KEEP)
    return true;
  return (
    pageType !== undefined &&
    pageType.keep + pageType.undo >= AUTO_TYPE_MIN_N &&
    keepRate(pageType) < AUTO_TYPE_MIN_KEEP
  );
}

/**
 * Restructure this page on arrival (docs/11 §2): the person's structure need
 * is level 2 (P(benefit > 0) ≥ 0.8 on one of Tune's Focus effects), the page
 * is busy for them and can be re-presented, the setting is on, and neither
 * this site nor this page type has taught WebAble to offer instead. "Always
 * here" and tab mode reopen Fit view by themselves (hello), so they never
 * need this.
 */
export function autoArrival(i: ArrivalInput): boolean {
  const t = i.verdict;
  if (!t || !t.representable || !busyFor(t) || i.structure !== 2) return false;
  if (i.excluded || i.alwaysHere || i.tabMode) return false;
  if (!i.autoSimplify || i.declinedHere || i.autoDone) return false;
  return !learnedOffer(i.site, i.pageType);
}

/**
 * How Fit view reaches this page view (docs/11 §2 table): restructured on
 * arrival, offered, or neither (the popup switch is always there).
 */
export function fitViewArrival(i: ArrivalInput): 'auto' | 'offer' | null {
  if (autoArrival(i)) return 'auto';
  return fitViewOfferAllowed(i) ? 'offer' : null;
}

/** Why Fit view cannot open on this page, from what the worker knows (null: it can). */
export function unavailableWhy(
  verdict: TriageVerdict | undefined,
  excluded: boolean,
): FitViewUnavailable | null {
  if (excluded) return 'excluded';
  const blockers = verdict?.blockers ?? [];
  if (blockers.some((b) => HARD_BLOCKERS.has(b))) return 'not_representable';
  if (blockers.includes('blocking_overlay')) return 'blocked_overlay';
  return null;
}

export interface TabStateInput {
  state: FitViewState;
  tabSession: string;
  verdict: TriageVerdict | undefined;
  excluded: boolean;
  alwaysHere: boolean;
  /** The planner cannot run here whatever happens on the page (consent, site, breaker). */
  plannerUnavailable: boolean;
  /** Consent is the only thing missing for the planner here. */
  needsConsent?: boolean;
}

/** The popup's Fit view block for a tab (TabView.fitView). */
export function fitViewTabState(i: TabStateInput): FitViewTabState {
  const s = forPageView(i.state, i.tabSession);
  const why = unavailableWhy(i.verdict, i.excluded);
  // A person can always ask (docs/11 §2): every page Fit view may open on,
  // whatever triage says, including pages with little structure.
  const available = why === null && i.verdict !== undefined;
  return {
    available,
    open: s.open,
    tabMode: s.tabMode,
    mode: i.alwaysHere ? 'auto' : i.excluded ? 'off' : 'offer',
    source: s.source,
    planner:
      s.planner === 'pending' || s.planner === 'ready'
        ? s.planner
        : i.plannerUnavailable
          ? 'unavailable'
          : s.planner,
    needsConsent: i.needsConsent === true,
    verdict: i.verdict?.verdict ?? null,
    why: why ?? s.why,
  };
}

/** Keep counts for a page type, never undefined. */
export const countsFor = (
  types: Partial<Record<PageCategory, KeepCounts>>,
  cat: PageCategory,
): KeepCounts => types[cat] ?? { keep: 0, undo: 0 };
