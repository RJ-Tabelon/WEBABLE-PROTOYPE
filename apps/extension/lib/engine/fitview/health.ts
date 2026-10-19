import type { FitLayout, TypeTier } from '@webable/core';

import {
  LONG_TITLE_CLASS,
  TIER_CLASS,
  TIER_NAMES,
  tierPx,
  type TierName,
} from './styles';

/**
 * Render health (docs/10 §4.7, §10): checked on the rendered view before it is
 * shown and again after zoom or text changes.
 *
 *   - no horizontal overflow inside the view;
 *   - every control's hit area is at least T (layout.target.minPx) in both
 *     dimensions (inline links inside running text are exempt, WCAG 2.5.8);
 *   - adjacent type tiers are distinguishable: >= 1.15x in size, or >= 200 in
 *     weight, or carried by a structural cue;
 *   - body text lands at F: rendered px x zoom == F +- 1, and no tier is
 *     drawn below F (meta is set apart by its ink, docs/11 R9). A long page
 *     title (t-page--long) is drawn at the section size on purpose.
 */

export interface TierCheck {
  upper: TierName;
  lower: TierName;
  ratio: number;
  weightDiff: number;
  cue: TypeTier['cue'];
  ok: boolean;
}

export interface HealthReport {
  ok: boolean;
  overflowPx: number;
  /** Controls below T (CSS px x zoom), with their accessible text. */
  small: Array<{ text: string; w: number; h: number }>;
  controls: number;
  tiers: TierCheck[];
  /** Rendered body size x zoom. */
  bodyPx: number | null;
  failures: string[];
}

/** Adjacent tiers must differ by size, weight or a structural cue. */
export function distinguishable(
  upper: TypeTier,
  lower: TypeTier,
  extraCue = false,
): { ok: boolean; ratio: number; weightDiff: number } {
  const ratio = lower.px > 0 ? upper.px / lower.px : Infinity;
  const weightDiff = upper.weight - lower.weight;
  const ok =
    ratio >= 1.15 - 1e-9 ||
    weightDiff >= 200 ||
    upper.cue !== 'none' ||
    extraCue;
  return { ok, ratio, weightDiff };
}

/** The layout's own tier ladder: monotone and distinguishable. */
export function checkTiers(layout: FitLayout): TierCheck[] {
  const out: TierCheck[] = [];
  for (let i = 0; i + 1 < TIER_NAMES.length; i++) {
    const upperName = TIER_NAMES[i] as TierName;
    const lowerName = TIER_NAMES[i + 1] as TierName;
    const upper = layout.type[upperName];
    const lower = layout.type[lowerName];
    // Meta is also set apart by its secondary ink at standard contrast.
    const colour =
      lowerName === 'meta' && layout.palette.contrast === 'standard';
    const d = distinguishable(upper, lower, colour);
    out.push({
      upper: upperName,
      lower: lowerName,
      ratio: d.ratio,
      weightDiff: d.weightDiff,
      cue: upper.cue,
      ok: d.ok && upper.px >= lower.px,
    });
  }
  return out;
}

const CONTROL_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'label.fv-check',
  '[role="button"]',
].join(',');

function exempt(el: Element): boolean {
  // Inline links inside running text (WCAG 2.5.8 inline exception).
  if (el.classList.contains('fv-inline') && !el.closest('.fv-meta'))
    return true;
  // A checkbox or radio inside a whole-row toggle: the row is the target.
  if (el.localName === 'input' && el.closest('label.fv-check')) return true;
  // The duplicate opener around a thumbnail is not a separate target.
  if (el.getAttribute('aria-hidden') === 'true') return true;
  return false;
}

export function checkHealth(
  dialog: HTMLElement,
  scroller: HTMLElement,
  layout: FitLayout,
  zoom: number,
): HealthReport {
  const failures: string[] = [];
  const z = zoom > 0 ? zoom : 1;
  const overflowPx = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  if (overflowPx > 1) failures.push(`overflow:${overflowPx}`);

  const T = layout.target.minPx;
  const small: HealthReport['small'] = [];
  let controls = 0;
  for (const el of Array.from(dialog.querySelectorAll(CONTROL_SELECTOR))) {
    if (exempt(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // inside a closed disclosure
    controls++;
    const w = r.width * z;
    const hgt = r.height * z;
    if (w < T - 0.5 || hgt < T - 0.5)
      small.push({
        text: (el.textContent ?? '').trim().slice(0, 40),
        w: Math.round(w * 10) / 10,
        h: Math.round(hgt * 10) / 10,
      });
  }
  if (small.length) failures.push(`small:${small.length}`);

  const tiers = checkTiers(layout);
  for (const t of tiers) if (!t.ok) failures.push(`tier:${t.upper}/${t.lower}`);
  // Rendered tiers match the layout (sizes are divided by zoom when drawn).
  const view = dialog.ownerDocument.defaultView ?? window;
  for (const name of TIER_NAMES) {
    const sel =
      name === 'pageHeading'
        ? `.${TIER_CLASS[name]}:not(.${LONG_TITLE_CLASS})`
        : `.${TIER_CLASS[name]}`;
    const el = dialog.querySelector(sel);
    if (!el) continue;
    const px = parseFloat(view.getComputedStyle(el).fontSize) * z;
    if (Math.abs(px - tierPx(layout, name)) > 1)
      failures.push(`size:${name}:${Math.round(px * 10) / 10}`);
  }
  let bodyPx: number | null = null;
  const body = dialog.querySelector('.t-body') ?? dialog;
  bodyPx = parseFloat(view.getComputedStyle(body).fontSize) * z;
  if (Math.abs(bodyPx - layout.type.body.px) > 1)
    failures.push(`body:${Math.round(bodyPx * 10) / 10}`);

  return {
    ok: failures.length === 0,
    overflowPx,
    small,
    controls,
    tiers,
    bodyPx,
    failures,
  };
}
