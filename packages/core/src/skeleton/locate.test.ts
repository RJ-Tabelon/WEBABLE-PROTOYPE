import { describe, expect, it } from 'vitest';

import type { PageSpec, ValidatedSpec } from '../compose/spec';
import { SKELETON_VERSION } from '../versions';
import { fromStoredSpec, nameKey, toStoredSpec } from './locate';
import type { Skeleton, SkeletonNode } from './types';

/** Stand-in for the worker's keyed HMAC: a seeded FNV-1a, hex. */
const hmac = (label: string): string => {
  let h = 0x811c9dc5 ^ 0x5eed;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `h${h.toString(16).padStart(8, '0')}`;
};

const meta = { schema: 'wa-compose-2.0.0', model: 'gpt-6-sol', createdAt: 1 };

interface Spec {
  tag?: SkeletonNode['tag'];
  role?: SkeletonNode['role'];
  kind?: SkeletonNode['kind'];
  label?: string;
  slot?: true;
  /** Collection: item count and the index (in `kids`) of the exemplar. */
  list?: { count: number; itemTag: SkeletonNode['tag'] };
  key?: string;
  kids?: Spec[];
}

/**
 * Build a skeleton from a nested description. Ids are assigned in document
 * order starting at `start`, so the same page read twice with a different
 * start (an extra node earlier) gets different ids. `keys` maps each spec
 * `key` to its id.
 */
function build(
  root: Spec,
  start = 1,
): { skeleton: Skeleton; keys: Record<string, string> } {
  const nodes: SkeletonNode[] = [];
  const keys: Record<string, string> = {};
  let next = start;
  const walk = (s: Spec, parent: string | null, depth: number): string => {
    const id = `e${next++}`;
    const n: SkeletonNode = {
      id,
      parent,
      depth,
      tag: s.tag ?? 'div',
      role: s.role ?? null,
      kind: s.kind ?? 'group',
      box: [0, 0, 100, 20],
      flags: [],
      ...(s.label !== undefined ? { label: s.label } : {}),
      ...(s.slot ? { slot: true as const } : {}),
    };
    nodes.push(n);
    if (s.key) keys[s.key] = id;
    const kidIds = (s.kids ?? []).map((k) => walk(k, id, depth + 1));
    if (s.list)
      n.collection = {
        count: s.list.count,
        itemTag: s.list.itemTag,
        exemplar: kidIds[0]!,
      };
    return id;
  };
  walk(root, null, 0);
  return {
    skeleton: {
      v: 1,
      version: SKELETON_VERSION,
      extractionId: `x${start}`,
      viewport: { width: 1280, height: 800, zoom: 1 },
      doc: { width: 1280, height: 6000 },
      lang: 'en',
      nodes,
      truncated: false,
      structure: 's',
      typed: [],
      perf: { ms: 1, nodes: nodes.length },
    },
    keys,
  };
}

