// Round 4 package P: the passive fit (signals.md §4). Update rules, decay, layers, thresholds, effectiveFit, and the
// brief's simulation table reproduced with the same update rule.
import { describe, expect, test } from 'vitest';
import type { BrowserSettings, FitProfile, PassiveFitState } from '../../src/types';
import { DEMO_FITS, defaultFit } from '../../src/fit/derive';
import { mulberry32 } from '../../src/fit/stats';
import { planPageZoom } from '../../src/text/scale';
import {
  L0, PASSIVE, actionFor, addEvidence, applyFeedback, binaryLayers, buildPassiveState, cleanRecord, clickStep, demoHistory,
  effectiveFit, effectiveFitSources, emptyPassiveStore, fitSignature, normalCdf, pageClickWeight, passiveDimFor, passiveOffer,
  textObservation, textPosterior, withSettings,
} from '../../src/fit/passive';
import type { PassiveRecord, PassiveStore } from '../../src/fit/passive';

const NOW = new Date('2026-10-24T15:00:00');
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3600_000).toISOString();
}
function daysAgo(d: number, hour = 12): string {
  const t = new Date(NOW.getTime());
  t.setDate(t.getDate() - d);
  t.setHours(hour, 0, 0, 0);
  return t.toISOString();
}

function zoom(site: string, z: number, body: number, at: string, w = 0.9): PassiveRecord {
  return { dim: 'text_size', weight: w, value: z * body, zoom: z, bodyPx: body, site, at, layer: 'now', kind: 'zoom', what: `You zoomed in to ${Math.round(z * 100)}% on ${site}` };
}

function page(dim: 'targets' | 'steady_clicks', site: string, n: number, m: number, at: string, id: string, w = 1): PassiveRecord {
  const outcomes: boolean[] = [];
  for (let i = 0; i < n; i++) outcomes.push(m > 0 && Math.floor(((i + 1) * m) / n) > Math.floor((i * m) / n));
  return { dim, weight: pageClickWeight(outcomes, w), site, at, layer: 'now', kind: 'clicks', clicks: n, misses: m, page: id, what: `${m} of ${n} clicks on ${site}` };
}

function state(store: PassiveStore, base: FitProfile | null = null, sessionStart: string | null = daysAgo(0, 0)): PassiveFitState {
  return buildPassiveState(store, { now: NOW, base, sessionStart, os: 'Mac' });
}

const CONDITION_WORDS = /tremor|parkinson|disab|impair|blind|vision|elderly|older adult|\bage\b|dyslex|adhd|diagnos|condition|patient|symptom/i;

describe('update rules (Hurst 2008 rates)', () => {
  test('a miss adds +1.50 and a clean click −0.27; the prior is logit(0.10)', () => {
    expect(PASSIVE.llrMiss).toBeCloseTo(1.502, 3);
    expect(PASSIVE.llrClean).toBeCloseTo(-0.268, 3);
    expect(L0).toBeCloseTo(logit(0.1), 10);
    expect(clickStep(L0, 0, true).L).toBeCloseTo(L0 + 1.502, 3);
    expect(clickStep(L0, 0, false).L).toBeCloseTo(L0 - 0.268, 3);
    // Jev's attribution weight scales a miss, never a clean click.
    expect(clickStep(0, 0, true, 0.5).d).toBeCloseTo(0.751, 3);
    expect(clickStep(0, 0, false, 0.5).d).toBeCloseTo(-0.268, 3);
  });

  test('one page moves a belief by at most ±2, and L stays within ±4', () => {
    expect(pageClickWeight(Array(10).fill(true))).toBe(2);
    expect(pageClickWeight(Array(40).fill(false))).toBe(-2);
    let s = { L: 3.5, pageSum: 0, d: 0 };
    s = clickStep(s.L, s.pageSum, true);
    expect(s.L).toBe(4);
    // The cap applies to the running total, as in the simulation: misses after the cap are dropped.
    expect(pageClickWeight([...Array(5).fill(true), ...Array(4).fill(false)])).toBeCloseTo(2 - 4 * 0.268, 2);
  });

  test('the total decays back toward L0 with a 14-day half-life', () => {
    const r = page('targets', 'a.com', 10, 10, new Date(NOW.getTime() - 14 * 86400_000).toISOString(), 'p1');
    const L = binaryLayers([r], NOW.getTime(), NOW.getTime());
    expect(L.usualL - L0).toBeCloseTo(1, 2);
  });

  test('actions: ≥ 0.9 apply (multi-day rule met), 0.7–0.9 offer, 0.4–0.7 ask, else none', () => {
    expect(actionFor(0.95, true)).toBe('apply');
    expect(actionFor(0.95, false)).toBe('offer');
    expect(actionFor(0.9, true)).toBe('apply');
    expect(actionFor(0.89, true)).toBe('offer');
    expect(actionFor(0.7, true)).toBe('offer');
    expect(actionFor(0.69, true)).toBe('ask');
    expect(actionFor(0.4, false)).toBe('ask');
    expect(actionFor(0.39, true)).toBe('none');
  });
});

