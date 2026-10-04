import type { DomainState, SiteRule } from '@webable/core/learning/types';
import { OP_IDS, type OpId } from '@webable/core/ops/catalog';
import type { LocalSite } from '@webable/core/bridge/protocol';
import { ENGINE_VERSION } from '@webable/core/versions';

import type { KvArea } from './area';
import { KEYS } from './keys';
import { normalizeLevelMemo, type LevelMemo } from './levels';
import { normalizeLevels } from './settings';
import { bool, isRecord, JsonStore, num } from './store';

/**
 * Per-site records, keyed by eTLD+1. A list of sites is browsing history, so
 * this never leaves the device (the web app reads it over the bridge while
 * open). LRU-capped at 500 sites; sites idle for 180 days are dropped.
 */
export interface SiteRecord {
  /** Version that produced the local verifier reliability channel. */
  engineVersion: string;
  rule: SiteRule;
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
  /** Last touched (LRU order). */
  at: number;
}

export const SITE_LRU_MAX = 500;
export const SITE_IDLE_MS = 180 * 86_400_000;

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

export function emptyRule(now: number): SiteRule {
  return { paused: false, pins: [], blocks: [], levels: {}, updatedAt: now };
}

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
    at: now,
  };
}

function normalizeRule(raw: unknown, now: number): SiteRule {
  if (!isRecord(raw)) return emptyRule(now);
  return {
    paused: bool(raw.paused, false),
    pins: opList(raw.pins),
    blocks: opList(raw.blocks),
    levels: normalizeLevels(raw.levels),
    updatedAt: num(raw.updatedAt, now),
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

/** Drop every rule for a site: pause, pins, blocks and levels, set or learned. */
export function resetRule(rec: SiteRecord, now: number): void {
  rec.rule = emptyRule(now);
  for (const dop of Object.values(rec.state.ops)) {
    if (!dop) continue;
    delete dop.block;
    delete dop.pin;
  }
}
