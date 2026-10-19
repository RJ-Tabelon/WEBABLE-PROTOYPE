import type {
  FitLayout,
  Locator,
  Skeleton,
  SkeletonNode,
  SpecCollection,
  SpecSection,
} from '@webable/core';
import { describe, expect, it } from 'vitest';

import { quietPlayers, splitParagraph } from './article';
import {
  fillMedia,
  indexSkeleton,
  isIrreversible,
  mirrorState,
  onPageCard,
  proxyRole,
  safeHref,
  stripLead,
  subtreeIds,
  type RenderCtx,
} from './components';
import { checkConservation } from './conserve';
import { cardDisclosure } from './parts';
import {
  cardFor,
  cardMinWidth,
  countText,
  gridClassFor,
  gridColumns,
  inferFields,
  leadPrice,
  ratingText,
  recordTemplate,
  renderCollection,
  shapeOf,
} from './records';
import { titleFromDocument } from './render';
import {
  jsonLdPrice,
  layoutOf,
  linkGrid,
  linkRows,
  orderSections,
  type PillItem,
} from './sections';
import type { MediaInfo, SkeletonRegistry } from './types';

const node = (
  id: string,
  parent: string | null,
  kind: SkeletonNode['kind'],
  extra: Partial<SkeletonNode> = {},
): SkeletonNode => ({
  id,
  parent,
  depth: 0,
  tag: 'div',
  role: null,
  kind,
  box: [0, 0, 10, 10],
  flags: [],
  ...extra,
});

function skeleton(nodes: SkeletonNode[]): Skeleton {
  return {
    v: 1,
    version: 'skel-1.0.0',
    extractionId: 'x1',
    viewport: { width: 1280, height: 800, zoom: 1 },
    doc: { width: 1280, height: 2000 },
    lang: 'en',
    nodes,
    truncated: false,
    structure: 's',
    typed: [],
    perf: { ms: 1, nodes: nodes.length },
  };
}

/** A registry over detached elements, one per node. */
function registry(
  nodes: SkeletonNode[],
  members: Element[] = [],
): SkeletonRegistry {
  const els = new Map(nodes.map((n) => [n.id, document.createElement('div')]));
  return {
    extractionId: 'x1',
    element: (id) => els.get(id) ?? null,
    members: () => members,
    slot: () => null,
    text: () => '',
    name: () => '',
    media: (): MediaInfo => ({
      src: null,
      srcset: null,
      width: 0,
      height: 0,
      alt: '',
    }),
    href: (el) => (el as HTMLAnchorElement).href || null,
    recordKey: (_l, m) => m.id,
    fingerprint: (_l, m) => m.id,
    locator: (): Locator => ({ path: [], kind: 'group' }),
    resolve: () => null,
  };
}

describe('grid', () => {
  it('columns = floor((width + gap) / (min + gap)), at least 1, capped', () => {
    expect(gridColumns(1168, 9, 226, 4)).toBe(4);
    expect(gridColumns(1168, 9, 226, 3)).toBe(3);
    expect(gridColumns(700, 9, 226, 4)).toBe(3);
    // Two cards need 2 x 226 + one 9 px gap.
    expect(gridColumns(461, 9, 226, 4)).toBe(2);
    expect(gridColumns(460, 9, 226, 4)).toBe(1);
    expect(gridColumns(200, 9, 226, 4)).toBe(1);
    expect(gridColumns(0, 9, 226, 4)).toBe(1);
  });

  it('draws each item kind with its card unless the spec names one (docs/12 §6.2)', () => {
    expect(cardFor('video')).toBe('media');
    expect(cardFor('product')).toBe('tile');
    expect(cardFor('article_card')).toBe('story');
    expect(cardFor('search_result')).toBe('row');
    expect(cardFor('message')).toBe('message');
    expect(cardFor('nav_link')).toBe('link');
    expect(cardFor('video', 'row')).toBe('row');
    // A chip is never a record's template; nonsense keeps the kind's card.
    expect(cardFor('product', 'chip')).toBe('tile');
    expect(cardFor('product', 'poster')).toBe('tile');
  });

  it('tiles and media cards share the media grid, stories the text grid, the rest are rows', () => {
    expect(gridClassFor('media')).toBe('card_media');
    expect(gridClassFor('tile')).toBe('card_media');
    expect(gridClassFor('story')).toBe('card_text');
    expect(gridClassFor('row', 'card_grid')).toBe('row');
    expect(gridClassFor('message')).toBe('row');
    expect(gridClassFor('person')).toBe('row');
    expect(gridClassFor('person', 'card_grid')).toBe('card_text');
    // max(260, 13F), max(280, 14F), max(300, 16F).
    expect(cardMinWidth('tile', 18)).toBe(260);
    expect(cardMinWidth('media', 24)).toBe(336);
    expect(cardMinWidth('story', 18)).toBe(300);
  });

  it('reads a thumbnail box as landscape, square or portrait', () => {
    expect(shapeOf(320, 180)).toBe('landscape');
    expect(shapeOf(200, 200)).toBe('square');
    expect(shapeOf(150, 200)).toBe('portrait');
    expect(shapeOf(0, 0)).toBe('none');
  });
});

