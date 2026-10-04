import { deviceContextSchema } from '@webable/core';
import { describe, expect, it } from 'vitest';

import {
  deviceClassOf,
  deviceContextFrom,
  dprBucket,
  guessInput,
  viewportBucket,
  type EnvironmentProbe,
} from './device';

const LAPTOP: EnvironmentProbe = {
  devicePixelRatio: 2,
  innerWidth: 1440,
  innerHeight: 820,
  screenWidth: 1512,
  screenHeight: 982,
  coarsePointer: false,
  anyFinePointer: true,
  hover: true,
  reducedMotion: false,
  dark: false,
  moreContrast: false,
  forcedColors: false,
  rootFontPx: 16,
  visualScale: 1,
};

describe('device context', () => {
  it('keeps only coarse buckets and validates against the contract', () => {
    const ctx = deviceContextFrom(LAPTOP, 'trackpad');
    expect(ctx).toEqual({
      class: 'laptop',
      input: 'trackpad',
      dprBucket: 2,
      viewport: 'XL',
      reducedMotion: false,
      colorScheme: 'light',
      moreContrast: false,
      forcedColors: false,
      rootFontPx: 16,
      zoom: 1,
    });
    expect(deviceContextSchema.safeParse(ctx).success).toBe(true);
  });

  it('buckets pixel ratio and viewport', () => {
    expect(dprBucket(1.25)).toBe(1);
    expect(dprBucket(1.3)).toBe(1.5);
    expect(dprBucket(2.625)).toBe(3);
    expect(dprBucket(Number.NaN)).toBe(1);
    expect(viewportBucket(390)).toBe('S');
    expect(viewportBucket(800)).toBe('M');
    expect(viewportBucket(1280)).toBe('L');
  });

  it('tells phones, tablets and computers apart from pointer and screen', () => {
    const phone = {
      ...LAPTOP,
      coarsePointer: true,
      anyFinePointer: false,
      screenWidth: 390,
      screenHeight: 844,
    };
    expect(deviceClassOf(phone)).toBe('phone');
    expect(guessInput(phone)).toBe('touch');
    expect(
      deviceClassOf({ ...phone, screenWidth: 820, screenHeight: 1180 }),
    ).toBe('tablet');
    expect(
      deviceClassOf({ ...LAPTOP, screenWidth: 2560, screenHeight: 1440 }),
    ).toBe('desktop');
    expect(guessInput(LAPTOP)).toBe('mouse');
  });

  it('clamps odd values into the schema range', () => {
    const ctx = deviceContextFrom(
      { ...LAPTOP, rootFontPx: 200, visualScale: 9 },
      'mouse',
    );
    expect(ctx.rootFontPx).toBe(64);
    expect(ctx.zoom).toBe(5);
  });
});
