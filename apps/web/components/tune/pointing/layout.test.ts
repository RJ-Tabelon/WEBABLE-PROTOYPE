import { describe, expect, it } from 'vitest';

import {
  FIELD_PAD,
  fieldLayout,
  returnBlockTargets,
  ringBlockTargets,
  warmupTargets,
} from './layout';

describe('pointing layout', () => {
  it('uses the viewport ring size when the stage has room', () => {
    const layout = fieldLayout(656, { width: 1440, height: 900 }, 'pointer');
    expect(layout.mode).toBe('ring');
    expect(layout.diameter).toBe(252);
    expect(layout.heightPx).toBe(252 + 72 + 2 * FIELD_PAD);
  });

  it('shrinks the ring to the stage and switches to a pair below 120 px', () => {
    const phone = fieldLayout(358, { width: 390, height: 844 }, 'touch');
    expect(phone.mode).toBe('ring');
    expect(phone.diameter).toBe(120);
    const tiny = fieldLayout(200, { width: 320, height: 568 }, 'touch');
    expect(tiny.mode).toBe('pair');
  });

  it('keeps every target inside the stage', () => {
    for (const width of [300, 420, 656]) {
      const layout = fieldLayout(
        width,
        { width: 1280, height: 800 },
        'pointer',
      );
      for (const t of ringBlockTargets(layout, 72)) {
        expect(t.center.x - 36).toBeGreaterThanOrEqual(0);
        expect(t.center.x + 36).toBeLessThanOrEqual(width);
        expect(t.center.y - 36).toBeGreaterThanOrEqual(0);
        expect(t.center.y + 36).toBeLessThanOrEqual(layout.heightPx);
      }
    }
  });

  it('scores 9 of 10 ring presses and 5 of 6 return presses', () => {
    const layout = fieldLayout(656, { width: 1440, height: 900 }, 'pointer');
    const ring = ringBlockTargets(layout, 44);
    expect(ring).toHaveLength(10);
    expect(ring.filter((t) => t.scored)).toHaveLength(9);
    expect(returnBlockTargets(layout, 44).filter((t) => t.scored)).toHaveLength(
      5,
    );
    expect(warmupTargets(600, 200, 56).every((t) => !t.scored)).toBe(true);
  });
});
