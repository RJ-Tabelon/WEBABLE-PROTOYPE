import { describe, expect, it } from 'vitest';

import {
  focusProfile,
  strongReaderProfile,
  tier0Profile,
} from '../policy/fixtures';
import {
  TARGET_LADDER,
  type FitProfile,
  type LatentDim,
} from '../profile/schema';
import { FIT_SOLVER_VERSION } from '../versions';
import { probBenefit, solveFitLayout, solveStructure } from './solver';
import { tiersDistinguishable } from './typeramp';
import type { FitLayout } from './types';

// ---------------------------------------------------------------------------
// Personas (docs/10 §10: large text, large targets, high distraction)
// ---------------------------------------------------------------------------

const evidenced = (mean: number, sd: number): LatentDim => ({
  mean,
  sd,
  confidence: 0.8,
  sources: ['behavior'],
});

/** Large print: F = 36, semibold floor, generous spacing, dark, enhanced contrast. */
function largeTextProfile(): FitProfile {
  const p = strongReaderProfile();
  p.vision.textMinPx.value = 36;
  p.vision.fontWeightFloor.value = 600;
  p.vision.lineHeight.value = 1.8;
  p.vision.wordSpacingEm.value = 0.16;
  p.vision.letterSpacingEm.value = 0.12;
  p.vision.maxLineCh.value = 60;
  p.vision.polarity.value = 'dark';
  p.vision.contrastFloor.value = 7;
  p.motor.targetSpacingPx.value = 56;
  return p;
}

/** Large targets: 72 px measured hit size, wide spacing, fewer columns preferred. */
function largeTargetsProfile(): FitProfile {
  const p = tier0Profile();
  p.vision.textMinPx.value = 18;
  p.motor.minTargetPx.value = 72;
  p.motor.targetSpacingPx.value = 96;
  p.attention.density = evidenced(0.9, 0.1);
  return p;
}

