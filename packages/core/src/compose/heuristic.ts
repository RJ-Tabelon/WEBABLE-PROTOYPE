import type { PageSignal, RegionRole } from '../page/constants';
import type { Skeleton, SkeletonNode } from '../skeleton/types';
import {
  CARD_OF,
  GRID_CARDS,
  LAYOUT_OF,
  mediaShapeOf,
  SPEC_MAX_COLLECTIONS,
  SPEC_MAX_FIELDS,
  SPEC_MAX_NODE_IDS,
  SPEC_MAX_SECTIONS,
  TRUSTED_SLOT_KINDS,
  type FieldRole,
  type FieldShow,
  type Importance,
  type ItemKind,
  type MediaShape,
  type PageType,
  type PrimaryTask,
  type SectionKind,
  type SectionLayout,
} from './constants';
import type { PageSpec, SpecCollection, SpecField, SpecSection } from './spec';
import {
  directSections,
  indexSkeleton,
  isIrreversibleLabel,
  isRecordCollection,
  isSearchFieldNode,
  proseRunChars,
  readableBlock,
  skeletonAncestors,
  skeletonNodeArea,
  trustedSlotIssue,
  leadAllowed,
  trustedSlotRoots,
  uncoveredSubtrees,
  type SkeletonIndex,
} from './validate';

/**
 * The heuristic PageSpec (docs/10 §4.1): local, deterministic and fast (a few
 * milliseconds in the service worker), available with no consent and no
 * network. It is what Fit view renders first on every template, and what it
 * falls back to when a planner spec fails validation.
 *
 * How it reads a page:
 *   1. Chrome first: the banner (or a top bar standing in for one), footer,
 *      navigation landmarks and side rails; then what to fold (ads, chat
 *      bubbles, autoplaying media, newsletter boxes, site dialogs, fixed
 *      overlays) and consent prompts, which get their own unfolded section.
 *      Markup flags and Jev/rule region verdicts both count, but nothing
 *      holding search, main content, a landmark or the h1 is ever folded.
 *   2. The primary content: a large record collection, a product block, the
 *      readable text block (widened to its <article>), a stack of feature
 *      blocks, or a form, decided by structure and JSON-LD/Open Graph
 *      signals. The main landmark is the scope; without one, the scope is the
 *      widest block around the primary that holds no chrome.
 *   3. Inside each region, anchors (search field, account controls, page
 *      heading, tabs, sort, filters, pagination, related, comments, help,
 *      legal links) climb to the largest block that holds no other anchor;
 *      whatever no anchor claims becomes the region's remainder section.
 *   4. Record collections get an item kind and per-slot field roles from the
 *      exemplar's structure and text shapes (duration, price, rating, date,
 *      count), never from the words of records; then the art direction
 *      (docs/12 §6): the item kind's card, the media shape of the exemplar's
 *      thumbnail box, and a leading first record where the page allows one.
 *
 * Labels are read here, on the device, only to match public interface words
 * ("Sign in", "Next", "Privacy"); nothing leaves the device.
 */

export interface HeuristicContext {
  /** Region verdicts from local rules and Jev, keyed by component key (SkeletonNode.ck). */
  verdicts?: Record<string, RegionRole>;
  /** Page-level signals (JSON-LD, Open Graph, readerable...) when the worker has them. */
  signals?: readonly PageSignal[];
}

// ---------------------------------------------------------------------------
// Vocabulary (public interface words; English plus common equivalents)
// ---------------------------------------------------------------------------

const ACCOUNT =
  /\b(sign[ -]?in|sign[ -]?up|log[ -]?in|log[ -]?on|sign[ -]?out|log[ -]?out|register|create (an )?account|my account|accounts?|profile|your orders|orders|returns|cart|basket|bag|trolley|wish ?list|hello,|anmelden|konto|warenkorb|connexion|compte|panier|iniciar sesi[oó]n|cuenta|carrito)\b/i;
/** Account tools that sit with the account controls in a banner. */
const ACCOUNT_TOOLS = /\b(settings|preferences|notifications)\b/i;
const SEARCH_WORDS =
  /\b(search|find|look ?up|query|suche|rechercher|buscar|cerca)\b/i;
const SEARCH_CONTROL =
  /\b(search|go|submit|find|clear|voice|options|filters?|suche|buscar)\b/i;
const HELP =
  /\b(help|support|contact( us)?|customer service|faq|feedback|report a problem|get in touch|hilfe|kontakt|aide|ayuda|contacto)\b/i;
const LEGAL =
  /(\b(privacy|terms|conditions|legal|cookies?|imprint|impressum|copyright|disclaimers?|licen[cs]es?|polic(y|ies)|gdpr|do not sell|ad ?choices|accessibility statement|datenschutz|confidentialit[ée]|privacidad)\b|©)/i;
const RELATED =
  /\b(related|see also|more (like|from|on|in|to)|you (may|might) (also )?like|recommended|suggested|most (read|popular|viewed|shared)|trending|popular now|read more|further reading|people also|similar|also (viewed|bought))\b/i;
const COMMENTS = /\b(comments?|replies|discussion|responses|reviews?)\b/i;
const PAGINATION =
  /\b(pagination|pager|next|previous|prev|older|newer|go to page|page \d+|more results|load more)\b/i;
const SORT =
  /\b(sort|sorted|order by|latest|newest|oldest|relevance|featured|top rated|popular)\b/i;
const FILTER = /\b(filters?|refine|narrow|facets?|show only)\b/i;
const BREADCRUMB = /\bbreadcrumbs?\b|\byou are here\b/i;
const TOC =
  /\b(contents|on this page|in this (article|section|guide)|jump to)\b/i;
const BUY =
  /\b(add to (cart|bag|basket|trolley)|buy( now)?|purchase|pre-?order|in den warenkorb|ajouter au panier|a[ñn]adir al carrito)\b/i;
const NEWSLETTER =
  /\b(newsletter|sign ?up|subscribe|briefing|updates|digest)\b/i;
const OVERFLOW = /(\b(more|menu|options|actions)\b|⋮|…|\.\.\.)/i;
const STATE =
  /\b(star|starred|unstar|like|liked|unlike|favou?rites?|save|saved|bookmark|pin|pinned|follow|following|heart|upvote|downvote|flag|watch later)\b/i;
const PRIMARY_ACTION =
  /\b(add to (cart|bag|basket|trolley)|see options|choose options|select options|subscribe|reply|download|book|reserve|apply|get|view|open|read|listen|play)\b/i;
const CHAT =
  /\b(chat|live help|message us|talk to us|ask us|virtual assistant)\b/i;
const FOLLOW = /\b(subscribe|follow|join)\b/i;
const SHOP = /\b(shop|buy|pricing|starting at|add to (cart|bag|basket))\b/i;
const RATING_COUNT = /\b(ratings?|reviews?)\b/i;
/** A star rating named by an icon control ("4.4 out of 5 stars, rating details"). */
const RATING_LABEL = /\bout of (?:5|10)\b|\b\d(?:[.,]\d)?\s?stars?\b/i;
/** Relative times the extractor may not tag as dates ("2d ago", "5 hrs ago"). */
const TIME_AGO = /\d\s?[a-z]{0,7}\.?\s+ago\b/i;
const REPLY_LIKE = /\b(reply|respond|like|upvote|downvote|report)\b/i;
/** A price in a label (the extractor tags only short texts). */
const PRICE_IN_LABEL =
  /[$€£¥₹₩₽₺₪₫฿]\s?\d|\d\s?[$€£¥₹₩₽₺₪₫฿]|\b(?:USD|CAD|AUD|EUR|GBP|JPY|INR|CHF|SEK|NOK|DKK)\s?\d|\d\s?(?:USD|CAD|AUD|EUR|GBP|JPY|INR|CHF|SEK|NOK|DKK)\b/;
/** A price that is not what the item costs now: a saving, a former or list price, a fee. */
const NOT_THE_PRICE =
  /\b(save|saving|coupon|off|typical|list|was|rrp|msrp|regular|before|retail|delivery|shipping|postage|deposit|from \d+ (?:used|new) offers?)\b/i;
