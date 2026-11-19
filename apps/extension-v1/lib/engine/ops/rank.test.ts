import { describe, expect, it } from 'vitest';

import { rankRange, solveRanks, type RankGroup } from './rank';

const fixed = (s: number) => ({ s, unit: null });
const unit = (s: number, u: number) => ({ s, unit: u });

/** Every pair in every group: no point natively smaller ends larger. */
function inversions(groups: readonly RankGroup[], r: readonly number[]) {
  const out: string[] = [];
  for (const g of groups)
    for (const a of g.points)
      for (const b of g.points) {
        if (!(a.s + 0.5 < b.s)) continue;
        const aa = a.s * (a.unit === null ? 1 : (r[a.unit] as number));
        const ab = b.s * (b.unit === null ? 1 : (r[b.unit] as number));
        if (aa > ab + 1e-9) out.push(`${a.s}->${aa} over ${b.s}->${ab}`);
      }
  return out;
}

describe('solveRanks (size order per region, eval B6)', () => {
  it('a text that keeps its size caps every text natively smaller in its region at a tie', () => {
    // Meta: the 24 px chip keeps its size; the 16 px price wanted 2.5x.
    const regions = [{ points: [fixed(24), unit(16, 0), unit(12, 1)] }];
    const out = solveRanks({
      regions,
      want: [2.5, 2.5],
      c: 0.7,
      minGrowth: 0.06,
    });
    expect(out.r[0]).toBeCloseTo(24 / 16, 9);
    expect(out.r[1]).toBeCloseTo(24 / 12, 9);
    expect(inversions(regions, out.r)).toEqual([]);
  });

  it('in a record the gap under a fixed text stays visible (the native ratio, compressed)', () => {
    const groups = [{ points: [fixed(14), unit(12, 0)], compress: true }];
    const out = solveRanks({
      regions: groups,
      want: [1.5],
      c: 0.8,
      minGrowth: 0,
    });
    expect(12 * (out.r[0] as number)).toBeCloseTo(14 ** 0.2 * 12 ** 0.8, 9);
    expect(12 * (out.r[0] as number)).toBeLessThan(14);
  });

  it('inline text scales with its field: the field stops where its smallest part meets a larger text', () => {
    // GitHub: a 16 px paragraph with 12 px inline code, beside a 14 px label.
    const regions = [{ points: [unit(16, 0), unit(12, 0), fixed(14)] }];
    const out = solveRanks({ regions, want: [1.5], c: 0.7, minGrowth: 0.06 });
    expect(out.held[0]).toBe(false);
    expect(12 * (out.r[0] as number)).toBeCloseTo(14, 9);
    expect(inversions(regions, out.r)).toEqual([]);
  });

  it('growth too small to see is held, and the held field then caps the rest', () => {
    const regions = [{ points: [fixed(16.8), unit(16, 0), unit(14, 1)] }];
    const out = solveRanks({
      regions,
      want: [1.5, 1.5],
      c: 0.7,
      minGrowth: 0.06,
    });
    expect(out.held[0]).toBe(true);
    expect(out.r[0]).toBe(1);
    expect(14 * (out.r[1] as number)).toBeLessThanOrEqual(16 + 1e-9);
    expect(inversions(regions, out.r)).toEqual([]);
  });

  it('ranks hold across regions a field spans, and fields of one template share one scale', () => {
    const regions = [
      { points: [unit(13, 0), fixed(15)] },
      { points: [unit(13, 1), fixed(30)] },
      { points: [unit(13, 0), unit(20, 2)] },
    ];
    const out = solveRanks({
      regions,
      want: [2, 2, 1.2],
      groups: [[0, 1]],
      c: 0.7,
      minGrowth: 0.06,
    });
    expect(out.r[0]).toBeCloseTo(15 / 13, 9);
    expect(out.r[1]).toBe(out.r[0]);
    expect(inversions(regions, out.r)).toEqual([]);
  });

  it('native sizes within the tolerance are no rank: a page scale shrinks it', () => {
    const regions = [{ points: [unit(13.6, 0), fixed(14)] }];
    const free = solveRanks({ regions, want: [1.5], c: 0.7, minGrowth: 0.06 });
    expect(free.r[0]).toBeCloseTo(1.5, 9);
    // At 175% the reader's half pixel is 0.29 CSS px: 13.6 and 14 rank.
    const scaled = solveRanks({
      regions,
      want: [1.5],
      c: 0.7,
      minGrowth: 0.06,
      eps: 0.5 / 1.75,
    });
    expect(scaled.held[0]).toBe(true);
  });

  it('never grows a unit the caller holds, and never shrinks below native', () => {
    const regions = [{ points: [unit(12, 0), unit(18, 1), fixed(40)] }];
    const out = solveRanks({
      regions,
      want: [3, 2],
      held: new Set([1]),
      c: 0.7,
      minGrowth: 0.06,
    });
    expect(out.r[1]).toBe(1);
    expect(12 * (out.r[0] as number)).toBeCloseTo(18, 9);
    expect(Math.min(...out.r)).toBeGreaterThanOrEqual(1);
  });
});

