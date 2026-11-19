import type { RegionAnswer } from '@webable/core/decide/wire';

import type { KvArea } from './area';
import { KEYS } from './keys';
import { isRecord, JsonStore } from './store';

/**
 * Page-analysis answer cache (ai-architecture.md 5). Answers are page facts
 * (identical for everyone who sees the same structure), so the key excludes
 * the profile: HMAC(installSecret, siteKey | componentKey | catalog | model).
 * Values are raw probabilities. LRU 5,000 entries, 14-day TTL, on device only.
 *
 * Layout: one storage key per answer (`wa.answer:<hmac>`) plus a small index
 * (`wa.answers`: hmac -> last used), so a lookup reads only what it needs.
 */
export type CachedAnswer =
  | { kind: 'region'; answer: RegionAnswer }
  /** Main-content pick: component key (or 'none') -> probability. */
  | { kind: 'main'; pick: Record<string, number> }
  /** Page type distribution. */
  | { kind: 'page'; dist: Record<string, number> };

interface Entry {
  a: CachedAnswer;
  /** Stored at (ms). */
  at: number;
  /** The site's HMAC key, so "Forget this site" can drop its answers. */
  site?: string;
}

export const ANSWER_LRU_MAX = 5000;
export const ANSWER_TTL_MS = 14 * 86_400_000;
const HMAC_KEY = /^[0-9a-f]{16,64}$/;

const probs = (v: unknown): v is Record<string, number> =>
  isRecord(v) &&
  Object.values(v).every(
    (p) => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1,
  );

export function isCachedAnswer(v: unknown): v is CachedAnswer {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'region':
      return (
        isRecord(v.answer) &&
        probs(v.answer.role) &&
        typeof v.answer.task === 'number' &&
        v.answer.task >= 0 &&
        v.answer.task <= 1
      );
    case 'main':
      return probs(v.pick);
    case 'page':
      return probs(v.dist);
    default:
      return false;
  }
}

function isEntry(v: unknown): v is Entry {
  return isRecord(v) && typeof v.at === 'number' && isCachedAnswer(v.a);
}

type Index = Record<string, number>;

export class AnswerCache {
  private readonly index: JsonStore<Index>;

  constructor(
    private readonly area: KvArea,
    private readonly now: () => number = Date.now,
    private readonly max = ANSWER_LRU_MAX,
    private readonly ttl = ANSWER_TTL_MS,
  ) {
    this.index = new JsonStore(area, KEYS.answersIndex, (raw) => {
      const out: Index = {};
      if (!isRecord(raw)) return out;
      for (const [k, at] of Object.entries(raw))
        if (HMAC_KEY.test(k) && typeof at === 'number') out[k] = at;
      return out;
    });
  }

  /** Fresh entries for the given keys; hits move to the front of the LRU. */
  async getMany(keys: readonly string[]): Promise<Map<string, CachedAnswer>> {
    const wanted = [...new Set(keys.filter((k) => HMAC_KEY.test(k)))];
    const out = new Map<string, CachedAnswer>();
    if (wanted.length === 0) return out;
    const raw = await this.area.getMany(
      wanted.map((k) => KEYS.answerPrefix + k),
    );
    const t = this.now();
    const expired: string[] = [];
    for (const k of wanted) {
      const entry = raw[KEYS.answerPrefix + k];
      if (!isEntry(entry)) continue;
      if (t - entry.at > this.ttl) {
        expired.push(k);
        continue;
      }
      out.set(k, entry.a);
    }
    if (out.size > 0 || expired.length > 0) {
      await this.index.update((idx) => {
        for (const k of out.keys()) idx[k] = t;
        for (const k of expired) delete idx[k];
        return idx;
      });
      if (expired.length)
        await this.area.remove(expired.map((k) => KEYS.answerPrefix + k));
    }
    return out;
  }

  async putMany(
    entries: ReadonlyArray<readonly [string, CachedAnswer]>,
    site?: string,
  ): Promise<void> {
    const valid = entries.filter(
      ([k, a]) => HMAC_KEY.test(k) && isCachedAnswer(a),
    );
    if (valid.length === 0) return;
    const t = this.now();
    const items: Record<string, Entry> = {};
    for (const [k, a] of valid)
      items[KEYS.answerPrefix + k] = site ? { a, at: t, site } : { a, at: t };
    await this.area.set(items);
    let evicted: string[] = [];
    await this.index.update((idx) => {
      for (const [k] of valid) idx[k] = t;
      const live = Object.entries(idx).filter(([, at]) => t - at <= this.ttl);
      live.sort(([, a], [, b]) => b - a);
      const keep = live.slice(0, this.max);
      const keepSet = new Set(keep.map(([k]) => k));
      evicted = Object.keys(idx).filter((k) => !keepSet.has(k));
      return Object.fromEntries(keep);
    });
    if (evicted.length)
      await this.area.remove(evicted.map((k) => KEYS.answerPrefix + k));
  }

  async size(): Promise<number> {
    return Object.keys(await this.index.read()).length;
  }

  /** Drop every answer stored for one site key ("Forget this site"). */
  async forgetSite(site: string): Promise<void> {
    const all = await this.area.getAll();
    const gone = Object.entries(all)
      .filter(
        ([k, v]) =>
          k.startsWith(KEYS.answerPrefix) && isRecord(v) && v.site === site,
      )
      .map(([k]) => k);
    if (gone.length === 0) return;
    await this.area.remove(gone);
    const hashes = new Set(gone.map((k) => k.slice(KEYS.answerPrefix.length)));
    await this.index.update((idx) => {
      for (const h of hashes) delete idx[h];
      return idx;
    });
  }

  /** Remove every cached answer ("Clear page-analysis cache", clear local). */
  async clear(): Promise<void> {
    const all = await this.area.getAll();
    const keys = Object.keys(all).filter((k) =>
      k.startsWith(KEYS.answerPrefix),
    );
    await this.area.remove(keys);
    await this.index.clear();
  }
}