/** A price per unit ("(CAD3.68/count)", "$0.50 per ounce"). */
const UNIT_PRICE = /\/\s?[a-z]|\bper\s+[a-z]|^\(/i;

const label = (n: SkeletonNode | undefined): string => n?.label ?? '';

// ---------------------------------------------------------------------------
// Drafts and anchors
// ---------------------------------------------------------------------------

/** A section in the making (ids may still overlap or exceed the bounds). */
interface Draft {
  kind: SectionKind;
  importance: Importance;
  layout: SectionLayout;
  ids: string[];
  heading?: string | null;
}

/**
 * A node that names a section of the page (a search field, a "Related"
 * heading, a navigation landmark). `carve` grows it to a block; whatever no
 * anchor claims becomes the region's remainder.
 */
interface Anchor {
  id: string;
  kind: SectionKind;
  /** Anchors of one group do not block each other's climbing. */
  group: string;
  /** All blocks of the group form one section (else one section per block). */
  merge?: boolean;
  climb: 'none' | 'loose' | 'tight';
  /** Tight climbing: which controls count as the anchor's own. */
  member?: (n: SkeletonNode) => boolean;
  /** Pulled out of any block that encloses it (ads, consent, overlays, chat). */
  extract?: boolean;
  importance?: Importance;
  layout?: SectionLayout;
  heading?: string | null;
  /** Container anchors are carved further instead of becoming one section. */
  carve?: (block: string) => Draft[];
}

const IMPORTANCE_OF: Record<SectionKind, Importance> = {
  header: 'secondary',
  search: 'secondary',
  account_and_cart: 'secondary',
  primary_nav: 'secondary',
  secondary_nav: 'secondary',
  breadcrumbs: 'secondary',
  page_heading: 'secondary',
  tabs: 'secondary',
  filters: 'secondary',
  sort_and_view: 'secondary',
  main_list: 'secondary',
  article: 'secondary',
  product_detail: 'secondary',
  form: 'secondary',
  media: 'secondary',
  pagination: 'secondary',
  feature_blocks: 'secondary',
  promo_hero: 'tertiary',
  related: 'tertiary',
  comments: 'secondary',
  secondary: 'secondary',
  help_and_contact: 'tertiary',
  legal: 'tertiary',
  footer: 'tertiary',
  consent: 'secondary',
  overlay_modal: 'fold',
  toolbar: 'secondary',
  ads: 'fold',
  clutter: 'fold',
  other: 'secondary',
};

/** More links or choices than this make a long set: a menu, or link columns. */
const LONG_SET = 8;

const TRUSTED_KINDS: ReadonlySet<SectionKind> = new Set(TRUSTED_SLOT_KINDS);
/** Section kinds that hold page content (the trusted-slot rule's content roots). */
const CONTENT_KINDS: ReadonlySet<SectionKind> = new Set([
  'main_list',
  'article',
  'product_detail',
  'comments',
  'related',
]);

// ---------------------------------------------------------------------------
// Page reading
// ---------------------------------------------------------------------------

interface Primary {
  ids: string[];
  kind: SectionKind;
  /** The record collection, for main_list. */
  list?: string;
}

/** One skeleton with its index, the region verdicts and signals, and memoised measures. */
class Reader {
  readonly index: SkeletonIndex;
  readonly sk: Skeleton;
  readonly verdicts: Record<string, RegionRole>;
  readonly signals: ReadonlySet<PageSignal>;
  readonly vw: number;
  readonly vh: number;
  private readonly textMemo = new Map<string, number>();

  constructor(sk: Skeleton, ctx: HeuristicContext) {
    this.sk = sk;
    this.index = indexSkeleton(sk);
    this.verdicts = ctx.verdicts ?? {};
    this.signals = new Set(ctx.signals ?? []);
    this.vw = Math.max(1, sk.viewport.width);
    this.vh = Math.max(1, sk.viewport.height);
  }

  node(id: string): SkeletonNode {
    return this.index.byId.get(id)!;
  }

  verdict(id: string): RegionRole | null {
    const ck = this.node(id).ck;
    return ck ? (this.verdicts[ck] ?? null) : null;
  }

  isSlot(id: string): boolean {
    return this.index.slotOwner.has(id);
  }

  order(id: string): number {
    return this.index.order.get(id) ?? 0;
  }

  area(id: string): number {
    return skeletonNodeArea(this.index, id);
  }

  /** All non-slot nodes in a subtree, document order. */
  within(id: string): SkeletonNode[] {
    return this.index
      .subtree(id)
      .filter((d) => !this.isSlot(d))
      .map((d) => this.node(d));
  }

  inside(id: string, scopes: readonly string[]): boolean {
    return scopes.some((s) => s !== id && this.index.contains(s, id));
  }

  /** Running text characters in a subtree, records excluded (runs of prose count). */
  text(id: string): number {
    let v = this.textMemo.get(id);
    if (v === undefined) {
      v = 0;
      for (const d of this.index.subtree(id)) {
        const n = this.node(d);
        if (this.isSlot(d)) continue;
        if (n.kind === 'text') v += n.text?.chars ?? 0;
        else if (n.kind === 'collection') v += proseRunChars(this.index, d);
      }
      this.textMemo.set(id, v);
    }
    return v;
  }

  links(id: string): number {
    let c = 0;
    for (const d of this.index.subtree(id)) {
      const n = this.node(d);
      if (n.kind === 'control' && n.role === 'link') c++;
      else if (n.kind === 'collection' && !this.isSlot(d)) {
        const ex = this.index.exemplarOf.get(d);
        if (ex && this.links(ex) > 0) c += (n.collection?.count ?? 1) - 1;
      }
    }
    return c;
  }

  /** Controls and inputs in a subtree; a list counts each of its items. */
  choices(id: string): number {
    let c = 0;
    for (const d of this.index.subtree(id)) {
      const n = this.node(d);
      if (n.kind === 'control' || n.kind === 'input') c++;
      else if (n.kind === 'collection' && !this.isSlot(d)) {
        const ex = this.index.exemplarOf.get(d);
        if (ex && this.choices(ex) > 0) c += (n.collection?.count ?? 1) - 1;
      }
    }
    return c;
  }

  controls(id: string): SkeletonNode[] {
    return this.index
      .subtree(id)
      .map((d) => this.node(d))
      .filter((n) => n.kind === 'control' || n.kind === 'input');
  }

  /** First heading in a subtree (not in records). */
  firstHeading(id: string): SkeletonNode | null {
    for (const n of this.within(id)) if (n.kind === 'heading') return n;
    return null;
  }

  /** The label a region is known by: its own label, else its first heading. */
  regionLabel(id: string): string {
    const n = this.node(id);
    if (n.label && n.kind !== 'text' && n.kind !== 'stext') return n.label;
    if (n.kind === 'collection') {
      const ex = this.index.exemplarOf.get(id);
      return ex ? label(this.node(ex)) : '';
    }
    return label(this.firstHeading(id) ?? undefined);
  }

  /** Outermost nodes matching `pred` (none inside another match), records excluded. */
  outermost(pred: (n: SkeletonNode) => boolean, scope?: string): string[] {
    const roots = scope ? [scope] : this.index.roots;
    const out: string[] = [];
    const visit = (id: string): void => {
      if (this.isSlot(id)) return;
      if (pred(this.node(id))) {
        out.push(id);
        return;
      }
      for (const k of this.index.children.get(id) ?? []) visit(k);
    };
    for (const r of roots) visit(r);
    return out;
  }

  /** Is this a link-only list (navigation) rather than a list of records? */
  navLike(listId: string): boolean {
    const ex = this.index.exemplarOf.get(listId);
    if (!ex) return false;
    const slots = this.index.subtree(ex).map((d) => this.node(d));
    const media = slots.some(
      (n) => n.kind === 'media' || n.flags.includes('imgctrl'),
    );
    const text = slots.some((n) => n.kind === 'text');
    const pats = slots.some((n) => (n.text?.pat?.length ?? 0) > 0);
    const links = slots.filter(
      (n) => n.kind === 'control' && (n.role === 'link' || n.role === 'tab'),
    );
    const others = slots.filter(
      (n) =>
        (n.kind === 'control' || n.kind === 'input') &&
        n.role !== 'link' &&
        n.role !== 'tab',
    );
    if (media && links.length <= 1 && !text) {
      // A bare thumbnail link is a visual link, not a record.
      return false;
    }
    return links.length > 0 && !media && !text && !pats && others.length === 0;
  }

  isTopBar(n: SkeletonNode): boolean {
    return n.box[1] <= 8 && n.box[3] <= 200 && n.box[2] >= 0.6 * this.vw;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function heuristicSpec(
  skeleton: Skeleton,
  ctx: HeuristicContext = {},
): PageSpec {
  const r = new Reader(skeleton, ctx);
  const root = r.index.roots[0];
  if (root === undefined) {
    return {
      v: 1,
      page_type: 'other',
      primary_task: 'other',
      sections: [],
      collections: [],
    };
  }

  // Chrome and folds anywhere on the page.
  const banners = findBanners(r);
  const footers = findFooters(r, banners);
  const folds = findFolds(r);
  const chrome = [
    ...banners,
    ...footers,
    ...folds.map((f) => f.id),
    ...r.outermost(
      (n) =>
        n.role === 'navigation' ||
        n.role === 'complementary' ||
        n.role === 'contentinfo',
    ),
  ];

  // The primary content and its scope.
  const mains = r
    .outermost((n) => n.role === 'main' || n.tag === 'main')
    .filter((id) => !r.inside(id, banners));
  let scope: string | null =
    mains.length > 0
      ? mains.reduce((a, b) => (r.area(b) > r.area(a) ? b : a))
      : (r
          .outermost((n) => r.verdict(n.id) === 'main_content')
          .find((id) => !r.inside(id, chrome)) ?? null);
  const primary = choosePrimary(r, scope ?? root, scope ? [] : chrome);
  if (scope === null && primary) {
    scope = widenToScope(r, primary.ids, root, [
      ...banners,
      ...folds.map((f) => f.id),
    ]);
  }
  const footersAll =
    footers.length || scope === null
      ? footers
      : fallbackFooters(r, scope, banners);

  const drafts = carvePage(r, root, {
    banners,
    footers: footersAll,
    folds,
    main: scope,
    primary,
  });

  // The primary section exists exactly once. A page with nothing to read or
  // use still gets a valid spec: the whole page, as is.
  if (drafts.length === 0) {
    drafts.push({
      kind: 'other',
      importance: 'primary',
      layout: 'as_is',
      ids: [root],
    });
  }
  // A consent prompt is never the primary section (docs/11 R2).
  for (const d of drafts)
    if (d.kind === 'consent' && d.importance === 'primary')
      d.importance = IMPORTANCE_OF.consent;
  if (!drafts.some((d) => d.importance === 'primary')) {
    promoteLargest(r, drafts);
  }

  // Only trusted nodes go to the top strip (the validator's rule, applied up front).
  const sections = finishSections(r, enforceTrust(r, drafts));
  const primarySection = sections.find((s) => s.importance === 'primary');
  const collections = buildCollections(r, sections, primary);
  const listKind =
    primary?.list !== undefined
      ? collections.find((c) => c.list_id === primary.list)?.item_kind
      : undefined;
  const [page_type, primary_task] = pageType(
    r,
    primarySection?.kind ?? 'other',
    listKind,
    sections,
    scope,
  );
  setLeads(r, sections, collections, page_type);
  return { v: 1, page_type, primary_task, sections, collections };
}

// ---------------------------------------------------------------------------
// Chrome detection
// ---------------------------------------------------------------------------

/** Banner landmarks outside content, else one full-width top bar of controls standing in for a banner. */
function findBanners(r: Reader): string[] {
  const contentRoles = (n: SkeletonNode): boolean =>
    n.role === 'main' ||
    n.tag === 'main' ||
    n.role === 'article' ||
    n.tag === 'article';
  const banners = r
    .outermost((n) => n.role === 'banner')
    .filter(
      (id) =>
        !skeletonAncestors(r.index, id).some((a) => contentRoles(r.node(a))),
    );
  if (banners.length) return banners;
  // A top bar standing in for a banner: full width, at the very top, with
  // controls, and small: no records, no content landmarks, a minority of the page.
  const total = Math.max(
    1,
    r.index.meaningful.get(r.index.roots[0] ?? '') ?? 1,
  );
  const bar = r.outermost(
    (n) =>
      (n.kind === 'landmark' || n.kind === 'group') &&
      r.index.parent(n.id) !== null &&
      r.isTopBar(n) &&
      r.controls(n.id).length >= 2 &&
      (r.index.meaningful.get(n.id) ?? 0) <= 0.5 * total &&
      !r
        .within(n.id)
        .some((m) => contentRoles(m) || isRecordCollection(r.index, m.id)),
  );
  return bar.slice(0, 1);
}

/** Footer landmarks (or regions a verdict calls footer) outside the banner, main and articles. */
function findFooters(r: Reader, banners: readonly string[]): string[] {
  return r
    .outermost((n) => n.role === 'contentinfo' || r.verdict(n.id) === 'footer')
    .filter(
      (id) =>
        !r.inside(id, banners) &&
        !skeletonAncestors(r.index, id).some((a) => {
          const n = r.node(a);
          return n.role === 'main' || n.tag === 'main' || n.tag === 'article';
        }),
    );
}

/** A footer without a contentinfo landmark: the link-heavy block below the main scope. */
function fallbackFooters(
  r: Reader,
  scope: string,
  banners: readonly string[],
): string[] {
  const s = r.node(scope);
  const bottom = s.box[1] + s.box[3];
  const out: string[] = [];
  for (const sib of [scope, ...skeletonAncestors(r.index, scope)]) {
    const parent = r.index.parent(sib);
    if (parent === null) break;
    for (const k of r.index.children.get(parent) ?? []) {
      if (r.order(k) <= r.order(sib)) continue;
      const n = r.node(k);
      if (r.isSlot(k) || banners.some((b) => r.index.contains(k, b))) continue;
      if (n.flags.includes('fixed')) continue;
      if (n.box[1] + 8 < bottom) continue;
      if (r.links(k) >= 5 && r.text(k) < 2000) out.push(k);
    }
    if (out.length) break;
  }
  return out;
}

interface Fold {
  id: string;
  kind: SectionKind;
  importance: Importance;
}

/**
 * Things to fold or set apart wherever they are: consent walls (kept
 * unfolded: they are answered, never bypassed), ads, chat bubbles,
 * autoplaying media, site dialogs and fixed overlays.
 */
function findFolds(r: Reader): Fold[] {
  const mains = r.outermost((n) => n.role === 'main' || n.tag === 'main');
  const h1s = [...r.index.byId.values()].filter(
    (n) => n.kind === 'heading' && n.level === 1 && !r.isSlot(n.id),
  );
  // Never fold the page's own structure, search or a consent prompt, even
  // when markup or a verdict says "ad" (the validator would unfold it).
  const holdsCore = (id: string): boolean =>
    r.index.subtree(id).some((d) => {
      const n = r.node(d);
      return (
        isSearchFieldNode(n) ||
        n.role === 'search' ||
        n.flags.includes('consenthint') ||
        n.role === 'banner' ||
        ((n.role === 'main' || n.tag === 'main') && !r.isSlot(d)) ||
        n.role === 'contentinfo'
      );
    }) ||
    h1s.some((h) => r.index.contains(id, h.id)) ||
    r.area(id) > 0.5 * Math.max(1, r.sk.doc.width * r.sk.doc.height);

  const videoPage =
    r.signals.has('jsonld_video') ||
    r.signals.has('og_type_video') ||
    r.signals.has('large_video_in_main');
  const largestMedia = (() => {
    let best: string | null = null;
    for (const n of r.index.byId.values()) {
      if (n.kind !== 'media' || r.isSlot(n.id)) continue;
      if (best === null || r.area(n.id) > r.area(best)) best = n.id;
    }
    return best;
  })();

  const out: Fold[] = [];
  const taken: string[] = [];
  const add = (id: string, kind: SectionKind): void => {
    if (taken.some((t) => r.index.contains(t, id) || r.index.contains(id, t)))
      return;
    taken.push(id);
    out.push({ id, kind, importance: IMPORTANCE_OF[kind] });
  };

  for (const id of r.outermost(
    (n) =>
      n.flags.includes('consenthint') || r.verdict(n.id) === 'consent_banner',
  ))
    add(id, 'consent');
  for (const id of r.outermost(
    (n) =>
      (n.flags.includes('adhint') || r.verdict(n.id) === 'promo_ad') &&
      !holdsCore(n.id),
  ))
    add(id, 'ads');
  for (const id of r.outermost(
    (n) =>
      (r.verdict(n.id) === 'chat_widget' ||
        (n.flags.includes('fixed') &&
          n.kind === 'control' &&
          CHAT.test(label(n)))) &&
      !holdsCore(n.id),
  ))
    add(id, 'clutter');
  for (const id of r.outermost(
    (n) =>
      n.kind === 'media' &&
      n.flags.includes('playing') &&
      !(videoPage && n.id === largestMedia),
  ))
    add(id, 'clutter');
  for (const id of r.outermost(
    (n) =>
      (n.role === 'dialog' || n.role === 'alertdialog') && !holdsCore(n.id),
  ))
    add(id, 'overlay_modal');
  // Fixed overlays outside the main content (not top bars, not navigation).
  for (const id of r.outermost(
    (n) =>
      n.flags.includes('fixed') &&
      n.role !== 'banner' &&
      n.role !== 'navigation' &&
      !r.isTopBar(n) &&
      (r.index.meaningful.get(n.id) ?? 0) > 0 &&
      !holdsCore(n.id) &&
      !mains.some((m) => r.index.contains(m, n.id)) &&
      !r
        .within(n.id)
        .some((m) => m.role === 'navigation' || m.role === 'banner'),
  ))
    add(id, 'overlay_modal');
  // Newsletter sign-up boxes (an email field and a sign-up button), wherever they sit.
  for (const id of r.outermost(
    (n) =>
      (n.role === 'form' || n.tag === 'form') &&
      formKind(r, n.id) === 'clutter' &&
      !holdsCore(n.id),
  ))
    add(id, 'clutter');
  return out;
}

// ---------------------------------------------------------------------------
// The primary content
// ---------------------------------------------------------------------------

/**
 * The page's main content inside `scope`, by structure first: a record
 * collection that dominates the scope, a product block, the readable text
 * block (widened to its <article>), a stack of feature blocks, a smaller
 * record list, a form, else the scope itself. JSON-LD and Open Graph signals
 * lower the bar for an article.
 */
function choosePrimary(
  r: Reader,
  scope: string,
  exclude: readonly string[],
): Primary | null {
  const excluded = (id: string): boolean =>
    exclude.some((x) => r.index.contains(x, id));
  const chromeAbove = (id: string): boolean =>
    skeletonAncestors(r.index, id).some((a) => {
      const n = r.node(a);
      return (
        n.role === 'navigation' ||
        n.role === 'banner' ||
        n.role === 'contentinfo' ||
        n.role === 'complementary' ||
        n.role === 'tablist' ||
        n.role === 'toolbar'
      );
    });
  const scopeArea = Math.max(1, r.area(scope));

  const articleSignal =
    r.signals.has('jsonld_article') ||
    r.signals.has('og_type_article') ||
    r.signals.has('readerable');
  // On an article page, an <article> whose own blocks were read as a run is
  // the article, not a list of records (eval B1).
  let articleRun: string | null = null;
  let bestList: string | null = null;
  for (const n of r.within(scope)) {
    if (n.kind !== 'collection' || excluded(n.id) || chromeAbove(n.id))
      continue;
    const ex = r.index.exemplarOf.get(n.id);
    if (
      articleSignal &&
      (n.tag === 'article' || n.role === 'article') &&
      ex !== undefined &&
      r.links(ex) <= 2
    ) {
      if (articleRun === null || r.area(n.id) > r.area(articleRun))
        articleRun = n.id;
      continue;
    }
    // Headed groups of links (an index of articles) are content, not navigation.
    const headed =
      ex !== undefined &&
      r.index.subtree(ex).some((d) => r.node(d).kind === 'heading');
    if (!isRecordCollection(r.index, n.id)) continue;
    if (r.navLike(n.id) && !headed) continue;
    if (bestList === null || r.area(n.id) > r.area(bestList)) bestList = n.id;
  }
  if (articleRun && r.area(articleRun) >= 0.3 * Math.max(1, r.area(scope)))
    return { ids: [articleRun], kind: 'article' };
  let textTotal = 0;
  for (const n of r.within(scope)) {
    if (excluded(n.id)) continue;
    if (n.kind === 'text') textTotal += n.text?.chars ?? 0;
    else if (n.kind === 'collection') textTotal += proseRunChars(r.index, n.id);
  }

  if (bestList) {
    const listArea = r.area(bestList);
    const count = r.node(bestList).collection?.count ?? 0;
    if (
      (listArea >= 0.3 * scopeArea || count >= 10) &&
      (textTotal < 2000 || listArea >= 0.5 * scopeArea)
    ) {
      return { ids: [bestList], kind: 'main_list', list: bestList };
    }
  }

  const product = productBlock(r, scope, excluded);
  if (product) return { ids: [product], kind: 'product_detail' };

  if (textTotal >= 1200 || (textTotal >= 400 && articleSignal)) {
    const block = readableBlock(r.index, scope, 0.7, 0);
    if (block && !excluded(block)) {
      const article = [block, ...skeletonAncestors(r.index, block)].find(
        (a) => {
          const n = r.node(a);
          return (
            (n.tag === 'article' || n.role === 'article') &&
            r.index.contains(scope, a)
          );
        },
      );
      return { ids: [article ?? block], kind: 'article' };
    }
  }

  const features = featureBlocks(r, scope, excluded);
  if (features) return { ids: features, kind: 'feature_blocks' };

  if (bestList) return { ids: [bestList], kind: 'main_list', list: bestList };

  const form = r
    .within(scope)
    .find(
      (n) =>
        (n.role === 'form' || n.tag === 'form') &&
        !excluded(n.id) &&
        r
          .controls(n.id)
          .filter((c) => c.kind === 'input' && !isSearchFieldNode(c)).length >=
          2,
    );
  if (form) return { ids: [form.id], kind: 'form' };

  if (r.index.parent(scope) !== null && !excluded(scope)) {
    return { ids: [scope], kind: 'other' };
  }
  return null;
}

/**
 * A product detail block: the h1 and a price near the top, with a buy
 * control, JSON-LD Product, a rating or a large product image beside them.
 * The block spans the gallery and the buy box too (their common ancestor).
 */
function productBlock(
  r: Reader,
  scope: string,
  excluded: (id: string) => boolean,
): string | null {
  const nodes = r.within(scope).filter((n) => !excluded(n.id));
  const top = 2 * r.vh;
  const h1 = nodes.find(
    (n) => n.kind === 'heading' && n.level === 1 && n.box[1] < 1.5 * r.vh,
  );
  // A title drawn over a hero image or video is a marketing page's.
  if (!h1 || h1.flags.includes('overlay')) return null;
  const price = nodes.find(
    (n) => n.text?.pat?.includes('price') && n.box[1] < top,
  );
  if (!price) return null;
  const buy = nodes.find(
    (n) => n.kind === 'control' && BUY.test(label(n)) && n.box[1] < top,
  );
  const rating = nodes.find(
    (n) =>
      n.text?.pat?.includes('rating') === true &&
      Math.abs(n.box[1] - h1.box[1]) < r.vh / 2,
  );
  // The product's own picture: the largest image (or image control) beside
  // the title in the first screen (side by side, sharing its rows), at
  // least a fifth of the viewport wide.
  const [hx, hy, hw, hh] = h1.box;
  let image: SkeletonNode | null = null;
  for (const n of nodes) {
    const visual = n.kind === 'media' || n.flags.includes('imgctrl');
    const [x, y, w, h] = n.box;
    if (!visual || y > r.vh || w < 0.2 * r.vw || h < 200) continue;
    const beside = x + w <= hx + 8 || x >= hx + hw - 8;
    const rows = y < hy + hh && y + h > hy;
    if (!beside || !rows) continue;
    if (!image || r.area(n.id) > r.area(image.id)) image = n;
  }
  const signal = r.signals.has('jsonld_product');
  if (!(buy || signal || rating || image)) return null;
  const parts = [
    h1.id,
    price.id,
    ...(buy ? [buy.id] : []),
    ...(image ? [image.id] : []),
  ];
  let lca = parts[0]!;
  while (!parts.every((p) => r.index.contains(lca, p))) {
    const up = r.index.parent(lca);
    if (up === null) return null;
    lca = up;
  }
  return lca;
}

/** A stack of three or more headed blocks (a landing or marketing page). */
function featureBlocks(
  r: Reader,
  scope: string,
  excluded: (id: string) => boolean,
): string[] | null {
  let cur = scope;
  for (;;) {
    const kids = (r.index.children.get(cur) ?? []).filter(
      (k) => (r.index.meaningful.get(k) ?? 0) > 0 && !excluded(k),
    );
    if (kids.length === 1) {
      cur = kids[0]!;
      continue;
    }
    const headed = kids.filter((k) =>
      r.within(k).some((n) => n.kind === 'heading'),
    );
    if (headed.length < 3) return null;
    const hero = kids[0]!;
    const heroHasH1 = r
      .within(hero)
      .some((n) => n.kind === 'heading' && n.level === 1);
    const ids = kids.filter((k) => !(k === hero && heroHasH1));
    return ids.length <= SPEC_MAX_NODE_IDS ? ids : [cur];
  }
}

/** Without a main landmark: the widest block around the primary that holds no chrome. */
function widenToScope(
  r: Reader,
  ids: readonly string[],
  root: string,
  chrome: readonly string[],
): string {
  let cur = ids[0]!;
  while (!ids.every((id) => r.index.contains(cur, id))) {
    cur = r.index.parent(cur) ?? root;
  }
  for (;;) {
    const up = r.index.parent(cur);
    if (up === null || up === root) return cur;
    if (chrome.some((c) => r.index.contains(up, c))) return cur;
    cur = up;
  }
}

// ---------------------------------------------------------------------------
// Carving
// ---------------------------------------------------------------------------

/**
 * Split a region into sections: anchors climb to the largest block that holds
 * no other anchor, blocks become sections, and the region's remainder is
 * handed to `remainder` as runs in document order.
 */
function carve(
  r: Reader,
  region: string,
  anchorsIn: Anchor[],
  remainder: (runs: string[][]) => Draft[],
): Draft[] {
  const ix = r.index;
  // One anchor per node; document order.
  const seen = new Set<string>();
  let anchors = anchorsIn
    .filter(
      (a) => ix.byId.has(a.id) && a.id !== region && ix.contains(region, a.id),
    )
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => r.order(a.id) - r.order(b.id));

  // Nested anchors: containers handle their own insides; other blocks absorb
  // nested anchors except extractable ones.
  anchors = anchors.filter((a) => {
    const outer = anchors.filter((b) => b !== a && ix.contains(b.id, a.id));
    if (outer.length === 0) return true;
    if (outer.some((b) => b.carve)) return false;
    return a.extract === true;
  });

  const climbed = new Map<Anchor, string>();
  for (const a of anchors) {
    let cur = a.id;
    if (a.climb !== 'none') {
      const blockers = anchors.filter((b) => b.group !== a.group);
      const members = anchors.filter((b) => b.group === a.group);
      for (;;) {
        const p = ix.parent(cur);
        if (p === null || p === region) break;
        if (blockers.some((b) => ix.contains(p, b.id))) break;
        if (r.area(p) > 0.6 * Math.max(1, r.area(region)) && r.area(region) > 0)
          break;
        if (a.climb === 'tight') {
          const ctrls = r.controls(p);
          const own = ctrls.filter(
            (c) =>
              (a.member?.(c) ?? false) ||
              members.some((m) => ix.contains(m.id, c.id)),
          ).length;
          if (ctrls.length - own > own) break;
        }
        cur = p;
      }
    }
    climbed.set(a, cur);
  }

  // Blocks per group (outermost only).
  const groups = new Map<string, { anchors: Anchor[]; blocks: string[] }>();
  for (const a of anchors) {
    const g = groups.get(a.group) ?? { anchors: [], blocks: [] };
    g.anchors.push(a);
    g.blocks.push(climbed.get(a)!);
    groups.set(a.group, g);
  }
  for (const g of groups.values()) {
    g.blocks = [...new Set(g.blocks)].filter(
      (b) => !g.blocks.some((o) => o !== b && ix.contains(o, b)),
    );
  }
  const allBlocks = [...groups.values()].flatMap((g) => g.blocks);

  const drafts: Draft[] = [];
  for (const g of groups.values()) {
    const lead = g.anchors[0]!;
    if (lead.carve) {
      for (const b of g.blocks) drafts.push(...lead.carve(b));
      continue;
    }
    // Extractable blocks inside a block become their own sections.
    const partsOf = (b: string): string[] => {
      const own = allBlocks.filter(
        (o) => o !== b && !g.blocks.includes(o) && ix.contains(b, o),
      );
      const parts = own.length ? uncoveredSubtrees(ix, b, own) : [b];
      return parts.length <= SPEC_MAX_NODE_IDS ? parts : [b];
    };
    const sets = lead.merge
      ? [sortIds(r, g.blocks.flatMap(partsOf))]
      : g.blocks.map((b) => sortIds(r, partsOf(b)));
    for (const set of sets) {
      for (const chunk of chunks(set)) {
        const heading =
          lead.heading && chunk.some((id) => ix.contains(id, lead.heading!))
            ? lead.heading
            : undefined;
        drafts.push({
          kind: lead.kind,
          importance: lead.importance ?? IMPORTANCE_OF[lead.kind],
          layout: lead.layout ?? LAYOUT_OF[lead.kind],
          ids: chunk,
          heading,
        });
      }
    }
  }

  const rest = uncoveredSubtrees(ix, region, allBlocks);
  if (rest.length) {
    const runs: string[][] = [];
    let run: string[] = [];
    const blockOrders = allBlocks.map((b) => r.order(b)).sort((a, b) => a - b);
    let last = -1;
    for (const id of rest) {
      const o = r.order(id);
      const between = blockOrders.some((bo) => bo > last && bo < o);
      if (run.length && (between || run.length >= SPEC_MAX_NODE_IDS)) {
        runs.push(run);
        run = [];
      }
      run.push(id);
      last = o;
    }
    if (run.length) runs.push(run);
    drafts.push(...remainder(runs));
  }
  return drafts;
}

/** Split ids into runs of at most SPEC_MAX_NODE_IDS (one section each). */
function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += SPEC_MAX_NODE_IDS) {
    out.push(ids.slice(i, i + SPEC_MAX_NODE_IDS));
  }
  return out;
}

