import { describe, expect, it } from 'vitest';

import { SKEL_MAX_NODES } from './constants';
import {
  outlineTokens,
  OUTLINE_CHARS_PER_TOKEN,
  OUTLINE_TOKEN_BUDGET,
  wireOutline,
} from './outline';
import { wireSkeletonSchema, type WireNode, type WireSkeleton } from './wire';

const page = { vw: 1280, vh: 800, dw: 1280, dh: 6704, lang: 'en' };

const n = (x: Partial<WireNode> & Pick<WireNode, 'id' | 'p'>): WireNode => ({
  t: 'div',
  r: null,
  k: 'group',
  b: [0, 0, 1280, 40],
  ...x,
});

function small(): WireSkeleton {
  return wireSkeletonSchema.parse({
    page,
    nodes: [
      n({ id: 'e1', p: null, t: 'body', b: [0, 0, 1280, 6704] }),
      n({
        id: 'e2',
        p: 'e1',
        t: 'custom',
        r: 'banner',
        k: 'landmark',
        f: ['fixed'],
        b: [0, 0, 1280, 56],
      }),
      n({
        id: 'e3',
        p: 'e2',
        t: 'input',
        r: 'combobox',
        k: 'input',
        it: 'search',
        l: ['search'],
        b: [336, 16, 512, 24],
        fs: 16,
      }),
      n({
        id: 'e4',
        p: 'e2',
        t: 'a',
        r: 'link',
        k: 'control',
        f: ['icon'],
        hr: 'same',
        l: ['·', 'home'],
        b: [56, 0, 128, 56],
        fs: 10,
      }),
      n({
        id: 'e5',
        p: 'e1',
        t: 'main',
        r: 'main',
        k: 'landmark',
        b: [72, 56, 1208, 6648],
      }),
      n({
        id: 'e6',
        p: 'e5',
        t: 'h1',
        r: 'heading',
        k: 'heading',
        lv: 1,
        l: ['·'],
        b: [320, 248, 208, 40],
        fs: 36,
        w: 600,
      }),
      n({
        id: 'e7',
        p: 'e5',
        t: 'div',
        k: 'collection',
        n: '51-100',
        itm: 'custom',
        ex: 'e8',
        b: [128, 560, 1072, 6032],
      }),
      n({ id: 'e8', p: 'e7', t: 'custom', s: true, b: [128, 560, 344, 248] }),
      n({
        id: 'e9',
        p: 'e8',
        t: 'a',
        r: 'link',
        k: 'control',
        f: ['imgctrl'],
        hr: 'same',
        s: true,
        b: [128, 560, 344, 208],
      }),
      n({
        id: 'e10',
        p: 'e8',
        t: 'span',
        k: 'stext',
        sh: { len: 'xs', pat: ['duration'] },
        f: ['overlay'],
        s: true,
        b: [416, 744, 48, 16],
        fs: 12,
      }),
      n({
        id: 'e11',
        p: 'e5',
        t: 'p',
        k: 'text',
        sh: { len: 'xl', ln: '3-5' },
        b: [320, 328, 568, 16],
        fs: 14,
      }),
    ],
  });
}

describe('wireOutline', () => {
  it('writes one line per node, with LIST and exemplar for collections', () => {
    expect(wireOutline(small())).toBe(
      [
        'PAGE viewport=1280x800 doc=1280x6704 lang=en',
        'e1 body [0,0,1280,6704]',
        '  e2 custom[banner] fixed [0,0,1280,56]',
        '    e3 input[combobox]* it:search "search" [336,16,512,24] fs16',
        '    e4 a* icon "· home" [56,0,128,56] fs10',
        '  e5 main [72,56,1208,6648]',
        '    e6 h1 "·" [320,248,208,40] fs36 w600',
        '    e7 div LIST n=51-100 item=custom [128,560,1072,6032]',
        '      exemplar:',
        '        e8 custom slot [128,560,344,248]',
        '          e9 a* imgctrl slot [128,560,344,208]',
        '          e10 span overlay slot len:xs pat:duration [416,744,48,16] fs12',
        '    e11 p text:xl links:3-5 [320,328,568,16] fs14',
      ].join('\n'),
    );
  });

  it('is deterministic and names no host, path or title', () => {
    const a = wireOutline(small());
    const b = wireOutline(JSON.parse(JSON.stringify(small())) as WireSkeleton);
    expect(b).toBe(a);
    expect(a.split('\n')[0]).toBe(
      'PAGE viewport=1280x800 doc=1280x6704 lang=en',
    );
    expect(a).not.toMatch(/https?:|title=|host/);
  });

  it('marks an exemplar placed outside its collection', () => {
    const wire = small();
    const moved = wire.nodes.map((x) =>
      x.id === 'e8' ? { ...x, p: 'e5' } : x,
    );
    const out = wireOutline({ ...wire, nodes: moved });
    expect(out).toContain('e8 custom slot exemplar-of:e7 [128,560,344,248]');
    expect(out).not.toContain('exemplar:');
  });

  it('keeps a full-size page within the token budget by collapsing deep, low-value groups', () => {
    const wire = big();
    expect(wire.nodes).toHaveLength(SKEL_MAX_NODES);
    const out = wireOutline(wire);
    expect(outlineTokens(out)).toBeLessThanOrEqual(OUTLINE_TOKEN_BUDGET);
    // Collapsing happened, with WebAble's own summary words.
    expect(out).toMatch(/…collapsed: \d+ links?/);
    // What the planner needs survives: search, main heading, the main list and its slots.
    expect(out).toContain('"search"');
    expect(out).toContain('e5 h1 "results"');
    expect(out).toMatch(/LIST n=51-100 item=li/);
    expect(out).toContain('slot');
    // Below-the-fold groups collapse before above-the-fold ones.
    const lines = out.split('\n');
    const region = (label: string): string[] => {
      const at = lines.findIndex((l) => l.includes(`nav "${label}"`));
      const end = lines.findIndex((l, i) => i > at && /^ {2}e\d+ /.test(l));
      return lines.slice(at + 1, end < 0 ? undefined : end);
    };
    const folded = (label: string): number =>
      region(label).filter((l) => l.includes('…collapsed')).length;
    const footerGroups = region('footer').filter((l) =>
      /^ {4}e\d+ div/.test(l),
    );
    expect(footerGroups.length).toBeGreaterThan(10);
    expect(folded('footer')).toBe(footerGroups.length);
    expect(folded('menu')).toBe(0);
    expect(region('menu').some((l) => l.includes('a* icon'))).toBe(true);
    // Deterministic under the budget too.
    expect(wireOutline(big())).toBe(out);
  });

  it('a smaller budget collapses more and still fits', () => {
    const out = wireOutline(big(), 1500);
    expect(outlineTokens(out)).toBeLessThanOrEqual(1500);
    expect(out).toContain('"search"');
  });

  it('a flat page of leaves is cut at the end, saying how much', () => {
    const nodes: WireNode[] = [n({ id: 'e1', p: null, t: 'body' })];
    for (let i = 2; i <= SKEL_MAX_NODES; i++)
      nodes.push(
        n({
          id: `e${i}`,
          p: 'e1',
          t: 'a',
          r: 'link',
          k: 'control',
          l: ['account', 'settings', 'privacy', 'and', 'security', 'help'],
          f: ['icon', 'popup', 'expanded'],
          b: [0, i * 40, 1280, 40],
          fs: 14,
        }),
      );
    const out = wireOutline(wireSkeletonSchema.parse({ page, nodes }));
    expect(out.length).toBeLessThanOrEqual(
      OUTLINE_TOKEN_BUDGET * OUTLINE_CHARS_PER_TOKEN,
    );
    expect(out).toMatch(/…truncated: \d+ more lines$/);
    expect(out).toContain('e2 a*');
  });
});

