import {
  JEV_ENDPOINT,
  JEV_REQUEST_ID_HEADER,
  type JevAnswer,
  type JevChoiceAnswer,
  type JevLevel,
  type JevQuestion,
  type JevRequest,
  type JevResponse,
  type JevScoreAnswer,
} from '../jev/api';
import {
  PAGE_CATEGORIES,
  REGION_ROLES,
  type PageCategory,
  type RegionRole,
} from '../page/types';
import { JEV_PINNED_MODEL } from '../versions';

/**
 * A deterministic, contract-faithful stand-in for TypeSafe Jev (System One).
 *
 * It produces plausible probabilities from the same structural evidence the
 * real model sees (class and heading words, zones, pinning, link density,
 * iframe kinds, page signals) and returns them exactly as the real API shapes
 * them: Choice answers carry `choice` (argmax), `confidence = (N*p_max - 1)/(N - 1)`
 * and `probabilities` quantised to 0.01 that sum to 1; Noul answers carry only
 * `noul`; the envelope carries `model` and `usage`.
 *
 * It is not a model of Jev's accuracy. It exists so the Edge Function, the
 * policy and the extension can be exercised end to end without an API key.
 */

export interface MockJevOptions {
  /** Resolved model reported in the response. Default: the pinned model for every requested id. */
  model?: string;
}