function sortIds(r: Reader, ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => r.order(a) - r.order(b));
}

interface PageParts {
  banners: string[];
  footers: string[];
  folds: Fold[];
  main: string | null;
  primary: Primary | null;
}

/** Fold anchors (ads, clutter, dialogs, consent) inside one region, pulled out of any block holding them. */
function foldAnchors(
  folds: readonly Fold[],
  within?: (id: string) => boolean,
): Anchor[] {
  return folds
    .filter((f) => !within || within(f.id))
    .map((f, i) => ({
      id: f.id,
      kind: f.kind,
      group: `fold:${f.kind}:${i}`,
      climb: 'none' as const,
      extract: true,
      importance: f.importance,
    }));
}

/**
 * The top level: banner, footer and main are carved by their own rules;
 * navigation, side rails, search, forms and labelled regions outside them
 * become sections of their own; the rest is the page's remainder.
 */
function carvePage(r: Reader, root: string, parts: PageParts): Draft[] {
  const anchors: Anchor[] = [...foldAnchors(parts.folds)];
  const { primary } = parts;

  for (const b of parts.banners) {
    anchors.push({
      id: b,
      kind: 'header',
      group: `banner:${b}`,
      climb: 'none',
      carve: (block) => carveHeader(r, block, parts),
    });
  }
  for (const f of parts.footers) {
    anchors.push({
      id: f,
      kind: 'footer',
      group: `footer:${f}`,
      climb: 'none',
      carve: (block) => carveFooter(r, block, parts),
    });
  }
  if (parts.main !== null) {
    const main = parts.main;
    anchors.push({
      id: main,
      kind: primary?.kind ?? 'other',
      group: 'main',
      climb: 'none',
      carve: (block) => carveMain(r, block, parts),
    });
  } else if (primary) {
    primary.ids.forEach((id) =>
      anchors.push({
        id,
        kind: primary.kind,
        group: 'primary',
        merge: true,
        climb: 'none',
        importance: 'primary',
      }),
    );
  }

  const known = [
    ...parts.banners,
    ...parts.footers,
    ...(parts.main ? [parts.main] : []),
  ];
  const outsideKnown = (id: string): boolean =>
    !known.some((k) => r.index.contains(k, id));

  // Navigation, side rails, search and forms outside the known regions.
  for (const id of r.outermost(
    (n) =>
      n.role === 'navigation' ||
      n.role === 'complementary' ||
      n.role === 'search' ||
      n.role === 'form' ||
      (n.role === 'region' && !!n.label) ||
      ['recommendations', 'help_contact', 'navigation', 'form'].includes(
        r.verdict(n.id) ?? '',
      ),
  )) {
    if (!outsideKnown(id)) continue;
    const n = r.node(id);
    const v = r.verdict(id);
    if (v === 'recommendations') {
      anchors.push(leaf(id, 'related'));
    } else if (v === 'help_contact') {
      anchors.push(leaf(id, 'help_and_contact'));
    } else if (n.role === 'navigation' || v === 'navigation') {
      anchors.push(leaf(id, navKind(r, id, 'page')));
    } else if (n.role === 'complementary') {
      anchors.push({
        id,
        kind: 'secondary',
        group: `aside:${id}`,
        climb: 'none',
        carve: (block) => carveAside(r, block, parts),
      });
    } else if (n.role === 'search') {
      anchors.push(leaf(id, 'search'));
    } else if (n.role === 'form' || v === 'form') {
      anchors.push(leaf(id, formKind(r, id)));
    } else {
      anchors.push(leaf(id, RELATED.test(label(n)) ? 'related' : 'secondary'));
    }
  }

  return carve(r, root, anchors, (runs) =>
    runs.map((run) => remainderDraft(r, run, 'page', primary)),
  );
}

