import {
  CARD_STYLES,
  FIELD_ROLES,
  FIELD_SHOW,
  IMPORTANCE,
  ITEM_KINDS,
  LEAD_MODES,
  MEDIA_SHAPES,
  PAGE_TYPES,
  PRIMARY_TASKS,
  SECTION_KINDS,
  SECTION_LAYOUTS,
  SPEC_MAX_COLLECTIONS,
  SPEC_MAX_FIELDS,
  SPEC_MAX_NODE_IDS,
  SPEC_MAX_SECTIONS,
} from '@webable/core/compose/constants';
import type { StoredSpec } from '@webable/core/compose/spec';
import { SKEL_KINDS } from '@webable/core/skeleton/constants';
import type { Locator } from '@webable/core/skeleton/types';

import type { KvArea } from './area';
import { KEYS } from './keys';
import { isRecord, JsonStore } from './store';

/**
 * Layout-planner spec cache (docs/10 §6 "Cache"). Device-local, never
 * uploaded or shared. A planner spec describes a page template, not a person,
 * so the key is HMAC(installSecret, compose | siteKey | path shape | schema |
 * model) and holds up to 3 structural variants; the caller picks the variant
 * whose locators resolve best (at least 80%) and validates it again on every
 * reuse.
 *
 * Specs are stored as locators (`core/skeleton/locate.ts`): structural paths,
 * kinds and HMACs of names. No page text, no URL.
 *
 * Layout: one storage key per template (`wa.compose:<hmac>`) and an index
 * (`wa.composeIndex`: hmac -> last used, newest variant, bytes, site). LRU
 * 150 entries within a 1.5 MB budget (storage.local has no unlimitedStorage);
 * a variant expires 14 days after it was planned.
 */
export const COMPOSE_LRU_MAX = 150;
export const COMPOSE_BYTE_BUDGET = 1.5 * 1024 * 1024;
export const COMPOSE_TTL_MS = 14 * 86_400_000;
export const COMPOSE_VARIANTS_MAX = 3;

interface Entry {
  /** The site's HMAC key, so "Forget this site" can drop its specs. */
  site: string;
  /** Newest first. A variant is identified by its createdAt. */
  variants: StoredSpec[];
}

interface IndexRow {
  /** Last used (LRU order). */
  at: number;
  /** createdAt of the newest variant (TTL). */
  stored: number;
  /** UTF-8 size of the stored entry. */
  bytes: number;
  site: string;
}

type Index = Record<string, IndexRow>;

const HMAC_KEY = /^[0-9a-f]{16,64}$/;
const NAME_HASH = /^[0-9a-f]{8,64}$/;
const MAX_STEPS = 64;
const MAX_STEP_CHARS = 80;

const set = (values: readonly string[]): ReadonlySet<string> => new Set(values);
const SKEL_KIND_SET = set(SKEL_KINDS);
const SECTION_KIND_SET = set(SECTION_KINDS);
const IMPORTANCE_SET = set(IMPORTANCE);
const LAYOUT_SET = set(SECTION_LAYOUTS);
const ITEM_KIND_SET = set(ITEM_KINDS);
const CARD_SET = set(CARD_STYLES);
const MEDIA_SET = set(MEDIA_SHAPES);
const LEAD_SET = set(LEAD_MODES);
const ROLE_SET = set(FIELD_ROLES);
const SHOW_SET = set(FIELD_SHOW);
const PAGE_TYPE_SET = set(PAGE_TYPES);
const TASK_SET = set(PRIMARY_TASKS);

const steps = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) &&
  v.length <= max &&
  v.every((s) => typeof s === 'string' && s.length <= MAX_STEP_CHARS);

const oneOf = (v: unknown, allowed: ReadonlySet<string>): boolean =>
  typeof v === 'string' && allowed.has(v);

export function isLocator(v: unknown): v is Locator {
  return (
    isRecord(v) &&
    steps(v.path, MAX_STEPS) &&
    v.path.length > 0 &&
    oneOf(v.kind, SKEL_KIND_SET) &&
    (v.name === undefined ||
      (typeof v.name === 'string' && NAME_HASH.test(v.name))) &&
    (v.slot === undefined || steps(v.slot, MAX_STEPS))
  );
}

const locatorOrNull = (v: unknown): boolean => v === null || isLocator(v);

