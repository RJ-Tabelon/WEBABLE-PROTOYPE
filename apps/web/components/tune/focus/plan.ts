import { seededRandom } from '@webable/core';
import {
  FIND_TEXT_PASSAGES,
  shuffleStimuli,
  type FindTextPassage,
} from '@webable/core/calibration/stimuli';

/**
 * The Focus battery for one person (cal-attention §4), generated from a seed so
 * a session is reproducible. Conditions are counterbalanced with a balanced
 * Latin square; target positions are stratified top / middle / bottom.
 */

export type TemplateId = 'store' | 'news' | 'list' | 'account';
export type Clutter = 'clean' | 'busy';
/** `salient` is the static stand-in for motion under reduced motion. */
export type MotionCondition = 'still' | 'animated' | 'salient';
export type MotionSource = 'carousel' | 'ticker' | 'badge';
export type Stratum = 'top' | 'middle' | 'bottom';

export interface Template {
  id: TemplateId;
  /** Site name shown in the mock page's header. */
  site: string;
  /** Short navigation words in the header (non-interactive decoration). */
  nav: readonly string[];
  /** Section heading above the candidate links. */
  heading: string;
  /** Twelve candidate links; the target is one of them. */
  links: readonly string[];
  /** Busy-variant decoration. */
  promo: string;
  badges: readonly string[];
  side: readonly string[];
  /** Carousel slides and ticker line (static unless the trial moves). */
  slides: readonly string[];
  ticker: string;
}

export const TEMPLATES: Readonly<Record<TemplateId, Template>> = {
  store: {
    id: 'store',
    site: 'Northwind Goods',
    nav: ['Shop', 'Deals', 'Stores', 'Help'],
    heading: 'Shop by department',
    links: [
      'Kitchen',
      'Garden',
      'Gift cards',
      'Lighting',
      'Bedding',
      'Storage',
      'Rugs',
      'Tableware',
      'Outdoor',
      'Office',
      'Bath',
      'Pet supplies',
    ],
    promo: 'Autumn sale, up to 40% off',
    badges: ['New', 'Sale', '2 for 1', 'Popular'],
    side: [
      'Free delivery over $50',
      'Join the members club',
      'Download our app',
    ],
    slides: [
      'Warm throws for cool nights',
      'Fresh herbs, new pots',
      'Desk setups that last',
    ],
    ticker:
      'Free returns for 60 days · Pick up in store today · New arrivals every Friday',
  },
  news: {
    id: 'news',
    site: 'The Morning Ledger',
    nav: ['Home', 'Local', 'World', 'Sport'],
    heading: 'Sections',
    links: [
      'Weather',
      'City council',
      'Schools',
      'Recipes',
      'Travel',
      'Science',
      'Books',
      'Puzzles',
      'Letters',
      'Gardening',
      'Film',
      'Transport',
    ],
    promo: 'Subscribe for $1 a week',
    badges: ['Live', 'New', 'Updated', 'Opinion'],
    side: ['Most read today', 'Newsletter sign-up', 'Listen to the podcast'],
    slides: [
      'Harbor bridge reopens',
      'Library turns 100',
      'Farmers market moves',
    ],
    ticker:
      'Rain later this evening · Road works on Main Street · Market open Saturday',
  },
  list: {
    id: 'list',
    site: 'Harbor Hardware',
    nav: ['Tools', 'Paint', 'Garden', 'Sale'],
    heading: 'Hand tools',
    links: [
      'Claw hammer',
      'Tape measure',
      'Spirit level',
      'Hand saw',
      'Utility knife',
      'Pliers',
      'Wrench set',
      'Chisel set',
      'Screwdrivers',
      'Clamps',
      'Work gloves',
      'Tool bag',
    ],
    promo: 'Trade prices this week only',
    badges: ['Best seller', 'Sale', 'New', 'Limited'],
    side: ['Compare products', 'Recently viewed', 'Ask an expert'],
    slides: [
      'Spring garden kits',
      'Paint colors of the year',
      'Tool hire from $9',
    ],
    ticker:
      'Order by 2 pm for next-day delivery · Free key cutting · Price match promise',
  },
  account: {
    id: 'account',
    site: 'Clearwater Bank',
    nav: ['Accounts', 'Cards', 'Payments', 'Help'],
    heading: 'Your account',
    links: [
      'Statements',
      'Payment methods',
      'Addresses',
      'Order history',
      'Email settings',
      'Password',
      'Linked apps',
      'Alerts',
      'Tax forms',
      'Travel notice',
      'Close account',
      'Contact us',
    ],
    promo: 'Earn 2% back on travel',
    badges: ['New', 'Offer', 'Tip', 'Secure'],
    side: ['Refer a friend', 'Upgrade your card', 'Rate our app'],
    slides: [
      'Pay bills in one place',
      'Round up your savings',
      'Travel without fees',
    ],
    ticker:
      'Mobile check deposit is now instant · Branch hours change on Monday',
  },
};

