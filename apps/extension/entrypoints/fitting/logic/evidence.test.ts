import type { FittingRaw } from '@webable/core';
import { describe, expect, it } from 'vitest';
import type { SiteTaskResult } from '../../../src/sitetask/types';
import { demoEvidence } from './demo';
import { buildEvidence, busyEvidence, faintEvidence, pointingEvidence, readingEvidence } from './evidence';
import { RawCollector } from './raw';

function raw(over: Partial<FittingRaw> = {}): FittingRaw {
  return { inputClass: 'mouse', durationSec: 100, skipped: [], reading: null, pointing: null, finding: null, allPresses: [], ...over };
}

function reading(r: Partial<NonNullable<FittingRaw['reading']>>): FittingRaw['reading'] {
  return { seedPx: 20, ladder: [], faint: [], polarity: { lightMs: [], darkMs: [], stated: null }, ...r };
}

function site(over: Partial<SiteTaskResult> = {}): SiteTaskResult {
  return {
    id: 'cnn', name: 'CNN', busy: true, found: true, skipped: false, ms: 12000, wrongClicks: 0, nearMisses: 0, slips: 0,
    presses: 2, scrollScreens: 1, motionSeen: false, adsSeen: 4, ...over,
  };
}

const press = (hit: boolean) => ({ dx: hit ? 2 : 40, dy: 0, hit, slipped: false });

describe('reading evidence', () => {
  it('compares the smallest sizes read correctly with the largest', () => {
    const ladder = [
      { px: 25, ms: 2000, correct: true },
      { px: 20, ms: 2100, correct: true },
      { px: 16, ms: 2200, correct: true },
      { px: 12.6, ms: 2600, correct: true },
      { px: 10, ms: 3000, correct: true },
      { px: 8, ms: 3200, correct: true },
      { px: 6.3, ms: 4000, correct: false, cant: true },
      { px: 5, ms: 4000, correct: false, cant: true },
    ];
    const e = readingEvidence(raw({ reading: reading({ ladder }) }));
    // Smallest three read: 8, 10, 12.6 (median 3000 ms); largest three: 25, 20, 16 (median 2100 ms).
    expect(e).toEqual({ slowdown: 1.43, tooSmallCount: 2 });
  });

  it('gives no slowdown with fewer than three sentences read', () => {
    const ladder = [
      { px: 20, ms: 2000, correct: true },
      { px: 16, ms: 2600, correct: false },
      { px: 12.6, ms: 2600, correct: true },
    ];
    expect(readingEvidence(raw({ reading: reading({ ladder }) }))).toEqual({ slowdown: null, tooSmallCount: 0 });
    expect(readingEvidence(raw({ reading: reading({ ladder: [] }) }))).toBeNull();
    expect(readingEvidence(raw())).toBeNull();
  });
});

describe('faint evidence', () => {
  it('flags a miss at a common light grey or darker', () => {
    const faint = [
      { contrast: 7, correct: true },
      { contrast: 3.2, correct: false },
      { contrast: 4.4, correct: true },
    ];
    expect(faintEvidence(raw({ reading: reading({ faint }) }))).toEqual({ missedCommonGrey: true });
  });

  it('does not flag misses only at very light greys, or a slip by someone who reads much lighter words', () => {
    const light = [
      { contrast: 7, correct: true },
      { contrast: 1.3, correct: false },
      { contrast: 1.15, correct: false },
    ];
    expect(faintEvidence(raw({ reading: reading({ faint: light }) }))).toEqual({ missedCommonGrey: false });
    const slip = [
      { contrast: 2.5, correct: false },
      { contrast: 1.3, correct: true },
      { contrast: 1.2, correct: true },
    ];
    expect(faintEvidence(raw({ reading: reading({ faint: slip }) }))).toEqual({ missedCommonGrey: false });
    expect(faintEvidence(raw({ reading: reading({ faint: [] }) }))).toBeNull();
  });
});

