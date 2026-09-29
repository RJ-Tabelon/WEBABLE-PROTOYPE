import { defaultFitProfile, fitProfileSchema } from '@webable/core';
import { fitRows } from '@webable/core/profile/describe';
import { describe, expect, it } from 'vitest';

import { adjustSpec, applyAdjustment, keepOldRows, TEXT_STEPS } from './adjust';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const base = () => defaultFitProfile(undefined, NOW);

function row(profile: ReturnType<typeof base>, id: string) {
  const r = fitRows(profile, undefined, { now: NOW }).find((x) => x.id === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
}

describe('applyAdjustment', () => {
  it('sets text size as an override and keeps the evidence', () => {
    const p = applyAdjustment(base(), 'textSize', 20);
    expect(p.vision.textMinPx).toMatchObject({
      value: 20,
      source: 'override',
      override: 20,
    });
    expect(row(p, 'textSize').after).toBe('20 px');
    expect(row(p, 'textSize').source).toBe('Set by you');
    expect(() => fitProfileSchema.parse(p)).not.toThrow();
  });

  it('ignores values outside the schema', () => {
    const p = base();
    expect(applyAdjustment(p, 'textSize', 400)).toBe(p);
    expect(applyAdjustment(p, 'targets', 50)).toBe(p);
    expect(applyAdjustment(p, 'contrast', '9')).toBe(p);
    expect(applyAdjustment(p, 'hoverGrace', 100)).toBe(p);
    expect(applyAdjustment(p, 'busyPages', 'loud')).toBe(p);
  });

  it('changes each row to what the person picked', () => {
    let p = base();
    p = applyAdjustment(p, 'contrast', '7');
    p = applyAdjustment(p, 'polarity', 'dark');
    p = applyAdjustment(p, 'lineSpacing', '1.8');
    p = applyAdjustment(p, 'lineLength', '60');
    p = applyAdjustment(p, 'targets', 56);
    p = applyAdjustment(p, 'steadyClicks', 'on');
    p = applyAdjustment(p, 'hoverGrace', '400');
    p = applyAdjustment(p, 'motion', 'paused');
    p = applyAdjustment(p, 'busyPages', 'simplified');
    expect(row(p, 'contrast').after).toBe('7:1');
    expect(row(p, 'polarity').after).toBe('Dark');
    expect(row(p, 'lineSpacing').after).toBe('1.8');
    expect(p.vision.wordSpacingEm.value).toBeGreaterThan(0);
    expect(row(p, 'lineLength').after).toBe('60 characters');
    expect(row(p, 'targets').after).toBe('56 px');
    expect(p.motor.targetSpacingPx.value).toBeGreaterThanOrEqual(56);
    expect(row(p, 'steadyClicks').after).toBe('On');
    expect(row(p, 'hoverGrace').after).toBe('400 ms');
    expect(row(p, 'motion').after).toBe('Paused');
    expect(row(p, 'busyPages').after).toBe('Simplified');
    for (const id of ['motion', 'busyPages'])
      expect(row(p, id).source).toBe('Set by you');
  });

  it('maps "Ask first" and "Unchanged" for busy pages', () => {
    expect(
      row(applyAdjustment(base(), 'busyPages', 'ask'), 'busyPages').after,
    ).toBe('Ask first');
    const back = applyAdjustment(
      applyAdjustment(base(), 'busyPages', 'simplified'),
      'busyPages',
      'unchanged',
    );
    expect(row(back, 'busyPages').after).toBe('Unchanged');
  });

  it('lets motion play again, unless the device asks for less motion', () => {
    const plays = applyAdjustment(
      applyAdjustment(base(), 'motion', 'paused'),
      'motion',
      'plays',
    );
    expect(row(plays, 'motion').after).toBe('Plays');
    const system = defaultFitProfile(
      { ...systemSignals(), reducedMotion: true },
      NOW,
    );
    expect(applyAdjustment(system, 'motion', 'plays')).toBe(system);
    expect(adjustSpec(system, 'motion').kind).toBe('note');
  });
});

function systemSignals() {
  return {
    reducedMotion: false,
    colorScheme: 'light' as const,
    moreContrast: false,
    forcedColors: false,
    deviceClass: 'laptop' as const,
    input: 'mouse' as const,
  };
}

describe('adjustSpec', () => {
  it('offers a stepper for sizes and a choice for everything else', () => {
    const p = base();
    const text = adjustSpec(p, 'textSize');
    expect(text.kind).toBe('stepper');
    if (text.kind === 'stepper') {
      expect(text.values).toBe(TEXT_STEPS);
      expect(text.current).toBe(16);
    }
    const targets = adjustSpec(p, 'targets');
    expect(targets.kind === 'stepper' && targets.values).toEqual([
      24, 32, 44, 56, 72, 96,
    ]);
    const contrast = adjustSpec(p, 'contrast');
    expect(contrast.kind === 'choice' && contrast.current).toBe('4.5');
    for (const id of [
      'polarity',
      'lineSpacing',
      'lineLength',
      'steadyClicks',
      'hoverGrace',
      'busyPages',
    ] as const) {
      const spec = adjustSpec(p, id);
      expect(spec.kind).toBe('choice');
      if (spec.kind === 'choice') {
        expect(spec.options.length).toBeGreaterThanOrEqual(2);
        expect(spec.options.length).toBeLessThanOrEqual(4);
        expect(spec.options.map((o) => o.value)).toContain(spec.current);
      }
    }
  });
});

describe('keepOldRows', () => {
  it('takes marked rows from the previous fit and leaves the rest new', () => {
    const previous = applyAdjustment(
      applyAdjustment(base(), 'targets', 56),
      'textSize',
      22,
    );
    const next = applyAdjustment(
      applyAdjustment(base(), 'targets', 44),
      'textSize',
      18,
    );
    const merged = keepOldRows(next, previous, new Set(['targets'] as const));
    expect(merged.motor.minTargetPx.value).toBe(56);
    expect(merged.vision.textMinPx.value).toBe(18);
    expect(keepOldRows(next, previous, new Set())).toBe(next);
  });
});
