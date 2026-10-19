import { expect, test, type Page } from '@playwright/test';

import {
  domState,
  inconsistencies,
  inversions,
  open,
  plan,
  styleState,
  textStates,
  type TextState,
} from './helpers';

/**
 * Tailor v2 (docs/10 §5.2) on the page that reproduces the v1 screenshot
 * failures (fixtures/cards.html): a header whose nav labels are wrapped six
 * deep, a mail rail with badges over icons, rows with ellipsized senders and
 * subjects, a video grid with clamped titles and duration badges over
 * thumbnails, and an article.
 */

/** Regions whose size order must survive: each row, card and section. */
const REGIONS = [
  'header.masthead',
  'nav.rail a',
  'tr.row',
  'table.rows',
  '.vcard',
  '.grid',
  'article.story',
  'figure',
];

const overlaps = (a: TextState['box'], b: TextState['box']): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

const contains = (a: TextState['box'], b: TextState['box']): boolean =>
  a.left <= b.left + 0.5 &&
  a.top <= b.top + 0.5 &&
  a.right >= b.right - 0.5 &&
  a.bottom >= b.bottom - 0.5;

/** Pictures and icons, as boxes in document coordinates. */
function mediaBoxes(page: Page): Promise<Array<TextState['box']>> {
  return page.evaluate(() =>
    [...document.querySelectorAll('img, svg')].map((m) => {
      const r = m.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top + scrollY,
        right: r.right,
        bottom: r.bottom + scrollY,
      };
    }),
  );
}

/** Pairs (text-text and text-picture) that overlap now and did not before. */
function newOverlaps(
  before: readonly TextState[],
  after: readonly TextState[],
  mediaBefore: ReadonlyArray<TextState['box']>,
  mediaAfter: ReadonlyArray<TextState['box']>,
): string[] {
  const out: string[] = [];
  for (const a of before)
    for (const b of before) {
      if (a.i >= b.i) continue;
      if (contains(a.box, b.box) || contains(b.box, a.box)) continue;
      const aa = (after[a.i] as TextState).box;
      const ab = (after[b.i] as TextState).box;
      if (contains(aa, ab) || contains(ab, aa)) continue;
      if (overlaps(a.box, b.box) < 1 && overlaps(aa, ab) >= 1)
        out.push(`${a.field} over ${b.field}`);
    }
  for (const t of before)
    mediaBefore.forEach((m, k) => {
      const now = (after[t.i] as TextState).box;
      const grew =
        overlaps(now, mediaAfter[k] as TextState['box']) - overlaps(t.box, m);
      if (grew >= 1) out.push(`${t.field} over picture ${k}`);
    });
  return out;
}

async function read(page: Page): Promise<{
  text: TextState[];
  media: Array<TextState['box']>;
}> {
  return {
    text: await textStates(page, 'body', REGIONS),
    media: await mediaBoxes(page),
  };
}

const fontSize = (page: Page, q: string): Promise<number[]> =>
  page
    .locator(q)
    .evaluateAll((els) =>
      els.map((el) => parseFloat(getComputedStyle(el).fontSize)),
    );