function leaf(id: string, kind: SectionKind, group?: string): Anchor {
  return { id, kind, group: group ?? `${kind}:${id}`, climb: 'none' };
}

/**
 * What a navigation block is: breadcrumbs, pagination, an in-page contents
 * list (mostly fragment links), else primary navigation in the banner, a top
 * bar or a left rail, and secondary navigation elsewhere.
 */
function navKind(
  r: Reader,
  id: string,
  where: 'page' | 'main' | 'banner',
): SectionKind {
  const n = r.node(id);
  const l = r.regionLabel(id);
  if (BREADCRUMB.test(l)) return 'breadcrumbs';
  const pager = r.controls(id).filter((c) => PAGINATION.test(label(c)));
  if (/\bpaginat|\bpager\b/i.test(l) || pager.length >= 2) return 'pagination';
  const links = r
    .within(id)
    .filter((m) => m.kind === 'control' && m.role === 'link');
  const fragments = links.filter((m) => m.href === 'fragment').length;
  if (TOC.test(l) || (links.length >= 3 && fragments / links.length >= 0.6))
    return 'secondary_nav';
  if (where === 'banner') return 'primary_nav';
  if (where === 'main') return 'secondary_nav';
  const topBar = n.box[1] < r.vh && n.box[2] >= 0.6 * r.vw;
  const leftRail = n.box[0] < 0.25 * r.vw && n.box[3] >= 0.5 * r.vh;
  return topBar || leftRail ? 'primary_nav' : 'secondary_nav';
}

/** A form is search, a newsletter sign-up (clutter: one email field and sign-up words), or a real form. */
function formKind(r: Reader, id: string): SectionKind {
  const inputs = r.controls(id).filter((c) => c.kind === 'input');
  const email = inputs.some((c) => c.inputType === 'email');
  const words = `${r.regionLabel(id)} ${r
    .controls(id)
    .map((c) => label(c))
    .join(' ')}`;
  const search = r.index
    .subtree(id)
    .some((d) => isSearchFieldNode(r.node(d)) || r.node(d).role === 'search');
  if (search) return 'search';
  // A sign-up box is small: it never holds consent, landmarks or the page heading.
  const structural = r.index.subtree(id).some((d) => {
    const n = r.node(d);
    return (
      n.flags.includes('consenthint') ||
      n.role === 'main' ||
      n.tag === 'main' ||
      n.role === 'banner' ||
      n.role === 'contentinfo' ||
      (n.kind === 'heading' && n.level === 1)
    );
  });
  if (email && inputs.length <= 2 && !structural && NEWSLETTER.test(words))
    return 'clutter';
  return 'form';
}

// --- Header ------------------------------------------------------------------

/**
 * The banner: the search field with its own buttons, the account and cart
 * controls, and navigation become sections; the logo and the rest stay
 * 'header'. The trusted-slot rule is applied afterwards (enforceTrust).
 */
function carveHeader(r: Reader, banner: string, parts: PageParts): Draft[] {
  const anchors: Anchor[] = [
    ...foldAnchors(parts.folds, (id) => r.index.contains(banner, id)),
  ];
  const nodes = r.within(banner);
  const searchRoot = (id: string): boolean =>
    [id, ...skeletonAncestors(r.index, id)].some(
      (a) => r.node(a).role === 'search',
    );
  const searchMember = (c: SkeletonNode): boolean =>
    isSearchFieldNode(c) ||
    (c.kind === 'input' && searchRoot(c.id)) ||
    SEARCH_CONTROL.test(label(c));
  for (const n of nodes) {
    const isSearchInput =
      n.kind === 'input' &&
      (isSearchFieldNode(n) ||
        searchRoot(n.id) ||
        ((n.inputType === 'text' || n.role === 'combobox') &&
          SEARCH_WORDS.test(label(n))));
    if (isSearchInput) {
      anchors.push({
        id: n.id,
        kind: 'search',
        group: 'search',
        merge: true,
        climb: 'tight',
        member: searchMember,
      });
    }
  }
  const accountMember = (c: SkeletonNode): boolean =>
    ACCOUNT.test(label(c)) || ACCOUNT_TOOLS.test(label(c));
  for (const n of nodes) {
    const account =
      (n.kind === 'control' && accountMember(n)) ||
      (n.role === 'navigation' &&
        /\b(account|personal|user)\b/i.test(label(n)));
    if (account) {
      anchors.push({
        id: n.id,
        kind: 'account_and_cart',
        group: 'account',
        merge: true,
        climb: 'tight',
        member: accountMember,
      });
    }
  }
  const hasSearchOrAccount = (id: string): boolean =>
    anchors.some(
      (a) =>
        (a.group === 'search' || a.group === 'account') &&
        r.index.contains(id, a.id),
    );
  for (const n of nodes) {
    if (
      n.role === 'navigation' &&
      n.id !== banner &&
      !hasSearchOrAccount(n.id)
    ) {
      // Navigation landmarks stay as they are: climbing would take the logo along.
      anchors.push({
        id: n.id,
        kind: navKind(r, n.id, 'banner'),
        group: 'nav',
        climb: 'none',
      });
    } else if (
      n.kind === 'collection' &&
      r.navLike(n.id) &&
      (n.collection?.count ?? 0) >= 3 &&
      !anchors.some((a) => r.index.contains(a.id, n.id))
    ) {
      anchors.push({
        id: n.id,
        kind: 'primary_nav',
        group: 'nav',
        climb: 'tight',
        member: (c) => c.kind === 'control' && c.role === 'link',
      });
    }
  }

  const drafts = carve(r, banner, anchors, (runs) => [
    {
      kind: 'header',
      importance: IMPORTANCE_OF.header,
      layout: LAYOUT_OF.header,
      ids: runs.flat().slice(0, SPEC_MAX_NODE_IDS),
    },
  ]);
  return drafts;
}

