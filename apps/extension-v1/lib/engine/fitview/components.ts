import type {
  FitLayout,
  ItemKind,
  PageType,
  SectionKind,
  Skeleton,
  SkeletonNode,
  SpecCollection,
  ValidatedSpec,
} from '@webable/core';

import type { ProxyRole, ProxyTarget, SkeletonRegistry } from './types';

/**
 * The view's fixed component vocabulary (docs/10 §4.3) and the context every
 * renderer shares. Rules that hold for every component:
 *
 *   - DOM is built with createElement only (never innerHTML), in the page's
 *     document, inside WebAble's closed shadow root.
 *   - Words come from the page: visible text (registry.text) or a control's
 *     accessible name (registry.name). WebAble's own copy is FV_COPY.
 *   - Every site control is created with a ProxyTarget and handed to the live
 *     layer (ctx.bind). The renderer never dispatches to the original itself.
 *   - Site actions are blue (docs/12 §3.5): the one primary action a filled
 *     pill, the rest tonal pills or blue text; fern is reserved for
 *     WebAble's controls.
 */

/** WebAble's own words in the view. Everything else is the page's. */
export const FV_COPY = {
  dialog: 'Fit view',
  skip: 'Skip to main content',
  original: 'Original page',
  textSmaller: 'Text −',
  textLarger: 'Text +',
  textSize: 'Text size',
  webableControls: 'Fit view controls',
  notSecure: 'Not secure',
  offer: 'A better layout is ready',
  switchLayout: 'Switch',
  loading: 'Loading…',
  back: 'Back to Fit view',
  siteLinks: (n: number): string => `Site links (${n})`,
  moreFilters: (n: number): string => `More filters (${n})`,
  moreTabs: (n: number): string => `More tabs (${n})`,
  moreOptions: (n: number): string => `More options (${n})`,
  everythingElse: (n: number): string => `Everything else on this page (${n})`,
  useOnPage: 'Use this on the page',
  doOnPage: 'Do this on the page',
  showOnPage: 'Show on the page',
  moreOnPage: (n: number): string => `${n} more on the page`,
  unlabelled: 'Unlabelled control',
  search: 'Search',
  more: 'More',
  moreMenu: 'More from this site and WebAble',
  alwaysHere: 'Always here',
  alwaysHereHint: 'Open this view by itself on this site',
  intro:
    'WebAble simplified this page for your fit. Original page brings the site back.',
  gotIt: 'Got it',
  showMore: (n: number): string => `Show ${n} more`,
  sponsored: (n: number): string => `Sponsored (${n})`,
  moreOnThisPage: 'More on this page',
  /** The rest of a product block, for a person who needs calm. */
  productMore: (n: number): string => `More about this product (${n})`,
  /** A product option group, closed: "Strength: 2.0 X · 24 options". */
  options: (n: number): string => (n === 1 ? '1 option' : `${n} options`),
  /** The small button beside a control whose name is a paragraph. */
  long: {
    popup: 'Show',
    toggle: 'Choose',
    button: 'Select',
  },
  /** One quiet line for a section's players: "3 videos · Watch on the page". */
  players: {
    video: ['video', 'videos', 'Watch on the page'],
    audio: ['audio clip', 'audio clips', 'Listen on the page'],
    iframe: ['embedded item', 'embedded items', 'Use this on the page'],
    canvas: ['drawing', 'drawings', 'Use this on the page'],
    images: ['image', 'images', 'Show on the page'],
  } as Readonly<Record<string, readonly [string, string, string]>>,
  onThisPage: 'On this page',
  showDetails: 'Show details',
  hideDetails: 'Hide details',
  aboutPage: 'About this page',
  allSections: (n: number): string => `All ${n} sections`,
  fewerSections: 'Fewer sections',
  /** A player or frame with no name of its own, by what it is. */
  player: {
    video: 'Video',
    audio: 'Audio',
    iframe: 'Embedded content',
    canvas: 'Drawing',
  } as Readonly<Record<string, string>>,
} as const;

/**
 * The page line under the page's title (docs/11 R1): templates only, filled
 * from the spec's enums and counts, never generated prose.
 *   "Search results · 20 videos · Filters above the list"
 */
export const PAGE_LINE = {
  types: {
    search_results: 'Search results',
    listing_grid: 'Listing',
    feed: 'Feed',
    article: 'Article',
    product_detail: 'Product',
    product_marketing: 'Product page',
    video_watch: 'Video',
    channel_or_profile: 'Profile',
    inbox_or_messages: 'Inbox',
    form_or_checkout: 'Form',
    dashboard_or_app: 'App',
    home_portal: 'Home page',
    docs_reference: 'Reference',
  } as Partial<Record<PageType, string>>,
  nouns: {
    product: ['product', 'products'],
    video: ['video', 'videos'],
    search_result: ['result', 'results'],
    article_card: ['story', 'stories'],
    message: ['message', 'messages'],
    post: ['post', 'posts'],
    comment: ['comment', 'comments'],
    image: ['image', 'images'],
    event: ['event', 'events'],
    person: ['person', 'people'],
    file: ['file', 'files'],
    reference: ['link', 'links'],
  } as Partial<Record<ItemKind, [string, string]>>,
  /** Where the list's own controls are. */
  above: {
    tabs: 'Tabs above the list',
    filters: 'Filters above the list',
    sort_and_view: 'Sort above the list',
  } as Partial<Record<SectionKind, string>>,
  count: (n: number, kind: ItemKind): string => {
    const [one, many] = PAGE_LINE.nouns[kind] ?? ['item', 'items'];
    return `${n} ${n === 1 ? one : many}`;
  },
  sections: (n: number): string => `${n} sections`,
  /** The "On this page" list sits right under the line. */
  outline: 'Contents below',
  /** A product page leads with what it costs and how to buy it. */
  product: 'Price and buying options first',
  /** Sections folded into "More on this page" at the end of the view. */
  drawers: 'More on this page at the end',
};

