import { describe, expect, it } from 'vitest';

import type { Skeleton } from '../skeleton/types';
import {
  CARD_OF,
  CARD_STYLES,
  FIELD_ROLES,
  FIELD_SHOW,
  IMPORTANCE,
  ITEM_KINDS,
  LEAD_MODES,
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
  type Importance,
  type PageType,
  type SectionKind,
} from './constants';
import {
  amazon,
  FIXTURE_NAMES,
  inbox,
  meta,
  news,
  SKELETON_FIXTURES,
  wikipedia,
  youtube,
} from './__fixtures__';
import { heuristicSpec } from './heuristic';
import type {
  PageSpec,
  SpecCollection,
  SpecSection,
  ValidatedSpec,
} from './spec';
import {
  indexSkeleton,
  isIrreversibleLabel,
  isMeaningfulNode,
  trustedSlotIssue,
  trustedSlotRoots,
  validateSpec,
  type ValidateSpecContext,
} from './validate';
import { pageSpecSchema } from './wire';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sec(
  kind: SectionKind,
  importance: Importance,
  node_ids: string[],
  heading_ref: string | null = null,
): SpecSection {
  return { kind, importance, node_ids, heading_ref, layout: 'as_is' };
}

function spec(
  sections: SpecSection[],
  collections: SpecCollection[] = [],
  page_type: PageType = 'other',
): PageSpec {
  return {
    v: 1,
    page_type,
    primary_task: 'other',
    sections,
    collections,
  };
}

function clone(sk: Skeleton): Skeleton {
  return structuredClone(sk);
}

function setNode(
  sk: Skeleton,
  id: string,
  patch: Partial<Skeleton['nodes'][number]>,
): Skeleton {
  const out = clone(sk);
  const n = out.nodes.find((x) => x.id === id)!;
  Object.assign(n, patch);
  return out;
}

const PROTECTED: ReadonlySet<SectionKind> = new Set(PROTECTED_SECTION_KINDS);
const TRUSTED: ReadonlySet<SectionKind> = new Set(TRUSTED_SLOT_KINDS);
const CONTENT_KINDS: ReadonlySet<SectionKind> = new Set([
  'main_list',
  'article',
  'product_detail',
  'comments',
  'related',
]);

/**
 * Every guarantee validate.ts makes, checked from the outside. Returns the
 * list of violations (empty when the spec is sound).
 */