/** Keep only trusted nodes in top-strip sections; the rest get their own section. */
function enforceTrust(r: Reader, drafts: Draft[]): Draft[] {
  const roots = trustedSlotRoots(
    r.index,
    drafts.filter((d) => CONTENT_KINDS.has(d.kind)).flatMap((d) => d.ids),
  );
  const out: Draft[] = [];
  for (const d of drafts) {
    if (!TRUSTED_KINDS.has(d.kind)) {
      out.push(d);
      continue;
    }
    const ok = d.ids.filter(
      (id) => !trustedSlotIssue(r.index, id, { sectionKind: d.kind }, roots),
    );
    const bad = d.ids.filter((id) => !ok.includes(id));
    // A primary strip section that held content hands the primary role to the content.
    const primary = d.importance === 'primary' && bad.length > 0;
    if (ok.length)
      out.push({
        ...d,
        ids: ok,
        importance: primary ? 'secondary' : d.importance,
      });
    if (bad.length) {
      const nav = bad.every(
        (id) =>
          r.node(id).role === 'navigation' ||
          (r.node(id).kind === 'collection' && r.navLike(id)),
      );
      out.push({
        kind: nav ? 'secondary_nav' : 'other',
        importance: primary ? 'primary' : 'secondary',
        layout: nav ? LAYOUT_OF.secondary_nav : 'as_is',
        ids: bad,
      });
    }
  }
  return out;
}

// --- Footer ------------------------------------------------------------------

/** The footer: legal and help blocks (by majority of their links) come out; the rest stays 'footer'. */
function carveFooter(r: Reader, footer: string, parts: PageParts): Draft[] {
  const anchors: Anchor[] = [
    ...foldAnchors(parts.folds, (id) => r.index.contains(footer, id)),
  ];
  const support = (n: SkeletonNode): 'legal' | 'help' | null => {
    const l = n.kind === 'collection' ? r.regionLabel(n.id) : label(n);
    if (!l) return null;
    if (LEGAL.test(l)) return 'legal';
    if (HELP.test(l)) return 'help';
    return null;
  };
  const kinds = new Map<string, 'legal' | 'help'>();
  for (const n of r.within(footer)) {
    const isLink = n.kind === 'control' || n.kind === 'stext';
    const isList = n.kind === 'collection';
    const isHeading = n.kind === 'heading';
    if (!(isLink || isList || isHeading)) continue;
    const s = support(n);
    if (!s) continue;
    kinds.set(n.id, s);
    anchors.push({
      id: n.id,
      kind: 'legal',
      group: 'support',
      merge: true,
      climb: isHeading ? 'loose' : 'tight',
      member: (c) => support(c) !== null,
    });
  }
  const drafts = carve(r, footer, anchors, (runs) => [
    {
      kind: 'footer',
      importance: IMPORTANCE_OF.footer,
      layout: LAYOUT_OF.footer,
      ids: runs.flat().slice(0, SPEC_MAX_NODE_IDS),
    },
  ]);
  // Each support block is legal or help by the majority of what it holds.
  const out: Draft[] = [];
  for (const d of drafts) {
    if (d.kind !== 'legal') {
      out.push(d);
      continue;
    }
    const legal: string[] = [];
    const help: string[] = [];
    for (const id of d.ids) {
      let l = 0;
      let h = 0;
      for (const sub of r.index.subtree(id)) {
        const k = kinds.get(sub);
        if (k === 'legal') l++;
        else if (k === 'help') h++;
      }
      (h > l ? help : legal).push(id);
    }
    if (legal.length) out.push({ ...d, ids: legal });
    if (help.length) {
      out.push({
        kind: 'help_and_contact',
        importance: IMPORTANCE_OF.help_and_contact,
        layout: LAYOUT_OF.help_and_contact,
        ids: help,
      });
    }
  }
  return out;
}

// --- Side rails ---------------------------------------------------------------

/** A side rail: related or help as a whole when it says so, else its related/help blocks and a tertiary rest. */
function carveAside(r: Reader, aside: string, parts: PageParts): Draft[] {
  const l = r.regionLabel(aside);
  const v = r.verdict(aside);
  const whole: SectionKind | null =
    v === 'recommendations' || RELATED.test(l)
      ? 'related'
      : v === 'help_contact' || HELP.test(l)
        ? 'help_and_contact'
        : null;
  const anchors: Anchor[] = [
    ...foldAnchors(parts.folds, (id) => r.index.contains(aside, id)),
  ];
  if (whole) {
    // The whole rail is one section; only folds come out of it.
    return carve(r, aside, anchors, (runs) => [
      {
        kind: whole,
        importance: IMPORTANCE_OF[whole],
        layout: LAYOUT_OF[whole],
        ids: runs.flat().slice(0, SPEC_MAX_NODE_IDS),
      },
    ]);
  }
  for (const n of r.within(aside)) {
    if (n.id === aside) continue;
    const verdict = r.verdict(n.id);
    if (verdict === 'recommendations')
      anchors.push(leaf(n.id, 'related', 'related'));
    else if (verdict === 'help_contact')
      anchors.push(leaf(n.id, 'help_and_contact', 'help'));
    else if (n.kind === 'heading' && RELATED.test(label(n)))
      anchors.push({
        id: n.id,
        kind: 'related',
        group: 'related',
        climb: 'loose',
      });
    else if (n.kind === 'heading' && HELP.test(label(n)))
      anchors.push({
        id: n.id,
        kind: 'help_and_contact',
        group: 'help',
        climb: 'loose',
      });
  }
  return carve(r, aside, anchors, (runs) =>
    runs.map((run) => ({
      kind: 'secondary' as const,
      importance: 'tertiary' as const,
      layout: 'as_is' as const,
      ids: run,
    })),
  );
}

// --- Main ----------------------------------------------------------------------

/**
 * The main scope: the primary content, then anchors for what surrounds it
 * (page heading, tabs, sort, filters, toolbar, forms, in-page navigation,
 * pagination, related, comments, help, side rails), then the remainder.
 */
function carveMain(r: Reader, main: string, parts: PageParts): Draft[] {
  const ix = r.index;
  const primary = parts.primary;
  const pIds = primary?.ids ?? [];
  const inP = (id: string): boolean => pIds.some((p) => ix.contains(p, id));
  const anchors: Anchor[] = [
    ...foldAnchors(parts.folds, (id) => ix.contains(main, id)),
  ];
  if (primary) {
    for (const id of pIds) {
      anchors.push({
        id,
        kind: primary.kind,
        group: 'primary',
        merge: true,
        climb: 'none',
        importance: 'primary',
        layout: LAYOUT_OF[primary.kind],
      });
    }
  }
  const pTop = pIds.length
    ? Math.min(...pIds.map((p) => r.node(p).box[1]))
    : Infinity;
  const pLeft = pIds.length
    ? Math.min(...pIds.map((p) => r.node(p).box[0]))
    : 0;
  const pFirst = pIds.length
    ? Math.min(...pIds.map((p) => r.order(p)))
    : Infinity;
  const pBottom = pIds.length
    ? Math.max(...pIds.map((p) => r.node(p).box[1] + r.node(p).box[3]))
    : Infinity;

  const nodes = r.within(main).filter((n) => n.id !== main && !inP(n.id));
  const add = (a: Anchor): void => {
    if (!anchors.some((b) => b.id === a.id)) anchors.push(a);
  };

  for (const n of nodes) {
    const v = r.verdict(n.id);
    const l = label(n);
    if (v === 'recommendations') {
      add(leaf(n.id, 'related'));
      continue;
    }
    if (v === 'help_contact') {
      add(leaf(n.id, 'help_and_contact'));
      continue;
    }
    if (n.role === 'complementary') {
      add({
        id: n.id,
        kind: 'secondary',
        group: `aside:${n.id}`,
        climb: 'none',
        carve: (block) => carveAside(r, block, parts),
      });
      continue;
    }
    if (n.role === 'navigation' || v === 'navigation') {
      const kind = navKind(r, n.id, 'main');
      add({ id: n.id, kind, group: kind, climb: 'loose' });
      continue;
    }
    if (n.role === 'form' || n.tag === 'form') {
      // Newsletter boxes are already folds (findFolds); real forms keep their own section.
      const inputs = r.controls(n.id).filter((c) => c.kind === 'input');
      if (formKind(r, n.id) === 'form' && inputs.length >= 2) {
        add({ id: n.id, kind: 'form', group: `form:${n.id}`, climb: 'none' });
        continue;
      }
    }
    if (n.role === 'toolbar') {
      add({
        id: n.id,
        kind: 'toolbar',
        group: `toolbar:${n.id}`,
        climb: 'none',
      });
      continue;
    }
    if (n.role === 'tablist' || (n.kind === 'collection' && tabList(r, n.id))) {
      // Tabs below the main content belong to the part they sit in (a
      // product's review topics), not to the page's own views.
      if (n.box[1] >= pBottom) continue;
      const words = n.kind === 'collection' ? r.regionLabel(n.id) : l;
      const sort = SORT.test(words) || SORT.test(tabLabels(r, n.id));
      const kind: SectionKind = sort ? 'sort_and_view' : 'tabs';
      add({ id: n.id, kind, group: kind, climb: 'loose' });
      continue;
    }
    if (
      n.kind === 'input' &&
      (n.inputType === 'select' || n.role === 'combobox') &&
      SORT.test(l)
    ) {
      add({
        id: n.id,
        kind: 'sort_and_view',
        group: 'sort_and_view',
        climb: 'loose',
      });
      continue;
    }
    if (n.kind === 'input' && isSearchFieldNode(n)) {
      // A search field inside the content (a site's search page) is a form
      // there; only chrome may be drawn in the top strip.
      add({
        id: n.id,
        kind: 'form',
        group: 'search-in-main',
        climb: 'tight',
        member: (c) => SEARCH_CONTROL.test(label(c)) || isSearchFieldNode(c),
      });
      continue;
    }
    if (n.kind === 'collection') {
      const narrowLeft =
        n.box[0] + n.box[2] <= pLeft + 8 && n.box[2] <= 0.3 * r.vw;
      if (FILTER.test(r.regionLabel(n.id)) || (pIds.length && narrowLeft)) {
        add({ id: n.id, kind: 'filters', group: 'filters', climb: 'loose' });
        continue;
      }
    }
    if ((n.kind === 'group' || n.kind === 'landmark') && FILTER.test(l)) {
      add({ id: n.id, kind: 'filters', group: 'filters', climb: 'none' });
      continue;
    }
    if (n.kind === 'heading') {
      if (RELATED.test(l)) {
        add({ id: n.id, kind: 'related', group: `related`, climb: 'loose' });
      } else if (COMMENTS.test(l)) {
        add({ id: n.id, kind: 'comments', group: 'comments', climb: 'loose' });
      } else if (HELP.test(l)) {
        add({
          id: n.id,
          kind: 'help_and_contact',
          group: 'help',
          climb: 'loose',
        });
      }
      continue;
    }
    if ((n.kind === 'landmark' || n.role === 'region') && COMMENTS.test(l)) {
      add({ id: n.id, kind: 'comments', group: `comments`, climb: 'none' });
      continue;
    }
    if (n.kind === 'group' || n.kind === 'landmark') {
      const ctrls = r.controls(n.id);
      const pager = ctrls.filter((c) => PAGINATION.test(label(c)));
      if (pager.length >= 2 && pager.length >= ctrls.length / 2) {
        add({
          id: n.id,
          kind: 'pagination',
          group: 'pagination',
          climb: 'loose',
        });
      }
    }
  }

  // The page heading: the h1, or the largest heading before the primary content.
  const headings = nodes.filter(
    (n) => n.kind === 'heading' && !anchors.some((a) => a.id === n.id),
  );
  const h1 =
    headings.find((n) => n.level === 1) ??
    headings
      .filter((n) => r.order(n.id) < pFirst && n.box[1] <= pTop)
      .sort(
        (a, b) =>
          (b.fontPx ?? 0) - (a.fontPx ?? 0) || r.order(a.id) - r.order(b.id),
      )[0];
  if (h1 && !anchors.some((a) => ix.contains(a.id, h1.id) && a.carve)) {
    add({
      id: h1.id,
      kind: 'page_heading',
      group: 'page_heading',
      climb: 'loose',
      heading: h1.id,
    });
  }

  const drafts = carve(r, main, anchors, (runs) =>
    runs.map((run) => remainderDraft(r, run, 'main', primary)),
  );
  // No narrower primary than main itself: its largest remainder carries the task.
  if (primary && pIds.includes(main)) {
    let best: Draft | null = null;
    let bestArea = -1;
    for (const d of drafts) {
      if (d.importance === 'fold' || TRUSTED_KINDS.has(d.kind)) continue;
      const a = d.ids.reduce((sum, id) => sum + r.area(id), 0);
      if (a > bestArea) {
        best = d;
        bestArea = a;
      }
    }
    if (best) {
      best.importance = 'primary';
      if (best.kind === 'secondary') best.kind = primary.kind;
    }
  }
  return drafts;
}