describe('the simulation table (signals.md §4: 4,000 runs × 1,000 clicks, 40 clicks a page)', () => {
  function sim(pErr: number, seed: number) {
    const rnd = mulberry32(seed);
    const offerAt: number[] = [];
    const actAt: number[] = [];
    const runs = 4000;
    for (let r = 0; r < runs; r++) {
      let L = L0;
      let pageSum = 0;
      let offer: number | null = null;
      let act: number | null = null;
      for (let i = 0; i < 1000; i++) {
        if (i % 40 === 0) pageSum = 0;
        const s = clickStep(L, pageSum, rnd() < pErr);
        L = s.L;
        pageSum = s.pageSum;
        if (offer === null && L >= logit(PASSIVE.offer)) offer = i + 1;
        if (act === null && L >= logit(PASSIVE.apply)) act = i + 1;
        if (act !== null) break;
      }
      if (offer !== null) offerAt.push(offer);
      if (act !== null) actAt.push(act);
    }
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
    };
    return { offer: offerAt.length / runs, offerMedian: median(offerAt), act: actAt.length / runs, actMedian: median(actAt) };
  }

  test('misses 28.3%: an offer in every run (median 49 clicks), default-on at a median of 97', () => {
    const r = sim(0.283, 7);
    expect(r.offer).toBe(1);
    expect(Math.abs(r.offerMedian - 49)).toBeLessThanOrEqual(4);
    expect(r.act).toBeGreaterThan(0.995);
    expect(Math.abs(r.actMedian - 97)).toBeLessThanOrEqual(6);
  });

  test('typical 6.3%: an offer in 11.2% of runs, default-on in 0.4%', () => {
    const r = sim(0.063, 11);
    expect(Math.abs(r.offer - 0.112)).toBeLessThanOrEqual(0.025);
    expect(r.act).toBeLessThanOrEqual(0.01);
  });

  test('a bad day at 10%: an offer in 64% of runs, default-on in 14% (the single layer the brief simulated)', () => {
    const r = sim(0.1, 13);
    expect(Math.abs(r.offer - 0.644)).toBeLessThanOrEqual(0.04);
    expect(Math.abs(r.act - 0.14)).toBeLessThanOrEqual(0.03);
  });
});

