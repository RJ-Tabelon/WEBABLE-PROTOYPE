import type { Skeleton, SkeletonNode } from '../skeleton/types';
import {
  CARD_OF,
  CARD_STYLES,
  FIELD_ROLES,
  FIELD_SHOW,
  GRID_CARDS,
  IMPORTANCE,
  ITEM_KINDS,
  LAYOUT_OF,
  LEAD_CARDS,
  LEAD_MODES,
  LEAD_PAGE_TYPES,
  MEDIA_OF,
  MEDIA_SHAPES,
  PAGE_TYPES,
  PRIMARY_TASKS,
  PROTECTED_SECTION_KINDS,
  RECORD_ITEM_KINDS,
  SECTION_KINDS,
  SECTION_LAYOUTS,
  SPEC_MAX_COLLECTIONS,
  SPEC_MAX_FIELDS,
  SPEC_MAX_NODE_IDS,
  SPEC_MAX_SECTIONS,
  TRUSTED_SLOT_KINDS,
  type CardStyle,
  type Importance,
  type ItemKind,
  type LeadMode,
  type MediaShape,
  type PageType,
  type SectionKind,
  type SectionLayout,
} from './constants';
import type {
  PageSpec,
  SpecCollection,
  SpecField,
  SpecRepair,
  SpecSection,
  ValidatedSpec,
} from './spec';

/**
 * The PageSpec validator (docs/10 §4.1). Deterministic and local; it runs on
 * every spec before Fit view renders it: the heuristic's, the planner's, and
 * every cached spec re-resolved against a fresh skeleton.
 *
 * What it guarantees for the returned spec:
 *   - every id names a node of this skeleton; no id appears twice; no section
 *     id is an ancestor or descendant of another (the higher id is kept,
 *     unless it is an over-broad wrapper such as the page body); a slot id
 *     stands for its list, and a part of a control, heading or text block
 *     for the whole of it
 *   - exactly one primary section (fallback: the main landmark, the largest
 *     record collection, or the most readable text block)
 *   - protected kinds, and sections holding search, consent, main or focus,
 *     are never folded
 *   - the top strip (header, search, account_and_cart) only holds nodes that
 *     pass the trusted-slot rule; anything else gets its own 'other' section
 *   - collections name real collection nodes, fields name slots of their
 *     own exemplar, and an irreversible action is never the emphasised one
 *   - art direction (docs/12 §6.3): at most one hero, buy_box only on a
 *     product_detail section, no chip card on a record collection, and
 *     `lead: first` only for media and story cards on feeds, home portals,
 *     channels and articles; unknown layouts, cards and media shapes take
 *     their kind's default (LAYOUT_OF, CARD_OF, MEDIA_OF)
 *   - conservation: every visible control, input, heading, text block,
 *     media and table is under a section id or a `rest` id, so nothing on
 *     the page becomes unreachable in Fit view. `rest` holds the highest ids
 *     the sections leave out; like node_ids, each covers its subtree.
 *
 * Repairs name sections by their index in the returned spec, except
 * primary_fixed.from: the input index of the first section that claimed
 * primary (-1 when none did).
 *
 * It returns null only when no section of the input survives (a stale or
 * foreign spec), so callers fall back to the heuristic spec.
 */

// ---------------------------------------------------------------------------
// Skeleton index (shared with heuristic.ts)
// ---------------------------------------------------------------------------

/** Node kinds that hold something a person can read or use. */
const MEANINGFUL_KINDS: ReadonlySet<SkeletonNode['kind']> = new Set([
  'control',
  'input',
  'heading',
  'text',
  'stext',
  'media',
  'table',
]);

export function isMeaningfulNode(n: SkeletonNode): boolean {
  return MEANINGFUL_KINDS.has(n.kind);
}

/**
 * Read-only lookups over one skeleton. Parent links follow the extraction,
 * except that an exemplar root always hangs under its collection node, so a
 * collection's subtree includes its exemplar wherever the extractor put it.
 */
export interface SkeletonIndex {
  readonly skeleton: Skeleton;
  readonly byId: ReadonlyMap<string, SkeletonNode>;
  /** Document-order position of each id. */
  readonly order: ReadonlyMap<string, number>;
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** Root ids (normally just the body). */
  readonly roots: readonly string[];
  /** Effective parent (exemplar roots point at their collection). */
  parent(id: string): string | null;
  /** True when `a` is `d` or one of its ancestors. */
  contains(a: string, d: string): boolean;
  /** Collection id -> exemplar root id. */
  readonly exemplarOf: ReadonlyMap<string, string>;
  /**
   * For a node inside an exemplar subtree: the outermost collection that is
   * not itself inside an exemplar (the page-level list it belongs to).
   */
  readonly slotOwner: ReadonlyMap<string, string>;
  /** For a node inside an exemplar subtree: the nearest collection above it. */
  readonly slotList: ReadonlyMap<string, string>;
  /** Number of meaningful nodes in each subtree (self included). */
  readonly meaningful: ReadonlyMap<string, number>;
  /** Ids of every node in the subtree of `id`, in document order (self first). */
  subtree(id: string): string[];
}