type Evidence = {
  zone?: string;
  width?: string;
  height?: string;
  pinned?: string;
  landmark?: string;
  tag?: string;
  dom_position?: string;
  links?: string;
  link_density?: string;
  text_amount?: string;
  buttons?: string;
  inputs?: string;
  required_fields?: boolean;
  repeated_cards?: string;
  images?: string;
  video?: boolean;
  iframe_kind?: string;
  motion?: string;
  words: Set<string>;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

function readEvidence(value: unknown): Evidence | null {
  if (!isObject(value)) return null;
  const words = new Set<string>();
  const addPhrase = (phrase: unknown) => {
    if (typeof phrase !== 'string') return;
    for (const w of phrase.split(/\s+/)) if (w && w !== '·') words.add(w);
  };
  if (Array.isArray(value.class_words))
    for (const w of value.class_words) addPhrase(w);
  addPhrase(value.heading_words);
  if (Array.isArray(value.control_words))
    for (const w of value.control_words) addPhrase(w);
  return {
    zone: str(value.zone),
    width: str(value.width),
    height: str(value.height),
    pinned: str(value.pinned),
    landmark: str(value.landmark),
    tag: str(value.tag),
    dom_position: str(value.dom_position),
    links: str(value.links),
    link_density: str(value.link_density),
    text_amount: str(value.text_amount),
    buttons: str(value.buttons),
    inputs: str(value.inputs),
    required_fields:
      typeof value.required_fields === 'boolean'
        ? value.required_fields
        : undefined,
    repeated_cards: str(value.repeated_cards),
    images: str(value.images),
    video: typeof value.video === 'boolean' ? value.video : undefined,
    iframe_kind: str(value.iframe_kind),
    motion: str(value.motion),
    words,
  };
}

// ---------------------------------------------------------------------------
// Evidence -> logits
// ---------------------------------------------------------------------------

/** Word cues per role. Each role takes at most its two strongest matching cues. */
const ROLE_WORDS: Record<RegionRole, Record<string, number>> = {
  main_content: {
    article: 2,
    content: 1.2,
    main: 1.5,
    post: 1,
    story: 1.2,
    body: 1,
    entry: 1,
    results: 1.5,
    product: 1,
    details: 0.8,
  },
  navigation: {
    nav: 2.5,
    navbar: 2.5,
    navigation: 2.5,
    menu: 2,
    menus: 2,
    breadcrumb: 2.5,
    breadcrumbs: 2.5,
    pagination: 2.5,
    pager: 2.5,
    toc: 2,
    contents: 1.2,
    filter: 1.5,
    filters: 1.5,
    sort: 1.5,
    categories: 1.2,
    sections: 1,
    tabs: 1,
    next: 0.8,
    previous: 0.8,
    home: 0.8,
  },
  promo_ad: {
    ad: 3,
    ads: 3,
    advert: 3,
    advertisement: 3.5,
    advertising: 3,
    sponsored: 3.5,
    sponsor: 3,
    promoted: 3.5,
    promo: 2.5,
    promotion: 2.5,
    sale: 1.5,
    deal: 1.5,
    deals: 1.5,
    offer: 1.5,
    offers: 1.5,
    discount: 1.5,
    coupon: 1.5,
    newsletter: 2.5,
    subscribe: 2,
    signup: 1.5,
    install: 1.5,
    app: 0.8,
    paid: 2,
    affiliate: 2,
    native: 1,
    banner: 0.8,
  },
  recommendations: {
    related: 3,
    recommended: 3,
    recommendations: 3,
    recommend: 2.5,
    trending: 2.5,
    popular: 2.5,
    suggested: 2.5,
    picks: 2,
    similar: 2,
    also: 1.2,
    more: 1,
    stories: 1,
    read: 0.8,
    watch: 0.8,
    next: 0.5,
    most: 0.8,
    teaser: 1.5,
    teasers: 1.5,
    sidebar: 0.6,
  },
  chat_widget: {
    chat: 3.5,
    chatbot: 3.5,
    messenger: 3,
    launcher: 3,
    conversation: 2.5,
    message: 1.5,
    messages: 1.5,
    live: 1,
    agent: 1.5,
    assistant: 1.5,
    bot: 2,
  },
  consent_banner: {
    cookie: 3.5,
    cookies: 3.5,
    consent: 3.5,
    privacy: 1.5,
    accept: 2,
    reject: 2,
    decline: 2,
    manage: 1.2,
    preferences: 1.5,
    necessary: 2,
    essential: 1.5,
    tracking: 1.5,
    partners: 1.2,
    legitimate: 2,
    interest: 1,
    agree: 1.5,
  },
  help_contact: {
    help: 3,
    support: 3,
    contact: 3,
    faq: 3,
    faqs: 3,
    feedback: 2.5,
    accessibility: 2.5,
    questions: 1.5,
    helpdesk: 3,
    call: 1,
    email: 1,
    hours: 1,
    care: 1,
  },
  form: {
    form: 2.5,
    submit: 2.5,
    checkout: 2.5,
    shipping: 1.5,
    address: 1.5,
    sign: 1,
    signin: 2,
    login: 2,
    register: 2,
    password: 2,
    apply: 1.5,
    booking: 1.5,
    reserve: 1.5,
    required: 1.5,
    field: 1.5,
    fields: 1.5,
  },
  footer: {
    footer: 3,
    copyright: 3,
    terms: 1.5,
    legal: 1.5,
    rights: 2,
    reserved: 2,
    sitemap: 2,
    careers: 1.2,
    about: 0.8,
    social: 1,
    privacy: 0.8,
  },
  other: {
    comments: 2.5,
    comment: 2.5,
    author: 1.5,
    bio: 1.5,
    player: 2,
    video: 1,
    logo: 1.2,
    share: 1,
  },
};

const HELP_WORDS = new Set([
  'help',
  'support',
  'contact',
  'faq',
  'faqs',
  'feedback',
  'accessibility',
  'helpdesk',
]);
const AD_WORDS = new Set([
  'ad',
  'ads',
  'advert',
  'advertisement',
  'advertising',
  'sponsored',
  'sponsor',
  'promoted',
  'promo',
  'paid',
]);
const REC_WORDS = new Set([
  'related',
  'recommended',
  'recommendations',
  'trending',
  'popular',
  'suggested',
  'picks',
  'also',
  'similar',
]);
const TASK_WORDS = new Set([
  'filter',
  'filters',
  'sort',
  'pagination',
  'pager',
  'next',
  'previous',
  'cart',
  'checkout',
  'search',
  'player',
]);
const PROMPT_WORDS = new Set(['newsletter', 'subscribe', 'signup', 'install']);
const CONSENT_WORDS = new Set([
  'cookie',
  'cookies',
  'consent',
  'accept',
  'reject',
]);

const has = (words: Set<string>, set: Set<string>) =>
  [...words].some((w) => set.has(w));
const bucketAtLeast = (
  value: string | undefined,
  order: readonly string[],
  min: string,
) => value !== undefined && order.indexOf(value) >= order.indexOf(min);
const COUNT_ORDER = [
  '0',
  '1',
  '2-3',
  '4-10',
  '11-30',
  '31-100',
  '>100',
] as const;
const CARDS_ORDER = ['0', '2-3', '4-8', '>8'] as const;
const TEXT_ORDER = [
  '0',
  '<100 chars',
  '100-500 chars',
  '500-2k chars',
  '>2k chars',
] as const;

function wordScore(words: Set<string>, table: Record<string, number>): number {
  const hits = [...words]
    .map((w) => table[w] ?? 0)
    .filter((x) => x > 0)
    .sort((a, b) => b - a);
  return (hits[0] ?? 0) + 0.5 * (hits[1] ?? 0);
}

function roleLogits(ev: Evidence): Record<RegionRole, number> {
  const L: Record<RegionRole, number> = {
    main_content: -0.5,
    navigation: 0,
    promo_ad: 0,
    recommendations: 0,
    chat_widget: -1,
    consent_banner: -1,
    help_contact: -0.5,
    form: -1,
    footer: -1,
    other: 0.6,
  };
  for (const role of REGION_ROLES)
    L[role] += wordScore(ev.words, ROLE_WORDS[role]);

  switch (ev.landmark) {
    case 'navigation':
      L.navigation += 3;
      break;
    case 'contentinfo':
      L.footer += 3.5;
      break;
    case 'main':
      L.main_content += 3.5;
      break;
    case 'complementary':
      L.recommendations += 0.7;
      L.promo_ad += 0.5;
      break;
    case 'banner':
      L.navigation += 1.5;
      L.other += 0.5;
      break;
    case 'search':
      L.navigation += 1;
      L.form += 1.5;
      break;
    case 'form':
      L.form += 2.5;
      break;
    case 'dialog':
      L.consent_banner += 1;
      L.promo_ad += 1;
      L.chat_widget += 0.5;
      break;
    default:
      break;
  }
  switch (ev.tag) {
    case 'nav':
      L.navigation += 2;
      break;
    case 'footer':
      L.footer += 2;
      break;
    case 'aside':
      L.recommendations += 0.8;
      L.promo_ad += 0.5;
      break;
    case 'form':
      L.form += 2;
      break;
    case 'iframe':
      L.promo_ad += 0.8;
      L.chat_widget += 0.3;
      break;
    case 'article':
      L.main_content += 1.5;
      break;
    case 'header':
      L.navigation += 1;
      break;
    case 'dialog':
      L.consent_banner += 0.8;
      L.promo_ad += 0.8;
      break;
    case 'ul':
      L.navigation += 0.5;
      L.recommendations += 0.3;
      break;
    default:
      break;
  }
  switch (ev.zone) {
    case 'left_rail':
      L.navigation += 0.8;
      L.recommendations += 0.6;
      L.promo_ad += 0.4;
      L.main_content -= 1.5;
      break;
    case 'right_rail':
      L.recommendations += 0.8;
      L.promo_ad += 0.6;
      L.main_content -= 1.5;
      break;
    case 'header_band':
      L.navigation += 1.5;
      L.main_content -= 1;
      break;
    case 'footer_band':
      L.footer += 2;
      L.main_content -= 1;
      break;
    case 'center_column':
      L.main_content += 1.5;
      break;
    case 'full_width_mid':
      L.main_content += 0.3;
      L.promo_ad += 0.3;
      break;
    case 'overlay_bottom':
      L.consent_banner += 1.5;
      L.promo_ad += 0.5;
      break;
    case 'overlay_corner':
      L.chat_widget += 2.5;
      L.promo_ad += 0.3;
      break;
    case 'overlay_center':
      L.consent_banner += 1;
      L.promo_ad += 1;
      break;
    case 'overlay_top':
      L.consent_banner += 0.6;
      L.promo_ad += 0.6;
      L.navigation += 0.4;
      break;
    default:
      break;
  }
  if (ev.pinned === 'fixed' || ev.pinned === 'sticky') {
    L.chat_widget += 0.5;
    L.consent_banner += 0.5;
    L.promo_ad += 0.3;
    L.main_content -= 1;
  }
  switch (ev.iframe_kind) {
    case 'ad_network':
      L.promo_ad += 4;
      break;
    case 'chat_vendor':
      L.chat_widget += 4.5;
      break;
    case 'video_host':
      L.other += 2;
      break;
    case 'social_embed':
      L.other += 1;
      L.recommendations += 0.5;
      break;
    case 'map':
      L.other += 2;
      break;
    default:
      break;
  }
  if (bucketAtLeast(ev.repeated_cards, CARDS_ORDER, '4-8'))
    L.recommendations += 1.2;
  else if (ev.repeated_cards === '2-3') L.recommendations += 0.4;
  switch (ev.link_density) {
    case 'high':
      L.navigation += 0.8;
      L.recommendations += 0.8;
      L.footer += 0.4;
      L.main_content -= 1;
      break;
    case 'mid':
      L.recommendations += 0.3;
      break;
    case 'low':
    case 'none':
      L.main_content += 0.4;
      break;
    default:
      break;
  }
  if (ev.text_amount === '>2k chars') L.main_content += 2;
  else if (ev.text_amount === '500-2k chars') L.main_content += 0.5;
  else if (ev.text_amount === '0' || ev.text_amount === '<100 chars')
    L.main_content -= 1;
  if (bucketAtLeast(ev.inputs, COUNT_ORDER, '4-10')) L.form += 2;
  else if (bucketAtLeast(ev.inputs, COUNT_ORDER, '1')) L.form += 1;
  if (ev.required_fields) {
    L.form += 3;
    L.main_content += 0.5;
  }
  switch (ev.dom_position) {
    case 'inside_main':
      L.main_content += 1;
      break;
    case 'before_main':
      L.navigation += 0.5;
      break;
    case 'after_main':
      L.recommendations += 0.3;
      L.footer += 0.3;
      break;
    default:
      break;
  }
  if (ev.motion === 'carousel') {
    L.promo_ad += 0.6;
    L.recommendations += 0.4;
  }
  if (ev.motion === 'autoplay_video') {
    L.promo_ad += 0.5;
    L.other += 0.5;
  }
  if (ev.video) L.other += 1;
  return L;
}

function taskLogit(ev: Evidence): number {
  let x = -0.4;
  if (ev.required_fields) x += 3.5;
  if (bucketAtLeast(ev.inputs, COUNT_ORDER, '2-3')) x += 1.5;
  if (ev.landmark === 'main') x += 3;
  if (ev.dom_position === 'inside_main') x += 2;
  if (ev.landmark === 'navigation' || ev.landmark === 'search') x += 1.5;
  if (ev.zone === 'center_column') x += 1;
  if (has(ev.words, TASK_WORDS)) x += 2;
  if (has(ev.words, HELP_WORDS)) x += 2.5;
  if (has(ev.words, CONSENT_WORDS)) x += 1.5;
  if (has(ev.words, AD_WORDS)) x -= 3;
  if (has(ev.words, REC_WORDS)) x -= 2;
  if (has(ev.words, PROMPT_WORDS)) x -= 1.5;
  if (ev.iframe_kind === 'ad_network') x -= 4;
  if (ev.iframe_kind === 'chat_vendor') x -= 1.5;
  if (ev.iframe_kind === 'social_embed') x -= 1;
  const rail = ev.zone === 'left_rail' || ev.zone === 'right_rail';
  if (rail) x -= 0.5;
  if (rail && ev.link_density === 'high') x -= 0.5;
  return x;
}

const SIGNAL_LOGITS: Record<string, Partial<Record<PageCategory, number>>> = {
  jsonld_article: { article: 3 },
  og_type_article: { article: 2 },
  readerable: { article: 2, docs_reference: 0.5 },
  has_comments_section: { article: 0.5, feed_social: 0.3 },
  role_feed: { feed_social: 3 },
  infinite_scroll: { feed_social: 2 },
  search_results_pattern: { search_results: 3.5 },
  has_site_search: { search_results: 0.3 },
  has_password_field: { form_checkout: 2.5 },
  has_payment_fields: { form_checkout: 3 },
  multi_step_form: { form_checkout: 2 },
  rich_text_editor: { web_app: 2.5 },
  data_grid: { web_app: 2 },
  map_container: { web_app: 2 },
  code_blocks: { docs_reference: 2 },
  many_tables: { docs_reference: 1.5 },
  jsonld_video: { media_video: 2.5 },
  og_type_video: { media_video: 2 },
  large_video_in_main: { media_video: 2 },
  jsonld_product: { other: 1.5 },
};

function pageTypeLogits(state: unknown): Record<PageCategory, number> {
  const L: Record<PageCategory, number> = {
    article: 0,
    feed_social: 0,
    search_results: 0,
    form_checkout: 0,
    web_app: 0,
    docs_reference: 0,
    media_video: 0,
    other: 1,
  };
  const page = isObject(state) && isObject(state.page) ? state.page : null;
  const signals = page && Array.isArray(page.signals) ? page.signals : [];
  for (const s of signals) {
    const add = typeof s === 'string' ? SIGNAL_LOGITS[s] : undefined;
    if (!add) continue;
    for (const [k, v] of Object.entries(add) as Array<[PageCategory, number]>)
      L[k] += v;
  }
  const counts = page && isObject(page.counts) ? page.counts : null;
  if (counts && bucketAtLeast(str(counts.required_fields), COUNT_ORDER, '4-10'))
    L.form_checkout += 1;
  if (
    counts &&
    (counts.text_amount === '10k-50k chars' ||
      counts.text_amount === '>50k chars')
  ) {
    L.article += 0.5;
    L.docs_reference += 0.5;
  }
  return L;
}

function mainCandidateLogit(ev: Evidence): number {
  const textRank =
    [-2, -1, 0, 1.5, 3][
      Math.max(
        0,
        TEXT_ORDER.indexOf(
          (ev.text_amount ?? '0') as (typeof TEXT_ORDER)[number],
        ),
      )
    ] ?? 0;
  let x = textRank;
  if (ev.landmark === 'main') x += 3;
  if (ev.tag === 'article') x += 1.5;
  if (ev.zone === 'center_column') x += 1.5;
  else if (ev.zone === 'full_width_mid') x += 0.5;
  else if (ev.zone === 'left_rail' || ev.zone === 'right_rail') x -= 2;
  if (ev.dom_position === 'inside_main') x += 0.5;
  if (ev.link_density === 'high') x -= 2;
  else if (ev.link_density === 'mid') x -= 0.5;
  else if (ev.link_density === 'low' || ev.link_density === 'none') x += 0.5;
  if (has(ev.words, AD_WORDS) || has(ev.words, REC_WORDS)) x -= 1.5;
  return x;
}

// ---------------------------------------------------------------------------
// Shaping answers exactly like the API
// ---------------------------------------------------------------------------

function softmax(logits: readonly number[], temperature: number): number[] {
  const scaled = logits.map((l) => l / temperature);
  const max = Math.max(...scaled);
  const exps = scaled.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Quantise to 0.01 with largest-remainder rounding so the result sums to exactly 1.00. */
export function quantizeDistribution(ps: readonly number[]): number[] {
  const units = ps.map((p) => Math.max(0, p) * 100);
  const floors = units.map(Math.floor);
  let remaining = 100 - floors.reduce((a, b) => a + b, 0);
  const order = units
    .map((u, i) => ({ i, r: u - Math.floor(u) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i]! += 1;
    remaining -= 1;
  }
  return floors.map((u) => u / 100);
}

const q01 = (p: number) => Math.round(Math.min(1, Math.max(0, p)) * 100) / 100;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function choiceAnswer<O extends string>(
  options: readonly O[],
  logits: readonly number[],
  temperature: number,
): JevChoiceAnswer<O> {
  const probs = quantizeDistribution(softmax(logits, temperature));
  let best = 0;
  for (let i = 1; i < probs.length; i += 1)
    if (probs[i]! > probs[best]!) best = i;
  const n = options.length;
  const pMax = probs[best] ?? 0;
  const probabilities = {} as Record<O, number>;
  options.forEach((o, i) => {
    probabilities[o] = probs[i] ?? 0;
  });
  return {
    type: 'choice',
    choice: options[best]!,
    confidence: n > 1 ? q01((n * pMax - 1) / (n - 1)) : 1,
    probabilities,
  };
}

/** Stable 32-bit FNV-1a hash (deterministic pseudo-evidence for unknown questions). */
function fnv1a(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const unit = (text: string) => fnv1a(text) / 0xffffffff;

const sameKeys = (keys: readonly string[], expected: readonly string[]) =>
  keys.length === expected.length && expected.every((k) => keys.includes(k));

function answerQuestion(id: string, q: JevQuestion, state: unknown): JevAnswer {
  const instructions = q.instructions;
  const regionEv = isObject(instructions)
    ? readEvidence(instructions.region)
    : null;

  if (q.type === 'noul') {
    if (regionEv)
      return { type: 'noul', noul: q01(sigmoid(taskLogit(regionEv))) };
    return {
      type: 'noul',
      noul: q01(
        0.35 + 0.3 * unit(`${id}:${JSON.stringify(instructions ?? null)}`),
      ),
    };
  }

  if (q.type === 'score') {
    const n = q.criteria.length;
    const mid = (n - 1) / 2;
    const jitter = unit(`${id}:${JSON.stringify(q.criteria)}`) - 0.5;
    const logits = q.criteria.map(
      (_, i) => -Math.abs(i - (mid + jitter)) * 1.5,
    );
    const probs = quantizeDistribution(softmax(logits, 1));
    const legend: Record<string, JevLevel> = {};
    const probabilities: Record<string, number> = {};
    q.criteria.forEach((level, i) => {
      legend[String(i)] = level;
      probabilities[String(i)] = probs[i] ?? 0;
    });
    const pMax = Math.max(...probs);
    const answer: JevScoreAnswer = {
      type: 'score',
      score:
        Math.round(probs.reduce((acc, p, i) => acc + p * i, 0) * 100) / 100,
      confidence: n > 1 ? q01((n * pMax - 1) / (n - 1)) : 1,
      legend,
      probabilities,
    };
    return answer;
  }

  const options = Object.keys(q.criteria);
  if (sameKeys(options, REGION_ROLES) && regionEv) {
    const L = roleLogits(regionEv);
    return choiceAnswer(
      options,
      options.map((o) => L[o as RegionRole]),
      1.5,
    );
  }
  if (sameKeys(options, PAGE_CATEGORIES)) {
    const L = pageTypeLogits(state);
    return choiceAnswer(
      options,
      options.map((o) => L[o as PageCategory]),
      1,
    );
  }
  if (
    options.includes('none') &&
    options.every((o) => /^c[1-4]$/.test(o) || o === 'none')
  ) {
    const logits = options.map((o) => {
      if (o === 'none') return 0.5;
      const ev = readEvidence(q.criteria[o]);
      return ev ? mainCandidateLogit(ev) : -2;
    });
    return choiceAnswer(options, logits, 1);
  }
  // Unknown Choice: stable pseudo-preferences, escape options slightly favoured.
  const logits = options.map(
    (o) => (o === 'other' || o === 'none' ? 0.5 : 0) + 2 * unit(`${id}:${o}`),
  );
  return choiceAnswer(options, logits, 1);
}

/** Deterministic answer for a System One request, shaped exactly like the real response. */
export function mockJevAnswer(
  request: JevRequest,
  opts: MockJevOptions = {},
): JevResponse {
  const answers: Record<string, JevAnswer> = {};
  for (const [id, q] of Object.entries(request.questions))
    answers[id] = answerQuestion(id, q, request.state);
  const chars = JSON.stringify({
    state: request.state,
    questions: request.questions,
  }).length;
  return {
    model: opts.model ?? JEV_PINNED_MODEL,
    answers,
    usage: {
      input_tokens: Math.max(1, Math.ceil(chars / 3.6)),
      output_tokens: 2 + 3 * Object.keys(request.questions).length,
    },
  };
}

// ---------------------------------------------------------------------------
// fetch-level mock (for callJev, the Edge Function and a local mock server)
// ---------------------------------------------------------------------------

export interface MockJevFetchOptions extends MockJevOptions {
  /** Force an HTTP status instead of answering (e.g. 429, 529, 500). */
  status?: number;
  /** Response headers to add, e.g. { 'retry-after': '2' }. */
  headers?: Record<string, string>;
  /** Replace the JSON body entirely (for shape-check tests). */
  body?: unknown;
  /** Send this raw text as the body (e.g. malformed JSON). */
  rawBody?: string;
  /** Simulated server time before responding; honours the request's AbortSignal. */
  delayMs?: number;
  /** Reject like a failed connection. */
  networkError?: boolean;
  /** Fixed request id; default is a stable hash of the request body. */
  requestId?: string;
  /** Called with every parsed request body (for assertions). */
  onRequest?: (body: unknown, init: RequestInit | undefined) => void;
}

const ACCEPTED_MODELS = new Set(['jev-1.13.0', 'jev-latest', 'jev-preview']);

function requestIdFor(text: string): string {
  const parts = [0x811c9dc5, 0x01234567, 0x89abcdef, 0x2545f491].map((seed) =>
    fnv1a(text, seed).toString(16).padStart(8, '0'),
  );
  return `req_${parts.join('')}`;
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sleep(
  ms: number,
  signal: AbortSignal | null | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Validation the real API performs before answering (FastAPI-style 422 bodies). */
function validate(body: unknown): { status: number; detail: unknown } | null {
  const detail = (
    loc: Array<string | number>,
    msg: string,
    type = 'value_error',
  ) => ({
    detail: [{ loc: ['body', ...loc], msg, type }],
  });
  if (!isObject(body))
    return {
      status: 422,
      detail: detail([], 'Input should be a valid dictionary'),
    };
  const state = body.state;
  if (state === undefined)
    return {
      status: 422,
      detail: detail(['state'], 'Field required', 'missing'),
    };
  if (
    typeof state === 'number' ||
    typeof state === 'boolean' ||
    state === null
  ) {
    return {
      status: 422,
      detail: detail(
        ['state'],
        'Input should be a valid string, object or array',
      ),
    };
  }
  if (typeof body.model !== 'string' || !ACCEPTED_MODELS.has(body.model)) {
    return { status: 422, detail: detail(['model'], 'Unknown model') };
  }
  if (!isObject(body.questions) || Object.keys(body.questions).length === 0) {
    return {
      status: 422,
      detail: detail(['questions'], 'At least one question is required'),
    };
  }
  for (const key of Object.keys(body)) {
    if (!['state', 'model', 'questions'].includes(key)) {
      return {
        status: 422,
        detail: detail(
          [key],
          'Extra inputs are not permitted',
          'extra_forbidden',
        ),
      };
    }
  }
  for (const [id, q] of Object.entries(body.questions)) {
    if (!isObject(q) || !['noul', 'choice', 'score'].includes(String(q.type))) {
      return {
        status: 422,
        detail: detail(['questions', id, 'type'], 'Unknown question type'),
      };
    }
    if (q.type === 'choice') {
      if (!isObject(q.criteria) || Object.keys(q.criteria).length === 0) {
        return {
          status: 422,
          detail: detail(
            ['questions', id, 'criteria'],
            'Field required',
            'missing',
          ),
        };
      }
      if (Object.keys(q.criteria).length > 255)
        return { status: 400, detail: { detail: 'Too many choices' } };
    }
    if (
      q.type === 'score' &&
      (!Array.isArray(q.criteria) ||
        q.criteria.length < 2 ||
        q.criteria.length > 10)
    ) {
      return {
        status: 422,
        detail: detail(
          ['questions', id, 'criteria'],
          'Score needs 2 to 10 levels',
        ),
      };
    }
  }
  return null;
}

/**
 * A `fetch` implementation that behaves like POST https://api.typesafe.ai/v1/systemone:
 * checks the bearer key (403 missing, 401 for the key "invalid"), validates the
 * body (422 / 400 "Too many choices"), and answers with `mockJevAnswer`.
 * Options force error statuses, delays, malformed bodies or network failures.
 */
export function createMockJevFetch(
  opts: MockJevFetchOptions = {},
): typeof fetch {
  const mockFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const signal = init?.signal ?? null;
    if (opts.delayMs && opts.delayMs > 0) await sleep(opts.delayMs, signal);
    else if (signal?.aborted) throw signal.reason;
    if (opts.networkError) throw new TypeError('fetch failed');

    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const text = typeof init?.body === 'string' ? init.body : '';
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = undefined;
    }
    opts.onRequest?.(parsed, init);

    const requestId = opts.requestId ?? requestIdFor(text);
    const headers: Record<string, string> = {
      [JEV_REQUEST_ID_HEADER]: requestId,
      ...(opts.headers ?? {}),
    };

    if (!url.endsWith(new URL(JEV_ENDPOINT).pathname))
      return json(404, { detail: 'Not Found' }, headers);
    if ((init?.method ?? 'GET').toUpperCase() !== 'POST')
      return json(405, { detail: 'Method Not Allowed' }, headers);

    const auth = new Headers(init?.headers).get('authorization') ?? '';
    const key = auth.startsWith('Bearer ')
      ? auth.slice('Bearer '.length).trim()
      : '';
    if (!key) {
      return json(
        403,
        {
          detail: {
            error_type: 'authentication_error',
            message: 'Missing API key',
          },
        },
        headers,
      );
    }
    if (key === 'invalid') {
      return json(
        401,
        {
          detail: {
            error_type: 'authentication_error',
            message: 'Invalid API key',
          },
        },
        headers,
      );
    }

    if (opts.status !== undefined && opts.status !== 200) {
      return json(
        opts.status,
        opts.body ?? { detail: `status ${opts.status}` },
        headers,
      );
    }
    if (opts.rawBody !== undefined) {
      return new Response(opts.rawBody, {
        status: 200,
        headers: { 'content-type': 'application/json', ...headers },
      });
    }
    if (opts.body !== undefined) return json(200, opts.body, headers);

    const problem = validate(parsed);
    if (problem) return json(problem.status, problem.detail, headers);
    return json(200, mockJevAnswer(parsed as JevRequest, opts), headers);
  };
  return mockFetch as typeof fetch;
}