/** A YouTube-like channel page; `opts` vary what changes between page views. */
function channel(
  opts: {
    title?: string;
    ad?: boolean;
    navExtra?: boolean;
    items?: number;
    subscribers?: string;
  } = {},
): Spec {
  const video = (n: number): Spec => ({
    tag: 'custom',
    slot: true,
    key: n === 0 ? 'item' : undefined,
    kids: [
      {
        tag: 'a',
        role: 'link',
        kind: 'control',
        slot: true,
        key: n === 0 ? 'thumb' : undefined,
        label: `Video ${n} thumbnail`,
      },
      {
        tag: 'h3',
        role: 'heading',
        kind: 'heading',
        slot: true,
        kids: [
          {
            tag: 'a',
            role: 'link',
            kind: 'control',
            slot: true,
            key: n === 0 ? 'title' : undefined,
            label: `Private title ${n} quillon`,
          },
        ],
      },
      {
        tag: 'span',
        kind: 'stext',
        slot: true,
        key: n === 0 ? 'meta' : undefined,
        label: '1.2M views',
      },
      {
        tag: 'span',
        kind: 'stext',
        slot: true,
        key: n === 0 ? 'dur' : undefined,
        label: '12:04',
      },
    ],
  });
  return {
    tag: 'body',
    kids: [
      ...(opts.ad
        ? [{ tag: 'iframe', kind: 'media', label: 'Ad' } as Spec]
        : []),
      {
        tag: 'custom',
        role: 'banner',
        kind: 'landmark',
        key: 'banner',
        kids: [
          {
            tag: 'input',
            role: 'combobox',
            kind: 'input',
            key: 'search',
            label: 'Search',
          },
          {
            tag: 'a',
            role: 'link',
            kind: 'control',
            key: 'signin',
            label: 'Sign in',
          },
        ],
      },
      {
        tag: 'nav',
        role: 'navigation',
        kind: 'landmark',
        key: 'nav',
        kids: [
          ...(opts.navExtra
            ? [
                {
                  tag: 'a',
                  role: 'link',
                  kind: 'control',
                  label: 'Live',
                } as Spec,
              ]
            : []),
          {
            tag: 'a',
            role: 'link',
            kind: 'control',
            key: 'home',
            label: 'Home',
          },
          {
            tag: 'a',
            role: 'link',
            kind: 'control',
            key: 'shorts',
            label: 'Shorts',
          },
          {
            tag: 'a',
            role: 'link',
            kind: 'control',
            key: 'subs',
            label: 'Subscriptions',
          },
        ],
      },
      {
        tag: 'main',
        role: 'main',
        kind: 'landmark',
        key: 'main',
        kids: [
          {
            tag: 'h1',
            role: 'heading',
            kind: 'heading',
            key: 'h1',
            label: opts.title ?? 'Veritasium',
          },
          {
            tag: 'span',
            kind: 'stext',
            key: 'subscribers',
            label: opts.subscribers ?? '16.9M subscribers',
          },
          {
            tag: 'div',
            kind: 'collection',
            key: 'grid',
            list: { count: opts.items ?? 60, itemTag: 'custom' },
            kids: [video(0)],
          },
        ],
      },
    ],
  };
}

function specFor(keys: Record<string, string>): ValidatedSpec {
  const k = (name: string): string => keys[name]!;
  const spec: PageSpec = {
    v: 1,
    page_type: 'channel_or_profile',
    primary_task: 'browse_and_choose',
    sections: [
      {
        kind: 'header',
        importance: 'secondary',
        node_ids: [k('banner')],
        heading_ref: null,
        layout: 'chip_bar',
      },
      {
        kind: 'search',
        importance: 'secondary',
        node_ids: [k('search')],
        heading_ref: null,
        layout: 'as_is',
      },
      {
        kind: 'account_and_cart',
        importance: 'secondary',
        node_ids: [k('signin')],
        heading_ref: null,
        layout: 'chip_bar',
      },
      {
        kind: 'primary_nav',
        importance: 'secondary',
        node_ids: [k('home'), k('shorts'), k('subs')],
        heading_ref: null,
        layout: 'chip_bar',
      },
      {
        kind: 'page_heading',
        importance: 'secondary',
        node_ids: [k('h1'), k('subscribers')],
        heading_ref: k('h1'),
        layout: 'hero',
      },
      {
        kind: 'main_list',
        importance: 'primary',
        node_ids: [k('grid')],
        heading_ref: k('h1'),
        layout: 'card_grid',
      },
    ],
    collections: [
      {
        list_id: k('grid'),
        item_kind: 'video',
        open_slot: k('title'),
        card: 'media',
        media: 'landscape',
        lead: 'first',
        fields: [
          { slot_id: k('thumb'), role: 'thumbnail', show: 'always' },
          { slot_id: k('title'), role: 'title', show: 'always' },
          { slot_id: k('meta'), role: 'meta', show: 'always' },
          { slot_id: k('dur'), role: 'duration', show: 'always' },
        ],
      },
    ],
  };
  return { spec, primary: 5, rest: [], repairs: [] };
}

