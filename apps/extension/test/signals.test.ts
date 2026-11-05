import { describe, expect, it } from 'vitest';
import { DEMO_FITS, cusumWeights, gate, initialCusum, toSignals } from '@webable/core';
import {
  ActiveClock, Backtracker, PinchWatch, PointerTrail, SIG, ToggleHistory, ZoomWatch, gateCounts, isJudgment, isLostClick,
  longPauseThresholdMs, overlapRatio, parseZoom, progressBand, rectDistance, summarize, wordCount,
  type LiveFacts, type PressFacts, type SigEvent,
} from '../src/engine/signals';
import { isExcludedHost } from '../src/engine/hosts';

const live = (over: Partial<LiveFacts> = {}): LiveFacts => ({
  windowMs: 60_000,
  timeOnPageSec: 90,
  zoomLevel: 1,
  msSinceProgress: 0,
  pointingOff: false,
  ...over,
});

const act = (at: number, hit: 'near' | 'lost' | 'pinch' | null = null, reentries = 1): SigEvent =>
  ({ k: 'act', at, t: at, hit, reentries, sizePx: 28 });

describe('geometry', () => {
  it('measures point-to-rect distance, 0 inside', () => {
    const r = { left: 100, top: 100, right: 204, bottom: 128 };
    expect(rectDistance(150, 110, r)).toBe(0);
    expect(rectDistance(204, 128, r)).toBe(0);
    expect(rectDistance(90, 110, r)).toBe(10);
    expect(rectDistance(214, 138, r)).toBeCloseTo(Math.hypot(10, 10));
  });
  it('measures range overlap against the shorter range', () => {
    expect(overlapRatio([0, 100], [50, 150])).toBe(0.5);
    expect(overlapRatio([0, 100], [200, 300])).toBe(0);
    expect(overlapRatio([0, 400], [100, 200])).toBe(1);
  });
  it('counts words with letters or digits', () => {
    expect(wordCount('  Take 2 tablets — daily. ')).toBe(4);
    expect(wordCount('')).toBe(0);
  });
});

describe('P2 lost click', () => {
  const base: PressFacts = { distPx: 9, durMs: 180, releasedInside: false, selecting: false, dragCapable: false, pointerType: 'mouse' };
  it('fires for a 3-40 px slip off the control within 800 ms', () => {
    expect(isLostClick(base)).toBe(true);
    expect(isLostClick({ ...base, distPx: 3 })).toBe(true);
    expect(isLostClick({ ...base, distPx: 40 })).toBe(true);
    expect(isLostClick({ ...base, durMs: 800 })).toBe(true);
  });
  it('respects every guard', () => {
    expect(isLostClick({ ...base, distPx: 2.9 })).toBe(false);
    expect(isLostClick({ ...base, distPx: 41 })).toBe(false);
    expect(isLostClick({ ...base, durMs: 801 })).toBe(false);
    expect(isLostClick({ ...base, releasedInside: true })).toBe(false);
    expect(isLostClick({ ...base, selecting: true })).toBe(false);
    expect(isLostClick({ ...base, dragCapable: true })).toBe(false);
    expect(isLostClick({ ...base, pointerType: 'touch' })).toBe(false);
  });
});

describe('P5 re-entries over the movement segment', () => {
  const target = { left: 100, top: 100, right: 140, bottom: 120 };
  it('counts outside-to-inside transitions', () => {
    const tr = new PointerTrail();
    const path: Array<[number, number]> = [[50, 110], [90, 110], [110, 110], [145, 110], [120, 110], [150, 110], [125, 110]];
    path.forEach(([x, y], i) => tr.push(x, y, 1000 + i * 16));
    expect(tr.reentries(target, 0, 1200)).toBe(3);
  });
  it('starts the segment after the last click and after a 1 s pause', () => {
    const tr = new PointerTrail();
    tr.push(120, 110, 1000); // inside, before a 1 s pause: not in the segment
    tr.push(90, 110, 2100);
    tr.push(120, 110, 2116);
    expect(tr.reentries(target, 0, 2200)).toBe(1);
    expect(tr.segment(2110, 2200)).toHaveLength(1);
  });
  it('drops samples older than 3 s and wraps the ring buffer', () => {
    const tr = new PointerTrail(8);
    for (let i = 0; i < 20; i++) tr.push(i, 0, i * 10);
    expect(tr.segment(0, 200).length).toBe(8);
    expect(tr.segment(0, 200 + SIG.TRAIL_MS)).toHaveLength(0);
  });
});