export function indexSkeleton(skeleton: Skeleton): SkeletonIndex {
  const byId = new Map<string, SkeletonNode>();
  const order = new Map<string, number>();
  for (const [i, n] of skeleton.nodes.entries()) {
    if (typeof n?.id !== 'string' || byId.has(n.id)) continue;
    byId.set(n.id, n);
    order.set(n.id, i);
  }

  const exemplarOf = new Map<string, string>();
  const exemplarParent = new Map<string, string>();
  for (const n of byId.values()) {
    const ex = n.kind === 'collection' ? n.collection?.exemplar : undefined;
    if (ex && byId.has(ex) && ex !== n.id && !exemplarParent.has(ex)) {
      exemplarOf.set(n.id, ex);
      exemplarParent.set(ex, n.id);
    }
  }

  const parentOf = new Map<string, string | null>();
  for (const n of byId.values()) {
    const p = exemplarParent.get(n.id) ?? n.parent;
    parentOf.set(n.id, p !== null && byId.has(p) && p !== n.id ? p : null);
  }
  // Break any parent cycle (malformed input): a node whose chain loops is a root.
  for (const id of byId.keys()) {
    const seen = new Set<string>([id]);
    let p = parentOf.get(id) ?? null;
    while (p !== null) {
      if (seen.has(p)) {
        parentOf.set(id, null);
        break;
      }
      seen.add(p);
      p = parentOf.get(p) ?? null;
    }
  }

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  const sorted = [...byId.keys()].sort((a, b) => order.get(a)! - order.get(b)!);
  for (const id of sorted) {
    const p = parentOf.get(id) ?? null;
    if (p === null) roots.push(id);
    else {
      const list = children.get(p);
      if (list) list.push(id);
      else children.set(p, [id]);
    }
  }

  const meaningful = new Map<string, number>();
  const count = (id: string): number => {
    let c = isMeaningfulNode(byId.get(id)!) ? 1 : 0;
    for (const k of children.get(id) ?? []) c += count(k);
    meaningful.set(id, c);
    return c;
  };
  for (const r of roots) count(r);

  const slotOwner = new Map<string, string>();
  const slotList = new Map<string, string>();
  const mark = (id: string, owner: string, list: string): void => {
    slotOwner.set(id, owner);
    slotList.set(id, list);
    const n = byId.get(id)!;
    const ex = exemplarOf.get(id);
    for (const k of children.get(id) ?? []) {
      mark(k, owner, n.kind === 'collection' && k === ex ? id : list);
    }
  };
  const walk = (id: string): void => {
    const ex = exemplarOf.get(id);
    for (const k of children.get(id) ?? []) {
      if (k === ex) mark(k, id, id);
      else walk(k);
    }
  };
  for (const r of roots) walk(r);

  const parent = (id: string): string | null => parentOf.get(id) ?? null;
  const contains = (a: string, d: string): boolean => {
    let cur: string | null = d;
    while (cur !== null) {
      if (cur === a) return true;
      cur = parent(cur);
    }
    return false;
  };
  const subtree = (id: string): string[] => {
    const out: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (!byId.has(cur)) continue;
      out.push(cur);
      const kids = children.get(cur);
      if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    return out;
  };

  return {
    skeleton,
    byId,
    order,
    children,
    roots,
    parent,
    contains,
    exemplarOf,
    slotOwner,
    slotList,
    meaningful,
    subtree,
  };
}

/** Ancestors of `id`, nearest first (self excluded). */
export function skeletonAncestors(index: SkeletonIndex, id: string): string[] {
  const out: string[] = [];
  let p = index.parent(id);
  while (p !== null) {
    out.push(p);
    p = index.parent(p);
  }
  return out;
}

const area = (n: SkeletonNode): number =>
  Math.max(0, n.box[2]) * Math.max(0, n.box[3]);

export function skeletonNodeArea(index: SkeletonIndex, id: string): number {
  const n = index.byId.get(id);
  return n ? area(n) : 0;
}

// ---------------------------------------------------------------------------
// Shared predicates
// ---------------------------------------------------------------------------

const IRREVERSIBLE = new RegExp(
  [
    'buy now',
    'buy it now',
    '1-click',
    'one-click',
    'place (?:your )?order',
    'order now',
    'complete (?:purchase|order|payment)',
    'confirm (?:purchase|order|payment|transfer)',
    'submit (?:order|payment)',
    'pay(?: now)?',
    'purchase',
    'checkout',
    'check out',
    'proceed to checkout',
    'send(?: now| message| email)?',
    'delete(?: forever| permanently| account| all)?',
    'remove permanently',
    'empty (?:trash|bin)',
    'close (?:my )?account',
    'transfer(?: money| funds)?',
    'donate(?: now)?',
    // es, fr, de, pt, it
    'comprar(?: ya| ahora)?',
    'pagar',
    'enviar',
    'eliminar',
    'acheter(?: maintenant)?',
    'payer',
    'envoyer',
    'supprimer',
    'jetzt kaufen',
    'kaufen',
    'bezahlen',
    'senden',
    'löschen',
    'excluir',
    'acquista ora',
    'paga',
    'invia',
    'elimina',
  ]
    .map((p) => `(?:${p})`)
    .join('|'),
  'i',
);

/**
 * Actions that cannot be taken back (buy now, place order, send, delete,
 * pay). Fit view never emphasises them (docs/10 §4.4); the label is local
 * and never leaves the device.
 */
export function isIrreversibleLabel(label: string | undefined): boolean {
  if (!label) return false;
  const s = label.trim().toLowerCase();
  if (!s) return false;
  const m = IRREVERSIBLE.exec(s);
  if (!m) return false;
  // Whole-word match only ("payment history", "sender", "paste" are not actions).
  const before = s[m.index - 1];
  const after = s[m.index + m[0].length];
  const word = /[\p{L}\p{N}]/u;
  return !(before && word.test(before)) && !(after && word.test(after));
}

/** Search semantics: a search field, a search landmark or searchbox role. */
export function isSearchFieldNode(n: SkeletonNode): boolean {
  if (n.kind !== 'input') return false;
  if (n.inputType === 'search' || n.role === 'searchbox') return true;
  return false;
}

const CONTENT_ROLES: ReadonlySet<string> = new Set(['main', 'article', 'feed']);
const COMMENTS_LABEL = /\b(comments?|replies|discussion|reviews?)\b/i;
const STRIP_LANDMARKS: ReadonlySet<string> = new Set([
  'banner',
  'navigation',
  'search',
]);
const CHROME_LANDMARKS: ReadonlySet<string> = new Set([
  'banner',
  'navigation',
  'search',
  'contentinfo',
]);
/** Section kinds whose nodes count as page content for the trusted-slot rule. */
const CONTENT_SECTION_KINDS: ReadonlySet<SectionKind> = new Set([
  'main_list',
  'article',
  'product_detail',
  'comments',
  'related',
]);

export type TrustedSlotIssue =
  'inside_content' | 'holds_content' | 'position' | 'link';

export interface TrustedSlotContext {
  /** Ids of sections that hold page content in the spec being checked. */
  contentIds?: readonly string[];
  /** The tab's site; null = not a web site, so no link can be same-site. */
  siteHost?: string | null;
  /**
   * The strip section the node would go to. In 'account_and_cart' and
   * 'header', a link to a well-known identity provider's sign-in page
   * (SkeletonNode.idp, local only) counts as the site's own.
   */
  sectionKind?: SectionKind;
}

