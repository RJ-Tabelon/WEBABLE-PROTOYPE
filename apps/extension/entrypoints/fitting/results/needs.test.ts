import { DEMO_FITS, defaultFit } from '@webable/core';
import type { FitProfile } from '@webable/core';
import { describe, expect, it } from 'vitest';
import type { RunEvidence } from '../logic/evidence';
import type { SiteTaskResult } from '../../../src/sitetask/types';
import {
  BUSY_FLOOR,
  CARD_MIN,
  FIT_LINES,
  FIX_LINES,
  PROBLEM_LINES,
  STRUGGLE_LABELS,
  STRUGGLE_ORDER,
  aboutPercent,
  amountWords,
  anyStrong,
  bodyPxOf,
  buttonsValue,
  evidenceLine,
  struggleCards,
  struggleValues,
  textValue,
  timesWords,
} from './needs';
import {
  BUTTON_LEVELS,
  TEXT_LEVELS,
  buttonLabel,
  buttonLevel,
  canStepText,
  faintLevel,
  stepText,
  textLabel,
  textLevel,
  withButtonLevel,
  withFaint,
  withMotion,
  withPolarity,
  withSteady,
  withTextLevel,
} from './adjust';

const value = (fit: FitProfile, id: string, ev: RunEvidence | null = null): number =>
  struggleValues(fit, ev).find((n) => n.id === id)?.value ?? -1;

const site = (over: Partial<SiteTaskResult>): SiteTaskResult => ({
  id: 'x',
  name: 'Site',
  busy: false,
  found: true,
  skipped: false,
  ms: 4000,
  wrongClicks: 0,
  nearMisses: 0,
  slips: 0,
  presses: 3,
  scrollScreens: 0,
  motionSeen: false,
  adsSeen: 0,
  ...over,
});

const evidence = (over: Partial<RunEvidence> = {}): RunEvidence => ({
  reading: null,
  faint: null,
  pointing: null,
  sites: [],
  busySlowdown: null,
  gotInWay: [],
  ...over,
});

