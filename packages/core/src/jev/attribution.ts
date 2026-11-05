// Owner: P (round 4). Jev attribution for the passive fit: questions only Jev's calibrated judgment can answer, about
// the page and what happened on it, never about the person.
//
// The passive fit's maths is code (fit/passive.ts). Jev returns one attribution weight w ∈ [0, 1]:
//   zoom_reason   was this held zoom for text (w = P(text)), a picture, the layout, or something else?
//   miss_reason   were this page's missed clicks ordinary slips on ordinary controls (w = P(slip)), or the page's own
//                 doing (controls that moved, appeared late, were tiny or covered)?
//   pause_reason  was a long stop on a short passage spent reading it (w = P(reading)), or away from the page?
// Evidence is code-computed and structure-only: kinds of content, sizes in px, contrast ratios, counts and shares. No
// page text, no URL, nothing typed, and nothing about the person's body, age or health.
// Gate, as the other Jev calls: one Choice asked in both option orders; the weight is the mean of the two
// probabilities, and when the two orders pick different answers it is held at 0.5 or less (fails closed toward less
// evidence). A missing or malformed answer throws; callers then use the code-only fallback weight.
import type { AttributionAnswer, AttributionQuestion, JevMetrics } from '../types';
import { uiLabel } from '../redact';
import { choiceOf } from './api';
import type { JevEntry, JevQuestion, JevResponse } from './api';

export const ATTRIBUTION_CATALOG_VERSION = 'wa-attr-1';

export type AttributionKind = AttributionQuestion['kind'];

/** Option ids per question, in the forward order. The first one is the answer the weight is about. */
export const ATTRIBUTION_OPTIONS: Readonly<Record<AttributionKind, readonly string[]>> = Object.freeze({
  zoom_reason: ['text', 'image', 'layout', 'other'],
  miss_reason: ['slip', 'site'],
  pause_reason: ['reading', 'away', 'other'],
});

/** The answer whose probability is the weight. */
export const ATTRIBUTION_TARGET: Readonly<Record<AttributionKind, string>> = Object.freeze({
  zoom_reason: 'text',
  miss_reason: 'slip',
  pause_reason: 'reading',
});

/** Evidence keys per question, in the order Jev reads them. Anything else is dropped. */
export const ATTRIBUTION_KEYS: Readonly<Record<AttributionKind, readonly string[]>> = Object.freeze({
  zoom_reason: [
    'page_kind', 'zoom_from_pct', 'zoom_to_pct', 'held_seconds', 'centre_kind', 'centre_text_points', 'centre_media_points',
    'centre_text_px', 'page_body_px', 'centre_contrast', 'image_share_pct', 'text_share_pct', 'controls_near_centre',
    'text_px_after_zoom',
  ],
  miss_reason: [
    'page_kind', 'clicks', 'misses', 'near_misses', 'slips', 'median_target_px', 'misses_on_small_targets',
    'misses_after_layout_shift', 'misses_on_moving_parts', 'pointer',
  ],
  pause_reason: ['page_kind', 'words_in_view', 'seconds_still', 'text_px', 'centre_contrast', 'tab_visible_whole_time', 'pointer_moved'],
});

const QUESTION: Readonly<Record<AttributionKind, string>> = Object.freeze({
  zoom_reason:
    'Someone zoomed this web page in and kept it zoomed. Using `zoom`, which describes what was in the middle of the view (centre_kind is the most common kind of content at 9 points there; centre_text_points and centre_media_points count them) and how the page looked before the zoom, what was the zoom most likely for?',
  miss_reason:
    'On this web page some clicks missed the control they were aimed at: they landed just beside it, or the pointer slipped off it while pressing. Using `clicks`, were these misses mainly ordinary slips on ordinary, still controls, or did the page itself cause them?',
  pause_reason:
    'The view of this web page stayed still on a short passage for a long time. Using `pause`, was that time most likely spent reading the passage, or away from the page?',
});

const CRITERIA: Readonly<Record<AttributionKind, Readonly<Record<string, string>>>> = Object.freeze({
  zoom_reason: Object.freeze({
    text: 'To read text: much of the middle of the view is running text, headlines or headings (pictures beside headlines on a news page do not change that), and that text was small or faint before the zoom.',
    image: 'To look at a picture, video, chart or map more closely: the middle of the view is almost all one image or media, with little text to read there.',
    layout: 'To use the page: small buttons, a form or a crowded layout in the middle of the view, rather than text to read.',
    other: 'Something else (for example a dialog or consent screen in front of the page), or the evidence does not point to any of the reasons above.',
  }),
  miss_reason: Object.freeze({
    slip: 'Ordinary slips: the controls were a normal size and stayed where they were, and the pointer landed just beside them or slipped off while pressing.',
    site: 'The page caused them: controls moved or appeared just before the click (a layout shift), were very small, sat on moving parts, or were covered by something else.',
  }),
  pause_reason: Object.freeze({
    reading: 'Reading: the tab stayed in view, the passage is short but not trivial, and the text was small or faint.',
    away: 'Away: the person most likely looked or worked somewhere else while the page sat still.',
    other: 'Something else, or no clear reason from this evidence.',
  }),
});

const NOTE =
  'All numbers were measured by code on the page. They describe the page and what happened on it, not the person.';