describe('solveFitLayout: golden personas', () => {
  it('default fit: changes little, still a coherent ramp', () => {
    expect(solveFitLayout(tier0Profile())).toEqual({
      v: 1,
      version: FIT_SOLVER_VERSION,
      type: {
        pageHeading: { px: 40, weight: 600, cue: 'none' },
        sectionHeading: { px: 28, weight: 600, cue: 'none' },
        title: { px: 20, weight: 600, cue: 'none' },
        body: { px: 16, weight: 400, cue: 'none' },
        meta: { px: 14, weight: 400, cue: 'none' },
        lineHeight: 1.5,
        wordSpacingEm: 0,
        letterSpacingEm: 0,
        maxLineCh: 80,
        minLineCh: 13,
        font: 'system',
      },
      target: { minPx: 24, gapPx: 8, controlPx: 44 },
      space: {
        unitPx: 8,
        groupGapPx: 24,
        sectionGapPx: 40,
        cardPadPx: 12,
        pagePadPx: 16,
        maxContentPx: 873,
      },
      grid: {
        card_media: { minWidthPx: 220, maxCols: 3 },
        card_text: { minWidthPx: 280, maxCols: 3 },
        row: { minWidthPx: 280, maxCols: 1 },
      },
      groupEvery: 6,
      structure: {
        level: 0,
        listFirst: null,
        groupEvery: 6,
        splitSentences: null,
        outline: false,
        sectionsOpen: null,
      },
      nav: { inlineMax: 8 },
      tertiary: 'expanded',
      palette: { scheme: 'light', contrast: 'standard' },
      motion: 'allow',
    } satisfies FitLayout);
  });

  it('large text: compressed ramp carried by cues, large-print measure, dark and more contrast', () => {
    expect(solveFitLayout(largeTextProfile())).toEqual({
      v: 1,
      version: FIT_SOLVER_VERSION,
      type: {
        pageHeading: { px: 53, weight: 600, cue: 'none' },
        sectionHeading: { px: 44, weight: 600, cue: 'rule' },
        title: { px: 40, weight: 600, cue: 'space' },
        body: { px: 36, weight: 600, cue: 'none' },
        meta: { px: 30.5, weight: 600, cue: 'none' },
        lineHeight: 1.8,
        wordSpacingEm: 0.16,
        letterSpacingEm: 0.12,
        maxLineCh: 60,
        minLineCh: 8,
        font: 'system',
      },
      target: { minPx: 44, gapPx: 12, controlPx: 79 },
      space: {
        unitPx: 18,
        groupGapPx: 54,
        sectionGapPx: 90,
        cardPadPx: 27,
        pagePadPx: 36,
        maxContentPx: 1796,
      },
      grid: {
        card_media: { minWidthPx: 450, maxCols: 3 },
        card_text: { minWidthPx: 630, maxCols: 3 },
        row: { minWidthPx: 630, maxCols: 1 },
      },
      groupEvery: 6,
      structure: {
        level: 0,
        listFirst: null,
        groupEvery: 6,
        splitSentences: null,
        outline: false,
        sectionsOpen: null,
      },
      nav: { inlineMax: 8 },
      tertiary: 'expanded',
      palette: { scheme: 'dark', contrast: 'more' },
      motion: 'allow',
    } satisfies FitLayout);
  });

  it('large targets: the measured 72 px, wider gaps, two columns', () => {
    expect(solveFitLayout(largeTargetsProfile())).toEqual({
      v: 1,
      version: FIT_SOLVER_VERSION,
      type: {
        pageHeading: { px: 42, weight: 600, cue: 'none' },
        sectionHeading: { px: 30, weight: 600, cue: 'none' },
        title: { px: 22, weight: 600, cue: 'none' },
        body: { px: 18, weight: 400, cue: 'none' },
        meta: { px: 15.5, weight: 400, cue: 'none' },
        lineHeight: 1.5,
        wordSpacingEm: 0,
        letterSpacingEm: 0,
        maxLineCh: 80,
        minLineCh: 13,
        font: 'system',
      },
      target: { minPx: 72, gapPx: 24, controlPx: 72 },
      space: {
        unitPx: 9,
        groupGapPx: 48,
        sectionGapPx: 57,
        cardPadPx: 14,
        pagePadPx: 18,
        maxContentPx: 828,
      },
      grid: {
        card_media: { minWidthPx: 226, maxCols: 2 },
        card_text: { minWidthPx: 316, maxCols: 2 },
        row: { minWidthPx: 316, maxCols: 1 },
      },
      groupEvery: 6,
      // Density evidence (two columns) also means clutter costs this person:
      // fewer records and sections open at once, an outline for long text.
      structure: {
        level: 2,
        listFirst: 8,
        groupEvery: 6,
        splitSentences: null,
        outline: true,
        sectionsOpen: 1,
      },
      nav: { inlineMax: 8 },
      tertiary: 'expanded',
      palette: { scheme: 'light', contrast: 'standard' },
      motion: 'allow',
    } satisfies FitLayout);
  });

  it('high distraction: five inline links, tertiary collapsed, motion reduced', () => {
    const layout = solveFitLayout(focusProfile());
    expect(layout.nav).toEqual({ inlineMax: 5 });
    expect(layout.tertiary).toBe('collapsed');
    expect(layout.motion).toBe('reduce');
    expect(layout.type.body.px).toBe(21);
    expect(layout.target).toEqual({ minPx: 44, gapPx: 8, controlPx: 46 });
    expect(layout.grid.card_media).toEqual({ minWidthPx: 263, maxCols: 3 });
  });
});

