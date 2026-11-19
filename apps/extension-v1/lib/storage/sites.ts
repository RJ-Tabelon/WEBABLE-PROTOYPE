import type { DomainState, SiteRule } from '@webable/core/learning/types';
import { OP_IDS, type OpId } from '@webable/core/ops/catalog';
import type { LocalSite } from '@webable/core/bridge/protocol';
import {
  TRIAGE_BLOCKERS,
  TRIAGE_KINDS,
  TRIAGE_NEEDS,
  type TriageBlocker,
  type TriageKind,
  type TriageNeed,
} from '@webable/core/triage/types';
import { ENGINE_VERSION } from '@webable/core/versions';

import type { KvArea } from './area';
import { KEYS } from './keys';
import { normalizeLevelMemo, type LevelMemo } from './levels';
import { normalizeLevels } from './settings';
import { bool, isRecord, JsonStore, num } from './store';

/**
 * A site's rule as stored here: core's SiteRule plus how Fit view reaches the
 * site. `view: 'fit'` is "Always here" (Fit view opens by itself on this
 * site); absent, Fit view is offered. Resetting the rule clears it.
 */
export type SiteRuleRecord = SiteRule & { view?: 'fit' };

/**
 * The parts of a triage verdict the next visit's hysteresis reads (core
 * `triage()` uses the prior's version, need bands, page scale and blockers).
 */
export interface TriagePrior {
  version: string;
  needs: Record<TriageNeed, TriageKind>;
  zoom: number;
  blockers: TriageBlocker[];
}

/**
 * What WebAble remembers about one page template on a site (keyed by an HMAC
 * of the site and the URL's path shape; the path itself is never stored).
 * Values are person-relative, so they hold only for the profile identity they
 * were computed for.
 */
export interface TemplateMemo {
  /** Last used (LRU within the site). */
  at: number;
  /** Profile identity ("account:3", "default:10") the values belong to. */
  id: string;
  /** The last verdict here: the next visit's hysteresis prior (docs/10 §3.2). */
  prior?: TriagePrior;
  /** Page scale that held here, by window-width bucket: applied at hello on repeat visits. */
  zoom?: Record<string, number>;
}

/** Fit view on this site: keep/undo evidence (Beta-Bernoulli) and the offer budget. */
export interface FitViewSiteStats {
  /** Fit view kept: a proxied action, or the page left while it was open. */
  keep: number;
  /** "Original page" within 30 s with no proxied action. */
  undo: number;
  /** Day (ms / 86 400 000) the last Fit view offer here was answered, 0 = never. */
  offerDay: number;
  /** That day's offer was accepted (more offers that day are fine). */
  offerAccepted: boolean;
}

/**
 * Per-site records, keyed by eTLD+1. A list of sites is browsing history, so
 * this never leaves the device (the web app reads it over the bridge while
 * open). LRU-capped at 500 sites; sites idle for 180 days are dropped.
 */
export interface SiteRecord {
  /** Version that produced the local verifier reliability channel. */
  engineVersion: string;
  rule: SiteRuleRecord;
  /** Domain learning state (Learner A domain counts, engine channel, offsets). */
  state: DomainState;
  /** Last page view on this site (ms). */
  lastVisit: number;
  /** Changes in effect at the end of the last page view. */
  lastChanges: number;
  /** The first-time toast was shown here. */
  announced: boolean;
  /** Levels this site shows, with Learner B suggestions awaiting confirmation. */
  levelMemo: LevelMemo | null;
  /** Page templates seen here (HMAC key -> memo), at most TEMPLATES_PER_SITE. */
  templates: Record<string, TemplateMemo>;
  fitView: FitViewSiteStats;
  /** Last touched (LRU order). */
  at: number;
}

