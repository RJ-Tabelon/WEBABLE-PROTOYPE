import { describe, expect, it } from 'vitest';

import type { SkelKind, SkelTag } from '@webable/core/skeleton/constants';

import { capDepth, capExemplar, collapse, fitBudget } from './lod';
import { countNodes, forEachNode, type RawNode } from './raw';

const el = (): Element => document.createElement('div');

function node(
  tag: SkelTag,
  kind: SkelKind,
  kids: RawNode[] = [],
  extra: Partial<RawNode> = {},
): RawNode {
  return {
    el: el(),
    tag,
    role: null,
    kind,
    box: [0, 0, 100, 20],
    flags: new Set(),
    kids,
    ...extra,
  };
}

const text = (chars = 200, y = 0): RawNode =>
  node('p', 'text', [], { text: { chars }, box: [0, y, 600, 40] });
const link = (): RawNode =>
  node('a', 'control', [], { role: 'link', text: { chars: 10 } });

function list(count: number, exemplarKids: number): RawNode {
  const ex = node('li', 'group', Array.from({ length: exemplarKids }, link));
  return node('ul', 'collection', [], {
    list: {
      container: el(),
      members: Array.from({ length: count }, el),
      sig: { key: 'li|', cls: [] },
      exemplar: ex,
      exemplarEl: el(),
      itemTag: 'li',
    },
  });
}

describe('collapse', () => {
  it('summarises a subtree as a text shape and drops it', () => {
    const g = node('div', 'group', [text(300), text(150), link(), link()]);
    collapse(g);
    expect(g.kids).toEqual([]);
    expect(g.collapsed).toBe(true);
    expect(g.text).toEqual({ chars: 470, links: 2 });
  });

  it('never collapses a collection node itself', () => {
    const l = list(10, 3);
    collapse(l);
    expect(l.list).toBeDefined();
    expect(l.collapsed).toBeUndefined();
  });
});

describe('capExemplar', () => {
  it('keeps an exemplar within its node cap', () => {
    const ex = node('article', 'group', [
      node('div', 'group', Array.from({ length: 20 }, link)),
      node('div', 'group', Array.from({ length: 10 }, link)),
      link(),
    ]);
    capExemplar(ex, 24);
    expect(countNodes(ex)).toBeLessThanOrEqual(24);
    expect(ex.kids).toHaveLength(3);
  });

  it('cuts a flat tail when collapsing cannot help', () => {
    const ex = node('div', 'group', Array.from({ length: 40 }, link));
    capExemplar(ex, 24);
    expect(countNodes(ex)).toBe(24);
  });
});

describe('capDepth', () => {
  it('collapses below the depth limit and turns too-deep collections into groups', () => {
    let deep = node('div', 'group', [text(), text()]);
    for (let i = 0; i < 30; i++) deep = node('div', 'group', [deep, link()]);
    const root = node('body', 'group', [deep, list(5, 2)]);
    expect(capDepth(root, 24)).toBe(true);
    let max = 0;
    forEachNode(root, (_n, _p, d) => {
      max = Math.max(max, d);
    });
    expect(max).toBeLessThanOrEqual(24);
  });
});

