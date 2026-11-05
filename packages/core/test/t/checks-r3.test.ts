import { describe, expect, test } from 'vitest';
import type { OpRecord } from '../../src/types';
import { attribute, lettersPerLine, lineCore, runChecks, textInk, type ElementMeasure, type MeasureRect, type PageMeasure } from '../../src/verify/checks';

function el(id: string, p: Partial<ElementMeasure> = {}): ElementMeasure {
  return {
    id,
    rect: { x: 0, y: 0, w: 200, h: 20 },
    scrollW: 200, scrollH: 20, clientW: 200, clientH: 20,
    overflowHidden: false,
    fontPx: 16,
    color: '#333333', background: '#ffffff', contrast: 12.6,
    visible: true, focusable: false, inTabOrder: false, tabIndex: null,
    textChars: 40,
    headingLevel: null,
    region: 'main content',
    ...p,
  };
}

function page(elements: ElementMeasure[], p: Partial<PageMeasure> = {}): PageMeasure {
  return {
    elements,
    docScrollW: 1280, viewportW: 1280,
    visibleTextByRegion: {},
    focusableCount: 0,
    tabOrder: [],
    headingPxByLevel: {},
    readingAnchor: null,
    ...p,
  };
}

const line = (x: number, y: number, w: number, h: number): MeasureRect => ({ x, y, w, h });
const failsOf = (b: PageMeasure, a: PageMeasure, ops = ['op1']) => runChecks(b, a, ops).filter((r) => !r.pass);

/**
 * Caden's 1.webp, in CSS px at 150% zoom: the card title "Your prescriptions (3)" wrapped to two lines inside a
 * 40 px card head, and its second line is drawn over the first prescription's name, 600 px below the fold.
 */
function prescriptionsCard(broken: boolean): ElementMeasure[] {
  const title = broken
    ? [line(40, 980, 70, 26), line(40, 1006, 160, 26)] // "Your" / "prescriptions (3)"
    : [line(40, 990, 190, 17)];
  return [
    el('n40', { rect: { x: 40, y: 980, w: 190, h: broken ? 52 : 17 }, lines: title, textChars: 18, inViewport: false }),
    el('n41', { rect: { x: 330, y: 980, w: 520, h: broken ? 52 : 15 }, lines: broken ? [line(330, 980, 500, 26), line(330, 1006, 120, 26)] : [line(600, 990, 230, 15)], textChars: 34, inViewport: false }),
    el('n44', { rect: { x: 72, y: broken ? 1010 : 1032, w: 330, h: broken ? 29 : 17 }, lines: [line(72, broken ? 1010 : 1032, 330, broken ? 29 : 17)], textChars: 25, inViewport: false, fontPx: broken ? 21 : 14 }),
  ];
}