export const SITE_LRU_MAX = 500;
export const SITE_IDLE_MS = 180 * 86_400_000;
/** Templates remembered per site (least recently used dropped first). */
export const TEMPLATES_PER_SITE = 12;
/** Window-width buckets remembered per template. */
export const ZOOM_BUCKETS_PER_TEMPLATE = 4;
/** Fit view keep/undo counts are halved past this total, so old evidence fades. */
export const FIT_STATS_MAX = 40;

export type SiteMap = Record<string, SiteRecord>;

const OP_SET: ReadonlySet<string> = new Set(OP_IDS);
const opList = (raw: unknown): OpId[] =>
  Array.isArray(raw)
    ? [
        ...new Set(
          raw.filter((x): x is OpId => typeof x === 'string' && OP_SET.has(x)),
        ),
      ]
    : [];

export function emptyRule(now: number): SiteRuleRecord {
  return { paused: false, pins: [], blocks: [], levels: {}, updatedAt: now };
}

export const emptyFitViewStats = (): FitViewSiteStats => ({
  keep: 0,
  undo: 0,
  offerDay: 0,
  offerAccepted: false,
});

export function emptyDomain(day: number): DomainState {
  return { t: day, ops: {}, dims: {} };
}

export function newSiteRecord(now: number): SiteRecord {
  return {
    engineVersion: ENGINE_VERSION,
    rule: emptyRule(now),
    state: emptyDomain(Math.floor(now / 86_400_000)),
    lastVisit: 0,
    lastChanges: 0,
    announced: false,
    levelMemo: null,
    templates: {},
    fitView: emptyFitViewStats(),
    at: now,
  };
}

function normalizeRule(raw: unknown, now: number): SiteRuleRecord {
  if (!isRecord(raw)) return emptyRule(now);
  return {
    paused: bool(raw.paused, false),
    pins: opList(raw.pins),
    blocks: opList(raw.blocks),
    levels: normalizeLevels(raw.levels),
    updatedAt: num(raw.updatedAt, now),
    ...(raw.view === 'fit' ? { view: 'fit' as const } : {}),
  };
}

const TEMPLATE_KEY = /^[0-9a-f]{16}$/;
const KINDS: ReadonlySet<string> = new Set(TRIAGE_KINDS);
/** Chrome's zoom presets above 100%: the only page scales WebAble sets. */
const SCALES: ReadonlySet<number> = new Set([1.1, 1.25, 1.5, 1.75, 2]);

function normalizePrior(raw: unknown): TriagePrior | undefined {
  if (!isRecord(raw) || typeof raw.version !== 'string' || !isRecord(raw.needs))
    return undefined;
  const needs = {} as Record<TriageNeed, TriageKind>;
  for (const need of TRIAGE_NEEDS) {
    const band = raw.needs[need];
    if (typeof band !== 'string' || !KINDS.has(band)) return undefined;
    needs[need] = band as TriageKind;
  }
  const zoom = num(raw.zoom, 1);
  return {
    version: raw.version.slice(0, 40),
    needs,
    zoom: zoom === 1 || SCALES.has(zoom) ? zoom : 1,
    blockers: Array.isArray(raw.blockers)
      ? TRIAGE_BLOCKERS.filter((b) => (raw.blockers as unknown[]).includes(b))
      : [],
  };
}

function normalizeTemplate(raw: unknown): TemplateMemo | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id.length > 64)
    return null;
  const out: TemplateMemo = { at: num(raw.at, 0), id: raw.id };
  const prior = normalizePrior(raw.prior);
  if (prior) out.prior = prior;
  if (isRecord(raw.zoom)) {
    const zoom = Object.entries(raw.zoom)
      .filter(
        (e): e is [string, number] =>
          /^\d{1,3}$/.test(e[0]) &&
          typeof e[1] === 'number' &&
          SCALES.has(e[1]),
      )
      .slice(0, ZOOM_BUCKETS_PER_TEMPLATE);
    if (zoom.length > 0) out.zoom = Object.fromEntries(zoom);
  }
  return out;
}

