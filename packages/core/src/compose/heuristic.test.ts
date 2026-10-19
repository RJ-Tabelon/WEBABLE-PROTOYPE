import { describe, expect, it } from 'vitest';

import type { RegionRole } from '../page/constants';
import type {
  SkelFlag,
  SkelKind,
  SkelRole,
  SkelTag,
} from '../skeleton/constants';
import type { Skeleton } from '../skeleton/types';
import {
  CARD_OF,
  GRID_CARDS,
  RECORD_ITEM_KINDS,
  type SectionKind,
} from './constants';
import {
  amazon,
  buildSkeleton,
  FIXTURE_NAMES,
  govuk,
  inbox,
  meta,
  news,
  SKELETON_FIXTURES,
  wikipedia,
  youtube,
  type FxNode,
} from './__fixtures__';
import { heuristicSpec, type HeuristicContext } from './heuristic';
import type { PageSpec, SpecCollection, SpecSection } from './spec';
import { indexSkeleton, validateSpec } from './validate';
import { pageSpecSchema } from './wire';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The section whose subtree covers `id`. */
function sectionOf(sk: Skeleton, spec: PageSpec, id: string): SpecSection {
  const ix = indexSkeleton(sk);
  const s = spec.sections.find((x) =>
    x.node_ids.some((n) => ix.contains(n, id)),
  );
  if (!s) throw new Error(`${id} is in no section`);
  return s;
}

function kindOf(sk: Skeleton, spec: PageSpec, id: string): SectionKind {
  return sectionOf(sk, spec, id).kind;
}

function primaryOf(spec: PageSpec): SpecSection {
  const p = spec.sections.filter((s) => s.importance === 'primary');
  expect(p).toHaveLength(1);
  return p[0]!;
}

function list(spec: PageSpec, id: string): SpecCollection {
  const c = spec.collections.find((x) => x.list_id === id);
  if (!c) throw new Error(`no collection ${id}`);
  return c;
}

function roleOf(c: SpecCollection, slot: string): string | undefined {
  return c.fields.find((f) => f.slot_id === slot)?.role;
}

function expectNotFolded(sk: Skeleton, spec: PageSpec, ids: string[]): void {
  for (const id of ids) {
    expect(sectionOf(sk, spec, id).importance, id).not.toBe('fold');
  }
}

const NEWS_VERDICTS: Record<string, RegionRole> = {
  cnewsmostread: 'recommendations',
  cnewspaywallbar: 'promo_ad',
  cnewschat: 'chat_widget',
};

// ---------------------------------------------------------------------------
// Fixtures line up with the probe outlines
// ---------------------------------------------------------------------------

