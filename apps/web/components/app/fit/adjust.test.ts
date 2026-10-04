import {
  defaultFitProfile,
  type FitProfile,
  fitProfileSchema,
} from '@webable/core';
import { type FitRowId, fitRows } from '@webable/core/profile/describe';
import { describe, expect, it } from 'vitest';

import { copyProblems } from '../../../lib/auth/copy-lint';
import {
  adjustInputSchema,
  applyAdjustment,
  applyMeasured,
  applyValue,
  busyChoice,
  choiceFromValue,
  copyRow,
  currentValue,
  describeValue,
  editorFor,
  measuredAlternative,
  motionChoice,
  stepsWith,
  valueFromChoice,
  valueFromSlider,
} from './adjust';

const NOW = new Date('2026-09-29T12:00:00Z');

/** A measured profile, as Tune would save it. */
function measuredProfile(): FitProfile {
  const p = defaultFitProfile(undefined, NOW);
  p.modules = { reading: 'measured', pointing: 'measured', focus: 'measured' };
  p.vision.textMinPx = {
    value: 19,
    source: 'measured',
    confidence: 0.8,
    measured: 19,
  };
  p.vision.lineHeight = {
    value: 1.6,
    source: 'measured',
    confidence: 0.6,
    measured: 1.6,
  };
  p.motor.minTargetPx = {
    value: 44,
    source: 'measured',
    confidence: 0.7,
    measured: 44,
  };
  p.attention.distraction = {
    mean: 0.6,
    sd: 0.2,
    confidence: 0.5,
    sources: ['behavior'],
  };
  p.confidence = 0.7;
  return p;
}

