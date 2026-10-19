import type {
  CardStyle,
  FieldRole,
  GridClass,
  ItemKind,
  LeadMode,
  MediaShape,
  SkeletonNode,
  SpecCollection,
  SpecField,
} from '@webable/core';
import { CARD_STYLES, MEDIA_SHAPES } from '@webable/core/compose/constants';

import { renderBlocks } from './article';
import {
  asStateControl,
  chevron,
  clean,
  disclosure,
  fillMedia,
  FV_COPY,
  h,
  isFormField,
  mediaBox,
  renderField,
  siteControl,
  stripLead,
  waButton,
  type RenderCtx,
} from './components';
import type { ProxyTarget } from './types';

/**
 * Collections (docs/10 §4.2; docs/11 R4, R7; docs/12 §6.2): records drawn
 * from the collection's card. Tiles (products, features), media cards
 * (videos, images) and story cards sit in a grid of the solver's columns;
 * rows (results, references, comments), messages, people and plain links
 * sit in one grouped list. Every record of a list is drawn from one
 * template: at most one picture at the list's one shape, the title (it
 * opens the item through the original's open slot), at most two facts, one
 * action. Everything else is one click away under the list's "Show
 * details". Ads fold into one "Sponsored (n)" line after it.
 *
 * Lists are never paged: the first `structure.listFirst` records show, then
 * "Show n more". Records are grouped visually every `layout.groupEvery`.
 * Past VIRTUAL_AT records the view virtualizes its own DOM (groups far from
 * the viewport become spacers of the height they had); at most CAP records
 * are kept, and the rest are one click away on the page.
 */

export const VIRTUAL_AT = 150;
export const CAP = 500;

/** The card each item kind is drawn with when the spec names none (docs/12 §6.2). */
const CARD_OF: Record<ItemKind, CardStyle> = {
  product: 'tile',
  feature: 'tile',
  video: 'media',
  image: 'media',
  article_card: 'story',
  post: 'story',
  event: 'story',
  search_result: 'row',
  reference: 'row',
  file: 'row',
  comment: 'row',
  other: 'row',
  message: 'message',
  person: 'person',
  tab: 'chip',
  chip: 'chip',
  filter_option: 'chip',
  nav_link: 'link',
};
const CARD_SET: ReadonlySet<string> = new Set(CARD_STYLES);
const MEDIA_SET: ReadonlySet<string> = new Set(MEDIA_SHAPES);

/** The card a list's records use: the spec's, else the item kind's. */
export function cardFor(kind: ItemKind, given?: string | null): CardStyle {
  const own = CARD_OF[kind] ?? 'row';
  if (!given || !CARD_SET.has(given)) return own;
  // A chip is never a record's template; a record kind keeps its own card.
  if (given === 'chip' && own !== 'chip') return own;
  return given as CardStyle;
}

/** A thumbnail box's shape: w/h >= 1.3 landscape, <= 0.85 portrait, else square. */
export function shapeOf(width: number, height: number): MediaShape {
  if (!(width > 0) || !(height > 0)) return 'none';
  const r = width / height;
  return r >= 1.3 ? 'landscape' : r <= 0.85 ? 'portrait' : 'square';
}

const SHAPE_RATIO: Record<Exclude<MediaShape, 'none'>, string> = {
  landscape: '16 / 9',
  square: '1 / 1',
  portrait: '3 / 4',
};

/** Columns a grid needs before its first record may lead. */
export const LEAD_MIN_COLS = 3;

/** Cards that may lead their list (the first record drawn two columns wide). */
const LEAD_CARDS: ReadonlySet<CardStyle> = new Set(['media', 'story']);

/**
 * Grid class of a card: tiles and media cards share the media columns,
 * stories (and people in a card grid) the text columns; the rest are rows.
 */
export function gridClassFor(card: CardStyle, sectionLayout = ''): GridClass {
  if (card === 'tile' || card === 'media') return 'card_media';
  if (card === 'story') return 'card_text';
  if (card === 'person')
    return sectionLayout === 'card_grid' || sectionLayout === 'grid'
      ? 'card_text'
      : 'row';
  return 'row';
}

/**
 * The narrowest a card may be drawn (docs/12 §6.2), CSS px at 100%: tiles
 * max(260, 13F), media cards max(280, 14F), stories max(300, 16F).
 */
export function cardMinWidth(card: CardStyle, F: number): number {
  if (card === 'media') return Math.max(280, 14 * F);
  if (card === 'story') return Math.max(300, 16 * F);
  return Math.max(260, 13 * F);
}

/** The gap between cards, CSS px at 100% (docs/12 §4.3): max(20, F). */
export function cardGap(F: number): number {
  return Math.max(20, F);
}

/** columns = floor((width + gap) / (minWidth + gap)), at least 1, at most maxCols. */
export function gridColumns(
  width: number,
  gap: number,
  minWidth: number,
  maxCols: number,
): number {
  if (!(width > 0) || !(minWidth > 0)) return 1;
  const n = Math.floor((width + gap) / (minWidth + gap));
  return Math.max(1, Math.min(Math.max(1, maxCols), n));
}

const ACTION_ROLES: ReadonlySet<FieldRole> = new Set([
  'primary_action',
  'secondary_action',
  'state_toggle',
  'select_toggle',
  'overflow_menu',
]);

/**
 * Fields for a list the spec says nothing about (or slots it left out),
 * inferred from the exemplar's slot kinds and text shapes.
 */
export function inferFields(slots: readonly SkeletonNode[]): {
  fields: SpecField[];
  open: string | null;
} {
  const fields: SpecField[] = [];
  const root = slots[0];
  let title: string | null = null;
  let open: string | null = null;
  let thumb = false;
  const isLink = (n: SkeletonNode): boolean =>
    n.kind === 'control' &&
    (n.role === 'link' || n.tag === 'a') &&
    n.href !== 'none';
  // A heading (or the longest link) is the title.
  for (const s of slots) {
    if (s.kind === 'heading') {
      title = s.id;
      break;
    }
  }
  if (!title) {
    let best = 0;
    for (const s of slots) {
      if (!isLink(s) || s.flags.includes('imgctrl') || s.flags.includes('icon'))
        continue;
      const len = s.text?.chars ?? s.label?.length ?? 0;
      if (len > best) {
        best = len;
        title = s.id;
      }
    }
  }
  if (title) {
    fields.push({ slot_id: title, role: 'title', show: 'always' });
    const t = slots.find((s) => s.id === title);
    if (t && isLink(t)) open = t.id;
    else {
      // A link inside the heading, else the record root when it is a link.
      const inner = slots.find(
        (s) => isLink(s) && isWithin(slots, s.id, title as string),
      );
      open = inner?.id ?? (root && isLink(root) ? root.id : null);
    }
  } else if (root && isLink(root)) {
    open = root.id;
  }
  for (const s of slots) {
    if (s.id === title || s.id === root?.id) continue;
    if (title && isWithin(slots, s.id, title)) continue;
    let role: FieldRole | null = null;
    switch (s.kind) {
      case 'media':
        role = thumb ? null : 'thumbnail';
        thumb = true;
        break;
      case 'stext': {
        const pat = s.text?.pat ?? [];
        role = pat.includes('duration')
          ? 'duration'
          : pat.includes('price')
            ? 'price'
            : pat.includes('rating')
              ? 'rating'
              : pat.includes('date')
                ? 'timestamp'
                : 'meta';
        break;
      }
      case 'text':
        role = 'description';
        break;
      case 'heading':
        role = 'description';
        break;
      case 'input':
        role =
          s.inputType === 'checkbox' ? 'select_toggle' : 'secondary_action';
        break;
      case 'control':
        if (s.flags.includes('imgctrl')) {
          if (!thumb) {
            role = 'thumbnail';
            thumb = true;
          }
        } else if (s.flags.includes('popup')) role = 'overflow_menu';
        else if (
          s.role === 'checkbox' ||
          s.role === 'switch' ||
          s.flags.includes('pressed')
        )
          role = 'state_toggle';
        else if (isLink(s)) role = 'link';
        else role = 'secondary_action';
        break;
      case 'collection':
      case 'table':
        role = 'meta';
        break;
      default:
        role = null;
    }
    if (role)
      fields.push({
        slot_id: s.id,
        role,
        show: 'always',
      });
  }
  return { fields, open };
}

