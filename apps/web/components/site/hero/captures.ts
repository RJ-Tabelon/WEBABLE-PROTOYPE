/**
 * The hero's pictures: real screenshots of three busy public pages in Chrome,
 * as the site made them and with the WebAble extension on. They were taken on
 * 18 November 2026 with the extension in this repo (apps/extension, the Gator
 * Hack engine) and its server running (Jev and the writing models on), at a
 * 1280 x 800 window and 2x pixels.
 *
 * The person is the setup's own sample: the demo fit (`__fitting.finish('rosa')`:
 * larger text, bigger buttons, busy pages slow them down) plus the sample
 * ChatGPT answer in scripts/engine/reword/fixtures/maya.txt (short numbered
 * steps, plain words, money terms explained).
 *
 * Each change below is a line from the extension's own record of that page
 * view (its ledger), in its own words. The one sum: on CBS News the ledger
 * lists each dimmed ad on its own line, and the 7 here is their total. Nothing
 * is estimated. Retake the pictures and these lines together.
 */

export type SiteId = 'cfpb' | 'cbs' | 'npr';

/** A size WebAble changed, shown as before and after. */
export interface SizeChange {
  label: string;
  from: number;
  to: number;
  unit: 'px' | '%';
}

/** Anything else WebAble did, in the sentence its record uses. */
export interface DoneChange {
  said: string;
}

export type CaptureChange = SizeChange | DoneChange;

export function isSizeChange(c: CaptureChange): c is SizeChange {
  return 'from' in c;
}

export interface HeroSite {
  id: SiteId;
  /** The site's name, for the site switch. */
  name: string;
  /** What the address bar shows. */
  domain: string;
  original: { src: string; alt: string };
  fitted: { src: string; alt: string };
  /** What WebAble did on this page view, from its record. */
  changes: readonly CaptureChange[];
}

export const CAPTURED_ON = '18 November 2026';

/** The pictures' pixel size (a 1280 x 800 window at 2x). */
export const CAPTURE_SIZE = { width: 2560, height: 1600 } as const;

export const HERO_SITES: readonly HeroSite[] = [
  {
    id: 'npr',
    name: 'NPR',
    domain: 'npr.org',
    original: {
      src: '/hero/npr-original.webp',
      alt: 'An NPR story as the site made it: menus, a station player, a donate button and a large film advert beside the headline and photo.',
    },
    fitted: {
      src: '/hero/npr-fitted.webp',
      alt: 'The same story with WebAble on, in its simpler version: just the date, the headline, the writer and the photo in large text, with no menus or adverts.',
    },
    changes: [
      {
        said: 'This is a page for reading, so WebAble opened its simpler version',
      },
      { said: 'Rewrote 17 paragraphs the way you like things explained' },
      { said: 'Laid out 5 parts of this page in a clearer way for you' },
      { label: 'Text size', from: 18, to: 22, unit: 'px' },
    ],
  },
  {
    id: 'cfpb',
    name: 'CFPB',
    domain: 'consumerfinance.gov',
    original: {
      src: '/hero/cfpb-original.webp',
      alt: 'The Consumer Financial Protection Bureau’s page “What is a credit score?” as the site made it: what affects a credit score is a plain list in small text.',
    },
    fitted: {
      src: '/hero/cfpb-fitted.webp',
      alt: 'The same page with WebAble on: in large text, what affects a credit score is laid out in two columns, each with an icon, a short name and a plain sentence, like Bills: your bill-paying history. Past problems, like a debt sent to collection, follow in their own group.',
    },
    changes: [
      {
        said: 'This is a page for reading, so WebAble opened its simpler version',
      },
      { said: 'Laid out 4 parts of this page in a clearer way for you' },
      { said: 'Rewrote 2 paragraphs the way you like things explained' },
      { label: 'Text size', from: 16, to: 22, unit: 'px' },
    ],
  },
  {
    id: 'cbs',
    name: 'CBS News',
    domain: 'cbsnews.com',
    original: {
      src: '/hero/cbs-original.webp',
      alt: 'A CBS News story about panic buying at Costco as the site made it, with words like “pantry-loading” and “high-ticket generators” left unexplained, and videos and stories down the side.',
    },
    fitted: {
      src: '/hero/cbs-fitted.webp',
      alt: 'The same story with WebAble on: paragraphs rewritten in plainer words, each marked with a green line, and terms explained in brackets, like “pantry-loading” [buying extra food and supplies].',
    },
    changes: [
      { said: 'Rewrote 7 paragraphs the way you like things explained' },
      { said: 'Dimmed 7 ads, promotions and teasers' },
      { said: 'Made 38 buttons and links easier to hit' },
    ],
  },
];