describe('locators', () => {
  it('stores no ids and no labels: structural paths, kinds and name hashes only', () => {
    const a = build(channel());
    const hashed: string[] = [];
    const stored = toStoredSpec(
      specFor(a.keys),
      a.skeleton,
      (l) => {
        hashed.push(l);
        return hmac(l);
      },
      meta,
    );
    const json = JSON.stringify(stored);
    expect(json).not.toMatch(/"e\d+"/);
    for (const label of [
      'Veritasium',
      'Sign in',
      'Private title',
      'quillon',
      'Home',
    ])
      expect(json).not.toContain(label);
    // Record labels (inside the list) are never even hashed; numbers are folded first.
    expect(
      hashed.some((l) => l.includes('quillon') || l.includes('thumbnail')),
    ).toBe(false);
    expect(hashed).toContain('#m subscribers');
    expect(stored.sections[3]?.nodes.map((l) => l.path.at(-1))).toEqual([
      'a[link]:0',
      'a[link]:1',
      'a[link]:2',
    ]);
    expect(stored.sections[1]?.nodes[0]).toEqual({
      path: ['body', 'custom[banner]', 'input[combobox]'],
      kind: 'input',
      name: hmac('search'),
    });
    // Field slots: the list's path plus steps below the exemplar root.
    const title = stored.collections[0]?.fields[1]?.slot;
    expect(title).toEqual({
      path: ['body', 'main[main]', 'div'],
      kind: 'control',
      slot: ['h3[heading]', 'a[link]'],
    });
    expect(stored.collections[0]?.open).toEqual(title);
    // The art direction travels with the template.
    expect(stored.collections[0]).toMatchObject({
      card: 'media',
      media: 'landscape',
      lead: 'first',
    });
    expect(stored).toMatchObject({ ...meta, page_type: 'channel_or_profile' });
  });

  it('round-trips on the same page with full coverage', () => {
    const a = build(channel());
    const stored = toStoredSpec(specFor(a.keys), a.skeleton, hmac, meta);
    const back = fromStoredSpec(stored, a.skeleton, hmac);
    expect(back.coverage).toBe(1);
    expect(back.spec).toEqual(specFor(a.keys).spec);
  });

  it('re-binds to the next page of the same template (new ids, title, counts, an ad)', () => {
    const a = build(channel());
    const stored = toStoredSpec(specFor(a.keys), a.skeleton, hmac, meta);
    const b = build(
      channel({
        title: 'Kurzgesagt',
        ad: true,
        items: 12,
        subscribers: '23M subscribers',
      }),
      40,
    );
    const back = fromStoredSpec(stored, b.skeleton, hmac);
    expect(back.coverage).toBe(1);
    expect(back.spec).toEqual(specFor(b.keys).spec);
  });

  it('a named node survives a sibling inserted before it; ambiguity is never guessed', () => {
    const a = build(channel());
    const stored = toStoredSpec(specFor(a.keys), a.skeleton, hmac, meta);
    const b = build(channel({ navExtra: true }), 7);
    const back = fromStoredSpec(stored, b.skeleton, hmac);
    expect(back.spec.sections[3]?.node_ids).toEqual([
      b.keys.home,
      b.keys.shorts,
      b.keys.subs,
    ]);
    // Without names, an index-shifted path is taken as is, and a path that
    // now has several equal candidates resolves to nothing.
    const unnamed = (s: typeof stored) =>
      JSON.parse(JSON.stringify(s, (k, v) => (k === 'name' ? undefined : v)));
    const blind = fromStoredSpec(unnamed(stored), b.skeleton, hmac);
    expect(blind.spec.sections[3]?.node_ids).not.toEqual([
      b.keys.home,
      b.keys.shorts,
      b.keys.subs,
    ]);
    const lone = build(channel());
    const loneStored = toStoredSpec(
      {
        ...specFor(lone.keys),
        spec: {
          ...specFor(lone.keys).spec,
          sections: [
            {
              kind: 'header',
              importance: 'secondary',
              node_ids: [lone.keys.banner!],
              heading_ref: null,
              layout: 'as_is',
            },
          ],
          collections: [],
        },
      },
      lone.skeleton,
      hmac,
      meta,
    );
    // Two banners now: same loose path, no name, no exact path.
    const twin = build({
      tag: 'body',
      kids: [
        { tag: 'div' },
        { tag: 'custom', role: 'banner', kind: 'landmark' },
        { tag: 'custom', role: 'banner', kind: 'landmark' },
      ],
    });
    const none = fromStoredSpec(loneStored, twin.skeleton, hmac);
    expect(none.spec.sections).toEqual([]);
    expect(none.coverage).toBe(0);
  });

  it('a different page resolves little, and unresolved parts are dropped', () => {
    const a = build(channel());
    const stored = toStoredSpec(specFor(a.keys), a.skeleton, hmac, meta);
    const article = build({
      tag: 'body',
      kids: [
        {
          tag: 'header',
          role: 'banner',
          kind: 'landmark',
          kids: [{ tag: 'a', role: 'link', kind: 'control', label: 'Sign in' }],
        },
        {
          tag: 'main',
          role: 'main',
          kind: 'landmark',
          kids: [
            {
              tag: 'h1',
              role: 'heading',
              kind: 'heading',
              label: 'An article',
            },
            { tag: 'p', kind: 'text' },
          ],
        },
      ],
    });
    const back = fromStoredSpec(stored, article.skeleton, hmac);
    expect(back.coverage).toBeLessThan(0.8);
    expect(back.spec.collections).toEqual([]);
    // "Sign in" is found by its name alone, anywhere on the page.
    expect(
      back.spec.sections.find((s) => s.kind === 'account_and_cart')?.node_ids,
    ).toHaveLength(1);
    for (const s of back.spec.sections)
      expect(s.node_ids.length).toBeGreaterThan(0);
  });

  it('a slot missing from the next exemplar drops only that field', () => {
    const a = build(channel());
    const stored = toStoredSpec(specFor(a.keys), a.skeleton, hmac, meta);
    const page = channel();
    const item = page.kids![2]!.kids![2]!.kids![0]!;
    item.kids = item.kids!.slice(1); // no thumbnail link
    const b = build(page);
    const back = fromStoredSpec(stored, b.skeleton, hmac);
    expect(back.spec.collections[0]?.fields.map((f) => f.role)).toEqual([
      'title',
      'meta',
      'duration',
    ]);
    // 9 section nodes + 2 headings + list + open + 4 fields = 17, one missing.
    expect(back.coverage).toBeCloseTo(16 / 17, 5);
  });

  it('a slot that was one of several look-alikes is never guessed', () => {
    const a = build(channel());
    const stored = toStoredSpec(specFor(a.keys), a.skeleton, hmac, meta);
    const page = channel();
    const item = page.kids![2]!.kids![2]!.kids![0]!;
    item.kids = item.kids!.slice(0, 3); // the duration span is gone
    const b = build(page);
    const back = fromStoredSpec(stored, b.skeleton, hmac);
    // Meta and duration were span:0 and span:1; one span is left, and which
    // one it is cannot be told from structure, so neither is bound.
    expect(back.spec.collections[0]?.fields.map((f) => f.role)).toEqual([
      'thumbnail',
      'title',
    ]);
    expect(back.coverage).toBeCloseTo(15 / 17, 5);
  });

  it('an empty stored spec has zero coverage', () => {
    const a = build(channel());
    const back = fromStoredSpec(
      {
        ...meta,
        page_type: 'other',
        primary_task: 'other',
        sections: [],
        collections: [],
      },
      a.skeleton,
      hmac,
    );
    expect(back.coverage).toBe(0);
  });

  it('nameKey folds case, digits and spacing', () => {
    expect(nameKey('  3 Items  in\nCart ')).toBe('# items in cart');
    expect(nameKey('1,204 results')).toBe('# results');
    expect(nameKey('12')).toBe('#');
  });
});
