import { describe, expect, it } from 'vitest';

import { summarizeFocus } from './focus';
import { seededRandom } from './pointing';
import { attentionSummarySchema } from './schema';
import type { FocusSession, SearchTrial } from './trials';

function search(
  clutter: SearchTrial['clutter'],
  motion: SearchTrial['motion'],
  rtMs: number,
  extra: Partial<SearchTrial> = {},
): SearchTrial {
  return {
    clutter,
    motion,
    rtMs,
    firstClickCorrect: true,
    timedOut: false,
    predictedMoveMs: 0,
    ...extra,
  };
}

/** Twelve yoked trials, 3 per cell, with multiplicative clutter and motion costs. */
function factorial(
  base: number,
  clutterCost: number,
  motionCost: number,
  moving: SearchTrial['motion'] = 'animated',
): SearchTrial[] {
  const jitter = [0.95, 1, 1.05];
  const out: SearchTrial[] = [];
  for (const clutter of ['clean', 'busy'] as const) {
    for (const motion of ['still', moving] as const) {
      for (const j of jitter) {
        const rt =
          base *
          j *
          (clutter === 'busy' ? clutterCost : 1) *
          (motion === 'still' ? 1 : motionCost);
        out.push(search(clutter, motion, rt));
      }
    }
  }
  return out;
}

function focusSession(extra: Partial<FocusSession> = {}): FocusSession {
  return {
    motionShown: true,
    stopMotionPressed: false,
    search: [],
    nextAction: [],
    findText: [],
    preferences: { still: null, clean: null, chunked: null, hierarchy: null },
    chips: [],
    durationSec: 80,
    ...extra,
  };
}

function hasNaN(value: unknown): boolean {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isFinite(v) ? 'NaN' : v,
  ).includes('"NaN"');
}