/** Strip sections where a site's "Sign in" may go to its identity provider. */
const IDENTITY_SLOTS: ReadonlySet<SectionKind> = new Set([
  'account_and_cart',
  'header',
]);

/**
 * Content roots for the trusted-slot rule: main, articles, feeds, comment
 * regions, and record collections (collections outside banner, navigation,
 * search and footer landmarks).
 */
function contentRoots(
  index: SkeletonIndex,
  extra: readonly string[],
): string[] {
  const out = new Set<string>();
  for (const n of index.byId.values()) {
    if (index.slotOwner.has(n.id)) continue;
    if (n.role && CONTENT_ROLES.has(n.role)) out.add(n.id);
    else if (n.tag === 'main' || n.tag === 'article') out.add(n.id);
    else if (
      (n.kind === 'landmark' || n.role === 'region') &&
      n.label &&
      COMMENTS_LABEL.test(n.label)
    )
      out.add(n.id);
    else if (n.kind === 'collection') {
      const chrome = skeletonAncestors(index, n.id).some((a) => {
        const r = index.byId.get(a)!.role;
        return r !== null && CHROME_LANDMARKS.has(r);
      });
      if (!chrome) out.add(n.id);
    }
  }
  for (const id of extra) if (index.byId.has(id)) out.add(id);
  return [...out];
}

/**
 * The trusted-slot rule (docs/10 §4.1): may this node be drawn in Fit view's
 * top strip as the site's header, search or account controls? Returns null
 * when it may, else the first reason it may not:
 *
 *   inside_content  it sits inside main, a record, an article or comments
 *   holds_content   it contains one of those
 *   position        it is neither inside a banner/navigation/search landmark
 *                   nor within the top two viewports
 *   link            a link in it leaves the tab's site (except a sign-in
 *                   link to a well-known identity provider, in the account
 *                   or header slot)
 *
 * So a "Sign in" link a user posted in a comment can never become WebAble's
 * account button.
 */
export function trustedSlotIssue(
  index: SkeletonIndex,
  id: string,
  ctx: TrustedSlotContext = {},
  roots?: readonly string[],
): TrustedSlotIssue | null {
  const n = index.byId.get(id);
  if (!n) return 'position';
  if (index.slotOwner.has(id)) return 'inside_content';
  const content = roots ?? contentRoots(index, ctx.contentIds ?? []);
  for (const c of content) {
    if (index.contains(c, id)) return 'inside_content';
  }
  for (const c of content) {
    if (c !== id && index.contains(id, c)) return 'holds_content';
  }
  const inStrip = [id, ...skeletonAncestors(index, id)].some((a) => {
    const r = index.byId.get(a)!.role;
    return r !== null && STRIP_LANDMARKS.has(r);
  });
  const vh = Math.max(1, index.skeleton.viewport.height);
  if (!inStrip && !(n.box[1] < 2 * vh)) return 'position';
  for (const d of index.subtree(id)) {
    const m = index.byId.get(d)!;
    const isLink =
      m.role === 'link' ||
      (m.href !== undefined && m.kind === 'control') ||
      (m.tag === 'a' && m.kind === 'control' && m.role !== 'button');
    if (!isLink) continue;
    const href = m.href;
    if (
      href === 'other' &&
      m.idp === true &&
      ctx.sectionKind !== undefined &&
      IDENTITY_SLOTS.has(ctx.sectionKind)
    )
      continue;
    if (href === 'other' || href === undefined) return 'link';
    if (href === 'same' && ctx.siteHost === null) return 'link';
  }
  return null;
}

