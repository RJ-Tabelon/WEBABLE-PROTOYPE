import { benefitProbability, needLevels } from './needs';
import type { FitProfile, LatentDim, ParamSource } from './schema';

/**
 * Plain-language rows for the "Your fit" screen (design-final.md 9.4-9.5) and
 * the CSS hooks WebAble's own UI reads (tokens.css `--wa-*`).
 *
 * Copy rules (design-final.md 13): calm, exact, short; digits with units and a
 * no-break space; functions and pages, never people or conditions; no exam
 * language. Every value shown here is a real profile value.
 */

export type FitRowId =
  | 'textSize'
  | 'contrast'
  | 'polarity'
  | 'lineSpacing'
  | 'lineLength'
  | 'targets'
  | 'steadyClicks'
  | 'hoverGrace'
  | 'motion'
  | 'busyPages';

export type ConfidenceLabel = 'high' | 'medium' | 'low';

export type SourceKind = ParamSource;

export interface FitRow {
  id: FitRowId;
  label: string;
  /** Browser default, or the previous fit when recalibrating. */
  before: string;
  /** This fit. */
  after: string;
  /** Screen-reader form of the fit mark, e.g. "16 to 19 pixels". */
  srText: string;
  changed: boolean;
  /** One plain sentence in the design's voice. */
  sentence: string;
  /** "Measured today", "Set by you", "Your system setting", "Learned as you browse" or "Default". */
  source: string;
  sourceKind: SourceKind;
  confidence: ConfidenceLabel;
  /** Whether WebAble will change pages for this row without asking first. */
  changesPages: boolean;
}

export interface FitRowOptions {
  /** The browser's default font size, CSS px (default 16). */
  browserDefaultPx?: number;
  /** "Today" for the source line; defaults to the profile's creation day. */
  now?: Date;
}

const NBSP = ' ';
const px = (n: number) => `${formatNumber(n)}${NBSP}px`;
const ms = (n: number) => `${formatNumber(n)}${NBSP}ms`;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function sourceLabel(
  kind: SourceKind,
  profile: FitProfile,
  now: Date | undefined,
): string {
  switch (kind) {
    case 'override':
    case 'stated':
      return 'Set by you';
    case 'system':
      return 'Your system setting';
    case 'learned':
      return 'Learned as you browse';
    case 'default':
      return 'Default';
    case 'measured': {
      const created = new Date(profile.createdAt);
      if (!now || Number.isNaN(created.getTime()) || sameDay(created, now))
        return 'Measured today';
      return `Measured ${MONTHS[created.getUTCMonth()] ?? ''} ${created.getUTCDate()}`;
    }
  }
}

/** cal-motor.md 5.6 / cal-vision.md: high >= 0.7, medium >= 0.4. */
function paramConfidence(c: number): ConfidenceLabel {
  return c >= 0.7 ? 'high' : c >= 0.4 ? 'medium' : 'low';
}

/** cal-attention.md 5: high > 0.5, medium >= 0.25. */
function latentConfidence(c: number): ConfidenceLabel {
  return c > 0.5 ? 'high' : c >= 0.25 ? 'medium' : 'low';
}

function latentSource(dim: LatentDim): SourceKind {
  if (dim.sources.includes('override')) return 'override';
  if (dim.sources.includes('learned')) return 'learned';
  if (
    dim.sources.some(
      (s) => s === 'behavior' || s === 'preference' || s === 'chips',
    )
  )
    return 'measured';
  if (dim.sources.includes('system')) return 'system';
  return 'default';
}

interface Shown {
  value: string;
  sr: string;
}

function fitMark(
  before: Shown,
  after: Shown,
  unit: string | null,
): { srText: string; changed: boolean } {
  const changed = before.value !== after.value;
  if (!changed) return { srText: `${after.sr}, no change`, changed };
  if (unit)
    return {
      srText: `${before.sr.replace(` ${unit}`, '')} to ${after.sr}`,
      changed,
    };
  return { srText: `from ${before.sr} to ${after.sr}`, changed };
}