describe('layers: "now" offers, "usual" needs ≥ 3 sites on ≥ 2 days', () => {
  test('a bad day (misses on 3 sites, one day) earns an offer, never default-on', () => {
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [
      page('targets', 'a.com', 20, 8, hoursAgo(5), 'pa1'),
      page('targets', 'b.com', 20, 8, hoursAgo(4), 'pb1'),
      page('targets', 'c.com', 20, 8, hoursAgo(3), 'pc1'),
      page('targets', 'd.com', 20, 8, hoursAgo(2), 'pd1'),
    ], NOW);
    const b = state(st).beliefs.targets;
    expect(b.action).toBe('offer');
    expect(b.p).toBeGreaterThanOrEqual(0.9); // the "now" layer is sure; the usual layer is held to one day's +2.5
    expect(b.days).toBe(1);
    const L = binaryLayers(st.records.filter((r) => r.dim === 'targets'), NOW.getTime(), new Date(daysAgo(0, 0)).getTime());
    expect(sigmoid(L.usualL)).toBeLessThan(0.9);
    expect(sigmoid(L.nowL)).toBeGreaterThan(0.9);
  });

  test('the same misses over 3 days on 3 sites: applied by default, explained in the person’s own clicks', () => {
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [
      page('targets', 'a.com', 20, 6, daysAgo(2, 10), 'pa1'),
      page('targets', 'b.com', 20, 6, daysAgo(1, 10), 'pb1'),
      page('targets', 'c.com', 20, 6, daysAgo(0, 10), 'pc1'),
    ], NOW);
    const b = state(st).beliefs.targets;
    expect(b.action).toBe('apply');
    expect(b.source).toBe('learned');
    expect([b.sites, b.days]).toEqual([3, 3]);
    expect(b.value).toBe(44);
    expect(b.explanation).toBe('Click areas are bigger: 18 of your last 60 clicks landed just beside a button.');
  });

  test('p ≥ 0.9 on only 2 sites stays an offer', () => {
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [
      page('targets', 'a.com', 20, 6, daysAgo(3, 10), 'pa1'),
      page('targets', 'a.com', 20, 6, daysAgo(2, 10), 'pa2'),
      page('targets', 'b.com', 20, 6, daysAgo(1, 10), 'pb1'),
    ], NOW);
    expect(state(st).beliefs.targets.action).toBe('offer');
  });

  test('a later flush of the same page view replaces its record (the ±2 cap is per page)', () => {
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [page('targets', 'a.com', 10, 3, hoursAgo(1), 'same')], NOW);
    st = addEvidence(st, [page('targets', 'a.com', 30, 9, hoursAgo(0.5), 'same')], NOW);
    expect(st.records.filter((r) => r.dim === 'targets')).toHaveLength(1);
    expect(st.records[0]!.clicks).toBe(30);
  });
});