/**
 * A 600-node page: banner with search, a left nav, main with a heading and a
 * large list, a deep right rail and a deep footer (both mostly links).
 */
function big(): WireSkeleton {
  const nodes: WireNode[] = [];
  let id = 0;
  const add = (x: Omit<WireNode, 'id'>): string => {
    const nid = `e${++id}`;
    nodes.push({ id: nid, ...x });
    return nid;
  };
  const body = add({
    p: null,
    t: 'body',
    r: null,
    k: 'group',
    b: [0, 0, 1280, 9000],
  });
  const banner = add({
    p: body,
    t: 'header',
    r: 'banner',
    k: 'landmark',
    b: [0, 0, 1280, 56],
  });
  add({
    p: banner,
    t: 'input',
    r: 'searchbox',
    k: 'input',
    it: 'search',
    l: ['search'],
    b: [336, 16, 512, 24],
    fs: 16,
  });
  const main = add({
    p: body,
    t: 'main',
    r: 'main',
    k: 'landmark',
    b: [240, 56, 800, 8000],
  });
  add({
    p: main,
    t: 'h1',
    r: 'heading',
    k: 'heading',
    lv: 1,
    l: ['results'],
    b: [240, 64, 800, 40],
    fs: 28,
  });
  const list = add({
    p: main,
    t: 'ul',
    r: 'list',
    k: 'collection',
    n: '51-100',
    itm: 'li',
    b: [240, 120, 800, 7000],
  });
  const ex = add({
    p: list,
    t: 'li',
    r: 'listitem',
    k: 'group',
    s: true,
    b: [240, 120, 800, 120],
  });
  nodes.find((x) => x.id === list)!.ex = ex;
  add({
    p: ex,
    t: 'a',
    r: 'link',
    k: 'control',
    s: true,
    b: [240, 120, 800, 24],
    fs: 18,
  });
  add({
    p: ex,
    t: 'span',
    r: null,
    k: 'stext',
    s: true,
    sh: { len: 's', pat: ['price'] },
    b: [240, 150, 80, 16],
    fs: 14,
  });
  // Deep groups of links: a left nav (above the fold), a right rail and a footer (below).
  const deep = (parent: string, label: string, y: number, groups: number) => {
    const region = add({
      p: parent,
      t: 'nav',
      r: 'navigation',
      k: 'landmark',
      l: [label],
      b: [0, y, 240, 400],
    });
    for (let g = 0; g < groups && id < SKEL_MAX_NODES; g++) {
      const grp = add({
        p: region,
        t: 'div',
        r: null,
        k: 'group',
        b: [0, y + g * 40, 240, 40],
      });
      const inner = add({
        p: grp,
        t: 'ul',
        r: 'list',
        k: 'group',
        b: [0, y + g * 40, 240, 40],
      });
      for (let k = 0; k < 8 && id < SKEL_MAX_NODES; k++)
        add({
          p: inner,
          t: 'a',
          r: 'link',
          k: 'control',
          hr: 'same',
          l: ['account', 'settings', 'privacy', '·', 'help', 'center'],
          f: ['icon'],
          b: [0, y + g * 40 + k * 4, 240, 24],
          fs: 13,
        });
    }
  };
  deep(body, 'menu', 64, 18);
  deep(body, 'related', 2400, 18);
  deep(body, 'footer', 8600, 40);
  return wireSkeletonSchema.parse({ page: { ...page, dh: 9000 }, nodes });
}
