// @vitest-environment happy-dom
// Round 11: the phone text map. Planning (pure), and what it writes and takes back (happy-dom). happy-dom's cascade
// does not resolve em, % or a disabled sheet the way browsers do, so the cascade itself (nested em not scaled twice,
// px line-heights, transitions, k changes without compounding) needs checking in a real browser.
import { afterEach, describe, expect, it } from 'vitest';
import {
  TEXT_SCALE_MAX, TEXT_SCALE_MIN, TextMap, fallbackTextScale, planTextScale, scaleWords, textMapOp, textScaleGate, widthLimitedZoom,
} from './textmap';
import { SheetLayer } from './tailor';

const LADDER = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];

describe('when the text map runs', () => {
  it('only on narrow screens: phones yes, tablets in landscape and desktops never', () => {
    expect(textScaleGate(390)).toBe(true);
    expect(textScaleGate(412)).toBe(true);
    expect(textScaleGate(599)).toBe(true);
    expect(textScaleGate(600)).toBe(false);
    expect(textScaleGate(1280)).toBe(false);
    expect(textScaleGate(0)).toBe(false);
    expect(textScaleGate(Number.NaN)).toBe(false);
  });

  it('k is the rest of the way from the zoom the width allows to the zoom the plan wanted, capped', () => {
    expect(planTextScale(1.75, 1.1)).toBe(1.59);
    expect(planTextScale(1.5, 1.1)).toBe(1.36);
    expect(planTextScale(2.5, 1.1)).toBe(TEXT_SCALE_MAX);
    expect(planTextScale(1.1, 1.1)).toBeNull(); // nothing left to do
    expect(planTextScale(1.15, 1.1)).toBeNull(); // 1.05 < TEXT_SCALE_MIN
    expect(planTextScale(2, 1)).toBe(2);
    expect(planTextScale(Number.NaN, 1)).toBeNull();
  });

  it('the one fallback is halfway, and none when that is too small to matter', () => {
    expect(fallbackTextScale(1.6)).toBe(1.3);
    expect(fallbackTextScale(2)).toBe(1.5);
    expect(fallbackTextScale(1.12)).toBeNull();
    expect(TEXT_SCALE_MIN).toBeGreaterThan(1);
  });

  it('the width-limited zoom steps down from what was measured, not a linear guess (NPS at 390 px)', () => {
    // 200%: the page needed 272 CSS px; 390 / 272 = 1.43, so 125% next. There it needed 324: 1.2, so 110%.
    expect(widthLimitedZoom({ screenPx: 390, scrollW: 272, failedZoom: 2, own: 1, ladder: LADDER })).toBe(1.25);
    expect(widthLimitedZoom({ screenPx: 390, scrollW: 324, failedZoom: 1.25, own: 1, ladder: LADDER })).toBe(1.1);
    // Nothing above the person's own zoom fits.
    expect(widthLimitedZoom({ screenPx: 390, scrollW: 380, failedZoom: 1.1, own: 1, ladder: LADDER })).toBeNull();
    expect(widthLimitedZoom({ screenPx: 390, scrollW: 0, failedZoom: 2, own: 1, ladder: LADDER })).toBeNull();
  });

  it('says k in plain numbers', () => {
    expect(scaleWords(1.59)).toBe('1.6');
    expect(scaleWords(2)).toBe('2');
    expect(scaleWords(1.22)).toBe('1.2');
  });
});