describe('fitBudget', () => {
  it('does nothing within budget', () => {
    const root = node('body', 'group', [text(), text()]);
    expect(fitBudget(root, 600, 800)).toBe(false);
  });

  it('folds chrome and below-the-fold groups before main and large lists', () => {
    const chrome = node(
      'footer',
      'landmark',
      Array.from({ length: 30 }, link),
      { role: 'contentinfo', box: [0, 5000, 1280, 200] },
    );
    const main = node(
      'main',
      'landmark',
      [node('h1', 'heading', [], { level: 1 }), list(50, 4)],
      { role: 'main' },
    );
    const aside = node(
      'aside',
      'landmark',
      Array.from({ length: 20 }, () => text(100, 3000)),
      { role: 'complementary', box: [900, 0, 300, 4000] },
    );
    const root = node('body', 'group', [
      node('div', 'group', [chrome, aside]),
      main,
    ]);
    const before = countNodes(root);
    expect(fitBudget(root, 20, 800)).toBe(true);
    expect(countNodes(root)).toBeLessThanOrEqual(20);
    expect(before).toBeGreaterThan(20);
    // The list and its exemplar survive; the chrome was summarised.
    const lists: RawNode[] = [];
    forEachNode(root, (n) => {
      if (n.list) lists.push(n);
    });
    expect(lists).toHaveLength(1);
    expect(chrome.collapsed || aside.collapsed).toBe(true);
  });

  it('keeps the head of a long flat group and folds its tail', () => {
    const article = node(
      'main',
      'landmark',
      [
        node('h1', 'heading'),
        ...Array.from({ length: 700 }, (_, i) => text(400, i * 50)),
      ],
      { role: 'main' },
    );
    const root = node('body', 'group', [article]);
    fitBudget(root, 600, 800);
    expect(countNodes(root)).toBeLessThanOrEqual(600);
    expect(article.kids[0]?.kind).toBe('heading');
    expect(article.kids.length).toBeGreaterThan(500);
    expect(article.text?.chars).toBeGreaterThan(400 * 50);
  });

  it('never folds the subtree holding focus or a record', () => {
    const focused = node('form', 'landmark', [
      node('input', 'input', [], { flags: new Set(['focus']) }),
      ...Array.from({ length: 10 }, link),
    ]);
    const filler = node('div', 'group', Array.from({ length: 30 }, link));
    const root = node('body', 'group', [
      node('div', 'group', [focused, filler]),
    ]);
    fitBudget(root, 20, 800);
    expect(focused.collapsed).toBeUndefined();
    expect(filler.collapsed).toBe(true);
  });
});

describe('capExemplar: record key parts', () => {
  const stext = (chars: number, pat?: string[]): RawNode =>
    node('span', 'stext', [], {
      text: pat ? { chars, pat: pat as never } : { chars },
    });

  it('keeps title, price, rating and thumbnail; folds the rest first (eval B3)', () => {
    const thumb = node('a', 'control', [], {
      role: 'link',
      flags: new Set(['imgctrl']),
      box: [0, 0, 256, 256],
    });
    const title = node('a', 'control', [], {
      role: 'link',
      text: { chars: 120 },
    });
    const rating = stext(18, ['rating']);
    const price = stext(8, ['price']);
    const badges = node('div', 'group', [
      node(
        'div',
        'group',
        Array.from({ length: 4 }, () => stext(6)),
      ),
      node(
        'div',
        'group',
        Array.from({ length: 4 }, () => stext(9)),
      ),
    ]);
    const delivery = node(
      'div',
      'group',
      Array.from({ length: 5 }, () => stext(20)),
    );
    const details = node('div', 'group', [
      node('h2', 'heading', [title]),
      node('div', 'group', [
        rating,
        node('a', 'control', [], {
          role: 'link',
          text: { chars: 7, pat: ['count'] },
        }),
      ]),
      node('div', 'group', [
        node('div', 'group', [price, stext(12, ['price'])]),
      ]),
      badges,
      delivery,
    ]);
    const ex = node('div', 'group', [thumb, details]);
    expect(countNodes(ex)).toBeGreaterThan(24);
    capExemplar(ex, 24);
    expect(countNodes(ex)).toBeLessThanOrEqual(24);
    const kept = new Set<RawNode>();
    forEachNode(ex, (n) => {
      kept.add(n);
    });
    for (const n of [thumb, title, rating, price])
      expect(kept.has(n)).toBe(true);
    expect(details.collapsed).toBeFalsy();
  });

  it('unwraps plain wrappers around key parts before cutting', () => {
    let inner: RawNode = stext(8, ['price']);
    for (let i = 0; i < 30; i++) inner = node('div', 'group', [inner]);
    const ex = node('div', 'group', [
      inner,
      ...Array.from({ length: 5 }, link),
    ]);
    capExemplar(ex, 10);
    expect(countNodes(ex)).toBeLessThanOrEqual(10);
    let price = false;
    forEachNode(ex, (n) => {
      if (n.text?.pat?.includes('price')) price = true;
    });
    expect(price).toBe(true);
  });
});
