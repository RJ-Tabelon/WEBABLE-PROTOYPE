import { expect, test, type Page } from '@playwright/test';

import type {
  Locator,
  Skeleton,
  SkeletonNode,
} from '@webable/core/skeleton/types';
import {
  SKEL_FLAGS,
  SKEL_ID_PATTERN,
  SKEL_KINDS,
  SKEL_MAX_DEPTH,
  SKEL_MAX_NODES,
  SKEL_ROLES,
  SKEL_TAGS,
} from '@webable/core/skeleton/constants';

/**
 * WP3a: the page skeleton and its registry (docs/10 §4, §6) on fixture pages
 * shaped like YouTube, Gmail, Amazon, a news article and an editor. The read
 * runs in the page with the real content-script modules (harness
 * tests/v2/entries/skeleton.ts).
 */

type Read = NonNullable<Awaited<ReturnType<Window['__v2skeleton']['read']>>>;

/** The fixtures' own controls (re-render, reorder, new items). */
interface Fx {
  fixture: {
    rerender(): void;
    shuffle(): void;
    more(n: number): void;
    receive(): void;
    markFirstRead(): void;
  };
}

async function open(page: Page, path: string): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.goto(path, { waitUntil: 'load' });
  await page.addScriptTag({ url: '/__v2/skeleton.js' });
  await page.waitForFunction(() => typeof window.__v2skeleton !== 'undefined');
}

async function read(
  page: Page,
  opts: Parameters<Window['__v2skeleton']['read']>[0] = {},
): Promise<Read> {
  const r = await page.evaluate((o) => window.__v2skeleton.read(o), opts);
  if (!r) throw new Error('skeleton read returned null');
  return r;
}

/** The exemplar subtree of a collection node, in order. */
function exemplar(sk: Skeleton, list: SkeletonNode): SkeletonNode[] {
  const ex = list.collection?.exemplar;
  const out: SkeletonNode[] = [];
  const inside = new Set<string>();
  for (const n of sk.nodes) {
    if (n.id === ex || (n.parent !== null && inside.has(n.parent))) {
      inside.add(n.id);
      out.push(n);
    }
  }
  return out;
}

/** The collection whose container element carries `qa`. */
function listByQa(r: Read, qa: string): SkeletonNode {
  const n = r.skeleton.nodes.find(
    (x) => x.kind === 'collection' && r.elements[x.id]?.qa === qa,
  );
  if (!n) throw new Error(`no collection on [data-qa=${qa}]`);
  return n;
}

/** Contract checks every skeleton must pass. */
function checkContract(sk: Skeleton): void {
  expect(sk.v).toBe(1);
  expect(sk.nodes.length).toBeGreaterThan(0);
  expect(sk.nodes.length).toBeLessThanOrEqual(SKEL_MAX_NODES);
  expect(sk.perf.nodes).toBe(sk.nodes.length);
  const seen = new Map<string, number>();
  sk.nodes.forEach((n, i) => {
    expect(n.id).toBe(`e${i + 1}`);
    expect(n.id).toMatch(SKEL_ID_PATTERN);
    if (i === 0) expect(n.parent).toBeNull();
    else {
      expect(n.parent).not.toBeNull();
      const pd = seen.get(n.parent as string);
      expect(pd, `parent of ${n.id} precedes it`).toBeDefined();
      expect(n.depth).toBe((pd as number) + 1);
    }
    expect(n.depth).toBeLessThanOrEqual(SKEL_MAX_DEPTH);
    seen.set(n.id, n.depth);
    expect(SKEL_TAGS).toContain(n.tag);
    if (n.role !== null) expect(SKEL_ROLES).toContain(n.role);
    expect(SKEL_KINDS).toContain(n.kind);
    for (const f of n.flags) expect(SKEL_FLAGS).toContain(f);
    if (n.label !== undefined) {
      expect(n.label.length).toBeGreaterThan(0);
      expect(n.label.length).toBeLessThanOrEqual(80);
    }
    if (n.kind === 'collection') {
      expect(n.collection?.count).toBeGreaterThanOrEqual(3);
      const ex = sk.nodes[i + 1];
      expect(ex?.id).toBe(n.collection?.exemplar);
      expect(ex?.parent).toBe(n.id);
      expect(ex?.slot).toBe(true);
    }
    if (n.kind === 'text') expect(n.label).toBeUndefined();
  });
}

