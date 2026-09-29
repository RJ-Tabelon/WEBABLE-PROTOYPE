import {
  benefitProbability,
  fitProfileSchema,
  TARGET_LADDER,
  type ContrastFloor,
  type FitProfile,
  type LatentDim,
  type Polarity,
  type TargetPx,
} from '@webable/core';
import type { FitRowId } from '@webable/core/profile/describe';

/**
 * "Adjust" on Your fit (design-final §9.4) and "Keep new | Keep old" on
 * recalibration (§9.5). An adjustment is an explicit choice: it becomes the
 * row's value with source `override`, and the measured evidence stays beside it
 * (profile/schema.ts). Every function here is pure and returns a validated profile.
 */

export const OVERRIDE_CONFIDENCE = 0.9;

export interface ChoiceOption {
  value: string;
  label: string;
}

export type AdjustSpec =
  | {
      kind: 'stepper';
      /** Accessible name of the value ("Text size"). */
      label: string;
      values: readonly number[];
      current: number;
      unit: 'px';
    }
  | {
      kind: 'choice';
      label: string;
      options: readonly ChoiceOption[];
      current: string;
    }
  | { kind: 'note'; text: string };

/** Text sizes offered by the stepper (CSS px, 0.1 log apart near the middle). */
export const TEXT_STEPS: readonly number[] = [
  14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 32, 36, 40, 48, 56, 64, 72, 96,
];