describe('text size: a Gaussian over log2(px / 16)', () => {
  test('prior from Chrome: μ0 = log2(defaultFont/16 × defaultZoom), σ0 0.25 when changed, else 0.5', () => {
    const changed: BrowserSettings = { ...withSettings(emptyPassiveStore(NOW), { defaultFontPx: 20, defaultZoom: 1.25 }, NOW).settings! };
    const p1 = textPosterior(changed, []);
    expect(p1.mu0).toBeCloseTo(Math.log2(1.5625), 6);
    expect(p1.sigma0).toBe(0.25);
    expect(textPosterior(null, []).sigma0).toBe(0.5);
    expect(textObservation(1.5, 14)).toBeCloseTo(Math.log2(1.3125), 6);
  });

  test('held zooms move the posterior with σ_obs 0.3; a 30-day-old zoom counts half', () => {
    const fresh = textPosterior(null, [{ y: 0.5, w: 1, ageDays: 0 }]);
    // τ = 1/0.25 + 1/0.09; μ = (0.5/0.09) / τ
    expect(fresh.mu).toBeCloseTo((0.5 / 0.09) / (4 + 1 / 0.09), 6);
    const old = textPosterior(null, [{ y: 0.5, w: 1, ageDays: 30 }]);
    expect(old.mu).toBeCloseTo((0.5 * 0.5 / 0.09) / (4 + 0.5 / 0.09), 6);
  });

  test('not zooming is never evidence: no records, no belief', () => {
    const b = state(emptyPassiveStore(NOW)).beliefs.text_size;
    expect(b.action).toBe('none');
    expect(b.source).toBe('default');
  });

  test('the live demo: zoom to 125% on two sites today → "Make text larger on every site? You zoomed in on 2 sites today."', () => {
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [zoom('cnn.com', 1.25, 16, hoursAgo(0.3))], NOW);
    const one = state(st).beliefs.text_size;
    expect(one.action).toBe('ask');
    expect(one.explanation).toBe('You zoomed in on cnn.com today.');
    st = addEvidence(st, [zoom('bbc.com', 1.25, 16, hoursAgo(0.1))], NOW);
    const two = state(st).beliefs.text_size;
    expect(two.action).toBe('offer');
    expect(two.p).toBeGreaterThanOrEqual(0.7);
    const offer = passiveOffer(two)!;
    expect(offer.kind).toBe('larger_text');
    expect(offer.question).toBe('Make text larger on every site?');
    expect(offer.fact).toBe('You zoomed in on 2 sites today.');
    expect(passiveDimFor(offer.kind)).toBe('text_size');
    // Accepting locks it at the learned size: text larger everywhere.
    const locked = state(applyFeedback(st, two, 'text_size', 'confirm', NOW)).beliefs.text_size;
    expect([locked.source, locked.action, locked.locked]).toEqual(['person', 'apply', true]);
    const fit = effectiveFit(null, state(applyFeedback(st, two, 'text_size', 'confirm', NOW)));
    expect(fit.text.bodyPx).toBe(two.value);
    expect(planPageZoom(fit, 16).zoom).toBeGreaterThan(1);
  });

  test('zooming in and out on one site the same day counts once; small one-step zooms on small text do not offer', () => {
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [zoom('a.com', 1.25, 16, hoursAgo(3)), zoom('a.com', 1.25, 16, hoursAgo(2)), zoom('a.com', 1.25, 16, hoursAgo(1))], NOW);
    expect(state(st).beliefs.text_size.action).toBe('ask');
    let small = emptyPassiveStore(NOW);
    small = addEvidence(small, [zoom('a.com', 1.1, 14, hoursAgo(3)), zoom('b.com', 1.1, 14, hoursAgo(2))], NOW);
    expect(state(small).beliefs.text_size.action).toBe('none');
  });

  test('an "every site" offer needs two sites: one strong zoom on one site is held at ask', () => {
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [zoom('npr.org', 1.25, 18, hoursAgo(0.3))], NOW);
    const one = state(st).beliefs.text_size;
    expect(one.p).toBeGreaterThan(0.7);
    expect(one.action).toBe('ask');
    st = addEvidence(st, [zoom('bbc.com', 1.25, 18, hoursAgo(0.1))], NOW);
    expect(state(st).beliefs.text_size.action).toBe('offer');
    let clicks = emptyPassiveStore(NOW);
    clicks = addEvidence(clicks, [page('targets', 'cvs.com', 40, 12, hoursAgo(2), 'pg-a1'), page('targets', 'cvs.com', 40, 12, hoursAgo(1), 'pg-a2')], NOW);
    const t = state(clicks).beliefs.targets;
    expect(t.p).toBeGreaterThan(0.7);
    expect(t.action).toBe('ask');
  });

  test('a zoom Jev says was for a picture is never named or counted as a site', () => {
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [zoom('npr.org', 1.25, 16, hoursAgo(0.3)), zoom('bbc.com', 1.25, 16, hoursAgo(0.1), 0.02)], NOW);
    const b = state(st).beliefs.text_size;
    expect(b.explanation).toBe('You zoomed in on npr.org today.');
    expect(b.sites).toBe(1);
    expect(b.evidence.map((e) => e.site)).toEqual(['npr.org']);
    expect(b.action).toBe('ask');
  });

  test('two 125% zooms on 14–15 px sites (18 px) ask rather than offer: the size is barely one zoom step up', () => {
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [zoom('a.com', 1.25, 14.5, hoursAgo(0.3), 0.95), zoom('b.com', 1.25, 15, hoursAgo(0.1), 0.91)], NOW);
    const b = state(st).beliefs.text_size;
    expect(b.action).toBe('ask');
    expect(b.p).toBeGreaterThan(0.5);
    expect(passiveOffer(b)?.question).toBe('Would larger text help on every site?');
    expect(passiveOffer(b)?.fact).toBe('You zoomed in on 2 sites today.');
  });

  test('zooms on 4 sites over 3 days apply by default, explained with the sites and the average zoom', () => {
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [
      zoom('a.com', 1.25, 16, daysAgo(4)), zoom('b.com', 1.5, 16, daysAgo(4, 18)), zoom('c.com', 1.25, 16, daysAgo(2)), zoom('d.com', 1.33, 16, daysAgo(1)),
    ], NOW);
    const b = state(st).beliefs.text_size;
    expect(b.action).toBe('apply');
    expect(b.explanation).toBe('Text is larger because you zoomed in on 4 sites this week (average 133%).');
    expect(effectiveFit(null, state(st)).text.bodyPx).toBe(b.value);
    expect(effectiveFitSources(null, state(st)).text_size).toBe('learned');
  });
});