test.describe('skeleton: feed (video grid)', () => {
  test('collections, exemplar slots and flags', async ({ page }) => {
    await open(page, '/v2/feed.html');
    const r = await read(page, { regionKeys: true });
    const sk = r.skeleton;
    checkContract(sk);
    expect(sk.truncated).toBe(false);
    expect(sk.lang).toBe('en');

    const grid = listByQa(r, 'grid');
    expect(grid.collection?.count).toBe(24);
    expect(grid.collection?.itemTag).toBe('div');
    const chips = listByQa(r, 'chips');
    expect(chips.collection?.count).toBe(9);
    expect(chips.role).toBe('tablist');
    expect(listByQa(r, 'guide').collection?.count).toBe(5);

    const ex = exemplar(sk, grid);
    expect(ex.length).toBeGreaterThanOrEqual(8);
    expect(ex.length).toBeLessThanOrEqual(24);
    expect(ex.every((n) => n.slot)).toBe(true);
    const find = (p: (n: SkeletonNode) => boolean): SkeletonNode => {
      const n = ex.find(p);
      if (!n) throw new Error('slot not found');
      return n;
    };
    expect(find((n) => n.kind === 'media' && n.tag === 'img')).toBeTruthy();
    const duration = find(
      (n) => n.kind === 'stext' && !!n.text?.pat?.includes('duration'),
    );
    expect(duration.flags).toContain('overlay');
    const title = find((n) => n.kind === 'heading');
    expect(title.flags).toEqual(
      expect.arrayContaining(['headlink', 'cliprisk']),
    );
    expect(title.label).not.toContain('Video:');
    expect(title.href).toBe('same');
    expect(find((n) => !!n.text?.pat?.includes('count')).kind).toBe('stext');
    expect(find((n) => !!n.text?.pat?.includes('date')).kind).toBe('stext');
    const menu = find((n) => n.label === 'More actions');
    expect(menu.kind).toBe('control');
    expect(menu.flags).toEqual(
      expect.arrayContaining(['hoveronly', 'icon', 'popup']),
    );
    expect(find((n) => n.flags.includes('imgctrl')).kind).toBe('control');

    // The ad card sits in the grid but outside the collection.
    const ad = sk.nodes.find((n) => r.elements[n.id]?.qa === 'ad');
    expect(ad?.flags).toContain('adhint');
    expect(ad?.slot).toBeUndefined();
    // Pinned chrome and landmarks (with their v1 region keys).
    const masthead = sk.nodes.find((n) => r.elements[n.id]?.qa === 'masthead');
    expect(masthead?.kind).toBe('landmark');
    expect(masthead?.flags).toContain('fixed');
    expect(masthead?.ck).toMatch(/^c[0-9a-z]+$/);
    const search = sk.nodes.find(
      (n) => r.elements[n.id]?.qa === 'search-input',
    );
    expect(search?.kind).toBe('input');
    expect(search?.inputType).toBe('text');
    expect(search?.label).toBe('Search');
    // Skip links (off canvas) and screen-reader-only text are not in the skeleton.
    expect(sk.nodes.some((n) => r.elements[n.id]?.qa === 'skip')).toBe(false);
    expect(sk.nodes.some((n) => n.label?.includes('Video:'))).toBe(false);
  });

  test('ids map to live elements; reads are fresh; structure is stable', async ({
    page,
  }) => {
    await open(page, '/v2/feed.html');
    const a = await read(page);
    for (const n of a.skeleton.nodes)
      expect(a.elements[n.id], n.id).not.toBeNull();
    const b = await read(page);
    expect(b.skeleton.extractionId).not.toBe(a.skeleton.extractionId);
    expect(b.registryId).toBe(b.skeleton.extractionId);
    expect(b.skeleton.structure).toBe(a.skeleton.structure);
    // Another load of the same template, with other content order.
    await page.evaluate(() => (window as unknown as Fx).fixture.rerender());
    const c = await read(page);
    expect(c.skeleton.structure).toBe(a.skeleton.structure);
    // A different template hashes differently.
    await open(page, '/v2/inbox.html');
    const d = await read(page);
    expect(d.skeleton.structure).not.toBe(a.skeleton.structure);
  });

  test('reads in budgeted slices, each in measure mode', async ({ page }) => {
    await open(page, '/v2/feed.html');
    const r = await read(page, { sliceMs: 0.05 });
    expect(r.yields).toBeGreaterThan(0);
    // Gate + builder + every slice + the finish run inside `measured`.
    expect(r.measuredCalls).toBe(r.yields + 4);
    expect(listByQa(r, 'grid').collection?.count).toBe(24);
  });

  test('the focused element is flagged', async ({ page }) => {
    await open(page, '/v2/feed.html');
    await page.focus('[data-qa="search-input"]');
    const r = await read(page);
    const focused = r.skeleton.nodes.filter((n) => n.flags.includes('focus'));
    expect(focused).toHaveLength(1);
    expect(r.elements[focused[0]?.id as string]?.qa).toBe('search-input');
  });
});

test.describe('skeleton: inbox (message rows)', () => {
  test('read and unread rows are one collection; hover-only actions are slots', async ({
    page,
  }) => {
    await open(page, '/v2/inbox.html');
    const r = await read(page);
    checkContract(r.skeleton);
    const rows = r.skeleton.nodes.find(
      (n) => n.kind === 'collection' && n.collection?.itemTag === 'tr',
    ) as SkeletonNode;
    expect(rows.collection?.count).toBe(20);
    const ex = exemplar(r.skeleton, rows);
    expect(ex[0]?.role).toBe('row');
    expect(
      ex.find((n) => n.kind === 'input' && n.inputType === 'checkbox'),
    ).toBeTruthy();
    expect(ex.find((n) => n.label === 'Not starred')?.kind).toBe('control');
    const sender = ex.find((n) => n.label === 'Pat Quillon');
    expect(sender?.kind).toBe('stext');
    expect(sender?.flags).toEqual(expect.arrayContaining(['bold', 'cliprisk']));
    expect(ex.find((n) => n.label === 'Quarterly basket count')?.kind).toBe(
      'stext',
    );
    expect(ex.find((n) => !!n.text?.pat?.includes('date'))).toBeTruthy();
    const actions = ex.filter((n) => n.flags.includes('hoveronly'));
    expect(actions.map((n) => n.label)).toEqual(
      expect.arrayContaining(['Archive', 'Delete', 'Mark as read', 'Snooze']),
    );
    // Left rail and toolbar.
    const nav = r.skeleton.nodes.find(
      (n) => n.kind === 'collection' && n.collection?.count === 8,
    );
    expect(nav?.collection?.itemTag).toBe('a');
    const toolbar = r.skeleton.nodes.find((n) => n.role === 'toolbar');
    expect(toolbar?.label).toBe('Actions');
    const pager = r.skeleton.nodes.find(
      (n) => r.elements[n.id]?.qa === 'pager',
    );
    expect(pager?.label).toBe('1–50 of 2,345');
  });
});

