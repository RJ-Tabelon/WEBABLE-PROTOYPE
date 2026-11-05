// Owner: P (round 7). Structured content read on the device (`ExtractedData`) mapped to the props of Calm view's
// meaning components (./components/types.ts). Pure: no DOM, so it is unit tested. Clickable items get `onActivate`
// from the caller, which presses the original element on the page.
import type { ExtractedData } from '@webable/core';
import type {
  DataTableProps, LogoMarkProps, Picture, RecipeProps, ScheduleItem, ScheduleListProps, ScoreboardProps, StatGridProps, StatItem,
} from './components/types';

type Of<K extends ExtractedData['kind']> = Extract<ExtractedData, { kind: K }>;

const MAX_STATS = 12;
const MAX_ROWS = 400;

/** Pictures only from addresses an <img> can show safely (https, http on the page's own origin, small data URLs). */
export function safePictureSrc(src: string | undefined | null, pageOrigin = ''): string | null {
  if (!src || typeof src !== 'string') return null;
  const s = src.trim();
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(s)) return s.length <= 200_000 ? s : null;
  try {
    const u = new URL(s, pageOrigin || undefined);
    if (u.protocol === 'https:') return u.href;
    if (u.protocol === 'http:' && pageOrigin && u.origin === new URL(pageOrigin).origin) return u.href;
  } catch {
    return null;
  }
  return null;
}

function trimText(s: unknown, max = 200): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Numbers as people write them in stats and tables: "54", "30-6", "7-38", "$4.00", "12.5%", "—". */
export function isNumberLike(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return /^[-+]?[$€£]?\s?\d[\d,.]*\s?(%|[a-z]{0,3})?$/i.test(t) || /^\d+\s?[-–]\s?\d+$/.test(t) || /^[—–-]$/.test(t) || /^\d{1,2}[:/]\d{1,2}([:/]\d{2,4})?$/.test(t);
}

function words(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+(?:[-/.:][a-z0-9]+)*/g) ?? [];
}

/**
 * The record as a grid. `lead`: this is the page's main record, so its first two numbers (wins and losses) lead; a
 * second grid of stats on the same page does not. A title that only repeats the grid's own words ("Wins 54 Losses
 * 22") is left out.
 */
export function statGridProps(d: Of<'stats'>, opts: { title?: string | null; lead?: boolean } = {}): StatGridProps {
  const items: StatItem[] = d.items
    .filter((x) => x && trimText(x.label) && trimText(x.value))
    .slice(0, MAX_STATS)
    .map((x) => ({ label: trimText(x.label, 80), value: trimText(x.value, 40), ...(trimText(x.sub) ? { sub: trimText(x.sub, 80) } : {}), emphasis: 'normal' as const }));
  const lead = opts.lead !== false && items.length >= 3 ? 2 : 0;
  for (let i = 0; i < lead; i++) items[i]!.emphasis = 'lead';
  let title = opts.title === null ? '' : trimText(opts.title ?? d.title, 140);
  if (title) {
    const own = new Set(items.flatMap((x) => [...words(x.label), ...words(x.value)]));
    if (words(title).every((w) => own.has(w))) title = '';
  }
  return { ...(title ? { title } : {}), items };
}

function scoreNumber(s: string): number | null {
  const m = /^\s*(\d{1,4})\s*$/.exec(s);
  return m ? Number(m[1]) : null;
}

export function scoreboardProps(d: Of<'scoreboard'>, pageOrigin = ''): ScoreboardProps {
  const sides = d.sides.slice(0, 2).map((s) => {
    const src = safePictureSrc(s.logoSrc, pageOrigin);
    const name = trimText(s.name, 60);
    const logo: Picture | undefined = src ? { src, alt: trimText(s.logoAlt, 80) || `${name} logo`, ratio: 1 } : undefined;
    return {
      name, score: trimText(s.score, 12), ...(logo ? { logo } : {}), ...(s.side ? { side: s.side } : {}),
      ...(typeof s.winner === 'boolean' ? { winner: s.winner } : {}),
    };
  });
  // The page says who won by the scores when it does not mark it: a finished game with two different scores.
  if (sides.length === 2 && sides.every((s) => s.winner === undefined)) {
    const a = scoreNumber(sides[0]!.score);
    const b = scoreNumber(sides[1]!.score);
    if (a !== null && b !== null && a !== b) {
      sides[0]!.winner = a > b;
      sides[1]!.winner = b > a;
    }
  }
  const periods = d.periods && Array.isArray(d.periods.labels) && d.periods.labels.length && Array.isArray(d.periods.rows) && d.periods.rows.length
    ? {
        labels: d.periods.labels.map((l) => trimText(l, 12)),
        rows: d.periods.rows.slice(0, 4).map((r) => ({ name: trimText(r.name, 60), values: (r.values ?? []).map((v) => trimText(v, 12)) })),
      }
    : undefined;
  return {
    ...(trimText(d.label) ? { label: trimText(d.label, 60) } : {}),
    ...(trimText(d.date) ? { date: trimText(d.date, 60) } : {}),
    ...(trimText(d.joiner) ? { joiner: trimText(d.joiner, 8) } : {}),
    sides,
    ...(periods ? { periods } : {}),
  };
}

