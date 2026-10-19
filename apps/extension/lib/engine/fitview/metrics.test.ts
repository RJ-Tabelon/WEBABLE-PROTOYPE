import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  measureSurface,
  meets,
  scoreTargets,
  templateMismatches,
  type SurfaceMetrics,
} from './metrics';

describe('template mismatches (docs/11 R7)', () => {
  it('a field some records simply lack is not a mismatch', () => {
    expect(
      templateMismatches([
        ['m', 'c20', 't16'],
        ['m', 'c20', 't16'],
        ['m', 'c20'],
        ['c20', 't16'],
      ]),
    ).toBe(0);
  });

  it('fields in another order are', () => {
    expect(
      templateMismatches([
        ['m', 'c20', 't16'],
        ['m', 'c20', 't16'],
        ['m', 'c20', 't16'],
        ['t16', 'c20', 'm'],
      ]),
    ).toBe(1);
  });

  it('a title at another size is', () => {
    expect(
      templateMismatches([
        ['c20', 't16'],
        ['c20', 't16'],
        ['c20', 't16'],
        ['c18', 't16'],
      ]),
    ).toBe(1);
  });

  it('needs three records to compare', () => {
    expect(templateMismatches([['c20'], ['t16', 'c18']])).toBe(0);
  });
});

const metrics = (over: Partial<SurfaceMetrics> = {}): SurfaceMetrics => ({
  itemsInView: 40,
  choicesInView: 12,
  inlineLinks: 0,
  ownChoicesInView: 4,
  textStyles: 5,
  adsInView: 0,
  moving: 0,
  mainStartShare: 0.3,
  maxGroup: 4,
  recordsBeforeMore: 8,
  templateMismatches: 0,
  belowFloorText: 0,
  belowTargetControls: 0,
  ...over,
});

describe('scorecard targets (docs/11 §4)', () => {
  it("level 2: half the original and at most 30 items, 15 choices, the person's groups", () => {
    const t = scoreTargets(2, metrics({ itemsInView: 120 }), {
      groupEvery: 4,
      listFirst: 8,
    });
    expect(t.itemsInView).toBe(30);
    expect(t.choicesInView).toBe(15);
    expect(t.mainStartShare).toBe(0.5);
    expect(t.maxGroup).toBe(4);
    expect(t.recordsBeforeMore).toBe(8);
    expect(
      scoreTargets(2, metrics({ itemsInView: 40 }), {
        groupEvery: 4,
        listFirst: 8,
      }).itemsInView,
    ).toBe(20);
  });

  it('a calm original (under 40 items in view) only must not get busier', () => {
    const structure = { groupEvery: 4, listFirst: 8 };
    expect(
      scoreTargets(2, metrics({ itemsInView: 30 }), structure).itemsInView,
    ).toBe(30);
    expect(
      scoreTargets(2, metrics({ itemsInView: 39 }), structure).itemsInView,
    ).toBe(30);
    expect(
      scoreTargets(0, metrics({ itemsInView: 30 }), structure).itemsInView,
    ).toBe(30);
    // The view's own strip controls have their own cap.
    expect(scoreTargets(2, metrics(), structure).ownChoicesInView).toBe(6);
    expect(
      meets(
        metrics({ ownChoicesInView: 7 }),
        scoreTargets(2, metrics(), structure),
      ).ownChoicesInView,
    ).toBe(false);
  });

  it('levels 0 and 1: 70% of the original, 25 choices, groups of 6, every record', () => {
    const t = scoreTargets(0, metrics({ itemsInView: 100 }), {
      groupEvery: 6,
      listFirst: null,
    });
    expect(t.itemsInView).toBe(70);
    expect(t.choicesInView).toBe(25);
    expect(t.mainStartShare).toBe(0.6);
    expect(t.maxGroup).toBe(6);
    expect(t.recordsBeforeMore).toBeNull();
  });

  it('meets: true, false, or null where no target applies', () => {
    const t = scoreTargets(0, metrics({ itemsInView: 100 }), {
      groupEvery: 6,
      listFirst: null,
    });
    const m = meets(metrics({ choicesInView: 30, mainStartShare: null }), t);
    expect(m.itemsInView).toBe(true);
    expect(m.choicesInView).toBe(false);
    expect(m.recordsBeforeMore).toBeNull();
    expect(m.mainStartShare).toBeNull();
  });
});

/**
 * jsdom has no layout: every element states its box in data-r="x y w h"
 * (elements without one have no box, as if not rendered).
 */