describe('solveFitLayout: rules', () => {
  it('uses the measured target size, never a fixed 44', () => {
    for (const t of TARGET_LADDER) {
      const p = tier0Profile();
      p.motor.minTargetPx.value = t;
      const layout = solveFitLayout(p);
      expect(layout.target.minPx).toBe(t);
      expect(layout.target.controlPx).toBeGreaterThanOrEqual(t);
    }
  });

  it('gates calm on the posterior, not the mean', () => {
    const p = tier0Profile();
    // Mean says "benefit", but the evidence is too weak: P(benefit > 0) < 0.8.
    p.attention.distraction = evidenced(0.3, 0.6);
    expect(probBenefit(p.attention.distraction)).toBeLessThan(0.8);
    expect(solveFitLayout(p).tertiary).toBe('expanded');
    p.attention.distraction = evidenced(0.3, 0.2);
    expect(probBenefit(p.attention.distraction)).toBeGreaterThanOrEqual(0.8);
    expect(solveFitLayout(p).tertiary).toBe('collapsed');
  });

  it('picks 2, 3 or 4 columns by P(density benefit > 0)', () => {
    const cols = (mean: number, sd: number): number => {
      const p = tier0Profile();
      p.attention.density = evidenced(mean, sd);
      return solveFitLayout(p).grid.card_media.maxCols;
    };
    expect(cols(0.5, 0.2)).toBe(2);
    expect(cols(0.1, 0.5)).toBe(3);
    expect(cols(-0.4, 0.2)).toBe(4);
  });

  it('honours reduced motion; only the fit, never the OS, turns the view dark', () => {
    const p = tier0Profile({
      reducedMotion: true,
      colorScheme: 'dark',
      moreContrast: true,
      forcedColors: false,
      deviceClass: 'laptop',
      input: 'mouse',
    });
    const layout = solveFitLayout(p, { colorScheme: 'dark' });
    expect(layout.motion).toBe('reduce');
    // No polarity in the fit: light, whatever the OS says (docs/12 §3.6).
    expect(p.vision.polarity.value).toBe('none');
    expect(layout.palette).toEqual({ scheme: 'light', contrast: 'more' });
    expect(solveFitLayout(p).palette.scheme).toBe('light');
    p.vision.polarity.value = 'light';
    expect(solveFitLayout(p, { colorScheme: 'dark' }).palette.scheme).toBe(
      'light',
    );
    p.vision.polarity.value = 'dark';
    expect(solveFitLayout(p, { colorScheme: 'light' }).palette.scheme).toBe(
      'dark',
    );
    p.vision.contrastFloor.value = 21;
    expect(solveFitLayout(p).palette.contrast).toBe('max');
  });

  it('never lets letter spacing outrun word spacing', () => {
    const p = tier0Profile();
    p.vision.letterSpacingEm.value = 0.12;
    p.vision.wordSpacingEm.value = 0.05;
    const t = solveFitLayout(p).type;
    expect(t.letterSpacingEm).toBe(0.05);
    expect(t.wordSpacingEm).toBe(0.05);
  });

  it('switches to the large-print measure floor at 24 px', () => {
    const p = tier0Profile();
    p.vision.textMinPx.value = 23.5;
    expect(solveFitLayout(p).type.minLineCh).toBe(13);
    p.vision.textMinPx.value = 24;
    expect(solveFitLayout(p).type.minLineCh).toBe(8);
  });

  it('computes P(benefit > 0) as Φ(mean / sd)', () => {
    expect(probBenefit(evidenced(0, 0.35))).toBe(0.5);
    expect(probBenefit(evidenced(0.35, 0.35))).toBeCloseTo(0.8413, 3);
    expect(probBenefit(evidenced(-0.35, 0.35))).toBeCloseTo(0.1587, 3);
    expect(probBenefit(evidenced(0.5, 0))).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
// Properties over random fits
// ---------------------------------------------------------------------------

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomProfile(rand: () => number): FitProfile {
  const p = tier0Profile();
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const dim = (): LatentDim => evidenced(-1 + rand() * 3, rand() * 2);
  p.vision.textMinPx.value = 12 + rand() * 84;
  p.vision.fontWeightFloor.value = pick([400, 500, 600] as const);
  p.vision.lineHeight.value = 1.2 + rand();
  p.vision.wordSpacingEm.value = rand() * 0.3;
  p.vision.letterSpacingEm.value = rand() * 0.12;
  p.vision.maxLineCh.value = 45 + Math.floor(rand() * 56);
  p.vision.polarity.value = pick(['light', 'dark', 'none'] as const);
  p.vision.contrastFloor.value = pick([4.5, 7, 21] as const);
  p.motor.minTargetPx.value = pick(TARGET_LADDER);
  p.motor.targetSpacingPx.value = rand() * 160;
  p.attention.density = dim();
  p.attention.distraction = dim();
  p.attention.motion = dim();
  p.attention.systemReducedMotion = rand() < 0.2;
  return p;
}

function numbers(value: unknown, path = ''): Array<[string, number]> {
  if (typeof value === 'number') return [[path, value]];
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) =>
      numbers(v, `${path}.${k}`),
    );
  return [];
}

describe('solveFitLayout: properties', () => {
  it('holds every rule for random fits', () => {
    const rand = rng(4242);
    for (let i = 0; i < 3000; i++) {
      const p = randomProfile(rand);
      const l = solveFitLayout(p);
      const F = p.vision.textMinPx.value;
      const t = l.type;

      // Every number is finite; every px is positive.
      for (const [path, v] of numbers(l)) {
        expect(Number.isFinite(v), `${i} ${path}`).toBe(true);
        if (/px|Px/.test(path)) expect(v, `${i} ${path}`).toBeGreaterThan(0);
      }
      // Monotone, distinguishable tiers.
      expect(t.body.px).toBeCloseTo(F, 2);
      expect(t.pageHeading.px).toBeGreaterThan(t.sectionHeading.px);
      expect(t.sectionHeading.px).toBeGreaterThan(t.title.px);
      expect(t.title.px).toBeGreaterThan(t.body.px);
      expect(t.meta.px).toBeLessThanOrEqual(t.body.px);
      expect(tiersDistinguishable(t.pageHeading, t.sectionHeading)).toBe(true);
      expect(tiersDistinguishable(t.sectionHeading, t.title)).toBe(true);
      expect(tiersDistinguishable(t.title, t.body)).toBe(true);
      for (const tier of [
        t.pageHeading,
        t.sectionHeading,
        t.title,
        t.body,
        t.meta,
      ]) {
        expect(tier.weight).toBeGreaterThanOrEqual(
          p.vision.fontWeightFloor.value,
        );
        expect(tier.weight).toBeLessThanOrEqual(700);
      }
      // Spacing and measure.
      expect(t.letterSpacingEm).toBeLessThanOrEqual(t.wordSpacingEm);
      expect(t.minLineCh).toBe(F >= 24 ? 8 : 13);
      expect(t.maxLineCh).toBe(p.vision.maxLineCh.value);
      // Targets: exactly the measured size; controls follow the text; gaps keep their floor.
      expect(l.target.minPx).toBe(p.motor.minTargetPx.value);
      expect(l.target.controlPx).toBeGreaterThanOrEqual(l.target.minPx);
      expect(l.target.controlPx).toBeGreaterThanOrEqual(
        Math.max(44, Math.round(F * 2.2)),
      );
      expect(l.target.gapPx).toBeGreaterThanOrEqual(8);
      expect(l.target.gapPx).toBeGreaterThanOrEqual(
        p.motor.targetSpacingPx.value - p.motor.minTargetPx.value - 1e-9,
      );
      // Between-group gap at least twice the within-group gap; sections wider still.
      const within = Math.max(l.space.unitPx, l.target.gapPx);
      expect(l.space.groupGapPx).toBeGreaterThanOrEqual(2 * within);
      expect(l.space.sectionGapPx).toBeGreaterThan(l.space.groupGapPx);
      // Grid.
      expect([2, 3, 4]).toContain(l.grid.card_media.maxCols);
      expect(l.grid.card_text.maxCols).toBe(l.grid.card_media.maxCols);
      expect(l.grid.row.maxCols).toBe(1);
      expect(l.grid.card_media.minWidthPx).toBeGreaterThanOrEqual(220);
      expect(l.grid.card_text.minWidthPx).toBeGreaterThanOrEqual(
        l.grid.card_media.minWidthPx,
      );
      expect(l.space.maxContentPx).toBeGreaterThanOrEqual(
        l.grid.card_text.minWidthPx,
      );
      // Calm.
      const calm = probBenefit(p.attention.distraction) >= 0.8;
      expect(l.nav.inlineMax).toBe(calm ? 5 : 8);
      expect(l.tertiary).toBe(calm ? 'collapsed' : 'expanded');
      expect(l.motion).toBe(
        p.attention.systemReducedMotion ||
          probBenefit(p.attention.motion) >= 0.8
          ? 'reduce'
          : 'allow',
      );
      // Structure (docs/11): chunks of 4–6, lists and sections only ever
      // shortened, and the group size the renderer reads stays in sync.
      expect([4, 5, 6]).toContain(l.groupEvery);
      expect(l.structure.groupEvery).toBe(l.groupEvery);
      expect(l.structure).toEqual(solveStructure(p));
      expect([null, 8, 12]).toContain(l.structure.listFirst);
      expect([null, 1, 2]).toContain(l.structure.sectionsOpen);
      expect(l.type.font).toBe('system');
      expect(l.palette.scheme).toBe(
        p.vision.polarity.value === 'dark' ? 'dark' : 'light',
      );
    }
  });

  it('grows with the text floor: larger F never shrinks type, controls or spacing', () => {
    const base = tier0Profile();
    base.vision.textMinPx.value = 12;
    let prev = solveFitLayout(base);
    for (let F = 12.5; F <= 96; F += 0.5) {
      const p = tier0Profile();
      p.vision.textMinPx.value = F;
      const l = solveFitLayout(p);
      for (const k of [
        'pageHeading',
        'sectionHeading',
        'title',
        'body',
        'meta',
      ] as const)
        expect(l.type[k].px).toBeGreaterThanOrEqual(prev.type[k].px);
      expect(l.target.controlPx).toBeGreaterThanOrEqual(prev.target.controlPx);
      expect(l.space.groupGapPx).toBeGreaterThanOrEqual(prev.space.groupGapPx);
      expect(l.grid.card_media.minWidthPx).toBeGreaterThanOrEqual(
        prev.grid.card_media.minWidthPx,
      );
      prev = l;
    }
  });
});