test.describe('Tailor v2 on cards, rows and an article', () => {
  test('text grows only where it can: no inversion, one size per field, no new truncation or overlap', async ({
    page,
  }) => {
    await open(page, 'cards');
    await page.evaluate(() => window.__webableEngine.extract());
    const before = await read(page);
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 3 }]),
    );
    expect(changes[0]).toMatchObject({ op: 'text_floor', status: 'applied' });
    expect(changes[0]?.fit).toEqual({
      before: '14 px',
      after: '21 px',
    });
    const after = await read(page);
    expect(after.text.length).toBe(before.text.length);

    // Kendall tau = 1 per row, card and section (ties allowed).
    expect(inversions(before.text, after.text)).toEqual([]);
    // Same template field at the same native size: same size after.
    expect(inconsistencies(before.text, after.text)).toEqual([]);
    // Nothing is cut off more than before.
    const cut = before.text
      .filter((t) => (after.text[t.i] as TextState).shown < t.shown - 0.01)
      .map(
        (t) =>
          `${t.field} ${t.shown} -> ${(after.text[t.i] as TextState).shown}`,
      );
    expect(cut).toEqual([]);
    // Nothing newly covers other text or a picture.
    expect(
      newOverlaps(before.text, after.text, before.media, after.media),
    ).toEqual([]);

    // The article reads at the person's size; its headings grow less.
    for (const q of [
      'article.story > p:not(.byline)',
      'article.story li',
      'article.story .byline',
      'figcaption',
    ])
      expect(new Set(await fontSize(page, q)), q).toEqual(new Set([21]));
    const [h1] = await fontSize(page, 'article.story h1');
    const [h2] = await fontSize(page, 'article.story h2');
    expect(h1).toBeGreaterThan(28);
    expect(h1! / 28).toBeLessThan(h2! / 20);
    expect(h2! / 20).toBeLessThan(21 / 14);
    expect(h2).toBeGreaterThan(21);

    // The header, its six-deep nav labels and the mail rail are never touched.
    expect(new Set(await fontSize(page, '.navlabel'))).toEqual(new Set([12]));
    expect(new Set(await fontSize(page, 'nav.rail .badge'))).toEqual(
      new Set([10]),
    );
    // Rows whose sender and subject are ellipsized keep their sizes, and the
    // timestamp never outgrows the subject.
    expect(
      new Set(await fontSize(page, 'td.sender, td.subject .subj')),
    ).toEqual(new Set([14]));
    expect(new Set(await fontSize(page, 'td.date span'))).toEqual(
      new Set([12]),
    );
    // Clamped titles keep their size, so metadata and badges stay below them.
    expect(new Set(await fontSize(page, 'a.vlink'))).toEqual(new Set([14]));
    expect(
      Math.max(...(await fontSize(page, '.meta span, .duration'))),
    ).toBeLessThanOrEqual(14);

    // Undo leaves the page exactly as it was.
    await page.evaluate(() => window.__webableEngine.undo('all'));
    const undone = await read(page);
    expect(undone.text.map((t) => [t.field, t.px])).toEqual(
      before.text.map((t) => [t.field, t.px]),
    );
  });

  test('a full plan keeps the header nav apart and badges off their icons', async ({
    page,
  }) => {
    await open(page, 'cards');
    await page.evaluate(() => window.__webableEngine.extract());
    const before = await read(page);
    const badges0 = await page
      .locator('nav.rail .badge')
      .evaluateAll((els) =>
        els.map((el) => JSON.stringify(el.getBoundingClientRect())),
      );
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([
        { op: 'text_floor', level: 4 },
        { op: 'line_spacing', level: 1 },
        { op: 'target_size', level: 2 },
        { op: 'contrast' },
      ]),
    );
    expect(
      Object.fromEntries(changes.map((c) => [c.op, c.status])),
    ).toMatchObject({ text_floor: 'applied', target_size: 'applied' });
    // At the top of the page the top stays in view: no reading-place scroll.
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const after = await read(page);
    expect(inversions(before.text, after.text)).toEqual([]);
    expect(inconsistencies(before.text, after.text)).toEqual([]);
    expect(
      newOverlaps(before.text, after.text, before.media, after.media),
    ).toEqual([]);
    // Nav links never overlap one another.
    const links = await page
      .locator('header nav a')
      .evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().toJSON()),
      );
    for (let a = 0; a < links.length; a++)
      for (let b = a + 1; b < links.length; b++)
        expect(overlaps(links[a], links[b]), `nav ${a} ${b}`).toBe(0);
    expect(
      await page
        .locator('nav.rail .badge')
        .evaluateAll((els) =>
          els.map((el) => JSON.stringify(el.getBoundingClientRect())),
        ),
    ).toEqual(badges0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });

  test('when the fit would break the page it is rolled back whole, never element by element', async ({
    page,
  }) => {
    await open(page, 'cards');
    // A notes panel whose height comes from a fixed-height flex column four
    // levels up: no style near the text says it cannot grow. The column is
    // as tall as the text at its own size (measured, so font metrics do not
    // matter): it fits exactly until the text grows.
    await page.evaluate(() => {
      const panel = document.createElement('div');
      panel.className = 'notes';
      panel.innerHTML =
        '<div class="pane"><div><div><p>Small print that fits this panel exactly until it grows, then the panel cuts it off.</p><p>A second line of small print written to fill the same panel.</p></div></div></div>';
      document.querySelector('article.story')?.append(panel);
      const style = document.createElement('style');
      style.textContent =
        '.notes { display: flex; flex-direction: column; width: 340px; } .notes .pane { flex: 1; min-height: 0; overflow: hidden; } .notes p { font-size: 14px; line-height: 20px; margin: 0; }';
      document.head.append(style);
      const fit = (panel.firstElementChild as HTMLElement).scrollHeight;
      style.textContent += ` .notes { height: ${fit}px; }`;
    });
    await page.evaluate(() => window.__webableEngine.extract());
    const dom0 = await domState(page);
    const css0 = await styleState(page);
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 3 }]),
    );
    expect(changes[0]).toMatchObject({
      op: 'text_floor',
      status: 'undone_by_checks',
      vcode: 'clip',
    });
    // Every paragraph, the article's included: back as the site made them.
    expect(await domState(page)).toEqual(dom0);
    expect(await styleState(page)).toEqual(css0);
  });

  test('a size inversion the page itself causes is caught and rolled back whole', async ({
    page,
  }) => {
    await open(page, 'cards');
    // A site script that reacts to the change: once paragraphs are resized,
    // it shrinks the section heading below them.
    await page.evaluate(() => {
      const h2 = document.querySelector('article.story h2') as HTMLElement;
      const story = document.querySelector('article.story') as HTMLElement;
      new MutationObserver(() => {
        h2.style.setProperty('font-size', '16px', 'important');
      }).observe(story, { attributes: true, subtree: true });
      // The reader is at the article.
      window.scrollTo(0, story.getBoundingClientRect().top + scrollY - 40);
    });
    await page.evaluate(() => window.__webableEngine.extract());
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 3 }]),
    );
    expect(changes[0]).toMatchObject({
      op: 'text_floor',
      status: 'undone_by_checks',
      vcode: 'hierarchy',
    });
    expect(
      new Set(await fontSize(page, 'article.story > p:not(.byline)')),
    ).toEqual(new Set([14]));
  });
});