const CONTRAST_OPTIONS: readonly ChoiceOption[] = [
  { value: '4.5', label: '4.5:1' },
  { value: '7', label: '7:1' },
  { value: '21', label: 'Maximum' },
];
const POLARITY_OPTIONS: readonly ChoiceOption[] = [
  { value: 'none', label: 'Site colors' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const SPACING_OPTIONS: readonly ChoiceOption[] = [
  { value: '1.5', label: '1.5' },
  { value: '1.6', label: '1.6' },
  { value: '1.8', label: '1.8' },
  { value: '2', label: '2' },
];
const LENGTH_OPTIONS: readonly ChoiceOption[] = [
  { value: '60', label: '60' },
  { value: '70', label: '70' },
  { value: '80', label: '80' },
];
const ON_OFF: readonly ChoiceOption[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
];
const HOVER_OPTIONS: readonly ChoiceOption[] = [
  { value: '0', label: '0 ms' },
  { value: '400', label: '400 ms' },
  { value: '700', label: '700 ms' },
];
const MOTION_OPTIONS: readonly ChoiceOption[] = [
  { value: 'plays', label: 'Plays' },
  { value: 'paused', label: 'Paused' },
];
const BUSY_OPTIONS: readonly ChoiceOption[] = [
  { value: 'unchanged', label: 'Unchanged' },
  { value: 'ask', label: 'Ask first' },
  { value: 'simplified', label: 'Simplified' },
];

function nearest(values: readonly number[], target: number): number {
  let best = values[0] ?? target;
  for (const v of values) {
    if (Math.abs(v - target) < Math.abs(best - target)) best = v;
  }
  return best;
}

function nearestOption(
  options: readonly ChoiceOption[],
  value: number,
): string {
  return String(
    nearest(
      options.map((o) => Number(o.value)),
      value,
    ),
  );
}

const benefit = benefitProbability;

function busyCurrent(p: FitProfile): string {
  const d = benefit(p.attention.distraction);
  if (d >= 0.8 || benefit(p.attention.density) >= 0.6) return 'simplified';
  if (d >= 0.5) return 'ask';
  return 'unchanged';
}

function motionCurrent(p: FitProfile): string {
  return p.attention.systemReducedMotion || benefit(p.attention.motion) >= 0.35
    ? 'paused'
    : 'plays';
}

export function adjustSpec(
  profile: FitProfile,
  row: FitRowId,
  browserPx = 16,
): AdjustSpec {
  const { vision, motor } = profile;
  switch (row) {
    case 'textSize':
      return {
        kind: 'stepper',
        label: 'Text size',
        values: TEXT_STEPS,
        current: nearest(
          TEXT_STEPS,
          Math.max(vision.textMinPx.value, browserPx),
        ),
        unit: 'px',
      };
    case 'contrast':
      return {
        kind: 'choice',
        label: 'Contrast',
        options: CONTRAST_OPTIONS,
        current: String(vision.contrastFloor.value),
      };
    case 'polarity':
      return {
        kind: 'choice',
        label: 'Light or dark',
        options: POLARITY_OPTIONS,
        current: vision.polarity.value,
      };
    case 'lineSpacing':
      return {
        kind: 'choice',
        label: 'Line spacing',
        options: SPACING_OPTIONS,
        current: nearestOption(SPACING_OPTIONS, vision.lineHeight.value),
      };
    case 'lineLength':
      return {
        kind: 'choice',
        label: 'Characters per line',
        options: LENGTH_OPTIONS,
        current: nearestOption(LENGTH_OPTIONS, vision.maxLineCh.value),
      };
    case 'targets':
      return {
        kind: 'stepper',
        label: 'Click targets',
        values: TARGET_LADDER,
        current: motor.minTargetPx.value,
        unit: 'px',
      };
    case 'steadyClicks':
      return {
        kind: 'choice',
        label: 'Steady clicks',
        options: ON_OFF,
        current: motor.steadyClicks.value.on ? 'on' : 'off',
      };
    case 'hoverGrace':
      return {
        kind: 'choice',
        label: 'Menus stay open',
        options: HOVER_OPTIONS,
        current: String(motor.hoverGraceMs.value),
      };
    case 'motion':
      if (profile.attention.systemReducedMotion) {
        return {
          kind: 'note',
          text: 'Your device asks for less motion, so moving things stay paused. Change it in your system settings.',
        };
      }
      return {
        kind: 'choice',
        label: 'Moving things',
        options: MOTION_OPTIONS,
        current: motionCurrent(profile),
      };
    case 'busyPages':
      return {
        kind: 'choice',
        label: 'Busy pages',
        options: BUSY_OPTIONS,
        current: busyCurrent(profile),
      };
  }
}

function overrideParam<T>(
  p: { value: T; source: string; confidence: number; measured?: T; stated?: T },
  value: T,
) {
  return {
    ...p,
    value,
    source: 'override' as const,
    override: value,
    confidence: OVERRIDE_CONFIDENCE,
  };
}

function overrideDim(mean: number): LatentDim {
  return {
    mean,
    sd: 0.1,
    confidence: OVERRIDE_CONFIDENCE,
    sources: ['override'],
  };
}

function asContrast(value: string): ContrastFloor | null {
  if (value === '4.5') return 4.5;
  if (value === '7') return 7;
  if (value === '21') return 21;
  return null;
}

function asPolarity(value: string): Polarity | null {
  return value === 'none' || value === 'light' || value === 'dark'
    ? value
    : null;
}

function asTarget(value: number): TargetPx | null {
  return (TARGET_LADDER as readonly number[]).includes(value)
    ? (value as TargetPx)
    : null;
}

/**
 * Set one row to a value the person chose. Unknown or out-of-range values
 * leave the profile unchanged. The result is validated against the schema.
 */
export function applyAdjustment(
  profile: FitProfile,
  row: FitRowId,
  raw: string | number,
): FitProfile {
  const value = String(raw);
  const n = Number(raw);
  const next: FitProfile = structuredClone(profile);
  const { vision, motor, attention } = next;
  switch (row) {
    case 'textSize': {
      if (!Number.isFinite(n) || n < 12 || n > 96) return profile;
      vision.textMinPx = overrideParam(vision.textMinPx, Math.round(n));
      const ratio =
        profile.vision.xHeightMinPx && profile.vision.textMinPx.value > 0
          ? profile.vision.xHeightMinPx / profile.vision.textMinPx.value
          : null;
      if (ratio !== null) {
        next.vision.xHeightMinPx =
          Math.round(Math.min(60, Math.max(4, n * ratio)) * 10) / 10;
      }
      break;
    }
    case 'contrast': {
      const floor = asContrast(value);
      if (floor === null) return profile;
      vision.contrastFloor = overrideParam(vision.contrastFloor, floor);
      break;
    }
    case 'polarity': {
      const polarity = asPolarity(value);
      if (polarity === null) return profile;
      vision.polarity = overrideParam(vision.polarity, polarity);
      break;
    }
    case 'lineSpacing': {
      if (!Number.isFinite(n) || n < 1.2 || n > 2.2) return profile;
      vision.lineHeight = overrideParam(vision.lineHeight, n);
      vision.wordSpacingEm = overrideParam(
        vision.wordSpacingEm,
        n >= 1.8 ? Math.max(vision.wordSpacingEm.value, 0.16) : 0,
      );
      break;
    }
    case 'lineLength': {
      if (!Number.isInteger(n) || n < 45 || n > 100) return profile;
      vision.maxLineCh = overrideParam(vision.maxLineCh, n);
      break;
    }
    case 'targets': {
      const target = asTarget(n);
      if (target === null) return profile;
      motor.minTargetPx = overrideParam(motor.minTargetPx, target);
      // Keep the extra room between targets that slips called for.
      const extra = Math.max(
        0,
        profile.motor.targetSpacingPx.value - profile.motor.minTargetPx.value,
      );
      motor.targetSpacingPx = overrideParam(
        motor.targetSpacingPx,
        Math.min(160, target + extra),
      );
      break;
    }
    case 'steadyClicks': {
      if (value !== 'on' && value !== 'off') return profile;
      motor.steadyClicks = overrideParam(motor.steadyClicks, {
        ...motor.steadyClicks.value,
        on: value === 'on',
      });
      break;
    }
    case 'hoverGrace': {
      if (n !== 0 && n !== 400 && n !== 700) return profile;
      motor.hoverGraceMs = overrideParam(motor.hoverGraceMs, n);
      break;
    }
    case 'motion': {
      if (value !== 'plays' && value !== 'paused') return profile;
      if (attention.systemReducedMotion) return profile;
      attention.motion = overrideDim(value === 'paused' ? 0.8 : -0.5);
      break;
    }
    case 'busyPages': {
      if (value === 'simplified') attention.distraction = overrideDim(0.8);
      else if (value === 'ask') attention.distraction = overrideDim(0.09);
      else if (value === 'unchanged') attention.distraction = overrideDim(-0.5);
      else return profile;
      // "Simplified" also follows from a strong density benefit; clear it when
      // the person asks for less.
      if (value !== 'simplified' && benefit(attention.density) >= 0.6) {
        attention.density = overrideDim(0);
      }
      break;
    }
  }
  return fitProfileSchema.parse(next);
}

/**
 * Recalibration: rows the person marked "Keep old" take the previous fit's
 * parameters back (with their evidence and sources); everything else stays new.
 */
export function keepOldRows(
  next: FitProfile,
  previous: FitProfile,
  rows: ReadonlySet<FitRowId>,
): FitProfile {
  if (rows.size === 0) return next;
  const out: FitProfile = structuredClone(next);
  const prev = structuredClone(previous);
  for (const row of rows) {
    switch (row) {
      case 'textSize':
        out.vision.textMinPx = prev.vision.textMinPx;
        if (prev.vision.xHeightMinPx !== undefined)
          out.vision.xHeightMinPx = prev.vision.xHeightMinPx;
        else delete out.vision.xHeightMinPx;
        break;
      case 'contrast':
        out.vision.contrastFloor = prev.vision.contrastFloor;
        out.vision.fontWeightFloor = prev.vision.fontWeightFloor;
        break;
      case 'polarity':
        out.vision.polarity = prev.vision.polarity;
        break;
      case 'lineSpacing':
        out.vision.lineHeight = prev.vision.lineHeight;
        out.vision.wordSpacingEm = prev.vision.wordSpacingEm;
        out.vision.letterSpacingEm = prev.vision.letterSpacingEm;
        break;
      case 'lineLength':
        out.vision.maxLineCh = prev.vision.maxLineCh;
        break;
      case 'targets':
        out.motor.minTargetPx = prev.motor.minTargetPx;
        out.motor.targetSpacingPx = prev.motor.targetSpacingPx;
        break;
      case 'steadyClicks':
        out.motor.steadyClicks = prev.motor.steadyClicks;
        break;
      case 'hoverGrace':
        out.motor.hoverGraceMs = prev.motor.hoverGraceMs;
        break;
      case 'motion':
        out.attention.motion = prev.attention.motion;
        break;
      case 'busyPages':
        out.attention.distraction = prev.attention.distraction;
        out.attention.density = prev.attention.density;
        break;
    }
  }
  return fitProfileSchema.parse(out);
}