function violations(
  v: ValidatedSpec,
  sk: Skeleton,
  ctx: ValidateSpecContext = {},
): string[] {
  const out: string[] = [];
  const ix = indexSkeleton(sk);
  const { sections, collections } = v.spec;

  if (!pageSpecSchema.safeParse(v.spec).success) out.push('schema');
  if (sections.length > SPEC_MAX_SECTIONS) out.push('too many sections');
  if (collections.length > SPEC_MAX_COLLECTIONS)
    out.push('too many collections');

  // Ids: known, not slots, unique, no ancestor/descendant pairs.
  const all = sections.flatMap((s) => s.node_ids);
  if (new Set(all).size !== all.length) out.push('duplicate id');
  for (const s of sections) {
    if (s.node_ids.length === 0 || s.node_ids.length > SPEC_MAX_NODE_IDS)
      out.push(`ids bound ${s.kind}`);
    if (!SECTION_KINDS.includes(s.kind)) out.push('kind enum');
    if (!IMPORTANCE.includes(s.importance)) out.push('importance enum');
    if (!SECTION_LAYOUTS.includes(s.layout)) out.push('layout enum');
  }
  for (const id of all) {
    if (!ix.byId.has(id)) out.push(`unknown ${id}`);
    if (ix.slotOwner.has(id)) out.push(`slot in section ${id}`);
    for (const o of all) {
      if (o !== id && ix.contains(o, id)) out.push(`overlap ${o} ${id}`);
    }
  }

  // Exactly one primary, and `primary` points at it.
  const primaries = sections.filter((s) => s.importance === 'primary');
  if (primaries.length !== 1) out.push(`primaries ${primaries.length}`);
  if (sections[v.primary]?.importance !== 'primary') out.push('primary index');

  // Folding.
  const focus = sk.nodes
    .filter(
      (n) =>
        n.flags.includes('focus') &&
        !(ix.children.get(n.id) ?? []).some((k) =>
          ix.byId.get(k)!.flags.includes('focus'),
        ),
    )
    .map((n) => n.id);
  if (ctx.focusId && ix.byId.has(ctx.focusId)) focus.push(ctx.focusId);
  for (const s of sections) {
    const holds = (pred: (id: string) => boolean): boolean =>
      s.node_ids.some((id) => ix.subtree(id).some(pred));
    if (s.importance === 'fold') {
      if (PROTECTED.has(s.kind)) out.push(`protected folded ${s.kind}`);
      if (
        holds((d) => {
          const n = ix.byId.get(d)!;
          return (
            n.inputType === 'search' ||
            n.role === 'searchbox' ||
            n.role === 'search' ||
            n.flags.includes('consenthint') ||
            ((n.role === 'main' || n.tag === 'main') && !ix.slotOwner.has(d))
          );
        })
      )
        out.push(`protected content folded ${s.kind}`);
    }
    if (
      (s.importance === 'fold' || s.importance === 'tertiary') &&
      focus.some((f) => s.node_ids.some((id) => ix.contains(id, f)))
    )
      out.push('focus folded');
  }

  // Trusted slots.
  const roots = trustedSlotRoots(
    ix,
    sections
      .filter((s) => CONTENT_KINDS.has(s.kind))
      .flatMap((s) => s.node_ids),
  );
  for (const s of sections) {
    if (!TRUSTED.has(s.kind)) continue;
    for (const id of s.node_ids) {
      const issue = trustedSlotIssue(ix, id, { siteHost: ctx.siteHost }, roots);
      if (issue) out.push(`untrusted ${s.kind} ${id} ${issue}`);
    }
  }

  // Headings.
  for (const s of sections) {
    if (s.heading_ref === null) continue;
    const h = ix.byId.get(s.heading_ref);
    if (
      !h ||
      h.kind !== 'heading' ||
      ix.slotOwner.has(h.id) ||
      !s.node_ids.some((id) => ix.contains(id, h.id))
    )
      out.push(`heading ${s.heading_ref}`);
  }

  // Art direction.
  if (sections.filter((s) => s.layout === 'hero').length > 1)
    out.push('two heroes');
  for (const s of sections)
    if (s.layout === 'buy_box' && s.kind !== 'product_detail')
      out.push(`buy_box on ${s.kind}`);

  // Collections.
  const lists = collections.map((c) => c.list_id);
  if (new Set(lists).size !== lists.length) out.push('duplicate list');
  for (const c of collections) {
    const n = ix.byId.get(c.list_id);
    if (!n || n.kind !== 'collection') out.push(`list ${c.list_id}`);
    if (!ITEM_KINDS.includes(c.item_kind)) out.push('item kind enum');
    if (!CARD_STYLES.includes(c.card)) out.push('card enum');
    if (!MEDIA_SHAPES.includes(c.media)) out.push('media enum');
    if (!LEAD_MODES.includes(c.lead)) out.push('lead enum');
    if (c.card === 'chip' && RECORD_ITEM_KINDS.includes(c.item_kind))
      out.push(`chip record ${c.list_id}`);
    if (
      c.lead === 'first' &&
      !(
        (c.card === 'media' || c.card === 'story') &&
        ['feed', 'home_portal', 'channel_or_profile', 'article'].includes(
          v.spec.page_type,
        )
      )
    )
      out.push(`lead ${c.list_id}`);
    if (c.fields.length > SPEC_MAX_FIELDS) out.push('too many fields');
    const slots = c.fields.map((f) => f.slot_id);
    if (new Set(slots).size !== slots.length) out.push('duplicate slot');
    for (const f of c.fields) {
      if (ix.slotList.get(f.slot_id) !== c.list_id)
        out.push(`slot ${f.slot_id} of ${c.list_id}`);
      if (!FIELD_ROLES.includes(f.role)) out.push('role enum');
      if (!FIELD_SHOW.includes(f.show)) out.push('show enum');
      if (
        f.role === 'primary_action' &&
        isIrreversibleLabel(ix.byId.get(f.slot_id)?.label)
      )
        out.push(`irreversible emphasised ${f.slot_id}`);
    }
    if (c.open_slot !== null) {
      const o = ix.byId.get(c.open_slot);
      if (ix.slotList.get(c.open_slot) !== c.list_id)
        out.push(`open ${c.open_slot}`);
      if (o && o.role !== 'link' && isIrreversibleLabel(o.label))
        out.push(`irreversible open ${c.open_slot}`);
    }
  }

  // Conservation: covered ∪ rest = every meaningful node; rest is disjoint from sections.
  const covers = [...all, ...v.rest];
  for (const r of v.rest) {
    if (all.some((id) => ix.contains(id, r) || ix.contains(r, id)))
      out.push(`rest overlaps ${r}`);
    for (const o of v.rest)
      if (o !== r && ix.contains(o, r)) out.push(`rest nested ${r}`);
  }
  for (const n of sk.nodes) {
    if (!isMeaningfulNode(n)) continue;
    if (!covers.some((id) => ix.contains(id, n.id)))
      out.push(`unreachable ${n.id}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Unit behaviour
// ---------------------------------------------------------------------------

describe('validateSpec: ids', () => {
  it('drops unknown and malformed ids and records them', () => {
    const v = validateSpec(
      spec([sec('main_list', 'primary', ['e51', 'e9999', 'x1'])]),
      youtube,
    )!;
    expect(v.spec.sections[0]!.node_ids).toEqual(['e51']);
    expect(v.repairs).toContainEqual({ kind: 'unknown_id', id: 'e9999' });
    expect(v.repairs).toContainEqual({ kind: 'unknown_id', id: 'x1' });
  });

  it('drops duplicate ids, keeping the first use', () => {
    const v = validateSpec(
      spec([
        sec('header', 'secondary', ['e5', 'e5']),
        sec('main_list', 'primary', ['e51', 'e5']),
      ]),
      youtube,
    )!;
    expect(v.spec.sections[0]!.node_ids).toEqual(['e5']);
    expect(v.spec.sections[1]!.node_ids).toEqual(['e51']);
    expect(
      v.repairs.filter((r) => r.kind === 'duplicate_id').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('lifts a slot id to its list: a slot is part of every record, not a region', () => {
    const v = validateSpec(
      spec([sec('main_list', 'primary', ['e56'])]),
      youtube,
    )!;
    expect(v.spec.sections[0]!.node_ids).toEqual(['e51']);
    expect(v.repairs).toContainEqual({
      kind: 'overlap',
      id: 'e56',
      kept: 'e51',
    });
  });

  it('keeps the higher id of an ancestor/descendant pair', () => {
    const v = validateSpec(
      spec([
        sec('header', 'secondary', ['e4']),
        sec('search', 'secondary', ['e11']),
        sec('main_list', 'primary', ['e51']),
      ]),
      youtube,
    )!;
    expect(v.spec.sections.map((s) => s.kind)).toEqual(['header', 'main_list']);
    expect(v.repairs).toContainEqual({
      kind: 'overlap',
      id: 'e11',
      kept: 'e4',
    });
  });

  it('lets a specific id win over an over-broad wrapper (body, banner+main wrappers)', () => {
    const v = validateSpec(
      spec([
        sec('clutter', 'fold', ['e2']),
        sec('main_list', 'primary', ['e51']),
      ]),
      youtube,
    )!;
    expect(v.spec.sections.map((s) => s.node_ids)).toEqual([['e51']]);
    expect(v.repairs).toContainEqual({
      kind: 'overlap',
      id: 'e2',
      kept: 'e51',
    });
    expect(v.rest).toEqual(['e3', 'e20', 'e24', 'e48']);
  });

  it('returns null when no section survives', () => {
    expect(
      validateSpec(spec([sec('main_list', 'primary', ['e9999'])]), youtube),
    ).toBeNull();
    expect(validateSpec(spec([]), youtube)).toBeNull();
    expect(
      validateSpec(spec([sec('main_list', 'primary', ['e1'])]), {
        ...youtube,
        nodes: [],
      }),
    ).toBeNull();
  });
});

describe('validateSpec: one primary', () => {
  it('keeps the best of several primaries (content kind, in main, largest)', () => {
    const v = validateSpec(
      spec([
        sec('header', 'primary', ['e5']),
        sec('page_heading', 'primary', ['e25']),
        sec('main_list', 'primary', ['e51']),
      ]),
      youtube,
    )!;
    expect(v.spec.sections[v.primary]!.node_ids).toEqual(['e51']);
    expect(
      v.spec.sections.filter((s) => s.importance === 'primary'),
    ).toHaveLength(1);
    expect(v.repairs).toContainEqual({ kind: 'primary_fixed', from: 0, to: 2 });
  });

  it('falls back to the main landmark when no section is primary', () => {
    const v = validateSpec(
      spec([sec('header', 'secondary', ['e3'])]),
      youtube,
    )!;
    const p = v.spec.sections[v.primary]!;
    expect(p.node_ids).toEqual(['e23']);
    expect(p.kind).toBe('main_list');
    expect(v.repairs).toContainEqual({
      kind: 'primary_fixed',
      from: -1,
      to: 1,
    });
  });

  it('builds the primary from main around sections already inside it', () => {
    const v = validateSpec(
      spec([
        sec('header', 'secondary', ['e2']),
        sec('page_heading', 'secondary', ['e26']),
        sec('legal', 'tertiary', ['e222']),
      ]),
      wikipedia,
    )!;
    const p = v.spec.sections[v.primary]!;
    expect(p.kind).toBe('article');
    expect(p.node_ids).toContain('e51');
    expect(p.node_ids).not.toContain('e26');
    expect(violations(v, wikipedia)).toEqual([]);
  });

  it('falls back to the largest record list on a page without a main landmark', () => {
    const v = validateSpec(spec([sec('header', 'secondary', ['e6'])]), amazon)!;
    expect(v.spec.sections[v.primary]!.node_ids).toEqual(['e44']);
  });

  it('promotes the covering section when main sits inside a section', () => {
    const v = validateSpec(
      spec([sec('ads', 'fold', ['e23']), sec('header', 'secondary', ['e3'])]),
      youtube,
    )!;
    const p = v.spec.sections[v.primary]!;
    expect(p.node_ids).toEqual(['e23']);
    expect(p.kind).toBe('main_list');
    expect(p.importance).toBe('primary');
  });
});

describe('validateSpec: folding', () => {
  it('never folds a protected kind', () => {
    for (const kind of PROTECTED_SECTION_KINDS) {
      const v = validateSpec(
        spec([
          sec(kind, 'fold', ['e10']),
          sec('main_list', 'primary', ['e51']),
        ]),
        youtube,
      )!;
      const s = v.spec.sections.find((x) => x.node_ids.includes('e10'));
      expect(s?.importance, kind).toBe('tertiary');
      expect(v.repairs).toContainEqual({
        kind: 'protected_unfolded',
        section: 0,
      });
    }
  });

  it('never folds search, consent or main content mislabelled as clutter', () => {
    const v = validateSpec(
      spec([
        sec('clutter', 'fold', ['e10']),
        sec('main_list', 'primary', ['e51']),
      ]),
      youtube,
    )!;
    expect(v.spec.sections[0]!.importance).toBe('tertiary');
    const g = validateSpec(
      spec([sec('ads', 'fold', ['e101']), sec('article', 'primary', ['e15'])]),
      news,
    )!;
    expect(
      g.spec.sections.find((s) => s.node_ids.includes('e101'))!.importance,
    ).toBe('tertiary');
  });

  it('never folds the section holding focus (flag or context)', () => {
    const focused = setNode(youtube, 'e60', { flags: ['icon', 'focus'] });
    const v = validateSpec(
      spec([
        sec('main_list', 'primary', ['e51']),
        sec('clutter', 'fold', ['e48']),
      ]),
      setNode(focused, 'e50', { flags: ['focus'] }),
    )!;
    expect(v.spec.sections[1]!.importance).toBe('secondary');
    expect(v.repairs).toContainEqual({ kind: 'focus_unfolded', section: 1 });

    const w = validateSpec(
      spec([
        sec('main_list', 'primary', ['e51']),
        sec('footer', 'tertiary', ['e20']),
      ]),
      youtube,
      { focusId: 'e22' },
    )!;
    expect(w.spec.sections[1]!.importance).toBe('secondary');
  });
});

describe('validateSpec: trusted slots', () => {
  it('moves a user-posted "Sign in" out of the account strip', () => {
    // News: "Sign in to comment" sits in the comments region.
    const v = validateSpec(
      spec([
        sec('account_and_cart', 'secondary', ['e11', 'e63']),
        sec('article', 'primary', ['e16']),
      ]),
      news,
    )!;
    const account = v.spec.sections.find((s) => s.kind === 'account_and_cart')!;
    expect(account.node_ids).toEqual(['e11']);
    const other = v.spec.sections.find((s) => s.node_ids.includes('e63'))!;
    expect(other.kind).toBe('other');
    expect(v.repairs).toContainEqual({
      kind: 'untrusted_slot',
      section: v.spec.sections.indexOf(account),
      id: 'e63',
    });
  });

  it('moves anything inside records or main out of the strip', () => {
    const v = validateSpec(
      spec([
        sec('search', 'secondary', ['e10', 'e45']),
        sec('main_list', 'primary', ['e51']),
      ]),
      youtube,
    )!;
    // e45 is a slot (lifted to its list e44, inside main): never the site's search.
    expect(v.spec.sections.find((s) => s.kind === 'search')!.node_ids).toEqual([
      'e10',
    ]);
  });

  it('splits a header around an off-site link instead of evicting all of it', () => {
    // Wikipedia's banner: "Personal tools" holds an off-site Donate link.
    const v = validateSpec(
      spec([
        sec('header', 'secondary', ['e2']),
        sec('article', 'primary', ['e53']),
      ]),
      wikipedia,
    )!;
    const header = v.spec.sections.find((s) => s.kind === 'header')!;
    expect(header.node_ids).toEqual(['e3', 'e8']);
    const moved = v.spec.sections.find((s) => s.kind === 'other')!;
    expect(moved.node_ids).toEqual(['e13']);
    expect(violations(v, wikipedia)).toEqual([]);
  });

  it('splits an over-broad header that swallowed the page', () => {
    const v = validateSpec(spec([sec('header', 'primary', ['e1'])]), youtube)!;
    const header = v.spec.sections.find((s) => s.kind === 'header')!;
    expect(header.node_ids).toEqual(['e3', 'e20']);
    expect(header.importance).toBe('secondary');
    // The page content it held keeps the primary role.
    const content = v.spec.sections.find((s) => s.node_ids.includes('e23'))!;
    expect(content.importance).toBe('primary');
    expect(content.kind).toBe('main_list');
    expect(violations(v, youtube)).toEqual([]);
  });

  it('rejects position: chrome-looking controls far down the page', () => {
    const ix = indexSkeleton(amazon);
    // Amazon's footer "Back to top" button: outside banner/nav and far below.
    expect(trustedSlotIssue(ix, 'e96')).toBe('position');
    expect(trustedSlotIssue(ix, 'e9')).toBeNull();
    expect(trustedSlotIssue(ix, 'e13')).toBeNull();
  });

  it('lets a sign-in link to a known identity provider into the account and header slots only (m5)', () => {
    const sk = structuredClone(youtube);
    const signIn = sk.nodes.find((n) => n.label === 'Sign in')!;
    signIn.href = 'other';
    const ix = indexSkeleton(sk);
    expect(trustedSlotIssue(ix, signIn.id)).toBe('link');
    signIn.idp = true;
    const iy = indexSkeleton(sk);
    expect(
      trustedSlotIssue(iy, signIn.id, { sectionKind: 'account_and_cart' }),
    ).toBeNull();
    expect(
      trustedSlotIssue(iy, signIn.id, { sectionKind: 'header' }),
    ).toBeNull();
    expect(trustedSlotIssue(iy, signIn.id, { sectionKind: 'search' })).toBe(
      'link',
    );
    expect(trustedSlotIssue(iy, signIn.id)).toBe('link');
  });

  it('treats every link as off-site when the tab has no site', () => {
    const ix = indexSkeleton(youtube);
    expect(trustedSlotIssue(ix, 'e17')).toBeNull();
    expect(trustedSlotIssue(ix, 'e17', { siteHost: null })).toBe('link');
    expect(trustedSlotIssue(ix, 'e10', { siteHost: null })).toBeNull();
  });
});

describe('validateSpec: headings and collections', () => {
  it('keeps heading_ref only for a heading inside the section', () => {
    const v = validateSpec(
      spec([
        sec('page_heading', 'secondary', ['e25'], 'e30'),
        sec('main_list', 'primary', ['e51'], 'e30'),
        sec('tabs', 'secondary', ['e42'], 'e56'),
        sec('header', 'secondary', ['e5'], 'e6'),
      ]),
      youtube,
    )!;
    expect(v.spec.sections.map((s) => s.heading_ref)).toEqual([
      'e30',
      null,
      null,
      null,
    ]);
  });

  it('drops collections that are not lists and fields outside their own exemplar', () => {
    const v = validateSpec(
      spec(
        [sec('main_list', 'primary', ['e44'])],
        [
          {
            list_id: 'e45',
            item_kind: 'product',
            open_slot: null,
            card: 'tile',
            media: 'none',
            lead: 'none',
            fields: [],
          },
          {
            list_id: 'e44',
            item_kind: 'product',
            open_slot: 'e50',
            card: 'tile',
            media: 'none',
            lead: 'none',
            fields: [
              { slot_id: 'e50', role: 'title', show: 'always' },
              { slot_id: 'e50', role: 'link', show: 'always' },
              { slot_id: 'e93', role: 'link', show: 'always' }, // another list's slot
              { slot_id: 'e44', role: 'other', show: 'always' }, // the list itself
              { slot_id: 'e9999', role: 'other', show: 'always' },
            ],
          },
          {
            list_id: 'e44',
            item_kind: 'product',
            open_slot: null,
            card: 'tile',
            media: 'none',
            lead: 'none',
            fields: [],
          },
        ],
      ),
      amazon,
    )!;
    expect(v.spec.collections).toEqual([
      {
        list_id: 'e44',
        item_kind: 'product',
        open_slot: 'e50',
        card: 'tile',
        media: 'none',
        lead: 'none',
        fields: [{ slot_id: 'e50', role: 'title', show: 'always' }],
      },
    ]);
    expect(v.repairs).toContainEqual({
      kind: 'collection_dropped',
      list_id: 'e45',
    });
    expect(v.repairs).toContainEqual({
      kind: 'field_dropped',
      list_id: 'e44',
      slot_id: 'e93',
    });
  });

  it('drops slots of a nested list from the outer list', () => {
    const v = validateSpec(
      spec(
        [
          sec('filters', 'secondary', ['e88']),
          sec('main_list', 'primary', ['e44']),
        ],
        [
          {
            list_id: 'e88',
            item_kind: 'filter_option',
            open_slot: 'e93',
            card: 'chip',
            media: 'none',
            lead: 'none',
            fields: [
              { slot_id: 'e90', role: 'label', show: 'always' },
              { slot_id: 'e92', role: 'link', show: 'always' },
              { slot_id: 'e93', role: 'link', show: 'always' },
            ],
          },
          {
            list_id: 'e92',
            item_kind: 'filter_option',
            open_slot: 'e93',
            card: 'chip',
            media: 'none',
            lead: 'none',
            fields: [{ slot_id: 'e93', role: 'link', show: 'always' }],
          },
        ],
      ),
      amazon,
    )!;
    const outer = v.spec.collections.find((c) => c.list_id === 'e88')!;
    expect(outer.fields.map((f) => f.slot_id)).toEqual(['e90', 'e92']);
    expect(outer.open_slot).toBeNull();
    const inner = v.spec.collections.find((c) => c.list_id === 'e92')!;
    expect(inner.open_slot).toBe('e93');
  });

  it('never emphasises an irreversible action and never opens an item with one', () => {
    const sk = setNode(amazon, 'e66', { label: 'Buy Now', role: 'button' });
    const v = validateSpec(
      spec(
        [sec('main_list', 'primary', ['e44'])],
        [
          {
            list_id: 'e44',
            item_kind: 'product',
            open_slot: 'e66',
            card: 'tile',
            media: 'none',
            lead: 'none',
            fields: [
              { slot_id: 'e66', role: 'primary_action', show: 'always' },
            ],
          },
        ],
      ),
      sk,
    )!;
    const c = v.spec.collections[0]!;
    expect(c.fields[0]!.role).toBe('secondary_action');
    expect(c.open_slot).toBeNull();
    expect(v.repairs).toContainEqual({
      kind: 'irreversible_demoted',
      id: 'e66',
    });
  });

  it('accepts a title text as the opener of rows that have no links (webmail)', () => {
    const v = validateSpec(
      spec(
        [sec('main_list', 'primary', ['e42'])],
        [
          {
            list_id: 'e42',
            item_kind: 'message',
            open_slot: 'e48',
            card: 'message',
            media: 'none',
            lead: 'none',
            fields: [{ slot_id: 'e48', role: 'title', show: 'always' }],
          },
        ],
      ),
      inbox,
    )!;
    expect(v.spec.collections[0]!.open_slot).toBe('e48');
    // A non-title text is not an opener.
    const w = validateSpec(
      spec(
        [sec('main_list', 'primary', ['e42'])],
        [
          {
            list_id: 'e42',
            item_kind: 'message',
            open_slot: 'e50',
            card: 'message',
            media: 'none',
            lead: 'none',
            fields: [{ slot_id: 'e50', role: 'timestamp', show: 'always' }],
          },
        ],
      ),
      inbox,
    )!;
    expect(w.spec.collections[0]!.open_slot).toBeNull();
  });
});

describe('validateSpec: art direction', () => {
  const video = (extra: Partial<SpecCollection> = {}): SpecCollection => ({
    list_id: 'e51',
    item_kind: 'video',
    open_slot: 'e56',
    card: 'media',
    media: 'landscape',
    lead: 'none',
    fields: [
      { slot_id: 'e53', role: 'thumbnail', show: 'always' },
      { slot_id: 'e56', role: 'title', show: 'always' },
    ],
    ...extra,
  });
  const at = (layout: SpecSection['layout'], s: SpecSection): SpecSection => ({
    ...s,
    layout,
  });

  it('keeps one hero: the page heading, else the first', () => {
    const v = validateSpec(
      spec([
        at('hero', sec('main_list', 'primary', ['e51'])),
        at('hero', sec('page_heading', 'secondary', ['e25'], 'e30')),
        at('hero', sec('tabs', 'secondary', ['e42'])),
      ]),
      youtube,
    )!;
    expect(v.spec.sections.map((s) => s.layout)).toEqual([
      'row_list',
      'hero',
      'chip_bar',
    ]);
    expect(v.repairs).toEqual(
      expect.arrayContaining([
        { kind: 'hero_demoted', section: 0 },
        { kind: 'hero_demoted', section: 2 },
      ]),
    );
    // Two promo heroes: the first stays, the second becomes a spotlight.
    const w = validateSpec(
      spec([
        at('hero', sec('promo_hero', 'secondary', ['e25'])),
        at('hero', sec('promo_hero', 'primary', ['e51'])),
      ]),
      youtube,
    )!;
    expect(w.spec.sections.map((s) => s.layout)).toEqual(['hero', 'spotlight']);
    expect(w.repairs).toContainEqual({ kind: 'hero_demoted', section: 1 });
  });

  it('allows buy_box only on a product_detail section', () => {
    const v = validateSpec(
      spec([
        at('buy_box', sec('main_list', 'primary', ['e44'])),
        at('buy_box', sec('product_detail', 'secondary', ['e41'])),
      ]),
      amazon,
    )!;
    expect(v.spec.sections.map((s) => s.layout)).toEqual([
      'reading',
      'buy_box',
    ]);
    expect(v.repairs).toContainEqual({ kind: 'buy_box_demoted', section: 0 });
    expect(v.repairs.filter((r) => r.kind === 'buy_box_demoted')).toHaveLength(
      1,
    );
  });

  it('never draws records as chips', () => {
    const v = validateSpec(
      spec(
        [at('card_grid', sec('main_list', 'primary', ['e51']))],
        [video({ card: 'chip' })],
      ),
      youtube,
    )!;
    expect(v.spec.collections[0]!.card).toBe('media');
    expect(v.repairs).toContainEqual({ kind: 'card_demoted', list_id: 'e51' });
    // Tabs may be chips, or links.
    const tabs = validateSpec(
      spec(
        [at('chip_bar', sec('tabs', 'primary', ['e42']))],
        [
          {
            list_id: 'e44',
            item_kind: 'tab',
            open_slot: null,
            card: 'chip',
            media: 'none',
            lead: 'none',
            fields: [],
          },
        ],
      ),
      youtube,
    )!;
    expect(tabs.spec.collections[0]!.card).toBe('chip');
    expect(tabs.repairs.some((r) => r.kind === 'card_demoted')).toBe(false);
  });

  it('lets the first record lead only for media and story cards on feeds, portals, channels and articles', () => {
    const lead = (page: PageType, c: SpecCollection) => {
      const v = validateSpec(
        spec(
          [at('card_grid', sec('main_list', 'primary', ['e51']))],
          [c],
          page,
        ),
        youtube,
      )!;
      return {
        lead: v.spec.collections[0]!.lead,
        dropped: v.repairs.some((r) => r.kind === 'lead_dropped'),
      };
    };
    for (const page of [
      'feed',
      'home_portal',
      'channel_or_profile',
      'article',
    ] as const) {
      expect(lead(page, video({ lead: 'first' })), page).toEqual({
        lead: 'first',
        dropped: false,
      });
      expect(lead(page, video({ lead: 'first', card: 'story' })), page).toEqual(
        { lead: 'first', dropped: false },
      );
      expect(lead(page, video({ lead: 'first', card: 'tile' })), page).toEqual({
        lead: 'none',
        dropped: true,
      });
    }
    for (const page of [
      'search_results',
      'listing_grid',
      'product_detail',
      'inbox_or_messages',
      'other',
    ] as const)
      expect(lead(page, video({ lead: 'first' })), page).toEqual({
        lead: 'none',
        dropped: true,
      });
  });

  it('coerces unknown values to the kind defaults without a repair', () => {
    const v = validateSpec(
      spec(
        [
          at('grid' as 'hero', sec('main_list', 'primary', ['e51'])),
          at('compact_row' as 'hero', sec('tabs', 'secondary', ['e42'])),
          at(
            'single_column' as 'hero',
            sec('page_heading', 'secondary', ['e25'], 'e30'),
          ),
        ],
        [
          video({ card: 'grid' as 'tile', media: 'wide' as 'none' }),
          {
            list_id: 'e44',
            item_kind: 'tab',
            open_slot: null,
            card: undefined as unknown as 'chip',
            media: undefined as unknown as 'none',
            lead: undefined as unknown as 'none',
            fields: [],
          },
        ],
      ),
      youtube,
    )!;
    // A list section whose layout the validator chose is a grid of its cards.
    expect(v.spec.sections.map((s) => s.layout)).toEqual([
      'card_grid',
      'chip_bar',
      'hero',
    ]);
    expect(
      v.spec.collections.map(({ list_id, card, media, lead }) => ({
        list_id,
        card,
        media,
        lead,
      })),
    ).toEqual([
      // A thumbnail slot: the video's 16:9.
      { list_id: 'e51', card: 'media', media: 'landscape', lead: 'none' },
      // No thumbnail slot: no media.
      { list_id: 'e44', card: CARD_OF.tab, media: 'none', lead: 'none' },
    ]);
    expect(
      v.repairs.filter((r) =>
        [
          'hero_demoted',
          'buy_box_demoted',
          'card_demoted',
          'lead_dropped',
        ].includes(r.kind),
      ),
    ).toEqual([]);
  });

  it('gives a primary section it makes the layout its records need', () => {
    // No primary claimed: the validator promotes main's list.
    const v = validateSpec(
      spec(
        [
          sec('header', 'secondary', ['e5']),
          at('hero', sec('page_heading', 'secondary', ['e25'], 'e30')),
        ],
        [video()],
      ),
      youtube,
    )!;
    const p = v.spec.sections[v.primary]!;
    expect(p.kind).toBe('main_list');
    expect(p.layout).toBe('card_grid');
  });

  it('round-trips every heuristic spec, art direction included', () => {
    for (const name of FIXTURE_NAMES) {
      const sk = SKELETON_FIXTURES[name];
      const h = heuristicSpec(sk);
      const v = validateSpec(h, sk)!;
      expect(v.spec.collections, name).toEqual(h.collections);
      expect(
        v.spec.sections.map((s) => s.layout),
        name,
      ).toEqual(h.sections.map((s) => s.layout));
    }
    expect(heuristicSpec(meta).collections.length).toBeGreaterThan(0);
  });
});

describe('validateSpec: conservation', () => {
  it('lists everything the spec leaves out under rest', () => {
    const v = validateSpec(
      spec([sec('main_list', 'primary', ['e51'])]),
      youtube,
    )!;
    expect(v.rest).toEqual(['e3', 'e20', 'e24', 'e48']);
    expect(v.repairs).toContainEqual({ kind: 'rest_added', ids: 4 });
    expect(violations(v, youtube)).toEqual([]);
  });

  it('heuristic specs need no repair and leave nothing out on every fixture', () => {
    for (const name of FIXTURE_NAMES) {
      const sk = SKELETON_FIXTURES[name];
      const v = validateSpec(heuristicSpec(sk), sk);
      expect(v, name).not.toBeNull();
      expect(v!.repairs, name).toEqual([]);
      expect(v!.rest, name).toEqual([]);
      expect(violations(v!, sk), name).toEqual([]);
    }
  });

  it('is idempotent: a validated spec validates to itself', () => {
    for (const name of FIXTURE_NAMES) {
      const sk = SKELETON_FIXTURES[name];
      const once = validateSpec(
        spec([
          sec('header', 'primary', ['e2', 'e3', 'e4']),
          sec('clutter', 'fold', ['e5', 'e6', 'e7', 'e9999']),
        ]),
        sk,
      )!;
      const twice = validateSpec(once.spec, sk)!;
      expect(twice.spec, name).toEqual(once.spec);
      expect(
        twice.repairs.filter((r) => r.kind !== 'rest_added'),
        name,
      ).toEqual([]);
      expect(twice.rest, name).toEqual(once.rest);
    }
  });
});

describe('isIrreversibleLabel', () => {
  it('matches actions that cannot be taken back, as whole words', () => {
    for (const l of [
      'Buy now',
      'Buy Now',
      'Place your order',
      'Send',
      'Send message',
      'Delete',
      'Delete forever',
      'Pay',
      'Pay now',
      'Proceed to checkout',
      'Jetzt kaufen',
      'Supprimer',
      'Eliminar',
    ])
      expect(isIrreversibleLabel(l), l).toBe(true);
    for (const l of [
      'Add to cart',
      'Payment history',
      'Sender',
      'Subscribe',
      'Archive',
      'Paste',
      'Senders',
      '',
      undefined,
    ])
      expect(isIrreversibleLabel(l), String(l)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fuzz: random specs never break the guarantees
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length)]!;
}

function randomSpec(rand: () => number, sk: Skeleton): PageSpec {
  const ids = sk.nodes.map((n) => n.id);
  const lists = sk.nodes
    .filter((n) => n.kind === 'collection')
    .map((n) => n.id);
  const headings = sk.nodes
    .filter((n) => n.kind === 'heading')
    .map((n) => n.id);
  const anyId = (): string => {
    const r = rand();
    if (r < 0.04) return 'e9999';
    if (r < 0.06) return 'nope';
    return pick(rand, ids);
  };
  const sections: SpecSection[] = [];
  const nSections = 1 + Math.floor(rand() * 26);
  for (let i = 0; i < nSections; i++) {
    const n = 1 + Math.floor(rand() * (rand() < 0.1 ? 45 : 5));
    sections.push({
      kind:
        rand() < 0.02 ? ('bogus' as SectionKind) : pick(rand, SECTION_KINDS),
      importance: pick(rand, IMPORTANCE),
      node_ids: Array.from({ length: n }, anyId),
      heading_ref:
        rand() < 0.4
          ? null
          : rand() < 0.6 && headings.length
            ? pick(rand, headings)
            : anyId(),
      layout: rand() < 0.02 ? ('grid' as 'hero') : pick(rand, SECTION_LAYOUTS),
    });
  }
  const collections: SpecCollection[] = [];
  const nCollections = Math.floor(rand() * 18);
  for (let i = 0; i < nCollections; i++) {
    const list = rand() < 0.8 && lists.length ? pick(rand, lists) : anyId();
    collections.push({
      list_id: list,
      item_kind: pick(rand, ITEM_KINDS),
      open_slot: rand() < 0.3 ? null : anyId(),
      card: rand() < 0.05 ? ('bogus' as 'tile') : pick(rand, CARD_STYLES),
      media: rand() < 0.05 ? ('bogus' as 'none') : pick(rand, MEDIA_SHAPES),
      lead: rand() < 0.05 ? ('bogus' as 'none') : pick(rand, LEAD_MODES),
      fields: Array.from({ length: Math.floor(rand() * 18) }, () => ({
        slot_id: anyId(),
        role: pick(rand, FIELD_ROLES),
        show: pick(rand, FIELD_SHOW),
      })),
    });
  }
  return {
    v: 1,
    page_type: pick(rand, PAGE_TYPES),
    primary_task: pick(rand, PRIMARY_TASKS),
    sections,
    collections,
  };
}

/** Mutate a heuristic spec the way a planner can get things wrong. */
function mutatedSpec(rand: () => number, sk: Skeleton): PageSpec {
  const base = heuristicSpec(sk);
  const ids = sk.nodes.map((n) => n.id);
  for (const s of base.sections) {
    const r = rand();
    if (r < 0.15) s.importance = 'fold';
    else if (r < 0.25) s.importance = 'primary';
    else if (r < 0.35) s.kind = pick(rand, TRUSTED_SLOT_KINDS);
    else if (r < 0.45) s.node_ids.push(pick(rand, ids));
    else if (r < 0.5) s.heading_ref = pick(rand, ids);
    else if (r < 0.6) s.layout = pick(rand, SECTION_LAYOUTS);
  }
  for (const c of base.collections) {
    const r = rand();
    if (r < 0.15) c.card = pick(rand, CARD_STYLES);
    else if (r < 0.3) c.lead = 'first';
    else if (r < 0.4) c.media = pick(rand, MEDIA_SHAPES);
  }
  if (rand() < 0.3)
    base.sections.push(sec('header', 'primary', [pick(rand, ids)]));
  return base;
}

describe('validateSpec: fuzz', () => {
  it('random specs never violate the invariants on any fixture', () => {
    const rand = rng(20261015);
    let checked = 0;
    for (const name of FIXTURE_NAMES) {
      for (let i = 0; i < 160; i++) {
        let sk = SKELETON_FIXTURES[name];
        const ctx: ValidateSpecContext = {};
        if (rand() < 0.3) {
          const victim = pick(rand, sk.nodes);
          sk = setNode(sk, victim.id, { flags: [...victim.flags, 'focus'] });
        }
        if (rand() < 0.2) ctx.focusId = pick(rand, sk.nodes).id;
        if (rand() < 0.1) ctx.siteHost = null;
        const input =
          rand() < 0.5 ? randomSpec(rand, sk) : mutatedSpec(rand, sk);
        const v = validateSpec(input, sk, ctx);
        if (v === null) continue;
        const bad = violations(v, sk, ctx);
        expect(bad, `${name} #${i}`).toEqual([]);
        // A second pass changes nothing.
        const again = validateSpec(v.spec, sk, ctx)!;
        expect(again.spec, `${name} #${i} idempotent`).toEqual(v.spec);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(900);
  });
});
