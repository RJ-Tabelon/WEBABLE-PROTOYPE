import { OP_CATALOG } from '@webable/core/ops/catalog';
import { describe, expect, it } from 'vitest';
import {
  HERO_FIT,
  ORIGINAL_FIT,
  PROFILE_FITS,
  SAMPLE_ORIGINAL,
  adaptedStatus,
  changeCount,
  describeSample,
  ladderIndex,
  marksFor,
  type SampleFit,
} from './model';

/** Every fit the website shows. */
const ALL_FITS: readonly SampleFit[] = [
  HERO_FIT,
  ...PROFILE_FITS.map((p) => p.fit),
];

describe('sample page fits', () => {
  it('shows the hero values from the design spec', () => {
    const byId = new Map(marksFor(HERO_FIT).map((m) => [m.id, m]));
    expect(byId.get('text')).toMatchObject({
      from: 13,
      to: 18,
      unit: 'px',
      label: 'Text size',
    });
    expect(byId.get('targets')).toMatchObject({
      from: 24,
      to: 44,
      unit: 'px',
      label: 'Click targets',
    });
    expect(byId.get('motion')).toMatchObject({
      from: 3,
      to: 0,
      label: 'Moving things',
    });
  });

  it('puts every after-value on a reviewed op ladder (no invented numbers)', () => {
    for (const fit of ALL_FITS) {
      if (fit.textFloorPx !== null)
        expect(
          ladderIndex('text_floor', fit.textFloorPx),
        ).toBeGreaterThanOrEqual(0);
      if (fit.lineHeight !== null)
        expect(
          ladderIndex('line_spacing', fit.lineHeight),
        ).toBeGreaterThanOrEqual(0);
      if (fit.targetPx !== null)
        expect(ladderIndex('target_size', fit.targetPx)).toBeGreaterThanOrEqual(
          0,
        );
      if (fit.targetSpacingPx !== null)
        expect(
          ladderIndex('target_spacing', fit.targetSpacingPx),
        ).toBeGreaterThanOrEqual(0);
      if (fit.steadyClicksMs !== null)
        expect(
          ladderIndex('steady_clicks', fit.steadyClicksMs),
        ).toBeGreaterThanOrEqual(0);
      if (fit.railOpacity !== null)
        expect(
          ladderIndex('dim_distractions', fit.railOpacity),
        ).toBeGreaterThanOrEqual(0);
    }
  });

  it('uses the catalog label for every change', () => {
    for (const fit of ALL_FITS) {
      for (const mark of marksFor(fit)) {
        expect(mark.label).toBe(OP_CATALOG[mark.op].label);
      }
    }
  });

  it('only ever grows what it changes', () => {
    for (const fit of ALL_FITS) {
      for (const mark of marksFor(fit)) {
        if (
          typeof mark.from === 'number' &&
          typeof mark.to === 'number' &&
          mark.id !== 'motion'
        ) {
          expect(mark.to).toBeGreaterThan(mark.from);
        }
      }
    }
  });

  it('makes exactly the three hero changes, each with its own fit mark', () => {
    expect(marksFor(HERO_FIT).map((m) => m.id)).toEqual([
      'text',
      'motion',
      'targets',
    ]);
  });

  it('gives three distinct fits, headed by where they came from', () => {
    expect(PROFILE_FITS.map((p) => p.id)).toEqual([
      'reading',
      'pointing',
      'focus',
    ]);
    const signatures = PROFILE_FITS.map((p) =>
      marksFor(p.fit)
        .map((m) => m.id)
        .join(),
    );
    expect(new Set(signatures).size).toBe(3);
    expect(PROFILE_FITS.map((p) => p.head)).toEqual([
      'Fit from a reading-heavy Tune',
      'Fit from a pointing-heavy Tune',
      'Fit from a focus-heavy Tune',
    ]);
    for (const p of PROFILE_FITS) {
      expect(p.head).not.toMatch(
        /\b(people with|users with|disab|impair|patient|normal|preset)\b/i,
      );
      // Two or three inline fit marks under each crop.
      expect(marksFor(p.fit).length).toBeGreaterThanOrEqual(2);
      expect(marksFor(p.fit).length).toBeLessThanOrEqual(3);
    }
  });

  it('keeps the focus fit softening the page around the article', () => {
    const focus = PROFILE_FITS.find((p) => p.id === 'focus')!;
    expect(marksFor(focus.fit).map((m) => m.op)).toContain('focus_view');
  });

  it('makes no change for the original page', () => {
    expect(marksFor(ORIGINAL_FIT)).toEqual([]);
    expect(changeCount(ORIGINAL_FIT)).toBe(0);
  });

  it('counts each change once', () => {
    expect(changeCount(HERO_FIT)).toBe(marksFor(HERO_FIT).length);
    expect(changeCount(HERO_FIT)).toBe(3);
    expect(adaptedStatus(HERO_FIT)).toBe('Adapted · 3 changes');
  });

  it('describes the sample in words for screen readers', () => {
    expect(describeSample(ORIGINAL_FIT)).toContain(
      `${SAMPLE_ORIGINAL.bodyPx} px body text`,
    );
    const fitted = describeSample(HERO_FIT);
    expect(fitted).toContain('text size, 13 to 18 pixels');
    expect(fitted).toContain('click targets, 24 to 44 pixels');
    expect(fitted).toContain('moving things, 3 to 0');
  });

  it('speaks units in words', () => {
    const steady = marksFor(PROFILE_FITS[1]!.fit).find(
      (m) => m.id === 'steady',
    );
    expect(steady?.spoken).toBe('Steady clicks, Off to 300 milliseconds');
  });
});

describe('ladderIndex', () => {
  it('finds ladder levels and rejects values between them', () => {
    expect(ladderIndex('text_floor', 18)).toBe(
      OP_CATALOG.text_floor.levels.indexOf(18),
    );
    expect(ladderIndex('text_floor', 17)).toBe(-1);
    expect(ladderIndex('dim_distractions', 0.45)).toBe(1);
  });
});
