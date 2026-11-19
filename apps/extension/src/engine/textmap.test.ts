// @vitest-environment happy-dom
// The text map: text size on every screen, without zoom. Planning and proportions (pure), and what it writes and
// takes back (happy-dom). happy-dom's cascade does not resolve em, % or a disabled sheet the way browsers do, so the
// cascade itself (nested em not scaled twice, px line-heights, transitions, k changes without compounding) was
// proven in a real Chromium and WebKit by a browser test in the Gator Hack repo.
import { afterEach, describe, expect, it } from 'vitest';
import {
  HEADING_EXP_MIN,
  KEEP_SHARE,
  SMALL_TEXT_FLOOR,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TextMap,
  fallbackTextScale,
  headingExponent,
  mappedTextPx,
  planTextScale,
  scaleWords,
  textMapOp,
  textRatio,
} from './textmap';
import { SheetLayer } from './tailor';

describe('how big body text gets', () => {
  it('k is how far body text has to grow from the person’s own zoom to the size the plan wants, capped', () => {
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

  it('says k in plain numbers', () => {
    expect(scaleWords(1.59)).toBe('1.6');
    expect(scaleWords(2)).toBe('2');
    expect(scaleWords(1.22)).toBe('1.2');
  });
});

describe('proportions: every text size from the page’s body size and the person’s', () => {
  const SIZES = [
    8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32, 40, 48, 64, 96,
    128,
  ];
  const KS = [1.08, 1.25, 1.5, 1.75, 2];

  it('body text lands exactly on the person’s size', () => {
    for (const k of KS) expect(mappedTextPx(16, 16, k)).toBeCloseTo(16 * k, 2);
    expect(mappedTextPx(18, 18, 1.5)).toBe(27);
  });

  it('keeps every size in its order, and sizes that differ still differ', () => {
    for (const body of [14, 16, 18, 20]) {
      for (const k of KS) {
        const out = SIZES.map((f) => mappedTextPx(f, body, k));
        for (let i = 1; i < out.length; i++)
          expect(out[i] as number).toBeGreaterThan(out[i - 1] as number);
      }
    }
  });

  it('never makes text smaller than the site’s own, and does nothing at k ≤ 1', () => {
    for (const k of KS)
      for (const f of SIZES)
        expect(mappedTextPx(f, 16, k)).toBeGreaterThanOrEqual(f);
    expect(textRatio(16, 16, 1)).toBe(1);
    expect(textRatio(16, 16, 0.8)).toBe(1);
    expect(textRatio(40, 16, Number.NaN)).toBe(1);
    // An unknown body size: every size × k, as before.
    expect(textRatio(40, 0, 1.5)).toBe(1.5);
  });

  it('headings grow less than body text, the more so the larger they are, and stay larger than body text', () => {
    // 16 px body, 1.5×: 24 px body text. h3 20, h2 28, h1 40, a 64 px headline.
    const k = 1.5;
    const body = mappedTextPx(16, 16, k);
    const [h3, h2, h1, hero] = [20, 28, 40, 64].map((f) =>
      mappedTextPx(f, 16, k),
    ) as [number, number, number, number];
    expect(h3).toBeLessThan(20 * k);
    expect(h1).toBeLessThan(40 * k);
    expect(hero).toBeLessThan(64 * k);
    // Each grows by less than the one below it...
    expect(textRatio(64, 16, k)).toBeLessThan(textRatio(40, 16, k));
    expect(textRatio(40, 16, k)).toBeLessThan(textRatio(20, 16, k));
    // ...and the hierarchy is still plain to see: h1 well over 1.5× body, h3 over 1.1×.
    expect(h1 / body).toBeGreaterThan(1.75);
    expect(h2 / body).toBeGreaterThan(1.4);
    expect(h3 / body).toBeGreaterThan(1.15);
  });

  it('the larger k is, the more headings are held back, never past the exponent floor', () => {
    expect(headingExponent(1)).toBe(1);
    expect(headingExponent(1.5)).toBeGreaterThan(headingExponent(2));
    expect(headingExponent(8)).toBe(HEADING_EXP_MIN);
    // At 2× a 32 px h1 on 16 px body is about 50 px, not 64: still over 1.5× the 32 px body text.
    const h1 = mappedTextPx(32, 16, 2);
    expect(h1).toBeGreaterThan(48);
    expect(h1).toBeLessThan(54);
  });

  it('a headline already larger than its share stays as the site made it', () => {
    expect(mappedTextPx(128, 16, 1.25)).toBe(128);
  });

  it('small text grows with body text, and tiny text is lifted part of the way, never past body text', () => {
    const k = 1.5; // 24 px body text; floor 18
    expect(mappedTextPx(14, 16, k)).toBe(21); // in proportion
    expect(mappedTextPx(12, 16, k)).toBe(18); // in proportion, at the floor
    const tiny = mappedTextPx(10, 16, k);
    expect(tiny).toBeGreaterThan(15); // more than 10 × 1.5
    expect(tiny).toBeLessThan(24 * SMALL_TEXT_FLOOR); // still under the floor, so under 12 px text
    expect(tiny).toBeLessThanOrEqual(10 * k * 1.3 + 0.01);
    for (const f of [8, 10, 12, 14, 15])
      expect(mappedTextPx(f, 16, k)).toBeLessThan(mappedTextPx(16, 16, k));
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

  it('gives each text its own size from the body size: body on the person’s size, headings and small print in proportion', () => {
    css(
      'h1 { font-size: 40px; } h2 { font-size: 28px; } p { font-size: 16px; } small { font-size: 12px; }',
    );
    document.body.innerHTML =
      '<h1 id="h1">Title</h1><h2 id="h2">Section</h2><p id="p">Body text <small id="s">fine print</small></p>';
    const t = make();
    t.set(1.5, 16);
    const h1 = val(t, document.getElementById('h1'), 'font-size');
    const h2 = val(t, document.getElementById('h2'), 'font-size');
    const p = val(t, document.getElementById('p'), 'font-size');
    const s = val(t, document.getElementById('s'), 'font-size');
    expect([h1, h2, p, s]).toEqual([
      mappedTextPx(40, 16, 1.5),
      mappedTextPx(28, 16, 1.5),
      24,
      18,
    ]);
    // Order and hierarchy as the site made it; headings not blown up to 60 and 42.
    expect(h1 as number).toBeGreaterThan(h2 as number);
    expect(h2 as number).toBeGreaterThan(p as number);
    expect(s as number).toBeLessThan(p as number);
    expect(h1 as number).toBeLessThan(60);
  });

  it('text in a fixed or sticky layer (a player, a sticky header) grows half as much, in the same order', () => {
    css('p, b { font-size: 16px; } small { font-size: 12px; }');
    document.body.innerHTML =
      '<div style="position: sticky; top: 0"><b id="b">On air now</b><small id="s">Live</small></div><p id="p">Body</p>';
    const t = make();
    t.set(1.5, 16);
    expect(val(t, document.getElementById('p'), 'font-size')).toBe(24);
    expect(val(t, document.getElementById('b'), 'font-size')).toBe(20);
    expect(val(t, document.getElementById('s'), 'font-size')).toBe(15);
  });

  it('a box kept at the site’s sizes (no room there) is left alone; the rest of the page takes the size', () => {
    css('p, a { font-size: 16px; } nav a { font-size: 14px; }');
    document.body.innerHTML =
      '<nav id="nav"><a id="a1" href="#">Home</a><a id="a2" href="#">News</a></nav><p id="p">Body</p>';
    const t = make();
    t.keep([document.getElementById('nav') as Element]);
    t.set(1.5, 16);
    expect(t.skipOf(document.getElementById('a1') as Element)).toBe('room');
    expect(document.getElementById('a2')?.hasAttribute('data-wa-tm')).toBe(
      false,
    );
    expect(val(t, document.getElementById('p'), 'font-size')).toBe(24);
    expect(t.stats.skipped.room).toBe(2);
    t.clear();
    expect(t.keptBoxes.length).toBe(0);
  });

  it('text in a web component (open shadow root) is sized too: slotted text through its slot, both halves alike', () => {
    // Chrome gives the span the slot's 12 px through the flat tree; happy-dom does not, so it is set here.
    css('p { font-size: 16px; } #span { font-size: 12px; }');
    document.body.innerHTML =
      '<x-tagline id="host">An official website of the <span id="span">United States government</span></x-tagline><p id="p">Body</p>';
    const host = document.getElementById('host') as Element;
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<div style="font-size: 12px"><slot id="slot"></slot></div>';
    const slot = sr.getElementById('slot') as Element;
    const t = make();
    expect(t.candidates()).toContain(slot);
    t.set(1.5, 16);
    const span = document.getElementById('span');
    expect(val(t, slot, 'font-size')).toBe(val(t, span, 'font-size'));
    expect(val(t, slot, 'font-size')).toBe(18);
    expect(slot.hasAttribute('data-wa-tm')).toBe(true);
    t.clear();
    expect(slot.hasAttribute('data-wa-tm')).toBe(false);
  });

  it('a box at half growth (KEEP_SHARE) grows half as much, then can go down to the site’s sizes but never back up', () => {
    css('p, a { font-size: 16px; }');
    document.body.innerHTML =
      '<nav id="nav"><a id="a1" href="#">Home page</a></nav><p id="p">Body</p>';
    const nav = document.getElementById('nav') as Element;
    const t = make();
    t.keep([nav], KEEP_SHARE);
    t.set(1.5, 16);
    expect(val(t, document.getElementById('a1'), 'font-size')).toBe(20);
    expect(val(t, document.getElementById('p'), 'font-size')).toBe(24);
    t.keep([nav], 0);
    t.keep([nav], KEEP_SHARE);
    expect(t.keptShare(nav)).toBe(0);
    t.set(1.5, 16);
    expect(t.skipOf(document.getElementById('a1') as Element)).toBe('room');
  });

  it('scales px line-height and px letter- and word-spacing with the font; normal is left to follow by itself', () => {
    css(
      '#a { font-size: 16px; line-height: 20px; letter-spacing: 1px; word-spacing: 2px; } #b { font-size: 16px; }',
    );
    document.body.innerHTML =
      '<p id="a">Fixed line height</p><p id="b">Normal line height</p>';
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
    document.body.innerHTML =
      '<p id="p" style="font-size: 14px;color:rgb(1, 2, 3)  ;  margin: 0">Inline</p><span id="s" style="FONT-SIZE:12PX">x</span>';
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
    document.body.innerHTML =
      '<p id="p" style="font-size: 14px !important; color: red">Pinned by the site</p><p id="q">no style</p>';
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
    expect(val(t, li, 'font-size')).toBe(mappedTextPx(18, 16, 1.5));
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
    css(
      '.icon { font-family: "Material Icons"; font-size: 24px; } p { font-size: 16px; }',
    );
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
    expect(
      document.getElementById('oursText')?.hasAttribute('data-wa-tm'),
    ).toBe(false);
    expect(document.getElementById('svgText')?.hasAttribute('data-wa-tm')).toBe(
      false,
    );
    expect(document.getElementById('icon')?.hasAttribute('data-wa-tm')).toBe(
      false,
    );
    expect(t.skipOf(document.getElementById('icon') as Element)).toBe('icon');
    expect(document.getElementById('sc')?.hasAttribute('data-wa-tm')).toBe(
      false,
    );
    // WebAble's own host element, wherever it is mounted.
    const host = document.createElement('webable-ui');
    host.textContent = 'ui';
    document.body.append(host);
    expect(t.candidates().includes(host)).toBe(false);
  });

  it('text fields are scaled with the text (typed text is read too); a checkbox has no text to scale', () => {
    css('input, select, textarea { font-size: 16px; }');
    document.body.innerHTML =
      '<input id="t" type="search"><input id="c" type="checkbox"><textarea id="ta"></textarea><select id="s"><option>One</option></select>';
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
    const op = textMapOp(t, 1.25, {
      zoom: 1,
      wantZoom: 1.25,
      source: 'fit',
      bodyPx: 16,
      targetPx: 20,
      idOf: () => 'n1',
    });
    expect(op.rec.kind).toBe('text_map');
    expect(op.persistent).toBe(true);
    expect(op.title).toBe(
      'Made the text bigger: body text is 20 px, was 16 px',
    );
    expect(op.detail).toContain('keeps the site’s own layout');
    expect(op.detail).not.toMatch(/zoom/i);
  });

  it('the op’s Undo takes the map off, and an older op never takes a newer one’s map', () => {
    css('p { font-size: 16px; }');
    document.body.innerHTML = '<p id="p">Body</p>';
    const t = make();
    const a = textMapOp(t, 1.5, {
      zoom: 1.1,
      wantZoom: 1.65,
      source: 'fit',
      bodyPx: 16,
      targetPx: 24,
      idOf: () => 'n1',
    });
    void a.apply();
    expect(t.scale).toBe(1.5);
    const b = textMapOp(t, 1.3, {
      zoom: 1.1,
      wantZoom: 1.43,
      source: 'check',
      bodyPx: 16,
      targetPx: 24,
      idOf: () => 'n1',
    });
    void b.apply();
    void a.revert(); // superseded: leaves b's map on
    expect(t.scale).toBe(1.3);
    expect(document.getElementById('p')?.hasAttribute('data-wa-tm')).toBe(true);
    void b.revert();
    expect(t.scale).toBe(1);
    expect(document.querySelectorAll('[data-wa-tm]').length).toBe(0);
  });
});