describe('P4 toggles', () => {
  it('confirms an accidental double activation: two flips within 250 ms, set again within 2 s', () => {
    const h = new ToggleHistory();
    const a = h.click(0, 'off');
    expect(h.settle(a, 'on')).toBeNull();
    const b = h.click(120, 'on');
    expect(h.settle(b, 'off')).toBeNull();
    const c = h.click(1500, 'off');
    expect(h.settle(c, 'on')).toBe('double');
  });
  it('does not count two clicks more than 250 ms apart as a double', () => {
    const h = new ToggleHistory();
    h.settle(h.click(0, 'off'), 'on');
    h.settle(h.click(400, 'on'), 'off');
    const c = h.click(1200, 'off');
    expect(h.settle(c, 'on')).not.toBe('double');
  });
  it('notices a flip set back by a separate click within 2 s', () => {
    const h = new ToggleHistory();
    h.settle(h.click(0, 'aria-expanded=false'), 'aria-expanded=true');
    expect(h.settle(h.click(900, 'aria-expanded=true'), 'aria-expanded=false')).toBe('undone');
  });
  it('ignores ordinary use', () => {
    const h = new ToggleHistory();
    expect(h.settle(h.click(0, 'off'), 'on')).toBeNull();
    expect(h.settle(h.click(5000, 'on'), 'off')).toBeNull();
  });
});

describe('R2 / P9 pinch', () => {
  const noMedia = () => false;
  it('a pinch to 125% held 2 s and no tap within 3 s is a reading zoom', () => {
    const p = new PinchWatch();
    p.scale(1.3, 0, noMedia);
    p.scale(1.4, 500, noMedia);
    expect(p.tick(2000, 1.4)).toBeNull();
    expect(p.tick(3000, 1.4)).toEqual({ to: 1.4 });
  });
  it('a tap within 3 s makes it a pointing signal, not reading', () => {
    const p = new PinchWatch();
    p.scale(1.3, 0, noMedia);
    expect(p.tap(2500)).toBe(true);
    expect(p.tick(3000, 1.3)).toBeNull();
  });
  it('a pinch released before 2 s does not count', () => {
    const p = new PinchWatch();
    p.scale(1.3, 0, noMedia);
    p.scale(1.0, 1500, noMedia);
    expect(p.tick(3000, 1.0)).toBeNull();
  });
  it('never counts zooming into media, and re-arms only after zooming back out', () => {
    const p = new PinchWatch();
    p.scale(1.5, 0, () => true);
    expect(p.tick(3000, 1.5)).toBeNull();
    p.scale(1.5, 3100, noMedia);
    expect(p.tick(6200, 1.5)).toBeNull(); // still zoomed: not re-armed
    p.scale(1.0, 7000, noMedia);
    p.scale(1.3, 8000, noMedia);
    expect(p.tick(11_000, 1.3)).toEqual({ to: 1.3 });
  });
});

describe('R1 browser zoom', () => {
  it('counts a person-made zoom-in of >= 1.10 that holds 5 s', () => {
    const z = new ZoomWatch(1);
    z.hint(0);
    z.observe(1.1, 400);
    expect(z.pending).toBe(true);
    expect(z.tick(3000)).toBeNull();
    z.observe(1.1, 5400);
    expect(z.tick(5400)).toEqual({ from: 1, to: 1.1 });
    expect(z.ref).toBe(1.1);
  });
  it('ignores zoom changes nobody gestured for (WebAble set them)', () => {
    const z = new ZoomWatch(1);
    z.observe(1.25, 10_000);
    expect(z.pending).toBe(false);
    expect(z.ref).toBe(1.25);
  });
  it('accepts the background saying the person changed it', () => {
    const z = new ZoomWatch(1);
    z.observe(1.25, 10_000, true);
    expect(z.pending).toBe(true);
  });
  it('drops a zoom-in reverted within 5 s', () => {
    const z = new ZoomWatch(1);
    z.hint(0);
    z.observe(1.25, 300);
    z.observe(1, 2000);
    expect(z.pending).toBe(false);
    expect(z.tick(6000)).toBeNull();
  });
  it('does not count steps below 1.10', () => {
    const z = new ZoomWatch(1);
    z.hint(0);
    z.observe(1.05, 300);
    expect(z.pending).toBe(false);
  });
});

describe('R3 full re-read', () => {
  const scroll = (b: Backtracker, ys: number[], at0: number, step = 50): number => {
    let at = at0;
    for (const y of ys) {
      b.feed(y, at);
      at += step;
    }
    return at;
  };
  it('counts up >= 100 px, a return to >= start - 50 px and a 15 s stay', () => {
    const b = new Backtracker();
    let at = scroll(b, [0, 400, 800, 1000], 0);
    at = scroll(b, [950, 900, 850], at);
    at = scroll(b, [900, 960], at + 8000);
    expect(b.tick(at + 14_000)).toBeNull();
    expect(b.tick(at + 15_100)).toEqual([850, 1000]);
  });
  it('ignores short look-backs and returns that do not stay', () => {
    const b = new Backtracker();
    let at = scroll(b, [0, 1000, 950, 920, 1000], 0);
    expect(b.tick(at + 20_000)).toBeNull();
    at = scroll(b, [800, 700, 980], at + 20_000);
    at = scroll(b, [600], at + 5000); // went back up before the 15 s stay
    expect(b.tick(at + 20_000)).toBeNull();
  });
  it('drops upward jumps within 500 ms of a find, hash change or layout shift', () => {
    const b = new Backtracker();
    let at = scroll(b, [0, 1000], 0);
    b.guard(at);
    at = scroll(b, [600, 600], at + 100);
    at = scroll(b, [1000], at);
    expect(b.tick(at + 16_000)).toBeNull();
  });
});