/** Content roots for repeated trusted-slot checks against one spec. */
export function trustedSlotRoots(
  index: SkeletonIndex,
  contentIds: readonly string[] = [],
): string[] {
  return contentRoots(index, contentIds);
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export interface ValidateSpecContext {
  /** Id of the node holding focus (this extraction), if known. */
  focusId?: string | null;
  /** The tab's site (eTLD+1); null when the tab is not on a web site. */
  siteHost?: string | null;
}

/** A section being validated (mutable). */
interface Work {
  kind: SectionKind;
  importance: Importance;
  ids: string[];
  heading: string | null;
  layout: SectionLayout;
  /** The layout is the validator's default, not the input's choice. */
  auto: boolean;
  /** Index in the input spec, or -1 for sections the validator created. */
  src: number;
}

/** A repair whose section reference is resolved to an output index at the end. */
type PendingRepair =
  | { repair: SpecRepair }
  | {
      kind:
        | 'protected_unfolded'
        | 'focus_unfolded'
        | 'hero_demoted'
        | 'buy_box_demoted';
      section: Work;
    }
  | { kind: 'untrusted_slot' | 'heading_dropped'; section: Work; id: string }
  | { kind: 'primary_fixed'; from: number; section: Work };

const KINDS: ReadonlySet<string> = new Set(SECTION_KINDS);
const IMPORTANCES: ReadonlySet<string> = new Set(IMPORTANCE);
const LAYOUTS: ReadonlySet<string> = new Set(SECTION_LAYOUTS);
const ITEM_KIND_SET: ReadonlySet<string> = new Set(ITEM_KINDS);
const CARD_SET: ReadonlySet<string> = new Set(CARD_STYLES);
const MEDIA_SET: ReadonlySet<string> = new Set(MEDIA_SHAPES);
const LEAD_SET: ReadonlySet<string> = new Set(LEAD_MODES);
const RECORD_KINDS: ReadonlySet<ItemKind> = new Set(RECORD_ITEM_KINDS);
const ROLE_SET: ReadonlySet<string> = new Set(FIELD_ROLES);
const SHOW_SET: ReadonlySet<string> = new Set(FIELD_SHOW);
const PROTECTED: ReadonlySet<SectionKind> = new Set(PROTECTED_SECTION_KINDS);
const TRUSTED: ReadonlySet<SectionKind> = new Set(TRUSTED_SLOT_KINDS);
const ID = /^e[0-9]{1,4}$/;

/** Kinds that make a sensible primary when several sections claim it. */
const PRIMARY_KIND_RANK: Partial<Record<SectionKind, number>> = {
  main_list: 5,
  article: 5,
  product_detail: 5,
  form: 4,
  feature_blocks: 3,
  media: 2,
  comments: 1,
};

/** Kinds that should not stay the primary section's kind after a fallback promotion. */
const NON_CONTENT_KINDS: ReadonlySet<SectionKind> = new Set([
  'ads',
  'clutter',
  'consent',
  'overlay_modal',
  'header',
  'search',
  'account_and_cart',
  'footer',
  'legal',
]);

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

export function validateSpec(
  spec: PageSpec,
  skeleton: Skeleton,
  ctx: ValidateSpecContext = {},
): ValidatedSpec | null {
  const index = indexSkeleton(skeleton);
  if (index.byId.size === 0 || !spec || !isArray(spec.sections)) return null;
  const pending: PendingRepair[] = [];
  const note = (repair: SpecRepair): void => {
    pending.push({ repair });
  };

  // 1. Shape: enums, bounds. -------------------------------------------------
  let sections: Work[] = [];
  for (const [i, raw] of spec.sections.entries()) {
    if (i >= SPEC_MAX_SECTIONS) break;
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Partial<SpecSection>;
    const kind = KINDS.has(s.kind as string)
      ? (s.kind as SectionKind)
      : 'other';
    const known = LAYOUTS.has(s.layout as string);
    sections.push({
      kind,
      importance: IMPORTANCES.has(s.importance as string)
        ? (s.importance as Importance)
        : 'secondary',
      ids: isArray(s.node_ids)
        ? s.node_ids.filter((x): x is string => typeof x === 'string')
        : [],
      heading: typeof s.heading_ref === 'string' ? s.heading_ref : null,
      layout: known ? (s.layout as SectionLayout) : LAYOUT_OF[kind],
      auto: !known,
      src: i,
    });
  }

  // 2. Ids: unknown, slots, duplicates, overlaps. ----------------------------
  const seen = new Set<string>();
  for (const s of sections) {
    const kept: string[] = [];
    for (const raw of s.ids) {
      if (!ID.test(raw) || !index.byId.has(raw)) {
        note({ kind: 'unknown_id', id: raw });
        continue;
      }
      let id = raw;
      const owner = index.slotOwner.get(raw);
      if (owner) {
        // A slot is part of every record, not a page region: use its list.
        note({ kind: 'overlap', id: raw, kept: owner });
        id = owner;
      } else {
        // Controls, headings and text are atomic: a part of one means all of it.
        const whole = atomicOwner(index, raw);
        if (whole !== raw) {
          note({ kind: 'overlap', id: raw, kept: whole });
          id = whole;
        }
      }
      if (seen.has(id)) {
        if (id === raw) note({ kind: 'duplicate_id', id });
        continue;
      }
      if (kept.length >= SPEC_MAX_NODE_IDS) continue;
      seen.add(id);
      kept.push(id);
    }
    s.ids = kept;
  }
  resolveOverlaps(index, sections, note);
  sections = sections.filter((s) => s.ids.length > 0);
  if (sections.length === 0) return null;

  // 3. Trusted slots. ----------------------------------------------------------
  {
    const contentIds = sections
      .filter((s) => CONTENT_SECTION_KINDS.has(s.kind))
      .flatMap((s) => s.ids);
    const roots = trustedSlotRoots(index, contentIds);
    const trust: TrustedSlotContext = { siteHost: ctx.siteHost };
    const next: Work[] = [];
    for (const s of sections) {
      next.push(s);
      if (!TRUSTED.has(s.kind)) continue;
      const keep: string[] = [];
      const move: string[] = [];
      const slot: TrustedSlotContext = { ...trust, sectionKind: s.kind };
      for (const id of s.ids) {
        const parts = splitTrusted(index, id, slot, roots);
        keep.push(...parts.keep);
        move.push(...parts.move);
      }
      if (keep.length + move.length > SPEC_MAX_NODE_IDS * 2) {
        // Pathological fan-out: keep whole ids rather than splitting.
        keep.length = 0;
        move.length = 0;
        for (const id of s.ids) {
          if (trustedSlotIssue(index, id, slot, roots)) move.push(id);
          else keep.push(id);
        }
      }
      s.ids = sortByOrder(index, keep).slice(0, SPEC_MAX_NODE_IDS);
      const moved = sortByOrder(index, move);
      if (moved.length === 0) continue;
      const other: Work = {
        kind: 'other',
        importance: s.importance,
        ids: moved.slice(0, SPEC_MAX_NODE_IDS),
        heading: null,
        layout: 'as_is',
        auto: true,
        src: -1,
      };
      if (s.importance === 'primary') {
        // A primary top-strip section that held page content: the content is
        // what was primary, so the primary goes with it.
        if (s.ids.length) s.importance = 'secondary';
        other.kind = primaryKindFor(index, moved[0]!);
        other.layout = layoutFor(other.kind);
      }
      next.push(other);
      // Untrusted nodes keep their own section; the record points at the strip section they left.
      for (const id of moved) {
        pending.push({
          kind: 'untrusted_slot',
          section: s.ids.length ? s : other,
          id,
        });
      }
    }
    sections = next.filter((s) => s.ids.length > 0);
  }

  // 4. Exactly one primary, never a consent prompt. ----------------------------
  {
    for (const s of sections)
      if (s.importance === 'primary' && s.kind === 'consent')
        s.importance = 'secondary';
    const primaries = sections.filter((s) => s.importance === 'primary');
    if (primaries.length > 1) {
      const best = bestPrimary(index, primaries);
      for (const s of primaries) if (s !== best) s.importance = 'secondary';
      pending.push({
        kind: 'primary_fixed',
        from: primaries[0]!.src,
        section: best,
      });
    } else if (primaries.length === 0) {
      const chosen = fallbackPrimary(index, sections);
      chosen.importance = 'primary';
      pending.push({ kind: 'primary_fixed', from: -1, section: chosen });
    }
  }

  // 5. Folding rules: protected kinds and content, and focus. -----------------
  const focusNodes = focusLeaves(index, ctx.focusId ?? null);
  for (const s of sections) {
    const holdsFocus = focusNodes.some((f) =>
      s.ids.some((id) => index.contains(id, f)),
    );
    if (
      holdsFocus &&
      (s.importance === 'fold' || s.importance === 'tertiary')
    ) {
      s.importance = 'secondary';
      pending.push({ kind: 'focus_unfolded', section: s });
      continue;
    }
    if (s.importance !== 'fold') continue;
    if (PROTECTED.has(s.kind) || holdsProtectedContent(index, s.ids)) {
      s.importance = 'tertiary';
      pending.push({ kind: 'protected_unfolded', section: s });
    }
  }

  // 6. Section headings. ---------------------------------------------------------
  for (const s of sections) {
    if (s.heading === null) continue;
    const h = index.byId.get(s.heading);
    const ok =
      h !== undefined &&
      h.kind === 'heading' &&
      !index.slotOwner.has(h.id) &&
      s.ids.some((id) => index.contains(id, h.id));
    if (!ok) {
      pending.push({ kind: 'heading_dropped', section: s, id: s.heading });
      s.heading = null;
    }
  }

  // 7. Bound the section count (validator-made sections can push it over). ----
  while (sections.length > SPEC_MAX_SECTIONS) {
    let drop = -1;
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i]!.importance !== 'primary') {
        drop = i;
        break;
      }
    }
    if (drop < 0) break;
    sections.splice(drop, 1); // its nodes fall into `rest`
  }

  // 8. Art direction: one hero, buy_box only on product_detail. ----------------
  for (const fix of directSections(sections)) {
    const s = sections[fix.index]!;
    // A demoted hero takes its kind's default, which for a list depends on its cards.
    if (fix.kind === 'hero_demoted') s.auto = true;
    pending.push({ kind: fix.kind, section: s });
  }

  // 9. Collections. --------------------------------------------------------------
  const pageType: PageType = (PAGE_TYPES as readonly string[]).includes(
    spec.page_type,
  )
    ? spec.page_type
    : 'other';
  const collections = validateCollections(
    index,
    isArray(spec.collections) ? spec.collections : [],
    pageType,
    note,
  );

  // A list section whose layout the validator chose is a grid when its records are cards.
  for (const s of sections) {
    if (!s.auto || (s.kind !== 'main_list' && s.kind !== 'related')) continue;
    const cards = collections
      .filter((c) => s.ids.some((id) => index.contains(id, c.list_id)))
      .map((c) => c.card);
    if (cards.length && cards.every((c) => GRID_CARDS.includes(c)))
      s.layout = 'card_grid';
  }

  // 10. Conservation: everything left out goes to "Everything else". ----------
  const rest = restIds(index, sections);
  if (rest.length) note({ kind: 'rest_added', ids: rest.length });

  // Output.
  const primary = sections.findIndex((s) => s.importance === 'primary');
  const position = new Map(sections.map((s, i) => [s, i]));
  const repairs: SpecRepair[] = [];
  for (const p of pending) {
    if ('repair' in p) {
      repairs.push(p.repair);
      continue;
    }
    const at = position.get(p.section);
    if (at === undefined) continue;
    if (p.kind === 'primary_fixed')
      repairs.push({ kind: 'primary_fixed', from: p.from, to: at });
    else if (p.kind === 'untrusted_slot' || p.kind === 'heading_dropped')
      repairs.push({ kind: p.kind, section: at, id: p.id });
    else repairs.push({ kind: p.kind, section: at });
  }

  return {
    spec: {
      v: 1,
      page_type: pageType,
      primary_task: (PRIMARY_TASKS as readonly string[]).includes(
        spec.primary_task,
      )
        ? spec.primary_task
        : 'other',
      sections: sections.map((s) => ({
        kind: s.kind,
        importance: s.importance,
        node_ids: s.ids,
        heading_ref: s.heading,
        layout: s.layout,
      })),
      collections,
    },
    primary,
    rest,
    repairs,
  };
}