/** Every visible text (own characters, a box) with its region, size and box. */
interface RankedText {
  i: number;
  region: string;
  px: number;
  sel: string;
  box: { left: number; top: number; right: number; bottom: number };
}

async function rankedTexts(page: Page): Promise<RankedText[]> {
  const keys = await page.evaluate(() => window.__webableEngine.regionKeys());
  return page.evaluate((regions) => {
    const roots = new Map<Element, string>();
    for (const { key, el } of regions)
      for (const e of document.querySelectorAll(el)) roots.set(e, key);
    const regionOf = (el: Element): string => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const k = roots.get(n);
        if (k) return k;
      }
      return 'page';
    };
    const out: RankedText[] = [];
    let i = 0;
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].some(
        (n) => n.nodeType === 3 && (n.nodeValue ?? '').trim(),
      );
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      out.push({
        i: i++,
        region: regionOf(el),
        px: parseFloat(getComputedStyle(el).fontSize),
        sel: `${el.localName}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}`,
        box: {
          left: r.left,
          top: r.top + scrollY,
          right: r.right,
          bottom: r.bottom + scrollY,
        },
      });
    }
    return out;
  }, keys);
}

/** The eval's hierarchy gate: pairs in one region whose size order flipped (ties of 0.5 px allowed). */
function regionInversions(
  before: readonly RankedText[],
  after: readonly RankedText[],
): string[] {
  const out: string[] = [];
  for (const a of before)
    for (const b of before) {
      if (a.region !== b.region || !(a.px + 0.5 <= b.px)) continue;
      const aa = after[a.i] as RankedText;
      const ab = after[b.i] as RankedText;
      if (aa.px >= ab.px + 0.5)
        out.push(`${a.sel} ${a.px}->${aa.px} over ${b.sel} ${b.px}->${ab.px}`);
    }
  return out;
}