test.describe('skeleton: product page and search grid', () => {
  test('detail parts and the result collection', async ({ page }) => {
    await open(page, '/v2/product.html');
    const r = await read(page);
    const sk = r.skeleton;
    checkContract(sk);
    const results = listByQa(r, 's-grid');
    expect(results.collection?.count).toBe(10);
    const ex = exemplar(sk, results);
    const title = ex.find((n) => n.kind === 'heading');
    expect(title?.flags).toContain('headlink');
    expect(ex.find((n) => !!n.text?.pat?.includes('price'))?.kind).toBe(
      'stext',
    );
    expect(ex.find((n) => !!n.text?.pat?.includes('rating'))).toBeTruthy();
    expect(ex.find((n) => n.label === 'Add to cart')?.kind).toBe('control');

    const h1 = sk.nodes.find((n) => n.kind === 'heading' && n.level === 1);
    expect(h1?.label).toBe(
      'Hearth 2-Slice Toaster, Wide Slots, Brushed Steel, 7 Shade Settings',
    );
    const size = sk.nodes.find(
      (n) => n.kind === 'input' && n.inputType === 'select' && n.options === 6,
    );
    expect(size?.label).toBe('Size:');
    const swatches = sk.nodes.filter(
      (n) => n.kind === 'input' && n.inputType === 'radio',
    );
    expect(swatches.length).toBeGreaterThanOrEqual(1);
    expect(swatches[0]?.flags).toContain('selected');
    const prices = sk.nodes.filter(
      (n) => !n.slot && n.text?.pat?.includes('price'),
    );
    expect(prices.map((n) => n.label)).toContain('$49.99');
    for (const label of ['Add to Cart', 'Buy Now'])
      expect(sk.nodes.find((n) => n.label === label)?.kind).toBe('control');
    const picture = sk.nodes.find(
      (n) => r.elements[n.id]?.qa === 'main-picture',
    );
    expect(picture?.kind).toBe('media');
    expect(picture?.label).toBe('Hearth toaster in brushed steel');
  });
});

test.describe('skeleton: article', () => {
  test('prose stays prose; ads, consent and data tables are marked', async ({
    page,
  }) => {
    await open(page, '/v2/article.html');
    const r = await read(page);
    const sk = r.skeleton;
    checkContract(sk);
    const paragraphs = sk.nodes.filter(
      (n) => n.tag === 'p' && n.kind === 'text',
    );
    expect(paragraphs.length).toBeGreaterThanOrEqual(10);
    for (const p of paragraphs) {
      expect(p.label).toBeUndefined();
      expect(p.text?.chars).toBeGreaterThan(40);
    }
    // Paragraphs are document flow, never a collection.
    expect(
      sk.nodes.some(
        (n) => n.kind === 'collection' && n.collection?.itemTag === 'p',
      ),
    ).toBe(false);
    const table = sk.nodes.find((n) => n.kind === 'table');
    expect(table?.label).toBe('Repairs on the quarry road');
    const headings = sk.nodes.filter((n) => n.kind === 'heading');
    expect(headings.map((n) => n.level)).toEqual(
      expect.arrayContaining([1, 2]),
    );
    const qa = (n: SkeletonNode): string | null => r.elements[n.id]?.qa ?? null;
    expect(sk.nodes.find((n) => qa(n) === 'ad-gpt')?.flags).toContain('adhint');
    expect(sk.nodes.find((n) => qa(n) === 'sponsor')?.flags).toContain(
      'adhint',
    );
    const cookie = sk.nodes.find((n) => qa(n) === 'cookie');
    expect(cookie?.flags).toEqual(
      expect.arrayContaining(['consenthint', 'fixed']),
    );
    const comments = sk.nodes.find(
      (n) => n.kind === 'collection' && qa(n) === 'comments',
    );
    expect(comments?.collection?.count).toBe(4);
  });
});

