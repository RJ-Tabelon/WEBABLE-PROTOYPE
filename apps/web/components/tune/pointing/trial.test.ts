import { describe, expect, it } from 'vitest';

import {
  buildPointerTrial,
  isHit,
  isRepeatPress,
  medianMoveMs,
  SampleBuffer,
  speedBefore,
  spreadP95,
} from './trial';

describe('pointer trials', () => {
  it('decides hit or miss by the press position against the circle', () => {
    expect(isHit({ x: 21, y: 0 }, { x: 0, y: 0 }, 44)).toBe(true);
    expect(isHit({ x: 23, y: 0 }, { x: 0, y: 0 }, 44)).toBe(false);
  });

  it('records a slip-off when the press is on the target and the release is not', () => {
    const samples = [
      { x: 0, y: 0, t: 950 },
      { x: 10, y: 0, t: 975 },
      { x: 20, y: 0, t: 1000 },
      { x: 30, y: 0, t: 1050 },
    ];
    const trial = buildPointerTrial(
      {
        targetPx: 24,
        targetCenter: { x: 20, y: 0 },
        start: { x: -200, y: 0 },
        tStart: 0,
        down: { x: 20, y: 0 },
        tDown: 1000,
        up: { x: 40, y: 0 },
        tUp: 1080,
        pointerType: 'mouse',
        scored: true,
      },
      samples,
    );
    expect(trial.hitDown).toBe(true);
    expect(trial.hitUp).toBe(false);
    expect(trial.pressMs).toBe(80);
    expect(trial.pressPathMaxPx).toBe(20);
    expect(trial.speedAtDown).toBeCloseTo(0.4, 2);
  });

  it('computes speed from the last 50 ms only', () => {
    expect(speedBefore([{ x: 0, y: 0, t: 0 }], 10)).toBe(0);
    expect(
      speedBefore(
        [
          { x: 0, y: 0, t: 0 },
          { x: 100, y: 0, t: 10 },
          { x: 100, y: 0, t: 60 },
          { x: 110, y: 0, t: 100 },
        ],
        100,
      ),
    ).toBeCloseTo(0.25, 2);
  });

  it('flags a quick second press nearby as a repeat', () => {
    const last = buildPointerTrial(
      {
        targetPx: 44,
        targetCenter: { x: 0, y: 0 },
        start: { x: 0, y: 0 },
        tStart: 0,
        down: { x: 1, y: 1 },
        tDown: 500,
        up: { x: 1, y: 1 },
        tUp: 600,
        pointerType: 'mouse',
        scored: true,
      },
      [],
    );
    expect(isRepeatPress(last, { x: 2, y: 2 }, 800).repeat).toBe(true);
    expect(isRepeatPress(last, { x: 200, y: 200 }, 800).repeat).toBe(false);
    expect(isRepeatPress(last, { x: 2, y: 2 }, 1200).repeat).toBe(false);
  });

  it('keeps a bounded sample buffer', () => {
    const buffer = new SampleBuffer(3);
    for (let i = 0; i < 10; i++) buffer.push({ x: i, y: 0, t: i });
    expect(buffer.size).toBe(3);
    expect(buffer.between(0, 100).map((s) => s.t)).toEqual([7, 8, 9]);
    buffer.push({ x: Number.NaN, y: 0, t: 11 });
    expect(buffer.size).toBe(3);
  });

  it('summarizes move time and spread', () => {
    expect(medianMoveMs([])).toBe(0);
    expect(spreadP95([])).toBe(0);
    expect(
      spreadP95([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toBe(1);
  });
});
