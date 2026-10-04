import type {
  PointerBlock,
  PointerTrial,
  ReadingTrial,
  SearchTrial,
} from '@webable/core';
import { describe, expect, it } from 'vitest';

import {
  initialTuneState,
  minutesLeft,
  progressOf,
  stashOf,
  tuneReducer,
  type TuneAction,
  type TuneState,
} from './machine';
import type { Setup } from './steps';

const SETUP: Setup = {
  input: 'mouse',
  assistive: 'none',
  reducedMotion: false,
  forcedColors: false,
  recalibrate: false,
};

function run(state: TuneState, ...actions: TuneAction[]): TuneState {
  return actions.reduce(tuneReducer, state);
}

function begin(setup: Partial<Setup> = {}, now = 0): TuneState {
  return run(initialTuneState(), {
    type: 'begin',
    setup: { ...SETUP, ...setup },
    startedAt: '2026-09-29T12:00:00.000Z',
    rootFontPx: 16,
    now,
  });
}

function sentence(fontPx: number, rtMs: number, correct = true): ReadingTrial {
  return {
    fontPx,
    xHeightPx: fontPx * 0.52,
    words: 10,
    response: correct ? 'true' : 'cant',
    correct,
    rtMs,
    disturbed: false,
  };
}

const LADDER: ReadingTrial[] = [
  sentence(48, 3000),
  sentence(48, 2600),
  sentence(30, 2600),
  sentence(19, 2700),
  sentence(12, 3000),
  sentence(7.6, 6000),
  sentence(4.8, 9000, false),
];

function press(i: number, targetPx: number, hit = true): PointerTrial {
  const center = { x: 100 * Math.cos(i), y: 100 * Math.sin(i) };
  const offset = hit ? 2 : targetPx;
  return {
    targetPx,
    targetCenter: center,
    start: { x: 0, y: 0 },
    tStart: i * 1000,
    tDown: i * 1000 + 600,
    tUp: i * 1000 + 700,
    down: { x: center.x + offset, y: center.y },
    up: { x: center.x + offset, y: center.y },
    hitDown: hit,
    hitUp: hit,
    pressMs: 100,
    pressPathMaxPx: 0,
    speedAtDown: 0.2,
    extraPresses: [],
    pointerType: 'mouse',
    scored: i > 0,
  };
}

function block(targetPx: number, misses = 0): PointerBlock {
  return {
    targetPx,
    trials: Array.from({ length: 10 }, (_v, i) =>
      press(i, targetPx, i === 0 || i > misses),
    ),
  };
}

function readingThrough(state: TuneState, forced = false): TuneState {
  let s = run(
    state,
    {
      type: 'reading/comfort',
      step: 'reading.comfort',
      comfortPx: 24,
      referenceXHeightRatio: 0.52,
      now: 10_000,
    },
    {
      type: 'reading/ladder',
      step: 'reading.ladder',
      trials: LADDER,
      displayLimited: false,
      now: 40_000,
    },
  );
  if (!forced) {
    s = run(
      s,
      {
        type: 'reading/contrast',
        step: 'reading.contrast',
        trials: [
          { weber: 0.5, correct: true, cantSee: false },
          { weber: 0.1, correct: true, cantSee: false },
          { weber: 0.03, correct: false, cantSee: true },
        ],
        now: 55_000,
      },
      {
        type: 'reading/polarity',
        step: 'reading.polarity',
        trials: [],
        stated: 'same',
        now: 70_000,
      },
    );
  }
  return run(s, {
    type: 'reading/preview',
    step: 'reading.preview',
    overrides: {},
    now: 80_000,
  });
}