test.describe('skeleton: reading records right (docs/11 work package 1)', () => {
  test("an article's blocks stay its text; its links list is a collection (B1)", async ({
    page,
  }) => {
    await open(page, '/v2/read-article.html');
    const r = await read(page);
    checkContract(r.skeleton);
    const sk = r.skeleton;
    // No collection over the story's own blocks.
    expect(
      sk.nodes.some(
        (n) => n.kind === 'collection' && r.elements[n.id]?.qa === 'story',
      ),
    ).toBe(false);
    const paragraphs = sk.nodes.filter((n) => n.kind === 'text' && !n.slot);
    expect(paragraphs.length).toBeGreaterThanOrEqual(7);
    expect(sk.nodes.find((n) => n.level === 1)?.slot).toBeUndefined();
    // The links at the end of the article are still a list.
    expect(listByQa(r, 'related').collection?.count).toBe(4);
  });

  test('the exemplar is a typical organic result; thumbnails are image links (B4, M6, m4)', async ({
    page,
  }) => {
    await open(page, '/v2/read-results.html');
    const r = await read(page);
    checkContract(r.skeleton);
    const list = listByQa(r, 'results');
    expect(list.collection?.count).toBe(9);
    const ex = exemplar(r.skeleton, list);
    // Not the sponsored slot.
    expect(ex.some((n) => n.label === 'Sponsored')).toBe(false);
    expect(r.elements[ex[0]?.id as string]?.qa).toMatch(/^video-/);
    // The thumbnail link keeps its image and is an image control, whatever
    // the duration drawn over it.
    const thumb = ex.find(
      (n) => n.kind === 'control' && n.flags.includes('imgctrl'),
    ) as SkeletonNode;
    expect(thumb).toBeTruthy();
    expect(ex.some((n) => n.parent === thumb.id && n.kind === 'media')).toBe(
      true,
    );
    expect(
      ex.some(
        (n) => n.parent === thumb.id && n.text?.pat?.includes('duration'),
      ),
    ).toBe(true);
    // Separator dots are not text of their own.
    expect(r.skeleton.nodes.some((n) => n.label === '•')).toBe(false);
    // Every organic record resolves its own title.
    const title = ex.find((n) => n.kind === 'heading') as SkeletonNode;
    const titles = await page.evaluate(
      ([l, t]) => window.__v2skeleton.slotTexts(l, t),
      [list.id, title.id] as const,
    );
    expect(titles.slice(1)).toEqual([
      'Accessibility vs. Inclusive Design',
      'The only accessibility video you will ever need',
      'Learn accessibility: a full tutorial',
      'Public transport accessibility in Melbourne',
      'Designing for low vision',
      'Keyboard navigation explained',
      'Screen readers in five minutes',
      'Captions that people can read',
    ]);
  });

  test('capped cards keep title, price, rating and thumbnail; prices keep their decimal (B3, m2)', async ({
    page,
  }) => {
    await open(page, '/v2/read-shop.html');
    const r = await read(page);
    checkContract(r.skeleton);
    const cards = listByQa(r, 'cards');
    expect(cards.collection?.count).toBe(8);
    const ex = exemplar(r.skeleton, cards);
    expect(ex.length).toBeLessThanOrEqual(24);
    // The heading keeps its title link (not folded into a summary).
    const heading = ex.find((n) => n.kind === 'heading');
    expect(heading?.flags).toContain('headlink');
    expect(ex.some((n) => n.flags.includes('imgctrl'))).toBe(true);
    expect(ex.some((n) => n.label?.includes('out of 5 stars') ?? false)).toBe(
      true,
    );
    expect(ex.find((n) => n.label === 'Add to cart')?.kind).toBe('control');
    const price = ex.find((n) => n.text?.pat?.includes('price'));
    // The link's name reads its offscreen copy; its visible text joins the
    // raised cents with the hidden decimal point.
    expect(price?.label).toMatch(/^CAD ?14\.10$/);
    const prices = await page.evaluate(
      ([l, t]) => window.__v2skeleton.slotTexts(l, t),
      [cards.id, price?.id as string] as const,
    );
    expect(prices[0]).toBe('CAD14.10');
    expect(prices[3]).toBe('CAD17.31');
    for (const p of prices) expect(p).toMatch(/^CAD\d+\.\d{2}$/);
  });

  test('a price drawn in pieces is one text; a drawn dropdown beside its select is dropped (docs/11 polish)', async ({
    page,
  }) => {
    await open(page, '/v2/read-shop.html');
    const r = await read(page);
    checkContract(r.skeleton);
    const ex = exemplar(r.skeleton, listByQa(r, 'cards'));
    // "CAD" "14." "10" (with an offscreen copy beside it) is one price text,
    // inside the link that also reads the unit and "Typical" prices.
    const prices = ex.filter(
      (n) => n.kind === 'stext' && n.text?.pat?.includes('price'),
    );
    expect(prices.map((n) => n.label)).toEqual([
      'CAD14.10',
      '(CAD3.52/count)',
      'Typical: CAD19.99',
      'Save CAD 1.00',
    ]);
    // The sort select is one control: no drawn "Sort by:Featured" twin, no
    // aria-hidden copy of its label.
    const sort = r.skeleton.nodes.filter(
      (n) => /sort by/i.test(n.label ?? '') && !n.slot,
    );
    expect(sort.map((n) => [n.kind, n.inputType])).toEqual([
      ['input', 'select'],
    ]);
  });

  test('swatches drawn as submit inputs read as named radios, without their drawn copies (docs/11 polish)', async ({
    page,
  }) => {
    await open(page, '/v2/fv-shop.html');
    const r = await read(page);
    checkContract(r.skeleton);
    const strengths = listByQa(r, 'strengths');
    expect(strengths.collection?.count).toBe(16);
    // The input is the item: a radio named by its text, and the text drawn
    // under it (aria-hidden) is not a second field.
    expect(
      exemplar(r.skeleton, strengths).map((n) => [
        n.kind,
        n.inputType,
        n.label,
      ]),
    ).toEqual([['input', 'radio', expect.stringMatching(/^\d\.\d+ X$/)]]);
    // An unnamed thumbnail has no name of its own (not "Submit").
    const thumb = exemplar(r.skeleton, listByQa(r, 'thumbs')).find(
      (n) => n.kind === 'input',
    );
    expect(thumb?.inputType).toBe('radio');
    expect(thumb?.label).toBeUndefined();
    // A swatch named by its picture and price says the price once, though
    // the page draws it twice ("CAD 18.41" offscreen, "CAD18.41" drawn).
    const colour = exemplar(r.skeleton, listByQa(r, 'colours')).find(
      (n) => n.kind === 'input',
    );
    expect(colour?.label).toMatch(/^Multi-0\d CAD \d+\.\d{2}$/);
    // The product's own price, outside any list, is one text too.
    expect(
      r.skeleton.nodes.some(
        (n) => n.kind === 'stext' && n.label === 'CAD14.16' && !n.slot,
      ),
    ).toBe(true);
    // The drawn quantity dropdown beside its select is gone.
    expect(r.skeleton.nodes.some((n) => n.label === 'Quantity: 1')).toBe(false);
  });

  test('a label badge before the subject never takes its slot (B5)', async ({
    page,
  }) => {
    await open(page, '/v2/inbox.html');
    const r = await read(page);
    const rows = r.skeleton.nodes.find(
      (n) => n.kind === 'collection' && n.collection?.itemTag === 'tr',
    ) as SkeletonNode;
    const ex = exemplar(r.skeleton, rows);
    const subject = ex.find(
      (n) => n.label === 'Quarterly basket count',
    ) as SkeletonNode;
    const subjects = await page.evaluate(
      ([l, t]) => window.__v2skeleton.slotTexts(l, t),
      [rows.id, subject.id] as const,
    );
    expect(subjects).toHaveLength(20);
    expect(subjects).not.toContain('Work');
    expect(subjects.every((s) => !!s && s.length > 4)).toBe(true);
    // Rows with a badge open from their subject, not the badge.
    const badged = await page.evaluate(
      ([l, t]) => {
        const out: Array<string | null> = [];
        for (let i = 0; i < 20; i++) {
          const el = window.__v2skeleton.slot(l, i, t);
          out.push(el ? el.text : null);
        }
        return out;
      },
      [rows.id, subject.id] as const,
    );
    expect(badged[1]).not.toBe('Work');
  });

  test('main is read first and whole when the time budget runs out (M4)', async ({
    page,
  }) => {
    await open(page, '/v2/read-results.html');
    const r = await read(page, { budgetMs: 0.01, sliceMs: 0.01 });
    checkContract(r.skeleton);
    expect(r.skeleton.truncated).toBe(true);
    // The results survive whole; the guide rail outside main is summarised.
    const list = listByQa(r, 'results');
    expect(list.collection?.count).toBe(9);
    expect(exemplar(r.skeleton, list).some((n) => n.kind === 'heading')).toBe(
      true,
    );
    const guide = r.skeleton.nodes.find(
      (n) => r.elements[n.id]?.qa === 'guide',
    );
    expect(guide?.kind).toBe('landmark');
    expect(r.skeleton.nodes.filter((n) => n.parent === guide?.id).length).toBe(
      0,
    );
  });
});