/** A collection whose items are tabs. */
function tabList(r: Reader, listId: string): boolean {
  const ex = r.index.exemplarOf.get(listId);
  return ex !== undefined && r.node(ex).role === 'tab';
}

/** The labels of a tab row's controls, joined (to tell sort tabs from view tabs). */
function tabLabels(r: Reader, id: string): string {
  return r.index
    .subtree(id)
    .map((d) => r.node(d))
    .filter((n) => n.role === 'tab' || n.kind === 'control')
    .map((n) => label(n))
    .join(' ');
}

/** A section for what no anchor claimed. */
function remainderDraft(
  r: Reader,
  run: string[],
  where: 'page' | 'main',
  primary: Primary | null,
): Draft {
  const nodes = run.flatMap((id) => r.within(id));
  const meaningful = nodes.filter(
    (n) =>
      n.kind !== 'group' && n.kind !== 'landmark' && n.kind !== 'collection',
  );
  const linksOnly =
    meaningful.length > 0 &&
    meaningful.every(
      (n) =>
        (n.kind === 'control' && n.role === 'link') ||
        n.kind === 'heading' ||
        (n.kind === 'collection' && r.navLike(n.id)),
    ) &&
    meaningful.some((n) => n.kind === 'control');
  const mediaOnly =
    meaningful.length > 0 && meaningful.every((n) => n.kind === 'media');
  const afterPrimary =
    primary !== null &&
    primary.ids.length > 0 &&
    r.order(run[0]!) > Math.max(...primary.ids.map((p) => r.order(p)));
  let kind: SectionKind;
  if (mediaOnly) kind = 'media';
  else if (linksOnly) kind = afterPrimary ? 'related' : 'secondary_nav';
  else if (where === 'main') kind = 'secondary';
  else kind = 'other';
  const textual = meaningful.filter(
    (n) => n.kind !== 'media' && n.kind !== 'stext',
  ).length;
  return {
    kind,
    importance:
      kind === 'related'
        ? 'tertiary'
        : textual === 0 && kind !== 'media'
          ? 'tertiary'
          : 'secondary',
    layout: LAYOUT_OF[kind],
    ids: run,
  };
}

