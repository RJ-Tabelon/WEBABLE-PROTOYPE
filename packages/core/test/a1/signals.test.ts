import { describe, expect, it } from 'vitest';
import type { StruggleJudgment, StruggleKind } from '../../src/types';
import {
  OFFER_COPY, STRUGGLE_QUESTIONS, buildStruggleCall, decideOffers, gate, initialCusum, initialOfferMemory,
  parseStruggle, snoozeOffer, toSignals, turnOffOffer,
} from '../../src/signals';
import { emptyJevMetrics } from '../../src/jev/api';
import { FIT, choice, counts, noul, response, score } from './fixtures';

const BANNED = /accessib|complian|disabilit|impair|tremor|diagnos|struggl|condition|vision|elderly|senior|\bage\b/i;

function judgment(kinds: Partial<Record<StruggleKind, number>>, level = 2): StruggleJudgment {
  const all: Record<StruggleKind, number> = {
    pointing: 0, slipping: 0, accidental_repeat: 0, reading: 0, dense_text: 0, finding: 0, form: 0, deliberate: 0, site_fault: 0, ...kinds,
  };
  return { level, kinds: all, metrics: emptyJevMetrics() };
}

describe('CUSUM gate', () => {
  it('never asks on two retries alone', () => {
    const r = gate(initialCusum(), counts({ clicks: 2, nearMissClicks: 2 }), FIT);
    expect(r.check).toBe(false);
    expect(r.state.s).toBeCloseTo(2 * Math.log(4), 5);
  });

  it('asks on 3 retries with up to 6 clean clicks, not with many clean clicks', () => {
    expect(gate(initialCusum(), counts({ clicks: 9, nearMissClicks: 3 }), FIT).check).toBe(true);
    const many = gate(initialCusum(), counts({ clicks: 40, nearMissClicks: 3 }), FIT);
    expect(many.reason).not.toMatch(/^pointing/);
  });

  it('treats 2 lost clicks as a pointing gate, and suppresses pointing while the page is not responding', () => {
    expect(gate(initialCusum(), counts({ clicks: 6, lostClicks: 2 }), FIT).reason).toMatch(/^pointing/);
    const dead = gate(initialCusum(), counts({ clicks: 9, nearMissClicks: 4, deadClicks: 1 }), FIT);
    expect(dead.reason).not.toMatch(/pointing/);
  });

  it('keeps checks >= 15 s apart and does not re-ask the same signals within 30 s', () => {
    const c = counts({ clicks: 9, nearMissClicks: 3, timeOnPageSec: 60 });
    const first = gate(initialCusum(), c, FIT);
    expect(first.check).toBe(true);
    expect(gate(first.state, { ...c, timeOnPageSec: 70 }, FIT).check).toBe(false);
    expect(gate(first.state, { ...c, timeOnPageSec: 80 }, FIT).check).toBe(false);
    // new evidence 30 s later: asks again
    const later = gate(first.state, { ...c, clicks: 12, nearMissClicks: 5, timeOnPageSec: 90 }, FIT);
    expect(later.check).toBe(true);
    expect(later.state.checks).toBe(2);
  });

  it('does not double count overlapping windows', () => {
    const c = counts({ clicks: 10, nearMissClicks: 2, timeOnPageSec: 60 });
    const a = gate(initialCusum(), c, FIT);
    const b = gate(a.state, { ...c, timeOnPageSec: 61 }, FIT); // 1 s later, same window
    expect(b.state.s).toBeLessThan(a.state.s + 0.2);
  });

  it('caps checks per page-hour', () => {
    let st = initialCusum();
    let asked = 0;
    for (let t = 60; t < 3600; t += 16) {
      const r = gate(st, counts({ clicks: 9 + (t % 7), nearMissClicks: 3 + (t % 5), timeOnPageSec: t }), FIT);
      st = r.state;
      if (r.check) asked++;
    }
    expect(asked).toBeLessThanOrEqual(20);
  });

  it('runs a routine check every 60 s while the person is active', () => {
    const quiet = gate(initialCusum(), counts({ clicks: 0, timeOnPageSec: 70 }), FIT);
    expect(quiet.check).toBe(false);
    const busy = gate(initialCusum(), counts({ clicks: 12, nearMissClicks: 1, timeOnPageSec: 70 }), FIT);
    expect(busy.check).toBe(true);
    expect(busy.reason).toMatch(/routine/);
  });
});