describe('summarizeFocus', () => {
  it('estimates clutter and motion as log time ratios with a pooled SE', () => {
    const s = summarizeFocus(
      focusSession({ search: factorial(3000, 1.3, 1.1) }),
    );
    expect(s.effects.clutter?.value).toBeCloseTo(Math.log(1.3), 2);
    expect(s.effects.motion?.value).toBeCloseTo(Math.log(1.1), 2);
    expect(s.effects.clutter?.n).toBe(12);
    // Pooled SD is floored at 0.30: SE = 0.30 * sqrt(1/6 + 1/6).
    expect(s.effects.clutter?.se).toBeCloseTo(0.3 * Math.sqrt(1 / 3), 3);
  });

  it('subtracts predicted movement time before taking logs', () => {
    const withMove = factorial(3000, 1.3, 1).map((t) => ({
      ...t,
      rtMs: t.rtMs + 800,
      predictedMoveMs: 800,
    }));
    const s = summarizeFocus(focusSession({ search: withMove }));
    expect(s.effects.clutter?.value).toBeCloseTo(Math.log(1.3), 2);
  });

  it('treats the static-salience factor as the moving side when motion is not shown', () => {
    const s = summarizeFocus(
      focusSession({
        motionShown: false,
        search: factorial(2500, 1, 1.4, 'salient'),
      }),
    );
    expect(s.motionShown).toBe(false);
    expect(s.effects.motion?.value).toBeCloseTo(Math.log(1.4), 2);
  });

  it('reports no evidence when more than a third of search trials are invalid', () => {
    const trials = factorial(3000, 1.3, 1.1).map((t, i) =>
      i % 2 === 0 ? { ...t, timedOut: true } : t,
    );
    const s = summarizeFocus(focusSession({ search: trials }));
    expect(s.effects.clutter).toBeNull();
    expect(s.effects.motion).toBeNull();
    expect(s.status).toBe('measured');
  });

  it('discards a single extreme trial as an outlier', () => {
    const trials = factorial(3000, 1, 1);
    trials[0] = { ...trials[0]!, rtMs: 11_900 };
    const s = summarizeFocus(focusSession({ search: trials }));
    expect(s.effects.clutter?.n).toBe(11);
    expect(Math.abs(s.effects.clutter?.value ?? 1)).toBeLessThan(0.05);
  });

  it('computes guidance, decoy capture and chunking with benefit-positive signs', () => {
    const s = summarizeFocus(
      focusSession({
        nextAction: [
          { hierarchy: 'weak', rtMs: 4000, firstClick: 'decoy' },
          { hierarchy: 'weak', rtMs: 4400, firstClick: 'target' },
          { hierarchy: 'strong', rtMs: 2000, firstClick: 'target' },
          { hierarchy: 'strong', rtMs: 2200, firstClick: 'target' },
        ],
        findText: [
          { format: 'dense', rtMs: 12_000, correct: true },
          { format: 'chunked', rtMs: 6000, correct: true },
        ],
      }),
    );
    expect(s.effects.guidance?.value).toBeCloseTo(Math.log(2), 1);
    expect(s.decoyCapture).toBe(0.5);
    expect(s.effects.chunking?.value).toBeCloseTo(Math.log(2), 3);
    expect(s.effects.chunking?.se).toBeCloseTo(0.2 * Math.SQRT2, 3);
  });

  it('keeps preferences in -2..2 and cleans up the chips', () => {
    const s = summarizeFocus(
      focusSession({
        preferences: { still: 2.4, clean: -3, chunked: 1.2, hierarchy: null },
        chips: ['moving', 'nothing', 'moving', 'busy'],
      }),
    );
    expect(s.preferences).toEqual({
      still: 2,
      clean: -2,
      chunked: 1,
      hierarchy: null,
    });
    expect(s.chips).toEqual(['moving', 'busy']);
    expect(summarizeFocus(focusSession({ chips: ['nothing'] })).chips).toEqual([
      'nothing',
    ]);
  });

  it('marks an empty session as skipped', () => {
    const s = summarizeFocus(focusSession());
    expect(s.status).toBe('skipped');
    expect(() => attentionSummarySchema.parse(s)).not.toThrow();
  });

  it('always produces schema-valid, finite summaries (seeded fuzz)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = seededRandom(seed);
      const pick = <T>(xs: readonly T[]): T =>
        xs[Math.floor(random() * xs.length)] as T;
      const s = summarizeFocus(
        focusSession({
          motionShown: random() < 0.7,
          stopMotionPressed: random() < 0.2,
          search: Array.from({ length: Math.floor(16 * random()) }, () =>
            search(
              pick(['clean', 'busy'] as const),
              pick(['still', 'animated', 'salient'] as const),
              20_000 * random() - 500,
              {
                timedOut: random() < 0.1,
                predictedMoveMs: random() < 0.1 ? Number.NaN : 1500 * random(),
              },
            ),
          ),
          nextAction: Array.from({ length: Math.floor(6 * random()) }, () => ({
            hierarchy: pick(['weak', 'strong'] as const),
            rtMs: 10_000 * random(),
            firstClick: pick(['target', 'decoy', 'other'] as const),
          })),
          findText: Array.from({ length: Math.floor(4 * random()) }, () => ({
            format: pick(['dense', 'chunked'] as const),
            rtMs: 30_000 * random(),
            correct: random() < 0.8,
          })),
          preferences: {
            still: random() < 0.5 ? null : 6 * random() - 3,
            clean: random() < 0.5 ? null : 6 * random() - 3,
            chunked: random() < 0.5 ? null : Number.NaN,
            hierarchy: random() < 0.5 ? null : 6 * random() - 3,
          },
          chips: Array.from({ length: Math.floor(6 * random()) }, () =>
            pick([
              'moving',
              'busy',
              'long_text',
              'unclear_action',
              'nothing',
            ] as const),
          ),
          durationSec: 5000 * random(),
        }),
      );
      expect(() => attentionSummarySchema.parse(s)).not.toThrow();
      expect(hasNaN(s)).toBe(false);
    }
  });
});
