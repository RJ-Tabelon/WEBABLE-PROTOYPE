// Owner: P. What the WebAble sheet says, as pure functions: the site's name, the text size as a word, which state the
// sheet is in, and the plain lines of "What WebAble did here". Lines come from the kind of each change and a count,
// never from the engine's own titles, so they always read the same way.
import type { OpKind, OpRecord, OverlayAction, OverlayKind } from '@webable/core';
import type { EngineState } from '../../contracts';

export type DidIcon = 'text' | 'contrast' | 'target' | 'fade' | 'pause' | 'popup' | 'steady' | 'bar' | 'lines' | 'star' | 'focus';

export type DidAction = { kind: 'undo'; opIds: string[] } | { kind: 'show'; overlayIds: string[] };

export interface DidLine {
  key: string;
  icon: DidIcon;
  text: string;
  action: DidAction;
}

/** At most this many lines; the most noticeable changes come first. */
export const MAX_LINES = 5;

type Ctx = Pick<EngineState, 'decisions'> & { zoom: number };

interface Group {
  key: string;
  kinds: OpKind[];
  icon: DidIcon;
  text: (ops: OpRecord[], ctx: Ctx) => string;
}

const count = (ops: OpRecord[]): number => ops.reduce((n, o) => n + (Array.isArray(o.targetIds) ? o.targetIds.length : 0), 0);

function fadedText(ops: OpRecord[], ctx: Ctx): string {
  const ids = ops.flatMap((o) => (Array.isArray(o.targetIds) ? o.targetIds : []));
  const n = Math.max(1, ids.length);
  const roles = new Map((ctx.decisions ?? []).map((d) => [d.id, d.judgment?.role] as const));
  const allAds = ids.length > 0 && ids.every((id) => roles.get(id) === 'advertising');
  if (allAds) return n === 1 ? 'Faded an ad' : `Faded ${n} ads`;
  return n === 1 ? 'Faded an ad or promotion' : `Faded ${n} ads and promotions`;
}

function motionText(ops: OpRecord[]): string {
  const n = count(ops);
  if (n === 1) return 'Paused a moving slideshow';
  if (n > 1) return `Paused ${n} moving slideshows`;
  return 'Paused moving things';
}

/** Order is priority: what a person notices first is listed first. */
const BEFORE_POPUPS: Group[] = [
  { key: 'text', kinds: ['page_zoom', 'text_map', 'heading_scale'], icon: 'text', text: (_o, c) => (c.zoom < 0.995 ? 'Made the text smaller' : 'Made the text bigger') },
  { key: 'contrast', kinds: ['contrast', 'weight'], icon: 'contrast', text: () => 'Made faint text darker' },
  { key: 'targets', kinds: ['targets'], icon: 'target', text: () => 'Made buttons easier to hit' },
  { key: 'faded', kinds: ['dim'], icon: 'fade', text: fadedText },
  { key: 'motion', kinds: ['motion'], icon: 'pause', text: motionText },
];

const AFTER_POPUPS: Group[] = [
  { key: 'steady', kinds: ['steady_clicks', 'debounce'], icon: 'steady', text: () => 'Kept your clicks steady' },
  { key: 'sticky', kinds: ['unpin_sticky'], icon: 'bar', text: () => 'Let the top bar scroll away' },
  { key: 'lines', kinds: ['spacing', 'measure', 'column'], icon: 'lines', text: () => 'Made lines easier to follow' },
  { key: 'main', kinds: ['promote_main'], icon: 'star', text: () => 'Outlined the main button' },
  { key: 'focus', kinds: ['focus_ring'], icon: 'focus', text: () => 'Made the keyboard outline easier to see' },
];

/** Overlay actions that count as "moved out of the way" (a docked cookie notice has its own bar). */
const MOVED = new Set<OverlayAction['action']>(['tucked', 'minimised', 'unpinned']);

const POPUP_NOUN: Record<OverlayKind, string> = {
  chat: 'the chat window',
  survey: 'a survey',
  newsletter: 'a sign-up box',
  promo_bar: 'an offer banner',
  modal: 'a pop-up',
  other: 'a pop-up',
  warning: 'a notice',
  header: 'a bar',
  consent: 'the cookie notice',
};

