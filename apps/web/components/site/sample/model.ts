import {
  OP_CATALOG,
  formatOpValue,
  type OpId,
} from '@webable/core/ops/catalog';

/**
 * The sample page on the website: one realistic news page, and the exact changes
 * WebAble makes to it for a given fit. Every number a visitor sees in a fit mark
 * comes from here, and every "after" value sits on a reviewed op ladder in
 * `@webable/core` (a fit mark with invented numbers is a bug, design-final §8).
 */

/** How the sample page is built, as the site made it. */
export const SAMPLE_ORIGINAL = {
  /** Body text of the article and the side column. */
  bodyPx: 13,
  /** Line height of running text. */
  lineHeight: 1.4,
  /** The visible size and hit area of the small icon buttons. */
  targetPx: 24,
  /** Gap between the icon buttons (a 44 px pitch). */
  targetGapPx: 20,
  /** Things that move on their own: promo carousel, sale badge, countdown. */
  movingParts: 3,
  /** Domain shown in the frame's address line. */
  domain: 'news.example.com',
} as const;

/** One way of fitting the sample page. `null` or `false` leaves that part as the site made it. */
export interface SampleFit {
  id: string;
  /** Text floor in px (op `text_floor`). */
  textFloorPx: number | null;
  /** Line height of running text (op `line_spacing`). */
  lineHeight: number | null;
  /** Hit-area size in px for small controls (op `target_size`). Visible size never changes. */
  targetPx: number | null;
  /** Extra space between small controls in px (op `target_spacing`). */
  targetSpacingPx: number | null;
  /** Click stabilisation window in ms (op `steady_clicks`). Invisible on the page. */
  steadyClicksMs: number | null;
  /** Stops the promo's moving parts (ops `calm_motion` and `pause_media`). */
  calmMotion: boolean;
  /** Opacity of the busy side column (op `dim_distractions`). */
  railOpacity: number | null;
  /** Softens everything except the article (op `focus_view`). */
  focusView: boolean;
}

export const ORIGINAL_FIT: SampleFit = {
  id: 'original',
  textFloorPx: null,
  lineHeight: null,
  targetPx: null,
  targetSpacingPx: null,
  steadyClicksMs: null,
  calmMotion: false,
  railOpacity: null,
  focusView: false,
};

/**
 * The hero's "Fitted" view (design-final §14): exactly three changes, each with a
 * fit mark: 13 → 18 px text, 24 → 44 px targets, 3 → 0 moving things.
 */
export const HERO_FIT: SampleFit = {
  ...ORIGINAL_FIT,
  id: 'hero',
  textFloorPx: 18,
  targetPx: 44,
  calmMotion: true,
};

export type ProfileFitId = 'reading' | 'pointing' | 'focus';

export interface ProfileFit {
  id: ProfileFitId;
  /**
   * Column head: a fact about where the fit came from, never a mode name and never
   * a person ("Fit from a reading-heavy Tune").
   */
  head: string;
  fit: SampleFit;
}

/** "Different people, different fits": the same page adapted three ways. */
export const PROFILE_FITS: readonly ProfileFit[] = [
  {
    id: 'reading',
    head: 'Fit from a reading-heavy Tune',
    fit: {
      ...ORIGINAL_FIT,
      id: 'reading',
      textFloorPx: 21,
      lineHeight: 1.8,
      calmMotion: true,
    },
  },
  {
    id: 'pointing',
    head: 'Fit from a pointing-heavy Tune',
    fit: {
      ...ORIGINAL_FIT,
      id: 'pointing',
      targetPx: 56,
      targetSpacingPx: 12,
      steadyClicksMs: 300,
    },
  },
  {
    id: 'focus',
    head: 'Fit from a focus-heavy Tune',
    fit: {
      ...ORIGINAL_FIT,
      id: 'focus',
      calmMotion: true,
      railOpacity: 0.3,
      focusView: true,
    },
  },
];

export type MarkId =
  | 'text'
  | 'lineSpacing'
  | 'targets'
  | 'spacing'
  | 'steady'
  | 'motion'
  | 'busy'
  | 'focusView';

/** One change, ready for a fit mark. `from` is omitted for single-value changes. */
export interface SampleMark {
  id: MarkId;
  op: OpId;
  /** Op label from the catalog ("Text size"). */
  label: string;
  from?: number | string;
  to: number | string;
  unit?: string;
  /** Spoken form for screen readers: "Text size, 13 to 18 pixels". */
  spoken: string;
}