describe('summarize (window counts)', () => {
  it('counts trials, near-misses, lost clicks and wobble', () => {
    const log: SigEvent[] = [act(1000), act(2000, 'near', 3), act(3000, 'near'), { k: 'lost', at: 3500, t: 3500 }, act(4000, 'lost'), act(5000, 'pinch')];
    const c = summarize(log, 0, 60_000, live());
    expect(c.clicks).toBe(5);
    expect(c.nearMissClicks).toBe(3);
    expect(c.lostClicks).toBe(1);
    expect(c.pathWobble).toBe(0.2);
    expect(c.windowMs).toBe(60_000);
  });
  it('drops trials within 10 s after a dead click (the CUSUM pause)', () => {
    const log: SigEvent[] = [act(1000, 'near'), { k: 'dead', at: 2000, t: 2000 }, act(2000), act(5000, 'near'), act(13_000, 'near')];
    const c = summarize(log, 0, 60_000, live());
    expect(c.deadClicks).toBe(1);
    expect(c.clicks).toBe(2);
    expect(c.nearMissClicks).toBe(2);
  });
  it('only counts events inside (fromAt, toAt]', () => {
    const log: SigEvent[] = [act(1000, 'near'), act(40_000, 'near'), act(70_000, 'near')];
    expect(summarize(log, 30_000, 60_000, live()).nearMissClicks).toBe(1);
    expect(summarize(log, 0, 1000, live()).nearMissClicks).toBe(1);
  });
  it('reports re-reads only when the same passage was re-read twice within 3 min', () => {
    const one: SigEvent[] = [{ k: 'reread', at: 10_000, t: 10_000, range: [800, 1000] }];
    expect(summarize(one, 0, 60_000, live()).scrollBacks).toBe(0);
    const twoDifferent: SigEvent[] = [...one, { k: 'reread', at: 40_000, t: 40_000, range: [3000, 3300] }];
    expect(summarize(twoDifferent, 0, 60_000, live()).scrollBacks).toBe(0);
    const samePassage: SigEvent[] = [{ k: 'reread', at: 10_000, t: 10_000, range: [800, 1000] }, { k: 'reread', at: 100_000, t: 100_000, range: [850, 1100] }];
    // the first re-read is outside this 60 s window but within 3 min of the second
    expect(summarize(samePassage, 70_000, 130_000, live()).scrollBacks).toBe(2);
    const tooFar: SigEvent[] = [{ k: 'reread', at: 10_000, t: 10_000, range: [800, 1000] }, { k: 'reread', at: 200_000, t: 200_000, range: [800, 1000] }];
    expect(summarize(tooFar, 150_000, 210_000, live()).scrollBacks).toBe(0);
  });
  it('counts hunting episodes (F1) in the window', () => {
    const log: SigEvent[] = [{ k: 'hunt', at: 25_000, t: 25_000 }, { k: 'hunt', at: 80_000, t: 80_000 }];
    expect(summarize(log, 0, 60_000, live()).hoverHunts).toBe(1);
    expect(summarize(log, 20_000, 80_000, live()).hoverHunts).toBe(2);
  });
  it('zeroes pointing counts on canvas, game and map pages', () => {
    const log: SigEvent[] = [act(1000, 'near', 3), { k: 'lost', at: 1500, t: 1500 }, { k: 'double', at: 2000, t: 2000 }];
    const c = summarize(log, 0, 60_000, live({ pointingOff: true }));
    expect([c.nearMissClicks, c.lostClicks, c.repeatClicks, c.pathWobble]).toEqual([0, 0, 0, 0]);
    expect(c.clicks).toBe(1);
  });
  it('fills every StruggleCounts field', () => {
    const log: SigEvent[] = [
      { k: 'zoom', at: 1, t: 1, from: 1, to: 1.25 }, { k: 'sideways', at: 2, t: 2 }, { k: 'pause', at: 3, t: 3, words: 40, ms: 30_000 },
      { k: 'select', at: 4, t: 4 }, { k: 'popup', at: 5, t: 5 }, { k: 'stuck', at: 6, t: 6, why: 'pause' },
      { k: 'correction', at: 7, t: 7 }, { k: 'undone', at: 8, t: 8 }, { k: 'double', at: 9, t: 9 },
    ];
    const c = summarize(log, 0, 60_000, live({ zoomLevel: 1.254, timeOnPageSec: 75.4 }));
    expect(c).toMatchObject({
      zoomInEvents: 1, sidewaysScrolls: 1, longPausesOnShortText: 1, textSelections: 1, popupsDismissed: 1,
      longFieldDwells: 1, typingCorrections: 1, wrongThenUndone: 1, repeatClicks: 1, zoomLevel: 1.25, timeOnPageSec: 75,
    });
  });
});