describe('tuneReducer: starting', () => {
  it('opens on the intro, or on resume when a saved Tune exists', () => {
    expect(initialTuneState().step).toBe('intro');
    expect(initialTuneState({ hasStash: true }).step).toBe('resume');
  });

  it('begins with the comfortable-size screen and starts the reading clock', () => {
    const s = begin({}, 5);
    expect(s.step).toBe('reading.comfort');
    expect(s.setup?.input).toBe('mouse');
    expect(s.moduleStartMs.reading).toBe(5);
    expect(s.startedAt).toBe('2026-09-29T12:00:00.000Z');
  });

  it('ignores begin outside the intro', () => {
    const s = begin();
    expect(
      run(s, {
        type: 'begin',
        setup: SETUP,
        startedAt: 'x',
        rootFontPx: 16,
        now: 1,
      }),
    ).toBe(s);
  });
});

describe('tuneReducer: reading', () => {
  it('walks every reading screen, then summarizes and drops the raw trials', () => {
    const s = readingThrough(begin());
    expect(s.step).toBe('before.pointing');
    expect(s.outcomes.reading).toBe('done');
    expect(s.summaries.reading?.status).toBe('measured');
    expect(s.summaries.reading?.comfortPx).toBe(24);
    expect(s.summaries.reading?.durationSec).toBe(80);
    expect(s.reading.ladder).toEqual([]);
    expect(s.moduleStartMs.pointing).toBe(80_000);
  });

  it('skips contrast and light/dark under forced colors', () => {
    let s = begin({ forcedColors: true });
    s = run(
      s,
      {
        type: 'reading/comfort',
        step: 'reading.comfort',
        comfortPx: 20,
        referenceXHeightRatio: 0.5,
        now: 1,
      },
      {
        type: 'reading/ladder',
        step: 'reading.ladder',
        trials: LADDER,
        displayLimited: false,
        now: 2,
      },
    );
    expect(s.step).toBe('reading.preview');
  });

  it('ignores an action from a screen that is no longer showing', () => {
    const s = begin();
    const stale = run(s, {
      type: 'reading/ladder',
      step: 'reading.ladder',
      trials: LADDER,
      displayLimited: false,
      now: 1,
    });
    expect(stale).toBe(s);
  });
});