function isWithin(
  slots: readonly SkeletonNode[],
  id: string,
  ancestor: string,
): boolean {
  const byId = new Map(slots.map((s) => [s.id, s]));
  for (let p = byId.get(id)?.parent ?? null; p; p = byId.get(p)?.parent ?? null)
    if (p === ancestor) return true;
  return false;
}

/**
 * The shape a list's media is drawn at: the spec's, else the exemplar's
 * thumbnail box, else the item kind's (a video is 16:9); no thumbnail is no
 * media slot.
 */
function mediaShapeFor(
  ctx: RenderCtx,
  kind: ItemKind,
  fields: readonly SpecField[],
  given?: string | null,
): MediaShape {
  if (given && MEDIA_SET.has(given)) return given as MediaShape;
  const thumb = fields.find((f) => f.role === 'thumbnail' && f.show !== 'hide');
  if (!thumb) return 'none';
  const box = ctx.index.nodes.get(thumb.slot_id)?.box;
  const shape = box ? shapeOf(box[2], box[3]) : 'none';
  if (shape !== 'none') return shape;
  return kind === 'video' ? 'landscape' : 'square';
}

/** `first` only for media and story cards (the validator enforces the page types). */
function leadFor(card: CardStyle, given?: string | null): LeadMode {
  return given === 'first' && LEAD_CARDS.has(card) ? 'first' : 'none';
}

/**
 * The spec's collection, completed so no control slot is lost, with its
 * card, media shape and lead (per item kind when the spec predates them).
 */
export function effectiveCollection(
  ctx: RenderCtx,
  listId: string,
  kindHint: ItemKind | null,
): SpecCollection {
  const slots = ctx.index.slots.get(listId) ?? [];
  const inferred = inferFields(slots);
  const given = ctx.collections.get(listId) as
    | (Omit<SpecCollection, 'card' | 'media' | 'lead'> &
        Partial<Pick<SpecCollection, 'card' | 'media' | 'lead'>>)
    | undefined;
  if (!given) {
    const kind = kindHint ?? 'other';
    const card = cardFor(kind);
    return {
      list_id: listId,
      item_kind: kind,
      open_slot: inferred.open,
      card,
      media: mediaShapeFor(ctx, kind, inferred.fields),
      lead: 'none',
      fields: inferred.fields,
    };
  }
  const known = new Set(slots.map((s) => s.id));
  const fields: SpecField[] = given.fields
    .filter((f) => known.has(f.slot_id))
    .map((f) => {
      // Controls stay reachable even when the spec hides them.
      const node = ctx.index.nodes.get(f.slot_id);
      if (
        f.show === 'hide' &&
        (node?.kind === 'control' || node?.kind === 'input')
      )
        return { ...f, show: 'on_expand' as const };
      return f;
    });
  const mentioned = new Set(fields.map((f) => f.slot_id));
  const covered = (id: string): boolean => {
    for (const m of mentioned)
      if (m === id || isWithin(slots, id, m)) return true;
    return false;
  };
  for (const f of inferred.fields) {
    if (covered(f.slot_id)) continue;
    const node = ctx.index.nodes.get(f.slot_id);
    if (!node) continue;
    // Content the spec left out is one click away, never dropped.
    fields.push({
      ...f,
      show:
        f.role === 'title' && !fields.some((x) => x.role === 'title')
          ? 'always'
          : 'on_expand',
    });
  }
  const open =
    given.open_slot && known.has(given.open_slot)
      ? given.open_slot
      : inferred.open;
  const card = cardFor(given.item_kind, given.card);
  return {
    ...given,
    open_slot: open,
    card,
    media: mediaShapeFor(ctx, given.item_kind, fields, given.media),
    lead: leadFor(card, given.lead),
    fields,
  };
}

// ---------------------------------------------------------------------------
// One template per list (docs/11 R7)
// ---------------------------------------------------------------------------

/**
 * The fields every record of a list shows, in the same order and at the same
 * sizes: at most one image, the title, at most two facts, one action, and
 * the record's state controls (a select box, a star). Everything else is one
 * click away under the list's "Show details".
 */
export interface RecordTemplate {
  thumb: SpecField | null;
  title: SpecField | null;
  /** A tile's badge ("New") or a story's badge or date, drawn above the title. */
  eyebrow: SpecField | null;
  /** A media card's overflow menu: one round button beside the title. */
  menu: SpecField | null;
  /** At most 2, in the order they are drawn (short facts, then a snippet). */
  facts: SpecField[];
  /** The rating's count, drawn with it as one fact: "4.4 ★ (2.4K)". */
  count: SpecField | null;
  duration: SpecField | null;
  select: SpecField | null;
  toggle: SpecField | null;
  action: SpecField | null;
  more: SpecField[];
  /** One aspect ratio for every image in the list ("16 / 9"). */
  ratio: string;
}

/** Cards drawn as rows of a grouped list carry a square picture on the leading side. */
const SQUARE_CARDS: ReadonlySet<CardStyle> = new Set([
  'row',
  'message',
  'person',
  'link',
]);

/** Facts worth the record's two places, best first, by what the item is. */
const FACT_ORDER: Partial<Record<ItemKind, FieldRole[]>> = {
  product: ['price', 'rating', 'review_count', 'badge', 'meta'],
  video: ['author_or_channel', 'meta', 'timestamp'],
  message: ['author_or_channel', 'timestamp', 'meta'],
  post: ['author_or_channel', 'description', 'timestamp'],
  comment: ['author_or_channel', 'description', 'timestamp'],
  search_result: ['description', 'author_or_channel', 'meta', 'timestamp'],
  reference: ['description', 'meta'],
  article_card: ['timestamp', 'description', 'author_or_channel'],
  event: ['timestamp', 'meta', 'description'],
};
const FACT_DEFAULT: FieldRole[] = [
  'author_or_channel',
  'price',
  'rating',
  'meta',
  'timestamp',
  'description',
  'label',
  'review_count',
  'badge',
  'other',
];
const NOT_FACT: ReadonlySet<FieldRole> = new Set([
  'thumbnail',
  'title',
  'duration',
  'select_toggle',
  'state_toggle',
  'primary_action',
  'secondary_action',
  'overflow_menu',
  'decorative',
  'link',
]);

export const MAX_FACTS = 2;

const RATIO_DEFAULT: Partial<Record<ItemKind, number>> = {
  video: 16 / 9,
  product: 1,
  image: 1,
};