function isSection(v: unknown): boolean {
  return (
    isRecord(v) &&
    oneOf(v.kind, SECTION_KIND_SET) &&
    oneOf(v.importance, IMPORTANCE_SET) &&
    oneOf(v.layout, LAYOUT_SET) &&
    Array.isArray(v.nodes) &&
    v.nodes.length > 0 &&
    v.nodes.length <= SPEC_MAX_NODE_IDS &&
    v.nodes.every(isLocator) &&
    locatorOrNull(v.heading)
  );
}

function isCollection(v: unknown): boolean {
  return (
    isRecord(v) &&
    oneOf(v.item_kind, ITEM_KIND_SET) &&
    oneOf(v.card, CARD_SET) &&
    oneOf(v.media, MEDIA_SET) &&
    oneOf(v.lead, LEAD_SET) &&
    isLocator(v.list) &&
    locatorOrNull(v.open) &&
    Array.isArray(v.fields) &&
    v.fields.length <= SPEC_MAX_FIELDS &&
    v.fields.every(
      (f) =>
        isRecord(f) &&
        isLocator(f.slot) &&
        oneOf(f.role, ROLE_SET) &&
        oneOf(f.show, SHOW_SET),
    )
  );
}

/** A stored spec in the exact shape `fromStoredSpec` reads (anything else is dropped). */
export function isStoredSpec(v: unknown): v is StoredSpec {
  return (
    isRecord(v) &&
    typeof v.schema === 'string' &&
    v.schema.length <= 40 &&
    typeof v.model === 'string' &&
    v.model.length <= 40 &&
    typeof v.createdAt === 'number' &&
    Number.isFinite(v.createdAt) &&
    oneOf(v.page_type, PAGE_TYPE_SET) &&
    oneOf(v.primary_task, TASK_SET) &&
    Array.isArray(v.sections) &&
    v.sections.length > 0 &&
    v.sections.length <= SPEC_MAX_SECTIONS &&
    v.sections.every(isSection) &&
    Array.isArray(v.collections) &&
    v.collections.length <= SPEC_MAX_COLLECTIONS &&
    v.collections.every(isCollection)
  );
}

function parseEntry(raw: unknown): Entry | null {
  if (!isRecord(raw) || typeof raw.site !== 'string') return null;
  if (!Array.isArray(raw.variants)) return null;
  const variants = raw.variants
    .filter(isStoredSpec)
    .slice(0, COMPOSE_VARIANTS_MAX);
  return variants.length > 0 ? { site: raw.site, variants } : null;
}

const utf8 = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const storageKey = (key: string): string => KEYS.composePrefix + key;

export class ComposeCache {
  private readonly index: JsonStore<Index>;

  constructor(
    private readonly area: KvArea,
    private readonly now: () => number = Date.now,
    private readonly limits: {
      max: number;
      bytes: number;
      ttl: number;
    } = {
      max: COMPOSE_LRU_MAX,
      bytes: COMPOSE_BYTE_BUDGET,
      ttl: COMPOSE_TTL_MS,
    },
  ) {
    this.index = new JsonStore(area, KEYS.composeIndex, (raw) => {
      const out: Index = {};
      if (!isRecord(raw)) return out;
      for (const [k, row] of Object.entries(raw)) {
        if (!HMAC_KEY.test(k) || !isRecord(row)) continue;
        const { at, stored, bytes, site } = row;
        if (
          typeof at === 'number' &&
          typeof stored === 'number' &&
          typeof bytes === 'number' &&
          typeof site === 'string'
        )
          out[k] = { at, stored, bytes: Math.max(0, bytes), site };
      }
      return out;
    });
  }

  /**
   * The fresh variants stored for a template, newest first; a hit moves the
   * template to the front of the LRU. Expired variants are dropped.
   */
  async get(key: string): Promise<StoredSpec[]> {
    if (!HMAC_KEY.test(key)) return [];
    const raw = (await this.area.getMany([storageKey(key)]))[storageKey(key)];
    const entry = parseEntry(raw);
    const t = this.now();
    const fresh =
      entry?.variants.filter((v) => t - v.createdAt <= this.limits.ttl) ?? [];
    if (!entry || fresh.length === 0) {
      if (raw !== undefined) await this.drop([key]);
      return [];
    }
    if (fresh.length !== entry.variants.length) {
      await this.write(key, { site: entry.site, variants: fresh }, t);
    } else {
      await this.index.update((idx) => {
        const row = idx[key];
        if (row) idx[key] = { ...row, at: t };
        return idx;
      });
    }
    return fresh;
  }