describe('text overlap (round 3)', () => {
  test('catches 1.webp: a wrapped card title drawn over the prescription below it, below the fold', () => {
    const f = failsOf(page(prescriptionsCard(false)), page(prescriptionsCard(true)), ['spacing-1']);
    const overlap = f.filter((x) => x.name === 'overlap');
    expect(overlap.length).toBeGreaterThan(0);
    expect(overlap[0]?.detail).toMatch(/drawn over other text/);
    expect(overlap.some((x) => /n40/.test(x.detail) && /n44/.test(x.detail))).toBe(true);
    // Attribution goes to the batch's op.
    const ops: OpRecord[] = [{ id: 'spacing-1', kind: 'spacing', scope: 'page', targetIds: [], status: 'applied', reason: '' }];
    expect(attribute(overlap[0]!, ops)).toBe('spacing-1');
  });

  test('tight but correct typography (line-height 1: line boxes touch) does not fail', () => {
    // Two headings with 1.15em content boxes on a 1em line pitch: the boxes overlap by 3 px, the ink does not.
    const before = [el('a', { lines: [line(0, 0, 300, 23)] }), el('b', { lines: [line(0, 40, 300, 23)] })];
    const after = [el('a', { lines: [line(0, 0, 300, 23)] }), el('b', { lines: [line(0, 20, 300, 23)] })];
    expect(textInk(after[0]!.lines!, after[1]!.lines!)).toBe(0);
    expect(failsOf(page(before), page(after)).filter((x) => x.name === 'overlap')).toEqual([]);
  });

  test('more than 4 px² of new ink overlap fails; overlap that was already there does not', () => {
    const a = line(0, 0, 200, 20);
    const touching = [el('a', { lines: [a] }), el('b', { lines: [line(0, 12, 200, 20)] })];
    const apart = [el('a', { lines: [a] }), el('b', { lines: [line(0, 30, 200, 20)] })];
    expect(failsOf(page(apart), page(touching)).map((x) => x.name)).toContain('overlap');
    expect(failsOf(page(touching), page(touching)).filter((x) => x.name === 'overlap')).toEqual([]);
    // A sliver (1 px of ink across 3 px) stays under the 4 px² floor.
    const sliver = [el('a', { lines: [line(0, 0, 4, 20)] }), el('b', { lines: [line(2, 16.5, 4, 20)] })];
    expect(textInk(sliver[0]!.lines!, sliver[1]!.lines!)).toBeLessThanOrEqual(4);
  });

  test('stacked on purpose, nested, or in another fixed layer: skipped', () => {
    const apart = () => [el('a', { lines: [line(0, 0, 200, 20)] }), el('b', { lines: [line(0, 40, 200, 20)] })];
    const over = (p: Partial<ElementMeasure>) => [el('a', { lines: [line(0, 0, 200, 20)] }), el('b', { lines: [line(0, 4, 200, 20)], ...p })];
    expect(failsOf(page(apart()), page(over({ stacked: true }))).filter((x) => x.name === 'overlap')).toEqual([]);
    expect(failsOf(page(apart()), page(over({ parentId: 'a' }))).filter((x) => x.name === 'overlap')).toEqual([]);
    expect(failsOf(page(apart()), page(over({ fixedLayer: true }))).filter((x) => x.name === 'overlap')).toEqual([]);
    expect(failsOf(page(apart()), page(over({}))).map((x) => x.name)).toContain('overlap');
  });

  test('letters per line: median line width over half the font size; one-line text has none', () => {
    const m = el('p', { fontPx: 16, lines: [line(0, 0, 480, 19), line(0, 26, 470, 19), line(0, 52, 490, 19), line(0, 78, 100, 19)] });
    expect(lettersPerLine(m)).toBe(60);
    expect(lettersPerLine(el('q', { lines: [line(0, 0, 300, 19)] }))).toBeNull();
  });

  test('line cores trim the ascent and descent and a pixel each side', () => {
    expect(lineCore(line(10, 100, 50, 20))).toEqual({ x: 11, y: 103, w: 48, h: 15 });
  });
});

describe('box overlap skips stacked decorations', () => {
  test('carousel dots (absolutely positioned) newly over an illustration do not fail; a button over a button does', () => {
    const art = (y: number) => el('art', { rect: { x: 100, y, w: 300, h: 200 }, isMedia: true, textChars: 0, fontPx: null });
    const dot = (p: Partial<ElementMeasure>) => el('dot', { rect: { x: 200, y: 280, w: 8, h: 8 }, isControl: true, textChars: 0, fontPx: null, ...p });
    expect(failsOf(page([art(0), dot({ stacked: true })]), page([art(100), dot({ stacked: true })])).filter((x) => x.name === 'overlap')).toEqual([]);
    expect(failsOf(page([art(0), dot({})]), page([art(100), dot({})])).map((x) => x.name)).toContain('overlap');
  });
});

