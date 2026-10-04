import type {
  CountBucket,
  PageCategory,
  PageContext,
  PageSignal,
  RegionEvidence,
  RegionRole,
} from '@webable/core/page/types';

/**
 * Zod-free mirror of the page contract (packages/core/src/page/types.ts) for
 * the content script. The core module builds zod schemas at import time,
 * which would put ~150 KB of zod into a script injected into every frame of
 * every page. These constants and validators enforce exactly the same shape;
 * tests/engine/unit/contract.test.ts fails if they ever drift from the zod
 * schemas (lists compared, validators fuzzed against safeParse).
 */

export const PAGE_CATEGORIES = [
  'article',
  'feed_social',
  'search_results',
  'form_checkout',
  'web_app',
  'docs_reference',
  'media_video',
  'other',
] as const satisfies readonly PageCategory[];

export const PAGE_SIGNALS = [
  'jsonld_article',
  'jsonld_product',
  'jsonld_video',
  'og_type_article',
  'og_type_video',
  'readerable',
  'role_feed',
  'infinite_scroll',
  'has_site_search',
  'search_results_pattern',
  'has_password_field',
  'has_payment_fields',
  'multi_step_form',
  'has_comments_section',
  'large_video_in_main',
  'map_container',
  'rich_text_editor',
  'data_grid',
  'code_blocks',
  'many_tables',
] as const satisfies readonly PageSignal[];

export const PROTECTED_ROLES: readonly RegionRole[] = [
  'main_content',
  'navigation',
  'form',
  'help_contact',
  'consent_banner',
  'footer',
];

export const ENUMS = {
  zone: [
    'header_band',
    'left_rail',
    'right_rail',
    'center_column',
    'full_width_mid',
    'footer_band',
    'overlay_top',
    'overlay_bottom',
    'overlay_center',
    'overlay_corner',
  ],
  width: ['<15%', '15-30%', '30-60%', '60-90%', '>90%'],
  height: [
    '<0.1 screens',
    '0.1-0.3 screens',
    '0.3-1 screens',
    '1-3 screens',
    '>3 screens',
  ],
  pinned: ['fixed', 'sticky', 'no'],
  landmark: [
    'banner',
    'navigation',
    'main',
    'complementary',
    'contentinfo',
    'search',
    'form',
    'region',
    'dialog',
    'none',
  ],
  tag: [
    'div',
    'section',
    'aside',
    'nav',
    'header',
    'footer',
    'form',
    'iframe',
    'ul',
    'article',
    'dialog',
    'other',
  ],
  dom_position: ['before_main', 'inside_main', 'after_main', 'unknown'],
  count: ['0', '1', '2-3', '4-10', '11-30', '31-100', '>100'],
  link_density: ['none', 'low', 'mid', 'high'],
  text_amount: [
    '0',
    '<100 chars',
    '100-500 chars',
    '500-2k chars',
    '>2k chars',
  ],
  repeated_cards: ['0', '2-3', '4-8', '>8'],
  iframe_kind: [
    'none',
    'ad_network',
    'chat_vendor',
    'video_host',
    'social_embed',
    'map',
    'other',
  ],
  motion: ['none', 'transition', 'loop', 'autoplay_video', 'carousel'],
  found_by: ['landmark', 'single_article', 'readability', 'ambiguous'],
  page_text_amount: [
    '<1k chars',
    '1k-10k chars',
    '10k-50k chars',
    '>50k chars',
  ],
  viewport: ['phone', 'tablet', 'desktop'],
  page_height: ['<1 screen', '1-3 screens', '3-10 screens', '>10 screens'],
  pinned_bars: ['0', '1', '2', '3+'],
} as const;

export function countToBucket(count: number): CountBucket {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 3) return '2-3';
  if (count <= 10) return '4-10';
  if (count <= 30) return '11-30';
  if (count <= 100) return '31-100';
  return '>100';
}

const VOCAB_WORD = /^[a-z]{2,20}$/;
const PHRASE = /^[a-z· ]*$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const inEnum = (list: readonly string[], v: unknown): boolean =>
  typeof v === 'string' && list.includes(v);
