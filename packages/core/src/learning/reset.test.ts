import { describe, expect, it } from 'vitest';

import { defaultOpState } from './state';
import {
  forgetAllLearning,
  isLearnedKey,
  isUserLearningState,
  resetLearnedKey,
} from './reset';
import type { UserLearningState } from './types';

const DAY = 20_000;

function learned(): UserLearningState {
  return {
    v: 1,
    libVer: 'lib',
    priorRelease: 'prior',
    ops: {
      text_floor: {
        c: { s: 6, f: 1, t: DAY - 3 },
        src: 'profile',
        accepts: 2,
        askAfter: DAY + 4,
        dismissStreak: 1,
        offerCooldownUntil: DAY + 2,
        opVer: 1,
      },
      calm_motion: {
        c: { s: 0, f: 5, t: DAY - 1 },
        src: 'none',
        blocked: true,
        accepts: 0,
        askAfter: 0,
        dismissStreak: 3,
        offerCooldownUntil: 0,
        opVer: 1,
      },
      reading_guide: {
        c: { s: 4, f: 0, t: DAY - 1 },
        src: 'pinned',
        accepts: 3,
        askAfter: 0,
        dismissStreak: 0,
        offerCooldownUntil: 0,
        opVer: 1,
      },
    },
    dims: {
      textPx: { m: 3.2, v: 0.01, t: DAY - 2, mCal: 2.9, vCal: 0.05, floor: 16 },
      zoom: { m: 0.3, v: 0.02, t: DAY - 2, mCal: 0.1, vCal: 0.04 },
    },
    labels: {
      text_floor: { article: { s: 2, f: 0, t: DAY - 1 } },
      calm_motion: { article: { s: 0, f: 2, t: DAY - 1 } },
    },
    recentDeltaIds: ['d1', 'd2'],
  } as unknown as UserLearningState;
}

describe('isLearnedKey', () => {
  it('accepts op and dimension ids only', () => {
    expect(isLearnedKey('text_floor')).toBe(true);
    expect(isLearnedKey('clickWindowMs')).toBe(true);
    expect(isLearnedKey('textpx')).toBe(false);
    expect(isLearnedKey('__proto__')).toBe(false);
    expect(isLearnedKey(3)).toBe(false);
  });
});

describe('isUserLearningState', () => {
  it('checks the stored shape', () => {
    expect(isUserLearningState(learned())).toBe(true);
    expect(isUserLearningState({ v: 2, ops: {}, dims: {} })).toBe(false);
    expect(isUserLearningState(null)).toBe(false);
  });
});

describe('resetLearnedKey', () => {
  it('clears an op to its default state and keeps a source from the fit', () => {
    const before = learned();
    const after = resetLearnedKey(before, 'text_floor', DAY);
    expect(after.ops.text_floor).toEqual({
      ...defaultOpState('text_floor', DAY),
      src: 'profile',
    });
    expect(after.labels.text_floor).toBeUndefined();
    expect(after.labels.calm_motion).toBeDefined();
    // Other ops, the dimensions and the input are untouched.
    expect(after.ops.calm_motion).toEqual(before.ops.calm_motion);
    expect(after.dims).toEqual(before.dims);
    expect(before.ops.text_floor.c.s).toBe(6);
  });

  it('lifts a global block and a learned pin', () => {
    const state = learned();
    const blocked = resetLearnedKey(state, 'calm_motion', DAY).ops.calm_motion;
    expect(blocked.blocked).toBeUndefined();
    expect(blocked.c).toEqual({ s: 0, f: 0, t: DAY });
    expect(blocked.dismissStreak).toBe(0);
    const pinned = resetLearnedKey(state, 'reading_guide', DAY).ops
      .reading_guide;
    expect(pinned.src).toBe('none');
  });

  it('returns a dimension to its calibration mean and variance', () => {
    const after = resetLearnedKey(learned(), 'textPx', DAY);
    expect(after.dims.textPx).toEqual({
      m: 2.9,
      v: 0.05,
      t: DAY,
      mCal: 2.9,
      vCal: 0.05,
      floor: 16,
    });
    expect(after.dims.zoom.m).toBe(0.3);
    expect(after.ops).toEqual(learned().ops);
  });
});

describe('forgetAllLearning', () => {
  it('resets every op and dimension and keeps the delta ids', () => {
    const after = forgetAllLearning(learned(), DAY);
    expect(after.ops.text_floor.src).toBe('profile');
    expect(after.ops.text_floor.c).toEqual({ s: 0, f: 0, t: DAY });
    expect(after.ops.calm_motion.blocked).toBeUndefined();
    expect(after.ops.reading_guide.src).toBe('none');
    expect(after.dims.textPx.m).toBe(2.9);
    expect(after.dims.zoom).toEqual({
      m: 0.1,
      v: 0.04,
      t: DAY,
      mCal: 0.1,
      vCal: 0.04,
    });
    expect(after.labels).toEqual({});
    expect(after.recentDeltaIds).toEqual(['d1', 'd2']);
    expect(Object.keys(after.ops).sort()).toEqual(
      ['calm_motion', 'reading_guide', 'text_floor'].sort(),
    );
  });
});