export function dataTableProps(d: Of<'table'>, opts: { showFirst?: number } = {}): DataTableProps {
  const columns = d.columns.map((c) => trimText(c, 80));
  const rows = d.rows.slice(0, MAX_ROWS).map((r) => columns.map((_, i) => trimText(r[i], 160)));
  let numericCols = Array.isArray(d.numericCols) ? d.numericCols.filter((i) => Number.isInteger(i) && i >= 0 && i < columns.length) : undefined;
  if (!numericCols) {
    numericCols = columns
      .map((_, i) => i)
      .filter((i) => {
        const cells = rows.map((r) => r[i] ?? '').filter(Boolean);
        return cells.length >= 2 && cells.filter(isNumberLike).length >= 0.8 * cells.length;
      });
  }
  const showFirst = opts.showFirst && rows.length > opts.showFirst + 2 ? opts.showFirst : undefined;
  return {
    ...(trimText(d.caption) ? { caption: trimText(d.caption, 160) } : {}),
    columns, rows, ...(numericCols.length ? { numericCols } : {}), ...(showFirst ? { showFirst } : {}),
  };
}

export function scheduleProps(d: Of<'schedule'>, activate: (nodeId: string) => (() => void) | undefined, pageOrigin = ''): ScheduleListProps {
  const items: ScheduleItem[] = d.items.slice(0, 200).map((x) => {
    const src = safePictureSrc(x.logoSrc, pageOrigin);
    const on = x.nodeId ? activate(x.nodeId) : undefined;
    return {
      date: trimText(x.date, 40), title: trimText(x.title, 120),
      ...(trimText(x.detail) ? { detail: trimText(x.detail, 120) } : {}),
      ...(trimText(x.result) ? { result: trimText(x.result, 40) } : {}),
      ...(src ? { logo: { src, alt: `${trimText(x.title, 60)} logo`, ratio: 1 } } : {}),
      ...(on ? { onActivate: on } : {}),
    };
  });
  return { ...(trimText(d.title) ? { title: trimText(d.title, 120) } : {}), items };
}

export function recipeProps(d: Of<'recipe'>, pageOrigin = ''): RecipeProps {
  const src = safePictureSrc(d.imageSrc, pageOrigin);
  const meta: StatItem[] = (d.meta ?? []).filter((m) => trimText(m.label) && trimText(m.value)).slice(0, 6).map((m) => ({ label: trimText(m.label, 40), value: trimText(m.value, 40) }));
  return {
    title: trimText(d.title, 160),
    ...(meta.length ? { meta } : {}),
    ...(src ? { picture: { src, alt: trimText(d.title, 120) } } : {}),
    ingredients: d.ingredients.map((x) => trimText(x, 300)).filter(Boolean).slice(0, 80),
    steps: d.steps.map((x) => trimText(x, 1200)).filter(Boolean).slice(0, 60),
    ...(d.notes?.length ? { notes: d.notes.map((x) => trimText(x, 600)).filter(Boolean).slice(0, 12) } : {}),
  };
}

export function logoProps(d: Of<'logo'>, pageOrigin = ''): LogoMarkProps | null {
  const src = safePictureSrc(d.src, pageOrigin);
  if (!src) return null;
  const label = trimText(d.label, 80);
  return { picture: { src, alt: label ? `${label} logo` : 'Logo' }, label, size: 'medium' };
}

/** Every string a piece of content shows (for working out which page elements it already covers). */
export function dataStrings(d: ExtractedData): string[] {
  switch (d.kind) {
    case 'stats': return [d.title ?? '', ...d.items.flatMap((x) => [x.label, x.value, x.sub ?? ''])];
    case 'scoreboard':
      return [d.label ?? '', d.date ?? '', d.joiner ?? '', ...d.sides.flatMap((s) => [s.name, s.score, s.logoAlt ?? '']),
        ...(d.periods ? [...d.periods.labels, ...d.periods.rows.flatMap((r) => [r.name, ...r.values])] : [])];
    case 'table': return [d.caption ?? '', ...d.columns, ...d.rows.flat()];
    case 'schedule': return [d.title ?? '', ...d.items.flatMap((x) => [x.date, x.title, x.detail ?? '', x.result ?? ''])];
    case 'recipe': return [d.title, ...(d.meta ?? []).flatMap((m) => [m.label, m.value]), ...d.ingredients, ...d.steps, ...(d.notes ?? [])];
    case 'logo': return [d.label];
  }
}

/** Words each component writes as its own headings or labels (so the page's matching headings count as covered). */
export const COMPONENT_WORDS: Record<ExtractedData['kind'], string[]> = {
  stats: ['record', 'records', 'overall', 'all-time', 'stats', 'statistics', 'series', 'history'],
  scoreboard: ['final', 'last', 'matchup', 'score', 'scores', 'game', 'won', 'lost', 'home', 'away', 'total', 'f', 'ot', 't'],
  table: [],
  schedule: ['schedule', 'results'],
  recipe: ['ingredients', 'ingredient', 'directions', 'direction', 'steps', 'step', 'instructions', 'method', 'prep', 'cook', 'total', 'time',
    'servings', 'serving', 'yield', 'mins', 'min', 'hrs', 'hr', 'hour', 'hours', 'minutes', 'additional', 'notes', 'tips'],
  logo: ['logo'],
};