test.describe('registry', () => {
  test('members, record keys, fingerprints and slots survive a re-render', async ({
    page,
  }) => {
    await open(page, '/v2/feed.html');
    const r = await read(page);
    const grid = listByQa(r, 'grid');
    const listId = grid.id;
    const title = exemplar(r.skeleton, grid).find(
      (n) => n.kind === 'heading',
    ) as SkeletonNode;
    const before = await page.evaluate((id) => {
      const s = window.__v2skeleton;
      return {
        keys: s.keys(id),
        prints: s.fingerprints(id),
        members: s.members(id),
      };
    }, listId);
    expect(before.members).toHaveLength(24);
    expect(new Set(before.keys).size).toBe(24);
    expect(before.keys.every((k) => /^k[0-9a-z]+$/.test(k))).toBe(true);
    const titlesBefore = await page.evaluate(
      ([id, slot]) => window.__v2skeleton.slotTexts(id, slot),
      [listId, title.id] as const,
    );
    expect(titlesBefore[0]).toBe(
      'How the quarry road became the longest volunteer trail in the valley',
    );

    // Every card node is replaced, in reverse order.
    await page.evaluate(() => (window as unknown as Fx).fixture.rerender());
    const after = await page.evaluate((id) => {
      const s = window.__v2skeleton;
      return {
        keys: s.keys(id),
        prints: s.fingerprints(id),
        members: s.members(id),
      };
    }, listId);
    expect(after.members).toHaveLength(24);
    expect(after.keys).toEqual([...before.keys].reverse());
    expect(after.prints).toEqual([...before.prints].reverse());
    const titlesAfter = await page.evaluate(
      ([id, slot]) => window.__v2skeleton.slotTexts(id, slot),
      [listId, title.id] as const,
    );
    expect(titlesAfter).toEqual([...titlesBefore].reverse());
    // The original exemplar element is gone; its id no longer resolves.
    expect(
      await page.evaluate((id) => window.__v2skeleton.element(id), title.id),
    ).toBeNull();

    // Infinite scroll: new members are found live.
    await page.evaluate(() => (window as unknown as Fx).fixture.more(4));
    expect(
      await page.evaluate(
        (id) => window.__v2skeleton.members(id).length,
        listId,
      ),
    ).toBe(28);
  });

  test('inbox rows keep their keys when re-created and when mail arrives', async ({
    page,
  }) => {
    await open(page, '/v2/inbox.html');
    const r = await read(page);
    const rows = r.skeleton.nodes.find(
      (n) => n.kind === 'collection' && n.collection?.itemTag === 'tr',
    ) as SkeletonNode;
    const ex = exemplar(r.skeleton, rows);
    const sender = ex.find((n) => n.label === 'Pat Quillon') as SkeletonNode;
    const archive = ex.find((n) => n.label === 'Archive') as SkeletonNode;
    const before = await page.evaluate(
      (id) => window.__v2skeleton.keys(id),
      rows.id,
    );
    expect(new Set(before).size).toBe(20);
    await page.evaluate(() => (window as unknown as Fx).fixture.rerender());
    expect(
      await page.evaluate((id) => window.__v2skeleton.keys(id), rows.id),
    ).toEqual(before);
    await page.evaluate(() => (window as unknown as Fx).fixture.receive());
    const arrived = await page.evaluate(
      (id) => window.__v2skeleton.keys(id),
      rows.id,
    );
    expect(arrived).toHaveLength(21);
    expect(arrived.slice(1)).toEqual(before);
    expect(before).not.toContain(arrived[0]);
    const senders = await page.evaluate(
      ([id, slot]) => window.__v2skeleton.slotTexts(id, slot),
      [rows.id, sender.id] as const,
    );
    expect(senders[0]).toBe('Marmalade Press');
    expect(senders[1]).toBe('Pat Quillon');
    // Hover-only actions resolve in every row (they are display:none until hover).
    const actions = await page.evaluate(
      ([id, slot]) => window.__v2skeleton.slotTexts(id, slot),
      [rows.id, archive.id] as const,
    );
    expect(actions.every((a) => a === 'Archive')).toBe(true);
    // A read state change does not change the record's identity.
    const firstKey = arrived[0];
    await page.evaluate(() =>
      (window as unknown as Fx).fixture.markFirstRead(),
    );
    expect(
      (await page.evaluate((id) => window.__v2skeleton.keys(id), rows.id))[0],
    ).toBe(firstKey);
  });

  test('locators re-find controls after a re-render and refuse ambiguity', async ({
    page,
  }) => {
    await open(page, '/v2/product.html');
    const r = await read(page);
    const buy = r.skeleton.nodes.find(
      (n) => n.label === 'Buy Now',
    ) as SkeletonNode;
    const loc = await page.evaluate(
      (id) => window.__v2skeleton.locator(id),
      buy.id,
    );
    expect(loc.kind).toBe('control');
    expect(loc.path.length).toBeGreaterThan(2);
    expect(loc.name).toMatch(/^n[0-9a-z]+$/);
    // The buy box is replaced by a copy: same structure, new nodes.
    await page.evaluate(() => {
      const box = document.querySelector('.buybox') as Element;
      box.replaceWith(box.cloneNode(true));
    });
    const found = await page.evaluate(
      (l) => window.__v2skeleton.resolve(l),
      loc,
    );
    expect(found?.qa).toBe('buy-now');
    const scoped = await page.evaluate(
      (l) => window.__v2skeleton.resolve(l, '[data-qa="ppd"]'),
      loc,
    );
    expect(scoped?.qa).toBe('buy-now');
    // Wrapped in a new ancestor: the path's tail and the name still find it.
    await page.evaluate(() => {
      const box = document.querySelector('.buybox') as Element;
      const wrap = document.createElement('div');
      box.replaceWith(wrap);
      wrap.appendChild(box);
    });
    expect(
      (await page.evaluate((l) => window.__v2skeleton.resolve(l), loc))?.qa,
    ).toBe('buy-now');
    // A name that no longer matches resolves to nothing.
    const renamed: Locator = { ...loc, name: 'nzzzz' };
    expect(
      await page.evaluate((l) => window.__v2skeleton.resolve(l), renamed),
    ).toBeNull();
    // A step without its index among identical siblings is ambiguous.
    const results = listByQa(r, 's-grid');
    const exRoot = results.collection?.exemplar as string;
    const itemLoc = await page.evaluate(
      (id) => window.__v2skeleton.locator(id),
      exRoot,
    );
    expect(itemLoc.slot).toEqual([]);
    const loose: Locator = {
      ...itemLoc,
      path: [
        ...itemLoc.path.slice(0, -1),
        (itemLoc.path.at(-1) as string).replace(/:\d+$/, ''),
      ],
    };
    expect(
      await page.evaluate((l) => window.__v2skeleton.resolve(l), loose),
    ).toBeNull();
    // A slot locator resolves inside any member of its list.
    const titleSlot = exemplar(r.skeleton, results).find(
      (n) => n.kind === 'heading',
    ) as SkeletonNode;
    const slotLoc = await page.evaluate(
      (id) => window.__v2skeleton.locator(id),
      titleSlot.id,
    );
    expect(slotLoc.name).toBeUndefined();
    const third = await page.evaluate(
      ([l, id]) => window.__v2skeleton.resolveInMember(l, id, 3),
      [slotLoc, results.id] as const,
    );
    expect(third?.text).toBe('Steelworks Smart Toaster with Countdown Display');
  });

  test('text(): only what is visible, whitespace normalised', async ({
    page,
  }) => {
    await open(page, '/v2/inbox.html');
    await read(page);
    // The pager's tail is clipped away by its overflow:hidden box.
    expect(
      await page.evaluate(() => window.__v2skeleton.text('[data-qa="pager"]')),
    ).toBe('1–50 of 2,345');
    // Screen-reader-only text is left out.
    expect(
      await page.evaluate(() =>
        window.__v2skeleton.text('tr.zA.zE td:nth-child(3)'),
      ),
    ).toBe('Pat Quillon');
    // Partly clipped (ellipsised) text is kept whole.
    const subject = await page.evaluate(() =>
      window.__v2skeleton.text('tr.zA td.sj'),
    );
    expect(
      subject.startsWith('Quarterly basket count - Here are the totals'),
    ).toBe(true);
    // Hidden (display:none) content has no visible text; its name stays.
    expect(
      await page.evaluate(() => window.__v2skeleton.text('tr.zA ul.bqY')),
    ).toBe('');
    expect(
      await page.evaluate(() => window.__v2skeleton.name('tr.zA li.bqX')),
    ).toBe('Archive');

    await open(page, '/v2/feed.html');
    await read(page);
    // aria-hidden text that is drawn (the duration badge) is visible text.
    expect(
      await page.evaluate(() =>
        window.__v2skeleton.text('[data-qa="thumb-vid1000"]'),
      ),
    ).toBe('12:34');
    expect(
      await page.evaluate(() =>
        window.__v2skeleton.text('[data-qa="title-vid1000"]'),
      ),
    ).toBe(
      'How the quarry road became the longest volunteer trail in the valley',
    );
    expect(
      await page.evaluate(() => window.__v2skeleton.text('[data-qa="skip"]')),
    ).toBe('');

    await open(page, '/v2/product.html');
    await read(page);
    // Superscript cents read as a price; the off-screen copy is not shown twice.
    expect(
      await page.evaluate(() => window.__v2skeleton.text('[data-qa="price"]')),
    ).toBe('$49.99');
    expect(
      await page.evaluate(() => window.__v2skeleton.name('[data-qa="cart"]')),
    ).toBe('0 items in cart');
  });

  test('media(): loaded, lazy, background and picture sources; href(): safe schemes', async ({
    page,
  }) => {
    await open(page, '/v2/feed.html');
    await read(page);
    const m = (sel: string) =>
      page.evaluate((s) => window.__v2skeleton.media(s), sel);
    const loaded = await m('[data-qa="thumb-img-vid1000"]');
    expect(loaded.src?.startsWith('data:image/svg+xml')).toBe(true);
    expect(loaded.width).toBeGreaterThan(100);
    const lazy = await m('[data-qa="thumb-img-vid1005"]');
    expect(lazy.src).toBe('http://127.0.0.1:4173/thumbs/vid1005.jpg');
    expect(lazy.srcset).toContain(
      'http://127.0.0.1:4173/thumbs/vid1005@2x.jpg 2x',
    );
    const lazyNoSrc = await m('[data-qa="thumb-img-vid1007"]');
    expect(lazyNoSrc.src).toBe('http://127.0.0.1:4173/thumbs/vid1007.webp');
    const bg = await m('[data-qa="thumb-bg-vid1006"]');
    expect(bg.src?.startsWith('data:image/svg+xml')).toBe(true);
    expect(bg.alt).toBe('Thumbnail');
    // A thumbnail link finds the image inside it.
    const viaLink = await m('[data-qa="thumb-vid1006"]');
    expect(viaLink.src).toBe(bg.src);

    expect(
      await page.evaluate(() =>
        window.__v2skeleton.href('[data-qa="title-vid1000"]'),
      ),
    ).toBe('http://127.0.0.1:4173/watch?v=vid1000');
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<a data-qa="js" href="javascript:alert(1)">x</a><a data-qa="mail" href="mailto:desk@example.org">m</a><img data-qa="badimg" width="40" height="40" src="javascript:alert(1)">',
      );
    });
    expect(
      await page.evaluate(() => window.__v2skeleton.href('[data-qa="js"]')),
    ).toBeNull();
    expect(
      await page.evaluate(() => window.__v2skeleton.href('[data-qa="mail"]')),
    ).toBe('mailto:desk@example.org');
    expect((await m('[data-qa="badimg"]')).src).toBeNull();

    await open(page, '/v2/product.html');
    await read(page);
    const pic = await m('[data-qa="main-picture"]');
    expect(pic.alt).toBe('Hearth toaster in brushed steel');
    expect(pic.srcset).toBe(
      'http://127.0.0.1:4173/img/toaster-large.webp 1x, http://127.0.0.1:4173/img/toaster-large@2x.webp 2x',
    );
  });
});

