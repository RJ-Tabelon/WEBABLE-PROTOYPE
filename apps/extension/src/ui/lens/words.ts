// Owner: L. Plain words for Jev's page read (round 7). Every phrase a person sees is written here.
// Numbers are "Jev's probability". This file never says "confidence" or "chance".
//
// When a field is missing or empty, the helpers return null or an empty list so the Lens can keep the v2 view.
import type { ElementJudgment, FineRole, PageDigest, PagePurpose, PageUnderstanding } from '@webable/core';

export type FineFamily = 'content' | 'data' | 'task' | 'navigation' | 'help' | 'distraction' | 'other';

export type OutlineWeight = 'solid' | 'dashed' | 'hair';

/** Article plus the kind of page, so the header can say "a record and stats page". */
const PURPOSE: Record<PagePurpose, { article: string; name: string }> = {
  record_stats: { article: 'a', name: 'record and stats page' },
  scoreboard: { article: 'a', name: 'scoreboard' },
  schedule: { article: 'a', name: 'schedule' },
  standings: { article: 'a', name: 'standings page' },
  roster: { article: 'a', name: 'roster' },
  article: { article: 'an', name: 'article' },
  news_index: { article: 'a', name: 'news index' },
  recipe: { article: 'a', name: 'recipe' },
  product: { article: 'a', name: 'product page' },
  search_results: { article: 'a', name: 'search results page' },
  form_task: { article: 'a', name: 'form' },
  checkout: { article: 'a', name: 'checkout' },
  sign_in: { article: 'a', name: 'sign-in page' },
  account_dashboard: { article: 'an', name: 'account page' },
  bill_statement: { article: 'a', name: 'bill or statement' },
  appointment: { article: 'an', name: 'appointment page' },
  status_lookup: { article: 'a', name: 'status lookup' },
  info_guide: { article: 'a', name: 'guide' },
  faq: { article: 'a', name: 'questions and answers page' },
  directory_listing: { article: 'a', name: 'directory' },
  location_hours: { article: 'a', name: 'location and hours page' },
  calendar_dates: { article: 'a', name: 'calendar' },
  comparison: { article: 'a', name: 'comparison' },
  video: { article: 'a', name: 'video' },
  gallery: { article: 'a', name: 'gallery' },
  home_portal: { article: 'a', name: 'home page' },
  course_lesson: { article: 'a', name: 'lesson' },
  course_overview: { article: 'a', name: 'course page' },
  live_blog: { article: 'a', name: 'live blog' },
  product_listing: { article: 'a', name: 'product listing' },
  game_detail: { article: 'a', name: 'game page' },
  other: { article: 'another', name: 'kind of page' },
};