/* ------------------------------------------------------------------------ */
/* Per-row display                                                            */
/* ------------------------------------------------------------------------ */

function textShown(p: FitProfile, browserPx: number): Shown {
  const body = Math.max(p.vision.textMinPx.value, browserPx);
  return { value: px(body), sr: `${formatNumber(body)} pixels` };
}

function contrastShown(p: FitProfile): Shown {
  const v = p.vision.contrastFloor.value;
  if (v === 21) return { value: 'Maximum', sr: 'maximum contrast' };
  return { value: `${formatNumber(v)}:1`, sr: `${formatNumber(v)} to 1` };
}

function polarityShown(p: FitProfile): Shown {
  const v = p.vision.polarity.value;
  if (v === 'dark') return { value: 'Dark', sr: 'dark pages' };
  if (v === 'light') return { value: 'Light', sr: 'light pages' };
  return { value: 'Site colors', sr: 'site colors' };
}

function spacingShown(p: FitProfile): Shown {
  const v = p.vision.lineHeight.value;
  return { value: formatNumber(v), sr: `line spacing ${formatNumber(v)}` };
}

function lengthShown(p: FitProfile): Shown {
  const v = p.vision.maxLineCh.value;
  return { value: `${v}${NBSP}characters`, sr: `${v} characters` };
}

function targetShown(p: FitProfile): Shown {
  const v = p.motor.minTargetPx.value;
  return { value: px(v), sr: `${v} pixels` };
}

function steadyShown(p: FitProfile): Shown {
  return p.motor.steadyClicks.value.on
    ? { value: 'On', sr: 'on' }
    : { value: 'Off', sr: 'off' };
}

function hoverShown(p: FitProfile): Shown {
  const v = p.motor.hoverGraceMs.value;
  return { value: ms(v), sr: `${v} milliseconds` };
}

function motionPaused(p: FitProfile): boolean {
  return needLevels(p).motion > 0;
}

function motionShown(p: FitProfile): Shown {
  return motionPaused(p)
    ? { value: 'Paused', sr: 'paused' }
    : { value: 'Plays', sr: 'plays' };
}

type BusyMode = 'simplified' | 'ask' | 'unchanged';

function busyMode(p: FitProfile): BusyMode {
  const distraction = needLevels(p).distraction;
  if (distraction === 2 || benefitProbability(p.attention.density) >= 0.6)
    return 'simplified';
  if (distraction === 1) return 'ask';
  return 'unchanged';
}

function busyShown(p: FitProfile): Shown {
  const mode = busyMode(p);
  if (mode === 'simplified') return { value: 'Simplified', sr: 'simplified' };
  if (mode === 'ask') return { value: 'Ask first', sr: 'ask first' };
  return { value: 'Unchanged', sr: 'unchanged' };
}

/* ------------------------------------------------------------------------ */
/* Sentences                                                                  */
/* ------------------------------------------------------------------------ */

function textSentence(p: FitProfile, browserPx: number): string {
  const t = p.vision.textMinPx;
  const v = px(t.value);
  if (t.source === 'default') return 'Text stays the size each site made it.';
  if (t.source === 'override' || t.source === 'stated')
    return `You set text to ${v} or larger.`;
  if (t.value <= browserPx)
    return `Text reads well for you at ${v} or larger, so most pages already fit.`;
  return `Text reads best for you at ${v} or larger.`;
}

function contrastSentence(p: FitProfile): string {
  const v = p.vision.contrastFloor.value;
  if (v === 21) return 'Text uses the strongest contrast the page allows.';
  if (v === 7)
    return `Faint text is darkened to at least 7:1 against its background.`;
  return 'Most text already has enough contrast for you.';
}