test.describe('privacy', () => {
  test('typed and URL-query tokens are collected; labels stay short', async ({
    page,
  }) => {
    await open(page, '/v2/feed.html?search_query=quillon+vesperine#t=zebulon');
    await page.fill('[data-qa="search-input"]', 'marmalade quartzite');
    const r = await read(page);
    expect(r.skeleton.typed).toEqual(
      expect.arrayContaining([
        'quillon',
        'vesperine',
        'zebulon',
        'marmalade',
        'quartzite',
      ]),
    );
    // The typed value is never a label (inputs are labelled by their name).
    for (const n of r.skeleton.nodes) {
      expect(n.label ?? '').not.toContain('marmalade');
      expect((n.label ?? '').length).toBeLessThanOrEqual(80);
    }
    // Typed editor text counts too.
    await open(page, '/v2/app.html');
    const app = await read(page);
    expect(app.skeleton.typed).toContain('zebulon');
  });

  test('pages with a password or payment field are not read', async ({
    page,
  }) => {
    const cases = [
      '<input type="password" aria-label="Password">',
      '<input autocomplete="one-time-code" aria-label="Code">',
      '<input autocomplete="billing cc-number" aria-label="Card">',
      '<input name="cardnumber" aria-label="Card number">',
      '<iframe name="__privateStripeFrame1234" title="Secure card payment input frame" srcdoc="x"></iframe>',
    ];
    for (const html of cases) {
      await open(page, '/v2/blank.html');
      await page.evaluate((h) => {
        document.querySelector('main')?.insertAdjacentHTML('beforeend', h);
      }, html);
      expect(
        await page.evaluate(() => window.__v2skeleton.read()),
        html,
      ).toBeNull();
    }
    // Inside an open shadow root too.
    await open(page, '/v2/blank.html');
    await page.evaluate(() => {
      const host = document.createElement('login-box');
      document.querySelector('main')?.appendChild(host);
      host.attachShadow({ mode: 'open' }).innerHTML =
        '<label>Password <input type="password"></label>';
    });
    expect(await page.evaluate(() => window.__v2skeleton.read())).toBeNull();
    // A hidden login form (a closed dropdown) does not block the read.
    await open(page, '/v2/blank.html');
    await page.evaluate(() => {
      document
        .querySelector('main')
        ?.insertAdjacentHTML(
          'beforeend',
          '<div style="display:none"><input type="password"></div>',
        );
    });
    expect(
      await page.evaluate(() => window.__v2skeleton.read()),
    ).not.toBeNull();
  });
});