/** No primary was found: the largest content-like draft takes the role. */
function promoteLargest(r: Reader, drafts: Draft[]): void {
  const eligible = drafts.filter(
    (d) =>
      ![
        'ads',
        'clutter',
        'overlay_modal',
        'consent',
        'header',
        'search',
        'account_and_cart',
        'footer',
        'legal',
      ].includes(d.kind),
  );
  const pool = eligible.length ? eligible : drafts;
  let best: Draft | undefined;
  let bestArea = -1;
  for (const d of pool) {
    const a = d.ids.reduce((s, id) => s + r.area(id), 0);
    if (a > bestArea) {
      best = d;
      bestArea = a;
    }
  }
  if (!best) return;
  best.importance = 'primary';
  // A page that is only a consent prompt: shown as it is, never as "consent" primary.
  if (best.kind === 'consent') {
    best.kind = 'other';
    best.layout = 'as_is';
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * Drafts to spec sections: one primary, page order, at most
 * SPEC_MAX_SECTIONS (adjacent remainder-like sections merge first), no id
 * inside another, headings and navigation layouts filled in.
 */
function finishSections(r: Reader, drafts: Draft[]): SpecSection[] {
  let list = drafts
    .map((d) => ({ ...d, ids: sortIds(r, d.ids) }))
    .filter((d) => d.ids.length > 0);
  // One primary.
  let seenPrimary = false;
  for (const d of list) {
    if (d.importance !== 'primary') continue;
    if (seenPrimary) d.importance = 'secondary';
    seenPrimary = true;
  }
  list.sort((a, b) => r.order(a.ids[0]!) - r.order(b.ids[0]!));
  // A consent prompt is answered, never hidden, but it never leads: it
  // follows the primary section (docs/11 R2).
  const consent = list.filter(
    (d) => d.kind === 'consent' && d.importance !== 'primary',
  );
  const at = list.findIndex((d) => d.importance === 'primary');
  if (consent.length && at >= 0) {
    const rest = list.filter((d) => !consent.includes(d));
    const p = rest.findIndex((d) => d.importance === 'primary');
    list = [...rest.slice(0, p + 1), ...consent, ...rest.slice(p + 1)];
  }

  // Bound the section count: merge adjacent remainder-like sections first.
  const mergeable: ReadonlySet<SectionKind> = new Set([
    'secondary',
    'other',
    'secondary_nav',
    'related',
    'media',
  ]);
  while (list.length > SPEC_MAX_SECTIONS) {
    let merged = false;
    for (let i = list.length - 2; i >= 0; i--) {
      const a = list[i]!;
      const b = list[i + 1]!;
      if (
        a.kind === b.kind &&
        mergeable.has(a.kind) &&
        a.importance !== 'primary' &&
        b.importance !== 'primary' &&
        a.ids.length + b.ids.length <= SPEC_MAX_NODE_IDS
      ) {
        a.ids = [...a.ids, ...b.ids];
        list.splice(i + 1, 1);
        merged = true;
        break;
      }
    }
    if (!merged) {
      // Drop the last non-primary tertiary or folded section; its nodes stay reachable via "Everything else".
      let drop = list.length - 1;
      for (let i = list.length - 1; i >= 0; i--) {
        const imp = list[i]!.importance;
        if (imp === 'fold' || imp === 'tertiary') {
          drop = i;
          break;
        }
      }
      if (list[drop]!.importance === 'primary') drop = Math.max(0, drop - 1);
      list.splice(drop, 1);
    }
  }
  list = list.slice(0, SPEC_MAX_SECTIONS);

  // No section id inside another's (a fallback above may have kept a block whole).
  const all = list.flatMap((d) => d.ids);
  for (const d of list) {
    d.ids = d.ids.filter(
      (id) => !all.some((o) => o !== id && r.index.contains(o, id)),
    );
  }
  list = list.filter((d) => d.ids.length > 0);

  const p = list.find((d) => d.importance === 'primary');
  const primaryAt = p ? r.order(p.ids[0]!) : Infinity;
  const sections = list.map((d) => ({
    kind: d.kind,
    importance: d.importance,
    node_ids: d.ids,
    heading_ref:
      d.heading !== undefined && d.heading !== null
        ? d.heading
        : sectionHeading(r, d),
    layout: setLayout(r, d, r.order(d.ids[0]!) > primaryAt),
  }));
  // One hero, buy_box only on product_detail (the validator's rules).
  directSections(sections);
  return sections;
}

/**
 * Navigation and filters by size. Short link sets are chips (primary_nav)
 * or rows (secondary_nav); long ones are a menu above the main content and
 * link columns below it. Long filters are a menu.
 */
function setLayout(r: Reader, d: Draft, afterPrimary: boolean): SectionLayout {
  if (d.kind === 'filters') {
    const n = d.ids.reduce((s, id) => s + r.choices(id), 0);
    return n > LONG_SET ? 'menu' : d.layout;
  }
  if (d.kind !== 'primary_nav' && d.kind !== 'secondary_nav') return d.layout;
  const links = d.ids.reduce((s, id) => s + r.links(id), 0);
  if (links > LONG_SET) return afterPrimary ? 'link_grid' : 'menu';
  return d.kind === 'primary_nav' ? 'chip_bar' : 'row_list';
}

/**
 * A heading titles a section when it is the first non-media thing in it. An
 * article is titled only by its own h1: its first h2 names a part of it.
 */
function sectionHeading(r: Reader, d: Draft): string | null {
  if (d.kind === 'main_list' || d.kind === 'feature_blocks') return null;
  if (d.kind === 'article' || d.kind === 'product_detail') {
    for (const id of d.ids) {
      const h1 = r
        .within(id)
        .find((n) => n.kind === 'heading' && n.level === 1);
      if (h1) return h1.id;
    }
    return null;
  }
  for (const id of d.ids) {
    for (const n of r.within(id)) {
      if (n.kind === 'group' || n.kind === 'landmark' || n.kind === 'media')
        continue;
      if (n.kind === 'collection') return null;
      return n.kind === 'heading' ? n.id : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Collections: item kinds and field roles
// ---------------------------------------------------------------------------

/** What a collection's exemplar holds, by slot kind (its own slots only, not a nested list's). */
interface SlotFacts {
  slots: SkeletonNode[];
  pats: Set<string>;
  media: SkeletonNode[];
  imgctrls: SkeletonNode[];
  headings: SkeletonNode[];
  links: SkeletonNode[];
  checkboxes: SkeletonNode[];
  texts: SkeletonNode[];
  stexts: SkeletonNode[];
  controls: SkeletonNode[];
  bold: boolean;
  root: SkeletonNode;
}

function slotFacts(r: Reader, listId: string): SlotFacts | null {
  const ex = r.index.exemplarOf.get(listId);
  if (!ex) return null;
  const slots = r.index
    .subtree(ex)
    .filter((d) => r.index.slotList.get(d) === listId)
    .map((d) => r.node(d));
  const pats = new Set<string>();
  for (const n of slots) for (const p of n.text?.pat ?? []) pats.add(p);
  const controls = slots.filter((n) => n.kind === 'control');
  return {
    slots,
    pats,
    media: slots.filter((n) => n.kind === 'media'),
    imgctrls: controls.filter((n) => n.flags.includes('imgctrl')),
    headings: slots.filter((n) => n.kind === 'heading'),
    links: controls.filter(
      (n) => n.role === 'link' && !n.flags.includes('icon'),
    ),
    checkboxes: slots.filter(
      (n) =>
        n.kind === 'input' &&
        (n.inputType === 'checkbox' || n.role === 'checkbox'),
    ),
    texts: slots.filter((n) => n.kind === 'text'),
    stexts: slots.filter((n) => n.kind === 'stext'),
    controls,
    bold: slots.some((n) => n.flags.includes('bold')),
    root: r.node(ex),
  };
}

/**
 * The item kind from the exemplar's structure and text shapes: tabs, filter
 * options, message rows (checkbox plus bold or date), videos (duration over
 * media), products (price), comments (text plus reply/like), cards, links,
 * references (text with inline links), search results and images.
 */
function itemKind(
  r: Reader,
  listId: string,
  f: SlotFacts,
  inFilters: boolean,
): ItemKind {
  const { root } = f;
  const visual = f.media.length > 0 || f.imgctrls.length > 0;
  const tabs = f.controls.filter((c) => c.role === 'tab');
  if (
    root.role === 'tab' ||
    (tabs.length > 0 && tabs.length === f.controls.length)
  )
    return 'tab';
  if (inFilters) return 'filter_option';
  if (
    f.checkboxes.length &&
    (f.bold || f.pats.has('date')) &&
    f.imgctrls.length === 0
  )
    return 'message';
  if (f.pats.has('duration') && visual) return 'video';
  if (f.pats.has('price')) return 'product';
  if (f.texts.length && f.controls.some((c) => REPLY_LIKE.test(label(c))))
    return 'comment';
  if (root.kind === 'control') {
    if (visual || r.within(root.id).some((n) => n.kind === 'media'))
      return 'feature';
    if (root.role === 'button' && label(root).length <= 24) return 'chip';
    return label(root).length > 40 ? 'article_card' : 'nav_link';
  }
  if (r.navLike(listId)) {
    const only = f.links.length === 1 && f.headings.length === 0;
    return only && label(f.links[0]).length > 40 ? 'article_card' : 'nav_link';
  }
  if (
    !visual &&
    f.links.length === 1 &&
    f.texts.length === 0 &&
    f.headings.length === 0 &&
    label(f.links[0]).length > 40
  )
    return 'article_card';
  if (
    f.texts.some((t) => (t.text?.links ?? 0) > 0) &&
    !visual &&
    !f.headings.length
  )
    return 'reference';
  if (visual && (f.headings.length || f.links.length) && f.pats.has('date'))
    return 'article_card';
  if ((f.headings.length || f.links.length) && f.texts.length && !visual)
    return 'search_result';
  if (visual && f.headings.length) return 'feature';
  if (visual && !f.texts.length && f.links.length <= 1) return 'image';
  return 'other';
}

/**
 * Field roles for every slot of an exemplar, plus the slot that opens an
 * item. Text shapes decide most roles (duration, price, rating, count,
 * date); controls by flags and public interface words (overflow menus,
 * state toggles, the one constructive primary action). Irreversible actions
 * are never primary and never open an item.
 */
function fieldsFor(
  r: Reader,
  f: SlotFacts,
  kind: ItemKind,
): { fields: SpecField[]; open: string | null } {
  const fields: SpecField[] = [];
  const assigned = new Set<string>();
  const set = (n: SkeletonNode, role: FieldRole, show: FieldShow): void => {
    if (assigned.has(n.id)) return;
    assigned.add(n.id);
    fields.push({ slot_id: n.id, role, show });
  };
  // A control holding a heading or media is a card: its parts are the fields.
  const card = (n: SkeletonNode): boolean =>
    n.kind === 'control' &&
    r.index
      .subtree(n.id)
      .some((d) => d !== n.id && ['heading', 'media'].includes(r.node(d).kind));
  // Parts of a field control (a price link's spans) are not fields of their own.
  const insideField = (n: SkeletonNode): boolean =>
    skeletonAncestors(r.index, n.id).some((a) => assigned.has(a));
  const navish =
    kind === 'nav_link' ||
    kind === 'tab' ||
    kind === 'chip' ||
    kind === 'filter_option';
  const people = kind === 'comment' || kind === 'message';
  const snippetAlways = new Set<ItemKind>([
    'message',
    'search_result',
    'comment',
    'post',
    'reference',
    'other',
  ]);

  // The title: the strongest heading (a short badge heading loses to the
  // real title), else the longest-labelled text link (thumbnail links
  // last), else a bare control item, else (messages) the subject.
  let title: SkeletonNode | undefined = [...f.headings].sort(
    (a, b) => titleScore(b) - titleScore(a),
  )[0];
  if (!title && !people) {
    title = [...f.links]
      .filter((n) => !card(n))
      .sort(
        (a, b) =>
          Number(a.flags.includes('imgctrl')) -
            Number(b.flags.includes('imgctrl')) ||
          label(b).length - label(a).length,
      )[0];
  }
  if (!title && f.root.kind === 'control' && !card(f.root)) title = f.root;
  if (!title && kind === 'message') {
    // The subject: after the sender, the strongest and longest text; a short
    // chip before it ("Work", "Inbox") is a label badge, not the subject.
    const texts = f.stexts.filter((n) => !n.text?.pat?.length);
    const pool = texts.length > 1 ? texts.slice(1) : texts;
    title = [...pool].sort((a, b) => titleScore(b) - titleScore(a))[0];
  }

  // A bare count beside the stars ("(2.4K)") is how many rated them.
  const besideRating = (n: SkeletonNode): boolean =>
    f.slots.some(
      (m) =>
        m !== n &&
        r.index.parent(m.id) === r.index.parent(n.id) &&
        ((m.text?.pat?.includes('rating') ?? false) ||
          (m.kind === 'control' && RATING_LABEL.test(label(m)))),
    );
  // The price shown on the record: the current price, never a saving, a
  // struck list price or a price per unit, whichever comes first.
  const bestPrice = currentPrice(r, f, title?.id ?? null);
  const holdsBest = (n: SkeletonNode): boolean =>
    typeof bestPrice === 'string' &&
    n.id !== bestPrice &&
    skeletonAncestors(r.index, bestPrice).includes(n.id);
  let author = false;
  let price = false;
  let primaryAction = false;
  const action = (n: SkeletonNode): boolean =>
    !primaryAction &&
    !n.flags.includes('hoveronly') &&
    !isIrreversibleLabel(label(n)) &&
    (PRIMARY_ACTION.test(label(n)) || BUY.test(label(n)));
  for (const n of f.slots) {
    if (insideField(n) || card(n)) continue;
    // A link around the price (and its unit and list prices) is not a field
    // of its own: its parts are.
    if (holdsBest(n) && n.kind === 'control') continue;
    const l = label(n);
    const pat = n.text?.pat ?? [];
    if (n.id === bestPrice) {
      set(n, 'price', 'always');
      price = true;
      continue;
    }
    if (n === title) {
      set(n, navish && kind !== 'nav_link' ? 'label' : 'title', 'always');
      continue;
    }
    switch (n.kind) {
      case 'collection':
        set(n, navish ? 'link' : 'other', 'always');
        break;
      case 'media': {
        const tiny = n.box[2] < 32 && n.box[3] < 32;
        set(n, tiny ? 'decorative' : 'thumbnail', tiny ? 'hide' : 'always');
        break;
      }
      case 'heading':
        set(n, 'label', 'always');
        break;
      case 'input':
        if (n.inputType === 'checkbox' || n.role === 'checkbox')
          set(n, 'select_toggle', 'always');
        else set(n, 'other', 'always');
        break;
      case 'table':
        set(n, 'other', 'always');
        break;
      case 'text':
        set(n, 'description', snippetAlways.has(kind) ? 'always' : 'on_expand');
        break;
      case 'stext': {
        if (l.length <= 2 && !/[\p{L}\p{N}]/u.test(l)) {
          set(n, 'decorative', 'hide');
        } else if (pat.includes('duration')) set(n, 'duration', 'always');
        else if (pat.includes('price')) {
          const lead = !price && bestPrice === undefined;
          set(n, lead ? 'price' : 'meta', lead ? 'always' : 'on_expand');
          price = true;
        } else if (pat.includes('rating')) set(n, 'rating', 'always');
        else if (pat.includes('count'))
          set(n, RATING_COUNT.test(l) ? 'review_count' : 'meta', 'always');
        else if (pat.includes('date') || TIME_AGO.test(l))
          set(n, 'timestamp', 'always');
        else if (pat.includes('percent')) set(n, 'badge', 'always');
        else if (pat.includes('num')) {
          // A bare number beside a rating repeats it ("4.6" next to "4.6 out of 5").
          const repeat = f.slots.some(
            (m) =>
              m !== n &&
              r.index.parent(m.id) === r.index.parent(n.id) &&
              ((m.text?.pat?.includes('rating') ?? false) ||
                (m.kind === 'control' && RATING_LABEL.test(label(m)))),
          );
          set(n, repeat ? 'decorative' : 'meta', repeat ? 'hide' : 'always');
        } else if (people && !author) {
          set(n, 'author_or_channel', 'always');
          author = true;
        } else if (navish) set(n, 'label', 'always');
        else if (title && r.order(n.id) < r.order(title.id))
          set(n, 'badge', 'always');
        else set(n, 'meta', 'on_expand');
        break;
      }
      case 'control': {
        if (n.flags.includes('imgctrl')) {
          set(n, 'thumbnail', 'always');
        } else if (n.role === 'tab') {
          set(n, 'label', 'always');
        } else if (n.role === 'link' && !n.flags.includes('icon')) {
          if (pat.includes('rating')) set(n, 'rating', 'always');
          else if (pat.includes('price')) {
            const lead = !price && bestPrice === undefined;
            set(n, lead ? 'price' : 'meta', lead ? 'always' : 'on_expand');
            price = true;
          } else if (
            pat.includes('count') &&
            (RATING_COUNT.test(l) || besideRating(n))
          )
            set(n, 'review_count', 'always');
          else if (!navish && action(n)) {
            set(n, 'primary_action', 'always');
            primaryAction = true;
          } else if (
            !author &&
            (people ||
              kind === 'video' ||
              kind === 'post' ||
              kind === 'article_card') &&
            l.length <= 40
          ) {
            set(n, 'author_or_channel', 'always');
            author = true;
          } else set(n, 'link', navish ? 'always' : 'on_expand');
        } else if (!n.text?.chars && RATING_LABEL.test(l)) {
          // Stars drawn as an icon, named by their label.
          set(n, 'rating', 'always');
        } else if ((n.text?.chars ?? 0) > 80 && n.role !== 'link') {
          // A long text that expands on click (a summary, a snippet): its
          // words are the field, not a button label.
          set(n, 'description', 'on_expand');
        } else if (
          (n.flags.includes('icon') || n.flags.includes('popup')) &&
          OVERFLOW.test(l)
        ) {
          set(n, 'overflow_menu', 'always');
        } else if (n.flags.includes('pressed') || STATE.test(l)) {
          set(n, 'state_toggle', 'always');
        } else if (pat.includes('rating')) {
          set(n, 'rating', 'always');
        } else if (action(n)) {
          set(n, 'primary_action', 'always');
          primaryAction = true;
        } else {
          set(n, 'secondary_action', navish ? 'always' : 'on_expand');
        }
        break;
      }
      default:
        break;
    }
  }

  // Bound the field count, dropping hidden, then expandable, fields first.
  if (fields.length > SPEC_MAX_FIELDS) {
    const rank = { always: 0, on_expand: 1, hide: 2 } as const;
    const kept = new Set(
      [...fields]
        .sort((a, b) => rank[a.show] - rank[b.show])
        .slice(0, SPEC_MAX_FIELDS)
        .map((x) => x.slot_id),
    );
    fields.splice(
      0,
      fields.length,
      ...fields.filter((x) => kept.has(x.slot_id)),
    );
  }

  // What opens the item: the title link, a card control, a thumbnail link.
  let open: string | null = null;
  if (title) {
    if (title.kind === 'heading') {
      const inner = r.index
        .subtree(title.id)
        .map((d) => r.node(d))
        .find((n) => n.kind === 'control' && n.role === 'link');
      open = inner?.id ?? (title.flags.includes('headlink') ? title.id : null);
    } else if (title.kind === 'control') open = title.id;
    // Rows without any link open from their subject (webmail rows are click targets).
    else if (
      kind === 'message' &&
      !r.index
        .subtree(f.root.id)
        .some((d) => r.node(d).kind === 'control' && r.node(d).role === 'link')
    )
      open = title.id;
  }
  if (!open) {
    const cardCtl = [f.root, ...f.controls].find(
      (n) => n.kind === 'control' && card(n),
    );
    open = cardCtl?.id ?? f.imgctrls[0]?.id ?? null;
  }
  if (!open && kind === 'nav_link') open = f.links[0]?.id ?? null;
  if (!open && navish && f.root.kind === 'control') open = f.root.id;
  if (open) {
    const o = r.node(open);
    // Links navigate; a button that buys, sends or deletes never opens an item.
    if (o.role !== 'link' && isIrreversibleLabel(label(o))) open = null;
  }
  if (open && !fields.some((x) => x.slot_id === open)) {
    if (fields.length < SPEC_MAX_FIELDS) {
      fields.push({ slot_id: open, role: 'link', show: 'always' });
    } else open = null;
  }
  return { fields, open };
}

/**
 * The record's current price: among the exemplar's price texts (and links
 * whose name holds a price), the first that is not a saving ("Save CAD
 * 2.83"), a former or list price ("Typical: CAD19.83", or a price beside
 * such a label), a fee ("CAD 11.56 delivery") or a price per unit. A short
 * text beats the link around it, a larger one a smaller one. Null when every
 * price is one of those (no price is better than a saving), undefined when
 * the exemplar has no price at all.
 */
function currentPrice(
  r: Reader,
  f: SlotFacts,
  title: string | null,
): string | null | undefined {
  const cands = f.slots.filter(
    (n) =>
      n.id !== title &&
      ((n.kind === 'stext' && (n.text?.pat?.includes('price') ?? false)) ||
        (n.kind === 'control' &&
          !n.flags.includes('icon') &&
          ((n.text?.pat?.includes('price') ?? false) ||
            PRICE_IN_LABEL.test(label(n))))),
  );
  if (cands.length === 0) return undefined;
  const labelled = (n: SkeletonNode): boolean => {
    // "Typical:" + "CAD19.83" in one box: the box's other short texts.
    const p = r.index.parent(n.id);
    if (!p) return false;
    return f.slots.some(
      (m) =>
        m !== n &&
        m.kind === 'stext' &&
        r.index.parent(m.id) === p &&
        !(m.text?.pat?.includes('price') ?? false) &&
        NOT_THE_PRICE.test(label(m)),
    );
  };
  const penalty = (n: SkeletonNode): number => {
    // A link's name reads all its prices ("CAD 18.41 (CAD 3.68/count)
    // Typical: CAD 19.83"): the one it leads with is the one it shows.
    const l =
      n.kind === 'control'
        ? (label(n).split(/\s\(|\b(?:typical|list|was|save)\b/i)[0] ?? '')
        : label(n);
    let p = 0;
    if (NOT_THE_PRICE.test(l) || labelled(n)) p += 4;
    if (UNIT_PRICE.test(l)) p += 4;
    if ((n.text?.pat ?? []).some((x) => x === 'date' || x === 'percent'))
      p += 2;
    if (n.kind === 'control') p += 1;
    return p;
  };
  const best = [...cands].sort(
    (a, b) =>
      penalty(a) - penalty(b) ||
      (b.fontPx ?? 0) - (a.fontPx ?? 0) ||
      r.order(a.id) - r.order(b.id),
  )[0];
  return best && penalty(best) < 4 ? best.id : null;
}

/** How much a text looks like a record's title: long, bold, large; chips score low. */
function titleScore(n: SkeletonNode): number {
  const l = label(n);
  const chip = l.length <= 12 && !/\s\S+\s/.test(l);
  return (
    Math.min(l.length, 80) +
    (n.flags.includes('bold') || (n.weight ?? 400) >= 600 ? 8 : 0) +
    (n.fontPx ?? 0) -
    (chip ? 40 : 0)
  );
}

/**
 * Collections for the spec: the primary list first, then other record lists,
 * then link, tab and filter lists, up to SPEC_MAX_COLLECTIONS. Lists in ads,
 * clutter and dialog sections are skipped. Each gets its item kind's card and
 * the media shape of its thumbnail (lead is set once the page type is known).
 * A main_list or related section of grid cards is a card_grid, one of other
 * records a row_list.
 */
function buildCollections(
  r: Reader,
  sections: SpecSection[],
  primary: Primary | null,
): SpecCollection[] {
  const sectionOf = (id: string): SpecSection | undefined =>
    sections.find((s) => s.node_ids.some((x) => r.index.contains(x, id)));
  const lists = [...r.index.byId.values()]
    .filter((n) => n.kind === 'collection' && !r.isSlot(n.id))
    .map((n) => n.id);
  const candidates: Array<{ id: string; rank: number; section: SpecSection }> =
    [];
  for (const id of lists) {
    const s = sectionOf(id);
    if (
      !s ||
      s.kind === 'ads' ||
      s.kind === 'clutter' ||
      s.kind === 'overlay_modal'
    )
      continue;
    const record = isRecordCollection(r.index, id) && !r.navLike(id);
    const rank =
      primary?.list === id || (s.importance === 'primary' && record)
        ? 0
        : record
          ? 1
          : 2;
    candidates.push({ id, rank, section: s });
  }
  candidates.sort((a, b) => a.rank - b.rank || r.order(a.id) - r.order(b.id));
  const out: SpecCollection[] = [];
  for (const c of candidates) {
    if (out.length >= SPEC_MAX_COLLECTIONS) break;
    const facts = slotFacts(r, c.id);
    if (!facts) continue;
    const kind = itemKind(r, c.id, facts, c.section.kind === 'filters');
    const { fields, open } = fieldsFor(r, facts, kind);
    out.push({
      list_id: c.id,
      item_kind: kind,
      open_slot: open,
      card: CARD_OF[kind],
      media: mediaShape(r, fields),
      lead: 'none',
      fields,
    });
  }
  for (const s of sections) {
    if (s.kind !== 'main_list' && s.kind !== 'related') continue;
    const cards = out
      .filter((c) => s.node_ids.some((id) => r.index.contains(id, c.list_id)))
      .map((c) => c.card);
    if (cards.length && cards.every((c) => GRID_CARDS.includes(c)))
      s.layout = 'card_grid';
    else if (cards.length) s.layout = 'row_list';
  }
  out.sort((a, b) => r.order(a.list_id) - r.order(b.list_id));
  return out;
}

/**
 * The shape records' media is drawn at: the box of the exemplar's largest
 * thumbnail (the picture inside a thumbnail link, when the extraction kept
 * it), or none when no slot is a thumbnail.
 */
function mediaShape(r: Reader, fields: readonly SpecField[]): MediaShape {
  let best: SkeletonNode | null = null;
  for (const f of fields) {
    if (f.role !== 'thumbnail') continue;
    const n = r.node(f.slot_id);
    const pic = r.index
      .subtree(n.id)
      .map((d) => r.node(d))
      .filter((m) => m.kind === 'media')
      .reduce<SkeletonNode | null>(
        (a, m) => (a && r.area(a.id) >= r.area(m.id) ? a : m),
        null,
      );
    const box = pic ?? n;
    if (!best || r.area(box.id) > r.area(best.id)) best = box;
  }
  return best ? mediaShapeOf(best.box[2], best.box[3]) : 'none';
}

/**
 * The first record leads in a card_grid of media or story cards that is the
 * page's main list or a related list, when the page type allows a lead
 * (feeds, home portals, channels, articles) and the records have media.
 */
function setLeads(
  r: Reader,
  sections: readonly SpecSection[],
  collections: SpecCollection[],
  pageType: PageType,
): void {
  for (const c of collections) {
    const s = sections.find((x) =>
      x.node_ids.some((id) => r.index.contains(id, c.list_id)),
    );
    const leads =
      s !== undefined &&
      (s.importance === 'primary' || s.kind === 'related') &&
      s.layout === 'card_grid' &&
      c.media !== 'none' &&
      leadAllowed(c.card, pageType);
    c.lead = leads ? 'first' : 'none';
  }
}

// ---------------------------------------------------------------------------
// Page type and task
// ---------------------------------------------------------------------------

/**
 * A product marketing page whose text block won the primary section: a price
 * ("Starting at CA$277") and a shop or buy control in the first screen, and
 * at least three large pictures or players below.
 */
function storeHero(r: Reader, scope: string | null): boolean {
  const root = scope ?? r.index.roots[0];
  if (root === undefined) return false;
  const fold = r.sk.viewport.height * 1.25;
  const nodes = r.within(root);
  const top = nodes.filter((n) => n.box[1] < fold);
  const priced = top.some(
    (n) => n.kind === 'stext' && (n.text?.pat?.includes('price') ?? false),
  );
  const shop = top.some(
    (n) => n.kind === 'control' && (SHOP.test(label(n)) || BUY.test(label(n))),
  );
  if (!priced || !shop) return false;
  const media = nodes.filter(
    (n) => n.kind === 'media' && n.box[2] >= 240 && n.box[3] >= 160,
  ).length;
  return media >= 3;
}

/** Page type and primary task from the primary section, its item kind and the page signals. */
function pageType(
  r: Reader,
  primaryKind: SectionKind,
  listKind: ItemKind | undefined,
  sections: SpecSection[],
  scope: string | null,
): [PageType, PrimaryTask] {
  // A query typed or in the URL, or a "results" heading. A search box plus
  // repeated cards (the search_results_pattern signal) is any listing.
  const searched =
    r.sk.typed.length > 0 ||
    sections.some(
      (s) =>
        (s.kind === 'page_heading' || s.kind === 'sort_and_view') &&
        s.node_ids.some((id) =>
          r.within(id).some((n) => /\bresults?\b/i.test(label(n))),
        ),
    );
  switch (primaryKind) {
    case 'main_list': {
      if (
        r.signals.has('role_feed') &&
        (listKind === 'post' || listKind === 'other')
      )
        return ['feed', 'browse_and_choose'];
      switch (listKind) {
        case 'message':
          return ['inbox_or_messages', 'triage_messages'];
        case 'product':
          return [
            searched ? 'search_results' : 'listing_grid',
            'compare_and_buy',
          ];
        case 'search_result':
          return searched
            ? ['search_results', 'search']
            : ['listing_grid', 'browse_and_choose'];
        case 'post':
        case 'comment':
          return ['feed', 'browse_and_choose'];
        case 'article_card':
          return [
            searched ? 'search_results' : 'home_portal',
            'browse_and_choose',
          ];
        case 'video': {
          if (searched) return ['search_results', 'browse_and_choose'];
          const heading = sections.find((s) => s.kind === 'page_heading');
          const follow =
            heading?.node_ids.some((id) =>
              r
                .within(id)
                .some((n) => n.kind === 'control' && FOLLOW.test(label(n))),
            ) ?? false;
          return [
            follow ? 'channel_or_profile' : 'listing_grid',
            'browse_and_choose',
          ];
        }
        default:
          return [
            searched ? 'search_results' : 'listing_grid',
            'browse_and_choose',
          ];
      }
    }
    case 'article':
      if (r.signals.has('code_blocks') || r.signals.has('many_tables'))
        return ['docs_reference', 'read'];
      // A store page that reads like an article: a hero with a price and a
      // shop link in the first screen, then sections of pictures and players.
      if (storeHero(r, scope))
        return ['product_marketing', 'browse_and_choose'];
      return ['article', 'read'];
    case 'product_detail':
      return ['product_detail', 'compare_and_buy'];
    case 'feature_blocks': {
      const shop =
        scope !== null &&
        r
          .within(scope)
          .some(
            (n) =>
              (n.text?.pat?.includes('price') ?? false) ||
              (n.kind === 'control' &&
                (SHOP.test(label(n)) || BUY.test(label(n)))),
          );
      return [shop ? 'product_marketing' : 'home_portal', 'browse_and_choose'];
    }
    case 'form':
      return ['form_or_checkout', 'fill_form'];
    default:
      return ['other', 'other'];
  }
}