/** Drawer titles by section kind ("More on this page"), with a count added. */
export const DRAWER_TITLES: Partial<Record<SectionKind, string>> = {
  header: 'Site header',
  page_heading: FV_COPY.aboutPage,
  primary_nav: 'Site links',
  secondary_nav: 'More links',
  breadcrumbs: 'You are here',
  tabs: 'Tabs',
  filters: 'Filters',
  sort_and_view: 'Sort and view',
  pagination: 'Pages',
  main_list: 'List',
  article: 'Text',
  product_detail: 'Product',
  feature_blocks: 'Highlights',
  promo_hero: 'Featured',
  related: 'Related',
  comments: 'Comments',
  secondary: 'Side panel',
  help_and_contact: 'Help and contact',
  legal: 'Legal',
  footer: 'Site footer',
  consent: 'Cookies and consent',
  overlay_modal: 'Pop-up',
  toolbar: 'Tools',
  ads: 'Sponsored',
  clutter: 'Extras',
  media: 'Media',
  form: 'Form',
  account_and_cart: 'Account',
  other: 'Other parts',
};

/**
 * Field text without leading separators the site drew as text ("• 3 days
 * ago", "- Coastline"); text made only of separators is empty.
 */
export function stripLead(s: string): string {
  // A bullet leads with or without a space; a dash or slash only before a
  // space ("- Coastline"), so "-17%" keeps its sign.
  if (/^[\s\-–—•·|/:,]*$/u.test(s)) return '';
  return s.replace(/^\s*(?:[•·|]+\s*|[-–—/:,]+\s+)/u, '');
}

/**
 * Template titles shown as visible headings (where a title helps someone find
 * their way); every other kind is named for assistive technology only.
 */
export const VISIBLE_TITLES: ReadonlySet<SectionKind> = new Set([
  'related',
  'comments',
  'help_and_contact',
  'legal',
  'footer',
  'consent',
  'feature_blocks',
  'ads',
  'clutter',
]);

/** WebAble's template title for a section with no heading of its own. */
export const SECTION_TITLES: Partial<Record<SectionKind, string>> = {
  search: 'Search',
  primary_nav: 'Site links',
  secondary_nav: 'More links',
  breadcrumbs: 'You are here',
  tabs: 'Tabs',
  filters: 'Filters',
  sort_and_view: 'Sort and view',
  pagination: 'Pages',
  feature_blocks: 'Highlights',
  promo_hero: 'Featured',
  related: 'Related',
  comments: 'Comments',
  secondary: 'More on this page',
  help_and_contact: 'Help and contact',
  legal: 'Legal',
  footer: 'Site footer',
  consent: 'Cookies and consent',
  overlay_modal: 'Pop-up',
  toolbar: 'Tools',
  ads: 'Ads',
  clutter: 'Extras',
  media: 'Media',
  form: 'Form',
  account_and_cart: 'Account',
  other: 'More on this page',
};

// ---------------------------------------------------------------------------
// Skeleton index
// ---------------------------------------------------------------------------

export interface SkelIndex {
  nodes: Map<string, SkeletonNode>;
  /** Position in document order. */
  order: Map<string, number>;
  /** Children outside collection exemplars, in document order. */
  children: Map<string, string[]>;
  /** A collection's exemplar subtree (exemplar root first), by list id. */
  slots: Map<string, SkeletonNode[]>;
  /** The collection a slot node belongs to (nearest). */
  slotList: Map<string, string>;
  /** Live element -> node id, for nodes outside exemplars (built at render time). */
  byElement: Map<Element, string>;
}

export function indexSkeleton(
  skeleton: Skeleton,
  registry: SkeletonRegistry,
): SkelIndex {
  const nodes = new Map<string, SkeletonNode>();
  const order = new Map<string, number>();
  const all = new Map<string, string[]>();
  skeleton.nodes.forEach((n, i) => {
    nodes.set(n.id, n);
    order.set(n.id, i);
  });
  for (const n of skeleton.nodes) {
    if (n.parent === null || !nodes.has(n.parent)) continue;
    const list = all.get(n.parent);
    if (list) list.push(n.id);
    else all.set(n.parent, [n.id]);
  }
  const slots = new Map<string, SkeletonNode[]>();
  const slotList = new Map<string, string>();
  for (const n of skeleton.nodes) {
    const ex = n.kind === 'collection' ? n.collection?.exemplar : undefined;
    if (!ex || !nodes.has(ex)) continue;
    const sub: SkeletonNode[] = [];
    const stack = [ex];
    while (stack.length) {
      const id = stack.shift() as string;
      const node = nodes.get(id);
      if (!node) continue;
      sub.push(node);
      // Nested collections keep their own (inner) ownership.
      if (!slotList.has(id) || slotList.get(id) === n.id)
        slotList.set(id, n.id);
      for (const c of all.get(id) ?? []) stack.push(c);
    }
    sub.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    slots.set(n.id, sub);
  }
  // Inner lists win for nodes inside two exemplars (document order: outer first).
  for (const [listId, sub] of slots) {
    for (const s of sub) {
      const cur = slotList.get(s.id);
      if (
        cur &&
        cur !== listId &&
        (order.get(listId) ?? 0) > (order.get(cur) ?? 0)
      )
        slotList.set(s.id, listId);
    }
  }
  const children = new Map<string, string[]>();
  for (const [p, kids] of all) {
    const pn = nodes.get(p);
    const ex = pn?.collection?.exemplar;
    children.set(
      p,
      kids.filter((k) => k !== ex && !nodes.get(k)?.slot && !slotList.has(k)),
    );
  }
  const byElement = new Map<Element, string>();
  for (const n of skeleton.nodes) {
    if (n.slot || slotList.has(n.id)) continue;
    const el = registry.element(n.id);
    if (el && !byElement.has(el)) byElement.set(el, n.id);
  }
  return { nodes, order, children, slots, slotList, byElement };
}

