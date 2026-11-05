import { describe, expect, test } from 'vitest';
import {
  BODY_MIN_CHARS, bisectColumn, bodySizeFromBlocks, columnLimits, planColumn, planHeadingScale, stepColumn, type BodyBlock,
} from '../../src/text/scale';

/** Alderra's refill page as the reader sees it (apps/server/demo/alderra/alderra.css, refill.html). */
function alderraRefill(): BodyBlock[] {
  return [
    // Main column.
    { fontPx: 13, chars: 524, inMain: true }, // .intro: the page's running text (13/18 px)
    { fontPx: 12, chars: 78, inMain: true, excluded: 'metadata' }, // .rx-meta, one line with an ellipsis
    { fontPx: 12, chars: 37, inMain: true, excluded: 'metadata' },
    { fontPx: 12, chars: 34, inMain: true }, // .patient "Showing prescriptions for Rosa M. ·"
    { fontPx: 14, chars: 40, inMain: true, excluded: 'control' }, // pickup labels
    { fontPx: 12, chars: 60, inMain: true, excluded: 'promo' }, // .upsell-sub
    { fontPx: 12, chars: 83, inMain: true, excluded: 'promo' }, // .membership-sub
    { fontPx: 11, chars: 478, inMain: true, excluded: 'legal' }, // .fineprint: 11 px, after the form
    { fontPx: 13, chars: 52, inMain: true }, // .order-summary
    { fontPx: 11, chars: 50, inMain: true }, // .helpline
    { fontPx: 12, chars: 44, inMain: true }, // tile subtitles
    { fontPx: 12, chars: 41, inMain: true },
    // Outside main.
    { fontPx: 13, chars: 330, inMain: false, excluded: 'consent' }, // cookie banner
    { fontPx: 13, chars: 120, inMain: false, excluded: 'aside' }, // right rail cards
    { fontPx: 12, chars: 900, inMain: false, excluded: 'footer' },
    { fontPx: 15, chars: 66, inMain: false, excluded: 'promo' }, // carousel .hero-sub
    { fontPx: 14, chars: 120, inMain: false, excluded: 'chat' },
  ];
}

describe('bodySizeFromBlocks', () => {
  test('Alderra: the intro paragraph is the body (13 px), not the fine print or metadata (round 2 read 12 px)', () => {
    const b = bodySizeFromBlocks(alderraRefill(), 14);
    expect(b).toMatchObject({ px: 13, source: 'main paragraphs', blocks: 1 });
    // What round 2 did: every running block weighted by characters, fine print included.
    const naive = bodySizeFromBlocks(alderraRefill().map((x) => ({ ...x, excluded: null, fontPx: Math.max(x.fontPx, 12) })), 14);
    expect(naive.px).toBe(12);
  });

  test('char-weighted median over paragraph-like blocks (≥ 60 characters, ≥ 12 px) in main', () => {
    const blocks: BodyBlock[] = [
      { fontPx: 16, chars: 900, inMain: true },
      { fontPx: 18, chars: 300, inMain: true },
      { fontPx: 14, chars: 200, inMain: true },
      { fontPx: 11, chars: 4000, inMain: true }, // fine print below 12 px never counts
      { fontPx: 20, chars: BODY_MIN_CHARS - 1, inMain: true }, // a label
      { fontPx: 13, chars: 5000, inMain: false }, // outside main
    ];
    expect(bodySizeFromBlocks(blocks).px).toBe(16);
  });

  test('falls back to paragraphs anywhere, then shorter text, then the body element\'s size', () => {
    expect(bodySizeFromBlocks([{ fontPx: 17, chars: 200, inMain: false }]).source).toBe('paragraphs');
    expect(bodySizeFromBlocks([{ fontPx: 15, chars: 30, inMain: true }])).toMatchObject({ px: 15, source: 'main text' });
    expect(bodySizeFromBlocks([{ fontPx: 15, chars: 300, inMain: true, excluded: 'footer' }], 14)).toMatchObject({ px: 14, source: 'default' });
    // A front page of headline links.
    expect(bodySizeFromBlocks([{ fontPx: 18, chars: 64, inMain: true, excluded: 'control' }, { fontPx: 12, chars: 20, inMain: true, excluded: 'control' }], 16)).toMatchObject({ px: 18, source: 'main links' });
    expect(bodySizeFromBlocks([]).px).toBe(16);
  });
});

