// Test fixtures for `decide`: a realistic article page with three ambiguous
// regions and two main-content candidates. Every word is from VOCAB_V1
// (fixtures.test.ts asserts it), so the fixture is exactly what a correct
// extension would send.

import type {
  DecideRequest,
  PageContext,
  RegionEvidence,
} from '../_shared/core.bundle.js';

export const PAGE: PageContext = {
  signals: ['og_type_article', 'readerable', 'has_site_search'],
  main: { found_by: 'readability', zone: 'center_column', width: '30-60%' },
  counts: {
    regions: '11-30',
    links: '>100',
    buttons: '11-30',
    text_inputs: '1',
    forms: '1',
    required_fields: '0',
    headings: '11-30',
    images: '11-30',
    videos: '0',
    text_amount: '10k-50k chars',
  },
  layout: {
    viewport: 'desktop',
    page_height: '3-10 screens',
    pinned_bars: '2',
  },
};

const BASE: RegionEvidence = {
  zone: 'right_rail',
  width: '15-30%',
  height: '1-3 screens',
  pinned: 'no',
  landmark: 'complementary',
  tag: 'aside',
  dom_position: 'after_main',
  links: '11-30',
  link_density: 'high',
  text_amount: '500-2k chars',
  buttons: '0',
  inputs: '0',
  required_fields: false,
  repeated_cards: '4-8',
  images: '4-10',
  video: false,
  iframe_kind: 'none',
  motion: 'none',
  class_words: ['sidebar', 'related'],
  heading_words: 'most popular',
  control_words: [],
};

export function evidence(
  overrides: Partial<RegionEvidence> = {},
): RegionEvidence {
  return { ...BASE, ...overrides };
}

/** A related-stories rail, a chat launcher and a sticky site header. */
export const REGIONS: DecideRequest['regions'] = [
  { rid: 'r1', ev: evidence() },
  {
    rid: 'r2',
    ev: evidence({
      zone: 'overlay_corner',
      width: '<15%',
      height: '<0.1 screens',
      pinned: 'fixed',
      landmark: 'none',
      tag: 'div',
      dom_position: 'unknown',
      links: '0',
      link_density: 'none',
      text_amount: '<100 chars',
      buttons: '1',
      repeated_cards: '0',
      images: '0',
      iframe_kind: 'chat_vendor',
      class_words: ['chat', 'launcher'],
      heading_words: '',
      control_words: ['open chat'],
    }),
  },
  {
    rid: 'r3',
    ev: evidence({
      zone: 'header_band',
      width: '>90%',
      height: '<0.1 screens',
      pinned: 'sticky',
      landmark: 'banner',
      tag: 'header',
      dom_position: 'before_main',
      links: '4-10',
      link_density: 'mid',
      text_amount: '<100 chars',
      buttons: '2-3',
      inputs: '1',
      repeated_cards: '0',
      images: '1',
      class_words: ['site', 'header'],
      heading_words: '·',
      control_words: ['menu', 'search', 'sign in'],
    }),
  },
];

export const MAIN_CANDIDATES: NonNullable<DecideRequest['mainCandidates']> = [
  {
    cid: 'c1',
    ev: evidence({
      zone: 'center_column',
      width: '30-60%',
      height: '>3 screens',
      landmark: 'none',
      tag: 'article',
      dom_position: 'unknown',
      links: '4-10',
      link_density: 'low',
      text_amount: '>2k chars',
      repeated_cards: '0',
      images: '2-3',
      class_words: ['story', 'body'],
      heading_words: 'the · of',
    }),
  },
  { cid: 'c2', ev: evidence() },
];

export function decideRequest(
  overrides: Partial<DecideRequest> = {},
): DecideRequest {
  return {
    v: 1,
    catalog: 'wa-cat-1.0.0',
    lang: 'en',
    page: PAGE,
    regions: REGIONS,
    mainCandidates: MAIN_CANDIDATES,
    ask: { pageType: true },
    ...overrides,
  };
}

/** Every vocabulary word the fixtures send (for the fixture self-check). */
export function fixtureWords(req: DecideRequest): string[] {
  const words: string[] = [];
  const all = [
    ...req.regions.map((r) => r.ev),
    ...(req.mainCandidates ?? []).map((c) => c.ev),
  ];
  for (const ev of all) {
    words.push(...ev.class_words);
    for (const phrase of [ev.heading_words, ...ev.control_words])
      for (const token of phrase.split(' '))
        if (token && token !== '·') words.push(token);
  }
  return words;
}