/** Every id in a node's subtree (exemplars included), the node first. */
export function subtreeIds(index: SkelIndex, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    out.push(cur);
    const node = index.nodes.get(cur);
    const kids = index.children.get(cur) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as string);
    const ex = node?.collection?.exemplar;
    if (ex) for (const s of index.slots.get(cur) ?? []) out.push(s.id);
  }
  return out;
}

/** Kinds that carry content a person can read or act on (conservation). */
export const CONTENT_KINDS: ReadonlySet<SkeletonNode['kind']> = new Set([
  'heading',
  'control',
  'input',
  'media',
  'text',
  'stext',
  'table',
  'collection',
]);

// ---------------------------------------------------------------------------
// Render context
// ---------------------------------------------------------------------------

/** WebAble's own actions the components can call (implemented by the runtime). */
export interface ViewActions {
  /** Step aside and show the original element on the page (peek, scrolled into view). */
  showOnPage(id: string | null, el: Element | null): void;
}

export interface RenderCtx {
  doc: Document;
  skeleton: Skeleton;
  index: SkelIndex;
  registry: SkeletonRegistry;
  layout: FitLayout;
  zoom: number;
  validated: ValidatedSpec;
  /** Spec collections by list id. */
  collections: Map<string, SpecCollection>;
  actions: ViewActions;
  /** Hand a rendered control to the live layer (queued until it exists). */
  bind(control: HTMLElement, target: ProxyTarget): void;
  /** A node's content is in the view. */
  emit(id: string): void;
  /** The node's content is already in the view (rendered by another component). */
  isEmitted(id: string): boolean;
  /** A node's content is one click away (behind a disclosure). */
  reach(id: string): void;
  /**
   * A node is not visible on the page (clipped away by a fold or a paywall,
   * screen-reader-only): it is deliberately not shown, and not counted missing.
   */
  hide(id: string): void;
  /** An id unique inside the shadow root. */
  uid(prefix: string): string;
  /** The section container the current controls belong to (ProxyTarget.scopeId). */
  scope: string | null;
  /** The view has its h1 (the page heading). */
  hasH1: boolean;
  /**
   * The page's own title element, drawn once at the top of the view (docs/11
   * R1); every other renderer skips it.
   */
  titleEl?: Element | null;
  /**
   * A control mirrors its original's selected / pressed / checked state:
   * follow the original's state attributes while the view is open (a chip
   * the site selects after a proxied click, a star, an ARIA checkbox).
   */
  mirror(control: HTMLElement, el: Element, toggle: boolean): void;
}

export function withScope<T>(ctx: RenderCtx, id: string, fn: () => T): T {
  const prev = ctx.scope;
  ctx.scope = id;
  try {
    return fn();
  } finally {
    ctx.scope = prev;
  }
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls?: string | null,
  text?: string | null,
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}

const WS = /\s+/g;
/** A space a site wrote as markup inside an attribute ("CAD&nbsp;4.72"). */
const NBSP_ENTITY = /&(?:nbsp|#160|#xa0);/gi;
export const clean = (s: string | null | undefined): string =>
  (s ?? '').replace(NBSP_ENTITY, ' ').replace(WS, ' ').trim();

/** Only http(s), mailto and tel hrefs are ever rendered (docs/10 §4.4). */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const u = new URL(href);
    return /^(https?|mailto|tel):$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Accessible names of irreversible actions: never emphasised, and the live
 * layer asks for a second press ("Press again to buy now").
 */
export const IRREVERSIBLE =
  /\b(buy(?:\s+it)?\s+now|place\s+(?:your\s+)?order|pay(?:\s+now)?|check\s*out|delete|send|post|purchase|donate)\b/i;

export function isIrreversible(name: string): boolean {
  return IRREVERSIBLE.test(name);
}

const BUTTON_INPUTS = new Set(['submit', 'button', 'reset', 'image']);
const TOGGLE_ROLES = new Set([
  'checkbox',
  'radio',
  'switch',
  'menuitemcheckbox',
  'menuitemradio',
]);
const POPUP_ROLES = new Set(['combobox', 'listbox', 'menu', 'menubar']);

/** How a node's original is driven. */
export function proxyRole(
  node: SkeletonNode | undefined,
  el: Element,
  registry: SkeletonRegistry,
): ProxyRole {
  const role = node?.role ?? el.getAttribute('role');
  if (node?.flags.includes('editable')) return 'none';
  // A submit button given role="radio" (a swatch over its picture) is
  // pressed like a button; its state is aria-checked, mirrored as pressed.
  if (el instanceof HTMLInputElement && BUTTON_INPUTS.has(el.type))
    return 'button';
  if (node?.kind === 'input' || isFormField(el)) {
    const t = node?.inputType ?? inputTypeOf(el);
    if (t === 'checkbox' || t === 'radio') return 'toggle';
    if (t === 'select') return 'select';
    if (t === 'file' || t === 'password' || t === 'range' || t === 'other')
      return 'none';
    return 'input';
  }
  if (role && TOGGLE_ROLES.has(role)) return 'toggle';
  if (registry.href(el) && safeHref(registry.href(el))) return 'link';
  return 'button';
}

export function isFormField(el: Element): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  );
}