const TEMPLATE_ORDER: readonly TemplateId[] = [
  'store',
  'news',
  'list',
  'account',
];

export interface SearchPlanTrial {
  practice: boolean;
  template: TemplateId;
  clutter: Clutter;
  motion: MotionCondition;
  /** Mirror the busy page (side panel on the left). */
  mirror: boolean;
  /** Links in display order for this trial. */
  links: readonly string[];
  target: string;
  stratum: Stratum;
  /** Two of the three motion sources on animated trials. */
  sources: readonly MotionSource[];
  /** First carousel advance, ms after onset (500-1500). */
  firstAdvanceMs: number;
}

/** Link indices per stratum for a 12-link list (DOM order). */
const STRATA: Readonly<Record<Stratum, readonly number[]>> = {
  top: [0, 1, 2],
  middle: [3, 4, 5, 6, 7, 8],
  bottom: [9, 10, 11],
};
const STRATUM_ORDER: readonly Stratum[] = ['top', 'middle', 'bottom'];

/** Balanced 4x4 Latin square over the 2x2 clutter x motion cells. */
const LATIN: readonly (readonly number[])[] = [
  [0, 1, 3, 2],
  [1, 2, 0, 3],
  [2, 3, 1, 0],
  [3, 0, 2, 1],
];

const SOURCE_PAIRS: readonly (readonly MotionSource[])[] = [
  ['carousel', 'ticker'],
  ['ticker', 'badge'],
  ['carousel', 'badge'],
];