export function recordTemplate(
  ctx: RenderCtx,
  spec: SpecCollection,
  ratio: number | null,
): RecordTemplate {
  const used = new Set<SpecField>();
  const first = (pred: (f: SpecField) => boolean): SpecField | null => {
    const f = spec.fields.find(
      (x) => x.show !== 'hide' && !used.has(x) && pred(x),
    );
    if (f) used.add(f);
    return f ?? null;
  };
  const node = (f: SpecField) => ctx.index.nodes.get(f.slot_id);
  const calm = (ctx.layout.structure?.level ?? 0) === 2;
  // Specs written before cards and shapes: the item kind's card, the
  // measured ratio.
  const card = cardFor(spec.item_kind, (spec as Partial<SpecCollection>).card);
  const given = (spec as Partial<SpecCollection>).media;
  const shape = given && MEDIA_SET.has(given) ? given : null;
  // `none`: the list has no media slot; its pictures wait with the details.
  const thumb = shape === 'none' ? null : first((f) => f.role === 'thumbnail');
  const title = first((f) => f.role === 'title');
  // The length sits on the picture; for a person who needs calm the picture
  // carries no text, and the length waits with the other details.
  const duration = thumb && !calm ? first((f) => f.role === 'duration') : null;
  // A tile's badge, or a story's badge or date, reads above its title.
  const shown = (f: SpecField): boolean => f.show === 'always';
  const eyebrow =
    card === 'tile' || card === 'story'
      ? (first((f) => f.role === 'badge' && shown(f)) ??
        (card === 'story'
          ? first((f) => f.role === 'timestamp' && shown(f))
          : null))
      : null;
  // A media card's menu (⋯) sits beside its title when the page shows it at
  // all times; one the page shows only on hover, and every menu for a person
  // who needs calm, waits with the details.
  // A secondary action that only opens a menu (an icon with the popup flag)
  // is a menu too, whatever the spec called it.
  const menuish = (f: SpecField): boolean =>
    f.role === 'overflow_menu' ||
    (f.role === 'secondary_action' &&
      !!node(f)?.flags.includes('popup') &&
      !!node(f)?.flags.includes('icon'));
  const menu =
    (card === 'media' || card === 'row' || card === 'message') && !calm
      ? first(
          (f) =>
            menuish(f) && shown(f) && !node(f)?.flags.includes('hoveronly'),
        )
      : null;
  const select = first((f) => f.role === 'select_toggle');
  const toggle = first((f) => f.role === 'state_toggle');
  // The one action: the record's primary action; at level 0-1 a plain
  // secondary one (Share) may take its place, never for a person who needs
  // calm.
  const action =
    first((f) => f.role === 'primary_action') ??
    (calm
      ? null
      : first(
          (f) =>
            f.role === 'secondary_action' &&
            f.show === 'always' &&
            !menuish(f) &&
            !node(f)?.flags.includes('hoveronly') &&
            node(f)?.kind !== 'input',
        ));
  const order = FACT_ORDER[spec.item_kind] ?? FACT_DEFAULT;
  const rank = (r: FieldRole): number => {
    const i = order.indexOf(r);
    return i >= 0 ? i : order.length + FACT_DEFAULT.indexOf(r) + 1;
  };
  const facts = spec.fields
    .filter((f) => f.show === 'always' && !used.has(f) && !NOT_FACT.has(f.role))
    .sort((a, b) => rank(a.role) - rank(b.role))
    .slice(0, MAX_FACTS);
  for (const f of facts) used.add(f);
  const count = facts.some((f) => f.role === 'rating')
    ? first((f) => f.role === 'review_count' && f.show === 'always')
    : null;
  // Short facts on one line first, then a snippet. A product leads with its
  // price, then its rating; other records keep the page's order.
  const pos = ctx.index.order;
  const ranked = spec.item_kind === 'product';
  facts.sort(
    (a, b) =>
      Number(a.role === 'description') - Number(b.role === 'description') ||
      (ranked
        ? rank(a.role) - rank(b.role)
        : (pos.get(a.slot_id) ?? 0) - (pos.get(b.slot_id) ?? 0)),
  );
  const more = spec.fields.filter((f) => f.show !== 'hide' && !used.has(f));
  const r = Math.min(
    16 / 9,
    Math.max(3 / 4, ratio ?? RATIO_DEFAULT[spec.item_kind] ?? 16 / 9),
  );
  // Rows carry a square picture; cards the list's shape, else the measured
  // ratio.
  const ar = SQUARE_CARDS.has(card)
    ? '1 / 1'
    : shape && shape !== 'none'
      ? SHAPE_RATIO[shape]
      : Math.abs(r - 16 / 9) < 0.02
        ? '16 / 9'
        : Math.abs(r - 1) < 0.02
          ? '1 / 1'
          : `${Math.round(r * 100)} / 100`;
  return {
    thumb,
    title,
    eyebrow,
    menu,
    facts,
    count,
    duration,
    select,
    toggle,
    action,
    more,
    ratio: ar,
  };
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

interface GroupView {
  keys: string[];
  el: HTMLElement;
  live: boolean;
  height: number;
}

export interface ListView {
  listId: string;
  spec: SpecCollection;
  /** The records' card (docs/12 §6.2). */
  card: CardStyle;
  /** 'row' for a grouped list; a card class for a grid. */
  grid: GridClass;
  root: HTMLElement;
  /**
   * Keys the view holds for the person: rendered with something to read or
   * open, or one labelled click away ("Show n more", "Sponsored (n)").
   * Conservation counts records by key across the session.
   */
  seen: Set<string>;
  /** Rendered keys that showed nothing (no title, no text): not covered. */
  empty: Set<string>;
  order: string[];
  members: Map<string, Element>;
  fps: Map<string, string>;
  groups: GroupView[];
  /** Members beyond the cap (one click away on the page). */
  overflow: number;
  /** Records shown so far (the rest wait behind "Show n more"). */
  revealed: number;
  /** Ad records, folded into one "Sponsored (n)" line. */
  ads: string[];
  /** Re-read every member and render again. */
  rebuild(): void;
  /** Records per visual group (whole grid rows for cards). */
  groupSize(): number;
  /** Fill thumbnails whose image has loaded since. */
  refreshMedia(): void;
  dispose(): void;
}

interface RecordCtx {
  ctx: RenderCtx;
  lv: ListView;
  tpl: RecordTemplate;
  /** The record that leads the list (two columns wide, its media 16:9), if any. */
  leadKey: string | null;
  /** Pictures shown whole in a soft well (products, features, images). */
  contain: boolean;
}

function uniqueKeys(
  ctx: RenderCtx,
  listId: string,
  members: Element[],
): string[] {
  const seen = new Map<string, number>();
  return members.map((m) => {
    const k = ctx.registry.recordKey(listId, m) || 'r';
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n === 0 ? k : `${k}#${n + 1}`;
  });
}

function slotEl(
  ctx: RenderCtx,
  listId: string,
  member: Element,
  slotId: string,
): Element | null {
  const slots = ctx.index.slots.get(listId);
  if (slots?.[0]?.id === slotId) return member;
  return ctx.registry.slot(listId, member, slotId);
}

/** Visible text of a field, or (for icons and star ratings) its accessible name. */
function fieldText(ctx: RenderCtx, el: Element, role: FieldRole): string {
  const t = stripLead(clean(ctx.registry.text(el)));
  if (t) return t;
  if (role === 'rating' || role === 'badge' || role === 'review_count')
    return stripLead(clean(ctx.registry.name(el)));
  return '';
}

function recordTarget(
  lv: ListView,
  key: string,
  slotId: string,
): ProxyTarget['record'] {
  return {
    listId: lv.listId,
    key,
    fingerprint: lv.fps.get(key) ?? '',
    slotId,
  };
}

function isControlNode(n: SkeletonNode | undefined, el: Element): boolean {
  if (n?.kind === 'control' || n?.kind === 'input') return true;
  return (
    el.localName === 'a' ||
    el.localName === 'button' ||
    isFormField(el) ||
    el.getAttribute('role') === 'button'
  );
}

/** The media element behind a thumbnail slot. */
function mediaOf(ctx: RenderCtx, slotId: string, el: Element): Element {
  return ctx.index.nodes.get(slotId)?.kind === 'media'
    ? el
    : (el.querySelector('img, picture, video') ?? el);
}

/** The dot between facts, as text (it reads in copies and to every reader), not drawn. */
function separator(doc: Document): HTMLElement {
  const s = h(doc, 'span', 'fv-sep', ' · ');
  s.setAttribute('aria-hidden', 'true');
  return s;
}

/** Prices in a text: a currency sign or code with a number, either order. */
const PRICE_G =
  /(?:\b[A-Z]{2,3}\$?\s?|[$€£¥₹₩₽₺₪₫฿]\s?)\d[\d.,]*\d|\d[\d.,]*\s?(?:[$€£¥₹₩₽₺₪₫฿]|\b(?:USD|CAD|AUD|EUR|GBP|JPY|INR|CHF)\b)/gu;

/**
 * The price a text leads with, when it holds several ("CAD 18.41 (CAD
 * 3.68/count) Typical: CAD 19.83" reads "CAD 18.41"); the text itself
 * otherwise. The words are the page's, only the first price of them.
 */
export function leadPrice(t: string): string {
  const all = t.match(PRICE_G);
  if (!all || all.length < 2) return t;
  const first = all[0] as string;
  return t.trimStart().startsWith(first) ? first : t;
}

/** A star rating's number with a star: "4.4 out of 5 stars, rating details" reads "4.4 ★". */
export function ratingText(t: string): string {
  const m =
    /(\d(?:[.,]\d)?)\s*(?:out of\s*(?:5|10)|\/\s?(?:5|10)|stars?|★)/i.exec(t);
  return m?.[1] ? `${m[1]} ★` : t;
}

/** A rating count as its number: "(2.4K)", "1,460 ratings" read "2.4K", "1,460". */
export function countText(t: string): string {
  const s = t.trim();
  const bare = /^\(?\s*([\d.,]+\s?[KMBkmb]?\+?)\s*\)?$/.exec(s);
  if (bare?.[1]) return bare[1].trim();
  const worded =
    /([\d.,]+\s?[KMBkmb]?\+?)\s*(?:global\s+)?(?:ratings?|reviews?)\b/i.exec(s);
  return worded?.[1]?.trim() ?? s;
}

/** One fact as drawn: its role and its nodes (text, a price, a control). */
interface Piece {
  role: FieldRole;
  nodes: Node[];
}

/**
 * One record as an <li>, drawn from the list's template in its card
 * (docs/12 §6.2): a tile (media in a well, badge, title, price and facts,
 * the action as blue text at the bottom), a media card (cover media, title
 * with its menu, channel and meta), a story (media on top, eyebrow, title,
 * description, meta), a row (an optional square picture, a blue title, facts
 * and snippet), a message (sender and time, subject, snippet), a person (an
 * avatar beside the name) or a plain link.
 */
function renderRecord(
  rc: RecordCtx,
  key: string,
  member: Element,
): HTMLLIElement {
  const { ctx, lv, tpl } = rc;
  const doc = ctx.doc;
  const card = lv.card;
  const boxed = lv.grid !== 'row';
  const li = h(
    doc,
    'li',
    boxed
      ? `fv-rec fv-card fv-card--${card}`
      : `fv-rec fv-row fv-row--${card === 'row' ? 'result' : card}`,
  );
  li.dataset.key = key;
  li.dataset.card = card;
  const lead = rc.leadKey === key;
  if (lead) li.classList.add('is-lead');
  const openId = lv.spec.open_slot;
  const openEl = openId ? slotEl(ctx, lv.listId, member, openId) : null;
  const titleId = ctx.uid('t');
  const body = h(doc, 'div', 'fv-rec__body');
  const side = h(doc, 'div', 'fv-rec__side');
  const more: HTMLElement[] = [];
  const moreActions: HTMLElement[] = [];
  let title = '';
  let shows = false;

  const el = (f: SpecField | null): Element | null =>
    f ? slotEl(ctx, lv.listId, member, f.slot_id) : null;
  const control = (
    f: SpecField,
    target: Element,
    variant: 'btn' | 'inline' | 'link' | 'icon',
  ): HTMLElement | null => {
    const node = ctx.index.nodes.get(f.slot_id);
    const record = recordTarget(lv, key, f.slot_id);
    if (
      f.role === 'select_toggle' ||
      (node?.kind === 'input' && isFormField(target))
    ) {
      return renderField(ctx, f.slot_id, target, {
        record,
        fallbackName: title,
      });
    }
    return siteControl(ctx, f.slot_id, target, {
      variant,
      record,
      fill: f.role === 'primary_action',
    });
  };

  // Title (the record's opener). A message's subject reads at body size
  // under its sender; a plain link is a whole row with a chevron.
  const titleSrc = el(tpl.title);
  if (titleSrc) title = fieldText(ctx, titleSrc, 'title');
  if (!title && titleSrc) title = clean(ctx.registry.name(titleSrc));
  if (!title && openEl) title = clean(ctx.registry.name(openEl));
  let titleEl: HTMLElement | null = null;
  if (title) {
    titleEl = h(
      doc,
      'h3',
      card === 'message' ? 'fv-rec-title t-body' : 'fv-rec-title t-title',
    );
    titleEl.id = titleId;
    const opener = openEl
      ? siteControl(ctx, openId as string, openEl, {
          variant: 'title',
          label: title,
          record: recordTarget(lv, key, openId as string),
        })
      : null;
    if (opener) {
      if (card === 'link') opener.append(chevron(doc));
      titleEl.append(opener);
    } else titleEl.textContent = title;
    if (tpl.title) ctx.emit(tpl.title.slot_id);
    // Unread: a message whose title the site sets in bold.
    const boldSrc = titleSrc ?? openEl;
    const n = ctx.index.nodes.get(tpl.title?.slot_id ?? openId ?? '');
    if (
      lv.spec.item_kind === 'message' &&
      boldSrc &&
      n?.flags.includes('bold')
    ) {
      const w = Number(
        (ctx.doc.defaultView ?? window).getComputedStyle(boldSrc).fontWeight,
      );
      if (w >= 600) li.classList.add('is-unread');
    }
    shows = true;
  }

  // The eyebrow over a tile's or a story's title: its badge, or its date.
  // A control behind it waits under "Show details", like a price link.
  let eyebrowEl: HTMLElement | null = null;
  const eyeSrc = el(tpl.eyebrow);
  if (eyeSrc && tpl.eyebrow) {
    const f = tpl.eyebrow;
    const isCtl = isControlNode(ctx.index.nodes.get(f.slot_id), eyeSrc);
    let t = fieldText(ctx, eyeSrc, f.role);
    if (!t && isCtl) t = clean(ctx.registry.name(eyeSrc));
    if (isCtl) {
      const c = control(f, eyeSrc, 'inline');
      if (c) more.push(c);
    } else if (t) ctx.emit(f.slot_id);
    if (t) {
      eyebrowEl = h(
        doc,
        'p',
        f.role === 'badge' ? 'fv-eyebrow fv-badge t-body' : 'fv-eyebrow t-meta',
        t,
      );
      shows = true;
    }
  }

  // Facts: at most two, short ones on one line, a snippet below. For a
  // person who needs calm (structure level 2) a fact that is a link (the
  // channel) reads as text; the link itself waits under "Show details".
  const quiet = (ctx.layout.structure?.level ?? 0) === 2;
  const pieces: Piece[] = [];
  const snippets: HTMLElement[] = [];
  for (const f of tpl.facts) {
    const src = el(f);
    if (!src) continue;
    const node = ctx.index.nodes.get(f.slot_id);
    const isCtl = isControlNode(node, src);
    if (f.role === 'price' || f.role === 'rating' || f.role === 'description') {
      // Read as text: the current price, "4.4 ★ (2.4K)", a snippet. A
      // control behind it (a price link, the stars' pop-up, an expandable
      // summary) waits under "Show details", never as a pill in the line.
      let t = fieldText(ctx, src, f.role);
      if (!t && isCtl) t = clean(ctx.registry.name(src));
      if (f.role === 'price') t = leadPrice(t);
      let spoken = t;
      if (f.role === 'rating') {
        const cSrc = el(tpl.count);
        const ct =
          cSrc && tpl.count
            ? countText(fieldText(ctx, cSrc, 'review_count'))
            : '';
        spoken = [t, cSrc ? clean(ctx.registry.name(cSrc)) : '']
          .filter(Boolean)
          .join(', ');
        t = ratingText(t) + (ct ? ` (${ct})` : '');
        if (cSrc && tpl.count) {
          const cc = isControlNode(ctx.index.nodes.get(tpl.count.slot_id), cSrc)
            ? control(tpl.count, cSrc, 'inline')
            : null;
          if (cc) more.push(cc);
          else ctx.emit(tpl.count.slot_id);
        }
      }
      if (!t) continue;
      if (isCtl) {
        const c = control(f, src, 'inline');
        if (c) more.push(c);
      } else ctx.emit(f.slot_id);
      shows = true;
      if (f.role === 'description') {
        snippets.push(h(doc, 'p', 'fv-desc t-body', t));
        continue;
      }
      if (f.role === 'price') {
        pieces.push({ role: f.role, nodes: [h(doc, 'span', 'fv-price', t)] });
        continue;
      }
      const shown = h(doc, 'span', null, t);
      shown.setAttribute('aria-hidden', 'true');
      pieces.push({
        role: f.role,
        nodes: [shown, h(doc, 'span', 'fv-sr', spoken)],
      });
      continue;
    }
    if (isCtl) {
      const c = control(f, src, 'inline');
      if (!c) continue;
      shows = true;
      if (quiet) {
        pieces.push({
          role: f.role,
          nodes: [doc.createTextNode(clean(c.textContent))],
        });
        more.push(c);
      } else pieces.push({ role: f.role, nodes: [c] });
      continue;
    }
    const t = fieldText(ctx, src, f.role);
    if (!t) continue;
    ctx.emit(f.slot_id);
    shows = true;
    pieces.push({ role: f.role, nodes: [doc.createTextNode(t)] });
  }
  // A message's sender leads it and its time trails it; the other facts
  // share one line, a dot between them.
  const take = (role: FieldRole): Piece | null => {
    if (card !== 'message') return null;
    const i = pieces.findIndex((p) => p.role === role);
    return i >= 0 ? (pieces.splice(i, 1)[0] ?? null) : null;
  };
  const from = take('author_or_channel');
  const time = take('timestamp');
  const line = h(doc, 'p', 'fv-facts t-meta');
  for (const p of pieces) {
    const s = h(doc, 'span', 'fv-fact');
    if (line.childNodes.length) s.append(separator(doc));
    s.append(...p.nodes);
    line.append(s);
  }
  let top: HTMLElement | null = null;
  if (card === 'message') {
    // The unread dot holds its place on every row, shown only when unread.
    top = h(doc, 'div', 'fv-msg__top');
    const dot = h(doc, 'span', 'fv-dot');
    dot.setAttribute('aria-hidden', 'true');
    top.append(dot);
    if (from) {
      const p = h(doc, 'p', 'fv-msg__from t-title');
      p.append(...from.nodes);
      top.append(p);
    }
    if (time) {
      const p = h(doc, 'p', 'fv-msg__time t-meta');
      p.append(...time.nodes);
      top.append(p);
    }
  }

  // Everything else: one click away under the list's "Show details".
  for (const f of tpl.more) {
    const src = el(f);
    if (!src) continue;
    const node = ctx.index.nodes.get(f.slot_id);
    if (
      ACTION_ROLES.has(f.role) ||
      ((f.role === 'link' || f.role === 'author_or_channel') &&
        isControlNode(node, src))
    ) {
      // An overflow menu is a round icon button wherever it is drawn.
      const c = control(
        f,
        src,
        f.role === 'link' || f.role === 'author_or_channel'
          ? 'inline'
          : f.role === 'overflow_menu' ||
              (f.role === 'secondary_action' &&
                !!node?.flags.includes('popup') &&
                !!node?.flags.includes('icon'))
            ? 'icon'
            : 'btn',
      );
      if (!c) continue;
      if (f.role === 'state_toggle')
        asStateControl(c, clean(ctx.registry.name(src)));
      if (ACTION_ROLES.has(f.role)) moreActions.push(c);
      else more.push(c);
      continue;
    }
    if (f.role === 'thumbnail' || f.role === 'decorative') {
      ctx.emit(f.slot_id);
      continue;
    }
    const t = fieldText(ctx, src, f.role);
    if (!t) continue;
    ctx.emit(f.slot_id);
    more.push(
      h(
        doc,
        f.role === 'description' ? 'p' : 'span',
        f.role === 'description' ? 'fv-desc t-body' : null,
        t,
      ),
    );
  }

  // The picture, at the list's one shape (16:9 when it leads); it opens the
  // item too. Rows carry a square one, people a round avatar.
  let thumbBox: HTMLElement | null = null;
  const thumbSrc = el(tpl.thumb);
  if (thumbSrc && tpl.thumb) {
    thumbBox = mediaBox(
      ctx,
      mediaOf(ctx, tpl.thumb.slot_id, thumbSrc),
      [
        'fv-thumb',
        card === 'person' ? 'fv-avatar' : boxed ? null : 'fv-row__thumb',
        rc.contain ? 'fv-thumb--contain' : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
    const ar = lead ? '16 / 9' : tpl.ratio;
    thumbBox.dataset.slot = tpl.thumb.slot_id;
    thumbBox.dataset.ar = ar;
    thumbBox.style.setProperty('--fv-ar', ar);
    ctx.emit(tpl.thumb.slot_id);
    const dur = el(tpl.duration);
    const d = dur && tpl.duration ? fieldText(ctx, dur, 'duration') : '';
    if (d && tpl.duration) {
      thumbBox.append(h(doc, 'span', 'fv-badge t-meta', d));
      ctx.emit(tpl.duration.slot_id);
    }
  }

  // A card's or row's menu: one round button beside the title.
  const menuSrc = el(tpl.menu);
  const menuEl =
    menuSrc && tpl.menu ? control(tpl.menu, menuSrc, 'icon') : null;

  // State: a select box leads, a star sits beside the action. For a person
  // who needs calm (level 2) they wait under "Show details" with the rest:
  // the row is its title, its facts and one action (R7).
  const selSrc = el(tpl.select);
  const sel = selSrc && tpl.select ? control(tpl.select, selSrc, 'btn') : null;
  if (sel) {
    sel.classList.add('fv-rec__select');
    // The box keeps its name for assistive technology; the row stays quiet.
    sel.querySelector(':scope > span')?.classList.add('fv-sr');
  }
  const togSrc = el(tpl.toggle);
  const tog = togSrc && tpl.toggle ? control(tpl.toggle, togSrc, 'btn') : null;
  if (tog && togSrc) asStateControl(tog, clean(ctx.registry.name(togSrc)));
  if (quiet) {
    if (sel) moreActions.unshift(sel);
    if (tog) moreActions.push(tog);
  }
  const rowSel = quiet ? null : sel;
  const rowTog = quiet ? null : tog;
  const actSrc = el(tpl.action);
  // A tile's action is blue text with a chevron, lined up at the bottom of
  // the row; other records keep the pill.
  const act =
    actSrc && tpl.action
      ? control(tpl.action, actSrc, card === 'tile' ? 'link' : 'btn')
      : null;
  if (menuEl && !titleEl) side.append(menuEl);
  if (rowTog) side.append(rowTog);
  if (act) side.append(act);

  // A picture is something to see (a gallery of images has no words).
  if (thumbBox) shows = true;
  let fallback: HTMLElement | null = null;
  if (!shows) {
    // The template found nothing to show for this record: the record's own
    // content, read as text with its links, so it is never an empty card.
    const holder = h(doc, 'div', 'fv-rec__fallback fv-stack');
    renderBlocks(ctx, member, holder);
    if (clean(holder.textContent)) {
      fallback = holder;
      shows = true;
    }
  }
  if (!shows) lv.empty.add(key);
  else lv.empty.delete(key);

  let details: HTMLElement | null = null;
  if (more.length || moreActions.length) {
    details = h(doc, 'div', 'fv-rec__more fv-stack');
    if (more.length) {
      // Each detail reads apart from the next ("33K · NNgroup"), in text too.
      const m = h(doc, 'div', 'fv-meta t-meta');
      more.forEach((x, i) => {
        if (i === 0) {
          m.append(x);
          return;
        }
        const item = h(doc, 'span', 'fv-meta__item');
        item.append(separator(doc), x);
        m.append(item);
      });
      details.append(m);
    }
    if (moreActions.length) {
      const a = h(doc, 'div', 'fv-actions');
      for (const x of moreActions) a.append(x);
      details.append(a);
    }
    li.classList.add('has-more');
  }

  // The body, in the card's order; every record of the list the same.
  let head: HTMLElement | null = titleEl;
  if (titleEl && menuEl) {
    head = h(doc, 'div', 'fv-rec__head');
    head.append(titleEl, menuEl);
  }
  const facts = line.childNodes.length ? line : null;
  const parts: Array<HTMLElement | null> =
    card === 'message'
      ? [top, head, ...snippets, facts]
      : card === 'story'
        ? [eyebrowEl, head, ...snippets, facts]
        : [eyebrowEl, head, facts, ...snippets];
  for (const p of parts) if (p) body.append(p);
  if (fallback) body.append(fallback);
  if (details) body.append(details);

  if (rowSel) li.append(rowSel);
  if (thumbBox) {
    if (openEl && openId) {
      // The image opens the item too, for pointer users; it is not a second
      // tab stop or a second announcement of the same link.
      const opener = siteControl(ctx, openId, openEl, {
        variant: 'title',
        label: title || clean(ctx.registry.name(openEl)),
        record: recordTarget(lv, key, openId),
      });
      if (opener) {
        opener.className = 'fv-thumb-open';
        opener.tabIndex = -1;
        opener.setAttribute('aria-hidden', 'true');
        opener.textContent = '';
        opener.append(thumbBox);
        thumbBox.classList.add('fv-thumb--open');
        li.append(opener);
      } else li.append(thumbBox);
    } else li.append(thumbBox);
  }
  if (titleEl) li.setAttribute('aria-labelledby', titleId);
  li.append(body);
  if (side.childNodes.length) li.append(side);
  return li;
}

// ---------------------------------------------------------------------------

function estimateGroupHeight(
  ctx: RenderCtx,
  card: CardStyle,
  grid: GridClass,
  n: number,
  cols: number,
): number {
  const l = ctx.layout;
  const F = l.type.body.px;
  const rowH =
    grid === 'row'
      ? Math.max(l.target.controlPx, F * l.type.lineHeight * 2.4) +
        Math.max(28, 1.6 * F)
      : cardMinWidth(card, F) * (card === 'story' ? 0.3 : 0.6) +
        F * l.type.lineHeight * 4 +
        Math.max(20, 1.25 * F) * 2;
  const rows = grid === 'row' ? n : Math.ceil(n / Math.max(1, cols));
  return (rows * rowH) / ctx.zoom;
}

/** An ad record: the reader's own rule, or an ad-marked part of the record. */
function adTest(ctx: RenderCtx, listId: string): (member: Element) => boolean {
  const slots = ctx.index.slots.get(listId) ?? [];
  const marked = slots.filter((s, i) => i > 0 && s.flags.includes('adhint'));
  return (member) => {
    const own = ctx.registry.isAd?.(listId, member);
    if (own !== undefined) return own;
    return marked.some((s) => ctx.registry.slot(listId, member, s.id) !== null);
  };
}

/** The list's image aspect ratio, from the first record whose image has a size. */
function listRatio(
  ctx: RenderCtx,
  listId: string,
  spec: SpecCollection,
  members: Element[],
): number | null {
  const thumb = spec.fields.find((f) => f.role === 'thumbnail');
  if (!thumb) return null;
  for (const m of members.slice(0, 6)) {
    const s = slotEl(ctx, listId, m, thumb.slot_id);
    if (!s) continue;
    const info = ctx.registry.media(mediaOf(ctx, thumb.slot_id, s));
    if (info.width > 8 && info.height > 8) return info.width / info.height;
  }
  return null;
}

/** Each rendered list's own record renderer (its current template). */
const renderers = new WeakMap<
  ListView,
  (key: string) => HTMLLIElement | null
>();

/**
 * Render one collection as records. `scroller` is the view's scroll container
 * (virtualization root).
 */
export function renderCollection(
  ctx: RenderCtx,
  listId: string,
  opts: {
    kindHint: ItemKind | null;
    sectionLayout: string;
    scroller: HTMLElement | null;
  },
): ListView {
  const spec = effectiveCollection(ctx, listId, opts.kindHint);
  const card = spec.card;
  const grid = gridClassFor(card, opts.sectionLayout);
  const root = h(ctx.doc, 'div', 'fv-records');
  root.dataset.list = listId;
  root.dataset.card = card;
  const lv: ListView = {
    listId,
    spec,
    card,
    grid,
    root,
    seen: new Set(),
    empty: new Set(),
    order: [],
    members: new Map(),
    fps: new Map(),
    groups: [],
    overflow: 0,
    revealed: 0,
    ads: [],
    rebuild: () => undefined,
    groupSize: () => 1,
    refreshMedia: () => undefined,
    dispose: () => undefined,
  };
  const structure = ctx.layout.structure;
  const listFirst =
    structure?.listFirst && structure.listFirst > 0
      ? structure.listFirst
      : null;
  let cols = 1;
  const F = ctx.layout.type.body.px;
  const minWidth = (): number => cardMinWidth(card, F) / ctx.zoom;
  const maxCols = (): number => ctx.layout.grid[grid].maxCols;
  const gap = (): number => cardGap(F) / ctx.zoom;
  // A first guess from the window, corrected before first paint by the observer.
  const view = ctx.doc.defaultView;
  const guess = Math.min(
    (view?.innerWidth ?? 1280) - (2 * ctx.layout.space.pagePadPx) / ctx.zoom,
    ctx.layout.space.maxContentPx / ctx.zoom,
  );
  // Cards stay cards at every width: fewer columns, then one column of the
  // same cards, never rows of stamps (docs/12 §6.2).
  if (grid !== 'row') cols = gridColumns(guess, gap(), minWidth(), maxCols());
  // More room between records for a person who needs calm (Tune's density
  // effect): fewer of them compete in one screen.
  root.classList.toggle(
    'fv-records--airy',
    (ctx.layout.structure?.level ?? 0) === 2,
  );
  // Products, features and pictures are shown whole; video frames and story
  // pictures fill their box.
  const contain =
    card === 'tile' ||
    spec.item_kind === 'product' ||
    spec.item_kind === 'image';
  root.classList.toggle('fv-records--contain', contain);
  let tpl = recordTemplate(ctx, spec, null);
  const rc: RecordCtx = { ctx, lv, tpl, leadKey: null, contain };
  let organic: string[] = [];
  // The first record leads, two columns wide, when the spec says so and a
  // column stays beside it (two of two would be one picture across the
  // screen).
  const leads = (): boolean =>
    spec.lead === 'first' && grid !== 'row' && cols >= LEAD_MIN_COLS;
  const setLead = (): void => {
    rc.leadKey = leads() ? (organic[0] ?? null) : null;
    root.classList.toggle('has-lead', rc.leadKey !== null);
  };
  // Groups of `groupEvery` records; in a grid, whole rows of cards, so a
  // group never ends mid-row.
  const groupSize = (): number => {
    const every = Math.max(1, Math.round(ctx.layout.groupEvery) || 6);
    if (grid === 'row') return every;
    // Whole rows of cards, never more than `every` records in a group.
    return Math.max(1, Math.floor(every / cols)) * cols;
  };
  /** Records group `i` holds: the lead takes two places in the first one. */
  const capacity = (i: number): number => {
    const every = groupSize();
    return i === 0 && leads() ? Math.max(1, every - 1) : every;
  };
  let virtual = false;
  let io: IntersectionObserver | null = null;
  let farIo: IntersectionObserver | null = null;
  let ro: ResizeObserver | null = null;
  const moreBox = h(ctx.doc, 'div', 'fv-listmore');
  let details = false;

  const setColumns = (width: number): void => {
    if (grid === 'row') return;
    const n = gridColumns(width, gap(), minWidth(), maxCols());
    if (n === cols) return;
    const led = leads();
    cols = n;
    root.style.setProperty('--fv-cols', String(n));
    if (!lv.groups.length) return;
    // The lead starts or stops spanning: its picture changes shape too.
    if (leads() !== led) build();
    else regroup();
  };

  /** Columns changed: re-partition the rendered records into whole rows. */
  const regroup = (): void => {
    if (virtual || lv.groups.some((g) => !g.live)) {
      build();
      return;
    }
    const items = lv.groups.flatMap(
      (g) => Array.from(g.el.children) as HTMLElement[],
    );
    for (const g of lv.groups) g.el.remove();
    lv.groups = [];
    for (let i = 0; i < items.length;) {
      const slice = items.slice(i, i + capacity(lv.groups.length));
      i += slice.length;
      const g: GroupView = {
        keys: slice.map((li) => li.dataset.key ?? ''),
        el: groupList(),
        live: true,
        height: 0,
      };
      g.el.append(...slice);
      lv.groups.push(g);
      moreBox.before(g.el);
    }
  };

  const groupList = (): HTMLElement =>
    h(ctx.doc, 'ul', grid === 'row' ? 'fv-rows fv-plain' : 'fv-grid fv-plain');

  const fill = (g: GroupView): void => {
    if (g.live) return;
    g.el.replaceChildren();
    for (const key of g.keys) {
      const m = lv.members.get(key);
      if (m) g.el.append(renderRecord(rc, key, m));
    }
    g.el.style.removeProperty('min-height');
    g.el.classList.remove('fv-spacer');
    g.live = true;
  };
  const empty = (g: GroupView): void => {
    if (!g.live) return;
    const active = activeIn(ctx, g.el);
    if (active) return; // never pull the focused record out from under the person
    g.height = g.el.getBoundingClientRect().height || g.height;
    g.el.replaceChildren();
    g.el.style.setProperty('min-height', `${Math.round(g.height)}px`);
    g.el.classList.add('fv-spacer');
    g.live = false;
  };

  /** Append groups for organic[from, to) after the last group. */
  const addGroups = (from: number, to: number, eager: boolean): GroupView[] => {
    const out: GroupView[] = [];
    // Top up a short last group first, so groups stay `every` long.
    const last = lv.groups[lv.groups.length - 1];
    const lastCap = capacity(lv.groups.length - 1);
    let i = from;
    if (last?.live && last.keys.length < lastCap) {
      const take = organic.slice(
        i,
        Math.min(to, i + lastCap - last.keys.length),
      );
      for (const k of take) {
        const m = lv.members.get(k);
        last.keys.push(k);
        if (m) last.el.append(renderRecord(rc, k, m));
      }
      i += take.length;
    }
    while (i < to) {
      const keys = organic.slice(
        i,
        Math.min(to, i + capacity(lv.groups.length)),
      );
      i += keys.length;
      const g: GroupView = {
        keys,
        el: groupList(),
        live: false,
        height: estimateGroupHeight(ctx, card, grid, keys.length, cols),
      };
      lv.groups.push(g);
      moreBox.before(g.el);
      out.push(g);
      if (eager) fill(g);
      else {
        g.el.style.setProperty('min-height', `${Math.round(g.height)}px`);
        g.el.classList.add('fv-spacer');
      }
    }
    return out;
  };

  /**
   * After the list: "Show n more" (the next `listFirst` records, never a page
   * reload), "Show details" (every record's other fields at once),
   * "Sponsored (n)" and what the view cannot hold.
   */
  const drawMore = (): void => {
    moreBox.replaceChildren();
    const hidden = organic.length - lv.revealed;
    if (hidden > 0 && listFirst) {
      const n = Math.min(listFirst, hidden);
      moreBox.append(
        waButton(ctx, FV_COPY.showMore(n), () => {
          const from = lv.revealed;
          lv.revealed = Math.min(organic.length, from + n);
          const added = addGroups(from, lv.revealed, true);
          drawMore();
          observe(added);
          // Keyboard users carry on at the first new record.
          const first = organic[from];
          const li = first
            ? root.querySelector<HTMLElement>(
                `li[data-key="${cssEscape(first)}"]`,
              )
            : null;
          li?.querySelector<HTMLElement>('h3 a, h3 button')?.focus({
            preventScroll: false,
          });
        }),
      );
    }
    if (tpl.more.length || root.querySelector('li.has-more'))
      moreBox.append(detailsToggle());
    if (lv.ads.length) moreBox.append(sponsored());
    if (lv.overflow > 0) {
      const more = h(ctx.doc, 'div', 'fv-onpage fv-more-on-page');
      more.append(
        h(
          ctx.doc,
          'p',
          'fv-onpage__label t-body',
          FV_COPY.moreOnPage(lv.overflow),
        ),
      );
      const go = h(ctx.doc, 'button', 'fv-btn');
      go.type = 'button';
      go.textContent = FV_COPY.showOnPage;
      go.addEventListener('click', () =>
        ctx.actions.showOnPage(
          listId,
          ctx.registry.members(listId)[CAP] ?? null,
        ),
      );
      more.append(go);
      moreBox.append(more);
    }
    moreBox.hidden = moreBox.childNodes.length === 0;
  };

  /** Ads fold into one quiet line after the list, never first (docs/11 R7). */
  const sponsored = (): HTMLElement =>
    disclosure(ctx, {
      label: FV_COPY.sponsored(lv.ads.length),
      cls: 'fv-sponsored',
      render: () => {
        // The same cards as the list, none of them leading.
        const ul = groupList();
        for (const k of lv.ads) {
          const m = lv.members.get(k);
          if (m) ul.append(renderRecord({ ...rc, leadKey: null }, k, m));
        }
        return ul;
      },
    });

  /** "Show details": every record's other fields, for the whole list at once. */
  const detailsToggle = (): HTMLButtonElement => {
    const b = waButton(
      ctx,
      details ? FV_COPY.hideDetails : FV_COPY.showDetails,
      () => {
        details = !details;
        root.classList.toggle('is-details', details);
        b.textContent = details ? FV_COPY.hideDetails : FV_COPY.showDetails;
        b.setAttribute('aria-pressed', String(details));
      },
    );
    b.setAttribute('aria-pressed', String(details));
    b.classList.add('fv-details-toggle');
    return b;
  };

  const observe = (groups: GroupView[]): void => {
    if (!io || !farIo) return;
    for (const g of groups) {
      io.observe(g.el);
      farIo.observe(g.el);
    }
  };

  const build = (): void => {
    io?.disconnect();
    farIo?.disconnect();
    io = null;
    farIo = null;
    const members = ctx.registry.members(listId);
    const kept = members.slice(0, CAP);
    lv.overflow = Math.max(0, members.length - kept.length);
    const keys = uniqueKeys(ctx, listId, kept);
    lv.members = new Map(keys.map((k, i) => [k, kept[i] as Element]));
    lv.order = keys;
    for (const [i, k] of keys.entries())
      lv.fps.set(k, ctx.registry.fingerprint(listId, kept[i] as Element));
    tpl = recordTemplate(ctx, spec, listRatio(ctx, listId, spec, kept));
    rc.tpl = tpl;
    const isAd = adTest(ctx, listId);
    const ads = keys.filter((k) => isAd(lv.members.get(k) as Element));
    // A list made only of ads is its own content (an ads section): shown.
    lv.ads = ads.length < keys.length ? ads : [];
    const adSet = new Set(lv.ads);
    organic = keys.filter((k) => !adSet.has(k));
    setLead();
    lv.revealed = Math.max(
      Math.min(organic.length, listFirst ?? organic.length),
      Math.min(lv.revealed, organic.length),
    );
    // Reachable: behind "Show n more" or "Sponsored (n)", one labelled click away.
    for (const k of keys) lv.seen.add(k);
    virtual = lv.revealed > VIRTUAL_AT;
    lv.groups = [];
    root.replaceChildren(moreBox);
    root.classList.toggle('is-details', details);
    const every = groupSize();
    // Without virtualization (or for the first screens) records render now.
    const eager = virtual
      ? Math.max(2, Math.ceil(48 / every)) * every
      : lv.revealed;
    addGroups(0, Math.min(eager, lv.revealed), true);
    if (lv.revealed > eager) addGroups(eager, lv.revealed, false);
    drawMore();
    if (
      virtual &&
      opts.scroller &&
      typeof IntersectionObserver === 'function'
    ) {
      const byEl = new Map(lv.groups.map((g) => [g.el, g]));
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const g = byEl.get(e.target as HTMLElement);
            if (g && e.isIntersecting) fill(g);
          }
        },
        { root: opts.scroller, rootMargin: '150% 0px 150% 0px' },
      );
      farIo = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const g = byEl.get(e.target as HTMLElement);
            if (g && !e.isIntersecting) empty(g);
          }
        },
        { root: opts.scroller, rootMargin: '400% 0px 400% 0px' },
      );
      observe(lv.groups);
    }
  };

  if (grid !== 'row') root.style.setProperty('--fv-cols', String(cols));
  build();
  if (grid !== 'row' && typeof ResizeObserver === 'function') {
    ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setColumns(w);
    });
    ro.observe(root);
  }

  lv.rebuild = build;
  lv.groupSize = groupSize;
  renderers.set(lv, (key) => {
    const m = lv.members.get(key);
    return m ? renderRecord(rc, key, m) : null;
  });
  lv.refreshMedia = () => {
    for (const g of lv.groups) {
      if (!g.live) continue;
      for (const li of Array.from(g.el.children) as HTMLElement[]) {
        const key = li.dataset.key;
        const m = key ? lv.members.get(key) : undefined;
        const box = li.querySelector<HTMLElement>('.fv-thumb[data-slot]');
        if (!m || !box || box.querySelector(':scope > img')) continue;
        const slot = slotEl(ctx, listId, m, box.dataset.slot ?? '');
        if (!slot) continue;
        fillMedia(ctx, box, mediaOf(ctx, box.dataset.slot ?? '', slot));
      }
    }
  };
  lv.dispose = () => {
    io?.disconnect();
    farIo?.disconnect();
    ro?.disconnect();
  };
  // Appended records (infinite lists) land behind "Show n more" when the
  // list is limited; otherwise in the last groups.
  (lv as ListViewInternal).append = (added: string[]) => {
    const adSet = new Set(lv.ads);
    const isAd = adTest(ctx, listId);
    const fresh: string[] = [];
    for (const k of added) {
      const m = lv.members.get(k);
      if (m && organic.length > 0 && isAd(m)) {
        if (!adSet.has(k)) lv.ads.push(k);
      } else fresh.push(k);
      lv.seen.add(k);
    }
    const from = organic.length;
    organic.push(...fresh);
    // New records join the shown ones while the list is short of listFirst
    // (or unlimited); the rest wait behind "Show n more".
    const to = listFirst
      ? Math.max(lv.revealed, Math.min(listFirst, organic.length))
      : organic.length;
    if (lv.revealed >= from && to > from) {
      addGroups(from, to, true);
      lv.revealed = to;
    }
    drawMore();
  };
  return lv;
}