function row(profile: FitProfile, id: FitRowId) {
  const found = fitRows(profile, undefined, { now: NOW }).find(
    (r) => r.id === id,
  );
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

describe('applyValue', () => {
  it('overrides a parameter and keeps the measurement', () => {
    const before = measuredProfile();
    const after = applyValue(before, { row: 'textSize', value: 24 });
    expect(after.vision.textMinPx).toEqual({
      value: 24,
      source: 'override',
      confidence: 0.8,
      measured: 19,
      override: 24,
    });
    expect(before.vision.textMinPx.value).toBe(19); // not mutated
    expect(row(after, 'textSize')).toMatchObject({
      after: '24\u00a0px',
      source: 'Set by you',
    });
    expect(fitProfileSchema.safeParse(after).success).toBe(true);
  });

  it('writes every row so that its fit row shows the chosen value', () => {
    const cases: Array<[Parameters<typeof applyValue>[1], string]> = [
      [{ row: 'contrast', value: 7 }, '7:1'],
      [{ row: 'contrast', value: 21 }, 'Maximum'],
      [{ row: 'polarity', value: 'dark' }, 'Dark'],
      [{ row: 'lineSpacing', value: 1.8 }, '1.8'],
      [{ row: 'lineLength', value: 62 }, '62\u00a0characters'],
      [{ row: 'targets', value: 56 }, '56\u00a0px'],
      [{ row: 'steadyClicks', value: true }, 'On'],
      [{ row: 'hoverGrace', value: 400 }, '400\u00a0ms'],
      [{ row: 'motion', value: 'paused' }, 'Paused'],
      [{ row: 'motion', value: 'plays' }, 'Plays'],
      [{ row: 'busyPages', value: 'simplified' }, 'Simplified'],
      [{ row: 'busyPages', value: 'ask' }, 'Ask first'],
      [{ row: 'busyPages', value: 'unchanged' }, 'Unchanged'],
    ];
    for (const [change, shown] of cases) {
      const after = applyValue(measuredProfile(), change);
      expect(fitProfileSchema.safeParse(after).success, change.row).toBe(true);
      const r = row(after, change.row);
      expect(r.after, `${change.row} ${String(change.value)}`).toBe(shown);
      expect(r.source, change.row).toBe('Set by you');
    }
  });

  it('can ask first on busy pages even when dense layouts were measured', () => {
    const p = measuredProfile();
    p.attention.density = {
      mean: 0.8,
      sd: 0.1,
      confidence: 0.6,
      sources: ['behavior'],
    };
    expect(busyChoice(p)).toBe('simplified');
    const after = applyValue(p, { row: 'busyPages', value: 'ask' });
    expect(busyChoice(after)).toBe('ask');
    expect(after.attention.density.sources).toContain('override');
  });

  it('keeps latent sources bounded and marks the override once', () => {
    const p = measuredProfile();
    p.attention.motion.sources = [
      'behavior',
      'preference',
      'system',
      'chips',
      'learned',
      'override',
    ];
    const after = applyValue(
      applyValue(p, { row: 'motion', value: 'paused' }),
      {
        row: 'motion',
        value: 'plays',
      },
    );
    expect(after.attention.motion.sources.length).toBeLessThanOrEqual(6);
    expect(
      after.attention.motion.sources.filter((s) => s === 'override'),
    ).toHaveLength(1);
    expect(motionChoice(after)).toBe('plays');
  });
});

describe('applyMeasured', () => {
  it('restores the measured value and drops the override', () => {
    const overridden = applyValue(measuredProfile(), {
      row: 'textSize',
      value: 28,
    });
    expect(measuredAlternative(overridden, 'textSize')).toBe('19\u00a0px');
    const back = applyMeasured(overridden, 'textSize');
    expect(back.vision.textMinPx).toEqual({
      value: 19,
      source: 'measured',
      confidence: 0.8,
      measured: 19,
    });
    expect(measuredAlternative(back, 'textSize')).toBeNull();
  });

  it('is a no-op without a measurement', () => {
    const p = applyValue(defaultFitProfile(undefined, NOW), {
      row: 'contrast',
      value: 7,
    });
    expect(measuredAlternative(p, 'contrast')).toBeNull();
    expect(applyMeasured(p, 'contrast').vision.contrastFloor).toEqual(
      p.vision.contrastFloor,
    );
  });

  it('works through applyAdjustment', () => {
    const p = applyValue(measuredProfile(), { row: 'targets', value: 72 });
    const back = applyAdjustment(p, { kind: 'measured', row: 'targets' });
    expect(back.motor.minTargetPx.value).toBe(44);
  });
});

describe('copyRow', () => {
  it('copies exactly one row back from an earlier version', () => {
    const v1 = measuredProfile();
    const v2 = applyValue(applyValue(v1, { row: 'textSize', value: 24 }), {
      row: 'targets',
      value: 56,
    });
    const undone = copyRow(v2, v1, 'textSize');
    expect(undone.vision.textMinPx).toEqual(v1.vision.textMinPx);
    expect(undone.motor.minTargetPx.value).toBe(56);
  });

  it('copies both attention dimensions for busy pages', () => {
    const v1 = measuredProfile();
    const v2 = applyValue(v1, { row: 'busyPages', value: 'unchanged' });
    expect(copyRow(v2, v1, 'busyPages').attention.distraction).toEqual(
      v1.attention.distraction,
    );
  });
});

describe('editor', () => {
  it('always includes the current value in slider steps', () => {
    expect(stepsWith([16, 18, 21], 19)).toEqual([16, 18, 19, 21]);
    const p = measuredProfile();
    const spec = editorFor('textSize', currentValue(p, 'textSize'));
    expect(spec.control === 'slider' && spec.steps).toContain(19);
  });

  it('round-trips choices and slider values', () => {
    const p = measuredProfile();
    for (const id of [
      'contrast',
      'polarity',
      'steadyClicks',
      'motion',
      'busyPages',
    ] as const) {
      const value = currentValue(p, id);
      expect(valueFromChoice(id, choiceFromValue(value))).toEqual(value);
    }
    expect(valueFromSlider('textSize', 21)).toEqual({
      row: 'textSize',
      value: 21,
    });
    expect(valueFromSlider('targets', 50)).toBeNull();
    expect(valueFromChoice('contrast', '5')).toBeNull();
  });

  it('explains why motion cannot play when the device asks for less', () => {
    const p = defaultFitProfile(
      { ...defaultSignals(), reducedMotion: true },
      NOW,
    );
    const spec = editorFor('motion', currentValue(p, 'motion'), {
      systemReducedMotion: p.attention.systemReducedMotion,
    });
    expect(spec.control).toBe('choice');
    if (spec.control !== 'choice') return;
    const plays = spec.options.find((o) => o.value === 'plays');
    expect(plays?.disabledReason).toBeTruthy();
    expect(copyProblems(plays?.disabledReason ?? '')).toEqual([]);
  });

  it('describes values with units', () => {
    expect(describeValue('textSize', 19)).toBe('19\u00a0px');
    expect(describeValue('contrast', 21)).toBe('Maximum');
    expect(describeValue('steadyClicks', { on: true })).toBe('On');
  });
});

describe('adjustInputSchema', () => {
  it('accepts valid input and rejects out-of-range or unknown fields', () => {
    expect(
      adjustInputSchema.safeParse({
        kind: 'set',
        change: { row: 'textSize', value: 21 },
      }).success,
    ).toBe(true);
    expect(
      adjustInputSchema.safeParse({
        kind: 'set',
        change: { row: 'textSize', value: 200 },
      }).success,
    ).toBe(false);
    expect(
      adjustInputSchema.safeParse({
        kind: 'set',
        change: { row: 'targets', value: 50 },
      }).success,
    ).toBe(false);
    expect(
      adjustInputSchema.safeParse({ kind: 'measured', row: 'motion' }).success,
    ).toBe(false);
    expect(
      adjustInputSchema.safeParse({
        kind: 'restore',
        row: 'textSize',
        fromVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      adjustInputSchema.safeParse({
        kind: 'set',
        change: { row: 'contrast', value: 7 },
        extra: true,
      }).success,
    ).toBe(false);
  });
});

function defaultSignals() {
  return {
    reducedMotion: false,
    colorScheme: 'light' as const,
    moreContrast: false,
    forcedColors: false,
    deviceClass: 'laptop' as const,
    input: 'mouse' as const,
  };
}