describe('page column spill (round 3)', () => {
  const col = { left: 300, right: 980 };
  test('content sticking out of the column fails as overflow; a full-bleed band does not', () => {
    const before = [el('nav', { rect: { x: 40, y: 0, w: 1100, h: 40 }, isControl: true }), el('p', { rect: { x: 40, y: 100, w: 600, h: 80 } })];
    const fits = [el('nav', { rect: { x: 316, y: 0, w: 640, h: 40 }, isControl: true }), el('p', { rect: { x: 316, y: 100, w: 600, h: 80 } })];
    expect(failsOf(page(before), page(fits, { column: col })).filter((x) => x.name === 'overflow')).toEqual([]);
    const spills = [el('nav', { rect: { x: 316, y: 0, w: 780, h: 40 }, isControl: true }), el('p', { rect: { x: 316, y: 100, w: 600, h: 80 } })];
    const f = failsOf(page(before), page(spills, { column: col })).filter((x) => x.name === 'overflow');
    expect(f[0]?.detail).toMatch(/sticks out of the page column \(nav, by 116 px\)/);
    const bleed = [el('band', { rect: { x: 0, y: 0, w: 1280, h: 300 }, isMedia: true, textChars: 0, fontPx: null })];
    expect(failsOf(page([el('band', { rect: { x: 0, y: 0, w: 1280, h: 300 }, isMedia: true, textChars: 0, fontPx: null })]), page(bleed, { column: col })).filter((x) => x.name === 'overflow')).toEqual([]);
  });

  test('clipped carousel slides and things already off screen are not spills', () => {
    const before = [el('slide', { rect: { x: 1300, y: 0, w: 400, h: 200 }, isMedia: true, textChars: 0, fontPx: null })];
    const after = [el('slide', { rect: { x: 1000, y: 0, w: 400, h: 200 }, visRect: { x: 1000, y: 0, w: 0, h: 0 }, isMedia: true, textChars: 0, fontPx: null })];
    expect(failsOf(page(before), page(after, { column: col })).filter((x) => x.name === 'overflow')).toEqual([]);
  });

  test('running text squeezed beside a box that keeps its width (Wikipedia\'s infobox) fails', () => {
    // 16 px text: 8 px a letter. Before: 560 px lines (70 letters). In the column: 170 px lines (21 letters).
    const rows = (w: number, n: number) => Array.from({ length: n }, (_, i) => line(340, 300 + i * 26, w, 19));
    const before = [el('intro', { textChars: 400, lines: rows(560, 6) })];
    const squeezed = [el('intro', { rect: { x: 340, y: 300, w: 170, h: 520 }, textChars: 400, lines: rows(170, 20) })];
    const f = failsOf(page(before), page(squeezed, { column: col })).filter((x) => x.name === 'overflow');
    expect(f[0]?.detail).toMatch(/squeezed to about 21 letters a line by the page column \(intro, was 70\)/);
    const fine = [el('intro', { rect: { x: 340, y: 300, w: 400, h: 200 }, textChars: 400, lines: rows(400, 8) })];
    expect(failsOf(page(before), page(fine, { column: col })).filter((x) => x.name === 'overflow')).toEqual([]);
  });

  test('a page that now scrolls sideways still fails', () => {
    const f = failsOf(page([el('p')]), page([el('p')], { docScrollW: 1400, column: col }));
    expect(f.map((x) => x.detail)).toContain('The page now scrolls sideways (by 120 px)');
  });
});

describe('the page column as a narrower window (integration)', () => {
  test('a carousel card cut at the side, a headline shortened by its CSS, one clipped placeholder: not breakage', () => {
    const before = page([
      el('c1', { visFrac: 1, visFracY: 1 }),
      el('h1', { visFrac: 1, visFracY: 1, truncated: false }),
      el('p1', { visFrac: 1, visFracY: 1, textChars: 60 }),
    ]);
    const after = page([
      el('c1', { visFrac: 0.4, visFracY: 1 }), // sideways: fewer cards in a narrower row
      el('h1', { visFrac: 1, visFracY: 1, truncated: true }), // ellipsis by the site's own CSS
      el('p1', { visFrac: 0.3, visFracY: 0.3, textChars: 60 }), // one clipped message in a fixed-height card
    ]);
    expect(failsOf(before, after, ['column-2']).filter((x) => x.name === 'clipping')).toEqual([]);
    // Any other op: the same cuts count.
    expect(failsOf(before, after, ['spacing-1']).filter((x) => x.name === 'clipping').length).toBeGreaterThan(0);
  });

  test('copy outgrowing a fixed-height box (two texts cut at the bottom) still rolls the column back', () => {
    const before = page([el('t', { visFrac: 1, visFracY: 1 }), el('s', { visFrac: 1, visFracY: 1 })]);
    const after = page([el('t', { visFrac: 0.6, visFracY: 0.6 }), el('s', { visFrac: 0.2, visFracY: 0.2 })]);
    expect(failsOf(before, after, ['column-2']).filter((x) => x.name === 'clipping').length).toBe(2);
  });

  test('text overlap compares drawn ink: one-line headlines running under the next card are clipped', () => {
    const cards = (clipped: boolean) => [
      el('a', { lines: [line(0, 0, 400, 20)], ...(clipped ? { inkLines: [line(0, 0, 260, 20)] } : {}) }),
      el('b', { lines: [line(270, 0, 400, 20)], ...(clipped ? { inkLines: [line(270, 0, 260, 20)] } : {}) }),
    ];
    const before = page([el('a', { lines: [line(0, 0, 200, 20)] }), el('b', { lines: [line(270, 0, 200, 20)] })]);
    expect(failsOf(before, page(cards(true)), ['column-2']).filter((x) => x.name === 'overlap')).toEqual([]);
    expect(failsOf(before, page(cards(false)), ['column-2']).filter((x) => x.name === 'overlap').length).toBeGreaterThan(0);
  });

  test('letters per line divide by the CSS zoom the column draws the body at', () => {
    const m = el('p', { lines: [line(0, 0, 300, 20), line(0, 20, 300, 20), line(0, 40, 300, 20), line(0, 60, 100, 20)], fontPx: 16, cssZoom: 0.75 });
    expect(Math.round(lettersPerLine(m)!)).toBe(50);
  });
});