export function inputTypeOf(el: Element): SkeletonNode['inputType'] {
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    switch (t) {
      case 'text':
      case 'search':
      case 'email':
      case 'tel':
      case 'url':
      case 'number':
      case 'password':
      case 'checkbox':
      case 'radio':
      case 'range':
      case 'date':
      case 'file':
        return t;
      case 'submit':
      case 'button':
      case 'reset':
      case 'image':
        return undefined;
      default:
        return 'other';
    }
  }
  return undefined;
}

function opensPopup(node: SkeletonNode | undefined, el: Element): boolean {
  if (node?.flags.includes('popup')) return true;
  const role = node?.role ?? el.getAttribute('role') ?? '';
  if (POPUP_ROLES.has(role)) return true;
  const hp = el.getAttribute('aria-haspopup');
  return (hp !== null && hp !== 'false') || el.hasAttribute('aria-expanded');
}

/** A ProxyTarget for a control, created when the control is rendered. */
export function makeTarget(
  ctx: RenderCtx,
  id: string,
  el: Element,
  role: ProxyRole,
  extra: {
    record?: ProxyTarget['record'];
    name?: string;
    href?: string | null;
  } = {},
): ProxyTarget {
  const node = ctx.index.nodes.get(id);
  const name = extra.name ?? ctx.registry.name(el);
  const target: ProxyTarget = {
    role,
    id,
    locator: ctx.registry.locator(id),
    scopeId: ctx.scope,
  };
  if (extra.record) target.record = extra.record;
  if (role === 'link')
    target.href =
      extra.href !== undefined
        ? extra.href
        : (safeHref(ctx.registry.href(el)) ?? null);
  if (opensPopup(node, el)) target.popup = true;
  if (isIrreversible(name)) target.irreversible = true;
  return target;
}

/**
 * A button for one of WebAble's own actions (fern): a tinted pill, a filled
 * pill (`fill`) or a ghost pill (`ghost`, no fill).
 */
export function waButton(
  ctx: Pick<RenderCtx, 'doc'>,
  label: string,
  onClick: (e: MouseEvent) => void,
  opts: {
    fill?: boolean;
    ghost?: boolean;
    name?: string;
    expanded?: boolean;
  } = {},
): HTMLButtonElement {
  const b = h(
    ctx.doc,
    'button',
    opts.fill
      ? 'fv-wa fv-wa--fill'
      : opts.ghost
        ? 'fv-wa fv-wa--ghost'
        : 'fv-wa',
  );
  b.type = 'button';
  b.textContent = label;
  if (opts.name) b.setAttribute('aria-label', opts.name);
  if (opts.expanded !== undefined)
    b.setAttribute('aria-expanded', String(opts.expanded));
  b.addEventListener('click', (e) => onClick(e));
  return b;
}

/**
 * WebAble's own on/off switch (role=switch), e.g. "Always here". The state
 * flips on click and `onChange` hears the new value.
 */