/** Fine role in plain words. Chip text uses these, capitalised as a title. */
export const FINE_WORDS: Record<FineRole, string> = {
  page_title: 'Page title',
  headline: 'Headline',
  dek_summary: 'Summary',
  subheading: 'Section heading',
  body_text: 'Body text',
  byline: 'Byline',
  author_bio: 'Author bio',
  dateline: 'Dateline',
  last_updated: 'Updated time',
  read_time: 'Reading time',
  lead_image: 'Lead image',
  figure: 'Figure',
  gallery: 'Photo gallery',
  video_player: 'Video player',
  map_embed: 'Map',
  caption: 'Caption',
  quote: 'Quote',
  pull_quote: 'Pull quote',
  key_fact: 'Key fact',
  correction_notice: 'Correction',
  breaking_banner: 'Breaking news banner',
  live_badge: 'Live badge',
  stat_value: 'Stat value',
  stat_label: 'Stat label',
  scoreboard: 'Scoreboard',
  team_or_org_logo: 'Team logo',
  data_table: 'Data table',
  table_row: 'Table row',
  chart: 'Chart',
  schedule_item: 'Schedule',
  standings: 'Standings',
  price: 'Price',
  discount_badge: 'Discount tag',
  rating: 'Rating',
  comparison_row: 'Comparison',
  player_card: 'Player card',
  play_by_play: 'Play by play',
  ticker: 'Ticker',
  ingredient_list: 'Ingredients',
  instruction_steps: 'Steps',
  recipe_meta: 'Recipe details',
  product_title: 'Product name',
  product_image: 'Product picture',
  product_card: 'Product tile',
  product_options: 'Product options',
  shipping_returns: 'Shipping and returns',
  review_item: 'Review',
  cart_item: 'Cart item',
  order_summary: 'Order summary',
  countdown_timer: 'Countdown',
  stock_warning: 'Stock warning',
  account_balance: 'Balance',
  transaction_row: 'Transaction',
  course_module: 'Course module',
  lesson_content: 'Lesson',
  feature_list: 'Feature list',
  faq_item: 'Question and answer',
  person_profile: 'Person',
  due_date: 'Due date',
  grade_score: 'Grade',
  food_menu_item: 'Menu item',
  prescription_item: 'Prescription',
  opening_hours: 'Opening hours',
  address: 'Address',
  phone_number: 'Phone number',
  form_field: 'Form field',
  date_picker: 'Date picker',
  file_upload: 'File upload',
  choice_group: 'Choices',
  dropdown_select: 'Drop-down',
  password_field: 'Password field',
  payment_field: 'Payment field',
  terms_consent: 'Terms checkbox',
  captcha: 'Human check',
  quiz_question: 'Quiz question',
  appointment_slot: 'Appointment slot',
  primary_action: 'Main action',
  add_to_cart: 'Add to cart',
  secondary_action: 'Other action',
  accordion_item: 'Expandable section',
  step_indicator: 'Step',
  progress_bar: 'Progress bar',
  search_box: 'Search',
  filter_sort: 'Filter',
  result_item: 'Result',
  status_message: 'Status',
  error_message: 'Error message',
  success_message: 'Success message',
  site_logo: 'Site logo',
  site_nav: 'Site menu',
  section_nav: 'Section menu',
  breadcrumb: 'Breadcrumb',
  tabs: 'Tabs',
  pagination: 'Pages',
  back_link: 'Back',
  jump_link: 'Jump link',
  skip_link: 'Skip link',
  table_of_contents: 'Contents list',
  tag_list: 'Topic tags',
  help_link: 'Help',
  contact_info: 'Contact',
  chat_widget: 'Chat',
  warning_notice: 'Warning',
  consent_notice: 'Consent notice',
  popup: 'Popup',
  login_prompt: 'Sign-in prompt',
  advertising: 'Ad',
  sponsored: 'Sponsored',
  ad_disclosure: 'Ad label',
  upsell_promo: 'Promotion',
  app_install_banner: 'App banner',
  paywall_prompt: 'Paywall',
  betting_odds: 'Betting odds',
  newsletter_signup: 'Newsletter sign-up',
  teaser_other_content: 'Teaser for other stories',
  related_links: 'Related links',
  testimonial: 'Testimonial',
  social_share: 'Share',
  comments: 'Comments',
  video_autoplay: 'Autoplay video',
  carousel: 'Carousel',
  account_utility: 'Account',
  legal_footer: 'Legal',
  decorative: 'Decoration',
  other: 'Other',
};

/**
 * Colour family for a fine role. Recipe roles use the content colour: they are what a recipe page exists to show.
 * Account, legal and decoration have no family in the six, so they use a neutral chip.
 */
