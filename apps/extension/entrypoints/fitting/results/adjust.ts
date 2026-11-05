// The "Adjust anything" rows: each control turns the current settings into the next FitProfile.
// People only ever see word levels (round 8c point 3); the numbers behind them stay in here.
// Kept in step with core's deriveFit(), so a value set here means the same thing to the engine as a measured one:
// a text size the person picks goes in text.override; faint text moves the contrast band with its floor, weight and
// line height; button size sets targets.minPx and the steady-click radius that follows from it.
import type { ContrastBand, FitProfile, Polarity } from '@webable/core';

/** Text size levels, smallest first. `px` is what the engine gets; people see `label` and an "Aa" drawn at that size. */
export const TEXT_LEVELS: ReadonlyArray<{ px: number; label: string }> = [
  { px: 16, label: 'Standard' },
  { px: 18, label: 'Larger' },
  { px: 20, label: 'Large' },
  { px: 24, label: 'Extra large' },
  { px: 28, label: 'Largest' },
];

export type ButtonLevel = 'standard' | 'larger' | 'largest';

/** Button size levels. `minPx` is what the engine gets (null leaves buttons alone). */
export const BUTTON_LEVELS: ReadonlyArray<{ value: ButtonLevel; label: string; minPx: number | null }> = [
  { value: 'standard', label: 'Standard', minPx: null },
  { value: 'larger', label: 'Larger', minPx: 44 },
  { value: 'largest', label: 'Largest', minPx: 72 },
];

export type FaintLevel = 'off' | 'darker' | 'darkest';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const currentText = (fit: FitProfile): number => fit.text.override ?? fit.text.bodyPx;

/** The nearest level to a size, by ratio (size is felt as a ratio). Anything above the top is the top. */
function nearestIndex(px: number, sizes: number[]): number {
  if (!Number.isFinite(px)) return 0;
  let best = 0;
  for (let i = 1; i < sizes.length; i++) {
    if (Math.abs(Math.log(px / (sizes[i] as number))) <= Math.abs(Math.log(px / (sizes[best] as number)))) best = i;
  }
  return best;
}

export function textLevelOf(px: number): number {
  if (!(px > 16.5)) return 0;
  return nearestIndex(px, TEXT_LEVELS.map((l) => l.px));
}

/** The level the page shows now. */
export const textLevel = (fit: FitProfile): number => textLevelOf(currentText(fit));

export const textLabel = (fit: FitProfile): string => (TEXT_LEVELS[textLevel(fit)] as { label: string }).label;

/**
 * Picks a text size level. Picking the level their measured size falls in goes back to that exact measured size (no
 * override), so stepping away and back never loses it.
 */
export function withTextLevel(fit: FitProfile, index: number): FitProfile {
  const i = clamp(Math.round(index), 0, TEXT_LEVELS.length - 1);
  const override = i === textLevelOf(fit.text.bodyPx) ? null : (TEXT_LEVELS[i] as { px: number }).px;
  if (override === fit.text.override) return fit;
  return { ...fit, text: { ...fit.text, override } };
}

export const canStepText = (fit: FitProfile, dir: 1 | -1): boolean => {
  const next = textLevel(fit) + dir;
  return next >= 0 && next < TEXT_LEVELS.length;
};

export function stepText(fit: FitProfile, dir: 1 | -1): FitProfile {
  return canStepText(fit, dir) ? withTextLevel(fit, textLevel(fit) + dir) : fit;
}

export function faintLevel(fit: FitProfile): FaintLevel {
  return fit.contrast.band === 'S' ? 'darkest' : fit.contrast.band === 'M' ? 'darker' : 'off';
}

/** Leave as is keeps the basic lift every page gets; darker and darkest go further. */
export function withFaint(fit: FitProfile, level: FaintLevel): FitProfile {
  const band: ContrastBand = level === 'darkest' ? 'S' : level === 'darker' ? 'M' : 'N';
  const floor = band === 'S' ? 15 : band === 'M' ? 7 : 4.5;
  const weight = band === 'S' ? 600 : band === 'M' ? 500 : 400;
  const lineHeight = band === 'S' || fit.text.largePrint ? 1.8 : band === 'M' ? 1.6 : 1.5;
  return {
    ...fit,
    contrast: { band, floor },
    weight: { ...fit.weight, floor: weight },
    spacing: { ...fit.spacing, lineHeight },
  };
}

export function withPolarity(fit: FitProfile, value: Polarity): FitProfile {
  return { ...fit, polarity: { value, stated: value } };
}

/** Which button level the settings sit at (a measured size in between goes to the nearest). */
export function buttonLevel(fit: FitProfile): ButtonLevel {
  const t = fit.targets.minPx;
  if (t == null || !Number.isFinite(t) || t <= 24) return 'standard';
  return t >= Math.sqrt(44 * 72) ? 'largest' : 'larger';
}

export const buttonLabel = (fit: FitProfile): string =>
  (BUTTON_LEVELS.find((l) => l.value === buttonLevel(fit)) as { label: string }).label;

/** Sets the button size level. Picking the level they are already at changes nothing (a measured size is kept). */
export function withButtonLevel(fit: FitProfile, level: ButtonLevel): FitProfile {
  if (level === buttonLevel(fit)) return fit;
  const minPx = (BUTTON_LEVELS.find((l) => l.value === level) as { minPx: number | null }).minPx;
  const radiusPx = minPx ? Math.round(clamp(minPx / 5, 6, minPx / 2)) : 10;
  return {
    ...fit,
    targets: { minPx, conf: minPx == null ? 0 : 1 },
    clicks: { ...fit.clicks, steady: { ...fit.clicks.steady, radiusPx } },
  };
}

export function withSteady(fit: FitProfile, on: boolean): FitProfile {
  return { ...fit, clicks: { ...fit.clicks, steady: { ...fit.clicks.steady, on } } };
}

export function withMotion(fit: FitProfile, on: boolean): FitProfile {
  return { ...fit, attention: { ...fit.attention, motion: { ...fit.attention.motion, on } } };
}