describe('the person overrides everything', () => {
  function offered(): { st: PassiveStore; s: PassiveFitState } {
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [zoom('a.com', 1.25, 16, hoursAgo(2)), zoom('b.com', 1.25, 16, hoursAgo(1))], NOW);
    return { st, s: state(st) };
  }

  test('"Not right" adds −2: an offer drops to nothing', () => {
    const { st, s } = offered();
    const after = applyFeedback(st, s.beliefs.text_size, 'text_size', 'not_right', NOW);
    const b = state(after).beliefs.text_size;
    expect(sigmoid(logit(s.beliefs.text_size.p) - 2)).toBeCloseTo(b.p, 2);
    expect(b.action).toBe('none');
  });

  test('Undo adds −3 and releases the lock', () => {
    const { st, s } = offered();
    const locked = applyFeedback(st, s.beliefs.text_size, 'text_size', 'confirm', NOW);
    const undone = addEvidence(locked, [{ dim: 'text_size', weight: -3, kind: 'undo', what: 'You undid larger text on a.com', at: NOW.toISOString(), layer: 'usual' }], NOW);
    const b = state(undone).beliefs.text_size;
    expect(b.locked).toBe(false);
    expect(b.p).toBeCloseTo(sigmoid(logit(s.beliefs.text_size.p) - 3), 2);
  });

  test('an explicit "no" locks it off; "Forget this" clears what was learned', () => {
    const { st } = offered();
    const no = addEvidence(st, [{ dim: 'text_size', weight: 0, kind: 'answer_no', what: 'You said no', at: NOW.toISOString(), layer: 'usual' }], NOW);
    expect(state(no).beliefs.text_size).toMatchObject({ locked: true, action: 'none', source: 'person' });
    const s = state(st);
    const forgot = applyFeedback(st, s.beliefs.text_size, 'text_size', 'forget', NOW);
    expect(forgot.records.filter((r) => r.dim === 'text_size')).toHaveLength(0);
    expect(state(forgot).beliefs.text_size.action).toBe('none');
  });

  test('"Not right" on a setting or the warm-up turns that need off (Chrome and the warm-up are not changed)', () => {
    const st = withSettings(emptyPassiveStore(NOW), { reducedMotion: true }, NOW);
    const s = state(st);
    expect(s.beliefs.motion).toMatchObject({ source: 'setting', action: 'apply' });
    expect(s.beliefs.motion.explanation).toBe('Motion is paused because your Mac is set to Reduce motion.');
    const off = applyFeedback(st, s.beliefs.motion, 'motion', 'not_right', NOW);
    expect(effectiveFit(null, state(off)).attention.motion.on).toBe(false);
  });
});