function polaritySentence(p: FitProfile): string {
  const pol = p.vision.polarity;
  if (pol.value === 'none') return 'Pages keep their own colors.';
  const pair =
    pol.value === 'dark'
      ? 'Light text on a dark background'
      : 'Dark text on a light background';
  if (pol.source === 'override' || pol.source === 'stated')
    return `You chose ${pair.toLowerCase()}.`;
  if (pol.source === 'measured' && pol.confidence >= 0.6)
    return `${pair} reads faster for you.`;
  return `${pair} may be easier for you.`;
}

function spacingSentence(p: FitProfile): string {
  const lh = p.vision.lineHeight.value;
  const words = p.vision.wordSpacingEm.value > 0;
  if (needLevels(p).spacing === 0 && !words)
    return 'Line spacing stays as each site made it.';
  const what = words
    ? 'Lines and words of running text'
    : 'Lines of running text';
  return `${what} get more room, at ${formatNumber(lh)} line spacing.`;
}

function lengthSentence(p: FitProfile): string {
  if (needLevels(p).lineLength === 0)
    return 'Line length stays as each site made it.';
  return `Long lines of text wrap at about ${p.vision.maxLineCh.value}${NBSP}characters.`;
}

function targetSentence(p: FitProfile): string {
  const v = px(p.motor.minTargetPx.value);
  if (needLevels(p).targets === 0)
    return 'Click areas stay as each site made them.';
  if (
    p.motor.minTargetPx.source === 'override' ||
    p.motor.minTargetPx.source === 'stated'
  ) {
    return `You chose click areas of at least ${v}.`;
  }
  return `Click areas of at least ${v} will likely make browsing easier on this device.`;
}

function steadySentence(p: FitProfile): string {
  return p.motor.steadyClicks.value.on
    ? 'A click still counts if the pointer slips a little while you press.'
    : 'Clicks work as each site made them.';
}

function hoverSentence(p: FitProfile): string {
  const v = p.motor.hoverGraceMs.value;
  return v > 0
    ? `Menus that open on hover stay open ${ms(v)} after the pointer drifts off.`
    : 'Menus that open on hover close as each site made them.';
}

function motionSentence(p: FitProfile): string {
  if (!motionPaused(p)) return 'Moving things play as each site made them.';
  if (p.attention.systemReducedMotion)
    return 'Your device asks for less motion, so carousels and autoplay are paused.';
  return 'Carousels, tickers and autoplay are paused.';
}

function busySentence(p: FitProfile): string {
  const mode = busyMode(p);
  if (mode === 'simplified')
    return 'Ads and side panels are toned down so the main content stands out.';
  if (mode === 'ask')
    return 'On busy pages, WebAble asks before toning down side content.';
  return 'Busy pages keep everything the site put there.';
}

/* ------------------------------------------------------------------------ */
/* Rows                                                                       */
/* ------------------------------------------------------------------------ */

interface RowSpec {
  id: FitRowId;
  label: string;
  shown: (p: FitProfile) => Shown;
  /** Browser-default display when there is no previous fit. */
  browser: (browserPx: number) => Shown;
  unit: string | null;
  sentence: (p: FitProfile) => string;
  source: (p: FitProfile) => SourceKind;
  confidence: (p: FitProfile) => ConfidenceLabel;
  changes: (p: FitProfile) => boolean;
}