function cell(
  index: number,
  moving: MotionCondition,
): {
  clutter: Clutter;
  motion: MotionCondition;
} {
  // 0 clean/still, 1 clean/moving, 2 busy/still, 3 busy/moving
  return {
    clutter: index >= 2 ? 'busy' : 'clean',
    motion: index % 2 === 1 ? moving : 'still',
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

/**
 * Twelve scored "Find it" trials plus one practice (clean, still):
 * 2 clutter x 2 motion x 3, in three mini-blocks of four. Under reduced motion
 * the motion factor becomes a static salient block (`salient`).
 */
export function planSearch(
  seed: number,
  reducedMotion: boolean,
): SearchPlanTrial[] {
  const random = seededRandom(seed);
  const moving: MotionCondition = reducedMotion ? 'salient' : 'animated';
  const row = Math.floor(random() * LATIN.length);
  const templates = shuffleStimuli(TEMPLATE_ORDER, random);
  const used = new Map<TemplateId, Set<string>>();

  const trial = (
    index: number,
    clutter: Clutter,
    motion: MotionCondition,
    stratum: Stratum,
    practice: boolean,
  ): SearchPlanTrial => {
    const template = TEMPLATES[templates[index % templates.length] ?? 'store'];
    const taken = used.get(template.id) ?? new Set<string>();
    used.set(template.id, taken);
    const pool = template.links.filter((l) => !taken.has(l));
    const target = pick(pool.length > 0 ? pool : template.links, random);
    taken.add(target);
    // Shuffle the others, then place the target inside its stratum.
    const others = shuffleStimuli(
      template.links.filter((l) => l !== target),
      random,
    );
    const slot = pick(STRATA[stratum], random);
    const links = [...others.slice(0, slot), target, ...others.slice(slot)];
    return {
      practice,
      template: template.id,
      clutter,
      motion,
      mirror: random() < 0.5,
      links,
      target,
      stratum,
      sources:
        motion === 'animated'
          ? (SOURCE_PAIRS[index % SOURCE_PAIRS.length] ?? [
              'carousel',
              'ticker',
            ])
          : [],
      firstAdvanceMs: Math.round(500 + random() * 1000),
    };
  };

  const trials: SearchPlanTrial[] = [
    trial(0, 'clean', 'still', 'middle', true),
  ];
  for (let block = 0; block < 3; block++) {
    const order = LATIN[(row + block) % LATIN.length] ?? [0, 1, 2, 3];
    for (const c of order) {
      const { clutter, motion } = cell(c, moving);
      const stratum = STRATUM_ORDER[(block + c) % 3] ?? 'middle';
      trials.push(trial(trials.length, clutter, motion, stratum, false));
    }
  }
  return trials;
}

/* ---------- Task B: What's next? ---------- */

export type FlowId = 'checkout' | 'signup' | 'settings' | 'article';

export interface FlowSpec {
  id: FlowId;
  /** Page title inside the mock. */
  title: string;
  /** Summary lines shown above the buttons. */
  lines: readonly string[];
  /** The goal, stated without the target's label. */
  goal: string;
  target: string;
  decoy: string;
  others: readonly string[];
}

export const FLOWS: Readonly<Record<FlowId, FlowSpec>> = {
  checkout: {
    id: 'checkout',
    title: 'Your basket',
    lines: ['2 items', 'Delivery: Thursday', 'Total: $48.00'],
    goal: 'You’ve picked your items. Go to payment.',
    target: 'Proceed',
    decoy: 'Get the app',
    others: ['Keep shopping'],
  },
  signup: {
    id: 'signup',
    title: 'Create your account',
    lines: ['Name: filled in', 'Email: filled in', 'Password: filled in'],
    goal: 'You’ve filled in your details. Finish signing up.',
    target: 'Continue',
    decoy: 'Try Premium free',
    others: ['Clear form'],
  },
  settings: {
    id: 'settings',
    title: 'Email settings',
    lines: ['Weekly summary: on', 'Offers: off', 'Reminders: on'],
    goal: 'You changed your email settings. Keep the changes.',
    target: 'Apply',
    decoy: 'Upgrade plan',
    others: ['Discard'],
  },
  article: {
    id: 'article',
    title: 'How rivers shape a valley',
    lines: ['Page 1 of 3', 'About a 4 minute read', 'By the science desk'],
    goal: 'You’ve read the first page. Go on to the rest.',
    target: 'Keep reading',
    decoy: 'Subscribe now',
    others: ['Share'],
  },
};

export interface NextPlanTrial {
  flow: FlowId;
  hierarchy: 'weak' | 'strong';
  /** Whether the decoy sits just before the target (weak: always adjacent). */
  decoyFirst: boolean;
}

/** 2 hierarchy x 2 repetitions, counterbalanced; flows rotate across conditions. */
export function planNextAction(seed: number): NextPlanTrial[] {
  const random = seededRandom(seed ^ 0x9e3779b1);
  const flows = shuffleStimuli<FlowId>(
    ['checkout', 'signup', 'settings', 'article'],
    random,
  );
  const order: Array<'weak' | 'strong'> =
    random() < 0.5
      ? ['weak', 'strong', 'strong', 'weak']
      : ['strong', 'weak', 'weak', 'strong'];
  return flows.map((flow, i) => ({
    flow,
    hierarchy: order[i] ?? 'weak',
    decoyFirst: random() < 0.5,
  }));
}

/* ---------- Task C: Find in text ---------- */

export interface TextPlanTrial {
  passage: FindTextPassage;
  format: 'dense' | 'chunked';
}

/** Two passages, one per format, pairing and order counterbalanced. */
export function planFindText(seed: number): TextPlanTrial[] {
  const random = seededRandom(seed ^ 0x85ebca6b);
  const passages = shuffleStimuli(FIND_TEXT_PASSAGES, random).slice(0, 2);
  const formats: Array<'dense' | 'chunked'> =
    random() < 0.5 ? ['dense', 'chunked'] : ['chunked', 'dense'];
  return passages.map((passage, i) => ({
    passage,
    format: formats[i] ?? 'dense',
  }));
}

/* ---------- Task D: Which worked better for you? ---------- */

export type PairId = 'still' | 'clean' | 'chunked' | 'hierarchy';

export interface PairPlan {
  id: PairId;
  question: string;
  /** Whether the adapted version (still, clean, chunked, strong) is Version 1. */
  adaptedFirst: boolean;
}

export const PAIR_QUESTIONS: Readonly<Record<PairId, string>> = {
  still: 'Which was easier to focus on?',
  clean: 'Which would you rather shop on?',
  chunked: 'Which was easier to find things in?',
  hierarchy: 'Which made the next step clearer?',
};

export function planPairs(seed: number): PairPlan[] {
  const random = seededRandom(seed ^ 0xc2b2ae35);
  return (['still', 'clean', 'chunked', 'hierarchy'] as const).map((id) => ({
    id,
    question: PAIR_QUESTIONS[id],
    adaptedFirst: random() < 0.5,
  }));
}

/** Scale answer relative to Version 1 (+2 clearly Version 1 ... -2 clearly Version 2). */
export type ScaleAnswer = -2 | -1 | 0 | 1 | 2;

/** Preference oriented so a positive value favours the adapted version. */
export function orientedPreference(
  answer: ScaleAnswer,
  adaptedFirst: boolean,
): number {
  const value = adaptedFirst ? answer : -answer;
  return value === 0 ? 0 : value;
}
