import { deriveFit } from '@webable/core';
import { describe, expect, it } from 'vitest';
import type { SiteTaskResult } from '../../../src/sitetask/types';
import { BlockWalk } from './pointing';
import { RawCollector, siteTrial } from './raw';
import { ladderPx, ladderStartPx, ladderStop, LADDER } from './read';
import { eyebrowFor, IN_THE_WAY, partSetLine, planSteps, wordsFor, type StepId } from './steps';

const BANNED = /\b(test|score|results?|normal|calibrat\w*|profile|fit|calm view|lens|jev)\b/i;
/** Round 8c: no pixels and no technical words in anything a person sees. */
const TECHNICAL = /\b(px|pixels?|contrast|ratio|target|threshold|settings? values?)\b|\d\s*:\s*1\b/i;

function site(over: Partial<SiteTaskResult> = {}): SiteTaskResult {
  return {
    id: 'cnn', name: 'CNN', busy: true, found: true, skipped: false, ms: 9000, wrongClicks: 0, nearMisses: 0, slips: 0,
    presses: 3, scrollScreens: 1, motionSeen: true, adsSeen: 5, ...over,
  };
}
const ALL: StepId[] = ['size', 'truefalse', 'faint', 'lightdark', 'dots', 'find'];

describe('words', () => {
  it('stay plain: no banned or technical words in any step', () => {
    for (const input of ['mouse', 'touch'] as const) {
      for (const s of ALL) {
        const w = wordsFor(s, input);
        for (const text of [w.title, w.todo, w.success]) {
          expect(text).not.toMatch(BANNED);
          expect(text).not.toMatch(TECHNICAL);
        }
      }
    }
    for (const c of IN_THE_WAY) expect(c.label).not.toMatch(BANNED);
  });

  it('uses the spec’s words for the real websites', () => {
    expect(wordsFor('find', 'mouse')).toEqual({
      title: 'Now, some real websites',
      todo: 'We’ll open three websites, one at a time. On each one, find what we ask for and click it.',
      success: 'WebAble stays off while you do this, so we see the web as it really is.',
    });
  });

  it('counts steps within a part, and a finished part is a neutral line', () => {
    expect(eyebrowFor('truefalse', ALL)).toBe('Reading · 2 of 4');
    expect(eyebrowFor('dots', ALL)).toBe('Pointing');
    expect(partSetLine('lightdark', 'dots')).toBe('Reading is done.');
    expect(partSetLine('size', 'truefalse')).toBeNull();
  });

  it('leaves out the dots for keyboard users and the colour steps under system colours', () => {
    expect(planSteps('keyboard', null)).not.toContain('dots');
    const forced = { forcedColors: true } as Parameters<typeof planSteps>[1];
    expect(planSteps('mouse', forced)).toEqual(['size', 'truefalse', 'dots', 'find', 'context']);
  });
});

describe('reading ladder', () => {
  it('starts a step above the comfortable size and goes 0.1 log down', () => {
    expect(ladderStartPx(20, null)).toBeCloseTo(25.2, 1);
    expect(ladderPx(25.2, 1)).toBeCloseTo(20, 0);
  });

  it('stops at two misses in a row, 9 sentences, or 35 s', () => {
    expect(ladderStop([{ correct: true }, { correct: false }], 1000, 15)).toBeNull();
    expect(ladderStop([{ correct: false }, { correct: false }], 1000, 15)).toBe('reversal');
    expect(ladderStop(Array.from({ length: 9 }, () => ({ correct: true })), 1000, 15)).toBe('max_trials');
    expect(ladderStop([{ correct: true }], LADDER.maxActiveMs, 15)).toBe('time');
  });
});

describe('dots walk', () => {
  const hit = { dx: 1, dy: 1, hit: true, slipped: false };
  const miss = { dx: 60, dy: 0, hit: false, slipped: false };

  it('goes down after clean blocks and stops after 3 blocks', () => {
    const w = new BlockWalk(false);
    w.press(hit); // positions the pointer
    for (let i = 0; i < 24; i++) w.press(hit);
    expect(w.done).toBe(true);
    expect(w.blocks.map((b) => b.sizePx)).toEqual([44, 32, 24]);
    expect(w.blocks.every((b) => b.presses.length === 8)).toBe(true);
  });

  it('stops at the first reversal', () => {
    const w = new BlockWalk(false);
    w.press(hit);
    for (let i = 0; i < 8; i++) w.press(hit);
    for (let i = 0; i < 8; i++) w.press(i < 3 ? miss : hit);
    expect(w.done).toBe(true);
    expect(w.stopReason).toBe('reversal');
  });
});

describe('real websites', () => {
  it('makes one trial per site the person tried', () => {
    expect(siteTrial(site())).toEqual({ clutter: true, motion: true, ms: 9000, found: true });
    expect(siteTrial(site({ found: false, ms: null, skipped: false }))).toMatchObject({ found: false });
    // Searched, then skipped: not found. Never loaded (or skipped untouched): no trial.
    expect(siteTrial(site({ found: false, ms: null, skipped: true, wrongClicks: 2 }))).toMatchObject({ found: false });
    expect(siteTrial(site({ found: false, ms: null, skipped: true, presses: 0, scrollScreens: 0 }))).toBeNull();
  });

  it('adds the sites to finding and every site press to allPresses', () => {
    const raw = new RawCollector();
    const n = raw.addSites([
      site({ id: 'wikipedia', name: 'Wikipedia', busy: false, ms: 5000, presses: 2, slips: 1, motionSeen: false }),
      site({ presses: 4, slips: 0 }),
      site({ id: 'allrecipes', name: 'Allrecipes', skipped: true, found: false, ms: null, presses: 0, scrollScreens: 0 }),
    ]);
    expect(n).toBe(2);
    raw.complete('find');
    const r = raw.toRaw();
    expect(r.finding?.trials).toEqual([
      { clutter: false, motion: false, ms: 5000, found: true },
      { clutter: true, motion: true, ms: 9000, found: true },
    ]);
    expect(r.allPresses).toHaveLength(6);
    expect(r.allPresses.filter((p) => p.slipped)).toHaveLength(1);
    expect(raw.sites).toHaveLength(3);
    raw.reset();
    expect(raw.sites).toEqual([]);
  });
});

describe('raw answers to settings', () => {
  it('carries the comfortable size and R4 into core', () => {
    const raw = new RawCollector();
    raw.seedPx = 22;
    raw.stated = 'dark';
    raw.lightMs.push(2100);
    raw.skippedSteps.add('light or dark');
    const r = raw.toRaw();
    expect(r.reading?.seedPx).toBe(22);
    expect(r.reading?.polarity.lightMs).toEqual([2100]);
    expect(r.skipped).toContain('light or dark');
    const fit = deriveFit(r);
    expect(fit.text.bodyPx).toBe(22);
    expect(fit.polarity.value).toBe('dark');
  });

  it('turns moving things and the calmer page into paused motion and simplified pages', () => {
    const raw = new RawCollector();
    raw.complete('find');
    raw.findTrials = [{ clutter: true, motion: true, ms: 4000, found: true }];
    raw.preferredCalm = 2;
    raw.notes = ['moving things'];
    const fit = deriveFit(raw.toRaw());
    expect(fit.attention.motion.on).toBe(true);
    expect(fit.attention.structureLevel).toBeGreaterThan(0);
  });
});
