import { OP_CATALOG, OP_IDS, type OpId } from '@webable/core/ops/catalog';

import type { KvArea } from './area';
import { KEYS } from './keys';
import { bool, isRecord, JsonStore } from './store';

export type Theme = 'system' | 'light' | 'dark';

/** Extension-wide settings. Local only. */
export interface Settings {
  v: 1;
  /** "Turn WebAble off everywhere" sets this false. */
  enabled: boolean;
  /** Theme for WebAble's own pages (popup, welcome). */
  theme: Theme;
  /** Reduce motion in WebAble's own UI (never affects host pages). */
  reduceMotion: boolean;
  /** Levels chosen with "Use these on every site" (fallback for every site rule). */
  globalLevels: Partial<Record<OpId, number>>;
  /** The welcome page was opened once. */
  welcomed: boolean;
  /** The popup's "Allow on all sites" line is hidden in the main view (Settings keeps it). */
  hideAllSitesAsk: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  enabled: true,
  theme: 'system',
  reduceMotion: false,
  globalLevels: {},
  welcomed: false,
  hideAllSitesAsk: false,
};

const OP_SET: ReadonlySet<string> = new Set(OP_IDS);

/** Keep only known ops with an in-range integer level. */
export function normalizeLevels(raw: unknown): Partial<Record<OpId, number>> {
  const out: Partial<Record<OpId, number>> = {};
  if (!isRecord(raw)) return out;
  for (const [op, level] of Object.entries(raw)) {
    if (!OP_SET.has(op) || typeof level !== 'number' || !Number.isFinite(level))
      continue;
    const max = OP_CATALOG[op as OpId].levels.length - 1;
    out[op as OpId] = Math.max(0, Math.min(max, Math.round(level)));
  }
  return out;
}

export function normalizeSettings(raw: unknown): Settings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS, globalLevels: {} };
  const theme =
    raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system'
      ? raw.theme
      : DEFAULT_SETTINGS.theme;
  return {
    v: 1,
    enabled: bool(raw.enabled, DEFAULT_SETTINGS.enabled),
    theme,
    reduceMotion: bool(raw.reduceMotion, DEFAULT_SETTINGS.reduceMotion),
    globalLevels: normalizeLevels(raw.globalLevels),
    welcomed: bool(raw.welcomed, false),
    hideAllSitesAsk: bool(raw.hideAllSitesAsk, false),
  };
}

export function settingsStore(area: KvArea): JsonStore<Settings> {
  return new JsonStore(area, KEYS.settings, normalizeSettings);
}