/** One overlay's plain noun ("a survey", "the chat window"). */
export function popupNoun(kind: OverlayKind | string): string {
  return (POPUP_NOUN as Record<string, string>)[kind] ?? 'a pop-up';
}

/** Pop-ups WebAble moved aside that are still out of the way (not brought back, not revealed by the person). */
export function movedPopups(s: Pick<EngineState, 'overlays' | 'ops'>, gone: ReadonlySet<string> = new Set()): OverlayAction[] {
  const ops = new Map((s.ops ?? []).map((o) => [o.id, o]));
  return (s.overlays ?? []).filter((o) => {
    if (!o || !MOVED.has(o.action) || gone.has(o.id)) return false;
    if ((o as OverlayAction & { revealed?: unknown }).revealed === true) return false;
    const op = o.opId ? ops.get(o.opId) : undefined;
    return !op || op.status === 'applied';
  });
}

function popupLine(list: OverlayAction[]): DidLine | null {
  if (list.length === 0) return null;
  const one = list.length === 1;
  return {
    key: 'popups',
    icon: 'popup',
    text: one ? `Moved ${popupNoun(list[0]!.kind)} out of the way` : `Moved ${list.length} pop-ups out of the way`,
    action: { kind: 'show', overlayIds: list.map((o) => o.id) },
  };
}

/**
 * "What WebAble did here": one plain line per kind of change that is on right now, with what undoes it. Ops that
 * moved a pop-up are listed by the pop-up (with "Show it"), not as a change of their own.
 */
export function didLines(
  s: Pick<EngineState, 'ops' | 'overlays' | 'decisions' | 'pageZoom' | 'textZoom' | 'textScale'>,
  gone: ReadonlySet<string> = new Set(),
  max = MAX_LINES,
): DidLine[] {
  const applied = (s.ops ?? []).filter((o) => o && o.status === 'applied');
  const z = typeof s.textZoom === 'number' && s.textZoom > 0 ? s.textZoom : typeof s.pageZoom === 'number' && s.pageZoom > 0 ? s.pageZoom : 1;
  // Round 11: on a phone the text map carries part of the size (text shown at zoom × textScale).
  const zoom = z * (typeof s.textScale === 'number' && s.textScale > 0 ? s.textScale : 1);
  const ctx: Ctx = { decisions: s.decisions ?? [], zoom };
  const lines: DidLine[] = [];
  const add = (g: Group) => {
    const ops = applied.filter((o) => g.kinds.includes(o.kind));
    if (ops.length === 0) return;
    lines.push({ key: g.key, icon: g.icon, text: g.text(ops, ctx), action: { kind: 'undo', opIds: ops.map((o) => o.id) } });
  };
  BEFORE_POPUPS.forEach(add);
  const popups = popupLine(movedPopups(s, gone));
  if (popups) lines.push(popups);
  AFTER_POPUPS.forEach(add);
  return lines.slice(0, Math.max(0, max));
}

/** Round 9: the one row about paragraphs rewritten for this person, or null when there is nothing to say. */
export interface RewordLine {
  text: string;
  /** Still working and nothing rewritten yet: no switch. */
  busy: boolean;
  count: number;
  /** "Show the page's own words" is on. */
  showingOriginal: boolean;
}

export function rewordLine(r: EngineState['reword'] | undefined): RewordLine | null {
  if (!r) return null;
  const n = (r.items ?? []).filter((i) => i && (i.state === 'rewritten' || i.state === 'original')).length;
  if (n === 0) {
    return r.status === 'scoring' || r.status === 'writing'
      ? { text: 'Making hard paragraphs easier…', busy: true, count: 0, showingOriginal: false }
      : null;
  }
  return {
    text: n === 1 ? '1 paragraph rewritten the way you like' : `${n} paragraphs rewritten the way you like`,
    busy: false,
    count: n,
    showingOriginal: !!r.showingOriginal,
  };
}

/** True when WebAble changed something on this page right now (the button's ring turns green). */
export function changedHere(s: Pick<EngineState, 'ops' | 'calm' | 'showingOriginal'> & Partial<Pick<EngineState, 'reword'>>): boolean {
  if (s.showingOriginal) return false;
  if (s.calm?.open) return true;
  if (s.reword && !s.reword.showingOriginal && (s.reword.items ?? []).some((i) => i?.state === 'rewritten')) return true;
  return (s.ops ?? []).some((o) => o && o.status === 'applied' && o.kind !== 'calm_view');
}

