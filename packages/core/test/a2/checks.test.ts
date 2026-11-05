import { describe, expect, test } from 'vitest';
import type { OpRecord } from '../../src/types';
import { attribute, runChecks, runChecksDetailed, type ElementMeasure, type PageMeasure } from '../../src/verify/checks';

function el(id: string, p: Partial<ElementMeasure> = {}): ElementMeasure {
  return {
    id,
    rect: { x: 0, y: 0, w: 200, h: 20 },
    scrollW: 200, scrollH: 20, clientW: 200, clientH: 20,
    overflowHidden: false,
    fontPx: 16,
    color: '#333333', background: '#ffffff', contrast: 12.6,
    visible: true, focusable: false, inTabOrder: false, tabIndex: null,
    textChars: 80,
    headingLevel: null,
    region: 'main',
    ...p,
  };
}

function page(elements: ElementMeasure[], p: Partial<PageMeasure> = {}): PageMeasure {
  return {
    elements,
    docScrollW: 1280, viewportW: 1280,
    visibleTextByRegion: { main: elements.reduce((a, e) => a + e.textChars, 0) },
    focusableCount: elements.filter((e) => e.focusable).length,
    tabOrder: elements.filter((e) => e.inTabOrder).map((e) => e.id),
    headingPxByLevel: {},
    readingAnchor: null,
    ...p,
  };
}

const op = (id: string, kind: OpRecord['kind'], p: Partial<OpRecord> = {}): OpRecord => ({
  id, kind, scope: 'page', targetIds: [], status: 'applied', reason: '', ...p,
});

/** A small page: a heading, body text, a link, a button, an image. */
function basePage(): ElementMeasure[] {
  return [
    el('h', { rect: { x: 0, y: 0, w: 600, h: 40 }, fontPx: 28, headingLevel: 1, textChars: 22 }),
    el('p1', { rect: { x: 0, y: 60, w: 600, h: 60 }, textChars: 240 }),
    el('p2', { rect: { x: 0, y: 140, w: 600, h: 60 }, textChars: 180, fontPx: 14 }),
    el('a', { rect: { x: 0, y: 220, w: 120, h: 20 }, focusable: true, inTabOrder: true, tabIndex: 0, textChars: 12, isHelp: true }),
    el('b', { rect: { x: 200, y: 220, w: 104, h: 28 }, focusable: true, inTabOrder: true, tabIndex: 0, textChars: 14 }),
    el('img', { rect: { x: 0, y: 260, w: 120, h: 120 }, textChars: 0, isMedia: true, fontPx: null, contrast: null }),
  ];
}

const failsOf = (before: PageMeasure, after: PageMeasure, ops: string[] = ['op1']) => runChecks(before, after, ops).filter((r) => !r.pass);