/** The outermost control, heading, text or media node holding `id`, else `id`. */
function atomicOwner(index: SkeletonIndex, id: string): string {
  let whole = id;
  for (const a of skeletonAncestors(index, id)) {
    if (isMeaningfulNode(index.byId.get(a)!)) whole = a;
  }
  return whole;
}

function sortByOrder(index: SkeletonIndex, ids: readonly string[]): string[] {
  return [...new Set(ids)].sort(
    (a, b) => (index.order.get(a) ?? 0) - (index.order.get(b) ?? 0),
  );
}

/**
 * A wrapper that spans unrelated page regions: the root, or a node holding
 * two of main, banner and footer. Listing it next to a more specific id is a
 * planning mistake, so for over-broad ids the specific id wins instead.
 */
function overBroad(index: SkeletonIndex, id: string): boolean {
  if (index.parent(id) === null) return true;
  const classes = new Set<string>();
  for (const d of index.subtree(id)) {
    const r = index.byId.get(d)!.role;
    if (r === 'main' || r === 'banner' || r === 'contentinfo') classes.add(r);
    if (classes.size >= 2) return true;
  }
  return false;
}

/**
 * Remove ancestor/descendant pairs across all sections, keeping the higher
 * id, except that an over-broad wrapper loses to the specific ids under it
 * (and the pass restarts without it).
 */
function resolveOverlaps(
  index: SkeletonIndex,
  sections: Work[],
  note: (r: SpecRepair) => void,
): void {
  const owner = new Map<string, Work>();
  for (const s of sections) for (const id of s.ids) owner.set(id, s);
  const depth = (id: string): number => skeletonAncestors(index, id).length;
  const entries = [...owner.keys()].sort(
    (a, b) => depth(a) - depth(b) || index.order.get(a)! - index.order.get(b)!,
  );
  const broad = new Map<string, boolean>();
  const isBroad = (id: string): boolean => {
    let v = broad.get(id);
    if (v === undefined) {
      v = overBroad(index, id);
      broad.set(id, v);
    }
    return v;
  };

  const excluded = new Set<string>();
  let dropped = new Map<string, string>();
  for (let pass = 0; pass <= entries.length; pass++) {
    const kept = new Set<string>();
    dropped = new Map();
    let restart = false;
    for (const id of entries) {
      if (excluded.has(id)) continue;
      let anc: string | null = null;
      for (const a of skeletonAncestors(index, id)) {
        if (kept.has(a)) {
          anc = a;
          break;
        }
      }
      if (anc === null) {
        kept.add(id);
        continue;
      }
      if (isBroad(anc) && owner.get(anc) !== owner.get(id)) {
        excluded.add(anc);
        note({ kind: 'overlap', id: anc, kept: id });
        restart = true;
        break;
      }
      dropped.set(id, anc);
    }
    if (!restart) break;
  }
  for (const [id, anc] of dropped) note({ kind: 'overlap', id, kept: anc });
  for (const s of sections) {
    s.ids = s.ids.filter((id) => !excluded.has(id) && !dropped.has(id));
  }
}