describe('toSignals and buildStruggleCall', () => {
  const c = counts({ clicks: 9, nearMissClicks: 3, lostClicks: 2, pathWobble: 0.45, zoomInEvents: 1, zoomLevel: 1.25, scrollBacks: 2 });

  it('writes bands relative to the baseline with raw counts, and never condition words', () => {
    const s = toSignals(c, FIT, 'prescription refill form');
    expect(s.page_kind).toBe('prescription refill form');
    expect(s.near_miss_rate).toBe('far above usual: 5 of 9 (about 1 in 2) needed a second try; usual about 1 in 20');
    expect(s.pointer_path).toBe('wobbly');
    expect(s.zoom_now_percent).toBe('125');
    for (const [k, v] of Object.entries(s)) {
      expect(typeof v, k).toBe('string');
      expect(v, k).not.toMatch(BANNED);
    }
    expect(Object.keys(s).filter((k) => k.startsWith('evidence_')).length).toBeGreaterThanOrEqual(3);
  });

  it('builds the measured state shape and the exact 9 questions', () => {
    const call = buildStruggleCall(toSignals(c, FIT, 'refill form'));
    const st = call.state as Record<string, Record<string, unknown>>;
    expect(Object.keys(st)).toEqual(['about', 'context', 'evidence', 'pointing', 'reading', 'finding', 'site', 'forms']);
    expect(st.about).toContain('the last 60 seconds');
    expect(st.pointing!.clicks_on_controls).toBe(9);
    expect(st.pointing!.lost_clicks).toBe(2);
    expect(Array.isArray(st.evidence)).toBe(true);
    expect(JSON.stringify(call.questions)).toBe(JSON.stringify(STRUGGLE_QUESTIONS));
    expect(Object.keys(call.questions)).toEqual([
      'pointing_struggle', 'accidental_repeat', 'reading_struggle', 'finding_struggle', 'form_struggle',
      'site_not_responding', 'deliberate_activity', 'best_help', 'help_level',
    ]);
  });
});

describe('parseStruggle', () => {
  it('maps the Nouls to kinds and splits pointing and reading by best_help', () => {
    const r = response({
      pointing_struggle: noul(0.83), accidental_repeat: noul(0.04), reading_struggle: noul(0.9), finding_struggle: noul(0.05),
      form_struggle: noul(0.03), site_not_responding: noul(0.03), deliberate_activity: noul(0.05),
      best_help: choice({ steady_clicks: 0.75, bigger_targets: 0.25, explain_passage: 0, larger_text: 0 }),
      help_level: score(1.62),
    });
    const j = parseStruggle(r, emptyJevMetrics());
    expect(j.level).toBeCloseTo(1.62);
    expect(j.kinds.pointing).toBe(0.83);
    expect(j.kinds.slipping).toBeCloseTo(0.62, 2);
    expect(j.kinds.dense_text).toBe(0);
    expect(j.kinds.site_fault).toBe(0.03);
    expect(j.bestHelp.steady_clicks).toBe(0.75);
  });

  it('fails closed on a missing answer', () => {
    const j = parseStruggle(response({}), emptyJevMetrics());
    expect(j.level).toBe(0);
    expect(Object.values(j.kinds).every((v) => v === 0)).toBe(true);
  });
});