describe('record fields', () => {
  it('infers title, open slot, thumbnail and badges from the exemplar', () => {
    const slots = [
      node('e2', 'e1', 'group', { slot: true }),
      node('e3', 'e2', 'media', { slot: true, tag: 'img' }),
      node('e4', 'e2', 'stext', {
        slot: true,
        text: { chars: 5, pat: ['duration'] },
      }),
      node('e5', 'e2', 'heading', { slot: true, level: 3 }),
      node('e6', 'e5', 'control', {
        slot: true,
        tag: 'a',
        role: 'link',
        href: 'same',
      }),
      node('e7', 'e2', 'control', {
        slot: true,
        tag: 'a',
        role: 'link',
        href: 'same',
      }),
      node('e8', 'e2', 'stext', {
        slot: true,
        text: { chars: 9, pat: ['date'] },
      }),
      node('e9', 'e2', 'control', {
        slot: true,
        tag: 'button',
        role: 'button',
        flags: ['popup'],
      }),
    ];
    const { fields, open } = inferFields(slots);
    expect(open).toBe('e6');
    expect(fields.map((f) => [f.slot_id, f.role])).toEqual([
      ['e5', 'title'],
      ['e3', 'thumbnail'],
      ['e4', 'duration'],
      ['e7', 'link'],
      ['e8', 'timestamp'],
      ['e9', 'overflow_menu'],
    ]);
  });
});

describe('section order', () => {
  const s = (
    kind: SpecSection['kind'],
    ids: string[],
    importance: SpecSection['importance'] = 'secondary',
  ): SpecSection => ({
    kind,
    importance,
    node_ids: ids,
    heading_ref: null,
    layout: 'reading',
  });

  it('keeps the reading order of anchors, strip kinds up top, folded last, consent first', () => {
    const order = new Map(
      ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((id, i) => [id, i]),
    );
    const sections = [
      s('main_list', ['e4'], 'primary'),
      s('ads', ['e2'], 'fold'),
      s('search', ['e1']),
      s('footer', ['e6']),
      s('primary_nav', ['e3']),
      s('consent', ['e5']),
    ];
    const o = orderSections(sections, order, 0);
    expect(o.strip.map((x) => x.section.kind)).toEqual(['search']);
    expect(o.folded.map((x) => x.section.kind)).toEqual(['ads']);
    expect(o.body.map((x) => x.section.kind)).toEqual([
      'consent',
      'primary_nav',
      'main_list',
      'footer',
    ]);
  });
});

describe('controls', () => {
  it('renders only http(s), mailto and tel hrefs', () => {
    expect(safeHref('https://a.test/x?y#z')).toBe('https://a.test/x?y#z');
    expect(safeHref('mailto:a@b.test')).toBe('mailto:a@b.test');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });

  it('marks irreversible actions by accessible name', () => {
    for (const n of [
      'Buy Now',
      'Place your order',
      'Delete',
      'Send',
      'Pay now',
      'Proceed to checkout',
      'Donate',
    ])
      expect(isIrreversible(n), n).toBe(true);
    for (const n of ['Add to Cart', 'Archive', 'PayPal', 'Posts', 'Sender'])
      expect(isIrreversible(n), n).toBe(false);
  });

  it('maps originals to proxy roles', () => {
    const reg = registry([]);
    const a = document.createElement('a');
    a.href = 'https://a.test/';
    expect(proxyRole(undefined, a, reg)).toBe('link');
    const js = document.createElement('a');
    js.href = 'javascript:void 0';
    expect(proxyRole(undefined, js, { ...reg, href: () => null })).toBe(
      'button',
    );
    const box = document.createElement('input');
    box.type = 'checkbox';
    expect(proxyRole(undefined, box, reg)).toBe('toggle');
    expect(proxyRole(undefined, document.createElement('select'), reg)).toBe(
      'select',
    );
    const pw = document.createElement('input');
    pw.type = 'password';
    expect(proxyRole(undefined, pw, reg)).toBe('none');
    const sw = document.createElement('div');
    sw.setAttribute('role', 'switch');
    expect(proxyRole(undefined, sw, reg)).toBe('toggle');
    expect(
      proxyRole(node('e1', null, 'control', { flags: ['editable'] }), sw, reg),
    ).toBe('none');
  });
});