/**
 * Split an id destined for the top strip into the parts that pass the
 * trusted-slot rule and the parts that must go elsewhere. A container that
 * fails only because it holds content or an off-site link is split along its
 * children, so one stray link does not push the whole header out.
 */
function splitTrusted(
  index: SkeletonIndex,
  id: string,
  trust: TrustedSlotContext,
  roots: readonly string[],
): { keep: string[]; move: string[] } {
  const issue = trustedSlotIssue(index, id, trust, roots);
  if (!issue) return { keep: [id], move: [] };
  const n = index.byId.get(id)!;
  const kids = (index.children.get(id) ?? []).filter(
    (k) => (index.meaningful.get(k) ?? 0) > 0,
  );
  const splittable =
    (issue === 'holds_content' || issue === 'link') &&
    (n.kind === 'group' || n.kind === 'landmark') &&
    kids.length > 0;
  if (!splittable) return { keep: [], move: [id] };
  const out = { keep: [] as string[], move: [] as string[] };
  for (const k of kids) {
    const part = splitTrusted(index, k, trust, roots);
    out.keep.push(...part.keep);
    out.move.push(...part.move);
  }
  return out;
}

function sectionArea(index: SkeletonIndex, s: Work): number {
  return s.ids.reduce((sum, id) => sum + skeletonNodeArea(index, id), 0);
}

function mainLandmarks(index: SkeletonIndex): string[] {
  return [...index.byId.values()]
    .filter(
      (n) =>
        (n.role === 'main' || n.tag === 'main') && !index.slotOwner.has(n.id),
    )
    .map((n) => n.id);
}

/** Of several claimed primaries: the best content kind, then one in main, then the largest. */
function bestPrimary(index: SkeletonIndex, candidates: Work[]): Work {
  const mains = mainLandmarks(index);
  const inMain = (s: Work): boolean =>
    s.ids.some((id) =>
      mains.some((m) => index.contains(m, id) || index.contains(id, m)),
    );
  let best = candidates[0]!;
  let bestKey: [number, number, number] = [-1, -1, -1];
  for (const s of candidates) {
    const key: [number, number, number] = [
      PRIMARY_KIND_RANK[s.kind] ?? 0,
      inMain(s) ? 1 : 0,
      sectionArea(index, s),
    ];
    if (
      key[0] > bestKey[0] ||
      (key[0] === bestKey[0] && key[1] > bestKey[1]) ||
      (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])
    ) {
      best = s;
      bestKey = key;
    }
  }
  return best;
}

/** Characters of long text in a subtree, records excluded (prose runs count as text). */
function textChars(index: SkeletonIndex, id: string): number {
  let sum = 0;
  for (const d of index.subtree(id)) {
    const n = index.byId.get(d)!;
    if (n.kind === 'text' && !index.slotOwner.has(d)) sum += n.text?.chars ?? 0;
    else if (n.kind === 'collection' && !index.slotOwner.has(d))
      sum += proseRunChars(index, d);
  }
  return sum;
}

/**
 * A run of text blocks read as a list (an article's paragraphs sharing a
 * class): its exemplar holds text and nothing to use or look at (no
 * control, linked heading or media), ads aside.
 * Returns the run's estimated running text (exemplar text × count), else 0.
 */
export function proseRunChars(index: SkeletonIndex, id: string): number {
  const n = index.byId.get(id);
  const ex = index.exemplarOf.get(id);
  if (!n || n.kind !== 'collection' || !ex) return 0;
  let chars = 0;
  const stack = [ex];
  while (stack.length) {
    const d = stack.pop()!;
    const m = index.byId.get(d);
    if (!m || m.flags.includes('adhint')) continue;
    if (
      m.kind === 'control' ||
      m.kind === 'input' ||
      m.kind === 'media' ||
      m.kind === 'collection' ||
      m.kind === 'table' ||
      m.flags.includes('headlink')
    )
      return 0;
    if (m.kind === 'text' || m.kind === 'stext') chars += m.text?.chars ?? 0;
    for (const k of index.children.get(d) ?? []) stack.push(k);
  }
  return chars >= 60 ? chars * Math.max(1, n.collection?.count ?? 1) : 0;
}

/**
 * Record collections: page-level collections whose exemplar holds more than
 * one thing and is not a run of prose.
 */
export function isRecordCollection(index: SkeletonIndex, id: string): boolean {
  const n = index.byId.get(id);
  if (!n || n.kind !== 'collection' || index.slotOwner.has(id)) return false;
  if ((n.collection?.count ?? 0) < 3) return false;
  const ex = index.exemplarOf.get(id);
  if (!ex) return false;
  if (proseRunChars(index, id) > 0) return false;
  return (index.meaningful.get(ex) ?? 0) >= 2 || textChars(index, ex) >= 40;
}

/**
 * The page's main content as local rules see it: the main landmark, else the
 * largest record collection, else the deepest block holding most of the
 * page's running text.
 */
export function localMainContent(index: SkeletonIndex): string | null {
  const mains = mainLandmarks(index);
  if (mains.length) {
    return mains.reduce((a, b) =>
      skeletonNodeArea(index, b) > skeletonNodeArea(index, a) ? b : a,
    );
  }
  let bestList: string | null = null;
  for (const n of index.byId.values()) {
    if (!isRecordCollection(index, n.id)) continue;
    if (bestList === null || area(n) > skeletonNodeArea(index, bestList)) {
      bestList = n.id;
    }
  }
  if (bestList) return bestList;
  return readableBlock(index, index.roots[0] ?? null);
}

