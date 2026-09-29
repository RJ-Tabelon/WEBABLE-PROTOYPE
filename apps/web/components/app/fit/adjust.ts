import {
  benefitProbability,
  type FitProfile,
  type LatentDim,
  needLevels,
  TARGET_LADDER,
} from '@webable/core';
import type { FitRowId } from '@webable/core/profile/describe';
import { z } from 'zod';

/**
 * Per-row adjustments on "Your fit" (design-final.md 9.4). An adjustment never
 * erases evidence: it writes the person's value into `override` and makes it
 * the effective value, keeping `measured` and `stated`, so "Back to measured"
 * can restore the measurement exactly. Latent attention rows record the choice
 * as an `override` source on the dimension. Pure: the server action applies
 * these to the latest saved fit and saves a new version (source 'adjustment').
 */

const NBSP = '\u00a0';

/* ------------------------------------------------------------------------ */
/* Choices shown in the editor                                               */
/* ------------------------------------------------------------------------ */

/** Reviewed ladders. The current value is always added, so it stays selectable. */
export const TEXT_STEPS = [16, 18, 21, 24, 28, 32, 40, 48] as const;
export const LINE_SPACING_STEPS = [1.5, 1.6, 1.8, 2] as const;
export const LINE_LENGTH_STEPS = [62, 70, 80] as const;
export const HOVER_STEPS = [0, 400, 700] as const;
export const CONTRAST_VALUES = [4.5, 7, 21] as const;

export type MotionChoice = 'plays' | 'paused';
export type BusyChoice = 'unchanged' | 'ask' | 'simplified';
export type Polarity = FitProfile['vision']['polarity']['value'];

/** Rows whose value is a profile parameter (they keep a `measured` value). */
export const PARAM_ROWS = [
  'textSize',
  'contrast',
  'polarity',
  'lineSpacing',
  'lineLength',
  'targets',
  'steadyClicks',
  'hoverGrace',
] as const satisfies readonly FitRowId[];
export type ParamRowId = (typeof PARAM_ROWS)[number];