export const FINE_FAMILY: Record<FineRole, FineFamily> = {
  page_title: 'content',
  headline: 'content',
  dek_summary: 'content',
  subheading: 'content',
  body_text: 'content',
  byline: 'content',
  author_bio: 'content',
  dateline: 'content',
  last_updated: 'content',
  read_time: 'content',
  lead_image: 'content',
  figure: 'content',
  gallery: 'content',
  video_player: 'content',
  map_embed: 'content',
  caption: 'content',
  quote: 'content',
  pull_quote: 'content',
  key_fact: 'content',
  correction_notice: 'content',
  breaking_banner: 'content',
  live_badge: 'content',
  stat_value: 'data',
  stat_label: 'data',
  scoreboard: 'data',
  team_or_org_logo: 'data',
  data_table: 'data',
  table_row: 'data',
  chart: 'data',
  schedule_item: 'data',
  standings: 'data',
  price: 'data',
  discount_badge: 'data',
  rating: 'data',
  comparison_row: 'data',
  player_card: 'data',
  play_by_play: 'data',
  ticker: 'data',
  ingredient_list: 'content',
  instruction_steps: 'content',
  recipe_meta: 'content',
  product_title: 'content',
  product_image: 'content',
  product_card: 'data',
  product_options: 'task',
  shipping_returns: 'content',
  review_item: 'content',
  cart_item: 'data',
  order_summary: 'data',
  countdown_timer: 'other',
  stock_warning: 'other',
  account_balance: 'data',
  transaction_row: 'data',
  course_module: 'content',
  lesson_content: 'content',
  feature_list: 'content',
  faq_item: 'content',
  person_profile: 'content',
  due_date: 'data',
  grade_score: 'data',
  food_menu_item: 'content',
  prescription_item: 'data',
  opening_hours: 'data',
  address: 'help',
  phone_number: 'help',
  form_field: 'task',
  date_picker: 'task',
  file_upload: 'task',
  choice_group: 'task',
  dropdown_select: 'task',
  password_field: 'task',
  payment_field: 'task',
  terms_consent: 'task',
  captcha: 'task',
  quiz_question: 'task',
  appointment_slot: 'task',
  primary_action: 'task',
  add_to_cart: 'task',
  secondary_action: 'task',
  accordion_item: 'task',
  step_indicator: 'task',
  progress_bar: 'task',
  search_box: 'task',
  filter_sort: 'task',
  result_item: 'task',
  status_message: 'task',
  error_message: 'task',
  success_message: 'task',
  site_logo: 'navigation',
  site_nav: 'navigation',
  section_nav: 'navigation',
  breadcrumb: 'navigation',
  tabs: 'navigation',
  pagination: 'navigation',
  back_link: 'navigation',
  jump_link: 'navigation',
  skip_link: 'navigation',
  table_of_contents: 'navigation',
  tag_list: 'navigation',
  help_link: 'help',
  contact_info: 'help',
  chat_widget: 'help',
  warning_notice: 'help',
  consent_notice: 'help',
  popup: 'help',
  login_prompt: 'other',
  advertising: 'distraction',
  sponsored: 'distraction',
  ad_disclosure: 'distraction',
  upsell_promo: 'distraction',
  app_install_banner: 'distraction',
  paywall_prompt: 'distraction',
  betting_odds: 'distraction',
  newsletter_signup: 'distraction',
  teaser_other_content: 'distraction',
  related_links: 'distraction',
  testimonial: 'distraction',
  social_share: 'distraction',
  comments: 'distraction',
  video_autoplay: 'distraction',
  carousel: 'distraction',
  account_utility: 'other',
  legal_footer: 'other',
  decorative: 'other',
  other: 'other',
};

/** 0 distraction, 1 minor, 2 secondary, 3 supporting, 4 essential. */
export const IMPORTANCE_WORD = ['Distraction', 'Minor', 'Secondary', 'Supporting', 'Essential'] as const;

const FINE_SET = new Set<string>(Object.keys(FINE_WORDS));
const PURPOSE_SET = new Set<string>(Object.keys(PURPOSE));

export function isFineRole(v: unknown): v is FineRole {
  return typeof v === 'string' && FINE_SET.has(v);
}

export function isPagePurpose(v: unknown): v is PagePurpose {
  return typeof v === 'string' && PURPOSE_SET.has(v);
}

const clamp01 = (p: number): number => Math.min(1, Math.max(0, p));