const SPOKEN_UNIT: Record<string, string> = {
  px: 'pixels',
  ms: 'milliseconds',
};

function mark(
  id: MarkId,
  op: OpId,
  value: { from?: number | string; to: number | string; unit?: string },
): SampleMark {
  const label = OP_CATALOG[op].label;
  const unit = value.unit ? ` ${SPOKEN_UNIT[value.unit] ?? value.unit}` : '';
  const spokenValue =
    value.from === undefined
      ? `${value.to}${unit}`
      : `${value.from} to ${value.to}${unit}`;
  return { id, op, label, ...value, spoken: `${label}, ${spokenValue}` };
}

/** Index of `value` on an op's reviewed ladder, or -1 when it is not a ladder level. */
export function ladderIndex(op: OpId, value: number): number {
  return OP_CATALOG[op].levels.findIndex(
    (level) => Math.abs(level - value) < 1e-9,
  );
}

/**
 * The changes a fit makes to the sample page, in page order. Values are real: the
 * "from" side is how the sample is built, the "to" side is the fit's ladder level.
 */
export function marksFor(fit: SampleFit): SampleMark[] {
  const o = SAMPLE_ORIGINAL;
  const out: SampleMark[] = [];
  if (fit.textFloorPx !== null && fit.textFloorPx > o.bodyPx) {
    out.push(
      mark('text', 'text_floor', {
        from: o.bodyPx,
        to: fit.textFloorPx,
        unit: 'px',
      }),
    );
  }
  if (fit.lineHeight !== null && fit.lineHeight > o.lineHeight) {
    out.push(
      mark('lineSpacing', 'line_spacing', {
        from: o.lineHeight,
        to: fit.lineHeight,
      }),
    );
  }
  if (fit.calmMotion) {
    out.push(mark('motion', 'calm_motion', { from: o.movingParts, to: 0 }));
  }
  if (fit.targetPx !== null && fit.targetPx > o.targetPx) {
    out.push(
      mark('targets', 'target_size', {
        from: o.targetPx,
        to: fit.targetPx,
        unit: 'px',
      }),
    );
  }
  if (fit.targetSpacingPx !== null && fit.targetSpacingPx > 0) {
    out.push(
      mark('spacing', 'target_spacing', {
        from: o.targetGapPx,
        to: o.targetGapPx + fit.targetSpacingPx,
        unit: 'px',
      }),
    );
  }
  if (fit.steadyClicksMs !== null) {
    out.push(
      mark('steady', 'steady_clicks', {
        from: 'Off',
        to: fit.steadyClicksMs,
        unit: 'ms',
      }),
    );
  }
  if (fit.railOpacity !== null) {
    const level = ladderIndex('dim_distractions', fit.railOpacity);
    out.push(
      mark('busy', 'dim_distractions', {
        to: formatOpValue('dim_distractions', level),
      }),
    );
  }
  if (fit.focusView) {
    out.push(mark('focusView', 'focus_view', { to: 'On' }));
  }
  return out;
}

/** Number of separate changes a fit makes (the frame's "Adapted · N changes"). */
export function changeCount(fit: SampleFit): number {
  return marksFor(fit).length;
}

/** The frame's status line for a fitted page, as the popup words it (§10.2). */
export function adaptedStatus(fit: SampleFit): string {
  const n = changeCount(fit);
  return `Adapted · ${n} ${n === 1 ? 'change' : 'changes'}`;
}

/**
 * The accessible description of the sample page for a fit. The page itself is a
 * picture made of real text; this sentence is what a screen reader hears.
 */
export function describeSample(fit: SampleFit): string {
  const o = SAMPLE_ORIGINAL;
  const marks = marksFor(fit);
  if (marks.length === 0) {
    return (
      `A sample news page as the site made it: ${o.bodyPx} px body text, ` +
      `${o.targetPx} px icon buttons, a promo with ${o.movingParts} moving parts, and a busy side column.`
    );
  }
  const parts = marks.map(
    (m) => m.spoken.charAt(0).toLowerCase() + m.spoken.slice(1),
  );
  return `The same news page fitted by WebAble. Changes: ${parts.join('; ')}.`;
}