interface ListViewInternal extends ListView {
  append?(added: string[]): void;
}

function activeIn(ctx: RenderCtx, el: HTMLElement): boolean {
  const root = el.getRootNode();
  const active =
    root instanceof ShadowRoot ? root.activeElement : ctx.doc.activeElement;
  return !!active && el.contains(active);
}

/**
 * Content changed under a list (WP6 sync): re-read its members, patch records
 * by key, keep the person's place. Changed records are re-rendered in place;
 * appended records join the last groups (or wait behind "Show n more");
 * anything else re-renders the list anchored on the first record in view,
 * with focus restored by record key.
 */
export function patchList(
  ctx: RenderCtx,
  lv: ListView,
  scroller: HTMLElement,
): void {
  const members = ctx.registry.members(lv.listId);
  const kept = members.slice(0, CAP);
  const keys = uniqueKeys(ctx, lv.listId, kept);
  const same =
    keys.length >= lv.order.length && lv.order.every((k, i) => keys[i] === k);
  if (same) {
    lv.overflow = Math.max(0, members.length - kept.length);
    const changed: string[] = [];
    for (const [i, k] of keys.entries()) {
      const m = kept[i] as Element;
      lv.members.set(k, m);
      const fp = ctx.registry.fingerprint(lv.listId, m);
      const old = lv.fps.get(k);
      lv.fps.set(k, fp);
      if (old !== undefined && old !== fp) changed.push(k);
    }
    for (const k of changed) {
      // Changed under the view: re-render that record where it is.
      const li = lv.root.querySelector<HTMLElement>(
        `li[data-key="${cssEscape(k)}"]`,
      );
      if (!li) continue;
      const focus = focusPath(li);
      const next = rerender(ctx, lv, k);
      if (!next) continue;
      li.replaceWith(next);
      restoreFocus(next, focus);
    }
    const added = keys.slice(lv.order.length);
    if (added.length) {
      lv.order = keys;
      (lv as ListViewInternal).append?.(added);
    }
    lv.refreshMedia();
    return;
  }
  // Reordered, inserted or removed: re-render anchored on the record in view.
  const anchor = firstInView(lv, scroller);
  const focusKey = focusedKey(lv);
  const focus = focusKey
    ? focusPath(
        lv.root.querySelector(
          `li[data-key="${cssEscape(focusKey)}"]`,
        ) as HTMLElement,
      )
    : null;
  lv.rebuild();
  if (anchor) {
    const li = lv.root.querySelector<HTMLElement>(
      `li[data-key="${cssEscape(anchor.key)}"]`,
    );
    if (li) {
      const top =
        li.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop += top - anchor.offset;
    }
  }
  if (focusKey && focus) {
    const li = lv.root.querySelector<HTMLElement>(
      `li[data-key="${cssEscape(focusKey)}"]`,
    );
    if (li) restoreFocus(li, focus);
  }
}