test.describe('text_floor ranks per region (eval B6)', () => {
  for (const level of [3, 5, 7]) {
    test(`level ${level}: no text passes a text natively larger in its region, labels stay in their buttons, rows stay one line, one size per template`, async ({
      page,
    }) => {
      await open(page, 'ranks');
      await page.evaluate(() => window.__webableEngine.extract());
      const before = await rankedTexts(page);
      const rows0 = await page
        .locator('ul.links li')
        .evaluateAll((els) =>
          els.map((el) => el.getBoundingClientRect().height),
        );
      const changes = await page.evaluate(
        (p) => window.__webableEngine.apply(p),
        plan([{ op: 'text_floor', level }]),
      );
      expect(changes[0]).toMatchObject({ op: 'text_floor', status: 'applied' });
      const after = await rankedTexts(page);
      expect(after.map((t) => t.sel)).toEqual(before.map((t) => t.sel));
      // The gate as the eval measures it, screen-reader-only text included.
      expect(regionInversions(before, after)).toEqual([]);
      // Running text grew: the fit is not held back to nothing.
      const blurb = after.find((t) => t.sel === 'p.blurb') as RankedText;
      expect(blurb.px).toBeGreaterThan(16);
      // The chip keeps its size, and nothing in its region passes it.
      expect(new Set(await fontSize(page, '.eyebrow'))).toEqual(new Set([24]));
      expect(
        Math.max(...(await fontSize(page, 'section.shop *:not(.eyebrow)'))),
      ).toBeLessThanOrEqual(24);
      // "Shop all" stays inside its 36 px pill.
      const [label, pill] = await page.evaluate(() =>
        ['a.shop .label', 'a.shop'].map((q) =>
          document.querySelector(q)!.getBoundingClientRect().toJSON(),
        ),
      );
      expect(label.top).toBeGreaterThanOrEqual(pill.top - 0.5);
      expect(label.bottom).toBeLessThanOrEqual(pill.bottom + 0.5);
      expect(label.right).toBeLessThanOrEqual(pill.right + 0.5);
      // Inline code inherits its paragraph's growth and stays below the
      // branch label it was smaller than.
      const [code] = await fontSize(page, 'section.readme code');
      expect(code).toBeLessThanOrEqual(14);
      // One-line rows of the list stay one line (equal heights).
      const rows = await page
        .locator('ul.links li')
        .evaluateAll((els) =>
          els.map((el) => el.getBoundingClientRect().height),
        );
      expect(Math.max(...rows0) / Math.min(...rows0)).toBeLessThan(1.08);
      expect(Math.max(...rows) / Math.min(...rows)).toBeLessThan(1.15);
      // Fields that differ only in a fourth class end at one size.
      expect(new Set(await fontSize(page, '.tile span')).size).toBe(1);
      // A description never outgrows the heading that introduces it, even
      // at the same native size.
      const [heading] = await fontSize(page, '.side h2');
      const [about] = await fontSize(page, '.side p');
      expect(about).toBeLessThanOrEqual(heading as number);
    });
  }

  test('a control’s label is no ceiling for running text: a "+" or a fixed-size button stays as it is, a heading in a button stays above its text', async ({
    page,
  }) => {
    // Delayed rendering (an app that fills main after load) with a 24 px
    // "+" button at the browser's default 13.33 px: it must not hold 12 px
    // running text below an 16 px fit. Beside it, a fixed-height button
    // with a 14 px label, and an accordion whose heading is a button in an
    // h2 that keeps its 14 px size (it ellipsizes).
    await open(page, 'hydration');
    await expect(page.locator('#story')).toBeAttached();
    await page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement;
      main
        .querySelector('button')
        ?.insertAdjacentHTML(
          'afterend',
          '<button class="save" type="button">Subscribe</button>',
        );
      main.insertAdjacentHTML(
        'beforeend',
        '<section class="faq" aria-label="Questions"><h2><button class="acc" type="button">Shipping and returns</button></h2><p class="answer">Orders leave the warehouse within two working days, and every return is free for thirty days after delivery.</p></section>',
      );
      const style = document.createElement('style');
      style.textContent =
        '.save { width: auto; height: 28px; padding: 0 8px; font-size: 14px; } .acc { display: inline-block; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; border: 0; background: none; font: inherit; font-size: 14px; }';
      document.head.append(style);
    });
    await page.evaluate(() => window.__webableEngine.extract());
    const before = await rankedTexts(page);
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 1 }]),
    );
    expect(changes[0]).toMatchObject({ op: 'text_floor', status: 'applied' });
    // Running text reaches the fit past both control labels.
    expect(new Set(await fontSize(page, 'main > p'))).toEqual(new Set([16]));
    // The labels keep their sizes and stay inside their buttons.
    const [plus] = await fontSize(page, 'main > button:not(.save)');
    expect(plus).toBeCloseTo(13.33, 1);
    expect(await fontSize(page, 'button.save')).toEqual([14]);
    for (const q of ['main > button:not(.save)', 'button.save'])
      expect(
        await page.locator(q).evaluate((b) => b.scrollWidth <= b.clientWidth),
        q,
      ).toBe(true);
    // The heading, a button's label, still ranks above the text it
    // introduces; nothing else in a region passes a larger text.
    const [answer] = await fontSize(page, 'p.answer');
    expect(answer).toBeGreaterThan(12);
    expect(answer).toBeLessThanOrEqual(14);
    const after = await rankedTexts(page);
    expect(
      regionInversions(before, after).filter((x) => !/^p /.test(x)),
    ).toEqual([]);
  });

  test('fields first seen in later content rank with what their region settled', async ({
    page,
  }) => {
    await open(page, 'ranks');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 5 }]),
    );
    // A new kind of line arrives in the shop: 20 px, under the 24 px chip.
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.className = 'promo-late';
      p.style.fontSize = '20px';
      p.textContent =
        'Free returns for thirty days, and a case in the box with every pair.';
      document.querySelector('section.shop')?.append(p);
    });
    await expect
      .poll(async () => (await fontSize(page, 'p.promo-late'))[0])
      .toBeGreaterThan(20);
    const [late] = await fontSize(page, 'p.promo-late');
    expect(late).toBeLessThanOrEqual(24);
  });
});

