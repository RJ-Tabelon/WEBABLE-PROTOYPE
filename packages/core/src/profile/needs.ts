import type { FitProfile, LatentDim, NeedLevel, NeedLevels } from './schema';

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, max error 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Probability that the matching adaptation yields a meaningful (>5%) benefit. */
export function benefitProbability(dim: LatentDim): number {
  return normCdf((dim.mean - 0.05) / Math.max(dim.sd, 0.05));
}

function level(p: number, one: number, two: number): NeedLevel {
  return p >= two ? 2 : p >= one ? 1 : 0;
}

/**
 * Quantise the profile into need levels. Thresholds are cost-weighted:
 * cheap, reversible changes (motion) switch on at lower evidence than costly
 * ones (dimming content), following cal-attention.md section 6.
 */
export function needLevels(profile: FitProfile): NeedLevels {
  const { vision, motor, attention } = profile;
  const text = vision.textMinPx.value;
  const chunking = benefitProbability(attention.chunking);
  const density = benefitProbability(attention.density);

  return {
    text: text >= 21 ? 2 : text >= 17 ? 1 : 0,
    contrast: vision.contrastFloor.value === 21 ? 2 : vision.contrastFloor.value === 7 ? 1 : 0,
    spacing:
      vision.lineHeight.value >= 1.8
        ? 2
        : vision.lineHeight.value >= 1.6 || vision.wordSpacingEm.value >= 0.1 || chunking >= 0.7
          ? 1
          : 0,
    lineLength: vision.maxLineCh.value <= 62 ? 2 : vision.maxLineCh.value <= 72 || density >= 0.6 ? 1 : 0,
    targets: motor.minTargetPx.value >= 56 ? 2 : motor.minTargetPx.value >= 44 ? 1 : 0,
    clicks: motor.steadyClicks.value.on
      ? 2
      : motor.repeatGuard.value.on || motor.hoverGraceMs.value > 0
        ? 1
        : 0,
    motion: attention.systemReducedMotion ? 2 : level(benefitProbability(attention.motion), 0.35, 0.8),
    distraction: level(benefitProbability(attention.distraction), 0.5, 0.8),
  };
}