test.describe('budget and level of detail', () => {
  test('large page: at most 600 nodes, within the time budget', async ({
    page,
  }) => {
    await open(page, '/engine/large.html');
    await read(page); // warm style and layout caches
    const r = await read(page);
    const sk = r.skeleton;
    checkContract(sk);
    expect(sk.nodes.length).toBe(SKEL_MAX_NODES);
    expect(sk.truncated).toBe(true);
    // Lists stay lists (counts, not 1,100 nodes); the article keeps its head.
    const counts = sk.nodes
      .filter((n) => n.kind === 'collection')
      .map((n) => n.collection?.count)
      .sort();
    expect(counts).toEqual([300, 400, 400]);
    expect(sk.nodes.some((n) => n.kind === 'heading' && n.level === 1)).toBe(
      true,
    );
    // What was folded is summarised on its group.
    const main = sk.nodes.find((n) => n.role === 'main');
    expect(main?.text?.chars).toBeGreaterThan(1000);
    expect(sk.perf.ms).toBeLessThan(60);
    test.info().annotations.push({
      type: 'skeleton budget',
      description: `large.html: ${sk.perf.ms} ms busy, ${sk.nodes.length} nodes, ${r.yields} yields`,
    });
  });

  test('a small node budget summarises instead of failing', async ({
    page,
  }) => {
    await open(page, '/v2/feed.html');
    const full = await read(page);
    expect(full.skeleton.nodes.length).toBeGreaterThan(30);
    const r = await read(page, { maxNodes: 30 });
    checkContract(r.skeleton);
    expect(r.skeleton.nodes.length).toBeLessThanOrEqual(30);
    expect(r.skeleton.truncated).toBe(true);
    // Records are kept whole (the grid and its exemplar) while chrome folds.
    expect(listByQa(r, 'grid').collection?.count).toBe(24);
  });

  test('an exhausted time budget summarises the rest of the page', async ({
    page,
  }) => {
    await open(page, '/v2/article.html');
    const r = await read(page, { budgetMs: 0.01, sliceMs: 0.01 });
    checkContract(r.skeleton);
    expect(r.skeleton.truncated).toBe(true);
    expect(r.skeleton.nodes.length).toBeGreaterThan(1);
  });
});
