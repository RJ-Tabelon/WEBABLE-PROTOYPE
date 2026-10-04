import type { OpId } from '@webable/core/ops/catalog';
import type { PageCategory } from '@webable/core/page/types';
import type {
  AdaptationPlan,
  AppliedChange,
  PlannedOp,
} from '@webable/core/policy/types';

import type { PopupStatus } from '../protocol';
import type { KvArea } from '../storage/area';
import { KEYS } from '../storage/keys';
import { isRecord } from '../storage/store';

/**
 * Per-tab state for the current page view. Kept in memory and mirrored to
 * storage.session so the popup still has it after the worker restarts. It
 * holds the eTLD+1 only (never the URL), and it dies with the tab.
 */
export interface TabRecord {
  tabId: number;
  /** eTLD+1, shown locally only. */
  domain: string | null;
  access: 'web' | 'restricted' | 'unknown';
  /** Random per page load; learning events use it instead of anything linkable. */
  tabSession: string | null;
  phase: 'none' | 'checking' | 'ready' | 'unreadable';
  /** A content script said hello for the current document. */
  engine: boolean;
  checkingSince: number | null;
  /** When the current page view began (the engine's hello at document_start). */
  startedAt: number | null;
  /** When the page's signals arrived (about DOMContentLoaded). */
  signalsAt: number | null;
  category: PageCategory;
  /** The plan in effect (instant plan plus refinements and accepted offers). */
  plan: AdaptationPlan | null;
  /** The engine's latest report, plus the worker's own page_zoom change. */
  changes: AppliedChange[];
  /** Ops the person undid on this page view. */
  undoneByYou: OpId[];
  /** The one offer this page view may show (popup and in-page chip). */
  offer: PlannedOp | null;
  offersShown: number;
  acceptedOps: OpId[];
  /** When each change became visible (for undo timing). */
  appliedAt: Partial<Record<OpId, number>>;
  /** Friction likelihood ratios seen on this page, per op. */
  friction: Partial<Record<OpId, number>>;
  /** Tab zoom WebAble applied (chrome.tabs.setZoom), to undo it exactly. */
  zoom: { level: number; factor: number; previous: number } | null;
  analysis: {
    calls: number;
    lastCallAt: number | null;
    lastSentAt: number | null;
    used: boolean;
  };
  /** First pointer, key or scroll interaction, when known (friction implies it). */
  interactedAt: number | null;
  /** Manual intensity edits this page view (Learner B episodes). */
  levelEdits: Partial<Record<OpId, { from: number; to: number; at: number }>>;
  /** The page loaded while paused; it adapts after a reload. */
  needsReload: boolean;
  /** Show on page is on (the popup's toggle); a new page view starts with it off. */
  showing: boolean;
  /**
   * A back/forward commit whose document may come from the back/forward cache:
   * the current page view is kept until the page's engine says hello (a
   * restored engine re-binds the tab) or the wait runs out.
   */
  restoring: {
    at: number;
    domain: string | null;
    access: TabRecord['access'];
  } | null;
}

export function freshTab(tabId: number): TabRecord {
  return {
    tabId,
    domain: null,
    access: 'unknown',
    tabSession: null,
    phase: 'none',
    engine: false,
    checkingSince: null,
    startedAt: null,
    signalsAt: null,
    category: 'other',
    plan: null,
    changes: [],
    undoneByYou: [],
    offer: null,
    offersShown: 0,
    acceptedOps: [],
    appliedAt: {},
    friction: {},
    zoom: null,
    analysis: { calls: 0, lastCallAt: null, lastSentAt: null, used: false },
    interactedAt: null,
    levelEdits: {},
    needsReload: false,
    showing: false,
    restoring: null,
  };
}

export const STILL_CHECKING_MS = 5_000;

export interface StatusContext {
  enabled: boolean;
  paused: boolean;
  /** WebAble may run on every site (optional host permission granted). */
  allSites: boolean;
  /** No calibrated profile yet (with or without an account). */
  firstRun: boolean;
  now: number;
}

export const appliedChanges = (
  changes: readonly AppliedChange[],
): AppliedChange[] => changes.filter((c) => c.status === 'applied');
export const undoneByChecks = (
  changes: readonly AppliedChange[],
): AppliedChange[] => changes.filter((c) => c.status === 'undone_by_checks');

/** Which popup state a tab is in (design-final 10.2). Pure. */
export function popupStatus(tab: TabRecord, ctx: StatusContext): PopupStatus {
  if (!ctx.enabled) return 'off';
  if (tab.access === 'restricted') return 'cant_run';
  if (ctx.paused) return 'paused';
  if (!tab.engine) return ctx.allSites ? 'unreadable' : 'needs_site_access';
  if (tab.phase === 'unreadable') return 'unreadable';
  if (tab.phase === 'checking' || tab.phase === 'none') {
    const since = tab.checkingSince ?? ctx.now;
    return ctx.now - since >= STILL_CHECKING_MS ? 'still_checking' : 'checking';
  }
  if (ctx.firstRun) return 'first_run';
  if (appliedChanges(tab.changes).length > 0) return 'adapted';
  if (undoneByChecks(tab.changes).length > 0 && tab.undoneByYou.length === 0)
    return 'all_undone';
  return 'nothing_to_change';
}

/**
 * The live registry: in memory, mirrored to storage.session (a small write per
 * change, coalesced within one task).
 */
export class TabRegistry {
  private readonly tabs = new Map<number, TabRecord>();
  private loaded: Promise<void> | null = null;
  private flushQueued = false;

  constructor(private readonly session: KvArea) {}

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const got = await this.session.getMany([KEYS.tabs]);
        const raw = got[KEYS.tabs];
        if (!isRecord(raw)) return;
        for (const [id, rec] of Object.entries(raw)) {
          const tabId = Number(id);
          if (!Number.isInteger(tabId) || !isRecord(rec)) continue;
          if (!this.tabs.has(tabId))
            this.tabs.set(tabId, {
              ...freshTab(tabId),
              ...(rec as Partial<TabRecord>),
              tabId,
            });
        }
      } catch {
        // Session storage unavailable: start empty.
      }
    })();
    return this.loaded;
  }

  async get(tabId: number): Promise<TabRecord> {
    await this.load();
    let tab = this.tabs.get(tabId);
    if (!tab) {
      tab = freshTab(tabId);
      this.tabs.set(tabId, tab);
    }
    return tab;
  }

  async peek(tabId: number): Promise<TabRecord | undefined> {
    await this.load();
    return this.tabs.get(tabId);
  }

  /** Mutate a tab record and schedule the session mirror. */
  async update(
    tabId: number,
    fn: (tab: TabRecord) => void,
  ): Promise<TabRecord> {
    const tab = await this.get(tabId);
    fn(tab);
    this.scheduleFlush();
    return tab;
  }

  async remove(tabId: number): Promise<void> {
    await this.load();
    this.tabs.delete(tabId);
    this.scheduleFlush();
  }

  async all(): Promise<TabRecord[]> {
    await this.load();
    return [...this.tabs.values()];
  }

  private scheduleFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      const snapshot: Record<string, TabRecord> = {};
      for (const [id, tab] of this.tabs) snapshot[String(id)] = tab;
      void this.session.set({ [KEYS.tabs]: snapshot }).catch(() => undefined);
    });
  }
}
