import { PAGE_CATEGORIES, type PageCategory } from '@webable/core/page/types';

import type { KvArea } from './area';
import { KEYS } from './keys';
import { isRecord, JsonStore, num } from './store';

/**
 * What Fit view learns on this device (docs/10 §7), never synced: keep and
 * undo counts per page type (the per-site counts live in the site record),
 * and a short log of Fit view defects (a proxied action that failed, a view
 * that lost something) for diagnostics and the evaluation. Nothing here names
 * a site or holds page data.
 */
export interface KeepCounts {
  keep: number;
  undo: number;
}

export type FitDefectKind = 'proxy_failed' | 'conservation_failed';

export interface FitDefect {
  at: number;
  kind: FitDefectKind;
  source: 'heuristic' | 'planner';
  cat: PageCategory;
  role?: 'link' | 'button' | 'input' | 'toggle' | 'select';
  why?: 'not_found' | 'fingerprint' | 'no_effect' | 'blocked';
  /** conservation_failed: how many visible items the view was missing. */
  missing?: number;
}

export interface FitLearningRecord {
  pageTypes: Partial<Record<PageCategory, KeepCounts>>;
  /** Oldest first, at most FIT_DEFECTS_MAX, none older than FIT_DEFECT_MAX_AGE_MS. */
  defects: FitDefect[];
}

export const FIT_DEFECTS_MAX = 50;
export const FIT_DEFECT_MAX_AGE_MS = 30 * 86_400_000;
/** Counts are halved past this total, so old evidence fades. */
export const FIT_COUNTS_MAX = 40;

const CATS: ReadonlySet<string> = new Set(PAGE_CATEGORIES);
const ROLES = new Set(['link', 'button', 'input', 'toggle', 'select']);
const WHYS = new Set(['not_found', 'fingerprint', 'no_effect', 'blocked']);

const clampCount = (v: unknown): number =>
  Math.max(0, Math.min(FIT_COUNTS_MAX, num(v, 0)));

/** Add one observation; halve both counts once their total passes the cap. Pure. */
export function addKeep(c: KeepCounts, kept: boolean): KeepCounts {
  const next = {
    keep: c.keep + (kept ? 1 : 0),
    undo: c.undo + (kept ? 0 : 1),
  };
  if (next.keep + next.undo <= FIT_COUNTS_MAX) return next;
  return { keep: next.keep / 2, undo: next.undo / 2 };
}

function normalizeDefect(raw: unknown): FitDefect | null {
  if (!isRecord(raw)) return null;
  if (raw.kind !== 'proxy_failed' && raw.kind !== 'conservation_failed')
    return null;
  if (raw.source !== 'heuristic' && raw.source !== 'planner') return null;
  if (typeof raw.cat !== 'string' || !CATS.has(raw.cat)) return null;
  const out: FitDefect = {
    at: num(raw.at, 0),
    kind: raw.kind,
    source: raw.source,
    cat: raw.cat as PageCategory,
  };
  if (typeof raw.role === 'string' && ROLES.has(raw.role))
    out.role = raw.role as FitDefect['role'];
  if (typeof raw.why === 'string' && WHYS.has(raw.why))
    out.why = raw.why as FitDefect['why'];
  if (typeof raw.missing === 'number' && raw.missing >= 0)
    out.missing = Math.min(10_000, Math.round(raw.missing));
  return out;
}

export function normalizeFitLearning(raw: unknown): FitLearningRecord {
  const out: FitLearningRecord = { pageTypes: {}, defects: [] };
  if (!isRecord(raw)) return out;
  if (isRecord(raw.pageTypes))
    for (const [cat, c] of Object.entries(raw.pageTypes)) {
      if (!CATS.has(cat) || !isRecord(c)) continue;
      out.pageTypes[cat as PageCategory] = {
        keep: clampCount(c.keep),
        undo: clampCount(c.undo),
      };
    }
  if (Array.isArray(raw.defects))
    out.defects = raw.defects
      .map(normalizeDefect)
      .filter((d): d is FitDefect => d !== null)
      .slice(-FIT_DEFECTS_MAX);
  return out;
}

/** Append a defect, keeping the newest FIT_DEFECTS_MAX within 30 days. Pure. */
export function addDefect(
  rec: FitLearningRecord,
  defect: FitDefect,
  now: number,
): FitLearningRecord {
  return {
    ...rec,
    defects: [...rec.defects, defect]
      .filter((d) => now - d.at <= FIT_DEFECT_MAX_AGE_MS)
      .slice(-FIT_DEFECTS_MAX),
  };
}

export function fitLearningStore(area: KvArea): JsonStore<FitLearningRecord> {
  return new JsonStore(area, KEYS.fitLearning, normalizeFitLearning);
}