describe('small helpers', () => {
  it('long pause threshold is max(10 s, 2x reading time at 238 wpm)', () => {
    expect(longPauseThresholdMs(10)).toBe(10_000);
    expect(longPauseThresholdMs(80)).toBeCloseTo((80 / 238) * 60_000 * 2);
  });
  it('progress bands', () => {
    expect(progressBand(0, 25_000, 60_000)).toBe('none');
    expect(progressBand(0, 25_000, 10_000)).toBe('some');
    expect(progressBand(4, 3000, 60_000)).toBe('steady');
    expect(progressBand(1, 3000, 60_000)).toBe('some');
  });
  it('active clock pauses while the page is hidden or unfocused', () => {
    const c = new ActiveClock();
    c.set(true, 0);
    c.set(false, 1000);
    expect(c.at(5000)).toBe(1000);
    c.set(true, 6000);
    expect(c.at(6500)).toBe(1500);
  });
  it('parses zoom answers and judgments', () => {
    expect(parseZoom(1.25)).toBe(1.25);
    expect(parseZoom({ factor: 1.5, ours: null, personChanged: false })).toBe(1.5);
    expect(parseZoom({ nope: 1 })).toBeNull();
    expect(parseZoom(99)).toBeNull();
    expect(isJudgment({ level: 1.2, kinds: {}, metrics: {} })).toBe(true);
    expect(isJudgment({ level: '1' })).toBe(false);
  });
});

describe('excluded hosts', () => {
  it('matches mail, chat and banking sites, not ordinary ones', () => {
    expect(isExcludedHost('secure.chase.com')).toBe(true);
    expect(isExcludedHost('mail.google.com')).toBe(true);
    expect(isExcludedHost('127.0.0.1')).toBe(false);
    expect(isExcludedHost('www.drugs.com')).toBe(false);
  });
});

describe('with the real core gate and policy', () => {
  const fit = DEMO_FITS.typical;
  const runGate = (log: SigEvent[], times: number[]) => {
    let state = initialCusum();
    let last = 0;
    let out = { check: false, state, reason: '' };
    for (const at of times) {
      out = gate(state, gateCounts(log, last, at, live({ timeOnPageSec: at / 1000 })), fit);
      state = out.state;
      last = at;
    }
    return out;
  };

  it('two near-misses never make a pointing check; a third does (CUSUM >= 3.0)', () => {
    const log: SigEvent[] = [act(1000), act(3000, 'near'), act(5000), act(7000, 'near'), act(9000)];
    const g1 = runGate(log, [8000, 12_000, 20_000, 30_000, 45_000]);
    expect(g1.reason).not.toMatch(/pointing/);
    expect(g1.state.s).toBeLessThan(3);
    log.push(act(46_000, 'near'));
    const g2 = runGate(log, [8000, 12_000, 20_000, 30_000, 47_000]);
    expect(g2.check).toBe(true);
    expect(g2.reason).toMatch(/pointing/);
  });

  it('frequent gate runs over overlapping windows count each trial once', () => {
    const log: SigEvent[] = [act(1000, 'near'), act(2000), act(3000, 'near'), act(4000)];
    const g = runGate(log, [5000, 6000, 7000, 8000, 9000, 10_000, 20_000, 40_000, 59_000]);
    const w = cusumWeights(fit);
    expect(g.state.s).toBeCloseTo(2 * w.hit + 2 * w.clean, 5);
    expect(g.state.s).toBeLessThan(3);
  });

  it('a held zoom-in reaches Jev as a reading signal', () => {
    const log: SigEvent[] = [{ k: 'zoom', at: 30_000, t: 30_000, from: 1, to: 1.25 }];
    const c = summarize(log, 0, 40_000, live({ timeOnPageSec: 40, zoomLevel: 1.25 }));
    const g = gate(initialCusum(), c, fit);
    expect(g.check).toBe(true);
    const s = toSignals(c, fit, 'online store product page');
    expect(s.zoom_changes).toBe('1');
    expect(JSON.stringify(s)).not.toMatch(/tremor|disab|impair|condition/i);
  });
});