export function waSwitch(
  ctx: Pick<RenderCtx, 'doc'>,
  label: string,
  on: boolean,
  onChange: (on: boolean) => void,
  hint?: string,
): HTMLButtonElement {
  const b = h(ctx.doc, 'button', 'fv-switch');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(on));
  if (hint) b.title = hint;
  const track = h(ctx.doc, 'span', 'fv-switch__track');
  track.setAttribute('aria-hidden', 'true');
  b.append(h(ctx.doc, 'span', 'fv-switch__label', label), track);
  b.addEventListener('click', () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return b;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Outline icons (24 px grid): state controls (filled while pressed), the
 * overflow menu's dots and the search field's magnifier.
 */
const ICONS = {
  star: 'M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z',
  heart:
    'M12 19.6s-7.2-4.4-7.2-9.9A3.9 3.9 0 0 1 12 7.4a3.9 3.9 0 0 1 7.2 2.3c0 5.5-7.2 9.9-7.2 9.9z',
  bookmark: 'M7 3.8h10v16.4l-5-3.6-5 3.6z',
  check: 'M4.8 4.8h14.4v14.4H4.8zM8.4 12.2l2.5 2.5 4.9-5.4',
  /** An overflow menu (⋯): three round dots. */
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  search:
    'M10.6 4.2a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8zM15.4 15.4l4.6 4.6',
} as const;
export type IconName = keyof typeof ICONS;

/** A one-path, decorative 24 px icon. */
function svgPath(doc: Document, d: string, cls: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add(cls);
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

export function icon(doc: Document, name: IconName): SVGSVGElement {
  const svg = svgPath(doc, ICONS[name], 'fv-icon');
  if (name === 'more') svg.classList.add('fv-icon--dots');
  return svg;
}

/**
 * A chevron (aria-hidden SVG, class fv-chev): `end` trails a text action
 * ("Buy ›") and mirrors in right-to-left text; `down` marks something that
 * opens below. It takes the colour of its text.
 */
export function chevron(
  doc: Document,
  dir: 'end' | 'down' = 'end',
): SVGSVGElement {
  const svg = svgPath(
    doc,
    dir === 'down' ? 'M6 9.5l6 6 6-6' : 'M9.5 6l6 6-6 6',
    'fv-chev',
  );
  if (dir === 'down') svg.classList.add('fv-chev--down');
  return svg;
}

/** The icon that says what a toggle is, from its accessible name. */
export function toggleIcon(name: string): IconName {
  if (/star/i.test(name)) return 'star';
  if (/\b(like|love|heart|favou?rite)/i.test(name)) return 'heart';
  if (/\b(save|saved|bookmark|watch later|pin)/i.test(name)) return 'bookmark';
  return 'check';
}

/**
 * A site toggle drawn as a state control: an icon, its own accessible name
 * (never the raw "Not starred" as text) and its pressed state.
 */
export function asStateControl(control: HTMLElement, name: string): void {
  const doc = control.ownerDocument;
  control.replaceChildren(
    icon(doc, toggleIcon(name)),
    h(doc, 'span', 'fv-sr', name),
  );
  control.classList.add('fv-toggle');
  control.title = name;
  if (!control.hasAttribute('aria-pressed') && control.localName === 'button')
    control.setAttribute('aria-pressed', 'false');
}

/**
 * How a site control is drawn (docs/12 §5): `btn` a tonal pill (`fill` makes
 * it the blue primary pill), `pill` a chip, `link` blue text with a trailing
 * chevron, `icon` a round tonal icon button carrying the site's name (an
 * overflow menu), `row` a line of link text, `title` a record's title,
 * `inline` a link in running text.
 */
export type ControlVariant =
  'pill' | 'btn' | 'link' | 'icon' | 'row' | 'title' | 'inline';

/**
 * A site control (link, button, toggle) labelled with its own accessible
 * name. Returns null when the control has no name and no visible text, so the
 * caller can offer it on the page instead (a nameless control is never shown
 * as a blank button).
 */
export function siteControl(
  ctx: RenderCtx,
  id: string,
  el: Element,
  opts: {
    variant?: ControlVariant;
    record?: ProxyTarget['record'];
    label?: string;
    fill?: boolean;
    /** Mirror the original's selected / pressed / current state. */
    state?: boolean;
    /** The `icon` variant's picture (default: the overflow dots). */
    icon?: IconName;
  } = {},
): HTMLElement | null {
  const node = ctx.index.nodes.get(id);
  const name = clean(opts.label ?? ctx.registry.name(el));
  const label = name || clean(ctx.registry.text(el));
  if (!label) return null;
  let role = proxyRole(node, el, ctx.registry);
  if (role === 'input' || role === 'select' || role === 'none') role = 'button';
  const variant = opts.variant ?? 'btn';
  const target = makeTarget(ctx, id, el, role, {
    record: opts.record,
    name: label,
  });
  let control: HTMLElement;
  if (role === 'link' && target.href) {
    const a = h(ctx.doc, 'a');
    a.href = target.href;
    control = a;
  } else {
    const b = h(ctx.doc, 'button');
    b.type = 'button';
    control = b;
  }
  control.textContent = label;
  control.className = controlClass(variant, control.localName === 'a');
  if (opts.fill && !target.irreversible && variant === 'btn')
    control.classList.add('fv-btn--fill');
  // A record's slot node describes the exemplar, not this member: state is
  // read from the member's own element.
  const own = opts.record ? undefined : node;
  if (role === 'toggle') {
    control.setAttribute('aria-pressed', String(isOn(own, el)));
  } else if (opts.state ?? stateOf(own, el)) {
    if (control.localName === 'a') control.setAttribute('aria-current', 'true');
    else control.setAttribute('aria-pressed', 'true');
  } else if (isToggleButton(control, el)) {
    // A toggle button stays one while off.
    control.setAttribute('aria-pressed', 'false');
  }
  if (opts.state === undefined && hasLiveState(el, role))
    ctx.mirror(control, el, role === 'toggle');
  if (target.popup && control.localName === 'button')
    control.setAttribute('aria-haspopup', 'true');
  if (isDisabled(own, el)) control.setAttribute('aria-disabled', 'true');
  if (variant === 'icon') {
    // The picture for the eye, the site's own name for everyone else.
    control.replaceChildren(
      icon(ctx.doc, opts.icon ?? 'more'),
      h(ctx.doc, 'span', 'fv-sr', label),
    );
    control.title = label;
  } else if (variant === 'link') control.append(chevron(ctx.doc));
  // A long name reads as a line of text, not a pill; a name that is a
  // paragraph (an expander named by everything in it, a price option that
  // lists delivery and seller) is text with a small button beside it.
  let out: HTMLElement = control;
  if (variant !== 'title' && variant !== 'inline' && variant !== 'icon') {
    if (label.length > PARAGRAPH_LABEL && control.localName === 'a') {
      // A link with a long name is a line of link text, never a pill.
      control.className = 'fv-row-link';
    } else if (label.length > PARAGRAPH_LABEL && !target.irreversible) {
      out = paragraphControl(ctx, control, label, role, target.popup === true);
    } else if (label.length > LONG_LABEL) control.classList.add('fv-btn--long');
  }
  ctx.bind(control, target);
  ctx.emit(id);
  // What sits inside a control (an icon, a count, a nested link) is part of it.
  if (!node?.slot && !ctx.index.slotList.has(id))
    for (const sub of subtreeIds(ctx.index, id)) ctx.emit(sub);
  return out;
}

function controlClass(variant: ControlVariant, link: boolean): string {
  switch (variant) {
    case 'pill':
      return 'fv-pill';
    case 'link':
      return 'fv-btn fv-btn--link';
    case 'icon':
      return 'fv-btn fv-btn--icon';
    case 'row':
      return link ? 'fv-row-link' : 'fv-btn';
    case 'inline':
      return link ? 'fv-inline' : 'fv-btn';
    case 'title':
      return link ? '' : 'fv-open';
    default:
      return 'fv-btn';
  }
}

/** Control names longer than this are drawn as left-aligned lines. */
const LONG_LABEL = 48;
/** Control names longer than this are drawn as text with a small button. */
export const PARAGRAPH_LABEL = 64;

/**
 * A control whose name is a paragraph: the words as text, then one small
 * button that does what the control does. The button's name starts with
 * its visible word and carries the whole name (label in name, WCAG 2.5.3).
 */
function paragraphControl(
  ctx: RenderCtx,
  control: HTMLElement,
  label: string,
  role: ProxyRole,
  popup: boolean,
): HTMLElement {
  const verb = popup
    ? FV_COPY.long.popup
    : role === 'toggle'
      ? FV_COPY.long.toggle
      : FV_COPY.long.button;
  const wrap = h(ctx.doc, 'div', 'fv-longctl');
  const text = h(ctx.doc, 'p', 'fv-longctl__text t-body', label);
  // The button says it all; the text is for the eye.
  text.setAttribute('aria-hidden', 'true');
  control.textContent = verb;
  control.setAttribute('aria-label', `${verb}: ${label}`);
  control.classList.remove(
    'fv-pill',
    'fv-row-link',
    'fv-btn--long',
    'fv-btn--link',
  );
  control.classList.add('fv-btn', 'fv-btn--small');
  wrap.append(text, control);
  return wrap;
}

/** The original's attributes that carry a control's state. */
export const STATE_ATTRS = [
  'aria-selected',
  'aria-current',
  'aria-pressed',
  'aria-checked',
] as const;

/** The original states itself in attributes the view can follow live. */
function hasLiveState(el: Element, role: ProxyRole): boolean {
  if (role === 'toggle' && el instanceof HTMLInputElement && checkable(el))
    return false;
  return STATE_ATTRS.some((a) => el.hasAttribute(a));
}

/**
 * Re-read a mirrored control's state from its original (attributes only: the
 * skeleton's flags describe the page as it was read).
 */
export function mirrorState(
  control: HTMLElement,
  el: Element,
  toggle: boolean,
): void {
  if (toggle) {
    const on = isOn(undefined, el);
    if (control instanceof HTMLInputElement) control.checked = on;
    else control.setAttribute('aria-pressed', String(on));
    return;
  }
  const attr = control.localName === 'a' ? 'aria-current' : 'aria-pressed';
  if (stateOf(undefined, el)) control.setAttribute(attr, 'true');
  else if (isToggleButton(control, el)) control.setAttribute(attr, 'false');
  else control.removeAttribute(attr);
}

/** The original is an ARIA toggle button (aria-pressed), drawn as a button. */
function isToggleButton(control: HTMLElement, el: Element): boolean {
  return control.localName === 'button' && el.hasAttribute('aria-pressed');
}

/** Selected, current or pressed in the original (read only). */
export function stateOf(node: SkeletonNode | undefined, el: Element): boolean {
  if (
    node?.flags.includes('selected') ||
    node?.flags.includes('pressed') ||
    false
  )
    return true;
  const cur = el.getAttribute('aria-current');
  return (
    (cur !== null && cur !== 'false') ||
    el.getAttribute('aria-selected') === 'true' ||
    el.getAttribute('aria-pressed') === 'true' ||
    // A chosen option drawn as a button (role="radio" on a swatch).
    (el.getAttribute('aria-checked') === 'true' &&
      !(el instanceof HTMLInputElement && checkable(el)))
  );
}

/** A native checkbox or radio: its state is `checked`, not an ARIA attribute. */
function checkable(el: HTMLInputElement): boolean {
  return el.type === 'checkbox' || el.type === 'radio';
}

/** Checked state of a toggle in the original (read only). */
export function isOn(node: SkeletonNode | undefined, el: Element): boolean {
  if (el instanceof HTMLInputElement && checkable(el)) return el.checked;
  const a = el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed');
  if (a !== null) return a === 'true' || a === 'mixed';
  return node?.flags.includes('selected') ?? false;
}

function isDisabled(node: SkeletonNode | undefined, el: Element): boolean {
  if (node?.flags.includes('disabled')) return true;
  if ((el as HTMLButtonElement).disabled === true) return true;
  return el.getAttribute('aria-disabled') === 'true';
}

/**
 * A card that sends the person to the original for things the view cannot
 * carry (players, maps, rich editors, payment frames): "Use this on the page".
 */
export function onPageCard(
  ctx: RenderCtx,
  id: string | null,
  el: Element | null,
  label: string,
  copy: string = FV_COPY.useOnPage,
): HTMLElement {
  const card = h(ctx.doc, 'div', 'fv-onpage');
  const text = h(ctx.doc, 'p', 'fv-onpage__label t-body', label || null);
  if (!label) text.hidden = true;
  const go = h(ctx.doc, 'button', 'fv-btn');
  go.type = 'button';
  go.textContent = copy;
  if (label) go.setAttribute('aria-label', `${copy}: ${label}`);
  go.addEventListener('click', () => ctx.actions.showOnPage(id, el));
  card.append(text, go);
  if (id) ctx.emit(id);
  ON_PAGE_TARGETS.set(card, { id, el });
  return card;
}

/** What each "Use this on the page" card shows on the page (players fold into one line). */
export const ON_PAGE_TARGETS = new WeakMap<
  HTMLElement,
  { id: string | null; el: Element | null }
>();

/**
 * One quiet line in place of things the view cannot carry (a section's
 * players, a product's image thumbnails): "3 videos · Watch on the page".
 * The button shows the first of them on the page.
 */
export function quietLine(
  ctx: RenderCtx,
  text: string,
  copy: string,
  id: string | null,
  el: Element | null,
): HTMLElement {
  const p = h(ctx.doc, 'p', 'fv-quiet t-meta');
  const go = h(ctx.doc, 'button', 'fv-btn fv-btn--quiet');
  go.type = 'button';
  go.textContent = copy;
  go.append(chevron(ctx.doc));
  go.setAttribute('aria-label', `${copy}: ${text}`);
  go.addEventListener('click', () => ctx.actions.showOnPage(id, el));
  p.append(h(ctx.doc, 'span', null, text), go);
  if (id) {
    ctx.emit(id);
    for (const sub of subtreeIds(ctx.index, id)) ctx.reach(sub);
  }
  return p;
}

/**
 * Aspect-correct media box: the image when loaded, the soft well until then.
 * Add `fv-thumb--contain` to `cls` for products and images (the whole
 * picture in the well); the default covers the box (video, stories).
 */
export function mediaBox(
  ctx: RenderCtx,
  el: Element,
  cls = 'fv-thumb',
): HTMLElement {
  const box = h(ctx.doc, 'div', cls);
  fillMedia(ctx, box, el);
  return box;
}

/** Sources that failed to load in a media box: not retried, the placeholder stays. */
const failedMedia = new WeakMap<HTMLElement, Set<string>>();

/** (Re)fill a media box from the original; keeps the box's size stable. */
export function fillMedia(ctx: RenderCtx, box: HTMLElement, el: Element): void {
  const info = ctx.registry.media(el);
  const w = info.width > 0 ? info.width : 16;
  const hgt = info.height > 0 ? info.height : 9;
  // A list's images share one ratio (one template per list, docs/11 R7).
  if (!box.dataset.ar)
    box.style.setProperty('--fv-ar', `${Math.round(w)} / ${Math.round(hgt)}`);
  const src = mediaSrc(info.src);
  const img = box.querySelector(':scope > img');
  if (!src || failedMedia.get(box)?.has(src)) {
    img?.remove();
    return;
  }
  if (img instanceof HTMLImageElement && img.getAttribute('src') === src)
    return;
  const next = h(ctx.doc, 'img');
  next.alt = clean(info.alt);
  next.decoding = 'async';
  next.loading = 'lazy';
  // A source that never loads (a lazy page's placeholder path, a blocked
  // host) leaves the tinted placeholder, never a broken-image icon.
  next.addEventListener(
    'error',
    () => {
      let set = failedMedia.get(box);
      if (!set) failedMedia.set(box, (set = new Set()));
      set.add(src);
      next.remove();
    },
    { once: true },
  );
  next.src = src;
  if (img) img.replaceWith(next);
  else box.prepend(next);
}

function mediaSrc(src: string | null): string | null {
  if (!src) return null;
  if (/^(data:image\/|blob:)/i.test(src)) return src;
  return safeHref(src) && /^https?:/i.test(src) ? src : null;
}

export interface DisclosureOpts {
  /** Visible label of the toggle (WebAble copy). */
  label: string;
  /** Label while open; defaults to the same label. */
  openLabel?: string;
  /** Text before the toggle, e.g. "Folded by WebAble (3)" (collapsed things always show a count). */
  lead?: string;
  open?: boolean;
  cls?: string;
  /** Builds the hidden content the first time it opens. */
  render: () => Node;
  /** Ids reachable behind it (conservation), counted while closed. */
  reach?: string[];
}

/**
 * WebAble's disclosure: a fern toggle with aria-expanded and lazily rendered
 * content. Collapsed things always say how many there are.
 */
export function disclosure(ctx: RenderCtx, o: DisclosureOpts): HTMLElement {
  const wrap = h(ctx.doc, 'div', `fv-disclosure ${o.cls ?? ''}`.trim());
  const bar = h(ctx.doc, 'div', 'fv-disclosure__bar');
  const body = h(ctx.doc, 'div', 'fv-collapsed');
  body.id = ctx.uid('d');
  let built = false;
  const build = (): void => {
    if (built) return;
    built = true;
    body.append(o.render());
  };
  const toggle = waButton(ctx, o.label, () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    if (open) build();
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? (o.openLabel ?? o.label) : o.label;
  });
  toggle.setAttribute('aria-controls', body.id);
  toggle.setAttribute('aria-expanded', String(Boolean(o.open)));
  if (o.lead) bar.append(h(ctx.doc, 'span', 'fv-disclosure__count', o.lead));
  bar.append(toggle);
  for (const id of o.reach ?? []) ctx.reach(id);
  if (o.open) {
    build();
    toggle.textContent = o.openLabel ?? o.label;
  } else body.hidden = true;
  wrap.append(bar, body);
  return wrap;
}

// ---------------------------------------------------------------------------
// Form fields (labelled, proxied to the originals)
// ---------------------------------------------------------------------------

/** Selects with this many options or fewer become a visible list (docs/10 §4.4). */
export const SELECT_INLINE_MAX = 12;

interface OptionInfo {
  label: string;
  value: string;
  selected: boolean;
  disabled: boolean;
}

function readOptions(sel: HTMLSelectElement): OptionInfo[] {
  const out: OptionInfo[] = [];
  for (const o of Array.from(sel.options)) {
    if (o.hidden) continue;
    const label = clean(o.label || o.text);
    if (!label) continue;
    out.push({
      label,
      value: o.value,
      selected: o.selected,
      disabled: o.disabled,
    });
  }
  return out;
}

const TEXT_TYPES = new Set([
  'text',
  'search',
  'email',
  'tel',
  'url',
  'number',
  'date',
]);

/**
 * A labelled field that drives the original form control. Checkboxes and
 * radios become whole-row toggles; short selects become a visible list of
 * options. Rich editors, file pickers, sliders and password fields are never
 * proxied: they get "Do this on the page".
 */
export function renderField(
  ctx: RenderCtx,
  id: string,
  el: Element,
  opts: {
    search?: boolean;
    record?: ProxyTarget['record'];
    /** Page text naming the field when it has no name of its own (a record's title). */
    fallbackName?: string;
  } = {},
): HTMLElement | null {
  const node = ctx.index.nodes.get(id);
  const role = proxyRole(node, el, ctx.registry);
  const type =
    node?.inputType ??
    inputTypeOf(el) ??
    (role === 'toggle' ? 'checkbox' : undefined);
  const placeholder = clean(el.getAttribute('placeholder'));
  const name =
    clean(ctx.registry.name(el)) || placeholder || clean(opts.fallbackName);
  if (role === 'none' || !type || !name) {
    return onPageCard(ctx, id, el, name, FV_COPY.doOnPage);
  }
  const target = makeTarget(ctx, id, el, role, { name, record: opts.record });
  const own = opts.record ? undefined : node;
  // The field's own <label>s are its visible name: they render with it.
  for (const l of Array.from(
    (el as HTMLInputElement).labels ?? ([] as HTMLLabelElement[]),
  )) {
    const lid = ctx.index.byElement.get(l);
    if (lid) ctx.emit(lid);
  }
  const required =
    own?.flags.includes('required') || el.hasAttribute('required');
  if (role === 'toggle') {
    const row = h(ctx.doc, 'label', 'fv-check');
    const input = h(ctx.doc, 'input');
    input.type = type === 'radio' ? 'radio' : 'checkbox';
    if (el.getAttribute('role') === 'switch' || node?.role === 'switch')
      input.setAttribute('role', 'switch');
    input.checked = isOn(own, el);
    if (type === 'radio' && el instanceof HTMLInputElement && el.name)
      input.name = `fv-${el.name}`;
    if (isDisabled(own, el)) input.disabled = true;
    row.append(input, h(ctx.doc, 'span', null, name));
    ctx.bind(input, target);
    if (hasLiveState(el, role)) ctx.mirror(input, el, true);
    ctx.emit(id);
    return row;
  }
  const fieldId = ctx.uid('f');
  if (role === 'select' && el instanceof HTMLSelectElement) {
    const options = readOptions(el);
    // A short select becomes a visible list of options (docs/10 §4.4); for a
    // person who needs calm (structure level 2) a long list of radios is
    // more on screen than one select, so only a few options are spread out.
    const spread =
      (ctx.layout.structure?.level ?? 0) === 2 ? 4 : SELECT_INLINE_MAX;
    if (options.length > 0 && options.length <= spread && !el.multiple) {
      const set = h(ctx.doc, 'fieldset', 'fv-options');
      set.append(h(ctx.doc, 'legend', null, name));
      const list = h(ctx.doc, 'div', 'fv-options__list');
      const group = ctx.uid('g');
      for (const o of options) {
        const row = h(ctx.doc, 'label', 'fv-check');
        const r = h(ctx.doc, 'input');
        r.type = 'radio';
        r.name = group;
        r.value = o.value;
        r.checked = o.selected;
        r.disabled = o.disabled;
        row.append(r, h(ctx.doc, 'span', null, o.label));
        list.append(row);
        ctx.bind(r, target);
      }
      set.append(list);
      ctx.emit(id);
      return set;
    }
    const wrap = h(ctx.doc, 'div', 'fv-field');
    const label = h(ctx.doc, 'label', 'fv-label', name);
    label.htmlFor = fieldId;
    const sel = h(ctx.doc, 'select', 'fv-input');
    sel.id = fieldId;
    sel.multiple = el.multiple;
    for (const o of options) {
      const opt = h(ctx.doc, 'option', null, o.label);
      opt.value = o.value;
      opt.selected = o.selected;
      opt.disabled = o.disabled;
      sel.append(opt);
    }
    if (required) sel.setAttribute('aria-required', 'true');
    const box = h(ctx.doc, 'span', 'fv-select');
    box.append(sel, chevron(ctx.doc, 'down'));
    wrap.append(label, box);
    ctx.bind(sel, target);
    ctx.emit(id);
    return wrap;
  }
  const wrap = h(ctx.doc, 'div', opts.search ? 'fv-search' : 'fv-field');
  const label = h(ctx.doc, 'label', opts.search ? 'fv-sr' : 'fv-label', name);
  label.htmlFor = fieldId;
  let control: HTMLInputElement | HTMLTextAreaElement;
  if (type === 'textarea') {
    control = h(ctx.doc, 'textarea', 'fv-input');
    control.rows = 3;
  } else {
    const input = h(ctx.doc, 'input', 'fv-input');
    input.type = type && TEXT_TYPES.has(type) ? type : 'text';
    if (input.type === 'search') input.enterKeyHint = 'search';
    for (const a of ['min', 'max', 'step', 'maxlength', 'inputmode'] as const) {
      const v = el.getAttribute(a);
      if (v !== null) input.setAttribute(a, v);
    }
    control = input;
  }
  control.id = fieldId;
  control.autocomplete = 'off';
  if (placeholder) control.placeholder = placeholder;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
    control.value = el.value;
  if (required) control.setAttribute('aria-required', 'true');
  if (isDisabled(own, el)) control.disabled = true;
  const auto =
    node?.role === 'combobox' ||
    el.getAttribute('role') === 'combobox' ||
    el.hasAttribute('aria-autocomplete');
  if (auto) control.setAttribute('aria-autocomplete', 'list');
  if (opts.search) {
    // The site's search as a pill field with a leading magnifier.
    const field = h(ctx.doc, 'span', 'fv-search__field');
    const glass = svgPath(ctx.doc, ICONS.search, 'fv-search__icon');
    field.append(glass, control);
    wrap.append(label, field);
  } else wrap.append(label, control);
  ctx.bind(control, target);
  ctx.emit(id);
  return wrap;
}
