// Plausible RunEvidence for core's demo fits, so the results page can be shown (screenshots, `__fitting.finish(name)`)
// without anyone doing the tasks. The numbers match what each demo fit says about the person.

import type { DEMO_FITS } from '@webable/core';
import type { SiteTaskResult } from '../../../src/sitetask/types';
import type { RunEvidence } from './evidence';

export type DemoName = keyof typeof DEMO_FITS;

function site(
  id: string,
  name: string,
  busy: boolean,
  ms: number | null,
  more: Partial<SiteTaskResult> = {},
): SiteTaskResult {
  return {
    id,
    name,
    busy,
    found: ms != null,
    skipped: false,
    ms,
    wrongClicks: 0,
    nearMisses: 0,
    slips: 0,
    presses: ms != null ? 1 : 0,
    scrollScreens: 0,
    motionSeen: false,
    adsSeen: busy ? 6 : 0,
    ...more,
  };
}

export function demoEvidence(name: DemoName): RunEvidence {
  if (name === 'typical') {
    return {
      reading: { slowdown: 1.08, tooSmallCount: 0 },
      faint: { missedCommonGrey: false },
      pointing: { smallMisses: 1, smallTotal: 16, slips: 0, presses: 54 },
      sites: [
        site('wikipedia', 'Wikipedia', false, 4200, { presses: 1 }),
        site('cnn', 'CNN', true, 5600, { presses: 2, wrongClicks: 1, scrollScreens: 0.6, adsSeen: 7, motionSeen: true }),
        site('allrecipes', 'Allrecipes', true, 4900, { presses: 1, scrollScreens: 0.4, adsSeen: 9 }),
      ],
      busySlowdown: { ratio: 1.17, busyName: 'Allrecipes', quietName: 'Wikipedia' },
      gotInWay: [],
    };
  }
  if (name === 'reader') {
    return {
      reading: { slowdown: 1.55, tooSmallCount: 2 },
      faint: { missedCommonGrey: true },
      pointing: { smallMisses: 2, smallTotal: 16, slips: 1, presses: 58 },
      sites: [
        site('wikipedia', 'Wikipedia', false, 7400, { presses: 2, scrollScreens: 1.2 }),
        site('cnn', 'CNN', true, 16800, { presses: 3, wrongClicks: 2, scrollScreens: 2.5, adsSeen: 9, motionSeen: true }),
        site('allrecipes', 'Allrecipes', true, 13900, { presses: 2, wrongClicks: 1, scrollScreens: 1.8, adsSeen: 8 }),
      ],
      busySlowdown: { ratio: 2.27, busyName: 'CNN', quietName: 'Wikipedia' },
      gotInWay: ['small text', 'too much on the page'],
    };
  }
  // rosa: larger text, darker grey, bigger buttons, steady clicks, calm busy pages, motion paused.
  return {
    reading: { slowdown: 1.42, tooSmallCount: 1 },
    faint: { missedCommonGrey: true },
    pointing: { smallMisses: 7, smallTotal: 18, slips: 6, presses: 71 },
    sites: [
      site('wikipedia', 'Wikipedia', false, 8100, { presses: 2, nearMisses: 1, slips: 1, scrollScreens: 0.8 }),
      site('cnn', 'CNN', true, 24300, { presses: 5, wrongClicks: 3, nearMisses: 1, slips: 1, scrollScreens: 3, adsSeen: 11, motionSeen: true }),
      site('allrecipes', 'Allrecipes', true, 19600, { presses: 4, wrongClicks: 2, scrollScreens: 2.2, adsSeen: 9, motionSeen: true }),
    ],
    busySlowdown: { ratio: 3, busyName: 'CNN', quietName: 'Wikipedia' },
    gotInWay: ['moving things', 'too much on the page', 'popups'],
  };
}