export function fmtP(p: number): string {
  return (Number.isFinite(p) ? clamp01(p) : 0).toFixed(2);
}

export function capFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Article and name for a purpose kind. Unknown kinds still get a readable phrase. */
export function purposeReading(kind: string): { article: string; name: string } {
  if (isPagePurpose(kind)) return PURPOSE[kind];
  const name = kind.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return { article: 'a', name: 'page' };
  return { article: /^[aeiou]/i.test(name) ? 'an' : 'a', name };
}

export interface PurposeLine {
  article: string;
  /** "record and stats page" — the header italicises this. */
  name: string;
  p: number;
  /** "Jev read this as a record and stats page (0.97)" */
  sentence: string;
  /** Same sentence for a screen reader, naming Jev's probability. */
  spoken: string;
}

/** Header line, or null when the purpose field is missing or has no kind and no probability. */
export function purposeLine(purpose: PageUnderstanding['purpose'] | null | undefined): PurposeLine | null {
  if (!purpose || typeof purpose !== 'object') return null;
  const kind = typeof purpose.kind === 'string' ? purpose.kind.trim() : '';
  const p = purpose.p;
  if (!kind || typeof p !== 'number' || !Number.isFinite(p)) return null;
  const reading = purposeReading(kind);
  const num = fmtP(p);
  return {
    article: reading.article,
    name: reading.name,
    p: clamp01(p),
    sentence: `Jev read this as ${reading.article} ${reading.name} (${num})`,
    spoken: `Jev read this as ${reading.article} ${reading.name}, Jev's probability ${num}.`,
  };
}

export interface ProbBar {
  id: string;
  name: string;
  p: number;
}

/** Top purpose kinds by Jev's probability. Empty when the field is missing or has no numbers. */
export function purposeBars(purpose: PageUnderstanding['purpose'] | null | undefined, limit = 5): ProbBar[] {
  if (!purpose || typeof purpose !== 'object') return [];
  const rows: ProbBar[] = [];
  const probs = purpose.probs;
  if (probs && typeof probs === 'object') {
    for (const [id, v] of Object.entries(probs)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      rows.push({ id, name: capFirst(purposeReading(id).name), p: clamp01(v) });
    }
  }
  rows.sort((a, b) => b.p - a.p || a.name.localeCompare(b.name));
  if (rows.length === 0 && typeof purpose.kind === 'string' && purpose.kind && typeof purpose.p === 'number' && Number.isFinite(purpose.p) && purpose.p > 0) {
    rows.push({ id: purpose.kind, name: capFirst(purposeReading(purpose.kind).name), p: clamp01(purpose.p) });
  }
  return rows.slice(0, limit);
}

export interface RegionPick {
  id: string;
  p: number;
  runnerUp: { id: string; p: number } | null;
}

/**
 * The region Jev picked, and the next-highest different id.
 * `{ id: 'none', p: 0, probs: {} }` counts as empty: there is nothing to draw.
 */
export function mainRegionPick(region: PageUnderstanding['mainRegion'] | null | undefined): RegionPick | null {
  if (!region || typeof region !== 'object') return null;
  const id = typeof region.id === 'string' ? region.id : '';
  if (!id) return null;
  const p = typeof region.p === 'number' && Number.isFinite(region.p) ? clamp01(region.p) : 0;
  const probs = region.probs && typeof region.probs === 'object' ? region.probs : {};
  const ranked = Object.entries(probs)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const any = p > 0 || ranked.length > 0;
  if (!any) return null;
  const runner = ranked.find(([rid]) => rid !== id);
  return {
    id,
    p,
    runnerUp: runner ? { id: runner[0], p: clamp01(runner[1]) } : null,
  };
}

/** 0–4, or null when the score is missing or outside that scale. 0 is a real answer (distraction), not "empty". */
export function importanceScore(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  if (n < 0 || n > 4) return null;
  return n;
}

export function importanceWord(score: number): string {
  return IMPORTANCE_WORD[score] ?? 'Secondary';
}