describe('state and media follow the original', () => {
  it("mirrors the original's selected, current and checked attributes", () => {
    const chip = document.createElement('div');
    chip.setAttribute('role', 'tab');
    chip.setAttribute('aria-selected', 'true');
    const pill = document.createElement('button');
    mirrorState(pill, chip, false);
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    chip.setAttribute('aria-selected', 'false');
    mirrorState(pill, chip, false);
    expect(pill.hasAttribute('aria-pressed')).toBe(false);

    const nav = document.createElement('a');
    nav.setAttribute('aria-current', 'page');
    const link = document.createElement('a');
    mirrorState(link, nav, false);
    expect(link.getAttribute('aria-current')).toBe('true');

    const box = document.createElement('div');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', 'true');
    const input = document.createElement('input');
    input.type = 'checkbox';
    mirrorState(input, box, true);
    expect(input.checked).toBe(true);
    const star = document.createElement('button');
    box.setAttribute('aria-checked', 'false');
    mirrorState(star, box, true);
    expect(star.getAttribute('aria-pressed')).toBe('false');

    // A toggle button stays a toggle button while off.
    const mute = document.createElement('button');
    mute.setAttribute('aria-pressed', 'true');
    const view = document.createElement('button');
    mirrorState(view, mute, false);
    expect(view.getAttribute('aria-pressed')).toBe('true');
    mute.setAttribute('aria-pressed', 'false');
    mirrorState(view, mute, false);
    expect(view.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the placeholder when an image never loads, and does not retry it', () => {
    let src: string | null = 'https://a.test/thumb.jpg';
    const ctx = {
      doc: document,
      registry: {
        ...registry([]),
        media: (): MediaInfo => ({
          src,
          srcset: null,
          width: 160,
          height: 90,
          alt: '',
        }),
      },
    } as unknown as RenderCtx;
    const box = document.createElement('div');
    const original = document.createElement('img');
    fillMedia(ctx, box, original);
    expect(box.style.getPropertyValue('--fv-ar')).toBe('160 / 90');
    const img = box.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(src);
    img.dispatchEvent(new Event('error'));
    expect(box.querySelector('img')).toBeNull();
    fillMedia(ctx, box, original);
    expect(box.querySelector('img')).toBeNull();
    src = 'https://a.test/thumb-2.jpg';
    fillMedia(ctx, box, original);
    expect(box.querySelector('img')?.getAttribute('src')).toBe(src);
    src = 'javascript:alert(1)';
    fillMedia(ctx, box, original);
    expect(box.querySelector('img')).toBeNull();
  });
});

describe('skeleton index and conservation', () => {
  const nodes = [
    node('e1', null, 'landmark'),
    node('e2', 'e1', 'heading'),
    node('e3', 'e1', 'collection', {
      collection: { count: 3, itemTag: 'li', exemplar: 'e4' },
    }),
    node('e4', 'e3', 'group', { slot: true }),
    node('e5', 'e4', 'control', { slot: true }),
    node('e6', 'e1', 'group'),
    node('e7', 'e6', 'text'),
    node('e8', 'e6', 'control'),
  ];

  it('separates exemplar slots from the tree', () => {
    const idx = indexSkeleton(skeleton(nodes), registry(nodes));
    expect(idx.children.get('e1')).toEqual(['e2', 'e3', 'e6']);
    expect(idx.children.get('e3')).toEqual([]);
    expect(idx.slots.get('e3')?.map((n) => n.id)).toEqual(['e4', 'e5']);
    expect(idx.slotList.get('e5')).toBe('e3');
    expect(subtreeIds(idx, 'e6')).toEqual(['e6', 'e7', 'e8']);
  });

  it('every visible content node is in the view, reachable, invisible or in rest', () => {
    const members = ['a', 'b', 'c'].map((id) => {
      const li = document.createElement('li');
      li.id = id;
      return li;
    });
    const reg = registry(nodes, members);
    const idx = indexSkeleton(skeleton(nodes), reg);
    const lists = new Map([
      [
        'e3',
        {
          seen: new Set(['a', 'b', 'c']),
          empty: new Set(),
          order: ['a', 'b', 'c'],
          overflow: 0,
        } as never,
      ],
    ]);
    const ok = checkConservation({
      index: idx,
      registry: reg,
      emitted: new Set(['e2', 'e3', 'e7']),
      reached: new Set(['e8']),
      hidden: new Set(),
      rest: [],
      lists,
    });
    expect(ok.ok).toBe(true);
    const missing = checkConservation({
      index: idx,
      registry: reg,
      emitted: new Set(['e2', 'e3']),
      reached: new Set(),
      hidden: new Set(),
      rest: [],
      lists,
    });
    expect(missing.ok).toBe(false);
    expect(missing.missing).toEqual(['e7', 'e8']);
    const lost = checkConservation({
      index: idx,
      registry: reg,
      emitted: new Set(['e2', 'e3', 'e7', 'e8']),
      reached: new Set(),
      hidden: new Set(),
      rest: [],
      lists: new Map([
        [
          'e3',
          {
            seen: new Set(['a']),
            empty: new Set(),
            order: ['a'],
            overflow: 0,
          } as never,
        ],
      ]),
    });
    expect(lost.ok).toBe(false);
    expect(lost.lists[0]).toEqual({
      listId: 'e3',
      members: 3,
      covered: 1,
      empty: 0,
    });
  });

  it('a record that rendered nothing is not covered by its key (B2)', () => {
    const members = ['a', 'b', 'c'].map((id) => {
      const li = document.createElement('li');
      li.id = id;
      return li;
    });
    const reg = registry(nodes, members);
    const idx = indexSkeleton(skeleton(nodes), reg);
    const report = checkConservation({
      index: idx,
      registry: reg,
      emitted: new Set(['e2', 'e3', 'e7', 'e8']),
      reached: new Set(),
      hidden: new Set(),
      rest: [],
      lists: new Map([
        [
          'e3',
          {
            seen: new Set(['a', 'b', 'c']),
            empty: new Set(['b', 'c']),
            order: ['a', 'b', 'c'],
            overflow: 0,
          } as never,
        ],
      ]),
    });
    expect(report.ok).toBe(false);
    expect(report.lists[0]).toEqual({
      listId: 'e3',
      members: 3,
      covered: 1,
      empty: 2,
    });
  });
});

describe('product price', () => {
  it("reads the Product offer price from the page's JSON-LD", () => {
    document.head.innerHTML =
      '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Product","offers":[{"@type":"Offer","price":"1299.00"}]}]}</script>';
    expect(jsonLdPrice(document)).toBe(1299);
    document.head.innerHTML =
      '<script type="application/ld+json">{not json</script>';
    expect(jsonLdPrice(document)).toBeNull();
  });
});

describe('restructure helpers (docs/11)', () => {
  it('takes the site out of the document title', () => {
    expect(titleFromDocument('accessibility - YouTube', 'youtube.com')).toBe(
      'accessibility',
    );
    expect(
      titleFromDocument("Fitts's law - Wikipedia", 'en.wikipedia.org'),
    ).toBe("Fitts's law");
    expect(
      titleFromDocument('Amazon.com : reading glasses', 'amazon.com'),
    ).toBe('reading glasses');
    expect(titleFromDocument('Inbox (3)', 'mail.example')).toBe('Inbox (3)');
  });

  it('strips separators the site drew as text', () => {
    expect(stripLead('- Coastline')).toBe('Coastline');
    expect(stripLead('• 3 days ago')).toBe('3 days ago');
    expect(stripLead(' · ')).toBe('');
    expect(stripLead('-17%')).toBe('-17%');
    expect(stripLead('·Sponsored')).toBe('Sponsored');
    expect(stripLead('Plain')).toBe('Plain');
  });

  const ctxWith = (structure: Partial<FitLayout['structure']>): RenderCtx =>
    ({
      doc: document,
      skeleton: { lang: 'en' },
      layout: { structure: { splitSentences: null, ...structure } },
    }) as unknown as RenderCtx;

  it('splits a long paragraph at sentence ends, never inside a link', () => {
    const p = document.createElement('p');
    p.append(
      'One two three four five six seven. Eight nine ten eleven twelve. Thirteen ',
      Object.assign(document.createElement('a'), {
        textContent: 'fourteen. Fifteen',
      }),
      ' sixteen seventeen. Eighteen nineteen twenty twenty-one. Twenty-two twenty-three.',
    );
    const out = splitParagraph(ctxWith({ splitSentences: 1 }), p);
    const paras = Array.from(
      (out as DocumentFragment).childNodes,
    ) as HTMLElement[];
    // One sentence per paragraph, except where a sentence ends inside the
    // link: that cut moves to the next sentence end.
    expect(paras.map((x) => x.textContent)).toEqual([
      'One two three four five six seven.',
      'Eight nine ten eleven twelve.',
      'Thirteen fourteen. Fifteen sixteen seventeen.',
      'Eighteen nineteen twenty twenty-one.',
      'Twenty-two twenty-three.',
    ]);
    expect(paras[2]?.querySelector('a')?.textContent).toBe('fourteen. Fifteen');
  });

  it('leaves short paragraphs and other people alone', () => {
    const short = document.createElement('p');
    short.textContent = 'One. Two. Three. Four.';
    expect(splitParagraph(ctxWith({ splitSentences: 2 }), short)).toBe(short);
    const long = document.createElement('p');
    long.textContent = 'A sentence that is long enough to count. '.repeat(8);
    expect(splitParagraph(ctxWith({ splitSentences: null }), long)).toBe(long);
  });

  it('one template per list: title, two facts, one action, the rest in details', () => {
    const slots = [
      node('e2', 'e1', 'group', { slot: true }),
      node('e3', 'e2', 'media', { slot: true }),
      node('e4', 'e2', 'heading', { slot: true }),
      node('e5', 'e2', 'stext', { slot: true }),
      node('e6', 'e2', 'stext', { slot: true }),
      node('e7', 'e2', 'stext', { slot: true }),
      node('e8', 'e2', 'control', { slot: true }),
      node('e9', 'e2', 'control', { slot: true }),
    ];
    const ctx = {
      index: {
        nodes: new Map(slots.map((n) => [n.id, n])),
        order: new Map(slots.map((n, i) => [n.id, i])),
      },
      layout: { structure: { level: 0 } },
    } as unknown as RenderCtx;
    const spec: SpecCollection = {
      list_id: 'e1',
      item_kind: 'product',
      open_slot: 'e4',
      card: 'tile',
      media: 'square',
      lead: 'none',
      fields: [
        { slot_id: 'e3', role: 'thumbnail', show: 'always' },
        { slot_id: 'e4', role: 'title', show: 'always' },
        { slot_id: 'e5', role: 'meta', show: 'always' },
        { slot_id: 'e6', role: 'rating', show: 'always' },
        { slot_id: 'e7', role: 'price', show: 'always' },
        { slot_id: 'e8', role: 'primary_action', show: 'always' },
        { slot_id: 'e9', role: 'overflow_menu', show: 'always' },
      ],
    };
    const t = recordTemplate(ctx, spec, 4 / 3);
    expect(t.thumb?.slot_id).toBe('e3');
    expect(t.title?.slot_id).toBe('e4');
    // A product leads with its price, then its rating (docs/11 R7).
    expect(t.facts.map((f) => f.role)).toEqual(['price', 'rating']);
    expect(t.action?.slot_id).toBe('e8');
    expect(t.more.map((f) => f.role)).toEqual(['meta', 'overflow_menu']);
    // The list's shape decides the picture; a spec without one (written
    // before docs/12) keeps the measured ratio.
    expect(t.ratio).toBe('1 / 1');
    const old = { ...spec } as Partial<SpecCollection>;
    delete old.card;
    delete old.media;
    delete old.lead;
    expect(recordTemplate(ctx, old as SpecCollection, 4 / 3).ratio).toBe(
      '133 / 100',
    );
    // Rows carry a square picture; media none has no picture slot.
    expect(recordTemplate(ctx, { ...spec, card: 'row' }, 16 / 9).ratio).toBe(
      '1 / 1',
    );
    expect(recordTemplate(ctx, { ...spec, media: 'none' }, null).thumb).toBe(
      null,
    );
  });

  it('a tile reads its badge above the title; a video card keeps a visible menu by its title', () => {
    const slots = [
      node('e2', 'e1', 'group', { slot: true }),
      node('e3', 'e2', 'heading', { slot: true }),
      node('e4', 'e2', 'stext', { slot: true }),
      node('e5', 'e2', 'stext', { slot: true }),
      node('e6', 'e2', 'control', { slot: true }),
      node('e7', 'e2', 'control', { slot: true, flags: ['hoveronly'] }),
    ];
    const ctx = {
      index: {
        nodes: new Map(slots.map((n) => [n.id, n])),
        order: new Map(slots.map((n, i) => [n.id, i])),
      },
      layout: { structure: { level: 0 } },
    } as unknown as RenderCtx;
    const fields: SpecCollection['fields'] = [
      { slot_id: 'e3', role: 'title', show: 'always' },
      { slot_id: 'e4', role: 'badge', show: 'always' },
      { slot_id: 'e5', role: 'price', show: 'always' },
      { slot_id: 'e6', role: 'overflow_menu', show: 'always' },
    ];
    const tile = recordTemplate(
      ctx,
      {
        list_id: 'e1',
        item_kind: 'product',
        open_slot: null,
        card: 'tile',
        media: 'none',
        lead: 'none',
        fields,
      },
      null,
    );
    expect(tile.eyebrow?.role).toBe('badge');
    expect(tile.facts.map((f) => f.role)).toEqual(['price']);
    expect(tile.menu).toBeNull();
    const video = recordTemplate(
      ctx,
      {
        list_id: 'e1',
        item_kind: 'video',
        open_slot: null,
        card: 'media',
        media: 'landscape',
        lead: 'none',
        fields,
      },
      null,
    );
    expect(video.eyebrow).toBeNull();
    expect(video.menu?.slot_id).toBe('e6');
    // A menu the page shows only on hover waits with the details.
    const hover = recordTemplate(
      ctx,
      {
        list_id: 'e1',
        item_kind: 'video',
        open_slot: null,
        card: 'media',
        media: 'landscape',
        lead: 'none',
        fields: [
          ...fields.slice(0, 3),
          { slot_id: 'e7', role: 'overflow_menu', show: 'always' },
        ],
      },
      null,
    );
    expect(hover.menu).toBeNull();
    expect(hover.more.map((f) => f.role)).toEqual(['overflow_menu']);
  });
});

describe('players in a section', () => {
  it('become one quiet line per section where the first one was', () => {
    const col = document.createElement('div');
    const shown: Array<string | null> = [];
    const ctx = {
      doc: document,
      index: { children: new Map(), nodes: new Map() },
      actions: { showOnPage: (id: string | null) => shown.push(id) },
      emit: () => undefined,
      reach: () => undefined,
    } as unknown as RenderCtx;
    const card = (label: string, kind: string, id: string): HTMLElement => {
      const c = onPageCard(ctx, id, null, label);
      c.dataset.player = kind;
      return c;
    };
    const h2 = (t: string): HTMLElement => {
      const e = document.createElement('h2');
      e.textContent = t;
      return e;
    };
    const ul = document.createElement('ul');
    for (const id of ['v2', 'v3']) {
      const li = document.createElement('li');
      li.append(card('Video', 'video', id));
      ul.append(li);
    }
    const p = document.createElement('p');
    p.textContent = 'Text';
    col.append(
      h2('Capture'),
      card('Video', 'video', 'v1'),
      ul,
      p,
      h2('Listen'),
      card('Play video of a city walk', 'video', 'v4'),
      h2('Ask'),
      card('Audio', 'audio', 'a1'),
    );
    quietPlayers(ctx, col);
    expect(col.querySelectorAll('.fv-onpage').length).toBe(0);
    expect(
      Array.from(col.querySelectorAll('.fv-quiet')).map((l) => l.textContent),
    ).toEqual([
      '3 videosWatch on the page',
      '1 videoWatch on the page',
      '1 audio clipListen on the page',
    ]);
    expect(col.querySelectorAll('li, ul').length).toBe(0);
    // The line's button shows the first player of its section on the page.
    (col.querySelector('.fv-quiet button') as HTMLButtonElement).click();
    expect(shown).toEqual(['v1']);
    expect(
      col.querySelector('.fv-quiet button')?.getAttribute('aria-label'),
    ).toBe('Watch on the page: 3 videos');
  });
});

describe('product facts', () => {
  it('read the current price, and stars with their count', () => {
    expect(leadPrice('CAD 18.41 ( CAD 3.68 /count) Typical: CAD 19.83')).toBe(
      'CAD 18.41',
    );
    expect(leadPrice('CAD18.41')).toBe('CAD18.41');
    // A text that does not lead with a price keeps its words.
    expect(leadPrice('Save CAD 2.83 with CAD 1.00 off')).toBe(
      'Save CAD 2.83 with CAD 1.00 off',
    );
    expect(ratingText('4.4 out of 5 stars, rating details')).toBe('4.4 ★');
    expect(ratingText('Rated 4,5/5')).toBe('4,5 ★');
    expect(ratingText('Top rated')).toBe('Top rated');
    expect(countText('(2.4K)')).toBe('2.4K');
    expect(countText('1,460 ratings')).toBe('1,460');
    expect(countText('2,466 global ratings')).toBe('2,466');
  });
});

describe('Showroom sections (docs/12 §6.1)', () => {
  const s = (
    kind: SpecSection['kind'],
    layout: string,
  ): Pick<SpecSection, 'kind' | 'layout'> => ({
    kind,
    layout: layout as SpecSection['layout'],
  });

  it('keeps known layouts, maps older names, and falls back to the kind', () => {
    expect(layoutOf(s('main_list', 'card_grid'))).toBe('card_grid');
    expect(layoutOf(s('main_list', 'grid'))).toBe('card_grid');
    expect(layoutOf(s('comments', 'list'))).toBe('row_list');
    expect(layoutOf(s('tabs', 'compact_row'))).toBe('chip_bar');
    expect(layoutOf(s('filters', 'collapsed_menu'))).toBe('menu');
    // A folded footer becomes a grid of links.
    expect(layoutOf(s('footer', 'collapsed_menu'))).toBe('link_grid');
    expect(layoutOf(s('product_detail', 'single_column'))).toBe('buy_box');
    expect(layoutOf(s('feature_blocks', 'single_column'))).toBe('spotlight');
    // "single_column" drew a section in the view, never as is.
    expect(layoutOf(s('consent', 'single_column'))).toBe('reading');
    expect(layoutOf(s('form', 'whatever'))).toBe('form_panel');
  });

  const ctx = { doc: document } as unknown as RenderCtx;
  const pill = (text: string): PillItem => {
    const a = document.createElement('a');
    a.href = `https://a.test/${text}`;
    a.className = 'fv-pill';
    a.textContent = text;
    return { kind: 'control', el: a };
  };
  const head = (text: string): PillItem => {
    const el = document.createElement('h3');
    el.className = 't-title cue fv-heading';
    el.textContent = text;
    return { kind: 'label', el };
  };

  it('draws links as the rows of one grouped list, each with a chevron', () => {
    const box = linkRows(ctx, [pill('Help'), pill('Contact'), head('More')]);
    const rows = Array.from(box.querySelectorAll('ul.fv-rows > li.fv-row'));
    expect(rows.length).toBe(2);
    const a = rows[0]?.querySelector('a') as HTMLAnchorElement;
    expect(a.className).toBe('fv-listlink');
    expect(a.textContent).toBe('Help');
    expect(a.querySelector('svg.fv-chev')).not.toBeNull();
    expect(box.lastElementChild?.localName).toBe('h3');
  });

  it('draws a footer as columns under their headings, quiet links', () => {
    const grid = linkGrid(ctx, [
      head('Shop'),
      pill('Mac'),
      pill('iPad'),
      head('Help'),
      pill('Support'),
    ]);
    const groups = Array.from(grid.querySelectorAll('.fv-linkgrid__group'));
    expect(groups.map((g) => g.querySelector('h3')?.textContent)).toEqual([
      'Shop',
      'Help',
    ]);
    expect(groups[0]?.querySelectorAll('a.fv-gridlink').length).toBe(2);
    expect(groups[0]?.querySelector('h3')?.className).toBe(
      'fv-linkgrid__head t-body',
    );
    // Without headings the links flow into the columns themselves.
    const flat = linkGrid(ctx, [pill('Privacy'), pill('Terms')]);
    expect(flat.querySelectorAll('ul.fv-linkgrid > li > a').length).toBe(2);
  });

  it('a drawer is a card toggle named "Site links (12)", rendered when opened', () => {
    let n = 0;
    const reached: string[] = [];
    const dctx = {
      doc: document,
      uid: (p: string) => `${p}${++n}`,
      reach: (id: string) => reached.push(id),
    } as unknown as RenderCtx;
    let built = 0;
    const d = cardDisclosure(dctx, {
      title: 'Site links',
      count: 12,
      reach: ['e1', 'e2'],
      render: () => {
        built++;
        return document.createElement('ul');
      },
    });
    const b = d.querySelector('button.fv-wa') as HTMLButtonElement;
    expect(b.textContent).toBe('Site links (12)');
    expect(b.querySelector('.fv-drawer__title.t-title')?.textContent).toBe(
      'Site links',
    );
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(reached).toEqual(['e1', 'e2']);
    expect(built).toBe(0);
    b.click();
    b.click();
    b.click();
    expect(built).toBe(1);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    const body = d.querySelector('.fv-collapsed') as HTMLElement;
    expect(body.hidden).toBe(false);
    expect(b.getAttribute('aria-controls')).toBe(body.id);
  });
});

describe('Showroom records (docs/12 §6.2)', () => {
  /** A layout like the solver's at F = 18, T = 44. */
  const fit = (): FitLayout =>
    ({
      type: {
        pageHeading: { px: 45, weight: 600, cue: 'none' },
        sectionHeading: { px: 31.5, weight: 600, cue: 'none' },
        title: { px: 22.5, weight: 600, cue: 'none' },
        body: { px: 18, weight: 400, cue: 'none' },
        meta: { px: 18, weight: 400, cue: 'none' },
        lineHeight: 1.5,
        wordSpacingEm: 0,
        letterSpacingEm: 0,
        maxLineCh: 66,
        minLineCh: 13,
        font: 'system',
      },
      target: { minPx: 44, gapPx: 9, controlPx: 44 },
      space: {
        unitPx: 14,
        groupGapPx: 35,
        sectionGapPx: 42,
        cardPadPx: 14,
        pagePadPx: 16,
        maxContentPx: 1200,
      },
      grid: {
        card_media: { minWidthPx: 226, maxCols: 4 },
        card_text: { minWidthPx: 288, maxCols: 3 },
        row: { minWidthPx: 0, maxCols: 1 },
      },
      groupEvery: 6,
      structure: {
        level: 0,
        listFirst: null,
        groupEvery: 6,
        splitSentences: null,
        outline: false,
        sectionsOpen: null,
      },
      nav: { inlineMax: 8 },
      tertiary: 'collapsed',
      palette: { scheme: 'light', contrast: 'standard' },
      motion: 'allow',
    }) as unknown as FitLayout;

  /**
   * A list e1 of `n` records built from one exemplar: picture e3, title e4
   * (its link e5), a line e6 and a control e7. Members carry data-slot.
   */
  function list(
    n: number,
    collection: Partial<SpecCollection> & Pick<SpecCollection, 'item_kind'>,
    e7: Partial<SkeletonNode> = {},
  ): { ctx: RenderCtx; bound: string[] } {
    const nodes = [
      node('e0', null, 'landmark'),
      node('e1', 'e0', 'collection', {
        collection: { count: n, itemTag: 'li', exemplar: 'e2' },
      }),
      node('e2', 'e1', 'group', { slot: true }),
      node('e3', 'e2', 'media', {
        slot: true,
        tag: 'img',
        box: [0, 0, 320, 180],
      }),
      node('e4', 'e2', 'heading', { slot: true, level: 3 }),
      node('e5', 'e4', 'control', {
        slot: true,
        tag: 'a',
        role: 'link',
        href: 'same',
      }),
      node('e6', 'e2', 'stext', { slot: true }),
      node('e7', 'e2', 'control', { slot: true, tag: 'button', ...e7 }),
    ];
    const members = Array.from({ length: n }, (_, i) => {
      const li = document.createElement('li');
      li.id = `m${i}`;
      const img = document.createElement('img');
      img.dataset.slot = 'e3';
      const h3 = document.createElement('h3');
      h3.dataset.slot = 'e4';
      const a = document.createElement('a');
      a.dataset.slot = 'e5';
      a.href = `https://a.test/item/${i}`;
      a.textContent = `Item ${i}`;
      h3.append(a);
      const p = document.createElement('p');
      p.dataset.slot = 'e6';
      p.textContent = `Line ${i}`;
      const b = document.createElement('button');
      b.dataset.slot = 'e7';
      b.textContent = 'Add to cart';
      li.append(img, h3, p, b);
      return li;
    });
    const base = registry(nodes, members);
    const reg: SkeletonRegistry = {
      ...base,
      members: () => members,
      slot: (_l, m, id) => m.querySelector(`[data-slot="${id}"]`),
      text: (el) => el.textContent ?? '',
      name: (el) => el.getAttribute('aria-label') ?? el.textContent ?? '',
      media: (): MediaInfo => ({
        src: 'https://a.test/p.jpg',
        srcset: null,
        width: 320,
        height: 180,
        alt: '',
      }),
    };
    const sk = skeleton(nodes);
    const emitted = new Set<string>();
    const bound: string[] = [];
    let uid = 0;
    const spec: SpecCollection = {
      list_id: 'e1',
      open_slot: 'e5',
      fields: [
        { slot_id: 'e3', role: 'thumbnail', show: 'always' },
        { slot_id: 'e4', role: 'title', show: 'always' },
        { slot_id: 'e6', role: 'author_or_channel', show: 'always' },
        {
          slot_id: 'e7',
          role:
            collection.item_kind === 'video'
              ? 'overflow_menu'
              : 'primary_action',
          show: 'always',
        },
      ],
      card: 'row',
      media: 'square',
      lead: 'none',
      ...collection,
    };
    const ctx = {
      doc: document,
      skeleton: sk,
      index: indexSkeleton(sk, reg),
      registry: reg,
      layout: fit(),
      zoom: 1,
      validated: {},
      collections: new Map([['e1', spec]]),
      actions: { showOnPage: () => undefined },
      bind: (_c: HTMLElement, t: { id: string }) => bound.push(t.id),
      emit: (id: string) => emitted.add(id),
      isEmitted: (id: string) => emitted.has(id),
      reach: () => undefined,
      hide: () => undefined,
      uid: (p: string) => `${p}${++uid}`,
      scope: null,
      hasH1: false,
      titleEl: null,
      mirror: () => undefined,
    } as unknown as RenderCtx;
    return { ctx, bound };
  }
  const draw = (ctx: RenderCtx, layout = 'card_grid') =>
    renderCollection(ctx, 'e1', {
      kindHint: null,
      sectionLayout: layout,
      scroller: null,
    });

  it('videos are a grid of 16:9 media cards, the first leading two columns wide', () => {
    const { ctx } = list(8, {
      item_kind: 'video',
      card: 'media',
      media: 'landscape',
      lead: 'first',
    });
    const lv = draw(ctx);
    expect(lv.card).toBe('media');
    expect(lv.root.dataset.card).toBe('media');
    expect(lv.root.classList.contains('has-lead')).toBe(true);
    const groups = Array.from(lv.root.querySelectorAll('ul.fv-grid'));
    // Three columns at 1024 px: the lead takes two places in the first group.
    expect(lv.root.style.getPropertyValue('--fv-cols')).toBe('3');
    expect(groups.map((g) => g.children.length)).toEqual([5, 3]);
    const first = groups[0]?.firstElementChild as HTMLElement;
    expect(first.className).toBe('fv-rec fv-card fv-card--media is-lead');
    expect(first.dataset.card).toBe('media');
    expect(first.querySelector('.fv-thumb')?.getAttribute('data-ar')).toBe(
      '16 / 9',
    );
    // The menu is one round icon button by the title, named by the site.
    const menu = first.querySelector(
      '.fv-rec__head > .fv-btn--icon',
    ) as HTMLElement;
    expect(menu.textContent).toBe('Add to cart');
    expect(menu.querySelector('.fv-sr')?.textContent).toBe('Add to cart');
    expect(first.querySelector('.fv-facts')?.textContent).toBe('Line 0');
    // The picture opens the item without being a second tab stop.
    const open = first.querySelector('a.fv-thumb-open') as HTMLElement;
    expect(open.getAttribute('aria-hidden')).toBe('true');
    expect(open.tabIndex).toBe(-1);
  });

  it('a media card list never turns into rows, and leads only with two columns', () => {
    const { ctx } = list(3, {
      item_kind: 'video',
      card: 'media',
      media: 'landscape',
      lead: 'first',
    });
    Object.defineProperty(window, 'innerWidth', {
      value: 300,
      configurable: true,
    });
    try {
      const lv = draw(ctx, 'row_list');
      expect(lv.grid).toBe('card_media');
      expect(lv.root.querySelectorAll('ul.fv-grid > li.fv-card').length).toBe(
        3,
      );
      expect(lv.root.querySelector('.is-lead')).toBeNull();
      expect(lv.root.classList.contains('has-lead')).toBe(false);
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        value: 1024,
        configurable: true,
      });
    }
  });

  it('products (a spec without a card) are tiles: the picture whole, the action blue text', () => {
    const { ctx } = list(4, { item_kind: 'product' });
    const spec = ctx.collections.get('e1') as Partial<SpecCollection>;
    delete spec.card;
    delete spec.media;
    delete spec.lead;
    const lv = draw(ctx);
    expect(lv.card).toBe('tile');
    expect(lv.spec.media).toBe('landscape');
    const li = lv.root.querySelector('li.fv-rec') as HTMLElement;
    expect(li.className).toBe('fv-rec fv-card fv-card--tile');
    expect(li.querySelector('.fv-thumb')?.classList).toContain(
      'fv-thumb--contain',
    );
    const act = li.querySelector('.fv-rec__side > .fv-btn') as HTMLElement;
    expect(act.classList).toContain('fv-btn--link');
    expect(act.classList).not.toContain('fv-btn--fill');
    expect(act.querySelector('svg')).not.toBeNull();
  });

  it('messages are rows of one grouped list: sender and time, then the subject', () => {
    const { ctx, bound } = list(3, {
      item_kind: 'message',
      card: 'message',
      media: 'none',
    });
    const lv = draw(ctx, 'row_list');
    expect(lv.grid).toBe('row');
    const rows = Array.from(lv.root.querySelectorAll('ul.fv-rows > li'));
    expect(rows.length).toBe(3);
    const r = rows[0] as HTMLElement;
    expect(r.className).toBe('fv-rec fv-row fv-row--message');
    expect(r.querySelector('.fv-thumb')).toBeNull();
    const top = r.querySelector('.fv-rec__body > .fv-msg__top') as HTMLElement;
    expect(top.querySelector('.fv-dot')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(top.querySelector('.fv-msg__from.t-title')?.textContent).toBe(
      'Line 0',
    );
    expect(r.querySelector('h3')?.className).toBe('fv-rec-title t-body');
    expect(r.querySelector('h3 a')?.textContent).toBe('Item 0');
    // Every control is handed to the live layer.
    expect(bound.filter((id) => id === 'e5').length).toBeGreaterThanOrEqual(3);
    expect(bound).toContain('e7');
  });
});