/** The deepest node under `scope` holding at least `share` of its running text. */
export function readableBlock(
  index: SkeletonIndex,
  scope: string | null,
  share = 0.7,
  minChars = 400,
): string | null {
  if (scope === null) return null;
  const total = textChars(index, scope);
  if (total < minChars) return null;
  let cur = scope;
  for (;;) {
    const next = (index.children.get(cur) ?? []).find(
      (k) => textChars(index, k) >= share * total,
    );
    if (!next) return cur;
    cur = next;
  }
}

/** The section kind a validator-made primary gets from its anchor: main_list, article or other. */
function primaryKindFor(index: SkeletonIndex, id: string): SectionKind {
  const n = index.byId.get(id)!;
  if (n.kind === 'collection')
    return proseRunChars(index, id) > 0 ? 'article' : 'main_list';
  const lists = index
    .subtree(id)
    .filter((d) => isRecordCollection(index, d))
    .map((d) => skeletonNodeArea(index, d));
  const listArea = lists.length ? Math.max(...lists) : 0;
  if (listArea >= 0.3 * area(n)) return 'main_list';
  if (textChars(index, id) >= 800) return 'article';
  return 'other';
}

// ---------------------------------------------------------------------------
// Art direction (docs/12 §6.3; shared with heuristic.ts)
// ---------------------------------------------------------------------------

/** The layout of a section whose own is not allowed, or that the validator makes or re-kinds. */
function layoutFor(kind: SectionKind): SectionLayout {
  const d = LAYOUT_OF[kind];
  if (d !== 'hero') return d;
  return kind === 'promo_hero' ? 'spotlight' : 'reading';
}

/**
 * Apply the section layout rules in place: buy_box only on a product_detail
 * section (else reading), and at most one hero (the first page_heading
 * hero, else the first hero; the others get their kind's default). Returns
 * what changed, by section index.
 */
export function directSections(
  sections: Array<{ kind: SectionKind; layout: SectionLayout }>,
): Array<{ index: number; kind: 'hero_demoted' | 'buy_box_demoted' }> {
  const out: Array<{
    index: number;
    kind: 'hero_demoted' | 'buy_box_demoted';
  }> = [];
  for (const [i, s] of sections.entries()) {
    if (s.layout === 'buy_box' && s.kind !== 'product_detail') {
      s.layout = 'reading';
      out.push({ index: i, kind: 'buy_box_demoted' });
    }
  }
  const heroes = [...sections.entries()].filter(([, s]) => s.layout === 'hero');
  const keep =
    heroes.find(([, s]) => s.kind === 'page_heading')?.[0] ?? heroes[0]?.[0];
  for (const [i, s] of heroes) {
    if (i === keep) continue;
    s.layout = layoutFor(s.kind);
    out.push({ index: i, kind: 'hero_demoted' });
  }
  return out;
}

/** May a collection with this card use `lead: first` on this page type? */
export function leadAllowed(card: CardStyle, pageType: PageType): boolean {
  return LEAD_CARDS.includes(card) && LEAD_PAGE_TYPES.includes(pageType);
}

/** May records of this kind use this card? (Records are never chips.) */
export function cardAllowed(kind: ItemKind, card: CardStyle): boolean {
  return !(card === 'chip' && RECORD_KINDS.has(kind));
}

/** Choose (or build) the primary section when the spec names none. */
function fallbackPrimary(index: SkeletonIndex, sections: Work[]): Work {
  const main = localMainContent(index);
  const covering = (id: string): Work | undefined =>
    sections.find((s) => s.ids.some((x) => index.contains(x, id)));
  const promote = (s: Work, anchor: string | null): Work => {
    if (NON_CONTENT_KINDS.has(s.kind)) {
      s.kind = anchor ? primaryKindFor(index, anchor) : 'other';
      s.layout = layoutFor(s.kind);
      s.auto = true;
    }
    return s;
  };

  if (main !== null) {
    const owner = covering(main);
    if (owner) return promote(owner, main);
    const covered = sections.flatMap((s) => s.ids);
    const inside = covered.filter((id) => index.contains(main, id));
    const ids = inside.length
      ? uncoveredSubtrees(index, main, covered)
      : [main];
    if (ids.length > 0 && ids.length <= SPEC_MAX_NODE_IDS) {
      const kind = primaryKindFor(index, main);
      const made: Work = {
        kind,
        importance: 'primary',
        ids,
        heading: null,
        layout: layoutFor(kind),
        auto: true,
        src: -1,
      };
      const at = sections.findIndex(
        (s) => index.order.get(s.ids[0]!)! > index.order.get(ids[0]!)!,
      );
      sections.splice(at < 0 ? sections.length : at, 0, made);
      return made;
    }
    // Main is covered piecemeal: promote the section holding most of it.
    let best: Work | null = null;
    let bestArea = -1;
    for (const s of sections) {
      const a = s.ids
        .filter((id) => index.contains(main, id))
        .reduce((sum, id) => sum + skeletonNodeArea(index, id), 0);
      if (a > bestArea && !NON_CONTENT_KINDS.has(s.kind)) {
        best = s;
        bestArea = a;
      }
    }
    if (best && bestArea > 0) return best;
  }

  let best = sections[0]!;
  for (const s of sections) {
    const better =
      NON_CONTENT_KINDS.has(best.kind) && !NON_CONTENT_KINDS.has(s.kind);
    const worse =
      !NON_CONTENT_KINDS.has(best.kind) && NON_CONTENT_KINDS.has(s.kind);
    if (better || (!worse && sectionArea(index, s) > sectionArea(index, best)))
      best = s;
  }
  return promote(best, best.ids[0] ?? null);
}

/** Maximal subtrees under `root` that hold meaningful nodes and no covered id. */
export function uncoveredSubtrees(
  index: SkeletonIndex,
  root: string,
  covered: readonly string[],
): string[] {
  const coveredSet = new Set(covered);
  const holds = new Set<string>();
  for (const id of covered) {
    for (const a of skeletonAncestors(index, id)) holds.add(a);
  }
  const out: string[] = [];
  const visit = (id: string): void => {
    if (coveredSet.has(id)) return;
    if ((index.meaningful.get(id) ?? 0) === 0) return;
    if (!holds.has(id)) {
      out.push(id);
      return;
    }
    for (const k of index.children.get(id) ?? []) visit(k);
  };
  visit(root);
  return out;
}