describe('effectiveFit: person > warm-up > learned > settings > default', () => {
  test('the eval harness fits are unchanged when nothing was learned (rosa, reader, typical)', () => {
    for (const f of [DEMO_FITS.rosa, DEMO_FITS.reader, DEMO_FITS.typical]) {
      const s = state(emptyPassiveStore(NOW), f);
      expect(effectiveFit(f, s)).toEqual(f);
    }
  });

  test('no warm-up, untouched Chrome: the default fit, which changes nothing', () => {
    const fit = effectiveFit(null, state(emptyPassiveStore(NOW)));
    expect(fit.text.source).toBe('default');
    expect(planPageZoom(fit, 14).zoom).toBe(1);
    expect(fit.calibration.version).toBe('passive');
    expect(effectiveFit(null, null).text).toEqual(defaultFit().text);
  });

  test('works the moment it is installed: Chrome at 20 px sets the text size, the minimum font is a floor', () => {
    const st = withSettings(emptyPassiveStore(NOW), { defaultFontPx: 20, minFontPx: 0, defaultZoom: 1 }, NOW);
    const s = state(st);
    expect(s.beliefs.text_size.explanation).toBe('Text starts at 20 px because Chrome’s default font size is 20 px.');
    const fit = effectiveFit(null, s);
    expect([fit.text.bodyPx, fit.text.source]).toEqual([20, 'stated']);
    expect(planPageZoom(fit, 14).zoom).toBe(1.5); // a site that ignores Chrome's font size gets zoomed to honour it
    expect(planPageZoom(fit, 20).zoom).toBe(1); // a site that honours it is left alone
    const floor = effectiveFit(null, state(withSettings(emptyPassiveStore(NOW), { minFontPx: 18 }, NOW)));
    expect(floor.text.bodyPx).toBe(18);
  });

  test('a default zoom of 125% is not counted twice', () => {
    const fit = effectiveFit(null, state(withSettings(emptyPassiveStore(NOW), { defaultZoom: 1.25 }, NOW)));
    expect(fit.text.bodyPx).toBe(20);
    expect(planPageZoom(fit, 16, { ownZoom: 1.25 }).zoom).toBe(1.25);
  });

  test('reduced motion, more contrast and a touch pointer are taken as set; forced colours leave colours alone', () => {
    const st = withSettings(emptyPassiveStore(NOW), { reducedMotion: true, contrastMore: true, pointer: 'coarse' }, NOW);
    const fit = effectiveFit(DEMO_FITS.typical, state(st, DEMO_FITS.typical));
    expect(fit.attention.motion.on).toBe(true);
    expect(fit.contrast.floor).toBe(7);
    const forced = { ...DEMO_FITS.reader, polarity: { value: 'dark' as const, stated: 'dark' as const } };
    const f2 = effectiveFit(forced, state(withSettings(emptyPassiveStore(NOW), { forcedColors: true }, NOW), forced));
    expect(f2.polarity.value).toBe('none');
    const touch = effectiveFit(null, state(withSettings(emptyPassiveStore(NOW), { pointer: 'coarse' }, NOW)));
    expect(touch.targets.minPx).toBe(44);
  });

  test('a warm-up size outranks learning: learning that points higher is offered, not applied', () => {
    const warm: FitProfile = { ...DEMO_FITS.rosa, text: { ...DEMO_FITS.rosa.text, bodyPx: 18 }, createdAt: daysAgo(10) };
    let st = emptyPassiveStore(NOW);
    st = addEvidence(st, [
      zoom('a.com', 1.75, 16, daysAgo(3)), zoom('b.com', 1.75, 16, daysAgo(2)), zoom('c.com', 1.75, 16, daysAgo(1)), zoom('d.com', 1.75, 16, daysAgo(0, 9)),
    ], NOW);
    const s = state(st, warm);
    expect(s.beliefs.text_size).toMatchObject({ source: 'learned', action: 'offer' });
    expect(effectiveFit(warm, s).text.bodyPx).toBe(18);
    // Accepting (a lock newer than the warm-up) wins.
    const locked = applyFeedback(st, s.beliefs.text_size, 'text_size', 'confirm', NOW);
    const fit = effectiveFit(warm, state(locked, warm));
    expect(fit.text.bodyPx).toBe(s.beliefs.text_size.value);
    // A newer warm-up wins over an older lock.
    const newer = { ...warm, createdAt: new Date(NOW.getTime() + 60_000).toISOString() };
    expect(effectiveFit(newer, buildPassiveState(locked, { now: new Date(NOW.getTime() + 120_000), base: newer })).text.bodyPx).toBe(18);
  });

  test('the signature changes when a learned need starts applying, so open pages fit again', () => {
    const before = fitSignature(effectiveFit(null, state(emptyPassiveStore(NOW))));
    const st = { ...emptyPassiveStore(NOW), records: demoHistory(NOW) };
    expect(fitSignature(effectiveFit(null, state(st)))).not.toBe(before);
  });
});