/** The most recently used templates, at most TEMPLATES_PER_SITE. Pure. */
export function pruneTemplates(
  templates: Record<string, TemplateMemo>,
  max = TEMPLATES_PER_SITE,
): Record<string, TemplateMemo> {
  return Object.fromEntries(
    Object.entries(templates)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, max),
  );
}

function normalizeTemplates(raw: unknown): Record<string, TemplateMemo> {
  if (!isRecord(raw)) return {};
  const out: Record<string, TemplateMemo> = {};
  for (const [key, rec] of Object.entries(raw)) {
    if (!TEMPLATE_KEY.test(key)) continue;
    const memo = normalizeTemplate(rec);
    if (memo) out[key] = memo;
  }
  return pruneTemplates(out);
}

const count = (v: unknown): number =>
  Math.max(0, Math.min(FIT_STATS_MAX, num(v, 0)));

function normalizeFitViewStats(raw: unknown): FitViewSiteStats {
  if (!isRecord(raw)) return emptyFitViewStats();
  return {
    keep: count(raw.keep),
    undo: count(raw.undo),
    offerDay: Math.max(0, Math.round(num(raw.offerDay, 0))),
    offerAccepted: bool(raw.offerAccepted, false),
  };
}

function normalizeDomain(raw: unknown, now: number): DomainState {
  if (!isRecord(raw)) return emptyDomain(Math.floor(now / 86_400_000));
  const ops = isRecord(raw.ops) ? raw.ops : {};
  const dims = isRecord(raw.dims) ? raw.dims : {};
  const cleanOps: DomainState['ops'] = {};
  for (const [op, v] of Object.entries(ops))
    if (OP_SET.has(op) && isRecord(v))
      cleanOps[op as OpId] = v as unknown as NonNullable<
        DomainState['ops'][OpId]
      >;
  const out: DomainState = {
    t: num(raw.t, Math.floor(now / 86_400_000)),
    ops: cleanOps,
    dims: dims as DomainState['dims'],
  };
  if (isRecord(raw.silenceDay))
    out.silenceDay = raw.silenceDay as DomainState['silenceDay'];
  if (Array.isArray(raw.exceptions))
    out.exceptions = raw.exceptions.filter(
      (x): x is string => typeof x === 'string',
    );
  return out;
}

export function normalizeSiteRecord(raw: unknown, now: number): SiteRecord {
  if (!isRecord(raw)) return newSiteRecord(now);
  const rule = normalizeRule(raw.rule, now);
  let state = normalizeDomain(raw.state, now);
  if (raw.engineVersion !== ENGINE_VERSION) {
    state = structuredClone(state);
    for (const [op, dop] of Object.entries(state.ops) as Array<
      [OpId, NonNullable<DomainState['ops'][OpId]>]
    >) {
      // Undo used to save only a page-session flag. Honour those explicit
      // choices as saved site preferences when upgrading an existing install.
      if (typeof dop.sessionOff === 'string' && !rule.blocks.includes(op))
        rule.blocks.push(op);
      if (
        dop.engineUntil !== undefined &&
        dop.skipUntil !== undefined &&
        dop.skipUntil <= dop.engineUntil
      )
        delete dop.skipUntil;
      delete dop.e;
      delete dop.rejects;
      delete dop.passDay;
      delete dop.engineUntil;
    }
  }
  return {
    engineVersion: ENGINE_VERSION,
    rule,
    state,
    lastVisit: num(raw.lastVisit, 0),
    lastChanges: Math.max(0, Math.round(num(raw.lastChanges, 0))),
    announced: bool(raw.announced, false),
    levelMemo: normalizeLevelMemo(raw.levelMemo),
    templates: normalizeTemplates(raw.templates),
    fitView: normalizeFitViewStats(raw.fitView),
    at: num(raw.at, 0),
  };
}

