import { describe, expect, it } from 'vitest';

import { unionShare } from './layout';

const r = (left: number, top: number, w: number, h: number) => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
  width: w,
  height: h,
});

describe('unionShare (occlusion)', () => {
  it('is the covered share of the viewport, counting overlaps once', () => {
    expect(unionShare([], 1280, 800)).toBe(0);
    expect(unionShare([r(0, 0, 1280, 80)], 1280, 800)).toBeCloseTo(0.1, 2);
    // A header and a sidebar that overlap in the corner.
    const share = unionShare([r(0, 0, 1280, 80), r(0, 0, 160, 800)], 1280, 800);
    expect(share).toBeCloseTo(0.1 + 0.125 - (160 * 80) / (1280 * 800), 2);
    expect(
      unionShare([r(0, 0, 1280, 80), r(0, 0, 1280, 80)], 1280, 800),
    ).toBeCloseTo(0.1, 2);
  });

  it('clips to the viewport and caps at 1', () => {
    expect(unionShare([r(-500, -500, 4000, 4000)], 1280, 800)).toBe(1);
    expect(unionShare([r(0, 900, 1280, 100)], 1280, 800)).toBe(0);
  });
});