describe('fixtures', () => {
  it('keep the probe ids, so ground truth written against the outlines applies', () => {
    const node = (sk: Skeleton, id: string) =>
      sk.nodes.find((n) => n.id === id)!;
    expect(node(youtube, 'e19').label).toBe('Sign in');
    expect(node(youtube, 'e51').collection).toEqual({
      count: 60,
      itemTag: 'custom',
      exemplar: 'e52',
    });
    expect(node(youtube, 'e56').slot).toBe(true);
    expect(node(amazon, 'e9').role).toBe('search');
    expect(node(amazon, 'e44').collection?.count).toBe(48);
    expect(node(wikipedia, 'e27')).toMatchObject({ kind: 'heading', level: 1 });
    expect(node(wikipedia, 'e53').parent).toBe('e51');
    expect(node(meta, 'e32').collection?.count).toBe(4);
    expect(youtube.nodes).toHaveLength(60);
    expect(amazon.nodes).toHaveLength(138);
    expect(meta.nodes).toHaveLength(153);
    expect(wikipedia.nodes).toHaveLength(226);
  });

  it('are well-formed skeletons: unique ids, parents first, slots under their list', () => {
    for (const name of FIXTURE_NAMES) {
      const sk = SKELETON_FIXTURES[name];
      const seen = new Set<string>();
      for (const n of sk.nodes) {
        expect(seen.has(n.id), `${name} ${n.id}`).toBe(false);
        if (n.parent !== null)
          expect(seen.has(n.parent), `${name} ${n.id}`).toBe(true);
        seen.add(n.id);
        if (n.kind === 'collection') {
          const ex = sk.nodes.find((m) => m.id === n.collection!.exemplar)!;
          expect(ex.parent, `${name} ${n.id}`).toBe(n.id);
          expect(ex.slot, `${name} ${ex.id}`).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Every fixture: a valid spec with a sensible primary
// ---------------------------------------------------------------------------

describe('heuristicSpec on every fixture', () => {
  it('validates with no repair, leaves nothing out and parses with the wire schema', () => {
    for (const name of FIXTURE_NAMES) {
      const sk = SKELETON_FIXTURES[name];
      const spec = heuristicSpec(sk);
      expect(pageSpecSchema.safeParse(spec).success, name).toBe(true);
      const v = validateSpec(spec, sk);
      expect(v, name).not.toBeNull();
      expect(v!.repairs, name).toEqual([]);
      expect(v!.rest, name).toEqual([]);
      expect(v!.spec, name).toEqual(spec);
      expect(spec.sections.length, name).toBeLessThanOrEqual(24);
    }
  });

  it('is deterministic and leaves the skeleton untouched', () => {
    for (const name of FIXTURE_NAMES) {
      const sk = SKELETON_FIXTURES[name];
      const before = JSON.stringify(sk);
      const a = heuristicSpec(sk, { verdicts: NEWS_VERDICTS });
      const b = heuristicSpec(structuredClone(sk), { verdicts: NEWS_VERDICTS });
      expect(a, name).toEqual(b);
      expect(JSON.stringify(sk), name).toBe(before);
    }
  });

  it('runs in under 5 ms per fixture', () => {
    for (const name of FIXTURE_NAMES) heuristicSpec(SKELETON_FIXTURES[name]);
    for (const name of FIXTURE_NAMES) {
      const sk = SKELETON_FIXTURES[name];
      const times: number[] = [];
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        heuristicSpec(sk);
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      expect(times[3]!, name).toBeLessThan(5);
    }
  });
});

describe('heuristicSpec: art direction (docs/12 §6)', () => {
  it('keeps the validator rules on every fixture', () => {
    for (const name of FIXTURE_NAMES) {
      const spec = heuristicSpec(SKELETON_FIXTURES[name]);
      const heroes = spec.sections.filter((s) => s.layout === 'hero');
      expect(heroes.length, name).toBeLessThanOrEqual(1);
      for (const s of spec.sections)
        if (s.layout === 'buy_box') expect(s.kind, name).toBe('product_detail');
      for (const c of spec.collections) {
        expect(c.card, `${name} ${c.list_id}`).toBe(CARD_OF[c.item_kind]);
        if (RECORD_ITEM_KINDS.includes(c.item_kind))
          expect(c.card, `${name} ${c.list_id}`).not.toBe('chip');
        // A media shape exactly when a slot is the thumbnail.
        expect(c.media === 'none', `${name} ${c.list_id}`).toBe(
          !c.fields.some((f) => f.role === 'thumbnail'),
        );
        if (c.lead === 'first') {
          expect(['media', 'story']).toContain(c.card);
          expect([
            'feed',
            'home_portal',
            'channel_or_profile',
            'article',
          ]).toContain(spec.page_type);
        }
      }
    }
  });

  it('draws the page heading as the hero and lists of cards as grids', () => {
    for (const [sk, id] of [
      [youtube, 'e30'],
      [wikipedia, 'e27'],
      [meta, 'e22'],
    ] as const)
      expect(sectionOf(sk, heuristicSpec(sk), id).layout).toBe('hero');
    const yt = heuristicSpec(youtube);
    expect(list(yt, 'e51')).toMatchObject({
      card: 'media',
      media: 'landscape',
      lead: 'first',
    });
    expect(list(yt, 'e44')).toMatchObject({ card: 'chip', media: 'none' });
    const az = heuristicSpec(amazon);
    expect(primaryOf(az).layout).toBe('card_grid');
    // Search results keep the site's ranking: no record leads.
    expect(list(az, 'e44')).toMatchObject({
      card: 'tile',
      media: 'square',
      lead: 'none',
    });
    expect(GRID_CARDS).toContain(list(az, 'e44').card);
  });

  it('draws text records as rows', () => {
    const mail = heuristicSpec(inbox);
    expect(primaryOf(mail).layout).toBe('row_list');
    expect(list(mail, 'e42')).toMatchObject({
      card: 'message',
      media: 'none',
      lead: 'none',
    });
    const wiki = heuristicSpec(wikipedia);
    expect(list(wiki, 'e196')).toMatchObject({ card: 'row', media: 'none' });
    expect(primaryOf(wiki).layout).toBe('reading');
  });

  it('sizes navigation, filters and the footer', () => {
    const az = heuristicSpec(amazon);
    expect(sectionOf(amazon, az, 'e88').layout).toBe('menu');
    expect(sectionOf(amazon, az, 'e37').layout).toBe('chip_bar');
    expect(sectionOf(amazon, az, 'e73').layout).toBe('chip_bar');
    expect(sectionOf(amazon, az, 'e97').layout).toBe('link_grid');
    expect(sectionOf(amazon, az, 'e121').layout).toBe('link_grid');
    const wiki = heuristicSpec(wikipedia);
    // The long contents list sits above the article: a menu.
    expect(sectionOf(wikipedia, wiki, 'e16').layout).toBe('menu');
    expect(sectionOf(youtube, heuristicSpec(youtube), 'e20').layout).toBe(
      'chip_bar',
    );
  });

  it('reads the media shape from the exemplar thumbnail box', () => {
    const shape = (w: number, h: number) => {
      const sk = structuredClone(youtube);
      const thumb = sk.nodes.find((n) => n.id === 'e53')!;
      thumb.box = [thumb.box[0], thumb.box[1], w, h];
      for (const n of sk.nodes)
        if (n.parent === 'e53' && n.kind === 'media')
          n.box = [n.box[0], n.box[1], w, h];
      return list(heuristicSpec(sk), 'e51').media;
    };
    expect(shape(320, 180)).toBe('landscape');
    expect(shape(260, 200)).toBe('landscape');
    expect(shape(250, 200)).toBe('square');
    expect(shape(170, 200)).toBe('portrait');
    expect(shape(180, 240)).toBe('portrait');
  });

  it('demotes a second hero the way the validator does', () => {
    const sk = structuredClone(meta);
    const spec = heuristicSpec(sk);
    const v = validateSpec(
      {
        ...spec,
        sections: spec.sections.map((s) =>
          s.kind === 'feature_blocks' ? { ...s, layout: 'hero' as const } : s,
        ),
      },
      sk,
    )!;
    expect(v.repairs).toContainEqual({
      kind: 'hero_demoted',
      section: v.spec.sections.findIndex((s) => s.kind === 'feature_blocks'),
    });
    expect(
      v.spec.sections.find((s) => s.kind === 'feature_blocks')!.layout,
    ).toBe('spotlight');
  });
});

describe('heuristicSpec: YouTube channel grid', () => {
  const spec = heuristicSpec(youtube);

  it('reads a channel page around its video grid', () => {
    expect(spec.page_type).toBe('channel_or_profile');
    expect(spec.primary_task).toBe('browse_and_choose');
    expect(primaryOf(spec)).toMatchObject({
      kind: 'main_list',
      node_ids: ['e51'],
      layout: 'card_grid',
    });
  });

  it('puts search, sign-in and navigation in their places', () => {
    expect(kindOf(youtube, spec, 'e14')).toBe('search');
    expect(kindOf(youtube, spec, 'e19')).toBe('account_and_cart');
    expect(kindOf(youtube, spec, 'e20')).toBe('primary_nav');
    expect(kindOf(youtube, spec, 'e8')).toBe('header');
    expect(sectionOf(youtube, spec, 'e30')).toMatchObject({
      kind: 'page_heading',
      heading_ref: 'e30',
    });
    expect(kindOf(youtube, spec, 'e42')).toBe('tabs');
    expect(kindOf(youtube, spec, 'e48')).toBe('sort_and_view');
    expectNotFolded(youtube, spec, ['e11', 'e19', 'e20', 'e51', 'e42']);
  });

  it('maps video slots: thumbnail, title that opens, views, time, overflow menu', () => {
    const c = list(spec, 'e51');
    expect(c.item_kind).toBe('video');
    expect(c.open_slot).toBe('e56');
    expect(roleOf(c, 'e53')).toBe('thumbnail');
    expect(roleOf(c, 'e56')).toBe('title');
    expect(roleOf(c, 'e58')).toBe('meta');
    expect(roleOf(c, 'e59')).toBe('timestamp');
    expect(roleOf(c, 'e60')).toBe('overflow_menu');
    expect(list(spec, 'e44').item_kind).toBe('tab');
    expect(list(spec, 'e21').item_kind).toBe('nav_link');
  });

  it('reads a compact relative time the extractor left untagged ("2d ago")', () => {
    const sk = structuredClone(youtube);
    const time = sk.nodes.find((n) => n.id === 'e59')!;
    expect(time.label).toBe('2d ago');
    time.text = { chars: time.text?.chars ?? 6 };
    expect(roleOf(list(heuristicSpec(sk), 'e51'), 'e59')).toBe('timestamp');
  });
});

describe('heuristicSpec: Amazon search results', () => {
  const spec = heuristicSpec(amazon);

  it('reads a search results page with a product grid', () => {
    expect(spec.page_type).toBe('search_results');
    expect(spec.primary_task).toBe('compare_and_buy');
    expect(primaryOf(spec)).toMatchObject({
      kind: 'main_list',
      node_ids: ['e44'],
    });
  });

  it('separates chrome, refinements and support', () => {
    expect(kindOf(amazon, spec, 'e11')).toBe('search');
    expect(kindOf(amazon, spec, 'e18')).toBe('account_and_cart');
    expect(kindOf(amazon, spec, 'e21')).toBe('account_and_cart');
    expect(kindOf(amazon, spec, 'e30')).toBe('primary_nav');
    expect(kindOf(amazon, spec, 'e37')).toBe('sort_and_view');
    expect(kindOf(amazon, spec, 'e88')).toBe('filters');
    expect(kindOf(amazon, spec, 'e73')).toBe('pagination');
    expect(kindOf(amazon, spec, 'e67')).toBe('related');
    expect(kindOf(amazon, spec, 'e82')).toBe('help_and_contact');
    expect(kindOf(amazon, spec, 'e121')).toBe('legal');
    expect(kindOf(amazon, spec, 'e97')).toBe('footer');
    expectNotFolded(amazon, spec, ['e9', 'e18', 'e21', 'e73', 'e82', 'e44']);
  });

  it('folds the site pop-ups', () => {
    expect(sectionOf(amazon, spec, 'e22')).toMatchObject({
      kind: 'overlay_modal',
      importance: 'fold',
    });
    expect(sectionOf(amazon, spec, 'e127')).toMatchObject({
      kind: 'overlay_modal',
      importance: 'fold',
    });
  });

  it('maps product slots from text shapes', () => {
    const c = list(spec, 'e44');
    expect(c.item_kind).toBe('product');
    expect(c.open_slot).toBe('e50');
    expect(roleOf(c, 'e50')).toBe('title');
    expect(roleOf(c, 'e47')).toBe('thumbnail');
    // The price is the current one inside the price link, not the link
    // (which also reads the unit and "Typical" prices) nor the coupon.
    expect(roleOf(c, 'e59')).toBe('price');
    expect(roleOf(c, 'e58')).toBeUndefined();
    expect(c.fields.filter((f) => f.role === 'price')).toHaveLength(1);
    expect(roleOf(c, 'e54')).toBe('rating');
    expect(roleOf(c, 'e55')).toBe('review_count');
    expect(roleOf(c, 'e46')).toBe('badge');
    expect(roleOf(c, 'e53')).toBe('decorative');
    expect(roleOf(c, 'e66')).toBe('primary_action');
    expect(list(spec, 'e88').item_kind).toBe('filter_option');
  });
});

describe('heuristicSpec: Meta product marketing page', () => {
  const spec = heuristicSpec(meta);

  it('reads a landing page as a stack of feature blocks', () => {
    expect(spec.page_type).toBe('product_marketing');
    const p = primaryOf(spec);
    expect(p.kind).toBe('feature_blocks');
    expect(p.node_ids).toEqual(
      expect.arrayContaining(['e31', 'e35', 'e43', 'e95', 'e113']),
    );
  });

  it('folds the autoplaying hero video and the newsletter box, keeps chrome findable', () => {
    expect(sectionOf(meta, spec, 'e20')).toMatchObject({
      kind: 'clutter',
      importance: 'fold',
    });
    expect(sectionOf(meta, spec, 'e123')).toMatchObject({
      kind: 'clutter',
      importance: 'fold',
    });
    expect(sectionOf(meta, spec, 'e22')).toMatchObject({
      kind: 'page_heading',
      heading_ref: 'e22',
    });
    expect(kindOf(meta, spec, 'e14')).toBe('account_and_cart');
    expect(kindOf(meta, spec, 'e15')).toBe('account_and_cart');
    expect(kindOf(meta, spec, 'e6')).toBe('primary_nav');
    expectNotFolded(meta, spec, ['e12', 'e15', 'e14', 'e11', 'e137', 'e32']);
  });

  it('classifies cards and opens them by their own control', () => {
    expect(list(spec, 'e32')).toMatchObject({
      item_kind: 'feature',
      open_slot: 'e33',
    });
    const tech = list(spec, 'e91');
    expect(tech.item_kind).toBe('feature');
    expect(tech.open_slot).toBe('e92');
    expect(roleOf(tech, 'e94')).toBe('title');
    expect(roleOf(tech, 'e93')).toBe('thumbnail');
  });
});

describe('heuristicSpec: Wikipedia article', () => {
  const spec = heuristicSpec(wikipedia);

  it('reads an article with its contents list', () => {
    expect(spec.page_type).toBe('article');
    expect(spec.primary_task).toBe('read');
    expect(primaryOf(spec)).toMatchObject({
      kind: 'article',
      node_ids: ['e53'],
    });
    expect(sectionOf(wikipedia, spec, 'e27')).toMatchObject({
      kind: 'page_heading',
      heading_ref: 'e27',
    });
    expect(sectionOf(wikipedia, spec, 'e16')).toMatchObject({
      kind: 'secondary_nav',
      heading_ref: 'e19',
    });
    expect(kindOf(wikipedia, spec, 'e10')).toBe('search');
    expect(kindOf(wikipedia, spec, 'e222')).toBe('legal');
  });

  it('keeps an off-site link out of the trusted top strip', () => {
    // "Personal tools" holds the off-site Donate link.
    expect(kindOf(wikipedia, spec, 'e12')).toBe('secondary_nav');
    expectNotFolded(wikipedia, spec, ['e8', 'e12', 'e53', 'e222']);
  });

  it('maps references and in-page links', () => {
    const refs = list(spec, 'e196');
    expect(refs.item_kind).toBe('reference');
    expect(roleOf(refs, 'e199')).toBe('description');
    expect(list(spec, 'e23')).toMatchObject({
      item_kind: 'nav_link',
      open_slot: 'e24',
    });
  });
});

describe('heuristicSpec: webmail inbox', () => {
  const spec = heuristicSpec(inbox);

  it('reads an inbox around its message rows', () => {
    expect(spec.page_type).toBe('inbox_or_messages');
    expect(spec.primary_task).toBe('triage_messages');
    expect(primaryOf(spec)).toMatchObject({
      kind: 'main_list',
      node_ids: ['e42'],
    });
    expect(kindOf(inbox, spec, 'e6')).toBe('search');
    expect(kindOf(inbox, spec, 'e13')).toBe('account_and_cart');
    expect(kindOf(inbox, spec, 'e16')).toBe('primary_nav');
    expect(kindOf(inbox, spec, 'e38')).toBe('tabs');
  });

  it('maps message slots, with the subject opening the message', () => {
    const c = list(spec, 'e42');
    expect(c.item_kind).toBe('message');
    expect(c.open_slot).toBe('e48');
    expect(roleOf(c, 'e44')).toBe('select_toggle');
    expect(roleOf(c, 'e45')).toBe('state_toggle');
    expect(roleOf(c, 'e46')).toBe('author_or_channel');
    expect(roleOf(c, 'e48')).toBe('title');
    expect(roleOf(c, 'e49')).toBe('description');
    expect(roleOf(c, 'e50')).toBe('timestamp');
    // Hover-only row actions stay reachable as secondary actions.
    for (const id of ['e52', 'e53', 'e54', 'e55']) {
      expect(c.fields.find((f) => f.slot_id === id)).toMatchObject({
        role: 'secondary_action',
        show: 'on_expand',
      });
    }
  });
});

describe('heuristicSpec: field roles (docs/11 work package 1)', () => {
  it('a label badge before the subject is a badge, never the title (eval B5)', () => {
    // The exemplar row carries an optional "Work" chip before its subject.
    const sk = structuredClone(inbox);
    const at = sk.nodes.findIndex((n) => n.id === 'e48');
    const subject = sk.nodes[at]!;
    sk.nodes.splice(at, 0, {
      ...subject,
      id: 'e999',
      label: 'Work',
      text: { chars: 4 },
      fontPx: 12,
      flags: [],
      box: [subject.box[0], subject.box[1], 36, 14],
    });
    const c = list(heuristicSpec(sk), 'e42');
    expect(roleOf(c, 'e48')).toBe('title');
    expect(c.open_slot).toBe('e48');
    expect(roleOf(c, 'e999')).toBe('badge');
  });

  it('stars named by an icon are the rating', () => {
    const c = list(heuristicSpec(amazon), 'e44');
    const stars = amazon.nodes.find((n) =>
      /out of 5 stars/.test(n.label ?? ''),
    )!;
    expect(roleOf(c, stars.id)).toBe('rating');
  });

  it("a site's sign-in through its identity provider stays in the account slot (m5)", () => {
    const sk = structuredClone(youtube);
    const signIn = sk.nodes.find((n) => n.id === 'e19')!;
    signIn.href = 'other';
    signIn.idp = true;
    const spec = heuristicSpec(sk);
    expect(kindOf(sk, spec, 'e19')).toBe('account_and_cart');
    // Settings sits with it.
    expect(kindOf(sk, spec, 'e18')).toBe('account_and_cart');
    const v = validateSpec(spec, sk, { siteHost: 'youtube.com' })!;
    expect(v.repairs.filter((r) => r.kind === 'untrusted_slot')).toEqual([]);
    // Without the identity-provider mark, an off-site link leaves the strip.
    delete signIn.idp;
    expect(kindOf(sk, heuristicSpec(sk), 'e19')).not.toBe('account_and_cart');
  });

  it("the record's price is the one it costs now (docs/11 polish, m2)", () => {
    // Without the drawn price inside it, the price link leads with it; the
    // coupon ("Save CAD 2.85") and the delivery fee never take the place.
    const sk = structuredClone(amazon);
    sk.nodes = sk.nodes.filter((n) => !['e59', 'e60', 'e61'].includes(n.id));
    const c = list(heuristicSpec(sk), 'e44');
    expect(roleOf(c, 'e58')).toBe('price');
    expect(roleOf(c, 'e62')).not.toBe('price');
    expect(roleOf(c, 'e64')).not.toBe('price');
    // Only a coupon left: no current price at all is better than a saving.
    const coupon = structuredClone(amazon);
    coupon.nodes = coupon.nodes.filter(
      (n) => !['e58', 'e59', 'e60', 'e61'].includes(n.id),
    );
    const cc = list(heuristicSpec(coupon), 'e44');
    expect(cc.fields.filter((f) => f.role === 'price')).toEqual([]);
    expect(roleOf(cc, 'e62')).toBe('meta');
  });

  it('a bare count beside the stars is their review count', () => {
    const sk = structuredClone(amazon);
    const count = sk.nodes.find((n) => n.id === 'e55')!;
    count.label = '(2.4K)';
    count.text = { chars: 6, pat: ['count'] };
    expect(roleOf(list(heuristicSpec(sk), 'e44'), 'e55')).toBe('review_count');
  });

  it('a listing with a search box is not a search results page without a query', () => {
    const sk = structuredClone(youtube);
    sk.typed = [];
    const spec = heuristicSpec(sk, { signals: ['search_results_pattern'] });
    expect(spec.page_type).not.toBe('search_results');
  });
});

describe('heuristicSpec: government guide', () => {
  const spec = heuristicSpec(govuk);

  it('the cookie banner never leads and is never primary', () => {
    const i = spec.sections.findIndex((s) => s.kind === 'consent');
    const p = spec.sections.findIndex((s) => s.importance === 'primary');
    expect(i).toBeGreaterThan(p);
    expect(spec.sections[0]?.kind).not.toBe('consent');
    // A spec that makes it primary is repaired.
    const forced: PageSpec = {
      ...spec,
      sections: spec.sections.map((s) => ({
        ...s,
        importance:
          s.kind === 'consent'
            ? 'primary'
            : s.importance === 'primary'
              ? 'secondary'
              : s.importance,
      })),
    };
    const v = validateSpec(forced, govuk)!;
    expect(v.spec.sections[v.primary]?.kind).not.toBe('consent');
  });

  it('reads a guide and keeps the cookie banner answerable', () => {
    expect(spec.page_type).toBe('article');
    expect(sectionOf(govuk, spec, 'e2')).toMatchObject({
      kind: 'consent',
      importance: 'secondary',
    });
    expect(kindOf(govuk, spec, 'e15')).toBe('breadcrumbs');
    const p = primaryOf(spec);
    expect(p.kind).toBe('article');
    // The "Start now" button is part of the guide.
    const start = govuk.nodes.find((n) => n.label === 'Start now')!;
    expect(sectionOf(govuk, spec, start.id)).toBe(p);
    expect(sectionOf(govuk, spec, 'e21')).toMatchObject({
      kind: 'page_heading',
      heading_ref: 'e21',
    });
    expect(sectionOf(govuk, spec, 'e54').kind).toBe('related');
    expect(sectionOf(govuk, spec, 'e65').kind).toBe('help_and_contact');
  });
});

describe('heuristicSpec: news article with ads', () => {
  it('folds ads, newsletter, chat and promotions and keeps the article whole', () => {
    const spec = heuristicSpec(news, { verdicts: NEWS_VERDICTS });
    expect(spec.page_type).toBe('article');
    const p = primaryOf(spec);
    expect(p.kind).toBe('article');
    expect(p.heading_ref).toBe('e19');
    for (const ad of ['e2', 'e36', 'e50', 'e80']) {
      expect(sectionOf(news, spec, ad), ad).toMatchObject({
        kind: 'ads',
        importance: 'fold',
      });
    }
    expect(sectionOf(news, spec, 'e44')).toMatchObject({
      kind: 'clutter',
      importance: 'fold',
    });
    // Verdicts: the subscription bar is a promotion, the bubble a chat widget, "Most read" related.
    expect(sectionOf(news, spec, 'e96')).toMatchObject({
      kind: 'ads',
      importance: 'fold',
    });
    expect(sectionOf(news, spec, 'e100')).toMatchObject({
      kind: 'clutter',
      importance: 'fold',
    });
    expect(sectionOf(news, spec, 'e74')).toMatchObject({
      kind: 'related',
      importance: 'tertiary',
    });
    expect(sectionOf(news, spec, 'e61').kind).toBe('comments');
    expect(sectionOf(news, spec, 'e101')).toMatchObject({
      kind: 'consent',
      importance: 'secondary',
    });
    expect(kindOf(news, spec, 'e11')).toBe('account_and_cart');
    const comments = list(spec, 'e64');
    expect(comments.item_kind).toBe('comment');
    expect(roleOf(comments, 'e66')).toBe('author_or_channel');
    expect(roleOf(comments, 'e68')).toBe('description');
    expect(roleOf(comments, 'e70')).toBe('state_toggle');
  });

  it('folds the same chrome by rules alone when no verdicts are known', () => {
    const spec = heuristicSpec(news);
    expect(sectionOf(news, spec, 'e96')).toMatchObject({
      kind: 'overlay_modal',
      importance: 'fold',
    });
    expect(sectionOf(news, spec, 'e100')).toMatchObject({
      kind: 'clutter',
      importance: 'fold',
    });
    expect(sectionOf(news, spec, 'e74').kind).toBe('related');
  });

  it('ignores a fold verdict on the main content, the banner or search', () => {
    const ck = (id: string) => news.nodes.find((n) => n.id === id)!.ck!;
    const spec = heuristicSpec(news, {
      verdicts: { [ck('e15')]: 'promo_ad', [ck('e5')]: 'chat_widget' },
    });
    expect(primaryOf(spec)).toMatchObject({
      kind: 'article',
      heading_ref: 'e19',
    });
    expectNotFolded(news, spec, ['e19', 'e34', 'e11', 'e12']);
  });
});

// ---------------------------------------------------------------------------
// Pages built here: product detail, no landmarks, degenerate input
// ---------------------------------------------------------------------------

const productPage = (): Skeleton =>
  buildSkeleton({
    name: 'product',
    viewport: [1280, 800],
    doc: [1280, 2400],
    root: {
      t: 'body',
      k: 'group',
      b: [0, 0, 1280, 2400],
      c: [
        {
          t: 'header',
          k: 'landmark',
          b: [0, 0, 1280, 64],
          c: [
            {
              t: 'a',
              k: 'control',
              b: [16, 8, 120, 48],
              f: ['icon'],
              l: 'Home',
            },
            {
              t: 'input',
              k: 'input',
              it: 'search',
              b: [300, 12, 500, 40],
              l: 'Search',
            },
            { t: 'a', k: 'control', b: [1180, 12, 80, 40], l: 'Cart' },
          ],
        },
        {
          t: 'main',
          k: 'landmark',
          b: [0, 64, 1280, 2000],
          c: [
            {
              t: 'div',
              k: 'group',
              b: [40, 80, 1200, 700],
              c: [
                { t: 'img', k: 'media', b: [40, 80, 560, 560], l: 'Kettle' },
                {
                  t: 'div',
                  k: 'group',
                  b: [640, 80, 600, 700],
                  c: [
                    {
                      t: 'h1',
                      k: 'heading',
                      b: [640, 80, 600, 80],
                      fs: 32,
                      l: 'Steel kettle, 1.7 litre',
                    },
                    {
                      t: 'span',
                      k: 'stext',
                      b: [640, 180, 120, 32],
                      fs: 28,
                      l: '$39.99',
                    },
                    {
                      t: 'select',
                      k: 'input',
                      b: [640, 230, 200, 40],
                      o: 4,
                      l: 'Colour',
                    },
                    {
                      t: 'button',
                      k: 'control',
                      b: [640, 300, 240, 48],
                      l: 'Add to cart',
                    },
                    {
                      t: 'button',
                      k: 'control',
                      b: [900, 300, 240, 48],
                      l: 'Buy now',
                    },
                    {
                      t: 'p',
                      k: 'text',
                      b: [640, 380, 600, 200],
                      tx: { chars: 380 },
                    },
                  ],
                },
              ],
            },
            {
              t: 'section',
              k: 'landmark',
              r: 'region',
              b: [40, 820, 1200, 600],
              l: 'Customer reviews',
              c: [
                {
                  t: 'h2',
                  k: 'heading',
                  b: [40, 820, 600, 40],
                  l: 'Customer reviews',
                },
                {
                  t: 'ul',
                  k: 'collection',
                  b: [40, 880, 1200, 500],
                  n: 8,
                  itm: 'li',
                  ex: {
                    t: 'li',
                    k: 'group',
                    b: [40, 880, 1200, 120],
                    c: [
                      {
                        t: 'span',
                        k: 'stext',
                        b: [40, 880, 200, 20],
                        l: 'Sam K.',
                      },
                      {
                        t: 'span',
                        k: 'stext',
                        b: [260, 880, 200, 20],
                        l: '4.0 out of 5 stars',
                      },
                      {
                        t: 'p',
                        k: 'text',
                        b: [40, 910, 1200, 60],
                        tx: { chars: 240 },
                      },
                      {
                        t: 'button',
                        k: 'control',
                        b: [40, 980, 100, 28],
                        l: 'Helpful',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          t: 'footer',
          k: 'landmark',
          b: [0, 2100, 1280, 300],
          c: [
            {
              t: 'a',
              k: 'control',
              b: [40, 2140, 120, 20],
              l: 'Privacy notice',
            },
            { t: 'a', k: 'control', b: [200, 2140, 120, 20], l: 'Help' },
          ],
        },
      ],
    },
  });

describe('heuristicSpec: built pages', () => {
  it('finds a product detail block from its title, price and buy control', () => {
    const sk = productPage();
    const spec = heuristicSpec(sk);
    expect(spec.page_type).toBe('product_detail');
    expect(spec.primary_task).toBe('compare_and_buy');
    const p = primaryOf(spec);
    expect(p.kind).toBe('product_detail');
    expect(p.heading_ref).toBe('e10');
    const reviews = spec.sections.find((s) => s.kind === 'comments');
    expect(reviews).toBeDefined();
    expect(kindOf(sk, spec, 'e4')).toBe('search');
    expect(kindOf(sk, spec, 'e5')).toBe('account_and_cart');
    const v = validateSpec(spec, sk)!;
    expect(v.repairs).toEqual([]);
    expect(v.rest).toEqual([]);
  });

  it('finds the content of a page without landmarks', () => {
    const row = (i: number): FxNode => ({
      t: 'div',
      k: 'group',
      b: [200, 200 + i * 120, 800, 110],
      c: [
        {
          t: 'a',
          k: 'control',
          b: [200, 200 + i * 120, 600, 24],
          l: 'Result title',
        },
        {
          t: 'span',
          k: 'text',
          b: [200, 230 + i * 120, 800, 60],
          tx: { chars: 160 },
        },
      ],
    });
    const sk = buildSkeleton({
      name: 'soup',
      viewport: [1280, 800],
      doc: [1280, 3000],
      typed: ['kettle'],
      root: {
        t: 'body',
        k: 'group',
        b: [0, 0, 1280, 3000],
        c: [
          {
            t: 'div',
            k: 'group',
            b: [0, 0, 1280, 60],
            c: [
              {
                t: 'a',
                k: 'control',
                b: [16, 10, 100, 40],
                f: ['icon'],
                l: 'Home',
              },
              {
                t: 'input',
                k: 'input',
                it: 'search',
                b: [200, 10, 600, 40],
                l: 'Search',
              },
              { t: 'a', k: 'control', b: [1100, 10, 100, 40], l: 'Sign in' },
            ],
          },
          {
            t: 'div',
            k: 'group',
            b: [0, 80, 1280, 2500],
            c: [
              {
                t: 'div',
                k: 'collection',
                b: [200, 200, 800, 2200],
                n: 20,
                ex: row(0),
              },
            ],
          },
          {
            t: 'div',
            k: 'group',
            b: [0, 2700, 1280, 200],
            c: [
              { t: 'a', k: 'control', b: [40, 2720, 80, 20], l: 'About' },
              { t: 'a', k: 'control', b: [140, 2720, 80, 20], l: 'Careers' },
              { t: 'a', k: 'control', b: [240, 2720, 80, 20], l: 'Privacy' },
              { t: 'a', k: 'control', b: [340, 2720, 80, 20], l: 'Terms' },
              { t: 'a', k: 'control', b: [440, 2720, 80, 20], l: 'Contact' },
            ],
          },
        ],
      },
    });
    const spec = heuristicSpec(sk);
    expect(spec.page_type).toBe('search_results');
    const p = primaryOf(spec);
    expect(p.kind).toBe('main_list');
    expect(list(spec, p.node_ids[0]!).item_kind).toBe('search_result');
    expect(kindOf(sk, spec, 'e4')).toBe('search');
    expect(kindOf(sk, spec, 'e5')).toBe('account_and_cart');
    expect(['legal', 'footer', 'help_and_contact']).toContain(
      kindOf(sk, spec, 'e13'),
    );
    expect(validateSpec(spec, sk)!.repairs).toEqual([]);
  });

  it('copes with degenerate pages', () => {
    const single = buildSkeleton({
      name: 'single',
      viewport: [1280, 800],
      doc: [1280, 800],
      root: { t: 'body', k: 'group', b: [0, 0, 1280, 800] },
    });
    expect(() => heuristicSpec(single)).not.toThrow();
    const textOnly = buildSkeleton({
      name: 'text',
      viewport: [1280, 800],
      doc: [1280, 800],
      root: {
        t: 'body',
        k: 'group',
        b: [0, 0, 1280, 800],
        c: [{ t: 'p', k: 'text', b: [0, 0, 600, 100], tx: { chars: 300 } }],
      },
    });
    const spec = heuristicSpec(textOnly);
    const v = validateSpec(spec, textOnly)!;
    expect(
      v.spec.sections.filter((s) => s.importance === 'primary'),
    ).toHaveLength(1);
    expect(v.rest).toEqual([]);
    // Nothing to read or use: the page as is, still a valid spec.
    expect(pageSpecSchema.safeParse(heuristicSpec(single)).success).toBe(true);
    const empty: Skeleton = { ...textOnly, nodes: [] };
    expect(heuristicSpec(empty).sections).toEqual([]);
  });

  it('honours JSON-LD and Open Graph signals', () => {
    const sk = productPage();
    // Without a buy control (a store that will not ship here), the product's
    // picture beside its title still marks the detail block.
    const noBuy = structuredClone(sk);
    for (const n of noBuy.nodes)
      if (n.label === 'Add to cart' || n.label === 'Buy now') n.label = 'Save';
    expect(primaryOf(heuristicSpec(noBuy)).kind).toBe('product_detail');
    // A title and a price alone are not a product page; JSON-LD Product is.
    const bare = structuredClone(noBuy);
    for (const n of bare.nodes)
      if (n.kind === 'media') n.box = [40, 80, 40, 40];
    expect(primaryOf(heuristicSpec(bare)).kind).not.toBe('product_detail');
    expect(
      primaryOf(heuristicSpec(bare, { signals: ['jsonld_product'] })).kind,
    ).toBe('product_detail');
  });

  it('a store page whose text block leads is product marketing, not an article', () => {
    // A hero with "Starting at CA$277" and "Shop all" in the first screen,
    // then sections of text and players (meta.com/ai-glasses).
    const section = (y: number, i: number): FxNode => ({
      t: 'div',
      k: 'group',
      b: [32, y, 1376, 700],
      c: [
        { t: 'h2', k: 'heading', b: [380, y, 680, 56], l: `Section ${i}` },
        {
          t: 'p',
          k: 'text',
          b: [380, y + 70, 680, 52],
          tx: { chars: 260 },
        },
        { t: 'video', k: 'media', b: [32, y + 140, 1376, 540] },
      ],
    });
    const page = (shop: boolean): Skeleton =>
      buildSkeleton({
        name: 'store',
        viewport: [1440, 900],
        doc: [1440, 4000],
        root: {
          t: 'body',
          k: 'group',
          b: [0, 0, 1440, 4000],
          c: [
            {
              t: 'header',
              k: 'landmark',
              b: [0, 0, 1440, 64],
              c: [
                { t: 'a', k: 'control', b: [16, 16, 80, 32], l: 'Home' },
                { t: 'a', k: 'control', b: [120, 16, 80, 32], l: 'Sign in' },
              ],
            },
            {
              t: 'div',
              k: 'group',
              b: [0, 64, 1440, 3900],
              c: [
                {
                  t: 'div',
                  k: 'group',
                  b: [0, 64, 1440, 840],
                  c: [
                    { t: 'video', k: 'media', b: [0, 64, 1440, 760] },
                    {
                      t: 'h1',
                      k: 'heading',
                      b: [180, 700, 1080, 74],
                      l: 'Glasses for effortless connection',
                    },
                    {
                      t: 'div',
                      k: 'stext',
                      b: [32, 850, 120, 30],
                      l: 'Starting at',
                    },
                    {
                      t: 'div',
                      k: 'stext',
                      b: [160, 850, 80, 30],
                      l: shop ? 'CA$277' : 'In 1931',
                    },
                    {
                      t: 'a',
                      k: 'control',
                      b: [1314, 847, 102, 44],
                      l: shop ? 'Shop all' : 'Read more',
                    },
                  ],
                },
                section(1000, 1),
                section(1800, 2),
                section(2600, 3),
              ],
            },
          ],
        },
      });
    const store = heuristicSpec(page(true));
    expect(store.page_type).toBe('product_marketing');
    expect(store.primary_task).toBe('browse_and_choose');
    // The same page with no price or shop link stays what it reads as.
    expect(heuristicSpec(page(false)).page_type).not.toBe('product_marketing');
  });

  it('a title over a hero image is marketing, not a product detail', () => {
    const sk = productPage();
    const hero = structuredClone(sk);
    for (const n of hero.nodes) {
      if (n.kind === 'media') n.box = [0, 64, 1280, 720];
      if (n.kind === 'heading' && n.level === 1) n.flags = ['overlay'];
      if (n.label === 'Add to cart' || n.label === 'Buy now') n.label = 'Save';
    }
    expect(primaryOf(heuristicSpec(hero)).kind).not.toBe('product_detail');
  });
});

// ---------------------------------------------------------------------------
// Fuzz: random pages always get a valid, repair-free spec
// ---------------------------------------------------------------------------

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

const LABELS = [
  'Sign in',
  'Search',
  'Privacy policy',
  'Next page',
  'Related stories',
  'Comments',
  'Buy now',
  'Add to cart',
  'Sort by',
  'Filters',
  'Help',
  'Menu',
  'More actions',
  'Home',
  '$12.00',
  '3:41',
  '2 days ago',
  '4.5 out of 5 stars',
  '1,204 reviews',
  'Delete',
  'Subscribe',
  'A longer descriptive title for an item in a list',
];
const LANDMARKS: SkelRole[] = [
  'banner',
  'navigation',
  'main',
  'complementary',
  'contentinfo',
  'search',
  'form',
  'region',
  'dialog',
];
const FLAGS: SkelFlag[] = [
  'fixed',
  'sticky',
  'playing',
  'adhint',
  'consenthint',
  'icon',
  'imgctrl',
  'headlink',
  'bold',
  'hoveronly',
  'focus',
  'popup',
  'pressed',
];

function randomPage(rand: () => number, size: number): Skeleton {
  let budget = size;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const node = (depth: number, x: number, y: number, w: number): FxNode => {
    budget--;
    const h = 20 + Math.floor(rand() * 400);
    const b: FxNode['b'] = [x, y, w, h];
    const leafKinds: SkelKind[] = [
      'control',
      'input',
      'heading',
      'text',
      'stext',
      'media',
      'table',
    ];
    const flags = rand() < 0.3 ? [pick(FLAGS)] : [];
    const l = rand() < 0.7 ? pick(LABELS) : undefined;
    if (depth >= 6 || budget <= 0 || rand() < 0.35) {
      const k = pick(leafKinds);
      const t: SkelTag =
        k === 'control'
          ? pick(['a', 'button'] as const)
          : k === 'input'
            ? 'input'
            : k === 'heading'
              ? pick(['h1', 'h2', 'h3'] as const)
              : k === 'media'
                ? 'img'
                : k === 'table'
                  ? 'table'
                  : pick(['p', 'span'] as const);
      return {
        t,
        k,
        b,
        f: flags,
        l: k === 'text' ? undefined : l,
        ...(k === 'text'
          ? { tx: { chars: 40 + Math.floor(rand() * 900) } }
          : {}),
        ...(k === 'input'
          ? { it: pick(['text', 'search', 'checkbox', 'email'] as const) }
          : {}),
        ...(k === 'control' && rand() < 0.2
          ? { hr: pick(['other', 'fragment', 'none'] as const) }
          : {}),
      };
    }
    if (rand() < 0.15) {
      return {
        t: 'div',
        k: 'collection',
        b,
        n: 3 + Math.floor(rand() * 40),
        ex: node(depth + 1, x, y, Math.max(40, Math.floor(w / 3))),
      };
    }
    const landmark = rand() < 0.25;
    const kids = 1 + Math.floor(rand() * 5);
    const c: FxNode[] = [];
    let cy = y;
    for (let i = 0; i < kids && budget > 0; i++) {
      const child = node(depth + 1, x, cy, w);
      cy += child.b[3];
      c.push(child);
    }
    return {
      t: landmark ? 'section' : 'div',
      k: landmark ? 'landmark' : 'group',
      r: landmark ? pick(LANDMARKS) : null,
      b: [x, y, w, Math.max(h, cy - y)],
      f: flags,
      ...(landmark && rand() < 0.5 ? { l } : {}),
      ...(rand() < 0.2
        ? { ck: `c${Math.floor(rand() * 1e6).toString(36)}` }
        : {}),
      c,
    };
  };
  const root = node(0, 0, 0, 1280);
  return buildSkeleton({
    name: 'random',
    viewport: [1280, 800],
    doc: [1280, Math.max(800, root.b[3])],
    root: { ...root, t: 'body', k: 'group', r: null },
    typed: rand() < 0.2 ? ['query'] : [],
  });
}

describe('heuristicSpec: fuzz', () => {
  it('random pages always get a repair-free spec with one primary', () => {
    const rand = rng(1015);
    const roles: RegionRole[] = [
      'main_content',
      'navigation',
      'promo_ad',
      'recommendations',
      'chat_widget',
      'consent_banner',
      'help_contact',
      'form',
      'footer',
      'other',
    ];
    for (let i = 0; i < 250; i++) {
      const sk = randomPage(rand, 10 + Math.floor(rand() * 220));
      const verdicts: Record<string, RegionRole> = {};
      for (const n of sk.nodes)
        if (n.ck && rand() < 0.5)
          verdicts[n.ck] = roles[Math.floor(rand() * roles.length)]!;
      const ctx: HeuristicContext = { verdicts };
      let spec: PageSpec;
      try {
        spec = heuristicSpec(sk, ctx);
      } catch (e) {
        throw new Error(`page #${i} threw: ${String(e)}`);
      }
      expect(pageSpecSchema.safeParse(spec).success, `#${i}`).toBe(true);
      const v = validateSpec(spec, sk);
      expect(v, `#${i}`).not.toBeNull();
      const structural = v!.repairs.filter(
        (r) => r.kind !== 'rest_added' && r.kind !== 'focus_unfolded',
      );
      expect(structural, `#${i}`).toEqual([]);
      expect(
        spec.sections.filter((s) => s.importance === 'primary'),
        `#${i}`,
      ).toHaveLength(1);
    }
  });
});
