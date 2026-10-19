/**
 * Zod-free PageSpec vocabulary (docs/10 §4.1). A PageSpec is made only of
 * these enums and of node ids taken from the request, so it can carry no page
 * text, CSS, selectors or code in either direction.
 */

export const PAGE_TYPES = [
  'search_results',
  'listing_grid',
  'feed',
  'article',
  'product_detail',
  'product_marketing',
  'video_watch',
  'channel_or_profile',
  'inbox_or_messages',
  'form_or_checkout',
  'dashboard_or_app',
  'home_portal',
  'docs_reference',
  'other',
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const PRIMARY_TASKS = [
  'read',
  'browse_and_choose',
  'search',
  'compare_and_buy',
  'watch',
  'fill_form',
  'navigate',
  'triage_messages',
  'other',
] as const;
export type PrimaryTask = (typeof PRIMARY_TASKS)[number];

export const SECTION_KINDS = [
  'header',
  'search',
  'account_and_cart',
  'primary_nav',
  'secondary_nav',
  'breadcrumbs',
  'page_heading',
  'tabs',
  'filters',
  'sort_and_view',
  'main_list',
  'article',
  'product_detail',
  'form',
  'media',
  'pagination',
  'feature_blocks',
  'promo_hero',
  'related',
  'comments',
  'secondary',
  'help_and_contact',
  'legal',
  'footer',
  'consent',
  'overlay_modal',
  'toolbar',
  'ads',
  'clutter',
  'other',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** `fold` = shown folded with a count and one click to open, never removed. */
export const IMPORTANCE = ['primary', 'secondary', 'tertiary', 'fold'] as const;
export type Importance = (typeof IMPORTANCE)[number];

/**
 * How Fit view presents a section (docs/12 §6, "Showroom"). The planner and
 * the heuristic pick one per section; the renderer owns what each looks like.
 * - hero: the page's statement (its h1 with the details that belong to it);
 *   at most one per page.
 * - buy_box: one product's media beside its title, price, options and buying
 *   controls.
 * - card_grid: a collection as cards in a responsive grid.
 * - row_list: a collection or a set of links as rows in one grouped list.
 * - chip_bar: tabs, chips, filters or sort controls as a wrapping chip row.
 * - reading: running text with its figures, in a reading column.
 * - spotlight: a promotional or explanatory block as a large panel, text
 *   beside its media.
 * - link_grid: a long set of links (footer, site map) in columns.
 * - form_panel: a form in a raised panel.
 * - menu: a long set of links or options behind one button.
 * - as_is: players, maps, editors and ads, kept as the page draws them.
 */
export const SECTION_LAYOUTS = [
  'hero',
  'buy_box',
  'card_grid',
  'row_list',
  'chip_bar',
  'reading',
  'spotlight',
  'link_grid',
  'form_panel',
  'menu',
  'as_is',
] as const;
export type SectionLayout = (typeof SECTION_LAYOUTS)[number];

export const ITEM_KINDS = [
  'product',
  'video',
  'search_result',
  'article_card',
  'message',
  'post',
  'comment',
  'image',
  'event',
  'person',
  'file',
  'feature',
  'reference',
  'nav_link',
  'tab',
  'chip',
  'filter_option',
  'other',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const FIELD_ROLES = [
  'title',
  'thumbnail',
  'author_or_channel',
  'description',
  'meta',
  'timestamp',
  'duration',
  'price',
  'rating',
  'review_count',
  'badge',
  'label',
  'link',
  'primary_action',
  'secondary_action',
  'select_toggle',
  'state_toggle',
  'overflow_menu',
  'decorative',
  'other',
] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

export const FIELD_SHOW = ['always', 'on_expand', 'hide'] as const;
export type FieldShow = (typeof FIELD_SHOW)[number];

/**
 * The card template one collection's records share (docs/12 §6.2):
 * - tile: a product or feature tile, the media in a soft well above the title;
 * - media: a video or image card, the media large and the text beneath it,
 *   no card chrome;
 * - story: an article, post or event card, optional media on top;
 * - row: a text row (results, references, files, comments) in a grouped list;
 * - message: an inbox row (sender, subject, time);
 * - person: an avatar beside a name;
 * - chip: a small pill (tabs, chips, filter options);
 * - link: a plain link in a list.
 */
export const CARD_STYLES = [
  'tile',
  'media',
  'story',
  'row',
  'message',
  'person',
  'chip',
  'link',
] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

/** The shape of a collection's media: 16:9, 1:1, 3:4, or no media slot. */
export const MEDIA_SHAPES = [
  'landscape',
  'square',
  'portrait',
  'none',
] as const;
export type MediaShape = (typeof MEDIA_SHAPES)[number];

/**
 * `first`: the collection's first record leads (drawn wider, its media
 * larger). Only for media and story cards on feeds, home portals, channels
 * and articles; never on search results or product lists, where position is
 * the site's ranking.
 */
export const LEAD_MODES = ['first', 'none'] as const;
export type LeadMode = (typeof LEAD_MODES)[number];

/**
 * The default layout of each section kind (docs/12 §6.1): what the heuristic
 * starts from and what the validator coerces an unknown layout to. A
 * main_list or related section of grid cards becomes card_grid, and long
 * navigation or filters a menu, by evidence (heuristic.ts).
 */
export const LAYOUT_OF: Readonly<Record<SectionKind, SectionLayout>> = {
  header: 'chip_bar',
  search: 'form_panel',
  account_and_cart: 'chip_bar',
  primary_nav: 'chip_bar',
  secondary_nav: 'row_list',
  breadcrumbs: 'chip_bar',
  page_heading: 'hero',
  tabs: 'chip_bar',
  filters: 'chip_bar',
  sort_and_view: 'chip_bar',
  main_list: 'row_list',
  article: 'reading',
  product_detail: 'buy_box',
  form: 'form_panel',
  media: 'as_is',
  pagination: 'chip_bar',
  feature_blocks: 'spotlight',
  promo_hero: 'hero',
  related: 'row_list',
  comments: 'row_list',
  secondary: 'reading',
  help_and_contact: 'row_list',
  legal: 'link_grid',
  footer: 'link_grid',
  consent: 'as_is',
  overlay_modal: 'as_is',
  toolbar: 'as_is',
  ads: 'as_is',
  clutter: 'as_is',
  other: 'as_is',
};

/** The default card of each item kind (docs/12 §6.2). */
export const CARD_OF: Readonly<Record<ItemKind, CardStyle>> = {
  product: 'tile',
  video: 'media',
  search_result: 'row',
  article_card: 'story',
  message: 'message',
  post: 'story',
  comment: 'row',
  image: 'media',
  event: 'story',
  person: 'person',
  file: 'row',
  feature: 'tile',
  reference: 'row',
  nav_link: 'link',
  tab: 'chip',
  chip: 'chip',
  filter_option: 'chip',
  other: 'row',
};

/**
 * The default media shape of each item kind, for a collection whose shape is
 * unknown. The heuristic reads the shape from the exemplar's thumbnail box
 * instead (`mediaShapeOf`).
 */
export const MEDIA_OF: Readonly<Record<ItemKind, MediaShape>> = {
  product: 'square',
  video: 'landscape',
  search_result: 'none',
  article_card: 'landscape',
  message: 'none',
  post: 'landscape',
  comment: 'none',
  image: 'square',
  event: 'landscape',
  person: 'square',
  file: 'none',
  feature: 'landscape',
  reference: 'none',
  nav_link: 'none',
  tab: 'none',
  chip: 'none',
  filter_option: 'none',
  other: 'none',
};

/** Cards drawn as a grid (card_grid); the others are rows, chips or links. */
export const GRID_CARDS: readonly CardStyle[] = ['tile', 'media', 'story'];

/** Cards whose first record may lead (`lead: first`). */
export const LEAD_CARDS: readonly CardStyle[] = ['media', 'story'];

/** Page types where a collection's first record may lead. */
export const LEAD_PAGE_TYPES: readonly PageType[] = [
  'feed',
  'home_portal',
  'channel_or_profile',
  'article',
];

/**
 * The media shape of a thumbnail box (docs/12 §6.2): w/h >= 1.3 is
 * landscape, <= 0.85 portrait, anything else (or an empty box) square.
 */
export function mediaShapeOf(width: number, height: number): MediaShape {
  if (!(width > 0) || !(height > 0)) return 'square';
  const r = width / height;
  if (r >= 1.3) return 'landscape';
  if (r <= 0.85) return 'portrait';
  return 'square';
}

/**
 * Kinds the validator never lets be folded (help must stay findable, WCAG
 * 3.2.6; consent and paywall walls are answered, never bypassed).
 */
export const PROTECTED_SECTION_KINDS: readonly SectionKind[] = [
  'search',
  'account_and_cart',
  'page_heading',
  'main_list',
  'article',
  'product_detail',
  'form',
  'pagination',
  'help_and_contact',
  'legal',
  'consent',
];

/**
 * Kinds rendered in Fit view's top strip. Only nodes that pass the
 * trusted-slot rule (validate.ts) may be placed here, so page content can
 * never pose as WebAble's search or account controls.
 */
export const TRUSTED_SLOT_KINDS: readonly SectionKind[] = [
  'header',
  'search',
  'account_and_cart',
];

/** Kinds whose item lists render as records (cards or rows). */
export const RECORD_ITEM_KINDS: readonly ItemKind[] = [
  'product',
  'video',
  'search_result',
  'article_card',
  'message',
  'post',
  'comment',
  'image',
  'event',
  'person',
  'file',
  'feature',
  'reference',
  'other',
];

/** Limits enforced in the JSON Schema and the zod schema alike. */
export const SPEC_MAX_SECTIONS = 24;
export const SPEC_MAX_NODE_IDS = 40;
export const SPEC_MAX_COLLECTIONS = 16;
export const SPEC_MAX_FIELDS = 16;