describe('planHeadingScale', () => {
  test('raises weak headings to the ramp (h1 1.75×, h2 1.4×, h3 1.2×) and to weight 600', () => {
    const changes = planHeadingScale([
      { id: 'h1', level: 1, fontPx: 20, weight: 700, chars: 20 },
      { id: 'h2', level: 2, fontPx: 18, weight: 400, chars: 25 },
      { id: 'h3', level: 3, fontPx: 16, weight: 600, chars: 18 },
    ], 16);
    expect(changes).toEqual([
      { id: 'h1', level: 1, fromPx: 20, toPx: 28, weight: null },
      { id: 'h2', level: 2, fromPx: 18, toPx: 22.5, weight: 600 },
      { id: 'h3', level: 3, fromPx: 16, toPx: 19, weight: null },
    ]);
  });

  test('headings that already stand out, h4+, and over-long "headings" are left alone; nothing shrinks', () => {
    expect(planHeadingScale([
      { id: 'a', level: 1, fontPx: 26, weight: 600, chars: 21 }, // Alderra's h1: 2× its 13 px body
      { id: 'b', level: 2, fontPx: 18.5, weight: 700, chars: 25 },
      { id: 'c', level: 4, fontPx: 10, weight: 400, chars: 12 },
      { id: 'd', level: 2, fontPx: 12, weight: 400, chars: 400 },
    ], 13)).toEqual([]);
  });

  test('an eyebrow label marked up as a heading grows at most 1.75× its own size', () => {
    const [c] = planHeadingScale([{ id: 'x', level: 2, fontPx: 10, weight: 700, chars: 14 }], 16);
    expect(c?.toPx).toBe(17.5);
  });

  test('the ramp keeps tiers in order for any body size', () => {
    for (const body of [12, 13, 15, 16, 18, 22]) {
      const out = planHeadingScale([1, 2, 3].map((level) => ({ id: `h${level}`, level, fontPx: body, weight: 400, chars: 20 })), body);
      const size = (id: string) => out.find((c) => c.id === id)?.toPx ?? body;
      expect(size('h1')).toBeGreaterThan(size('h2'));
      expect(size('h2')).toBeGreaterThan(size('h3'));
      expect(size('h3')).toBeGreaterThan(body);
    }
  });
});

describe('planHeadingScale keeps the visual order', () => {
  test('a raised heading stays under larger display text (another level, a lead headline)', () => {
    // SNAP: accordion questions are h2 at 14 px, section titles h3 at 22 px, body 16 px.
    const changes = planHeadingScale([{ id: 'q', level: 2, fontPx: 14, weight: 400, chars: 60, ceilPx: 22 }], 16);
    expect(changes).toEqual([{ id: 'q', level: 2, fromPx: 14, toPx: 21.5, weight: 600 }]);
    // Nothing above it: the ramp.
    expect(planHeadingScale([{ id: 'q', level: 2, fontPx: 14, weight: 400, chars: 60, ceilPx: null }], 16)[0]!.toPx).toBe(22.5);
  });
});

describe('the page column', () => {
  test('the wider of ~70 characters at the fitted size and 78% of the screen, in screen px; CSS width = screen px ÷ zoom', () => {
    // Alderra for rosa: 13 px Helvetica (≈ 6.2 px per character) at 175%: 70 letters is 843 px, 78% of 1440 is 1123.
    const p = planColumn({ screenW: 1440, zoom: 1.75, charPx: 6.2 });
    expect(p).not.toBeNull();
    expect(p!.widthPx).toBe(1120);
    expect(p!.cssPx).toBe(Math.round(1120 / 1.75));
    // Large text on a wide screen: 70 letters wins.
    const big = planColumn({ screenW: 1920, zoom: 2.5, charPx: 8 });
    expect(big!.widthPx).toBe(1520);
    expect(big!.cpl).toBeGreaterThanOrEqual(66);
    expect(big!.cpl).toBeLessThanOrEqual(75);
  });

  test('clamped to [720, screenW − 128]; no column on a narrow screen', () => {
    expect(planColumn({ screenW: 900, zoom: 1, charPx: 5 })!.widthPx).toBe(720);
    expect(planColumn({ screenW: 1440, zoom: 2.5, charPx: 9 })!.widthPx).toBe(1312);
    expect(columnLimits(1440)).toEqual({ minPx: 720, maxPx: 1312 });
    expect(planColumn({ screenW: 840, zoom: 1.5, charPx: 8 })).toBeNull();
    expect(planColumn({ screenW: 1440, zoom: 1.5, charPx: 8, fixedPx: 1000 })!.widthPx).toBe(1000);
  });

  test('Narrower / Wider steps of 80 px inside the limits; bisection between a width that failed and one that fit', () => {
    expect(stepColumn(960, -1, 1440)).toBe(880);
    expect(stepColumn(760, -1, 1440)).toBe(720);
    expect(stepColumn(1280, 1, 1440)).toBe(1312);
    expect(bisectColumn(840, 1312)).toBe(1080);
    expect(bisectColumn(1080, 1312)).toBe(1200);
    expect(bisectColumn(1200, 1312)).toBe(1256);
    expect(bisectColumn(1256, 1312)).toBeNull();
    expect(bisectColumn(900, 800)).toBeNull();
  });
});