test.describe('verifier checks', () => {
  /** Resize `q` the way a fit would (size and loosened lines) and diff. */
  async function grow(page: Page, q: string, px: number, first = false) {
    await page.evaluate(
      ([sel, size, one]) => {
        const els = [...document.querySelectorAll(sel as string)];
        for (const el of one ? els.slice(0, 1) : els) {
          const style = (el as HTMLElement).style;
          style.setProperty('font-size', `${size}px`, 'important');
          style.setProperty('line-height', '1.35', 'important');
        }
      },
      [q, px, first] as const,
    );
    return page.evaluate(() => window.__webableEngine.scenarioDiff());
  }

  test('nothing changed: no failures', async ({ page }) => {
    await open(page, 'cards');
    await page.evaluate(() =>
      window.__webableEngine.scenarioStart(
        [['article.story p', 'tfs84']],
        'main *',
        'main',
      ),
    );
    expect(
      await page.evaluate(() => window.__webableEngine.scenarioDiff()),
    ).toEqual([]);
  });

  test('overlap: nav labels wrapped six deep find their neighbours', async ({
    page,
  }) => {
    await open(page, 'cards');
    const probes = await page.evaluate(() =>
      window.__webableEngine.scenarioStart(
        [['.navlabel', 'tfs160']],
        'header *',
        'header',
      ),
    );
    // Every label has the labels beside it as neighbours.
    for (const list of Object.values(probes.neighbours))
      expect(list.some((n) => n.startsWith('span.navlabel'))).toBe(true);
    const fails = await grow(page, '.navlabel', 32);
    expect(fails.filter((f) => f.code === 'overlap').length).toBeGreaterThan(0);
  });

  test('overlap: a badge spreading over its icon', async ({ page }) => {
    await open(page, 'cards');
    await page.evaluate(() =>
      window.__webableEngine.scenarioStart(
        [['nav.rail .badge', 'tfs80']],
        'nav.rail *',
        'nav.rail',
      ),
    );
    const fails = await grow(page, 'nav.rail .badge', 22);
    expect(fails).toContainEqual({ code: 'overlap', el: 'span.badge' });
  });

  test('hierarchy: metadata growing past the title in its card', async ({
    page,
  }) => {
    await open(page, 'cards');
    const probes = await page.evaluate(() =>
      window.__webableEngine.scenarioStart(
        [['.vcard .stats', 'tfs80']],
        'main *',
        'main',
      ),
    );
    expect(probes.groups.length).toBeGreaterThan(0);
    const fails = await grow(page, '.vcard .stats', 20);
    expect(fails).toContainEqual({ code: 'hierarchy', el: 'span.stats' });
  });

  test('inconsistent: one instance of a field at another size', async ({
    page,
  }) => {
    await open(page, 'cards');
    await page.evaluate(() =>
      window.__webableEngine.scenarioStart(
        [['.vcard .channel', 'tfs72']],
        'main *',
        'main',
      ),
    );
    const fails = await grow(page, '.vcard .channel', 13, true);
    expect(fails.map((f) => f.code)).toContain('inconsistent');
  });

  test('truncation: an ellipsized subject that shows less of itself', async ({
    page,
  }) => {
    await open(page, 'cards');
    const probes = await page.evaluate(() =>
      window.__webableEngine.scenarioStart(
        [['td.subject .subj', 'tfs88']],
        'main *',
        'main',
      ),
    );
    expect(probes.cuttable).toBeGreaterThan(0);
    const fails = await grow(page, 'td.subject .subj', 26);
    expect(fails.map((f) => f.code)).toContain('truncation');
  });

  test('hierarchy per region: list text growing past a note beside the list, in another size group', async ({
    page,
  }) => {
    await open(page, 'ranks');
    await page.evaluate(() =>
      window.__webableEngine.scenarioStart(
        [['ul.links a', 'tfs96']],
        'main *',
        'main',
        ['section.links'],
      ),
    );
    // The list is its own size group; the 18 px note is the region's.
    const fails = await grow(page, 'ul.links a', 24);
    expect(fails).toContainEqual({ code: 'hierarchy', el: 'a' });
  });

  test('spill: a label growing out of its fixed-height pill', async ({
    page,
  }) => {
    await open(page, 'ranks');
    await page.evaluate(() =>
      window.__webableEngine.scenarioStart(
        [['a.shop .label', 'tfs56']],
        'main *',
        'main',
        ['section.shop'],
      ),
    );
    expect(await grow(page, 'a.shop .label', 15)).toEqual([]);
    const fails = await grow(page, 'a.shop .label', 40);
    expect(fails).toContainEqual({ code: 'overlap', el: 'span.label' });
  });
});

