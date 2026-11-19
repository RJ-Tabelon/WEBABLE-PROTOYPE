import { describe, expect, it } from 'vitest';

import { structureHash, type StructNode } from './structure';

const n = (
  tag: string,
  kind: string,
  kids: StructNode[] = [],
  extra: Partial<StructNode> = {},
): StructNode => ({
  tag,
  role: null,
  kind,
  flags: new Set(),
  kids,
  ...extra,
});

const page = (paragraphs: number, extra: StructNode[] = []): StructNode =>
  n('body', 'group', [
    n('header', 'landmark', [n('a', 'control'), n('input', 'input')], {
      role: 'banner',
      flags: new Set(['fixed']),
    }),
    n(
      'main',
      'landmark',
      [
        n('h1', 'heading', [], { level: 1 }),
        ...Array.from({ length: paragraphs }, () => n('p', 'text')),
        n('div', 'collection', [], {
          list: {
            itemTag: 'li',
            exemplar: n(
              'a',
              'control',
              [n('span', 'stext', [], { slot: true })],
              {
                slot: true,
              },
            ),
          },
        }),
        ...extra,
      ],
      { role: 'main' },
    ),
  ]);

describe('structureHash', () => {
  it('is deterministic', () => {
    expect(structureHash(page(3))).toBe(structureHash(page(3)));
    expect(structureHash(page(3))).toMatch(/^s[0-9a-z]+$/);
  });

  it('ignores how much prose a page has', () => {
    expect(structureHash(page(3))).toBe(structureHash(page(40)));
  });

  it('counts runs of identical sibling subtrees once', () => {
    const a = page(2, [
      n('section', 'group', [n('h2', 'heading', [], { level: 2 })]),
    ]);
    const b = page(2, [
      n('section', 'group', [n('h2', 'heading', [], { level: 2 })]),
      n('section', 'group', [n('h2', 'heading', [], { level: 2 })]),
    ]);
    expect(structureHash(a)).toBe(structureHash(b));
  });

  it('ignores ads, consent layers and state flags', () => {
    const base = page(2);
    const withAd = page(2, [
      n('div', 'group', [n('iframe', 'media')], { flags: new Set(['adhint']) }),
    ]);
    expect(structureHash(withAd)).toBe(structureHash(base));
    const focused = page(2);
    const header = focused.kids[0] as StructNode;
    (header.flags as Set<string>).add('focus');
    (header.flags as Set<string>).add('expanded');
    expect(structureHash(focused)).toBe(structureHash(base));
  });

  it('changes when the template changes', () => {
    const base = structureHash(page(2));
    expect(
      structureHash(page(2, [n('form', 'landmark', [n('input', 'input')])])),
    ).not.toBe(base);
    const other = page(2);
    const main = other.kids[1] as StructNode;
    const list = main.kids[main.kids.length - 1] as StructNode;
    (list.list as { itemTag: string }).itemTag = 'div';
    expect(structureHash(other)).not.toBe(base);
    const headerFlag = page(2);
    (headerFlag.kids[0] as { flags: ReadonlySet<string> }).flags = new Set([
      'sticky',
    ]);
    expect(structureHash(headerFlag)).not.toBe(base);
  });
});