export type SheetMode = 'off' | 'paused' | 'original' | 'on';

export function sheetMode(s: Pick<EngineState, 'settings' | 'showingOriginal'>, origin: string): SheetMode {
  if (!s.settings?.enabled) return 'off';
  if ((s.settings.pausedOrigins ?? []).includes(origin)) return 'paused';
  if (s.showingOriginal) return 'original';
  return 'on';
}

/** The engine's one plain line when the page could not be read. */
export const UNREAD = "Couldn't read this page right now. Text size and buttons still work.";

export function pageUnread(s: Pick<EngineState, 'phase' | 'ledger' | 'understanding'>): boolean {
  if (s.phase === 'error') return true;
  if (s.understanding) return false;
  return (s.ledger ?? []).some((e) => typeof e?.title === 'string' && e.title.startsWith("Couldn't read this page"));
}

/** The simplified page is in use on this page (open now, or it opened by itself and the person went back). */
export function showViewSwitch(calm: EngineState['calm'] | undefined): boolean {
  return Boolean(calm && (calm.open || calm.auto));
}

/** The simplified page's text scale for a step (CalmView: 1 + 0.15 per step, within 0.85..1.6). */
export function calmScale(step: number | undefined): number {
  const st = typeof step === 'number' && Number.isFinite(step) ? step : 0;
  return Math.min(1.6, Math.max(0.85, 1 + 0.15 * st));
}

/** The zoom text is shown at: the tab's zoom without the page column's share (see EngineState.textZoom). */
export function textZoomOf(s: Pick<EngineState, 'pageZoom' | 'textZoom'>, pageZoom: number): number {
  const z = Number.isFinite(pageZoom) && pageZoom > 0 ? pageZoom : 1;
  const ratio = s.textZoom && s.pageZoom > 0 ? s.textZoom / s.pageZoom : 1;
  return z * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
}

/**
 * Body text size as the person sees it, in px at 100%: on the simplified page, the fit's size times its step; on
 * the page, the page's own paragraph size (`pagePx`, CSS px) times the zoom text is shown at.
 */
export function shownTextPx(
  s: Pick<EngineState, 'calm' | 'fit' | 'pageZoom' | 'textZoom'>,
  pageZoom: number,
  pagePx: number | null,
): number | null {
  if (s.calm?.open) {
    const base = s.fit?.text?.override ?? s.fit?.text?.bodyPx ?? 16;
    return Number.isFinite(base) ? base * calmScale(s.calm.textStep) : null;
  }
  if (pagePx === null || !Number.isFinite(pagePx) || pagePx <= 0) return null;
  return pagePx * textZoomOf(s, pageZoom);
}

/**
 * Text size levels as people see them (round 8c point 3: words, never px). Same levels as the onboarding's results
 * page (fitting/results/adjust.ts TEXT_LEVELS); the sizes stay in here.
 */
export const SIZE_WORDS: ReadonlyArray<{ px: number; word: string }> = [
  { px: 16, word: 'Standard' },
  { px: 18, word: 'Larger' },
  { px: 20, word: 'Large' },
  { px: 24, word: 'Extra large' },
  { px: 28, word: 'Largest' },
];

/** The word for a shown text size: the nearest level by ratio; at or under about 16 is Standard. '' when unknown. */
export function sizeWord(px: number | null): string {
  if (px === null || !Number.isFinite(px) || px <= 0) return '';
  if (px <= 16.5) return 'Standard';
  let best = 0;
  for (let i = 1; i < SIZE_WORDS.length; i++) {
    const d = (j: number) => Math.abs(Math.log(px / (SIZE_WORDS[j] as { px: number }).px));
    if (d(i) <= d(best)) best = i;
  }
  return (SIZE_WORDS[best] as { word: string }).word;
}

/** "nytimes.com" from an origin or URL; '' when there is none. */
export function siteName(origin: string): string {
  try {
    const h = new URL(origin).hostname;
    return h.replace(/^www\./, '');
  } catch {
    return '';
  }
}