const exactKeys = (
  o: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const own = Object.keys(o);
  return (
    own.length === keys.length &&
    keys.every((k) => Object.prototype.hasOwnProperty.call(o, k))
  );
};

const REGION_KEYS = [
  'zone',
  'width',
  'height',
  'pinned',
  'landmark',
  'tag',
  'dom_position',
  'links',
  'link_density',
  'text_amount',
  'buttons',
  'inputs',
  'required_fields',
  'repeated_cards',
  'images',
  'video',
  'iframe_kind',
  'motion',
  'class_words',
  'heading_words',
  'control_words',
] as const;

/** Strict validation equivalent to regionEvidenceSchema.safeParse(v).success. */
export function isRegionEvidence(v: unknown): v is RegionEvidence {
  if (!isObj(v) || !exactKeys(v, REGION_KEYS)) return false;
  const e = ENUMS;
  return (
    inEnum(e.zone, v.zone) &&
    inEnum(e.width, v.width) &&
    inEnum(e.height, v.height) &&
    inEnum(e.pinned, v.pinned) &&
    inEnum(e.landmark, v.landmark) &&
    inEnum(e.tag, v.tag) &&
    inEnum(e.dom_position, v.dom_position) &&
    inEnum(e.count, v.links) &&
    inEnum(e.link_density, v.link_density) &&
    inEnum(e.text_amount, v.text_amount) &&
    inEnum(e.count, v.buttons) &&
    inEnum(e.count, v.inputs) &&
    typeof v.required_fields === 'boolean' &&
    inEnum(e.repeated_cards, v.repeated_cards) &&
    inEnum(e.count, v.images) &&
    typeof v.video === 'boolean' &&
    inEnum(e.iframe_kind, v.iframe_kind) &&
    inEnum(e.motion, v.motion) &&
    Array.isArray(v.class_words) &&
    v.class_words.length <= 6 &&
    v.class_words.every((w) => typeof w === 'string' && VOCAB_WORD.test(w)) &&
    typeof v.heading_words === 'string' &&
    v.heading_words.length <= 140 &&
    PHRASE.test(v.heading_words) &&
    Array.isArray(v.control_words) &&
    v.control_words.length <= 4 &&
    v.control_words.every(
      (w) => typeof w === 'string' && w.length <= 100 && PHRASE.test(w),
    )
  );
}

/** Strict validation equivalent to pageContextSchema.safeParse(v).success. */
export function isPageContext(v: unknown): v is PageContext {
  if (!isObj(v) || !exactKeys(v, ['signals', 'main', 'counts', 'layout']))
    return false;
  const { signals, main, counts, layout } = v;
  const e = ENUMS;
  if (!Array.isArray(signals) || signals.length > PAGE_SIGNALS.length)
    return false;
  if (!signals.every((s) => inEnum(PAGE_SIGNALS, s))) return false;
  if (!isObj(main) || !exactKeys(main, ['found_by', 'zone', 'width']))
    return false;
  if (!inEnum(e.found_by, main.found_by)) return false;
  if (!(main.zone === 'unknown' || inEnum(e.zone, main.zone))) return false;
  if (!(main.width === 'unknown' || inEnum(e.width, main.width))) return false;
  const countKeys = [
    'regions',
    'links',
    'buttons',
    'text_inputs',
    'forms',
    'required_fields',
    'headings',
    'images',
    'videos',
    'text_amount',
  ] as const;
  if (!isObj(counts) || !exactKeys(counts, countKeys)) return false;
  for (const k of countKeys) {
    if (k === 'text_amount') {
      if (!inEnum(e.page_text_amount, counts[k])) return false;
    } else if (!inEnum(e.count, counts[k])) return false;
  }
  if (
    !isObj(layout) ||
    !exactKeys(layout, ['viewport', 'page_height', 'pinned_bars'])
  )
    return false;
  return (
    inEnum(e.viewport, layout.viewport) &&
    inEnum(e.page_height, layout.page_height) &&
    inEnum(e.pinned_bars, layout.pinned_bars)
  );
}