test.describe('Fit view seams', () => {
  test('freeze: no marks, checks or plans while Fit view is open; thawing catches up', async ({
    page,
  }) => {
    await open(page, 'cards');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 3 }]),
    );
    expect(await page.evaluate(() => window.__webableEngine.freeze(true))).toBe(
      true,
    );
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'late';
      p.textContent =
        'A paragraph that arrives while Fit view is open, long enough to read as running text.';
      document.querySelector('article.story')?.append(p);
    });
    await page.waitForTimeout(600);
    // Under the view the page is left alone: the new paragraph keeps its size.
    expect(await fontSize(page, '#late')).toEqual([14]);
    // A plan that arrives meanwhile waits.
    const waiting = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([
        { op: 'text_floor', level: 3 },
        { op: 'line_spacing', level: 1 },
      ]),
    );
    expect(waiting.map((c) => c.op)).toEqual(['text_floor']);
    expect(
      await page.evaluate(() => window.__webableEngine.freeze(false)),
    ).toBe(false);
    await expect.poll(() => fontSize(page, '#late')).toEqual([21]);
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.__webableEngine.changes())).map(
          (c) => [c.op, c.status],
        ),
      )
      .toEqual([
        ['text_floor', 'applied'],
        ['line_spacing', 'applied'],
      ]);
  });

  test('measured: reads see the site own sizes, and the fit stays', async ({
    page,
  }) => {
    await open(page, 'cards');
    await page.evaluate(() => window.__webableEngine.extract());
    await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'text_floor', level: 3 }]),
    );
    expect(
      await page.evaluate(() =>
        window.__webableEngine.measuredFontSize('article.story p:not(.byline)'),
      ),
    ).toBe('14px');
    expect(await fontSize(page, 'article.story p:not(.byline)')).toContain(21);
  });

  test('viewportGuard: overflow, visible primary links and search', async ({
    page,
  }) => {
    await open(page, 'cards');
    // Banner and navigation landmarks: the brand, five header links and the
    // mail rail's three.
    expect(
      await page.evaluate(() => window.__webableEngine.viewportGuard()),
    ).toMatchObject({
      overflowPx: 0,
      navLinks: 9,
      searchVisible: true,
      newlyEllipsised: 0,
    });
    // A breakpoint folds the nav into a menu and hides the search field;
    // something wide pushes the page sideways.
    await page.addStyleTag({
      content:
        'header nav, header input[type="search"] { display: none; } .wide { width: 1600px; height: 4px; }',
    });
    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.className = 'wide';
      document.body.append(wide);
    });
    const guard = await page.evaluate(() =>
      window.__webableEngine.viewportGuard(),
    );
    expect(guard.navLinks).toBe(4);
    expect(guard.searchVisible).toBe(false);
    expect(guard.overflowPx).toBeGreaterThan(300);
  });

  test('viewportGuard: the extraction’s navigation count is the guard’s, and titles a page scale cuts off are counted (eval M3, m1)', async ({
    page,
  }) => {
    await open(page, 'ranks');
    const { signals } = await page.evaluate(() =>
      window.__webableEngine.extract(),
    );
    const at100 = await page.evaluate(() =>
      window.__webableEngine.viewportGuard(),
    );
    // One counter: the baseline the worker keeps is the guard's own reading.
    expect(signals.layout?.nav.primaryLinks).toBe(at100.navLinks);
    expect(signals.layout?.nav.searchVisible).toBe(at100.searchVisible);
    expect(at100.newlyEllipsised).toBe(0);
    // Browser zoom at 150%: a smaller CSS viewport at a higher DPR.
    const cdp = await page.context().newCDPSession(page);
    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(vp.width / 1.5),
      height: Math.round(vp.height / 1.5),
      deviceScaleFactor: 1.5,
      mobile: false,
    });
    await page.waitForTimeout(100);
    const at150 = await page.evaluate(() =>
      window.__webableEngine.viewportGuard(),
    );
    expect(at150.newlyEllipsised).toBeGreaterThanOrEqual(4);
    expect(at150.titlesShown).toBeGreaterThanOrEqual(at150.newlyEllipsised);
    // A reading at the higher zoom never replaces the 100% baseline.
    await page.evaluate(() => window.__webableEngine.extract());
    expect(
      (await page.evaluate(() => window.__webableEngine.viewportGuard()))
        .newlyEllipsised,
    ).toBe(at150.newlyEllipsised);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await page.waitForTimeout(100);
    expect(
      (await page.evaluate(() => window.__webableEngine.viewportGuard()))
        .newlyEllipsised,
    ).toBe(0);
  });

  test('regionKeys: a component key for each region root of the last extraction', async ({
    page,
  }) => {
    await open(page, 'cards');
    await page.evaluate(() => window.__webableEngine.extract());
    const keys = await page.evaluate(() => window.__webableEngine.regionKeys());
    expect(keys.find((k) => k.el === 'main#main')?.key).toMatch(/^c[0-9a-z]+$/);
    expect(keys.some((k) => k.el.startsWith('header'))).toBe(true);
  });
});