describe('decideOffers', () => {
  const now = 1_800_000_000_000;
  const pointingCounts = counts({ clicks: 9, nearMissClicks: 3, lostClicks: 1 });
  const P = judgment({ pointing: 0.94, slipping: 0.12 }, 2.05);

  it('needs 2 consecutive pointing windows; the first one waits', () => {
    const one = decideOffers([P], pointingCounts, initialOfferMemory(), now, 30_000, true);
    expect(one.offers).toEqual([]);
    expect(one.waiting).toEqual(['pointing']);
    const two = decideOffers([P, P], pointingCounts, one.mem, now, 30_000, true);
    expect(two.offers).toHaveLength(1);
    expect(two.offers[0]!.kind).toBe('bigger_targets');
    expect(two.offers[0]!.question).toBe('Make buttons bigger on this page?');
    expect(two.offers[0]!.fact).toBe('4 of the last 9 clicks here needed a second try.');
  });

  it('routes slips to steady clicks', () => {
    const S = judgment({ pointing: 0.83, slipping: 0.82 }, 1.62);
    const o = decideOffers([S, S], counts({ clicks: 10, lostClicks: 3 }), initialOfferMemory(), now, 30_000, true);
    expect(o.offers[0]!.kind).toBe('steady_clicks');
  });

  it('waits in the 0.50-0.75 band and needs help_level >= 1.0', () => {
    const G = judgment({ pointing: 0.66 }, 0.98);
    expect(decideOffers([G, G], pointingCounts, initialOfferMemory(), now, 30_000, true)).toMatchObject({ offers: [], waiting: ['pointing'] });
    const low = judgment({ pointing: 0.9 }, 0.9);
    expect(decideOffers([low, low], pointingCounts, initialOfferMemory(), now, 30_000, true).offers).toEqual([]);
    const reading = judgment({ reading: 0.74 }, 1.8);
    expect(decideOffers([reading], counts({ zoomInEvents: 1, zoomLevel: 1.25 }), initialOfferMemory(), now, 30_000, true).waiting).toEqual(['reading']);
  });

  it('offers nothing when the site is at fault or the activity is deliberate', () => {
    const site = judgment({ pointing: 0.9, site_fault: 0.98 }, 2.3);
    expect(decideOffers([site, site], pointingCounts, initialOfferMemory(), now, 30_000, true).offers).toEqual([]);
    const fast = judgment({ pointing: 0.9, deliberate: 0.88 }, 1.5);
    expect(decideOffers([fast, fast], pointingCounts, initialOfferMemory(), now, 30_000, true).offers).toEqual([]);
  });

  it('offers debounce for accidental repeats at 0.80 without the level check', () => {
    const r = judgment({ accidental_repeat: 0.9, pointing: 0.21 }, 0.58);
    const o = decideOffers([r], counts({ clicks: 14, repeatClicks: 3 }), initialOfferMemory(), now, 30_000, true);
    expect(o.offers[0]!.kind).toBe('debounce');
    const weak = judgment({ accidental_repeat: 0.79 }, 0.58);
    expect(decideOffers([weak], counts({ repeatClicks: 3 }), initialOfferMemory(), now, 30_000, true).offers).toEqual([]);
  });

  it('acts only on the domain the counts point at (no cross-talk)', () => {
    const f = judgment({ finding: 0.92, reading: 0.57 }, 1.9);
    expect(decideOffers([f], counts({ clicks: 2 }), initialOfferMemory(), now, 30_000, true).offers).toEqual([]);
    const o = decideOffers([f], counts({ hoverHunts: 1 }), initialOfferMemory(), now, 30_000, true);
    expect(o.offers[0]!.kind).toBe('calm_view');
  });

  it('routes a zoom-in and dense re-reading to larger text', () => {
    const d = judgment({ reading: 0.97, dense_text: 0.6 }, 1.8);
    expect(decideOffers([d], counts({ zoomInEvents: 1, zoomLevel: 1.25 }), initialOfferMemory(), now, 30_000, true).offers[0]!.kind).toBe('larger_text');
    expect(decideOffers([d], counts({ scrollBacks: 3 }), initialOfferMemory(), now, 30_000, true).offers[0]!.kind).toBe('larger_text');
  });

  it('applies the interruption budget', () => {
    const run = (mem = initialOfferMemory(), t = now, age = 30_000, idle = true) => decideOffers([P, P], pointingCounts, mem, t, age, idle);
    expect(run(undefined, now, 9_000).offers).toEqual([]); // first 10 s
    expect(run(undefined, now, 30_000, false).offers).toEqual([]); // not idle
    const first = run();
    expect(first.offers).toHaveLength(1);
    // same kind is not offered twice on one page
    expect(run(first.mem, now + 200_000, 230_000).offers).toEqual([]);
    // on a new page, after 90 s, it may be offered again
    expect(run(first.mem, now + 200_000, 30_000).offers).toHaveLength(1);
    // >= 90 s apart, across pages
    const R = judgment({ reading: 0.97 }, 1.8);
    const readCounts = counts({ zoomInEvents: 1, zoomLevel: 1.25 });
    expect(decideOffers([R], readCounts, first.mem, now + 60_000, 10_000, true).offers).toEqual([]);
    expect(decideOffers([R], readCounts, first.mem, now + 91_000, 20_000, true).offers).toHaveLength(1);
    // <= 6 per day
    const full = { ...initialOfferMemory(), today: 6, day: new Date(now).toISOString().slice(0, 10) };
    const local = new Date(now);
    full.day = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    expect(run(full).offers).toEqual([]);
    // "Not now" for 30 minutes, "Don't suggest" off
    expect(run(snoozeOffer(initialOfferMemory(), 'bigger_targets', now)).offers).toEqual([]);
    expect(run(snoozeOffer(initialOfferMemory(), 'bigger_targets', now - 31 * 60_000)).offers).toHaveLength(1);
    expect(run(turnOffOffer(initialOfferMemory(), 'bigger_targets')).offers).toEqual([]);
  });

  it('shows at most one offer and words every offer as a question about the page', () => {
    const many = judgment({ pointing: 0.94, reading: 0.97, finding: 0.92 }, 2.2);
    const o = decideOffers([many, many], counts({ clicks: 9, nearMissClicks: 4, zoomInEvents: 1, zoomLevel: 1.5, hoverHunts: 1 }), initialOfferMemory(), now, 30_000, true);
    expect(o.offers).toHaveLength(1);
    expect(o.offers[0]!.kind).toBe('larger_text');
    for (const [kind, copy] of Object.entries(OFFER_COPY)) {
      expect(copy.question.endsWith('?'), kind).toBe(true);
      expect(copy.question + copy.toast, kind).not.toMatch(BANNED);
    }
    const x = o.offers[0]!;
    expect(x.fact + x.why).not.toMatch(BANNED);
    expect(x.why).toContain('nothing you typed');
  });
});