describe('how strongly each struggle gets in the way', () => {
  it('gives six values in the spec order, each 0-100', () => {
    expect(STRUGGLE_ORDER.map((id) => STRUGGLE_LABELS[id])).toEqual([
      'Small text',
      'Faint text',
      'Small buttons',
      'Click slips',
      'Busy pages',
      'Moving things',
    ]);
    for (const fit of [DEMO_FITS.rosa, DEMO_FITS.typical, DEMO_FITS.reader]) {
      const v = struggleValues(fit);
      expect(v.map((n) => n.id)).toEqual([...STRUGGLE_ORDER]);
      for (const n of v) {
        expect(n.value).toBeGreaterThanOrEqual(0);
        expect(n.value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('never puts busy pages below the floor, and grows it with the simplified page', () => {
    expect(value(defaultFit(), 'busy')).toBe(BUSY_FLOOR);
    expect(value(DEMO_FITS.reader, 'busy')).toBeGreaterThan(BUSY_FLOOR);
    expect(value(DEMO_FITS.rosa, 'busy')).toBeGreaterThan(value(DEMO_FITS.reader, 'busy'));
  });

  it('scales text and click areas on a log scale, with nothing at the usual sizes', () => {
    expect(textValue(16)).toBe(0);
    expect(textValue(22)).toBeGreaterThan(textValue(18));
    expect(textValue(32)).toBe(100);
    expect(buttonsValue(null)).toBe(0);
    expect(buttonsValue(24)).toBe(0);
    expect(buttonsValue(56)).toBeGreaterThan(buttonsValue(44));
    expect(buttonsValue(96)).toBe(100);
  });

  it('reads a size the person set over the measured one', () => {
    const fit: FitProfile = { ...DEMO_FITS.rosa, text: { ...DEMO_FITS.rosa.text, bodyPx: 22, override: 28 } };
    expect(bodyPxOf(fit)).toBe(28);
    expect(value(fit, 'text')).toBe(textValue(28));
  });

  it('lets their own numbers make a struggle stronger', () => {
    const typical = defaultFit();
    expect(value(typical, 'busy', evidence({ busySlowdown: { ratio: 2.1, busyName: 'CNN', quietName: 'Wikipedia' } }))).toBe(100);
    expect(value(typical, 'faint', evidence({ faint: { missedCommonGrey: true } }))).toBeLessThan(CARD_MIN); // fix off: no card
    const darker = withFaint(typical, 'darker');
    expect(value(darker, 'faint', evidence({ faint: { missedCommonGrey: true } }))).toBe(65);
  });

  it('keeps a struggle whose fix is off below a card, whatever the numbers say', () => {
    const typical = defaultFit();
    const ev = evidence({ reading: { slowdown: 1.8, tooSmallCount: 3 }, gotInWay: ['moving things'] });
    expect(value(typical, 'text', ev)).toBeLessThan(CARD_MIN);
    expect(value(typical, 'motion', ev)).toBeLessThan(CARD_MIN);
    expect(struggleCards(typical, ev).map((c) => c.id)).toEqual(['busy']);
  });
});

describe('the struggle cards', () => {
  it('lead with the strongest, at most four, in fit-only words when there is no evidence', () => {
    const cards = struggleCards(DEMO_FITS.rosa);
    expect(cards.map((c) => c.id)).toEqual(['busy', 'text', 'buttons', 'motion']);
    for (let i = 1; i < cards.length; i++) expect(cards[i]!.value).toBeLessThanOrEqual(cards[i - 1]!.value);
    for (const c of cards) {
      expect(c.problem).toBe(PROBLEM_LINES[c.id]);
      expect(c.fix).toBe(FIX_LINES[c.id]);
      expect(c.evidence).toBe(FIT_LINES[c.id]);
      expect(c.measured).toBe(false);
      expect(/\d/.test(c.evidence)).toBe(false);
    }
    expect(struggleCards(DEMO_FITS.reader).map((c) => c.id)).toEqual(['text', 'faint', 'busy', 'buttons']);
  });

  it('says the web mostly works for someone with nothing strong, and still names busy pages', () => {
    const values = struggleValues(defaultFit());
    expect(anyStrong(values)).toBe(false);
    expect(struggleCards(defaultFit()).map((c) => c.id)).toEqual(['busy']);
    expect(anyStrong(struggleValues(DEMO_FITS.rosa))).toBe(true);
  });

  it('fills the evidence line from their own numbers', () => {
    const ev = evidence({
      reading: { slowdown: 1.42, tooSmallCount: 2 },
      faint: { missedCommonGrey: true },
      pointing: { smallMisses: 3, smallTotal: 8, slips: 4, presses: 60 },
      sites: [site({ name: 'Wikipedia' }), site({ name: 'CNN', busy: true, motionSeen: true })],
      busySlowdown: { ratio: 2.04, busyName: 'CNN', quietName: 'Wikipedia' },
      gotInWay: ['too much on the page'],
    });
    const cards = struggleCards(DEMO_FITS.rosa, ev);
    const line = (id: string): string | undefined => cards.find((c) => c.id === id)?.evidence;
    expect(line('text')).toBe('As the text got smaller, your reading slowed by about 40%.');
    expect(line('buttons')).toBe('You missed 3 of the 8 smaller dots.');
    expect(line('busy')).toBe('Finding something on CNN took you twice as long as on Wikipedia.');
    expect(line('motion')).toBe('Something was moving on CNN while you searched.');
    expect(cards.every((c) => c.measured)).toBe(true);
    expect(evidenceLine('faint', ev)).toBe('You couldn’t make out words in the light grey many websites use.');
    expect(evidenceLine('slips', ev)).toBe('4 of your presses slipped off what you were pressing.');
  });

  it('falls back to the next template with data, then to the fit-only line', () => {
    const ev = evidence({
      reading: { slowdown: null, tooSmallCount: 2 },
      sites: [site({ name: 'Allrecipes', nearMisses: 2, slips: 1, presses: 5 })],
      gotInWay: ['moving things', 'too much on the page'],
    });
    expect(evidenceLine('text', ev)).toBe('Some sentences were too small to read.');
    expect(evidenceLine('buttons', ev)).toBe('Some of your clicks on real sites landed just beside what you aimed for.');
    expect(evidenceLine('slips', ev)).toBe('1 of your presses slipped off what you were pressing.');
    expect(evidenceLine('busy', ev)).toBe('You said there was too much on the page.');
    expect(evidenceLine('motion', ev)).toBe('You said moving things got in your way.');
    expect(evidenceLine('faint', ev)).toBeNull();
    expect(evidenceLine('text', null)).toBeNull();
    const card = struggleCards(DEMO_FITS.reader, ev).find((c) => c.id === 'faint');
    expect(card?.evidence).toBe(FIT_LINES.faint);
    expect(card?.measured).toBe(false);
  });

  it('never shows pixels or technical words', () => {
    const all = [...Object.values(PROBLEM_LINES), ...Object.values(FIX_LINES), ...Object.values(FIT_LINES)];
    for (const s of all) expect(s).not.toMatch(/\bpx\b|pixel|contrast|ratio|threshold/i);
  });
});

describe('numbers rounded for speech', () => {
  it('says slowdowns as rough percentages', () => {
    expect(aboutPercent(1.42)).toBe(40);
    expect(aboutPercent(1.36)).toBe(40);
    expect(aboutPercent(1.12)).toBe(10);
    expect(aboutPercent(1.06)).toBe(5);
    expect(aboutPercent(2.5)).toBe(150);
  });

  it('says ratios in words, with at most one decimal', () => {
    expect(timesWords(2.04)).toBe('twice');
    expect(timesWords(1.9)).toBe('twice');
    expect(timesWords(3.1)).toBe('three times');
    expect(timesWords(1.5)).toBe('1.5 times');
    expect(timesWords(1.62)).toBe('1.5 times');
    expect(timesWords(2.4)).toBe('2.5 times');
    expect(timesWords(1.2)).toBe('1.2 times');
    expect(timesWords(12.4)).toBe('12 times');
    for (const r of [1.17, 1.33, 2.27, 4.6]) expect(timesWords(r)).not.toMatch(/\.\d\d/);
  });

  it('describes amounts in words, never numbers', () => {
    expect(amountWords(90)).toBe('A lot');
    expect(amountWords(55)).toBe('Quite a bit');
    expect(amountWords(30)).toBe('A little');
    expect(amountWords(0)).toBe('Hardly at all');
  });
});

describe('adjusting settings in word levels', () => {
  it('names text sizes in words only', () => {
    expect(TEXT_LEVELS.map((l) => l.label)).toEqual(['Standard', 'Larger', 'Large', 'Extra large', 'Largest']);
    expect(TEXT_LEVELS.map((l) => l.px)).toEqual([16, 18, 20, 24, 28]);
    expect(textLabel(defaultFit())).toBe('Standard');
    expect(textLabel(DEMO_FITS.rosa)).toBe('Extra large'); // 22 sits nearer 24 than 20 by ratio
    expect(textLabel(DEMO_FITS.reader)).toBe('Extra large');
    const big: FitProfile = { ...defaultFit(), text: { ...defaultFit().text, bodyPx: 34 } };
    expect(textLabel(big)).toBe('Largest');
  });

  it('steps text by level and keeps the measured size when stepping back to its level', () => {
    const fit: FitProfile = { ...defaultFit(), text: { ...defaultFit().text, bodyPx: 21 } };
    expect(textLevel(fit)).toBe(2);
    const up = stepText(fit, 1);
    expect(up.text.override).toBe(24);
    expect(up.text.bodyPx).toBe(21);
    expect(stepText(up, -1).text.override).toBeNull();
    expect(stepText(fit, -1).text.override).toBe(18);
    const top = withTextLevel(fit, 4);
    expect(top.text.override).toBe(28);
    expect(canStepText(top, 1)).toBe(false);
    expect(stepText(top, 1)).toBe(top);
    expect(canStepText(defaultFit(), -1)).toBe(false);
  });

  it('names button sizes in words and maps them to Standard, Larger, Largest', () => {
    expect(BUTTON_LEVELS.map((l) => l.label)).toEqual(['Standard', 'Larger', 'Largest']);
    expect(buttonLevel(defaultFit())).toBe('standard');
    expect(buttonLevel(DEMO_FITS.rosa)).toBe('larger');
    expect(buttonLabel(DEMO_FITS.reader)).toBe('Larger');
    const largest = withButtonLevel(defaultFit(), 'largest');
    expect(largest.targets.minPx).toBe(72);
    expect(largest.clicks.steady.radiusPx).toBe(14);
    expect(buttonLevel(largest)).toBe('largest');
    expect(withButtonLevel(largest, 'standard').targets.minPx).toBeNull();
    expect(withButtonLevel(largest, 'larger').targets.minPx).toBe(44);
    // Picking the level they are at keeps a measured size in between.
    expect(withButtonLevel(DEMO_FITS.rosa, 'larger')).toBe(DEMO_FITS.rosa);
  });

  it('moves faint text with its floor, weight and line height', () => {
    const darkest = withFaint(defaultFit(), 'darkest');
    expect(darkest.contrast).toEqual({ band: 'S', floor: 15 });
    expect(darkest.weight.floor).toBe(600);
    expect(darkest.spacing.lineHeight).toBe(1.8);
    expect(faintLevel(darkest)).toBe('darkest');
    const off = withFaint(darkest, 'off');
    expect(off.contrast).toEqual({ band: 'N', floor: 4.5 });
    expect(off.weight.floor).toBe(400);
    expect(faintLevel(withFaint(off, 'darker'))).toBe('darker');
  });

  it('sets light or dark, steady clicks and moving things without changing the original', () => {
    expect(withPolarity(defaultFit(), 'dark').polarity).toEqual({ value: 'dark', stated: 'dark' });
    expect(withSteady(defaultFit(), true).clicks.steady.on).toBe(true);
    expect(withMotion(defaultFit(), true).attention.motion.on).toBe(true);
    const base = defaultFit();
    withMotion(base, true);
    expect(base.attention.motion.on).toBe(false);
  });
});