describe('runChecks', () => {
  test('an unchanged page passes every check, one summary per check', () => {
    const r = runChecks(page(basePage()), page(basePage()), ['op1']);
    expect(r.every((x) => x.pass)).toBe(true);
    expect(new Set(r.map((x) => x.name))).toEqual(new Set(['clipping', 'overlap', 'overflow', 'contrast', 'reachability', 'content_loss', 'hierarchy', 'reading_position']));
  });

  test('uniform growth (like zoom) passes: sizes keep their order', () => {
    const grow = basePage().map((e) => ({ ...e, fontPx: e.fontPx ? e.fontPx * 1.25 : null, rect: { ...e.rect, y: e.rect.y * 1.25, h: e.rect.h * 1.25 } }));
    expect(failsOf(page(basePage()), page(grow))).toEqual([]);
  });

  test('clipping: newly cut-off text fails; clipping that was already there does not', () => {
    const after = basePage().map((e) => (e.id === 'p1' ? { ...e, visFrac: 0.6 } : { ...e, visFrac: 1 }));
    const before = basePage().map((e) => ({ ...e, visFrac: 1 }));
    const f = failsOf(page(before), page(after));
    expect(f.map((x) => x.name)).toContain('clipping');
    const already = basePage().map((e) => (e.id === 'p1' ? { ...e, visFrac: 0.6 } : e));
    expect(failsOf(page(already), page(after.map((e) => (e.id === 'p1' ? { ...e, visFrac: 0.59 } : e)))).filter((x) => x.name === 'clipping')).toEqual([]);
    // Fallback without visFrac: a box that now hides its overflow.
    const boxed = basePage().map((e) => (e.id === 'b' ? { ...e, overflowHidden: true, scrollW: 140, clientW: 104 } : e));
    const before2 = basePage().map((e) => (e.id === 'b' ? { ...e, overflowHidden: true } : e));
    expect(failsOf(page(before2), page(boxed)).map((x) => x.name)).toContain('clipping');
    // Ellipsis that appears.
    expect(failsOf(page(basePage()), page(basePage().map((e) => (e.id === 'p2' ? { ...e, truncated: true } : e)))).map((x) => x.name)).toContain('clipping');
  });

  test('hierarchy: a heading that ends up smaller than text below it fails', () => {
    const after = basePage().map((e) => (e.id === 'p1' ? { ...e, fontPx: 30 } : e));
    const f = failsOf(page(basePage()), page(after));
    expect(f.some((x) => x.name === 'hierarchy' && /swapped/.test(x.detail))).toBe(true);
    // Heading below body size.
    const after2 = basePage().map((e) => (e.id === 'h' ? { ...e, fontPx: 15 } : e.id === 'p1' || e.id === 'p2' ? { ...e, fontPx: 18 } : e));
    expect(failsOf(page(basePage()), page(after2)).some((x) => x.name === 'hierarchy' && /smaller than body/.test(x.detail))).toBe(true);
    // Equal-ish sizes (within 5%) may trade places.
    const near = basePage().map((e) => (e.id === 'p2' ? { ...e, fontPx: 15.5 } : e));
    const near2 = near.map((e) => (e.id === 'p2' ? { ...e, fontPx: 16.4 } : e));
    expect(failsOf(page(near), page(near2)).filter((x) => x.name === 'hierarchy')).toEqual([]);
  });

  test('content loss: text or images that disappear fail', () => {
    const gone = basePage().map((e) => (e.id === 'p2' ? { ...e, visible: false } : e));
    const f = failsOf(page(basePage()), page(gone));
    expect(f.some((x) => x.name === 'content_loss' && /180 characters/.test(x.detail))).toBe(true);
    const shrunk = basePage().map((e) => (e.id === 'img' ? { ...e, rect: { ...e.rect, w: 50, h: 50 } } : e));
    expect(failsOf(page(basePage()), page(shrunk)).some((x) => x.name === 'content_loss')).toBe(true);
  });

  test('overflow: a page that starts scrolling sideways fails', () => {
    const f = failsOf(page(basePage()), page(basePage(), { docScrollW: 1400 }));
    expect(f.map((x) => x.name)).toEqual(['overflow']);
  });

  test('overlap: content pushed on top of other content fails; nested boxes do not', () => {
    const after = basePage().map((e) => (e.id === 'b' ? { ...e, rect: { x: 10, y: 222, w: 104, h: 28 } } : e));
    expect(failsOf(page(basePage()), page(after)).map((x) => x.name)).toContain('overlap');
    const nested = [...basePage(), el('inner', { rect: { x: 10, y: 65, w: 100, h: 20 }, parentId: 'p1', textChars: 10 })];
    expect(failsOf(page(nested), page(nested)).filter((x) => x.name === 'overlap')).toEqual([]);
  });

  test('reachability: hidden controls, keyboard order changes, lost focus and faded help all fail', () => {
    const hidden = basePage().map((e) => (e.id === 'b' ? { ...e, pointerEvents: false } : e));
    expect(failsOf(page(basePage()), page(hidden)).some((x) => x.name === 'reachability' && /can no longer be clicked/.test(x.detail))).toBe(true);
    const reordered = page(basePage(), { tabOrder: ['b', 'a'] });
    expect(failsOf(page(basePage()), reordered).some((x) => /keyboard order changed/.test(x.detail))).toBe(true);
    const faded = basePage().map((e) => (e.id === 'a' ? { ...e, opacity: 0.45 } : e));
    expect(failsOf(page(basePage()), page(faded)).some((x) => /help link/.test(x.detail))).toBe(true);
    const focusLost = page(basePage().map((e) => (e.id === 'b' ? { ...e, visible: false } : e)), { activeIsBody: true });
    expect(failsOf(page(basePage(), { activeId: 'b' }), focusLost).some((x) => /focus was lost/.test(x.detail))).toBe(true);
  });

  test('contrast: regressions fail; an ineffective lift is a token drop, not a rollback', () => {
    const fainter = basePage().map((e) => (e.id === 'p1' ? { ...e, contrast: 3.1 } : e));
    expect(failsOf(page(basePage()), page(fainter)).map((x) => x.name)).toContain('contrast');
    const before = basePage().map((e) => (e.id === 'p2' ? { ...e, contrast: 2.8 } : e));
    const after = before.map((e) => (e.id === 'p2' ? { ...e, contrast: 5.2, contrastOp: true, contrastTarget: 7 } : e));
    const rep = runChecksDetailed(page(before), page(after), ['c1']);
    expect(rep.failures).toEqual([]);
    expect(rep.tokenDrops).toEqual([{ id: 'p2', kind: 'contrast', reason: 'reached 5.2:1 of 7:1', opId: 'c1' }]);
  });

  test('reading position is soft: pass with an Undo hint, never a rollback', () => {
    const before = page(basePage(), { readingAnchor: { id: 'p1', top: 60 } });
    const after = page(basePage(), { readingAnchor: { id: 'p1', top: 140 } });
    const r = runChecks(before, after, ['z1']).find((x) => x.name === 'reading_position');
    expect(r?.pass).toBe(true);
    expect(r?.detail).toMatch(/^soft: The reading position moved by 80 px/);
  });
});