/** Drop idle sites, then the least recently used beyond the cap. Pure. */
export function pruneSites(
  sites: SiteMap,
  now: number,
  max = SITE_LRU_MAX,
): SiteMap {
  const live = Object.entries(sites).filter(
    ([, r]) => now - r.at <= SITE_IDLE_MS,
  );
  live.sort(([, a], [, b]) => b.at - a.at);
  return Object.fromEntries(live.slice(0, max));
}

const DOMAIN = /^[a-z0-9.-]{1,253}$|^\[[0-9a-f:]+\]$/;

export function isSiteKey(domain: string): boolean {
  return DOMAIN.test(domain);
}

export class SiteStore {
  private readonly store: JsonStore<SiteMap>;

  constructor(
    area: KvArea,
    private readonly now: () => number = Date.now,
  ) {
    this.store = new JsonStore(area, KEYS.sites, (raw) => {
      const out: SiteMap = {};
      if (!isRecord(raw)) return out;
      const t = this.now();
      for (const [domain, rec] of Object.entries(raw))
        if (isSiteKey(domain)) out[domain] = normalizeSiteRecord(rec, t);
      return out;
    });
  }

  async all(): Promise<SiteMap> {
    return this.store.read();
  }

  /** The record for a site (a fresh one if it has none). Does not write. */
  async get(domain: string): Promise<SiteRecord> {
    const all = await this.store.read();
    return all[domain] ?? newSiteRecord(this.now());
  }

  /** Read-modify-write one site; touches its LRU position and prunes. */
  async update(
    domain: string,
    fn: (rec: SiteRecord) => SiteRecord | void,
  ): Promise<SiteRecord> {
    if (!isSiteKey(domain)) throw new Error('invalid site key');
    let result: SiteRecord | null = null;
    await this.store.update((all) => {
      const t = this.now();
      const cur = all[domain] ?? newSiteRecord(t);
      const draft = structuredClone(cur);
      const next = fn(draft) ?? draft;
      next.at = t;
      result = next;
      return pruneSites({ ...all, [domain]: next }, t);
    });
    return result ?? newSiteRecord(this.now());
  }

  async forget(domain: string): Promise<void> {
    await this.store.update((all) => {
      const { [domain]: _gone, ...rest } = all;
      return rest;
    });
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}

/** The bridge's view of one site (never sent to the server). */
export function toLocalSite(domain: string, rec: SiteRecord): LocalSite {
  const blocked = new Set<string>(rec.rule.blocks);
  for (const [op, d] of Object.entries(rec.state.ops))
    if (d?.block) blocked.add(op);
  const pinned = new Set<string>(rec.rule.pins);
  for (const [op, d] of Object.entries(rec.state.ops))
    if (d?.pin) pinned.add(op);
  return {
    domain,
    paused: rec.rule.paused,
    blocked: [...blocked].sort(),
    pinned: [...pinned].sort(),
    levels: { ...rec.rule.levels },
    lastChanges: rec.lastChanges,
    lastVisit: rec.lastVisit,
  };
}

/** Whether a site has a rule to show: paused, or an op pinned, blocked or set to a level. */
export function hasRule(site: LocalSite): boolean {
  return (
    site.paused ||
    site.pinned.length > 0 ||
    site.blocked.length > 0 ||
    Object.keys(site.levels ?? {}).length > 0
  );
}

/** Sites with a rule, most recent first (a visit alone lists nothing). */
export function listLocalSites(all: SiteMap): LocalSite[] {
  return Object.entries(all)
    .sort(([, a], [, b]) => b.lastVisit - a.lastVisit || b.at - a.at)
    .map(([d, r]) => toLocalSite(d, r))
    .filter(hasRule);
}

/**
 * Drop every rule for a site: pause, pins, blocks and levels, set or learned,
 * and "Always here" for Fit view.
 */
export function resetRule(rec: SiteRecord, now: number): void {
  rec.rule = emptyRule(now);
  for (const dop of Object.values(rec.state.ops)) {
    if (!dop) continue;
    delete dop.block;
    delete dop.pin;
  }
}
