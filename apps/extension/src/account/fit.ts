// The fit saved to the person's account by Tune on the website (core fit v1) as the engine's fit (fit.1).
//
// Tune measures reading, pointing and focus on webable's own pages and saves one profile per account
// (`fit_profiles`, is_current). The extension keeps its own fit (`fit` in chrome.storage.local); this turns the
// account's into it so the engine fits pages to what Tune measured. Pure: no chrome APIs, so it is unit tested.

import { defaultFit, type FitProfile } from '@webable/engine';
import { benefitProbability, needLevels } from '@webable/core/profile/needs';
import {
  fitProfileSchema,
  type FitProfile as AccountFit,
  type LatentDim,
  type ParamSource,
} from '@webable/core/profile/schema';

type EngineSource = 'measured' | 'stated' | 'default';
type FitSource = 'warmup' | 'person' | 'default';

const r2 = (n: number): number => Math.round(n * 100) / 100;

function engineSource(s: ParamSource): EngineSource {
  if (s === 'measured' || s === 'learned') return 'measured';
  if (s === 'stated' || s === 'override') return 'stated';
  return 'default';
}

/** Something the person or Tune set (not a default or the operating system's). */
const fromTune = (s: ParamSource): boolean =>
  s === 'measured' || s === 'stated' || s === 'learned';

const informed = (d: LatentDim): boolean =>
  d.sources.length > 0 && d.confidence > 0;

/** Parse an account fit; null when it is not one (an older or newer shape, or nothing saved yet). */
export function parseAccountFit(raw: unknown): AccountFit | null {
  const got = fitProfileSchema.safeParse(raw);
  return got.success ? got.data : null;
}

/**
 * The engine fit for an account fit. What Tune did not measure stays at the engine's defaults, so the extension's
 * own learning (browser settings, what happens on pages) still decides those needs.
 */
export function fromAccountFit(acc: AccountFit): FitProfile {
  const base = defaultFit();
  const { vision, motor, attention } = acc;
  const needs = needLevels(acc);

  const textSrc = vision.textMinPx.source;
  const bodyPx = r2(vision.textMinPx.measured ?? vision.textMinPx.value);
  const largePrint = bodyPx >= 32;

  const floor = vision.contrastFloor.value;
  const band = floor === 21 ? 'S' : floor === 7 ? 'M' : 'N';

  const targetsSet =
    fromTune(motor.minTargetPx.source) ||
    motor.minTargetPx.source === 'override';
  const minPx =
    targetsSet && motor.minTargetPx.value > 24 ? motor.minTargetPx.value : null;

  const motionP = attention.systemReducedMotion
    ? 0.95
    : informed(attention.motion)
      ? r2(benefitProbability(attention.motion))
      : base.attention.motion.p;
  const clutterP = informed(attention.distraction)
    ? r2(benefitProbability(attention.distraction))
    : base.attention.clutter.p;
  const structureLevel =
    needs.distraction === 2 ? 2 : needs.distraction === 1 ? 1 : 0;

  const polarity = vision.polarity;
  const stated = polarity.source === 'stated' || polarity.source === 'override';

  const maxCpl = vision.maxLineCh.value;

  const sources: Partial<Record<string, FitSource>> = {
    text_size:
      vision.textMinPx.override != null
        ? 'person'
        : fromTune(textSrc)
          ? 'warmup'
          : 'default',
    contrast:
      vision.contrastFloor.source === 'override'
        ? 'person'
        : fromTune(vision.contrastFloor.source)
          ? 'warmup'
          : 'default',
    targets:
      motor.minTargetPx.source === 'override'
        ? 'person'
        : fromTune(motor.minTargetPx.source)
          ? 'warmup'
          : 'default',
    steady_clicks:
      motor.steadyClicks.source === 'override'
        ? 'person'
        : fromTune(motor.steadyClicks.source)
          ? 'warmup'
          : 'default',
    motion: informed(attention.motion) ? 'warmup' : 'default',
    clutter: informed(attention.distraction) ? 'warmup' : 'default',
    colors: stated ? 'warmup' : 'default',
  };

  return {
    ...base,
    v: 'fit.1',
    createdAt: acc.createdAt,
    inputClass: motor.input,
    text: {
      bodyPx,
      cpsPx: null,
      largePrint,
      conf: r2(vision.textMinPx.confidence),
      source: engineSource(textSrc),
      override: vision.textMinPx.override ?? null,
    },
    contrast: { band, floor: band === 'S' ? 15 : band === 'M' ? 7 : 4.5 },
    polarity: { value: polarity.value, stated: stated ? polarity.value : null },
    weight: { floor: vision.fontWeightFloor.value },
    spacing: {
      lineHeight: vision.lineHeight.value,
      wordEm: vision.wordSpacingEm.value,
      letterEm: vision.letterSpacingEm.value,
    },
    measure: {
      targetCpl: Math.min(base.measure.targetCpl, maxCpl),
      maxCpl,
      minCpl: largePrint ? 8 : 13,
    },
    targets: {
      minPx,
      conf: minPx === null ? 0 : r2(motor.minTargetPx.confidence),
    },
    clicks: {
      steady: motor.steadyClicks.value,
      debounce: motor.repeatGuard.value.on,
    },
    attention: {
      motion: { p: motionP, on: needs.motion >= 1 },
      clutter: { p: clutterP },
      structureLevel,
    },
    calibration: {
      version: `account:${acc.calibrationVersion ?? acc.derivationVersion}`,
      durationSec: 0,
      skipped: (['reading', 'pointing', 'focus'] as const).filter(
        (m) => acc.modules[m] !== 'measured',
      ),
      // Read by the passive fit's precedence (fitSources): what Tune measured counts as the warm-up.
      ...({ sources } as object),
    },
  };
}