describe('tuneReducer: routes', () => {
  it('routes screen-reader users past the visual tasks to the one question', () => {
    let s = begin({ assistive: 'screen-reader', input: 'keyboard' });
    expect(s.step).toBe('sr-route');
    s = run(s, { type: 'continue', step: 'sr-route', now: 1 });
    expect(s.step).toBe('pointing.keyboard');
    expect(s.summaries.reading?.status).toBe('skipped');
    expect(s.outcomes.reading).toBe('skipped');
    s = run(s, { type: 'continue', step: 'pointing.keyboard', now: 2 });
    expect(s.step).toBe('before.focus');
    expect(s.summaries.pointing?.status).toBe('skipped');
    expect(s.summaries.pointing?.input).toBe('keyboard');
    s = run(s, { type: 'continue', step: 'before.focus', now: 3 });
    expect(s.step).toBe('focus.chips');
    s = run(s, {
      type: 'focus/chips',
      step: 'focus.chips',
      chips: ['moving'],
      now: 4,
    });
    expect(s.step).toBe('fit');
    expect(s.summaries.focus?.chips).toEqual(['moving']);
    expect(s.summaries.focus?.status).toBe('measured');
  });

  it('shows keyboard users a note instead of the pointing tasks', () => {
    const s = readingThrough(begin({ input: 'keyboard' }));
    expect(s.step).toBe('pointing.keyboard');
  });

  it('skips drag and the return block in express mode', () => {
    let s = readingThrough(begin());
    s = run(
      s,
      { type: 'continue', step: 'before.pointing', now: 81_000 },
      { type: 'continue', step: 'pointing.warmup', now: 85_000 },
      {
        type: 'pointing/ring',
        step: 'pointing.ring',
        blocks: [block(44), block(32)],
        express: true,
        now: 120_000,
      },
      { type: 'pointing/hold', step: 'pointing.hold', holds: [], now: 130_000 },
    );
    expect(s.step).toBe('pointing.preview');
  });

  it('drops the return block once pointing has run past 150 s', () => {
    let s = readingThrough(begin());
    s = run(
      s,
      { type: 'continue', step: 'before.pointing', now: 81_000 },
      { type: 'continue', step: 'pointing.warmup', now: 85_000 },
      {
        type: 'pointing/ring',
        step: 'pointing.ring',
        blocks: [block(44), block(32), block(24, 4)],
        express: false,
        now: 200_000,
      },
      { type: 'pointing/hold', step: 'pointing.hold', holds: [], now: 210_000 },
      {
        type: 'pointing/drag',
        step: 'pointing.drag',
        drags: 'skipped',
        now: 240_000,
      },
    );
    expect(s.step).toBe('pointing.preview');
  });

  it('summarizes pointing with the chosen size when it ends', () => {
    let s = readingThrough(begin());
    s = run(
      s,
      { type: 'continue', step: 'before.pointing', now: 81_000 },
      { type: 'continue', step: 'pointing.warmup', now: 82_000 },
      {
        type: 'pointing/ring',
        step: 'pointing.ring',
        blocks: [block(44), block(32), block(24, 4)],
        express: false,
        now: 100_000,
      },
      { type: 'pointing/hold', step: 'pointing.hold', holds: [], now: 105_000 },
      {
        type: 'pointing/drag',
        step: 'pointing.drag',
        drags: 'skipped',
        now: 110_000,
      },
      {
        type: 'pointing/return',
        step: 'pointing.return',
        block: block(44),
        now: 115_000,
      },
      {
        type: 'pointing/preview',
        step: 'pointing.preview',
        chosenPx: 44,
        now: 120_000,
      },
    );
    expect(s.step).toBe('before.focus');
    expect(s.summaries.pointing?.status).toBe('measured');
    expect(s.summaries.pointing?.chosenPx).toBe(44);
    expect(s.summaries.pointing?.drag?.skipped).toBe(true);
    expect(s.pointing.blocks).toEqual([]);
  });
});

describe('tuneReducer: skip and pause', () => {
  it('skips the rest of a part without penalty and keeps what was answered', () => {
    let s = begin();
    s = run(
      s,
      {
        type: 'reading/comfort',
        step: 'reading.comfort',
        comfortPx: 30,
        referenceXHeightRatio: 0.52,
        now: 1000,
      },
      { type: 'skipPart', step: 'reading.ladder', now: 2000 },
    );
    expect(s.step).toBe('before.pointing');
    expect(s.outcomes.reading).toBe('skipped');
    expect(s.summaries.reading?.comfortPx).toBe(30);
  });

  it('pauses only on task screens and bumps the epoch on resume', () => {
    expect(run(initialTuneState(), { type: 'pause' }).paused).toBe(false);
    let s = run(begin(), { type: 'pause' });
    expect(s.paused).toBe(true);
    s = run(s, { type: 'unpause' });
    expect(s.paused).toBe(false);
    expect(s.pauseEpoch).toBe(1);
  });
});