describe('attribute', () => {
  const ops = [op('z', 'page_zoom'), op('t', 'text_map'), op('s', 'spacing'), op('g', 'targets', { scope: 'element', targetIds: ['b'] })];

  test('uses the op tokens on the failing element first', () => {
    const before = basePage().map((e) => ({ ...e, visFrac: 1 }));
    const after = before.map((e) => (e.id === 'p1' ? { ...e, visFrac: 0.5, opIds: ['s'] } : e));
    const fail = runChecks(page(before), page(after), ['t', 's']).find((x) => !x.pass)!;
    expect(fail.opId).toBe('s');
    expect(attribute(fail, ops)).toBe('s');
  });

  test('falls back to element-scoped ops, then the risk order (text map before spacing)', () => {
    const hidden = basePage().map((e) => (e.id === 'b' ? { ...e, pointerEvents: false } : e));
    const fail = runChecks(page(basePage()), page(hidden), ['t', 'g']).find((x) => !x.pass)!;
    expect(attribute(fail, ops)).toBe('g');
    const clipped = basePage().map((e) => (e.id === 'p1' ? { ...e, truncated: true } : e));
    const fail2 = runChecks(page(basePage()), page(clipped), ['z', 's', 't']).find((x) => !x.pass)!;
    expect(attribute(fail2, ops)).toBe('t');
  });

  test('nothing to attribute: passing results, or no applied ops', () => {
    const pass = runChecks(page(basePage()), page(basePage()), ['t'])[0]!;
    expect(attribute(pass, ops)).toBeNull();
    const fail = runChecks(page(basePage()), page(basePage(), { docScrollW: 2000 }), ['t', 'z']).find((x) => !x.pass)!;
    expect(attribute(fail, ops.map((o) => ({ ...o, status: 'reversed' as const })))).toBeNull();
    // A failure rebuilt from JSON (no metadata) still attributes by check name.
    expect(attribute(JSON.parse(JSON.stringify(fail)), ops)).toBe('t');
  });
});