/** The innermost nodes flagged as holding focus, plus the context's focus id. */
function focusLeaves(index: SkeletonIndex, focusId: string | null): string[] {
  const flagged = [...index.byId.values()]
    .filter((n) => n.flags.includes('focus'))
    .map((n) => n.id);
  const leaves = flagged.filter(
    (id) =>
      !(index.children.get(id) ?? []).some((k) =>
        index.byId.get(k)!.flags.includes('focus'),
      ),
  );
  if (focusId && index.byId.has(focusId)) leaves.push(focusId);
  return leaves;
}

/** A section holding search, consent or the main landmark is never folded, whatever its kind. */
function holdsProtectedContent(
  index: SkeletonIndex,
  ids: readonly string[],
): boolean {
  for (const id of ids) {
    for (const d of index.subtree(id)) {
      const n = index.byId.get(d)!;
      if (isSearchFieldNode(n) || n.role === 'search') return true;
      if (n.flags.includes('consenthint')) return true;
      if ((n.role === 'main' || n.tag === 'main') && !index.slotOwner.has(d))
        return true;
    }
  }
  return false;
}

/** Can activating this slot open the item? */
function activatable(index: SkeletonIndex, id: string): boolean {
  const n = index.byId.get(id)!;
  if (n.kind === 'control') return true;
  if (n.kind === 'heading' && n.flags.includes('headlink')) return true;
  return index
    .subtree(id)
    .some((d) => index.byId.get(d)!.kind === 'control' && d !== id);
}

/**
 * Keep collections that name a real collection node (once each); keep
 * fields whose slot lies in that list's own exemplar (not a nested list's);
 * demote an irreversible primary action; keep open_slot only when it can
 * open the item and does not buy, send or delete. Cards, media shapes and
 * leads follow the art-direction rules.
 */
function validateCollections(
  index: SkeletonIndex,
  input: unknown[],
  pageType: PageType,
  note: (r: SpecRepair) => void,
): SpecCollection[] {
  const out: SpecCollection[] = [];
  const seenLists = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Partial<SpecCollection>;
    const listId = typeof c.list_id === 'string' ? c.list_id : '';
    const node = index.byId.get(listId);
    if (
      !node ||
      node.kind !== 'collection' ||
      !index.exemplarOf.has(listId) ||
      seenLists.has(listId) ||
      out.length >= SPEC_MAX_COLLECTIONS
    ) {
      note({ kind: 'collection_dropped', list_id: listId });
      continue;
    }
    seenLists.add(listId);
    const inOwnExemplar = (slot: string): boolean =>
      index.byId.has(slot) && index.slotList.get(slot) === listId;
    const exemplarHasLink = index
      .subtree(index.exemplarOf.get(listId)!)
      .some((d) => {
        const m = index.byId.get(d)!;
        return m.kind === 'control' && m.role === 'link';
      });

    const fields: SpecField[] = [];
    const seenSlots = new Set<string>();
    for (const rawField of isArray(c.fields) ? c.fields : []) {
      if (!rawField || typeof rawField !== 'object') continue;
      const f = rawField as Partial<SpecField>;
      const slot = typeof f.slot_id === 'string' ? f.slot_id : '';
      if (
        !inOwnExemplar(slot) ||
        seenSlots.has(slot) ||
        fields.length >= SPEC_MAX_FIELDS
      ) {
        note({ kind: 'field_dropped', list_id: listId, slot_id: slot });
        continue;
      }
      seenSlots.add(slot);
      let role = ROLE_SET.has(f.role as string)
        ? (f.role as SpecField['role'])
        : 'other';
      if (
        role === 'primary_action' &&
        isIrreversibleLabel(index.byId.get(slot)!.label)
      ) {
        role = 'secondary_action';
        note({ kind: 'irreversible_demoted', id: slot });
      }
      fields.push({
        slot_id: slot,
        role,
        show: SHOW_SET.has(f.show as string)
          ? (f.show as SpecField['show'])
          : 'always',
      });
    }

    let open = typeof c.open_slot === 'string' ? c.open_slot : null;
    if (open !== null) {
      const titleField =
        fields.find((f) => f.slot_id === open)?.role === 'title';
      if (
        !inOwnExemplar(open) ||
        !(activatable(index, open) || (!exemplarHasLink && titleField))
      ) {
        note({ kind: 'field_dropped', list_id: listId, slot_id: open });
        open = null;
      } else if (
        index.byId.get(open)!.role !== 'link' &&
        isIrreversibleLabel(index.byId.get(open)!.label)
      ) {
        // Opening an item must never buy, send or delete (links only navigate).
        note({ kind: 'irreversible_demoted', id: open });
        open = null;
      }
    }

    const itemKind = ITEM_KIND_SET.has(c.item_kind as string)
      ? (c.item_kind as ItemKind)
      : 'other';
    let card = CARD_SET.has(c.card as string)
      ? (c.card as CardStyle)
      : CARD_OF[itemKind];
    if (!cardAllowed(itemKind, card)) {
      card = CARD_OF[itemKind];
      note({ kind: 'card_demoted', list_id: listId });
    }
    // An unknown shape: the kind's default, or no media slot when nothing is a thumbnail.
    const media = MEDIA_SET.has(c.media as string)
      ? (c.media as MediaShape)
      : fields.some((f) => f.role === 'thumbnail')
        ? MEDIA_OF[itemKind] === 'none'
          ? 'square'
          : MEDIA_OF[itemKind]
        : 'none';
    let lead = LEAD_SET.has(c.lead as string) ? (c.lead as LeadMode) : 'none';
    if (lead === 'first' && !leadAllowed(card, pageType)) {
      lead = 'none';
      note({ kind: 'lead_dropped', list_id: listId });
    }
    out.push({
      list_id: listId,
      item_kind: itemKind,
      open_slot: open,
      card,
      media,
      lead,
      fields,
    });
  }
  return out;
}

/** Conservation: maximal subtrees with meaningful content that no section covers. */
function restIds(index: SkeletonIndex, sections: readonly Work[]): string[] {
  const covered = sections.flatMap((s) => s.ids);
  const out: string[] = [];
  for (const r of index.roots)
    out.push(...uncoveredSubtrees(index, r, covered));
  return out;
}