describe('tuneReducer: focus to fit', () => {
  it('collects every focus task and ends on Your fit, then done', () => {
    let s = begin({ input: 'keyboard' });
    s = readingThrough(s);
    s = run(
      s,
      { type: 'continue', step: 'pointing.keyboard', now: 90_000 },
      { type: 'continue', step: 'before.focus', now: 91_000 },
    );
    expect(s.step).toBe('focus.search');
    const search: SearchTrial[] = Array.from({ length: 12 }, (_v, i) => ({
      clutter: i % 2 ? 'busy' : 'clean',
      motion: i % 4 < 2 ? 'still' : 'animated',
      rtMs: 2000 + i * 50,
      firstClickCorrect: true,
      timedOut: false,
      predictedMoveMs: 0,
    }));
    s = run(
      s,
      {
        type: 'focus/search',
        step: 'focus.search',
        trials: search,
        motionShown: true,
        stopMotionPressed: false,
        now: 130_000,
      },
      {
        type: 'focus/next',
        step: 'focus.next',
        trials: [
          { hierarchy: 'weak', rtMs: 2500, firstClick: 'decoy' },
          { hierarchy: 'strong', rtMs: 1500, firstClick: 'target' },
        ],
        now: 140_000,
      },
      {
        type: 'focus/text',
        step: 'focus.text',
        trials: [
          { format: 'dense', rtMs: 9000, correct: true },
          { format: 'chunked', rtMs: 6000, correct: true },
        ],
        now: 160_000,
      },
      {
        type: 'focus/prefs',
        step: 'focus.prefs',
        preferences: { still: 1, clean: 2, chunked: 1, hierarchy: 0 },
        now: 170_000,
      },
      {
        type: 'focus/chips',
        step: 'focus.chips',
        chips: ['busy'],
        now: 175_000,
      },
    );
    expect(s.step).toBe('fit');
    expect(s.summaries.focus?.effects.chunking).not.toBeNull();
    expect(s.summaries.focus?.preferences.clean).toBe(2);
    expect(s.outcomes).toEqual({
      reading: 'done',
      pointing: 'done',
      focus: 'done',
    });
    expect(progressOf(s, 175_000).section).toBe(3);
    s = run(s, { type: 'saved' });
    expect(s.step).toBe('done');
  });
});

describe('progress', () => {
  it('reads as "Part n of 3 · Module · about n min left" with no clock', () => {
    const s = begin();
    const p = progressOf(s, 0);
    expect(p.section).toBe(0);
    expect(p.taskIndex).toBe(0);
    expect(p.text).toMatch(/^Part 1 of 3 · Reading · about \d+\u00a0min left$/);
    expect(p.text).not.toMatch(/%|:\d\d/);
    // Narrow screens show the time alone; the full line stays the accessible source.
    expect(p.short).toMatch(/^About \d+ min left$/);
    expect(progressOf(initialTuneState(), 0).short).toBeNull();
  });

  it('counts down as screens pass and never drops below 1', () => {
    const start = begin();
    const later = readingThrough(start);
    expect(minutesLeft(later, 80_000)).toBeLessThan(minutesLeft(start, 0));
    const s = begin({ assistive: 'screen-reader', input: 'keyboard' });
    expect(minutesLeft(s, 0)).toBeGreaterThanOrEqual(1);
  });

  it('places the ruler dot by tasks done in the section', () => {
    const s = run(begin(), {
      type: 'reading/comfort',
      step: 'reading.comfort',
      comfortPx: 24,
      referenceXHeightRatio: 0.52,
      now: 1,
    });
    expect(progressOf(s, 1).taskIndex).toBe(1);
  });
});

describe('finish later', () => {
  it('stashes answers so far and resumes at the part in progress', () => {
    let s = readingThrough(begin());
    s = run(
      s,
      { type: 'continue', step: 'before.pointing', now: 81_000 },
      { type: 'continue', step: 'pointing.warmup', now: 82_000 },
    );
    const stash = stashOf(s, 90_000);
    expect(stash?.resumeModule).toBe('pointing');
    expect(stash?.summaries.reading?.status).toBe('measured');
    expect(stash?.outcomes.reading).toBe('done');

    const resumed = run(initialTuneState({ hasStash: true }), {
      type: 'restore',
      stash: stash!,
      rootFontPx: 16,
      now: 1,
    });
    expect(resumed.step).toBe('before.pointing');
    expect(resumed.summaries.reading?.status).toBe('measured');
    expect(resumed.outcomes).toEqual({
      reading: 'done',
      pointing: 'pending',
      focus: 'pending',
    });
  });

  it('has nothing to stash before the first part', () => {
    expect(stashOf(initialTuneState(), 0)).toBeNull();
  });
});