describe('the text map on a page', () => {
  let tm: TextMap | null = null;
  const sheets = new SheetLayer();
  const make = (isOurUi: (el: Element) => boolean = () => false) => {
    tm = new TextMap({ isOurUi, sheets });
    return tm;
  };
  afterEach(() => {
    tm?.clear();
    tm = null;
    sheets.clear();
    document.body.innerHTML = '';
    document.head.querySelectorAll('style').forEach((s) => s.remove());
  });
  const css = (text: string) => {
    const s = document.createElement('style');
    s.textContent = text;
    document.head.append(s);
  };
  const val = (t: TextMap, el: Element | null, prop: string): number | null => {
    const v = el ? t.valuesFor(el)?.find(([p]) => p === prop)?.[1] : undefined;
    return v === undefined ? null : parseFloat(v);
  };

  it('multiplies every text size by the same k, so every ratio stays as the site made it', () => {
    css('h1 { font-size: 40px; } h2 { font-size: 28px; } p { font-size: 16px; } small { font-size: 12px; }');
    document.body.innerHTML = '<h1 id="h1">Title</h1><h2 id="h2">Section</h2><p id="p">Body text <small id="s">fine print</small></p>';
    const t = make();
    t.set(1.5);
    const h1 = val(t, document.getElementById('h1'), 'font-size');
    const h2 = val(t, document.getElementById('h2'), 'font-size');
    const p = val(t, document.getElementById('p'), 'font-size');
    const s = val(t, document.getElementById('s'), 'font-size');
    expect([h1, h2, p, s]).toEqual([60, 42, 24, 18]);
    expect((h1 as number) / (p as number)).toBeCloseTo(40 / 16, 6);
    expect((h2 as number) / (p as number)).toBeCloseTo(28 / 16, 6);
    expect((s as number) / (p as number)).toBeCloseTo(12 / 16, 6);
    // Never pulled up to a target: the small print stays the smallest, at its own share.
    expect(s).toBeLessThan(p as number);
  });

  it('scales px line-height and px letter- and word-spacing with the font; normal is left to follow by itself', () => {
    css('#a { font-size: 16px; line-height: 20px; letter-spacing: 1px; word-spacing: 2px; } #b { font-size: 16px; }');
    document.body.innerHTML = '<p id="a">Fixed line height</p><p id="b">Normal line height</p>';
    const t = make();
    t.set(1.5);
    const a = document.getElementById('a');
    expect(val(t, a, 'font-size')).toBe(24);
    expect(val(t, a, 'line-height')).toBe(30); // 16/20 -> 24/30, never 24/20 (lines over lines)
    expect(val(t, a, 'letter-spacing')).toBe(1.5);
    expect(val(t, a, 'word-spacing')).toBe(3);
    expect(val(t, document.getElementById('b'), 'line-height')).toBeNull();
  });

  it('writes tokens and one sheet only: the site’s inline styles stay byte for byte, and come back after clear', () => {
    document.body.innerHTML = '<p id="p" style="font-size: 14px;color:rgb(1, 2, 3)  ;  margin: 0">Inline</p><span id="s" style="FONT-SIZE:12PX">x</span>';
    const p = document.getElementById('p') as HTMLElement;
    const s = document.getElementById('s') as HTMLElement;
    const before = [p.getAttribute('style'), s.getAttribute('style')];
    const t = make();
    t.set(1.4);
    expect(p.getAttribute('style')).toBe(before[0]);
    expect(s.getAttribute('style')).toBe(before[1]);
    expect(p.hasAttribute('data-wa-tm')).toBe(true);
    expect(val(t, p, 'font-size')).toBe(19.6);
    t.clear();
    expect([p.getAttribute('style'), s.getAttribute('style')]).toEqual(before);
    expect(document.querySelectorAll('[data-wa-tm]').length).toBe(0);
    expect(document.adoptedStyleSheets.length).toBe(0);
  });

  it('an inline !important size (only an inline value beats it) is overridden inline and put back byte for byte', () => {
    document.body.innerHTML = '<p id="p" style="font-size: 14px !important; color: red">Pinned by the site</p><p id="q">no style</p>';
    const p = document.getElementById('p') as HTMLElement;
    const orig = p.getAttribute('style');
    const t = make();
    t.set(1.5);
    expect(p.style.getPropertyValue('font-size')).toBe('21px');
    expect(p.style.getPropertyPriority('font-size')).toBe('important');
    expect(p.hasAttribute('data-wa-tm')).toBe(false);
    t.clear();
    expect(p.getAttribute('style')).toBe(orig);
    expect(document.getElementById('q')?.hasAttribute('style')).toBe(false);
  });

  it('text added later gets the same k (a MutationObserver), with nothing re-read from WebAble’s own writes', async () => {
    css('li { font-size: 18px; }');
    document.body.innerHTML = '<ul id="u"><li>First</li></ul>';
    const t = make();
    t.set(1.5);
    const refreshes = t.stats.refreshes;
    const li = document.createElement('li');
    li.textContent = 'Loaded later';
    document.getElementById('u')?.append(li);
    await new Promise((r) => setTimeout(r, 0));
    expect(li.hasAttribute('data-wa-tm')).toBe(true);
    expect(val(t, li, 'font-size')).toBe(27);
    expect(t.stats.refreshes).toBe(refreshes + 1);
    // WebAble's own token writes do not come back as mutations to read again.
    await new Promise((r) => setTimeout(r, 0));
    expect(t.stats.refreshes).toBe(refreshes + 1);
    // Text put into an element that had none.
    const div = document.createElement('div');
    document.body.append(div);
    await new Promise((r) => setTimeout(r, 0));
    div.append(document.createTextNode('now it has text'));
    await new Promise((r) => setTimeout(r, 0));
    expect(div.hasAttribute('data-wa-tm')).toBe(true);
  });

  it('leaves WebAble’s own UI, SVG and MathML text, icon glyphs and scripts alone', () => {
    css('.icon { font-family: "Material Icons"; font-size: 24px; } p { font-size: 16px; }');
    document.body.innerHTML = `
      <p id="p">Page text</p>
      <div id="ours"><span id="oursText">WebAble panel</span></div>
      <svg><text id="svgText" x="0" y="10">Chart label</text></svg>
      <span id="icon" class="icon">menu</span>
      <script id="sc">var x = 1;</script>`;
    const ours = document.getElementById('ours') as Element;
    const t = make((el) => el === ours || ours.contains(el));
    t.set(1.5);
    expect(document.getElementById('p')?.hasAttribute('data-wa-tm')).toBe(true);
    expect(document.getElementById('oursText')?.hasAttribute('data-wa-tm')).toBe(false);
    expect(document.getElementById('svgText')?.hasAttribute('data-wa-tm')).toBe(false);
    expect(document.getElementById('icon')?.hasAttribute('data-wa-tm')).toBe(false);
    expect(t.skipOf(document.getElementById('icon') as Element)).toBe('icon');
    expect(document.getElementById('sc')?.hasAttribute('data-wa-tm')).toBe(false);
    // WebAble's own host element, wherever it is mounted.
    const host = document.createElement('webable-ui');
    host.textContent = 'ui';
    document.body.append(host);
    expect(t.candidates().includes(host)).toBe(false);
  });

  it('text fields are scaled with the text (typed text is read too); a checkbox has no text to scale', () => {
    css('input, select, textarea { font-size: 16px; }');
    document.body.innerHTML = '<input id="t" type="search"><input id="c" type="checkbox"><textarea id="ta"></textarea><select id="s"><option>One</option></select>';
    const t = make();
    const c = t.candidates().map((el) => el.id);
    expect(c).toContain('t');
    expect(c).toContain('ta');
    expect(c).toContain('s');
    expect(c).not.toContain('c');
  });

  it('a new k is the page’s own sizes × the new k, never × the old one too (re-read with the map lifted)', () => {
    css('p { font-size: 16px; line-height: 24px; }');
    document.body.innerHTML = '<p id="p">Body</p>';
    const t = make();
    t.set(1.5);
    expect(val(t, document.getElementById('p'), 'font-size')).toBe(24);
    // happy-dom does not apply a disabled sheet's absence, so the re-read itself is proven in the browser test; the
    // values a k change writes come from the stored base sizes.
    const op = textMapOp(t, 1.25, { zoom: 1.1, wantZoom: 1.5, source: 'fit', bodyPx: 16, targetPx: 22, idOf: () => 'n1' });
    expect(op.rec.kind).toBe('text_map');
    expect(op.persistent).toBe(true);
    expect(op.title).toContain('1.3× bigger');
    expect(op.detail).toContain('110%');
  });

  it('the op’s Undo takes the map off, and an older op never takes a newer one’s map', () => {
    css('p { font-size: 16px; }');
    document.body.innerHTML = '<p id="p">Body</p>';
    const t = make();
    const a = textMapOp(t, 1.5, { zoom: 1.1, wantZoom: 1.65, source: 'fit', bodyPx: 16, targetPx: 24, idOf: () => 'n1' });
    void a.apply();
    expect(t.scale).toBe(1.5);
    const b = textMapOp(t, 1.3, { zoom: 1.1, wantZoom: 1.43, source: 'check', bodyPx: 16, targetPx: 24, idOf: () => 'n1' });
    void b.apply();
    void a.revert(); // superseded: leaves b's map on
    expect(t.scale).toBe(1.3);
    expect(document.getElementById('p')?.hasAttribute('data-wa-tm')).toBe(true);
    void b.revert();
    expect(t.scale).toBe(1);
    expect(document.querySelectorAll('[data-wa-tm]').length).toBe(0);
  });
});