  /**
   * Store a planner spec for a template as its newest variant (at most 3 are
   * kept), then enforce the LRU and the byte budget.
   */
  async put(key: string, site: string, spec: StoredSpec): Promise<void> {
    if (!HMAC_KEY.test(key) || !isStoredSpec(spec)) return;
    const raw = (await this.area.getMany([storageKey(key)]))[storageKey(key)];
    const prev = parseEntry(raw);
    const t = this.now();
    const variants = [
      spec,
      ...(prev?.variants ?? []).filter(
        (v) =>
          v.createdAt !== spec.createdAt && t - v.createdAt <= this.limits.ttl,
      ),
    ].slice(0, COMPOSE_VARIANTS_MAX);
    await this.write(key, { site, variants }, t);
  }

  /**
   * Drop one variant (identified by its createdAt) or, without one, the whole
   * template: a spec that failed conservation, whose proxy failed, or that
   * the person left at once is not reused.
   */
  async evict(key: string, createdAt?: number): Promise<void> {
    if (!HMAC_KEY.test(key)) return;
    if (createdAt === undefined) {
      await this.drop([key]);
      return;
    }
    const raw = (await this.area.getMany([storageKey(key)]))[storageKey(key)];
    const entry = parseEntry(raw);
    if (!entry) {
      if (raw !== undefined) await this.drop([key]);
      return;
    }
    const variants = entry.variants.filter((v) => v.createdAt !== createdAt);
    if (variants.length === entry.variants.length) return;
    if (variants.length === 0) await this.drop([key]);
    else
      await this.write(
        key,
        { site: entry.site, variants },
        (await this.index.read())[key]?.at ?? this.now(),
      );
  }

  /** Templates stored (index rows). */
  async size(): Promise<number> {
    return Object.keys(await this.index.read()).length;
  }

  /** Bytes the stored entries take, as the index counts them. */
  async bytes(): Promise<number> {
    return Object.values(await this.index.read()).reduce(
      (sum, row) => sum + row.bytes,
      0,
    );
  }

  /** Drop every spec stored for one site key ("Forget this site"). */
  async forgetSite(site: string): Promise<void> {
    const all = await this.area.getAll();
    const gone = Object.entries(all)
      .filter(
        ([k, v]) =>
          k.startsWith(KEYS.composePrefix) && isRecord(v) && v.site === site,
      )
      .map(([k]) => k.slice(KEYS.composePrefix.length));
    const indexed = Object.entries(await this.index.read())
      .filter(([, row]) => row.site === site)
      .map(([k]) => k);
    await this.drop([...new Set([...gone, ...indexed])]);
  }

  /** Remove every cached spec (clear local data, the e2e reset). */
  async clear(): Promise<void> {
    const all = await this.area.getAll();
    const keys = Object.keys(all).filter((k) =>
      k.startsWith(KEYS.composePrefix),
    );
    await this.area.remove(keys);
    await this.index.clear();
  }

  private async write(key: string, entry: Entry, at: number): Promise<void> {
    const bytes = utf8(entry);
    await this.area.set({ [storageKey(key)]: entry });
    const stored = Math.max(...entry.variants.map((v) => v.createdAt));
    let evicted: string[] = [];
    await this.index.update((idx) => {
      idx[key] = { at, stored, bytes, site: entry.site };
      const t = this.now();
      const live = Object.entries(idx)
        .filter(([, row]) => t - row.stored <= this.limits.ttl)
        .sort(([, a], [, b]) => b.at - a.at);
      const keep: Array<[string, IndexRow]> = [];
      let total = 0;
      for (const [k, row] of live) {
        if (keep.length >= this.limits.max) break;
        if (total + row.bytes > this.limits.bytes && keep.length > 0) continue;
        keep.push([k, row]);
        total += row.bytes;
      }
      const kept = new Set(keep.map(([k]) => k));
      evicted = Object.keys(idx).filter((k) => !kept.has(k));
      return Object.fromEntries(keep);
    });
    if (evicted.length) await this.area.remove(evicted.map(storageKey));
  }

  private async drop(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.area.remove(keys.map(storageKey));
    await this.index.update((idx) => {
      for (const k of keys) delete idx[k];
      return idx;
    });
  }
}
