import { defaultFitProfile, type FitProfile } from '@webable/core';
import { describe, expect, it } from 'vitest';

import { applyAdjustment } from './adjust';
import { overriddenRows, previousFitFor, rederivePending } from './previous';
import { buildRecord, deriveProfile } from './record';

const THEN = new Date('2026-09-12T12:00:00.000Z');
const NOW = new Date('2026-09-29T12:00:00.000Z');
const DEVICE = {
  class: 'laptop' as const,
  input: 'mouse' as const,
  dprBucket: 2,
  viewport: 'L' as const,
  reducedMotion: false,
  colorScheme: 'light' as const,
  moreContrast: false,
  forcedColors: false,
  rootFontPx: 16,
  zoom: 1,
};

/** The account's current fit: the person set text to 28 px and targets to 56 px. */
function current(): FitProfile {
  let p = defaultFitProfile(undefined, THEN);
  p = applyAdjustment(p, 'textSize', 28);
  p = applyAdjustment(p, 'targets', 56);
  return p;
}

/** A bare /tune: every part skipped, so nothing new was measured. */
function bareTune(previous: FitProfile | null) {
  return deriveProfile({
    device: DEVICE,
    modules: {},
    startedAt: NOW.toISOString(),
    completedAt: NOW.toISOString(),
    previous,
  });
}

describe('tuning again', () => {
  it('loads the current fit whenever someone signed in has one', async () => {
    const fit = { profile: current(), createdAt: THEN.toISOString() };
    const load = async () => ({ ok: true as const, data: fit });
    expect(await previousFitFor(true, load)).toEqual(fit);
    // Signed out, or no fit yet, or a failed read: no comparison, never a block.
    expect(await previousFitFor(false, load)).toBeNull();
    expect(
      await previousFitFor(true, async () => ({
        ok: true as const,
        data: null,
      })),
    ).toBeNull();
    expect(
      await previousFitFor(true, async () => {
        throw new Error('offline');
      }),
    ).toBeNull();
  });

  it('keeps what the person set through a bare /tune run', async () => {
    const previous = await previousFitFor(true, async () => ({
      ok: true as const,
      data: { profile: current(), createdAt: THEN.toISOString() },
    }));
    const { profile } = bareTune(previous?.profile ?? null);
    expect(profile.vision.textMinPx).toMatchObject({
      value: 28,
      source: 'override',
    });
    expect(profile.motor.minTargetPx).toMatchObject({
      value: 56,
      source: 'override',
    });
    // Without the current fit the same run would have erased both.
    const erased = bareTune(null).profile;
    expect(erased.vision.textMinPx.value).not.toBe(28);
    expect(erased.motor.minTargetPx.value).not.toBe(56);
  });

  it('finds the rows a fit holds a chosen value for', () => {
    expect([...overriddenRows(current())].sort()).toEqual([
      'targets',
      'textSize',
    ]);
    expect(overriddenRows(defaultFitProfile(undefined, NOW)).size).toBe(0);
  });

  it('derives a fit made signed out again against the account fit before saving', () => {
    const record = buildRecord({
      device: DEVICE,
      modules: {},
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
    });
    // In that Tune the person adjusted targets to 72 px on Your fit.
    const made = applyAdjustment(bareTune(null).profile, 'targets', 72);
    const saved = rederivePending({ profile: made, record }, current(), NOW);
    // The earlier text size survives; the newer choice wins where both exist.
    expect(saved.vision.textMinPx.value).toBe(28);
    expect(saved.motor.minTargetPx.value).toBe(72);
  });
});
