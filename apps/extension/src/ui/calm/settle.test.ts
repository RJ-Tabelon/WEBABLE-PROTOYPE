// Round 10: when a laid-out group may take the place of the page's own words. Nothing the person is reading moves
// after the first 8 s or after they scroll, click or type: then only groups entirely off screen change.
import { describe, expect, it } from 'vitest';
import { ORDER_WAIT_MS, SETTLE_GRACE_MS, maySwitch, waitsForEarlier } from './settle';

const view = { top: 0, bottom: 800 };

describe('settle rule', () => {
  it('lets any group settle in during the first moments, before the person does anything', () => {
    expect(maySwitch({ sinceOpenMs: 2000, interacted: false, box: { top: 100, bottom: 400 }, view })).toBe(true);
    expect(maySwitch({ sinceOpenMs: SETTLE_GRACE_MS, interacted: false, box: { top: 100, bottom: 400 }, view })).toBe(true);
  });

  it('never changes a group on screen once the person interacted or the first moments passed', () => {
    expect(maySwitch({ sinceOpenMs: 1000, interacted: true, box: { top: 100, bottom: 400 }, view })).toBe(false);
    expect(maySwitch({ sinceOpenMs: SETTLE_GRACE_MS + 1, interacted: false, box: { top: 100, bottom: 400 }, view })).toBe(false);
    // Partly on screen counts as on screen.
    expect(maySwitch({ sinceOpenMs: 20_000, interacted: true, box: { top: -50, bottom: 10 }, view })).toBe(false);
    expect(maySwitch({ sinceOpenMs: 20_000, interacted: true, box: { top: 790, bottom: 1200 }, view })).toBe(false);
  });

  it('changes a group entirely off screen, above or below, at any time', () => {
    expect(maySwitch({ sinceOpenMs: 20_000, interacted: true, box: { top: 900, bottom: 1400 }, view })).toBe(true);
    expect(maySwitch({ sinceOpenMs: 20_000, interacted: true, box: { top: -600, bottom: 0 }, view })).toBe(true);
    // Not laid out (inside something closed): nothing on screen moves.
    expect(maySwitch({ sinceOpenMs: 20_000, interacted: true, box: null, view })).toBe(true);
  });

  it('settles top to bottom in the first moments, waiting only a little for a group above', () => {
    expect(waitsForEarlier({ inGrace: true, earlierWaiting: true, readyForMs: 100 })).toBe(true);
    expect(waitsForEarlier({ inGrace: true, earlierWaiting: true, readyForMs: ORDER_WAIT_MS })).toBe(false);
    expect(waitsForEarlier({ inGrace: true, earlierWaiting: false, readyForMs: 0 })).toBe(false);
    expect(waitsForEarlier({ inGrace: false, earlierWaiting: true, readyForMs: 0 })).toBe(false);
  });
});