describe('pointing evidence', () => {
  it('counts misses on the smaller dots plus near misses on real sites, and slips from every press', () => {
    const r = raw({
      pointing: {
        blocks: [
          { sizePx: 44, presses: Array.from({ length: 8 }, (_, i) => press(i > 0)) },
          { sizePx: 32, presses: Array.from({ length: 8 }, (_, i) => press(i > 2)) },
        ],
      },
      allPresses: [
        { slipped: true, repeat: false },
        { slipped: false, repeat: false },
        { slipped: true, repeat: false },
      ],
    });
    expect(pointingEvidence(r, [site({ nearMisses: 2 })])).toEqual({ smallMisses: 5, smallTotal: 10, slips: 2, presses: 3 });
  });

  it('uses the smallest block when the dots never went below the start, and near misses alone without dots', () => {
    const up = raw({
      pointing: {
        blocks: [
          { sizePx: 44, presses: Array.from({ length: 8 }, (_, i) => press(i > 3)) },
          { sizePx: 56, presses: Array.from({ length: 8 }, () => press(true)) },
        ],
      },
    });
    expect(pointingEvidence(up, [])).toMatchObject({ smallMisses: 4, smallTotal: 8 });
    expect(pointingEvidence(raw({ allPresses: [{ slipped: false, repeat: false }] }), [site({ nearMisses: 1 })])).toEqual({
      smallMisses: 1,
      smallTotal: 0,
      slips: 0,
      presses: 1,
    });
    expect(pointingEvidence(raw(), [])).toBeNull();
  });
});

describe('busy pages', () => {
  it('divides the busiest found site by the quietest', () => {
    const sites = [
      site({ id: 'wikipedia', name: 'Wikipedia', busy: false, ms: 6000, adsSeen: 0 }),
      site({ ms: 15000, adsSeen: 9 }),
      site({ id: 'allrecipes', name: 'Allrecipes', ms: 30000, adsSeen: 3 }),
    ];
    expect(busyEvidence(sites)).toEqual({ ratio: 2.5, busyName: 'CNN', quietName: 'Wikipedia' });
  });

  it('is null without a found time on one of each', () => {
    expect(busyEvidence([site({ id: 'wikipedia', name: 'Wikipedia', busy: false, found: false, ms: null }), site()])).toBeNull();
    expect(busyEvidence([site()])).toBeNull();
  });
});

describe('buildEvidence', () => {
  it('puts it all together from a run, keeping only chip ids', () => {
    const c = new RawCollector();
    c.addSites([site({ id: 'wikipedia', name: 'Wikipedia', busy: false, ms: 4000, slips: 1 }), site({ ms: 10000, motionSeen: true })]);
    c.complete('find');
    c.notes = ['moving things', 'popups'];
    c.stoppedMotion = true;
    const e = buildEvidence(c.toRaw(), c.sites);
    expect(e.gotInWay).toEqual(['moving things', 'popups']);
    expect(e.busySlowdown).toEqual({ ratio: 2.5, busyName: 'CNN', quietName: 'Wikipedia' });
    expect(e.pointing).toEqual({ smallMisses: 0, smallTotal: 0, slips: 1, presses: 4 });
    expect(e.reading).toBeNull();
    expect(e.faint).toBeNull();
    expect(e.sites).toHaveLength(2);
  });

  it('never throws on broken input', () => {
    const broken = { inputClass: 'mouse', reading: { ladder: null, faint: 'x' }, pointing: { blocks: [null] } } as unknown as FittingRaw;
    expect(() => buildEvidence(broken, null as unknown as SiteTaskResult[])).not.toThrow();
    expect(buildEvidence(broken, [])).toMatchObject({ sites: [], busySlowdown: null, gotInWay: [] });
    expect(buildEvidence(null as unknown as FittingRaw, [])).toMatchObject({ reading: null, sites: [] });
  });

  it('has plausible demo evidence for every demo fit', () => {
    for (const name of ['rosa', 'typical', 'reader'] as const) {
      const e = demoEvidence(name);
      expect(e.sites).toHaveLength(3);
      expect(busyEvidence(e.sites)).toEqual(e.busySlowdown);
    }
    expect(demoEvidence('rosa').faint?.missedCommonGrey).toBe(true);
    expect(demoEvidence('typical').gotInWay).toEqual([]);
  });
});