describe('measureSurface on a hand-laid page', () => {
  let rect: typeof Element.prototype.getBoundingClientRect;
  beforeEach(() => {
    rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const r = (this.getAttribute('data-r') ?? '0 0 0 0')
        .split(' ')
        .map(Number);
      return new DOMRect(r[0], r[1], r[2], r[3]);
    };
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = rect;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const record = (i: number, extra = ''): string => {
    const y = 200 + i * 100;
    return `<li class="rec" data-r="0 ${y} 600 90"><img data-r="0 ${y} 120 68" alt=""><h3 data-r="130 ${y} 400 24" style="font-size:20px"><a href="/v${i}" data-r="130 ${y} 300 24">Video ${i}</a></h3><p data-r="130 ${y + 30} 400 20" style="font-size:14px">Channel ${i}</p>${extra}</li>`;
  };

  it('counts items, choices, ads, styles, groups and records in the first screen', () => {
    document.body.innerHTML = `
      <main data-r="0 150 800 2000">
        <nav data-r="0 0 800 40"><a href="/a" data-r="0 0 40 20" style="font-size:12px">A</a><a href="/b" data-r="50 0 40 20" style="font-size:12px">B</a></nav>
        <button data-r="700 0 30 30">Go</button>
        <span data-r="300 160 60 16">Sponsored</span>
        <ul data-r="0 200 600 1200">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => record(i)).join('')}</ul>
      </main>`;
    const m = measureSurface(
      document,
      { width: 800, height: 900 },
      {
        F: 16,
        T: 44,
      },
    );
    expect(m.adsInView).toBe(1);
    expect(m.maxGroup).toBe(10);
    expect(m.recordsBeforeMore).toBe(10);
    expect(m.templateMismatches).toBe(0);
    // Records 0-6 start above 900: 7 titles, 2 nav links, 1 button.
    expect(m.choicesInView).toBe(10);
    expect(m.mainStartShare).toBe(0.17);
    // The 12 px nav (one block) and ten 14 px channel lines are below F 16.
    expect(m.belowFloorText).toBe(11);
    // Every control is below 44 px.
    expect(m.belowTargetControls).toBe(13);
    expect(m.textStyles).toBeGreaterThanOrEqual(2);
  });

  it("links inside running text are reading; the view's own controls count apart", () => {
    document.body.innerHTML = `
      <div class="strip" data-r="0 0 800 40"><button data-r="600 0 60 32">Text +</button><button data-r="670 0 100 32">Original page</button></div>
      <input data-r="0 0 300 32" aria-label="Search">
      <p data-r="0 100 600 60">Fitts's law is a model of <a href="/wiki/Movement" data-r="200 100 80 20">human movement</a> used in <a href="/wiki/HCI" data-r="300 100 180 20">human–computer interaction</a> and ergonomics.</p>
      <p data-r="0 200 600 24"><a href="/solo" data-r="0 200 100 24">A link of its own</a></p>`;
    const m = measureSurface(
      document,
      { width: 800, height: 900 },
      { own: '.strip' },
    );
    expect(m.inlineLinks).toBe(2);
    expect(m.ownChoicesInView).toBe(2);
    // The search field and the link that is a line of its own.
    expect(m.choicesInView).toBe(2);
    // Two paragraphs, the field and the solo link; the inline links are part
    // of their paragraph, the strip's own buttons are counted apart.
    expect(m.itemsInView).toBe(4);
  });

  it('parts of the page taller than the screen are not records', () => {
    const part = (y: number, h: number, inner: string): string =>
      `<section class="part" data-r="0 ${y} 600 ${h}"><h2 data-r="0 ${y} 600 40" style="font-size:28px">Part</h2>${inner}</section>`;
    document.body.innerHTML = `<main data-r="0 0 800 6000">${part(0, 4000, '<p data-r="0 50 600 3000" style="font-size:16px">A long article</p><img data-r="0 3100 300 200" alt="">')}${part(4000, 120, '<p data-r="0 4050 600 24" style="font-size:16px">A line</p>')}${part(4120, 120, '<a href="/x" data-r="0 4170 100 24" style="display:block">A link</a>')}</main>`;
    const m = measureSurface(document, { width: 800, height: 900 });
    expect(m.templateMismatches).toBe(0);
    expect(m.maxGroup).toBe(0);
  });

  it('a record with its title at another size breaks the template', () => {
    document.body.innerHTML = `<ul data-r="0 200 600 1200">${[0, 1, 2]
      .map((i) => record(i))
      .join(
        '',
      )}<li class="rec" data-r="0 500 600 90"><h3 data-r="130 500 400 24" style="font-size:28px"><a href="/x" data-r="130 500 300 24">Odd one</a></h3><p data-r="130 530 400 20" style="font-size:14px">Channel</p></li></ul>`;
    const m = measureSurface(document, { width: 800, height: 900 });
    expect(m.templateMismatches).toBe(1);
  });
});