/** Re-render one record of a rendered list with its current template. */
function rerender(
  ctx: RenderCtx,
  lv: ListView,
  key: string,
): HTMLLIElement | null {
  const fn = renderers.get(lv);
  if (fn) return fn(key);
  const m = lv.members.get(key);
  if (!m) return null;
  const spec = lv.spec;
  const rc: RecordCtx = {
    ctx,
    lv,
    tpl: recordTemplate(ctx, spec, null),
    leadKey: null,
    contain: lv.root.classList.contains('fv-records--contain'),
  };
  return renderRecord(rc, key, m);
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(s)
    : s.replace(/["\\]/g, '\\$&');
}

/** The first rendered record whose top is in the scroller's viewport. */
export function firstInView(
  lv: ListView,
  scroller: HTMLElement,
): { key: string; offset: number } | null {
  const top = scroller.getBoundingClientRect().top;
  const bottom = top + scroller.clientHeight;
  for (const g of lv.groups) {
    if (!g.live) continue;
    const gr = g.el.getBoundingClientRect();
    if (gr.bottom < top || gr.top > bottom) continue;
    for (const li of Array.from(g.el.children) as HTMLElement[]) {
      const r = li.getBoundingClientRect();
      if (r.bottom > top + 1 && r.top < bottom) {
        return { key: li.dataset.key ?? '', offset: r.top - top };
      }
    }
  }
  return null;
}

function focusedKey(lv: ListView): string | null {
  const root = lv.root.getRootNode();
  const active = root instanceof ShadowRoot ? root.activeElement : null;
  const li = active?.closest<HTMLElement>('li.fv-rec');
  return li && lv.root.contains(li) ? (li.dataset.key ?? null) : null;
}

/** Index of the focused control among a record's focusable controls. */
function focusPath(li: HTMLElement | null): number | null {
  if (!li) return null;
  const root = li.getRootNode();
  const active = root instanceof ShadowRoot ? root.activeElement : null;
  if (!active || !li.contains(active)) return null;
  const all = focusables(li);
  const i = all.indexOf(active as HTMLElement);
  return i >= 0 ? i : null;
}

function restoreFocus(li: HTMLElement, index: number | null): void {
  if (index === null) return;
  const all = focusables(li);
  all[Math.min(index, all.length - 1)]?.focus({ preventScroll: true });
}

function focusables(li: HTMLElement): HTMLElement[] {
  return Array.from(
    li.querySelectorAll<HTMLElement>(
      'a[href]:not([tabindex="-1"]), button, input, select, textarea',
    ),
  );
}
