/**
 * "One page, fitted to three different people": real screenshots of one NPR
 * story in Chrome with WebAble on, for three sample people. They were taken on
 * 18 November 2026 with the extension in this repo (apps/extension) and its
 * server running, at a 1280 x 800 window and 2x pixels. Each picture is a
 * 1440 x 1200 crop of the same passage in WebAble's simpler version: the story
 * is a page for reading, so the simpler version opened for all three.
 *
 * The people are samples, not study participants. Each is the setup's default
 * fit with a few answers changed:
 * - reading: text 24 px, strongest contrast, semibold text.
 * - dark: text 20 px, dark pages.
 * - plain: text 18 px, moving things paused, busy pages calmed, plus the sample
 *   ChatGPT answer in scripts/engine/reword/fixtures/maya.txt (plain words,
 *   terms explained).
 *
 * Each change is a line from the extension's own record of that page view (its
 * ledger), in its own words, with two exceptions. "Light or dark" is the dark
 * person's fit as the extension words it (`describeFit`): the simpler version
 * takes its colours from the fit, so the record has no line for it. And the
 * plain person's 5 is a sum: the record lists four ads on their own lines and
 * then "1 more". Retake the pictures and these lines together.
 */

export type FitPersonId = 'reading' | 'dark' | 'plain';

/** A value WebAble changed, shown as before and after. */
export interface FitValueChange {
  label: string;
  from: number | string;
  to: number | string;
  unit?: 'px' | '%';
}

/** Anything else WebAble did, in the sentence its record uses. */
export interface FitDoneChange {
  said: string;
}

export type FitChange = FitValueChange | FitDoneChange;

export function isDoneChange(c: FitChange): c is FitDoneChange {
  return 'said' in c;
}

export interface FitPerson {
  id: FitPersonId;
  /** What gets in this person's way, in their words. */
  struggle: string;
  shot: { src: string; alt: string };
  changes: readonly FitChange[];
}

export const FITS_CAPTURED_ON = '18 November 2026';

/** The pictures' pixel size (a crop of a 1280-wide window at 2x). */
export const FITS_SHOT_SIZE = { width: 1440, height: 1200 } as const;

export const FIT_PEOPLE: readonly FitPerson[] = [
  {
    id: 'reading',
    struggle: 'Small text is tiring to read',
    shot: {
      src: '/home/fits/npr-reading.webp',
      alt: 'An NPR story about Instagram in schools, in WebAble’s simpler version for someone who finds small text tiring: large, heavy black text on white.',
    },
    changes: [
      { label: 'Text size', from: 18, to: 24, unit: 'px' },
      { said: 'Darkened 91 faint text items to at least 15:1 contrast' },
      { said: 'Thin text is a little heavier (at least 500)' },
    ],
  },
  {
    id: 'dark',
    struggle: 'Bright white pages are hard on the eyes',
    shot: {
      src: '/home/fits/npr-dark.webp',
      alt: 'The same passage for someone who finds bright pages hard on the eyes: light text on a dark page.',
    },
    changes: [
      { label: 'Light or dark', from: 'Site colours', to: 'Dark pages' },
      { said: 'Long lines are shorter (about 66 letters)' },
      { said: 'Made 5 headings larger so they stand out from the text' },
    ],
  },
  {
    id: 'plain',
    struggle: 'Hard words make stories hard to follow',
    shot: {
      src: '/home/fits/npr-plain.webp',
      alt: 'The same passage for someone who asked for plain words: paragraphs rewritten, each marked with a green line, with terms explained in brackets, like “Online safety experts (people who protect kids online)”.',
    },
    changes: [
      { said: 'Rewrote 15 paragraphs the way you like things explained' },
      { said: 'Animations and transitions jump straight to their end' },
      { said: 'Dimmed 5 ads, promotions and teasers' },
    ],
  },
];