function rowSpecs(browserPx: number): RowSpec[] {
  return [
    {
      id: 'textSize',
      label: 'Text size',
      shown: (p) => textShown(p, browserPx),
      browser: (b) => ({ value: px(b), sr: `${formatNumber(b)} pixels` }),
      unit: 'pixels',
      sentence: (p) => textSentence(p, browserPx),
      source: (p) => p.vision.textMinPx.source,
      confidence: (p) => paramConfidence(p.vision.textMinPx.confidence),
      changes: (p) => needLevels(p).text > 0,
    },
    {
      id: 'contrast',
      label: 'Contrast',
      shown: contrastShown,
      browser: () => ({ value: '4.5:1', sr: '4.5 to 1' }),
      unit: null,
      sentence: contrastSentence,
      source: (p) => p.vision.contrastFloor.source,
      confidence: (p) => paramConfidence(p.vision.contrastFloor.confidence),
      changes: (p) => needLevels(p).contrast > 0,
    },
    {
      id: 'polarity',
      label: 'Light or dark',
      shown: polarityShown,
      browser: () => ({ value: 'Site colors', sr: 'site colors' }),
      unit: null,
      sentence: polaritySentence,
      source: (p) => p.vision.polarity.source,
      confidence: (p) => paramConfidence(p.vision.polarity.confidence),
      changes: (p) => p.vision.polarity.value !== 'none',
    },
    {
      id: 'lineSpacing',
      label: 'Line spacing',
      shown: spacingShown,
      browser: () => ({ value: '1.5', sr: 'line spacing 1.5' }),
      unit: null,
      sentence: spacingSentence,
      source: (p) => p.vision.lineHeight.source,
      confidence: (p) => paramConfidence(p.vision.lineHeight.confidence),
      changes: (p) => needLevels(p).spacing > 0,
    },
    {
      id: 'lineLength',
      label: 'Line length',
      shown: lengthShown,
      browser: () => ({ value: `80${NBSP}characters`, sr: '80 characters' }),
      unit: 'characters',
      sentence: lengthSentence,
      source: (p) => p.vision.maxLineCh.source,
      confidence: (p) => paramConfidence(p.vision.maxLineCh.confidence),
      changes: (p) => needLevels(p).lineLength > 0,
    },
    {
      id: 'targets',
      label: 'Click targets',
      shown: targetShown,
      browser: () => ({ value: px(24), sr: '24 pixels' }),
      unit: 'pixels',
      sentence: targetSentence,
      source: (p) => p.motor.minTargetPx.source,
      confidence: (p) => paramConfidence(p.motor.minTargetPx.confidence),
      changes: (p) => needLevels(p).targets > 0,
    },
    {
      id: 'steadyClicks',
      label: 'Steady clicks',
      shown: steadyShown,
      browser: () => ({ value: 'Off', sr: 'off' }),
      unit: null,
      sentence: steadySentence,
      source: (p) => p.motor.steadyClicks.source,
      confidence: (p) => paramConfidence(p.motor.steadyClicks.confidence),
      changes: (p) => p.motor.steadyClicks.value.on,
    },
    {
      id: 'hoverGrace',
      label: 'Menus stay open',
      shown: hoverShown,
      browser: () => ({ value: ms(0), sr: '0 milliseconds' }),
      unit: 'milliseconds',
      sentence: hoverSentence,
      source: (p) => p.motor.hoverGraceMs.source,
      confidence: (p) => paramConfidence(p.motor.hoverGraceMs.confidence),
      changes: (p) => p.motor.hoverGraceMs.value > 0,
    },
    {
      id: 'motion',
      label: 'Moving things',
      shown: motionShown,
      browser: () => ({ value: 'Plays', sr: 'plays' }),
      unit: null,
      sentence: motionSentence,
      source: (p) => latentSource(p.attention.motion),
      confidence: (p) => latentConfidence(p.attention.motion.confidence),
      changes: motionPaused,
    },
    {
      id: 'busyPages',
      label: 'Busy pages',
      shown: busyShown,
      browser: () => ({ value: 'Unchanged', sr: 'unchanged' }),
      unit: null,
      sentence: busySentence,
      source: (p) => {
        const d = latentSource(p.attention.distraction);
        return d === 'default' ? latentSource(p.attention.density) : d;
      },
      confidence: (p) =>
        latentConfidence(
          Math.max(
            p.attention.distraction.confidence,
            p.attention.density.confidence,
          ),
        ),
      changes: (p) => busyMode(p) === 'simplified',
    },
  ];
}