describe('headings over the text they introduce', () => {
  it('at one native size a heading ranks above its text where the group lifts headings, not across a region', () => {
    // GitHub: a 16 px "About" held at 20 px by its region; its 16 px
    // description wanted 2x.
    const about = { s: 16, unit: 0, heading: true };
    const desc = { s: 16, unit: 1 };
    const region = { points: [about, desc, fixed(20)] };
    const section = { points: [about, desc], lift: true };
    const free = solveRanks({
      regions: [region],
      want: [2, 2],
      c: 0.7,
      minGrowth: 0.06,
    });
    expect(16 * (free.r[1] as number)).toBeCloseTo(20, 9);
    const lifted = solveRanks({
      regions: [{ points: [about, desc, fixed(18)] }, section],
      want: [2, 2],
      c: 0.7,
      minGrowth: 0.06,
    });
    expect(lifted.r[1]).toBeLessThanOrEqual(lifted.r[0] as number);
    // Without the lift, a held heading of one section caps nothing at its size.
    const held = solveRanks({
      regions: [{ points: [{ s: 16, unit: 0, heading: true }, desc] }],
      want: [1, 2],
      held: new Set([0]),
      c: 0.7,
      minGrowth: 0.06,
    });
    expect(held.r[1]).toBeCloseTo(2, 9);
  });
});

describe('rankRange (fields first seen later)', () => {
  it('sits between what smaller texts reach and what larger ones allow', () => {
    const points = [
      { s: 12, after: 18, fixed: false },
      { s: 24, after: 24, fixed: true },
      { s: 16, after: 20, fixed: false },
    ];
    expect(rankRange(14, points)).toEqual({ lo: 18 / 14, hi: 20 / 14 });
    // Ties within the tolerance bound nothing.
    expect(rankRange(16.2, points).hi).toBeCloseTo(24 / 16.2, 9);
  });
});

describe('control labels as ceilings', () => {
  it('a glyph control ("+" at the browser default 13.33 px) caps no text', () => {
    const plus = { s: 13.33, unit: null, control: 'glyph' as const };
    const body = { s: 12, unit: 0, running: true };
    const meta = unit(11, 1);
    const regions = [{ points: [plus, body, meta] }];
    const out = solveRanks({
      regions,
      want: [16 / 12, 15 / 11],
      c: 0.7,
      minGrowth: 0.06,
    });
    expect(12 * (out.r[0] as number)).toBeCloseTo(16, 9);
    expect(11 * (out.r[1] as number)).toBeCloseTo(15, 9);
    // Growing, the glyph is still capped itself by text natively larger.
    const grown = solveRanks({
      regions: [{ points: [{ ...plus, unit: 0 }, fixed(16)] }],
      want: [2],
      c: 0.7,
      minGrowth: 0.06,
    });
    expect(13.33 * (grown.r[0] as number)).toBeCloseTo(16, 9);
  });

  it('other control text caps no running text, but still caps the rest', () => {
    // A fixed-size "Subscribe" button at 14 px beside 12 px running text
    // and a 12 px byline (another role).
    const button = { s: 14, unit: null, control: 'label' as const };
    const body = { s: 12, unit: 0, running: true };
    const byline = unit(12, 1);
    const regions = [{ points: [button, body, byline] }];
    const out = solveRanks({
      regions,
      want: [1.5, 1.5],
      c: 0.7,
      minGrowth: 0.06,
    });
    expect(12 * (out.r[0] as number)).toBeCloseTo(18, 9);
    expect(12 * (out.r[1] as number)).toBeCloseTo(14, 9);
    // A grown label caps no running text either.
    const grown = solveRanks({
      regions: [{ points: [{ ...button, unit: 1 }, body] }],
      want: [1.5, 1.05],
      held: new Set([1]),
      c: 0.7,
      minGrowth: 0,
    });
    expect(12 * (grown.r[0] as number)).toBeCloseTo(18, 9);
  });

  it('a point several texts share caps as the hardest of them, and headings stay above their text', () => {
    // An accordion heading is no control label (the caller never marks
    // one): held at 14 px, its 12 px text never passes it.
    const heading = { s: 14, unit: 0, heading: true };
    const desc = { s: 12, unit: 1, running: true };
    const out = solveRanks({
      regions: [
        { points: [heading, desc] },
        { points: [heading, desc], lift: true },
      ],
      want: [1, 1.5],
      held: new Set([0]),
      c: 0.7,
      minGrowth: 0.06,
    });
    expect(12 * (out.r[1] as number)).toBeCloseTo(14, 9);
  });

  it('rankRange skips glyphs, and labels for running text', () => {
    const points = [
      { s: 13.33, after: 13.33, fixed: true, control: 'glyph' as const },
      { s: 14, after: 14, fixed: true, control: 'label' as const },
      { s: 24, after: 24, fixed: true },
    ];
    expect(rankRange(12, points).hi).toBeCloseTo(14 / 12, 9);
    expect(rankRange(12, points, 0.5, true).hi).toBeCloseTo(24 / 12, 9);
    // A glyph that grew lifts nothing either.
    expect(
      rankRange(14, [{ s: 12, after: 16, fixed: false, control: 'glyph' }]).lo,
    ).toBe(1);
  });
});