/** Essential and supporting are solid, distractions dashed, the two middle scores a hairline. */
export function importanceWeight(score: number): OutlineWeight {
  if (score <= 0) return 'dashed';
  if (score >= 3) return 'solid';
  return 'hair';
}

export interface FineBar {
  role: FineRole;
  name: string;
  family: FineFamily;
  p: number;
}

function asFineProbs(j: ElementJudgment): Record<string, number> | null {
  const extra = (j as ElementJudgment & { fineProbs?: unknown }).fineProbs;
  if (!extra || typeof extra !== 'object') return null;
  return extra as Record<string, number>;
}

/**
 * Fine-role bars for the hover card, highest first, at most five.
 * A `fineProbs` map on the judgment (not in the shared contract yet) supplies the distribution.
 * Without it, the single `fine` / `fineP` answer is one bar. Missing both returns [].
 */
export function fineRoleBars(j: ElementJudgment | null | undefined, limit = 5): FineBar[] {
  if (!j) return [];
  const probs = asFineProbs(j);
  if (probs) {
    const rows: FineBar[] = [];
    for (const [role, v] of Object.entries(probs)) {
      if (!isFineRole(role) || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      rows.push({ role, name: FINE_WORDS[role], family: FINE_FAMILY[role], p: clamp01(v) });
    }
    rows.sort((a, b) => b.p - a.p || a.name.localeCompare(b.name));
    if (rows.length) return rows.slice(0, limit);
  }
  if (!isFineRole(j.fine)) return [];
  const p = typeof j.fineP === 'number' && Number.isFinite(j.fineP) ? clamp01(j.fineP) : 0;
  return [{ role: j.fine, name: FINE_WORDS[j.fine], family: FINE_FAMILY[j.fine], p }];
}

export interface SettledFine {
  fine: FineRole | null;
  fineP: number | null;
  fineName: string | null;
  family: FineFamily | null;
  importance: number | null;
  weight: OutlineWeight | null;
}

const EMPTY_FINE: SettledFine = {
  fine: null, fineP: null, fineName: null, family: null, importance: null, weight: null,
};

/** What the Lens draws for one judgment. All nulls when the round-7 fields are absent. */
export function settledFine(j: ElementJudgment | null | undefined): SettledFine {
  if (!j) return EMPTY_FINE;
  const importance = importanceScore(j.importance);
  let fine: FineRole | null = null;
  let fineP: number | null = null;
  if (isFineRole(j.fine)) {
    fine = j.fine;
    // A missing probability stays blank. 0 is a real answer and still shows.
    fineP = typeof j.fineP === 'number' && Number.isFinite(j.fineP) ? clamp01(j.fineP) : null;
  } else {
    const top = fineRoleBars(j, 1)[0];
    if (top) {
      fine = top.role;
      fineP = top.p;
    }
  }
  if (!fine && importance == null) return EMPTY_FINE;
  return {
    fine,
    fineP,
    fineName: fine ? FINE_WORDS[fine] : null,
    family: fine ? FINE_FAMILY[fine] : null,
    importance,
    weight: importance == null ? null : importanceWeight(importance),
  };
}

/** True when the side sheet has a Page tab to show. */
export function hasPageRead(u: PageUnderstanding | null | undefined): boolean {
  if (!u) return false;
  return purposeBars(u.purpose).length > 0 || mainRegionPick(u.mainRegion) != null;
}

/** Label for a region or element id, from the digest (elements, then regions) or "none of these". */
export function regionLabel(id: string, labels: ReadonlyMap<string, string>, digest: PageDigest | null): string {
  if (id === 'none') return 'none of these';
  const known = labels.get(id);
  if (known) return known;
  const ev = digest?.elements.find((e) => e.id === id) ?? digest?.regions?.find((e) => e.id === id);
  const raw = (ev?.label || '').trim();
  return raw && raw !== '·' ? raw : id;
}