describe('the demo week and the wording', () => {
  test('"Show a week of learning": text applied from 4 sites, bigger click areas offered', () => {
    const st = { ...emptyPassiveStore(NOW), records: demoHistory(NOW) };
    const s = state(st, null, NOW.toISOString());
    expect(s.beliefs.text_size).toMatchObject({ source: 'learned', action: 'apply', sites: 4, days: 3 });
    expect(s.beliefs.text_size.explanation).toMatch(/^Text is larger because you zoomed in on 4 sites this week \(average 1\d\d%\)\.$/);
    expect(s.beliefs.targets).toMatchObject({ source: 'learned', action: 'offer' });
    expect(s.beliefs.targets.explanation).toMatch(/^\d+ of your last \d+ clicks landed just beside a button\.$/);
    expect(passiveOffer(s.beliefs.targets)?.question).toBe('Make buttons bigger on every site?');
    const fit = effectiveFit(null, s);
    expect(fit.text.bodyPx).toBeGreaterThan(19);
    expect(fit.targets.minPx).toBeNull();
  });

  test('no explanation, fact or question ever names a condition, an age or the person’s body', () => {
    const settings = withSettings(emptyPassiveStore(NOW), { defaultFontPx: 20, reducedMotion: true, contrastMore: true, forcedColors: false, colorScheme: 'dark', pointer: 'coarse' }, NOW);
    const all = [
      state({ ...settings, records: demoHistory(NOW) }),
      state(settings, DEMO_FITS.rosa),
      state({ ...emptyPassiveStore(NOW), records: demoHistory(NOW) }, DEMO_FITS.reader),
    ];
    for (const s of all) {
      for (const b of Object.values(s.beliefs)) {
        expect(b.explanation).not.toMatch(CONDITION_WORDS);
        for (const e of b.evidence) expect(e.what).not.toMatch(CONDITION_WORDS);
        const o = passiveOffer(b);
        if (o) expect(`${o.question} ${o.fact} ${o.why}`).not.toMatch(CONDITION_WORDS);
      }
    }
  });

  test('records keep hostnames only, known fields only, and bounded values', () => {
    const r = cleanRecord({ dim: 'text_size', weight: 3, value: 400, site: 'https://www.CVS.com/rx/123?x=1', at: NOW.toISOString(), what: 'x', kind: 'zoom', secret: 'no' }, NOW)!;
    expect(r.site).toBe('cvs.com');
    expect(r.weight).toBe(1);
    expect(r.value).toBe(96);
    expect(Object.keys(r)).not.toContain('secret');
    expect(cleanRecord({ dim: 'age', weight: 1, at: NOW.toISOString() }, NOW)).toBeNull();
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.2816)).toBeCloseTo(0.9, 3);
  });
});