test.describe('target_size per template class', () => {
  test('a class whose hit areas would clip is dropped as a class; the rest stays', async ({
    page,
  }) => {
    await open(page, 'article');
    await page.evaluate(() => {
      document.body.innerHTML = `<main><p>Tools for the list below.</p><div class="bar">${'<button class="ripple" type="button">+</button>'.repeat(3)}</div><p class="links">${['one', 'two', 'six'].map((w) => `<a class="tiny" href="/${w}">${w}</a>`).join(' · ')}</p></main>`;
      const style = document.createElement('style');
      style.textContent =
        'body { margin: 40px; } .bar { display: flex; gap: 40px; } .ripple { width: 18px; height: 18px; padding: 0; overflow: hidden; } .links { margin-top: 60px; font-size: 12px; line-height: 14px; }';
      document.head.append(style);
    });
    await page.evaluate(() => window.__webableEngine.extract());
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'target_size', level: 2 }]),
    );
    expect(changes[0]?.status).toBe('applied');
    const after = (sel: string) =>
      page
        .locator(sel)
        .evaluateAll((els) =>
          els.map((el) => getComputedStyle(el, '::after').content),
        );
    // Buttons that clip their own content: no hit area on any of them.
    expect(new Set(await after('.ripple'))).toEqual(new Set(['none']));
    // The links keep theirs.
    expect(new Set(await after('.tiny'))).toEqual(new Set(['""']));
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll('.ripple')].some(
          (b) => b.scrollWidth > b.clientWidth + 1,
        ),
      ),
    ).toBe(false);
  });

  test('vertical growth stops at a clipping box', async ({ page }) => {
    await open(page, 'article');
    await page.evaluate(() => {
      document.body.innerHTML =
        '<main><p>A toolbar in a short panel.</p><div class="panel"><button class="ico" type="button">+</button><button class="ico" type="button">-</button></div></main>';
      const style = document.createElement('style');
      style.textContent =
        'body { margin: 40px; } .panel { display: flex; gap: 48px; height: 24px; padding: 3px 8px; overflow: hidden; } .ico { width: 18px; height: 18px; padding: 0; border: 0; }';
      document.head.append(style);
    });
    await page.evaluate(() => window.__webableEngine.extract());
    const changes = await page.evaluate(
      (p) => window.__webableEngine.apply(p),
      plan([{ op: 'target_size', level: 2 }]),
    );
    expect(changes[0]?.status).toBe('applied');
    const geo = await page.evaluate(() => {
      const panel = document.querySelector('.panel') as HTMLElement;
      const b = document.querySelector('.ico') as HTMLElement;
      const after = getComputedStyle(b, '::after');
      return {
        clipped: panel.scrollHeight > panel.clientHeight + 1,
        top: parseFloat(after.top),
        left: parseFloat(after.left),
      };
    });
    expect(geo.clipped).toBe(false);
    // Room above and below is 3 px: the hit area grows that far vertically,
    // and further sideways where there is room.
    expect(geo.top).toBeGreaterThanOrEqual(-3);
    expect(geo.left).toBeLessThan(-3);
  });
});