export function isParamRow(row: FitRowId): row is ParamRowId {
  return (PARAM_ROWS as readonly string[]).includes(row);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const trimNumber = (n: number) => String(round2(n));

/** Ladder plus the current value, ascending and unique. */
export function stepsWith(
  ladder: readonly number[],
  current: number,
): number[] {
  return [...new Set([...ladder, round2(current)])].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------------ */
/* Input                                                                      */
/* ------------------------------------------------------------------------ */

const literalUnion = <T extends number>(values: readonly T[]) =>
  z.union(
    values.map((v) => z.literal(v)) as unknown as [
      z.ZodLiteral<T>,
      ...z.ZodLiteral<T>[],
    ],
  );

/** A value for one row, bounded exactly as the profile schema bounds it. */
export const adjustValueSchema = z.discriminatedUnion('row', [
  z.strictObject({
    row: z.literal('textSize'),
    value: z.number().min(12).max(96),
  }),
  z.strictObject({
    row: z.literal('contrast'),
    value: literalUnion(CONTRAST_VALUES),
  }),
  z.strictObject({
    row: z.literal('polarity'),
    value: z.enum(['none', 'light', 'dark']),
  }),
  z.strictObject({
    row: z.literal('lineSpacing'),
    value: z.number().min(1.2).max(2.2),
  }),
  z.strictObject({
    row: z.literal('lineLength'),
    value: z.int().min(45).max(100),
  }),
  z.strictObject({
    row: z.literal('targets'),
    value: literalUnion(TARGET_LADDER),
  }),
  z.strictObject({ row: z.literal('steadyClicks'), value: z.boolean() }),
  z.strictObject({
    row: z.literal('hoverGrace'),
    value: literalUnion(HOVER_STEPS),
  }),
  z.strictObject({
    row: z.literal('motion'),
    value: z.enum(['plays', 'paused']),
  }),
  z.strictObject({
    row: z.literal('busyPages'),
    value: z.enum(['unchanged', 'ask', 'simplified']),
  }),
]);
export type AdjustValue = z.infer<typeof adjustValueSchema>;

const FIT_ROW_IDS = [
  'textSize',
  'contrast',
  'polarity',
  'lineSpacing',
  'lineLength',
  'targets',
  'steadyClicks',
  'hoverGrace',
  'motion',
  'busyPages',
] as const satisfies readonly FitRowId[];

export const adjustInputSchema = z.discriminatedUnion('kind', [
  /** Set a value chosen by the person. */
  z.strictObject({ kind: z.literal('set'), change: adjustValueSchema }),
  /** Drop the person's value and use the measured one again. */
  z.strictObject({ kind: z.literal('measured'), row: z.enum(PARAM_ROWS) }),
  /** Undo: copy one row back from an earlier saved version. */
  z.strictObject({
    kind: z.literal('restore'),
    row: z.enum(FIT_ROW_IDS),
    fromVersion: z.int().min(1),
  }),
]);
export type AdjustInput = z.infer<typeof adjustInputSchema>;

/* ------------------------------------------------------------------------ */
/* Applying                                                                   */
/* ------------------------------------------------------------------------ */

/** Plain deep copy; profiles are JSON (validated by fitProfileSchema). */
function clone(profile: FitProfile): FitProfile {
  return structuredClone(profile);
}

interface Param<T> {
  value: T;
  source: FitProfile['vision']['textMinPx']['source'];
  confidence: number;
  measured?: T;
  stated?: T;
  override?: T;
}

/** The person's value wins; evidence and confidence stay as they were. */
function overrideParam<T>(param: Param<T>, value: T): Param<T> {
  return { ...param, value, source: 'override', override: value };
}

function toMeasured<T>(param: Param<T>): Param<T> {
  if (param.measured === undefined) return param;
  const { override: _dropped, ...rest } = param;
  return { ...rest, value: param.measured, source: 'measured' };
}

/** Mark a latent dimension as set by the person, with a decisive mean. */
function overrideLatent(dim: LatentDim, mean: number, sd: number): LatentDim {
  const kept = dim.sources.filter((s) => s !== 'override');
  return {
    mean,
    sd,
    confidence: 1,
    sources: [...kept, 'override' as const].slice(-6),
  };
}

/* Latent targets, checked against needLevels() in tests:
 *   decisive on  -> benefit ~1.00 (level 2)
 *   decisive off -> benefit ~0.00 (level 0)
 *   middle       -> benefit ~0.66 (distraction level 1: ask first)
 *   neutral      -> benefit 0.50 (below the density threshold of 0.6)   */
const ON = { mean: 1, sd: 0.15 };
const OFF = { mean: -0.5, sd: 0.15 };
const MIDDLE = { mean: 0.13, sd: 0.2 };
const NEUTRAL = { mean: 0.05, sd: 0.2 };

function setMotion(p: FitProfile, choice: MotionChoice): void {
  const target = choice === 'paused' ? ON : OFF;
  p.attention.motion = overrideLatent(
    p.attention.motion,
    target.mean,
    target.sd,
  );
}

function setBusy(p: FitProfile, choice: BusyChoice): void {
  const target = choice === 'simplified' ? ON : choice === 'ask' ? MIDDLE : OFF;
  p.attention.distraction = overrideLatent(
    p.attention.distraction,
    target.mean,
    target.sd,
  );
  // Dense layouts alone also simplify pages; step that down when the person says less.
  if (
    choice !== 'simplified' &&
    benefitProbability(p.attention.density) >= 0.6
  ) {
    p.attention.density = overrideLatent(
      p.attention.density,
      NEUTRAL.mean,
      NEUTRAL.sd,
    );
  }
}

/** Apply a chosen value to a copy of the profile. */
export function applyValue(
  profile: FitProfile,
  change: AdjustValue,
): FitProfile {
  const p = clone(profile);
  const { vision, motor } = p;
  switch (change.row) {
    case 'textSize':
      vision.textMinPx = overrideParam(vision.textMinPx, round2(change.value));
      break;
    case 'contrast':
      vision.contrastFloor = overrideParam(vision.contrastFloor, change.value);
      break;
    case 'polarity':
      vision.polarity = overrideParam(vision.polarity, change.value);
      break;
    case 'lineSpacing':
      vision.lineHeight = overrideParam(
        vision.lineHeight,
        round2(change.value),
      );
      break;
    case 'lineLength':
      vision.maxLineCh = overrideParam(vision.maxLineCh, change.value);
      break;
    case 'targets':
      motor.minTargetPx = overrideParam(motor.minTargetPx, change.value);
      break;
    case 'steadyClicks':
      motor.steadyClicks = overrideParam(motor.steadyClicks, {
        ...motor.steadyClicks.value,
        on: change.value,
      });
      break;
    case 'hoverGrace':
      motor.hoverGraceMs = overrideParam(motor.hoverGraceMs, change.value);
      break;
    case 'motion':
      setMotion(p, change.value);
      break;
    case 'busyPages':
      setBusy(p, change.value);
      break;
  }
  return p;
}

/** Return a copy with the measured value in effect again for one parameter row. */
export function applyMeasured(
  profile: FitProfile,
  row: ParamRowId,
): FitProfile {
  const p = clone(profile);
  const { vision, motor } = p;
  switch (row) {
    case 'textSize':
      vision.textMinPx = toMeasured(vision.textMinPx);
      break;
    case 'contrast':
      vision.contrastFloor = toMeasured(vision.contrastFloor);
      break;
    case 'polarity':
      vision.polarity = toMeasured(vision.polarity);
      break;
    case 'lineSpacing':
      vision.lineHeight = toMeasured(vision.lineHeight);
      break;
    case 'lineLength':
      vision.maxLineCh = toMeasured(vision.maxLineCh);
      break;
    case 'targets':
      motor.minTargetPx = toMeasured(motor.minTargetPx);
      break;
    case 'steadyClicks':
      motor.steadyClicks = toMeasured(motor.steadyClicks);
      break;
    case 'hoverGrace':
      motor.hoverGraceMs = toMeasured(motor.hoverGraceMs);
      break;
  }
  return p;
}

/** Copy one row's underlying fields from another version (used by Undo). */
export function copyRow(
  profile: FitProfile,
  from: FitProfile,
  row: FitRowId,
): FitProfile {
  const p = clone(profile);
  const f = clone(from);
  switch (row) {
    case 'textSize':
      p.vision.textMinPx = f.vision.textMinPx;
      break;
    case 'contrast':
      p.vision.contrastFloor = f.vision.contrastFloor;
      break;
    case 'polarity':
      p.vision.polarity = f.vision.polarity;
      break;
    case 'lineSpacing':
      p.vision.lineHeight = f.vision.lineHeight;
      p.vision.wordSpacingEm = f.vision.wordSpacingEm;
      break;
    case 'lineLength':
      p.vision.maxLineCh = f.vision.maxLineCh;
      break;
    case 'targets':
      p.motor.minTargetPx = f.motor.minTargetPx;
      break;
    case 'steadyClicks':
      p.motor.steadyClicks = f.motor.steadyClicks;
      break;
    case 'hoverGrace':
      p.motor.hoverGraceMs = f.motor.hoverGraceMs;
      break;
    case 'motion':
      p.attention.motion = f.attention.motion;
      break;
    case 'busyPages':
      p.attention.distraction = f.attention.distraction;
      p.attention.density = f.attention.density;
      break;
  }
  return p;
}

export function applyAdjustment(
  profile: FitProfile,
  input: Exclude<AdjustInput, { kind: 'restore' }>,
): FitProfile {
  return input.kind === 'set'
    ? applyValue(profile, input.change)
    : applyMeasured(profile, input.row);
}

/* ------------------------------------------------------------------------ */
/* Reading the current choice, and editor descriptions                       */
/* ------------------------------------------------------------------------ */

export function motionChoice(p: FitProfile): MotionChoice {
  return needLevels(p).motion > 0 ? 'paused' : 'plays';
}

/** Mirrors describe.ts busyMode(). */
export function busyChoice(p: FitProfile): BusyChoice {
  const distraction = needLevels(p).distraction;
  if (distraction === 2 || benefitProbability(p.attention.density) >= 0.6)
    return 'simplified';
  if (distraction === 1) return 'ask';
  return 'unchanged';
}

/** The value the editor starts from, for each row. */
export function currentValue(p: FitProfile, row: FitRowId): AdjustValue {
  switch (row) {
    case 'textSize':
      return { row, value: p.vision.textMinPx.value };
    case 'contrast':
      return { row, value: p.vision.contrastFloor.value };
    case 'polarity':
      return { row, value: p.vision.polarity.value };
    case 'lineSpacing':
      return { row, value: p.vision.lineHeight.value };
    case 'lineLength':
      return { row, value: p.vision.maxLineCh.value };
    case 'targets':
      return { row, value: p.motor.minTargetPx.value };
    case 'steadyClicks':
      return { row, value: p.motor.steadyClicks.value.on };
    case 'hoverGrace':
      return { row, value: p.motor.hoverGraceMs.value };
    case 'motion':
      return { row, value: motionChoice(p) };
    case 'busyPages':
      return { row, value: busyChoice(p) };
  }
}

/** The measured value in words, when the person's value replaced it. Null otherwise. */
export function measuredAlternative(
  p: FitProfile,
  row: FitRowId,
): string | null {
  if (!isParamRow(row)) return null;
  const param = paramOf(p, row);
  if (param.source !== 'override' || param.measured === undefined) return null;
  if (JSON.stringify(param.measured) === JSON.stringify(param.value))
    return null;
  return describeValue(row, param.measured);
}

function paramOf(p: FitProfile, row: ParamRowId): Param<unknown> {
  switch (row) {
    case 'textSize':
      return p.vision.textMinPx;
    case 'contrast':
      return p.vision.contrastFloor;
    case 'polarity':
      return p.vision.polarity;
    case 'lineSpacing':
      return p.vision.lineHeight;
    case 'lineLength':
      return p.vision.maxLineCh;
    case 'targets':
      return p.motor.minTargetPx;
    case 'steadyClicks':
      return p.motor.steadyClicks;
    case 'hoverGrace':
      return p.motor.hoverGraceMs;
  }
}

/** A value in words with its unit ("21 px", "7:1", "On"). */
export function describeValue(row: FitRowId, value: unknown): string {
  switch (row) {
    case 'textSize':
    case 'targets':
      return `${trimNumber(Number(value))}${NBSP}px`;
    case 'contrast':
      return Number(value) >= 21 ? 'Maximum' : `${trimNumber(Number(value))}:1`;
    case 'polarity':
      return value === 'dark'
        ? 'Dark'
        : value === 'light'
          ? 'Light'
          : 'Site colors';
    case 'lineSpacing':
      return trimNumber(Number(value));
    case 'lineLength':
      return `${trimNumber(Number(value))}${NBSP}characters`;
    case 'steadyClicks': {
      const on =
        typeof value === 'object' && value !== null
          ? (value as { on?: unknown }).on === true
          : value === true;
      return on ? 'On' : 'Off';
    }
    case 'hoverGrace':
      return `${trimNumber(Number(value))}${NBSP}ms`;
    case 'motion':
      return value === 'paused' ? 'Paused' : 'Plays';
    case 'busyPages':
      return value === 'simplified'
        ? 'Simplified'
        : value === 'ask'
          ? 'Ask first'
          : 'Unchanged';
  }
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** Why the option can't be chosen right now, if it can't. */
  disabledReason?: string;
}

export type EditorSpec =
  | {
      control: 'slider';
      steps: number[];
      format: (v: number) => string;
      spoken: (v: number) => string;
    }
  | { control: 'choice'; options: ChoiceOption<string>[] };

/** How each row is edited. Sliders for ladders of numbers, choices for words. */
export function editorFor(p: FitProfile, row: FitRowId): EditorSpec {
  const px = (v: number) => `${trimNumber(v)}${NBSP}px`;
  const pxSpoken = (v: number) => `${trimNumber(v)} pixels`;
  switch (row) {
    case 'textSize':
      return {
        control: 'slider',
        steps: stepsWith(TEXT_STEPS, p.vision.textMinPx.value),
        format: px,
        spoken: pxSpoken,
      };
    case 'targets':
      return {
        control: 'slider',
        steps: [...TARGET_LADDER],
        format: px,
        spoken: pxSpoken,
      };
    case 'lineSpacing':
      return {
        control: 'slider',
        steps: stepsWith(LINE_SPACING_STEPS, p.vision.lineHeight.value),
        format: trimNumber,
        spoken: (v) => `line spacing ${trimNumber(v)}`,
      };
    case 'lineLength':
      return {
        control: 'slider',
        steps: stepsWith(LINE_LENGTH_STEPS, p.vision.maxLineCh.value),
        format: (v) => `${v}${NBSP}characters`,
        spoken: (v) => `${v} characters`,
      };
    case 'hoverGrace':
      return {
        control: 'slider',
        steps: [...HOVER_STEPS],
        format: (v) => `${v}${NBSP}ms`,
        spoken: (v) => `${v} milliseconds`,
      };
    case 'contrast':
      return {
        control: 'choice',
        options: [
          { value: '4.5', label: 'Standard' },
          { value: '7', label: 'Strong' },
          { value: '21', label: 'Maximum' },
        ],
      };
    case 'polarity':
      return {
        control: 'choice',
        options: [
          { value: 'none', label: 'Site colors' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
      };
    case 'steadyClicks':
      return {
        control: 'choice',
        options: [
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
        ],
      };
    case 'motion':
      return {
        control: 'choice',
        options: [
          {
            value: 'plays',
            label: 'Plays',
            ...(p.attention.systemReducedMotion
              ? {
                  disabledReason:
                    'Your device asks for less motion. Change that in your system settings.',
                }
              : {}),
          },
          { value: 'paused', label: 'Paused' },
        ],
      };
    case 'busyPages':
      return {
        control: 'choice',
        options: [
          { value: 'unchanged', label: 'Unchanged' },
          { value: 'ask', label: 'Ask first' },
          { value: 'simplified', label: 'Simplified' },
        ],
      };
  }
}

/** Editor choice value (a string in the control) to a typed row value. */
export function valueFromChoice(
  row: FitRowId,
  choice: string,
): AdjustValue | null {
  const parsed = adjustValueSchema.safeParse(
    row === 'contrast'
      ? { row, value: Number(choice) }
      : row === 'steadyClicks'
        ? { row, value: choice === 'on' }
        : { row, value: choice },
  );
  return parsed.success ? parsed.data : null;
}

/** Typed row value to the editor's string value. */
export function choiceFromValue(value: AdjustValue): string {
  switch (value.row) {
    case 'contrast':
      return String(value.value);
    case 'steadyClicks':
      return value.value ? 'on' : 'off';
    default:
      return String(value.value);
  }
}

/** A slider value for a row, bounded by the schema. */
export function valueFromSlider(row: FitRowId, n: number): AdjustValue | null {
  const parsed = adjustValueSchema.safeParse({ row, value: n });
  return parsed.success ? parsed.data : null;
}

export function sameValue(a: AdjustValue, b: AdjustValue): boolean {
  return a.row === b.row && a.value === b.value;
}