/** Clean evidence: known keys only, in the fixed order; strings redacted and capped; numbers finite and rounded. */
export function attributionEvidence(q: AttributionQuestion): Record<string, string | number | boolean> {
  const keys = ATTRIBUTION_KEYS[q.kind] ?? [];
  const out: Record<string, string | number | boolean> = {};
  for (const k of keys) {
    const v = q.evidence?.[k];
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === 'string' && v.trim()) out[k] = uiLabel(v, 6).slice(0, 60);
  }
  return out;
}

/** The Jev call for one attribution question: one Choice in forward and reverse option order. */
export function buildAttributionCall(q: AttributionQuestion): { state: unknown; questions: Record<string, JevQuestion> } {
  const opts = ATTRIBUTION_OPTIONS[q.kind];
  if (!opts) throw new Error(`Unknown attribution question "${String((q as { kind?: unknown }).kind)}"`);
  const evidence = attributionEvidence(q);
  if (!Object.keys(evidence).length) throw new Error('This attribution question has no evidence');
  const evKey = q.kind === 'zoom_reason' ? 'zoom' : q.kind === 'miss_reason' ? 'clicks' : 'pause';
  const instructions: JevEntry = { question: QUESTION[q.kind], [evKey]: evidence, note: NOTE };
  const criteria = (order: readonly string[]): Record<string, JevEntry> => {
    const c: Record<string, JevEntry> = {};
    for (const id of order) c[id] = (CRITERIA[q.kind] as Record<string, string>)[id] ?? id;
    return c;
  };
  return {
    state: { about: 'Why something happened on a web page, from structure-only evidence measured by code.', version: ATTRIBUTION_CATALOG_VERSION },
    questions: {
      [`${q.kind}_fwd`]: { type: 'choice', instructions, criteria: criteria(opts) },
      [`${q.kind}_rev`]: { type: 'choice', instructions, criteria: criteria([...opts].reverse()) },
    },
  };
}

/** Jev's answer, both orders averaged. Throws when an answer is missing (callers fall back to code). */
export function parseAttribution(resp: JevResponse, kind: AttributionKind, metrics: JevMetrics): AttributionAnswer & { agree: boolean } {
  const opts = ATTRIBUTION_OPTIONS[kind];
  const fwd = choiceOf(resp, `${kind}_fwd`);
  const rev = choiceOf(resp, `${kind}_rev`);
  if (!opts || !fwd || !rev) throw new Error('Jev did not answer the attribution question');
  const probs: Record<string, number> = {};
  let total = 0;
  for (const id of opts) {
    const v = ((fwd.probs[id] ?? 0) + (rev.probs[id] ?? 0)) / 2;
    probs[id] = v;
    total += v;
  }
  if (total > 0) for (const id of opts) probs[id] = Math.round(((probs[id] ?? 0) / total) * 1000) / 1000;
  let top = opts[0] as string;
  for (const id of opts) if ((probs[id] ?? 0) > (probs[top] ?? 0)) top = id;
  return { kind, probs, top, metrics, agree: fwd.choice === rev.choice };
}

/**
 * The attribution weight w ∈ [0, 1] for the passive fit: P(target answer). When the two option orders disagreed,
 * at most 0.5. Null answer → the fallback.
 */
export function attributionWeight(a: (AttributionAnswer & { agree?: boolean }) | null | undefined, fallback: number): number {
  if (!a || !a.probs) return clamp01(fallback);
  const target = ATTRIBUTION_TARGET[a.kind];
  const p = a.probs[target];
  if (typeof p !== 'number' || !Number.isFinite(p)) return clamp01(fallback);
  return clamp01(a.agree === false ? Math.min(p, 0.5) : p);
}

/**
 * Code-only weight for a held zoom when Jev cannot be asked: text in the middle of the view counts, a picture, video
 * or map hardly at all, controls half.
 */
export function fallbackZoomWeight(ev: Record<string, string | number | boolean>): number {
  const kind = String(ev.centre_kind ?? 'other');
  let w = /dialog/.test(kind) ? 0.25 : /text|heading|paragraph|article|list|table/.test(kind) ? 0.8 : /image|picture|video|map|canvas|chart|media/.test(kind) ? 0.15 : /form|button|control|navigation|menu/.test(kind) ? 0.4 : 0.5;
  const textPts = Number(ev.centre_text_points);
  const mediaPts = Number(ev.centre_media_points);
  if (Number.isFinite(textPts) && Number.isFinite(mediaPts) && textPts >= 4 && textPts >= mediaPts) w = Math.max(w, 0.7);
  const img = Number(ev.image_share_pct);
  if (Number.isFinite(img) && img >= 50 && !(textPts >= 4)) w = Math.min(w, 0.3);
  return w;
}

/** Code-only weight for a page's misses when Jev cannot be asked: misses right after a layout shift or on tiny targets count less. */
export function fallbackMissWeight(ev: Record<string, string | number | boolean>): number {
  const misses = Math.max(1, Number(ev.misses) || 0);
  const shifted = Math.max(0, Number(ev.misses_after_layout_shift) || 0) / misses;
  const tiny = Math.max(0, Number(ev.misses_on_small_targets) || 0) / misses;
  const moving = Math.max(0, Number(ev.misses_on_moving_parts) || 0) / misses;
  return clamp01(0.85 - 0.6 * shifted - 0.25 * tiny - 0.4 * moving);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : Math.round(x * 1000) / 1000;
}
