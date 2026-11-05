// Round 4 (W): the 70-second warm-up's maths in derive.ts — the Read posterior, the contrast band that leans to more
// contrast, browser settings as priors and floors, the Pick rule, and what the saved fit records.
import { describe, expect, test } from 'vitest';
import type { BrowserSettings, FittingRaw } from '../../src/types';
import {
  bodyPxFromKnee, deriveFit, fitSources, READ_RULES, ReadPosterior, readSpeed, textPriorPx, DEMO_FITS,
  type ReadTrial, type WarmupMetrics,
} from '../../src/fit/derive';
import { mulberry32 } from '../../src/fit/stats';

/* ------------------------------------------------------------------ */
/* Simulated readers (the brief's sim_warmup2.py response model)       */
/* ------------------------------------------------------------------ */

function gauss(rnd: () => number): number {
  const u = Math.max(1e-12, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface Reader { c: number; M: number; sd: number; a: number; lapse: number }

function makeReader(rnd: () => number): Reader {
  const c = Math.log10(10) + rnd() * (Math.log10(64) - Math.log10(10));
  const M = Math.log10(240) + 0.12 * gauss(rnd);
  const sd = 0.07 + rnd() * 0.08;
  const reserve = 0.2 + rnd() * 0.15;
  return { c, M, sd, a: c - reserve, lapse: 0.03 };
}

/** Smooth-knee reader (Arango 2020 form): c is the 80%-of-top-speed size. Returns the trial the page would record. */
function respond(p: Reader, px: number, rnd: () => number): { trial: ReadTrial; rtMs: number } {
  const x = Math.log10(px);
  if (x < p.a) return { trial: { px, ms: 4000, correct: false, cant: true }, rtMs: 4000 };
  const tau = (p.c - p.a) / Math.log(5);
  const lin = 1 - Math.exp(-(x - p.a + 1e-3) / tau);
  const y = p.M + Math.log10(Math.max(lin, 0.05)) + p.sd * gauss(rnd);
  const rt = 0.6 + (56 / 6) / (10 ** y / 60);
  const pErr = p.lapse + 0.35 * Math.max(0, 1 - (x - p.a) / 0.15);
  const rtMs = Math.round(rt * 1000);
  return { trial: { px, ms: rtMs, correct: rnd() >= pErr }, rtMs };
}

/** One Read block exactly as the warm-up runs it: start at 40 px (or the prior), stop rule, next size by variance. */
function runRead(p: Reader, rnd: () => number, priorPx: number | null = null): { c: number; n: number; trials: ReadTrial[] } {
  const post = new ReadPosterior(priorPx);
  const minPx = 9;
  const maxPx = 10 ** 2.1;
  let px = priorPx ? Math.max(40, 2 * priorPx) : 40;
  let active = 0;
  const trials: ReadTrial[] = [];
  for (;;) {
    const { trial, rtMs } = respond(p, px, rnd);
    trials.push(trial);
    post.add(trial);
    active += rtMs;
    if (post.shouldStop(active)) break;
    px = post.nextPx(minPx, maxPx);
  }
  return { c: post.mean(), n: post.n, trials };
}

describe('Read: the grid posterior', () => {
  test('reproduces the brief\'s simulation: text within one step for most readers, ~5 sentences, stable on retest', () => {
    const rnd = mulberry32(20261024);
    const N = 160;
    let within = 0;
    let same = 0;
    let sentences = 0;
    for (let k = 0; k < N; k++) {
      const p = makeReader(rnd);
      const r1 = runRead(p, rnd);
      const r2 = runRead(p, rnd);
      if (Math.abs(r1.c - p.c) <= 0.1) within++;
      if (Math.abs(r1.c - r2.c) <= 0.1) same++;
      sentences += r1.n + 1; // + the unscored practice sentence
    }
    // Brief §6 (simulated people): 83–85% within one step, 77–80% same step on retest, 5.0 sentences.
    expect(within / N).toBeGreaterThanOrEqual(0.74);
    expect(same / N).toBeGreaterThanOrEqual(0.66);
    expect(sentences / N).toBeLessThanOrEqual(6.2);
    expect(sentences / N).toBeGreaterThanOrEqual(4.5);
  });

  test('stop rule: never before 4 scored, always by 8 scored or 30 s', () => {
    const post = new ReadPosterior(null);
    const fast = (px: number): ReadTrial => ({ px, ms: 2900, correct: true });
    for (const px of [40, 30, 22]) {
      post.add(fast(px));
      expect(post.shouldStop(5000)).toBeNull();
    }
    expect(post.shouldStop(30_000)).toBe('time');
    const many = new ReadPosterior(null);
    for (let i = 0; i < READ_RULES.maxScored; i++) many.add({ px: 40, ms: 9000, correct: i % 2 === 0 });
    expect(many.shouldStop(1000)).not.toBeNull();
  });

  test('the next size never probes more than 0.3 log below the knee estimate, and stays in range', () => {
    const post = new ReadPosterior(null);
    post.add({ px: 40, ms: 2900, correct: true });
    post.add({ px: 20, ms: 6000, correct: true });
    const next = post.nextPx(9, 120);
    expect(Math.log10(next)).toBeGreaterThanOrEqual(post.mean() - 0.3 - 0.051);
    expect(next).toBeGreaterThanOrEqual(9);
    expect(next).toBeLessThanOrEqual(120);
  });

  test('"Can\'t read it" pushes the knee above the size shown; a wrong answer only nudges it', () => {
    const a = new ReadPosterior(null);
    a.add({ px: 40, ms: 2900, correct: true });
    const before = a.mean();
    const cant = new ReadPosterior(null);
    cant.add({ px: 40, ms: 2900, correct: true });
    cant.add({ px: 14, ms: 4000, correct: false, cant: true });
    const wrong = new ReadPosterior(null);
    wrong.add({ px: 40, ms: 2900, correct: true });
    wrong.add({ px: 14, ms: 4000, correct: false });
    expect(cant.mean()).toBeGreaterThan(Math.log10(14) + 0.1);
    expect(cant.mean()).toBeGreaterThan(wrong.mean());
    expect(Number.isFinite(before)).toBe(true);
  });

  test('a lapse (one very slow sentence at a large size) does not drag the knee up', () => {
    const steady = new ReadPosterior(null);
    const lapse = new ReadPosterior(null);
    const base: ReadTrial[] = [
      { px: 40, ms: 2900, correct: true }, { px: 25, ms: 3000, correct: true }, { px: 16, ms: 3100, correct: true },
      { px: 12, ms: 5200, correct: true },
    ];
    for (const t of base) { steady.add(t); lapse.add(t); }
    lapse.add({ px: 32, ms: 21000, correct: true });
    expect(Math.abs(lapse.mean() - steady.mean())).toBeLessThan(0.08);
  });

  test('body text is 10^(c + 0.06), never below 16 px; speed samples ignore impossible times', () => {
    expect(bodyPxFromKnee(Math.log10(20))).toBe(23);
    expect(bodyPxFromKnee(Math.log10(9))).toBe(16);
    expect(readSpeed(700)).toBeNull(); // 0.1 s of reading for 56 characters: a stray press
    expect(readSpeed(2933)).toBeCloseTo(Math.log10(240), 1);
  });

  test('deriveFit replays the same posterior the page ran, so the saved size matches what the page showed', () => {
    const rnd = mulberry32(7);
    const p = makeReader(rnd);
    const run = runRead(p, rnd);
    const raw: FittingRaw = {
      inputClass: 'mouse', durationSec: 22, skipped: [],
      reading: { seedPx: null, ladder: run.trials, faint: [], polarity: { lightMs: [], darkMs: [], stated: null } },
      pointing: null, finding: null, allPresses: [],
    };
    const fit = deriveFit(raw);
    expect(fit.text.source).toBe('measured');
    expect(fit.text.bodyPx).toBe(bodyPxFromKnee(run.c));
    expect(fit.text.cpsPx).toBeCloseTo(10 ** run.c, 0);
    expect(fit.text.conf).toBeGreaterThan(0);
    expect(fit.text.conf).toBeLessThanOrEqual(0.9);
  });
});

/* ------------------------------------------------------------------ */
/* Settings, contrast, Pick, records                                   */
/* ------------------------------------------------------------------ */

function settings(over: Partial<BrowserSettings> = {}): BrowserSettings {
  return {
    defaultFontPx: 16, minFontPx: 0, defaultZoom: 1, siteZooms: [], reducedMotion: false, contrastMore: false,
    forcedColors: false, colorScheme: 'light', reducedTransparency: false, languages: ['en-US'], pointer: 'fine', anyHover: true,
    ...over,
  };
}

function raw(over: Partial<FittingRaw> = {}): FittingRaw {
  return { inputClass: 'mouse', durationSec: 70, skipped: [], reading: null, pointing: null, finding: null, allPresses: [], ...over };
}

const faint = (ws: Array<[number, boolean]>) => ws.map(([w, correct]) => ({ contrast: 1.05 / (1.05 - w), correct }));

describe('browser settings answer what they can first', () => {
  test('default font × default zoom is the text prior, only when changed', () => {
    expect(textPriorPx(settings())).toBeNull();
    expect(textPriorPx(settings({ defaultFontPx: 20 }))).toBe(20);
    expect(textPriorPx(settings({ defaultZoom: 1.25 }))).toBe(20);
    expect(textPriorPx(null)).toBeNull();
  });

  test('with Read skipped, the text size comes from the settings and says so', () => {
    const f = deriveFit(raw({ skipped: ['read'] }), { settings: settings({ defaultFontPx: 20, defaultZoom: 1.1 }) });
    expect(f.text).toMatchObject({ bodyPx: 22, source: 'stated' });
    expect(fitSources(f).text_size).toBe('setting');
  });

  test('the minimum font size is a floor; Reduce motion is honoured as set; forced colours leave colours alone', () => {
    const f = deriveFit(raw(), { settings: settings({ minFontPx: 18, reducedMotion: true, forcedColors: true }) });
    expect(f.text.bodyPx).toBe(18);
    expect(f.attention.motion.on).toBe(true);
    expect(f.contrast.band).toBe('N');
    expect(f.polarity.value).toBe('none');
    const src = fitSources(f);
    expect(src).toMatchObject({ text_size: 'setting', motion: 'setting', contrast: 'setting', colors: 'setting' });
  });

  test('"More contrast" sets a 7:1 floor even when the faint words were all seen', () => {
    const reading = { seedPx: null, ladder: [], faint: faint([[0.5, true], [0.02, true], [0.015, true], [0.012, true]]), polarity: { lightMs: [], darkMs: [], stated: null } };
    expect(deriveFit(raw({ reading })).contrast.band).toBe('N');
    const f = deriveFit(raw({ reading }), { settings: settings({ contrastMore: true }) });
    expect(f.contrast).toEqual({ band: 'M', floor: 7 });
    expect(fitSources(f).contrast).toBe('setting');
  });
});

describe('Faint: the band leans to more contrast', () => {
  test('the strongest band with posterior ≥ 0.35 wins over the posterior mean', () => {
    // Seen down to W 0.032, missed at 0.028 and 0.03: the threshold sits on the N/M edge (W 0.030), so it leans to M.
    const reading = {
      seedPx: null, ladder: [],
      faint: faint([[0.5, true], [0.1, true], [0.045, true], [0.035, true], [0.028, false], [0.03, false], [0.032, true]]),
      polarity: { lightMs: [], darkMs: [], stated: null },
    };
    expect(deriveFit(raw({ reading })).contrast.band).toBe('M');
  });

  test('easy reader stays at N; two misses at strong contrast go straight to S', () => {
    const easy = { seedPx: null, ladder: [], faint: faint([[0.5, true], [0.05, true], [0.02, true], [0.015, true], [0.01, true]]), polarity: { lightMs: [], darkMs: [], stated: null } };
    expect(deriveFit(raw({ reading: easy })).contrast.band).toBe('N');
    const hard = { seedPx: null, ladder: [], faint: faint([[0.5, true], [0.4, false], [0.6, false]]), polarity: { lightMs: [], darkMs: [], stated: null } };
    expect(deriveFit(raw({ reading: hard })).contrast.band).toBe('S');
  });
});

describe('Find and Pick', () => {
  const trials = (busyMs: number, calmMs: number) => [
    { clutter: false, motion: false, ms: calmMs, found: true },
    { clutter: false, motion: true, ms: calmMs + 200, found: true },
    { clutter: true, motion: false, ms: busyMs, found: true },
    { clutter: true, motion: true, ms: busyMs + 200, found: true },
  ];

  test('calm → Calm view offered; calm + Stop, or busy ≥ 1.5× slower → Calm view on busy pages; busy pick → nothing', () => {
    const lvl = (finding: NonNullable<FittingRaw['finding']>) => deriveFit(raw({ finding })).attention;
    expect(lvl({ trials: trials(3000, 2800), preferredCalm: 2, gotInWay: [] }).structureLevel).toBe(1);
    expect(lvl({ trials: trials(3000, 2800), preferredCalm: 2, gotInWay: ['pressed stop'] })).toMatchObject({ structureLevel: 2, motion: { on: true } });
    expect(lvl({ trials: trials(6000, 2800), preferredCalm: 2, gotInWay: [] }).structureLevel).toBe(2);
    expect(lvl({ trials: trials(6000, 2800), preferredCalm: 0, gotInWay: [] })).toMatchObject({ structureLevel: 0, motion: { on: false } });
    expect(lvl({ trials: trials(6000, 2800), preferredCalm: 0.5, gotInWay: [] }).structureLevel).toBe(0); // "About the same"
  });

  test('a search that ran out counts as the full 12 s', () => {
    const f = deriveFit(raw({
      finding: {
        trials: [
          { clutter: false, motion: false, ms: 2500, found: true }, { clutter: false, motion: true, ms: 2600, found: true },
          { clutter: true, motion: false, ms: 12000, found: false }, { clutter: true, motion: true, ms: 3000, found: true },
        ],
        preferredCalm: 2, gotInWay: [],
      },
    }));
    expect(f.attention.structureLevel).toBe(2);
    expect(f.baselines.searchSecMedian).toBe(2.6);
  });
});

describe('pointing blocks from the sequential walk', () => {
  const press = (r: number, a: number, size: number) => ({ dx: r * Math.cos(a), dy: r * Math.sin(a), hit: r <= size / 2, slipped: false });
  test('4 clean presses pass a size; 2 misses fail it; the smallest pass above every fail wins', () => {
    const blocks = [
      { sizePx: 44, presses: [0, 1, 2, 3].map((a) => press(4, a, 44)) },
      { sizePx: 32, presses: [0, 1, 2, 3].map((a) => press(4, a, 32)) },
      { sizePx: 24, presses: [press(4, 0, 24), press(14, 1, 24), press(3, 2, 24), press(15, 3, 24)] },
    ];
    const f = deriveFit(raw({ pointing: { blocks } }));
    expect(f.targets.minPx).toBe(32);
    expect(fitSources(deriveFit(raw({ pointing: { blocks } }), { settings: settings() })).targets).toBe('warmup');
  });
});

describe('what the saved fit records', () => {
  test('the session numbers and per-dimension sources travel in calibration', () => {
    const metrics: WarmupMetrics = {
      v: 'warmup.1', activeMs: 68_400, actions: 41, completed: true,
      blocks: [{ block: 'read', status: 'done', activeMs: 21_000, actions: 6, trials: 5, stop: 'sd' }],
      corrections: { textSteps: 0, colours: false, rows: [] }, settingsUsed: [],
    };
    const f = deriveFit(raw(), { settings: settings(), metrics });
    expect(f.calibration.version).toBe('warmup-1');
    const cal = f.calibration as typeof f.calibration & { warmup?: WarmupMetrics; sources?: object };
    expect(cal.warmup?.blocks[0]?.trials).toBe(5);
    expect(cal.sources).toBeTruthy();
    expect(JSON.stringify(f).toLowerCase()).not.toMatch(/tremor|vision|impair|disab|age\b/);
  });

  test('fits from before round 4 still say where values came from', () => {
    expect(fitSources(DEMO_FITS.rosa)).toMatchObject({ text_size: 'warmup', targets: 'warmup', motion: 'warmup' });
    const typical = fitSources(DEMO_FITS.typical);
    expect(typical.text_size).toBe('warmup'); // a demo fit counts as a warm-up result
  });
});