/** Which Tune module measures each row (for dating values carried over on recalibration). */
const ROW_MODULE: Record<FitRowId, keyof FitProfile['modules']> = {
  textSize: 'reading',
  contrast: 'reading',
  polarity: 'reading',
  lineSpacing: 'reading',
  lineLength: 'reading',
  targets: 'pointing',
  steadyClicks: 'pointing',
  hoverGrace: 'pointing',
  motion: 'focus',
  busyPages: 'focus',
};

/**
 * Rows for the "Your fit" screen, in display order. Without `previous`, the
 * "before" value is what the browser or site does on its own; with it, the
 * rows show the recalibration diff (design-final.md 9.5).
 */
export function fitRows(
  profile: FitProfile,
  previous?: FitProfile,
  options: FitRowOptions = {},
): FitRow[] {
  const browserPx =
    options.browserDefaultPx !== undefined && options.browserDefaultPx > 0
      ? options.browserDefaultPx
      : 16;
  return rowSpecs(browserPx).map((spec) => {
    const after = spec.shown(profile);
    const before = previous ? spec.shown(previous) : spec.browser(browserPx);
    const { srText, changed } = fitMark(before, after, spec.unit);
    const kind = spec.source(profile);
    // A module skipped during recalibration keeps the earlier measurement and its date.
    const measuredIn =
      previous && profile.modules[ROW_MODULE[spec.id]] !== 'measured'
        ? previous
        : profile;
    return {
      id: spec.id,
      label: spec.label,
      before: before.value,
      after: after.value,
      srText,
      changed,
      sentence: spec.sentence(profile),
      source: sourceLabel(kind, measuredIn, options.now),
      sourceKind: kind,
      confidence: spec.confidence(profile),
      changesPages: spec.changes(profile),
    };
  });
}

/* ------------------------------------------------------------------------ */
/* WebAble's own UI                                                           */
/* ------------------------------------------------------------------------ */

export interface FitUiVars {
  /** Inline custom properties for the document root (tokens.css profile hooks). */
  style: {
    '--wa-text-scale': string;
    '--wa-target-min': string;
    '--wa-leading-add': string;
    '--wa-space-scale': string;
  };
  /** Root attributes; `data-wa-motion="reduce"` stills WebAble's own transitions. */
  attributes: { 'data-wa-motion'?: 'reduce' };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function trim(n: number, digits: number): string {
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}

/**
 * CSS custom property values for WebAble's own UI:
 * - `--wa-text-scale` = textMinPx / 16, clamped 1..2 (never shrinks the UI);
 * - `--wa-target-min` = the profile's minimum target, never below 44 px;
 * - `--wa-leading-add` = line height above 1.5, clamped 0..0.7;
 * - `--wa-space-scale` = 1..1.5 from line spacing and the extra room between
 *   controls that slips call for;
 * - `data-wa-motion="reduce"` when the system asks for less motion or the fit
 *   shows a clear benefit from stillness.
 */
export function fitUiVars(profile: FitProfile): FitUiVars {
  const { vision, motor, attention } = profile;
  const textScale = clamp(vision.textMinPx.value / 16, 1, 2);
  const target = Math.max(44, motor.minTargetPx.value);
  const leading = clamp(vision.lineHeight.value - 1.5, 0, 0.7);
  const visionSpace = 1 + (5 / 6) * leading;
  const extraRoom = motor.targetSpacingPx.value - motor.minTargetPx.value;
  const motorSpace = 1 + clamp((extraRoom - 8) / 32, 0, 0.5);
  const space = clamp(Math.max(visionSpace, motorSpace), 1, 1.5);
  const reduce =
    attention.systemReducedMotion ||
    benefitProbability(attention.motion) >= 0.6;
  return {
    style: {
      '--wa-text-scale': trim(textScale, 3),
      '--wa-target-min': `${target}px`,
      '--wa-leading-add': trim(leading, 2),
      '--wa-space-scale': trim(space, 2),
    },
    attributes: reduce ? { 'data-wa-motion': 'reduce' } : {},
  };
}
