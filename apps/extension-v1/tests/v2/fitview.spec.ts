import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import type { CollectionSel, OpenOpts } from './entries/fitview';

/**
 * Fit view rendering (docs/10 §4.3, §4.6, §4.7) on fixture pages, through the
 * harness in entries/fitview.ts: a stand-in reader, specs by selector, a fake
 * engine and a fake live layer. Set FV_SHOTS=<dir> to save screenshots.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.FV_SHOTS;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Load a v2 fixture with every non-local request blocked, then the harness. */
async function load(page: Page, name: string): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.goto(`/v2/${name}.html`, { waitUntil: 'load' });
  await page.addScriptTag({ url: '/__v2/fitview.js' });
  await page.waitForFunction(() => typeof window.__fv !== 'undefined');
}

async function open(page: Page, o: OpenOpts): Promise<void> {
  await page.evaluate((opts) => window.__fv.open(opts), o);
}

const state = (page: Page) => page.evaluate(() => window.__fv.state());

async function clickIn(page: Page, sel: string, index = 0): Promise<void> {
  const p = await page.evaluate(
    ([s, i]) => window.__fv.center(s as string, i as number),
    [sel, index] as const,
  );
  if (!p) throw new Error(`nothing matches ${sel}`);
  await page.mouse.click(p.x, p.y);
}

const FEED: OpenOpts = {
  sections: [
    { kind: 'header', nodes: ['header.top .logo'] },
    { kind: 'search', nodes: ['form.search'] },
    { kind: 'account_and_cart', nodes: ['.account a'] },
    { kind: 'primary_nav', nodes: ['nav.guide'] },
    { kind: 'page_heading', nodes: ['main h1'], heading: 'main h1' },
    { kind: 'tabs', nodes: ['.chips'] },
    { kind: 'main_list', nodes: ['#videos'], layout: 'card_grid' },
    { kind: 'ads', nodes: ['section.ad'], importance: 'fold' },
    { kind: 'footer', nodes: ['footer'], importance: 'tertiary' },
  ],
  collections: [
    {
      list: '#videos',
      item_kind: 'video',
      open: '.title',
      fields: [
        { slot: '.thumb img', role: 'thumbnail' },
        { slot: '.duration', role: 'duration' },
        { slot: '.title-wrap', role: 'title' },
        { slot: '.channel', role: 'author_or_channel' },
        { slot: '.views', role: 'meta' },
        { slot: '.age', role: 'timestamp' },
        { slot: '.menu', role: 'overflow_menu' },
      ],
    },
  ],
  primary: 6,
};

const INBOX: OpenOpts = {
  sections: [
    { kind: 'header', nodes: ['header.bar .brand'] },
    { kind: 'search', nodes: ['form.find'] },
    { kind: 'primary_nav', nodes: ['nav.labels'] },
    { kind: 'toolbar', nodes: ['.tools'] },
    { kind: 'main_list', nodes: ['.list'], layout: 'row_list' },
  ],
  collections: [
    {
      list: '.list',
      item_kind: 'message',
      open: '.subject',
      fields: [
        { slot: '.sel input', role: 'select_toggle' },
        { slot: '.from', role: 'author_or_channel' },
        { slot: '.subject', role: 'title' },
        { slot: '.snippet', role: 'description' },
        { slot: '.time', role: 'timestamp' },
        { slot: '.archive', role: 'secondary_action' },
        { slot: '.delete', role: 'secondary_action' },
      ],
    },
  ],
  primary: 4,
};

const ARTICLE: OpenOpts = {
  sections: [
    { kind: 'header', nodes: ['.masthead .brand'] },
    { kind: 'primary_nav', nodes: ['.masthead nav'] },
    { kind: 'article', nodes: ['#story'] },
    { kind: 'related', nodes: ['aside'], heading: 'aside h2' },
    { kind: 'footer', nodes: ['footer'], importance: 'tertiary' },
  ],
  primary: 2,
};

const PRODUCT: OpenOpts = {
  sections: [
    { kind: 'header', nodes: ['header a:first-child'] },
    { kind: 'account_and_cart', nodes: ['header a:last-child'] },
    { kind: 'media', nodes: ['.gallery img'] },
    { kind: 'product_detail', nodes: ['#buybox'] },
  ],
  primary: 3,
};

const FORM: OpenOpts = {
  sections: [
    { kind: 'header', nodes: ['header a'] },
    { kind: 'page_heading', nodes: ['main h1'], heading: 'main h1' },
    { kind: 'secondary', nodes: ['main p.help'] },
    { kind: 'form', nodes: ['#apply'] },
  ],
  primary: 3,
};

const BIG: OpenOpts = {
  sections: [
    { kind: 'page_heading', nodes: ['main h1'], heading: 'main h1' },
    { kind: 'main_list', nodes: ['#results'], layout: 'row_list' },
    { kind: 'pagination', nodes: ['#more'] },
  ],
  collections: [
    {
      list: '#results',
      item_kind: 'search_result',
      open: 'a',
      fields: [
        { slot: 'a', role: 'title' },
        { slot: '.u', role: 'meta' },
        { slot: 'p', role: 'description' },
      ],
    },
  ],
  primary: 1,
};

const CSP: OpenOpts = {
  sections: [
    { kind: 'header', nodes: ['header'] },
    { kind: 'article', nodes: ['article'] },
    { kind: 'related', nodes: ['ul.more'] },
  ],
  primary: 1,
};

/** Atkinson Hyperlegible Next (the tokens package's WebAble Sans), as the worker sends it. */
async function atkinson(): Promise<string> {
  const file = join(
    here,
    '..',
    '..',
    '..',
    '..',
    'packages',
    'tokens',
    'fonts',
    'webable-sans-latin.woff2',
  );
  return (await readFile(file)).toString('base64');
}

const ALL: ReadonlyArray<readonly [string, OpenOpts]> = [
  ['fv-feed', FEED],
  ['fv-inbox', INBOX],
  ['fv-article', ARTICLE],
  ['fv-product', PRODUCT],
  ['fv-form', FORM],
];

/** A serialisation of the site's DOM (and form state) with WebAble's hosts left out. */
async function siteDom(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    for (const h of Array.from(clone.querySelectorAll('webable-ui')))
      h.remove();
    const vals = Array.from(
      document.querySelectorAll('input, select, textarea'),
    ).map((e) =>
      e instanceof HTMLInputElement && /checkbox|radio/.test(e.type)
        ? String(e.checked)
        : (e as HTMLInputElement).value,
    );
    return clone.outerHTML + JSON.stringify(vals);
  });
}

test.describe('Fit view: rendering', () => {
  test('feed: compact strip with More, chips above the list, media rows, drawers with counts', async ({
    page,
  }) => {
    await load(page, 'fv-feed');
    await open(page, FEED);
    await shot(page, 'feed');
    const s = await state(page);
    expect(s.open).toBe(true);
    // Strip: site identity, "Not secure", WebAble's controls.
    expect(await page.evaluate(() => window.__fv.texts('.fv-site'))).toEqual([
      '127.0.0.1Not secure',
    ]);
    expect(
      await page.evaluate(() => window.__fv.texts('.fv-wa-controls button')),
    ).toEqual(['Text −', 'Text +', 'Original page', 'More']);
    // Showroom strip (docs/12 §5): Text − / + as one segmented pill, Original
    // page filled fern, More a ghost pill, the search a pill with a magnifier.
    const chrome = await page.evaluate(() => {
      const strip = window.__fv.q('.fv-strip__bar')[0] as HTMLElement;
      const original = window.__fv.q('.fv-wa-controls .fv-wa--fill')[0];
      return {
        seg: window.__fv.texts('.fv-seg button'),
        original: original?.textContent,
        originalBg: original ? getComputedStyle(original).backgroundColor : '',
        ghost: window.__fv.texts('.fv-wa-controls .fv-wa--ghost'),
        glass: getComputedStyle(strip).backdropFilter,
        icon: window.__fv
          .q('.fv-search .fv-search__icon')[0]
          ?.getAttribute('aria-hidden'),
        radius: getComputedStyle(
          window.__fv.q('.fv-search input')[0] as Element,
        ).borderTopLeftRadius,
      };
    });
    expect(chrome).toMatchObject({
      seg: ['Text −', 'Text +'],
      original: 'Original page',
      originalBg: 'rgb(45, 106, 62)',
      ghost: ['More'],
      icon: 'true',
    });
    expect(chrome.glass).toMatch(/saturate\((180%|1\.8)\) blur\(20px\)/);
    expect(parseFloat(chrome.radius)).toBeGreaterThan(100);
    // A real, labelled search field and its button.
    const search = await page.evaluate(() => {
      const input = window.__fv.q('.fv-search input')[0] as HTMLInputElement;
      const label = window.__fv.q('.fv-search label')[0];
      return {
        type: input.type,
        label: label?.textContent,
        button: window.__fv.texts('.fv-search button'),
      };
    });
    expect(search).toEqual({
      type: 'search',
      label: 'Search',
      button: ['Search'],
    });
    // Header and account links wait in More (one control in the strip).
    expect(
      await page.evaluate(() => window.__fv.q('.fv-more .fv-pill').length),
    ).toBe(0);
    await clickIn(page, '.fv-wa-controls .fv-wa[aria-controls]');
    expect(
      await page.evaluate(() => window.__fv.texts('.fv-more .fv-pill')),
    ).toEqual(['Tubeview', 'Sign in']);
    await page.keyboard.press('Escape');
    expect(
      await page.evaluate(
        () => (window.__fv.q('.fv-more')[0] as HTMLElement).hidden,
      ),
    ).toBe(true);
    expect((await state(page)).open).toBe(true);
    // Navigation: below the main thing, one drawer with its count; all of it
    // inside, never a hamburger.
    expect(
      await page.evaluate(() =>
        window.__fv.texts('.fv-drawer[data-kind="primary_nav"] .fv-wa'),
      ),
    ).toEqual(['Site links (12)']);
    await clickIn(page, '.fv-drawer[data-kind="primary_nav"] .fv-wa');
    expect(
      await page.evaluate(
        () =>
          window.__fv.q('.fv-drawer[data-kind="primary_nav"] .fv-pill').length,
      ),
    ).toBe(12);
    // Tabs: chips right above the list, keeping their own selected state.
    const tabs = await page.evaluate(() =>
      window.__fv
        .q('[data-primary="true"] .fv-listtools [data-kind="tabs"] .fv-pill')
        .map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
    );
    expect(tabs[0]).toEqual(['All', 'true']);
    expect(tabs.slice(1).every(([, p]) => p !== 'true')).toBe(true);
    // The page heading is the view's h1.
    expect(await page.evaluate(() => window.__fv.texts('h1'))).toEqual([
      'Recommended',
    ]);
    // Videos: a grid of media cards (docs/12 §6.2), the 16:9 picture across
    // the card and the title beneath it; titles open the item, the duration
    // sits on the picture, two facts, the age under "Show details".
    const rows = await page.evaluate(() => {
      const items = window.__fv.q('ul.fv-grid > li.fv-rec[data-card="media"]');
      const first = items[0] as HTMLElement;
      const lazy = items[10] as HTMLElement;
      const thumb = lazy.querySelector('.fv-thumb') as HTMLElement;
      const r = thumb.getBoundingClientRect();
      const fr = (
        first.querySelector('.fv-thumb') as HTMLElement
      ).getBoundingClientRect();
      const tr = (
        first.querySelector('h3') as HTMLElement
      ).getBoundingClientRect();
      return {
        count: items.length,
        title: first.querySelector('h3 a')?.textContent,
        href: (first.querySelector('h3 a') as HTMLAnchorElement).href,
        duration: first.querySelector('.fv-thumb .fv-badge')?.textContent,
        facts: first.querySelector('.fv-facts')?.textContent,
        // The menu is a round icon button; its name is a hidden span inside.
        details: Array.from(
          first.querySelectorAll(
            '.fv-rec__more button, .fv-rec__more span:not(button span)',
          ),
        ).map((e) => e.textContent),
        detailsShown: getComputedStyle(
          first.querySelector('.fv-rec__more') as Element,
        ).display,
        lazyImg: !!thumb.querySelector('img'),
        lazyRatio: Math.round((r.width / r.height) * 100) / 100,
        thumbShare: fr.width / first.getBoundingClientRect().width,
        thumbAbove: fr.bottom <= tr.top + 1,
      };
    });
    expect(rows.count).toBe(12);
    expect(rows.title).toBe('Morning walk along the coast');
    expect(rows.href).toContain('/v2/fv-feed.html?v=1');
    expect(rows.duration).toBe('8:13');
    // Facts read apart in text too, not only on screen (no "Coastline3K views").
    expect(rows.facts).toBe('Coastline · 3K views');
    expect(rows.details).toEqual(['1 days ago', 'Action menu']);
    expect(rows.detailsShown).toBe('none');
    expect(rows.lazyImg).toBe(false);
    expect(rows.lazyRatio).toBeCloseTo(16 / 9, 1);
    expect(rows.thumbShare).toBeGreaterThan(0.95);
    expect(rows.thumbAbove).toBe(true);
    await clickIn(page, '.fv-details-toggle');
    expect(
      await page.evaluate(
        () =>
          getComputedStyle(
            window.__fv.q('li.fv-rec .fv-rec__more')[0] as Element,
          ).display,
      ),
    ).toBe('flex');
    // Folded ads and the footer: drawers after the main thing, with counts.
    expect(
      await page.evaluate(() =>
        window.__fv.texts(
          '.fv-drawer > .fv-disclosure > .fv-disclosure__bar .fv-wa',
        ),
      ),
    ).toEqual(['Site links (12)', 'Sponsored (1)', 'Site footer (4)']);
    // Every control was handed to the live layer with a target (More and
    // the drawers bind theirs when they open).
    const targets = await page.evaluate(() => window.__fv.targets());
    expect((await state(page)).bound).toBe(targets.length);
    const titleTarget = targets.find(
      (t) => t.record && t.role === 'link' && t.href?.includes('?v=3'),
    );
    expect(titleTarget?.record?.key).toBe('v3');
    expect(titleTarget?.scopeId).toBeTruthy();
    const menuTarget = targets.find((t) => t.popup);
    expect(menuTarget?.role).toBe('button');
  });

  test('inbox: rows with select toggles, unread weight, hover-only actions behind Actions', async ({
    page,
  }) => {
    await load(page, 'fv-inbox');
    await open(page, INBOX);
    await shot(page, 'inbox');
    const rows = await page.evaluate(() => {
      const items = window.__fv.q('li.fv-rec.fv-row') as HTMLElement[];
      const first = items[0] as HTMLElement;
      return {
        count: items.length,
        unread: items.filter((i) => i.classList.contains('is-unread')).length,
        check: first.querySelector('label.fv-check')?.textContent,
        title: first.querySelector('h3')?.textContent,
        details: window.__fv.texts('.fv-details-toggle'),
        groups: window.__fv.q('ul.fv-rows').length,
      };
    });
    expect(rows.count).toBe(30);
    expect(rows.unread).toBe(10);
    expect(rows.check).toBe('Select');
    expect(rows.title).toBe('Lunch on Thursday?');
    expect(rows.details).toEqual(['Show details']);
    expect(rows.groups).toBe(5); // grouped every 6
    // "Show details" shows each row's hover-only Archive and Delete, bound
    // with record keys; Delete is irreversible.
    await clickIn(page, '.fv-details-toggle');
    expect(
      await page.evaluate(() =>
        Array.from(
          window.__fv
            .q('li.fv-rec')[0]
            ?.querySelectorAll('.fv-rec__more .fv-btn') ?? [],
        ).map((b) => b.textContent),
      ),
    ).toEqual(['Archive', 'Delete']);
    const del = (await page.evaluate(() => window.__fv.targets())).find(
      (t) => t.record?.key === 'm1' && t.irreversible,
    );
    expect(del?.role).toBe('button');
  });

  test('article: allowlist rebuild, inline links, visible text only', async ({
    page,
  }) => {
    await load(page, 'fv-article');
    await open(page, ARTICLE);
    await shot(page, 'article');
    const a = await page.evaluate(() => {
      const prose = window.__fv.q('.fv-prose')[0] as HTMLElement;
      return {
        h1: window.__fv.texts('h1'),
        h2: window.__fv.texts('.fv-prose h2'),
        text: prose.textContent ?? '',
        links: Array.from(prose.querySelectorAll('a.fv-inline')).map((l) => [
          l.textContent,
          (l as HTMLAnchorElement).href,
        ]),
        em: prose.querySelector('em')?.textContent,
        strong: prose.querySelector('strong')?.textContent,
        li: prose.querySelectorAll('li').length,
        table: Array.from(prose.querySelectorAll('table tr')).map((r) =>
          Array.from(r.children).map((c) => c.textContent),
        ),
        caption: prose.querySelector('table caption')?.textContent,
        figure: !!prose.querySelector('figure .fv-thumb img'),
        figcaption: prose.querySelector('figcaption')?.textContent,
        quote: prose.querySelector('blockquote')?.textContent?.trim(),
        pre: prose.querySelector('pre')?.textContent,
        card: window.__fv.texts('.fv-prose .fv-onpage button'),
        players: window.__fv.texts('.fv-prose .fv-quiet'),
      };
    });
    expect(a.h1).toEqual(['The last lighthouse keepers of the northern coast']);
    expect(a.h2).toEqual([
      'A life measured in weather',
      'What the logbook says',
    ]);
    expect(a.links.map(([t]) => t)).toEqual([
      'one hundred and twelve steps',
      'government minister',
    ]);
    expect(a.links[0]?.[1]).toContain('#stairs');
    expect(a.em).toBe('a habit');
    expect(a.strong).toBe('walk the gallery');
    expect(a.li).toBe(3);
    expect(a.caption).toBe('Keepers by decade');
    expect(a.table[0]).toEqual(['Decade', 'Keepers']);
    expect(a.table).toHaveLength(4);
    expect(a.figure).toBe(true);
    expect(a.figcaption).toBe(
      'Gull Point light, photographed from the north beach.',
    );
    expect(a.quote).toBe(
      'The sea does not care that you are tired. You light the lamp anyway.',
    );
    expect(a.pre).toContain('LOG 1931-11-02');
    // The player is one quiet line, not a card (docs/11 R8).
    expect(a.card).toEqual([]);
    expect(a.players).toHaveLength(1);
    expect(a.players[0]).toMatch(/^1 \S.*on the page$/);
    // Screen-reader-only and paywalled text never reach the view.
    expect(a.text).not.toContain('Article published');
    expect(a.text).toContain('Subscribers can read the rest');
    expect(a.text).not.toContain('withheld by the paywall');
    expect(a.text).not.toContain('further below the fold');
    // Inline links are bound to their block, with the href pinned.
    const t = (await page.evaluate(() => window.__fv.targets())).find((x) =>
      x.href?.includes('#minister'),
    );
    expect(t?.role).toBe('link');
  });

  test('product: price led by JSON-LD, options before actions, Buy Now not emphasised', async ({
    page,
  }) => {
    await load(page, 'fv-product');
    await open(page, PRODUCT);
    await shot(page, 'product');
    const p = await page.evaluate(() => {
      const box = window.__fv.q('.fv-product')[0] as HTMLElement;
      const buy = box.querySelector('.fv-product__buy') as HTMLElement;
      const order = Array.from(buy.children).map((c) =>
        c.matches('h1')
          ? 'title'
          : c.matches('.fv-prices')
            ? 'price'
            : c.querySelector('fieldset, .fv-row-pills')
              ? 'options'
              : c.matches('.fv-actions')
                ? 'actions'
                : 'other',
      );
      return {
        order,
        prices: Array.from(box.querySelectorAll('.fv-prices > *')).map((e) => [
          e.textContent,
          e.className,
        ]),
        actions: Array.from(box.querySelectorAll('.fv-actions button')).map(
          (b) => [b.textContent, b.classList.contains('fv-btn--fill')],
        ),
        size: Array.from(
          box.querySelectorAll('fieldset input[type="radio"]'),
        ).map((r) => (r as HTMLInputElement).checked),
        legend: box.querySelector('fieldset legend')?.textContent,
        colours: Array.from(box.querySelectorAll('.fv-row-pills .fv-pill')).map(
          (b) => [b.textContent, b.getAttribute('aria-pressed')],
        ),
        media: window.__fv.q('[data-kind="media"] figure img').length,
        stray: Array.from(box.querySelectorAll('p')).map((e) => e.textContent),
      };
    });
    const firstOptions = p.order.indexOf('options');
    // The product's title leads the whole view, once (docs/11 R1).
    expect(await page.evaluate(() => window.__fv.texts('h1'))).toEqual([
      'Ridgeline Trail Shoe',
    ]);
    expect(p.order).not.toContain('title');
    expect(p.order[0]).toBe('price');
    expect(firstOptions).toBeGreaterThan(p.order.indexOf('price'));
    expect(firstOptions).toBeLessThan(p.order.indexOf('actions'));
    // The price reads at title size in the buy box (docs/12 §6.1).
    expect(p.prices[0]).toEqual(['$89.99', 'is-primary t-title']);
    expect(p.prices[1]?.[0]).toBe('List: $119.00');
    expect(p.actions).toEqual([
      ['Add to Cart', true],
      ['Buy Now', false],
    ]);
    expect(p.legend).toBe('Size');
    expect(p.size).toEqual([false, false, false, false, true, false, false]);
    expect(p.colours).toEqual([
      ['Moss', 'true'],
      ['Slate', 'false'],
      ['Rust', 'false'],
    ]);
    // A still product image is shown as it is (players would get a card).
    expect(p.media).toBe(1);
    // The size label renders once, with its field.
    expect(
      p.stray.filter((t) => t === 'Size'),
      await page.evaluate(
        () => (window.__fv.q('.fv-product')[0] as HTMLElement).outerHTML,
      ),
    ).toEqual([]);
    const buy = (await page.evaluate(() => window.__fv.targets())).find(
      (t) => t.irreversible,
    );
    expect(buy).toBeTruthy();
  });

  test('form: labelled fields of every kind, proxied', async ({ page }) => {
    await load(page, 'fv-form');
    await open(page, FORM);
    await shot(page, 'form');
    const f = await page.evaluate(() => {
      const root = window.__fv.q('[data-kind="form"]')[0] as HTMLElement;
      const labelled = Array.from(
        root.querySelectorAll('input, select, textarea'),
      ).map((c) => {
        const el = c as HTMLInputElement;
        const label =
          el.closest('label')?.textContent ??
          (el.id
            ? root.querySelector(`label[for="${el.id}"]`)?.textContent
            : null) ??
          el.closest('fieldset')?.querySelector('legend')?.textContent;
        return [el.localName, el.type, label];
      });
      return {
        labelled,
        select: (root.querySelector('select') as HTMLSelectElement | null)
          ?.options.length,
        submit: root.querySelector('button')?.textContent,
        required: root.querySelector('input[aria-required="true"]') !== null,
      };
    });
    expect(f.labelled.map(([, , l]) => l)).toEqual([
      'Full name',
      'Email',
      'Country',
      'Adult',
      'Child',
      'Send me the monthly newsletter',
      'Anything else?',
    ]);
    expect(f.select).toBe(20);
    expect(f.submit).toBe('Apply');
    expect(f.required).toBe(true);
    // The header's link waits in More; it is bound when More opens.
    await clickIn(page, '.fv-wa-controls .fv-wa[aria-controls]');
    const roles = (await page.evaluate(() => window.__fv.targets())).map(
      (t) => t.role,
    );
    expect(roles).toEqual(
      expect.arrayContaining(['input', 'select', 'toggle', 'button', 'link']),
    );
  });
});

test.describe('Fit view: sizes and health', () => {
  test('type tiers are monotone and distinguishable; body lands at F', async ({
    page,
  }) => {
    await load(page, 'fv-article');
    for (const F of [16, 24, 40]) {
      await open(page, { ...ARTICLE, layout: { F } });
      const sizes = await page.evaluate(() => {
        const px = (sel: string): number =>
          parseFloat(
            getComputedStyle(window.__fv.q(sel)[0] as HTMLElement).fontSize,
          );
        return [
          px('h1.t-page'),
          px('.t-section'),
          px('.t-title'),
          px('p.t-body'),
          px('.t-meta'),
        ];
      });
      for (let i = 0; i + 1 < sizes.length; i++)
        expect(sizes[i], `tier ${i} at F=${F}`).toBeGreaterThanOrEqual(
          sizes[i + 1] as number,
        );
      expect(sizes[3]).toBe(F);
      const h = (await state(page)).health;
      expect(
        h?.tiers.every((t) => t.ok),
        JSON.stringify(h?.tiers),
      ).toBe(true);
      expect(h?.failures).toEqual([]);
    }
  });

  test('every control is at least T in both dimensions', async ({ page }) => {
    for (const [name, spec] of ALL) {
      await load(page, name);
      for (const T of [44, 72]) {
        await open(page, { ...spec, layout: { F: 18, T } });
        const small = await page.evaluate((min) => {
          const out: string[] = [];
          for (const el of window.__fv.q(
            'a[href], button, input, select, textarea, label.fv-check',
          )) {
            if (el.matches('.fv-inline') && !el.closest('.fv-meta')) continue;
            if (el.matches('label.fv-check input')) continue;
            if (el.getAttribute('aria-hidden') === 'true') continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.width < min - 0.5 || r.height < min - 0.5)
              out.push(`${el.textContent} ${r.width}x${r.height}`);
          }
          return out;
        }, T);
        expect(small, `${name} T=${T}`).toEqual([]);
        expect((await state(page)).health?.small).toEqual([]);
      }
    }
  });

  test('no horizontal overflow at 1280 and 800 px, large text included', async ({
    page,
  }) => {
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 800 });
      for (const [name, spec] of ALL) {
        await load(page, name);
        for (const F of [18, 32]) {
          await open(page, { ...spec, layout: { F } });
          const o = await page.evaluate(() => {
            const s = window.__fv.surface();
            return s ? s.scroller.scrollWidth - s.scroller.clientWidth : -1;
          });
          expect(o, `${name} at ${width} F=${F}`).toBeLessThanOrEqual(0);
          expect((await state(page)).health?.overflowPx).toBe(0);
        }
      }
    }
  });

  test('card columns follow the width: floor((w + gap) / (min + gap)), capped', async ({
    page,
  }) => {
    await load(page, 'fv-feed');
    const cols = async (): Promise<number> =>
      page.evaluate(
        () =>
          getComputedStyle(
            window.__fv.q('ul.fv-grid')[0] as Element,
          ).gridTemplateColumns.split(' ').length,
      );
    // Pictures (not videos) stay cards in the solver's columns.
    const PICS: OpenOpts = {
      ...FEED,
      collections: [
        { ...(FEED.collections?.[0] as CollectionSel), item_kind: 'image' },
      ],
    };
    // Media cards are at least max(280, 14F) wide (docs/12 §6.2); the page
    // keeps max(24 px, 4vw, F) each side.
    await open(page, { ...PICS, layout: { F: 18 } });
    expect(await cols()).toBe(3);
    await page.setViewportSize({ width: 800, height: 800 });
    await page.waitForTimeout(50);
    expect(await cols()).toBe(2);
    await open(page, { ...PICS, layout: { F: 28 } });
    expect(await cols()).toBe(1);
    await page.setViewportSize({ width: 500, height: 800 });
    await page.waitForTimeout(50);
    expect(await cols()).toBe(1);
    // One column of the same cards, never rows of stamps.
    await open(page, { ...PICS, layout: { F: 28 } });
    expect(
      await page.evaluate(() => window.__fv.q('li.fv-row--media').length),
    ).toBe(0);
    expect(
      await page.evaluate(
        () => window.__fv.q('li.fv-rec[data-card="media"]').length,
      ),
    ).toBe(12);
    // Groups hold whole rows of cards, never more than groupEvery (6).
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, PICS);
    const groups = await page.evaluate(() =>
      window.__fv.q('ul.fv-grid').map((g) => g.children.length),
    );
    const n = await cols();
    expect(groups.reduce((a, b) => a + b, 0)).toBe(12);
    for (const g of groups.slice(0, -1)) {
      expect(g % n).toBe(0);
      expect(g).toBeLessThanOrEqual(6);
    }
  });

  test('zoom: sizes are divided by the zoom (zoom 1.5 -> F / 1.5 CSS px)', async ({
    page,
  }) => {
    await load(page, 'fv-article');
    await open(page, { ...ARTICLE, layout: { F: 24, T: 48 }, zoom: 1.5 });
    const z = await page.evaluate(() => {
      const body = window.__fv.q('p.t-body')[0] as HTMLElement;
      const btn = window.__fv.q('.fv-wa')[0] as HTMLElement;
      return {
        body: parseFloat(getComputedStyle(body).fontSize),
        btn: btn.getBoundingClientRect().height,
      };
    });
    expect(z.body).toBeCloseTo(16, 1);
    expect(z.btn).toBeGreaterThanOrEqual(48 / 1.5 - 0.5);
    const h = (await state(page)).health;
    expect(h?.failures).toEqual([]);
    expect(h?.bodyPx).toBeCloseTo(24, 0);
    // setZoom re-solves in place.
    await page.evaluate(() => window.__fv.setZoom(2));
    const body2 = await page.evaluate(() =>
      parseFloat(
        getComputedStyle(window.__fv.q('p.t-body')[0] as Element).fontSize,
      ),
    );
    expect(body2).toBeCloseTo(12, 1);
    expect((await state(page)).health?.bodyPx).toBeCloseTo(24, 0);
  });

  test('palettes: dark, more and max contrast; fern on WebAble controls, ink on site actions', async ({
    page,
  }) => {
    await load(page, 'fv-feed');
    const colours = async () =>
      page.evaluate(() => {
        const d = window.__fv.q('dialog')[0] as HTMLElement;
        const wa = window.__fv.q('.fv-wa-controls .fv-wa')[0] as HTMLElement;
        const site = window.__fv.q('.fv-search .fv-btn')[0] as HTMLElement;
        const meta = window.__fv.q('li.fv-rec .fv-meta')[0] as HTMLElement;
        return {
          bg: getComputedStyle(d).backgroundColor,
          ink: getComputedStyle(d).color,
          wa: getComputedStyle(wa).color,
          site: getComputedStyle(site).color,
          meta: getComputedStyle(meta).color,
        };
      });
    await open(page, FEED);
    const light = await colours();
    // Showroom light (docs/12 §4.1): the grey canvas, ink, fern for WebAble.
    expect(light).toEqual({
      bg: 'rgb(245, 245, 247)',
      ink: 'rgb(29, 29, 31)',
      wa: 'rgb(45, 106, 62)',
      site: 'rgb(29, 29, 31)',
      meta: 'rgb(94, 94, 99)',
    });
    await open(page, { ...FEED, layout: { scheme: 'dark' } });
    const dark = await colours();
    expect(dark.bg).toBe('rgb(0, 0, 0)');
    expect(dark.ink).toBe('rgb(245, 245, 247)');
    expect(dark.wa).toBe('rgb(143, 203, 155)');
    await open(page, { ...FEED, layout: { contrast: 'more' } });
    expect((await colours()).meta).toBe('rgb(29, 29, 31)');
    await open(page, {
      ...FEED,
      layout: { contrast: 'max', scheme: 'dark' },
    });
    const max = await colours();
    expect(max.bg).toBe('rgb(0, 0, 0)');
    expect(max.ink).toBe('rgb(255, 255, 255)');
    expect(max.meta).toBe('rgb(255, 255, 255)');
  });

  test('the primary section starts in the first viewport at large text', async ({
    page,
  }) => {
    await load(page, 'fv-feed');
    await open(page, {
      ...FEED,
      font: await atkinson(),
      layout: { F: 40, T: 72, inlineMax: 8 },
    });
    await shot(page, 'feed-f40');
    const top = await page.evaluate(() => {
      const p = window.__fv.q('[data-primary="true"]')[0] as HTMLElement;
      return p.getBoundingClientRect().top;
    });
    // The main thing starts in the top half of the first screen (docs/11 R2).
    expect(top).toBeLessThan(400);
    // Navigation waits below it in its labelled drawer, never hidden.
    expect(
      await page.evaluate(() =>
        window.__fv.texts('.fv-drawer[data-kind="primary_nav"] .fv-wa'),
      ),
    ).toEqual(['Site links (12)']);
  });
});

test.describe('Fit view: conservation and invariants', () => {
  test('conservation passes on every fixture; records counted by key', async ({
    page,
  }) => {
    for (const [name, spec] of ALL) {
      await load(page, name);
      await open(page, spec);
      const s = await state(page);
      expect(
        s.conservation?.ok,
        `${name} ${JSON.stringify(s.conservation)}`,
      ).toBe(true);
      expect(s.events.some((e) => e.kind === 'conservation_failed')).toBe(
        false,
      );
      for (const l of s.conservation?.lists ?? [])
        expect(l.covered).toBe(l.members);
    }
  });

  test('a spec that leaves content out: conservation_failed, and it lands in Everything else', async ({
    page,
  }) => {
    await load(page, 'fv-feed');
    await page.evaluate(() => window.__fv.resetLog());
    // Omit the footer and the nav, and give no rest list.
    await open(page, {
      ...FEED,
      sections: FEED.sections.filter(
        (s) => s.kind !== 'footer' && s.kind !== 'primary_nav',
      ),
      primary: 5,
      rest: [],
    });
    const s = await state(page);
    const failed = s.events.find((e) => e.kind === 'conservation_failed');
    expect(failed && 'missing' in failed && failed.missing).toBeGreaterThan(0);
    const rest = await page.evaluate(() =>
      window.__fv.texts('.fv-rest .fv-wa'),
    );
    expect(rest[0]).toMatch(/^Everything else on this page \(\d+\)$/);
    await clickIn(page, '.fv-rest .fv-wa');
    const texts = await page.evaluate(() => window.__fv.texts('.fv-rest a'));
    expect(texts).toEqual(
      expect.arrayContaining(['Home', 'News', 'About', 'Privacy']),
    );
  });

  test("the site's DOM is untouched: open and close leave no trace but the host", async ({
    page,
  }) => {
    for (const [name, spec] of ALL) {
      await load(page, name);
      const before = await siteDom(page);
      await open(page, spec);
      expect(await siteDom(page), `${name} while open`).toBe(before);
      expect(
        await page.evaluate(
          () => document.querySelectorAll('webable-ui').length,
        ),
      ).toBe(1);
      await page.evaluate(() => window.__fv.close('original'));
      expect(await siteDom(page), `${name} after close`).toBe(before);
      expect(
        await page.evaluate(
          () => document.querySelectorAll('webable-ui').length,
        ),
      ).toBe(0);
    }
  });

  test('modal dialog: top layer, page inert, closed shadow root, Esc closes', async ({
    page,
  }) => {
    await load(page, 'fv-feed');
    await page.evaluate(() => window.__fv.resetLog());
    await open(page, FEED);
    const m = await page.evaluate(() => {
      const host = document.querySelector('webable-ui') as HTMLElement;
      const d = window.__fv.q('dialog')[0] as HTMLDialogElement;
      const hit = document.elementFromPoint(640, 400);
      return {
        shadow: host.shadowRoot,
        modal: d.matches(':modal'),
        label: d.getAttribute('aria-label'),
        hitHost: hit === host,
        parent: host.parentElement === document.documentElement,
      };
    });
    expect(m).toEqual({
      shadow: null,
      modal: true,
      label: 'Fit view',
      hitHost: true,
      parent: true,
    });
    // Tailor is frozen while the view is open.
    expect((await state(page)).frozen).toEqual([true]);
    await page.keyboard.press('Escape');
    const s = await state(page);
    expect(s.open).toBe(false);
    expect(s.frozen).toEqual([true, false]);
    expect(s.events.find((e) => e.kind === 'closed')).toMatchObject({
      kind: 'closed',
      reason: 'original',
      actions: 0,
    });
    expect(s.events[0]).toMatchObject({
      kind: 'opened',
      source: 'heuristic',
      reason: 'popup',
    });
  });

  test('Original page closes; Text − / + re-size in place and are recorded', async ({
    page,
  }) => {
    await load(page, 'fv-article');
    await page.evaluate(() => window.__fv.resetLog());
    await open(page, { ...ARTICLE, layout: { F: 20 } });
    const body = () =>
      page.evaluate(() =>
        parseFloat(
          getComputedStyle(window.__fv.q('p.t-body')[0] as Element).fontSize,
        ),
      );
    await clickIn(page, '.fv-wa-controls button', 1); // Text +
    expect(await body()).toBe(22.5);
    await clickIn(page, '.fv-wa-controls button', 0); // Text −
    await clickIn(page, '.fv-wa-controls button', 0);
    expect(await body()).toBeCloseTo(18, 0);
    const s = await state(page);
    expect(
      s.events
        .filter((e) => e.kind === 'text_nudge')
        .map((e) => 'step' in e && e.step),
    ).toEqual([1, -1, -1]);
    expect(s.health?.failures).toEqual([]);
    await clickIn(page, '.fv-wa-controls button', 2); // Original page
    expect((await state(page)).open).toBe(false);
  });

  test('axe-core: no serious or critical violations inside the view', async ({
    page,
  }) => {
    for (const [name, spec] of ALL) {
      await load(page, name);
      await open(page, { ...spec, shadow: 'open' });
      const result = await new AxeBuilder({ page })
        .include('webable-ui')
        .analyze();
      const bad = result.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v) =>
            `${v.id}: ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        );
      expect(bad, name).toEqual([]);
    }
  });

  test('strict page CSP: the view and its face work with no violations of their own', async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    await load(page, 'fv-csp');
    await page.waitForTimeout(50);
    const pageOwn = violations.length; // the fixture's own inline <style> is refused
    expect(pageOwn).toBeGreaterThan(0);
    await open(page, { ...CSP, font: await atkinson(), layout: { F: 20 } });
    await shot(page, 'csp');
    const r = await page.evaluate(() => {
      const d = window.__fv.q('dialog')[0] as HTMLElement;
      const p = window.__fv.q('p.t-body')[0] as HTMLElement;
      return {
        bg: getComputedStyle(d).backgroundColor,
        size: getComputedStyle(p).fontSize,
        fonts: Array.from(document.fonts)
          .filter((f) => f.family.includes('WebAble Fit'))
          .map((f) => `${f.family.replace(/"/g, '')}:${f.status}`)
          .sort(),
      };
    });
    expect(r.bg).toBe('rgb(245, 245, 247)');
    expect(r.size).toBe('20px');
    expect(r.fonts).toEqual([
      'WebAble Fit Fallback:loaded',
      'WebAble Fit Fallback:loaded',
      'WebAble Fit Sans:loaded',
    ]);
    await page.waitForTimeout(100);
    expect(violations.length).toBe(pageOwn);
    expect((await state(page)).health?.failures).toEqual([]);
  });
});

test.describe('Fit view: the surface the live layer drives', () => {
  test('long lists are virtualized, never paged; records counted across the session', async ({
    page,
  }) => {
    await load(page, 'fv-big');
    await open(page, BIG);
    const first = await page.evaluate(() => ({
      li: window.__fv.q('li.fv-rec').length,
      groups: window.__fv.q('ul.fv-rows').length,
      spacers: window.__fv.q('ul.fv-spacer').length,
    }));
    expect(first.groups).toBe(Math.ceil(320 / 6));
    expect(first.li).toBeLessThan(150);
    expect(first.spacers).toBeGreaterThan(0);
    const s = await state(page);
    expect(s.conservation?.lists[0]).toMatchObject({
      members: 320,
      covered: 320,
    });
    // Scrolling to the end materializes the last records.
    for (let i = 0; i < 40; i++) {
      const done = await page.evaluate(() => {
        const sc = window.__fv.surface()?.scroller;
        if (!sc) return true;
        sc.scrollTop += sc.clientHeight * 2;
        return sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
      });
      await page.waitForTimeout(16);
      if (done) break;
    }
    await page.waitForFunction(() =>
      window.__fv
        .texts('li.fv-rec h3')
        .some((t) => t.startsWith('Result 320:')),
    );
    expect(
      await page.evaluate(() => window.__fv.q('li.fv-rec').length),
    ).toBeLessThan(320);
    // The pagination control stays reachable.
    expect(
      await page.evaluate(() =>
        window.__fv.texts('[data-kind="pagination"] .fv-pill'),
      ),
    ).toEqual(['More results']);
  });

  test('patchRecords: new records append, changed records re-render, place kept', async ({
    page,
  }) => {
    await load(page, 'fv-inbox');
    await open(page, INBOX);
    await page.evaluate(() => {
      const list = document.querySelector('.list') as HTMLElement;
      const row = list.lastElementChild?.cloneNode(true) as HTMLElement;
      row.id = 'm31';
      (row.querySelector('.subject') as HTMLElement).textContent =
        'A brand new message';
      list.append(row);
      (document.querySelector('#m2 .subject') as HTMLElement).textContent =
        'Edited subject';
      window.__fv.surface()?.patchRecords(window.__fv.idOf('.list') as string);
    });
    const r = await page.evaluate(() => ({
      count: window.__fv.q('li.fv-rec').length,
      last: window.__fv.texts('ul.fv-rows:last-of-type li.fv-rec h3').pop(),
      second: window.__fv.texts('li.fv-rec[data-key="m2"] h3')[0],
    }));
    expect(r).toEqual({
      count: 31,
      last: 'A brand new message',
      second: 'Edited subject',
    });
    // A list shown a few records at a time keeps new records behind
    // "Show n more" and counts them there.
    await open(page, { ...INBOX, layout: LEVEL2 });
    await page.evaluate(() => {
      const list = document.querySelector('.list') as HTMLElement;
      const row = list.lastElementChild?.cloneNode(true) as HTMLElement;
      row.id = 'm32';
      list.append(row);
      window.__fv.surface()?.patchRecords(window.__fv.idOf('.list') as string);
    });
    expect(
      await page.evaluate(() => ({
        count: window.__fv.q('li.fv-rec').length,
        more: window.__fv.texts('.fv-listmore > .fv-wa')[0],
        kept: window.__fv.state().conservation?.ok,
      })),
    ).toEqual({ count: 8, more: 'Show 8 more', kept: true });
  });

  test('loading, notice, status with proxied actions, sheet, peek', async ({
    page,
  }) => {
    await load(page, 'fv-inbox');
    await page.evaluate(() => window.__fv.resetLog());
    await open(page, INBOX);
    const r = await page.evaluate(() => {
      const s = window.__fv.surface();
      if (!s) throw new Error('closed');
      const before = window.__fv.state().bound;
      s.loading(true);
      const loading = !(window.__fv.q('.fv-loading')[0] as HTMLElement).hidden;
      const busy = window.__fv.q('main')[0]?.getAttribute('aria-busy');
      s.loading(false);
      s.notice('Videos play best on the original page');
      const notice = window.__fv.texts('.fv-notice');
      const target = window.__fv.targetFor('#m1 .archive');
      if (!target) throw new Error('no target');
      s.status([
        {
          key: 'a',
          text: 'Conversation archived',
          actions: [{ label: 'Undo', target }],
        },
      ]);
      const status = window.__fv.texts('.fv-status__line');
      const anchor = window.__fv.q('.fv-search input')[0] as HTMLElement;
      s.sheet(anchor, [
        { label: 'harbor hours', selected: false, target },
        { label: 'harbor events', selected: true, target },
      ]);
      const sheet = {
        shown: !(window.__fv.q('.fv-sheet')[0] as HTMLElement).hidden,
        rows: window.__fv.texts('.fv-sheet__opt'),
        current: window.__fv.q('.fv-sheet__opt[aria-current="true"]').length,
        expanded: anchor.getAttribute('aria-expanded'),
      };
      return {
        loading,
        busy,
        notice,
        status,
        sheet,
        bound: window.__fv.state().bound - before,
      };
    });
    expect(r).toEqual({
      loading: true,
      busy: 'true',
      notice: ['Videos play best on the original page'],
      status: ['Conversation archivedUndo'],
      sheet: {
        shown: true,
        rows: ['harbor hours', 'harbor events'],
        current: 1,
        expanded: 'true',
      },
      bound: 3, // Undo and two sheet rows
    });
    // Esc closes the sheet first, then the view.
    await page.evaluate(() =>
      (window.__fv.q('.fv-sheet__opt')[0] as HTMLElement).focus(),
    );
    await page.keyboard.press('Escape');
    expect(
      await page.evaluate(
        () => (window.__fv.q('.fv-sheet')[0] as HTMLElement).hidden,
      ),
    ).toBe(true);
    expect((await state(page)).open).toBe(true);
    // Peek: the dialog steps aside with a "Back to Fit view" pill.
    await page.evaluate(() => window.__fv.surface()?.peek(true));
    const peek = await page.evaluate(() => ({
      open: (window.__fv.q('dialog')[0] as HTMLDialogElement).open,
      pill: window.__fv.texts('.fv-peek button'),
      popover: (window.__fv.q('.fv-peek')[0] as HTMLElement).matches(
        ':popover-open',
      ),
    }));
    expect(peek).toEqual({
      open: false,
      pill: ['Back to Fit view'],
      popover: true,
    });
    await clickIn(page, '.fv-peek button');
    expect(
      await page.evaluate(() =>
        (window.__fv.q('dialog')[0] as HTMLDialogElement).matches(':modal'),
      ),
    ).toBe(true);
    expect((await state(page)).events.filter((e) => e.kind === 'peek')).toEqual(
      [
        { kind: 'peek', on: true },
        { kind: 'peek', on: false },
      ],
    );
  });

  test('a planner spec is offered, never swapped in: Switch re-requests with reason switch', async ({
    page,
  }) => {
    await load(page, 'fv-feed');
    await page.evaluate(() => window.__fv.resetLog());
    await open(page, FEED);
    await page.evaluate(() => window.__fv.offer('planner'));
    expect(await page.evaluate(() => window.__fv.texts('.fv-offer'))).toEqual([
      'A better layout is readySwitch',
    ]);
    await page.evaluate(() => window.__fv.armSwitch());
    await clickIn(page, '.fv-offer button');
    await page.waitForFunction(
      () => window.__fv.q('.fv-offer[hidden]').length === 1,
    );
    const s = await state(page);
    expect(s.messages).toContain('cs:fitview-request');
    expect(s.open).toBe(true);
    expect(await page.evaluate(() => window.__fv.q('li.fv-rec').length)).toBe(
      12,
    );
    // The switch is reported as an open of the planner layout.
    const opened = s.events.filter((e) => e.kind === 'opened');
    expect(opened.at(-1)).toMatchObject({
      kind: 'opened',
      source: 'planner',
      reason: 'switch',
    });
  });
});

/** A cluttered search page (fixtures/fv-clutter.html). */
const CLUTTER: OpenOpts = {
  sections: [
    { kind: 'header', nodes: ['header.top .logo'] },
    { kind: 'primary_nav', nodes: ['header.top nav'] },
    { kind: 'search', nodes: ['form.search'] },
    { kind: 'account_and_cart', nodes: ['header.top .account'] },
    { kind: 'promo_hero', nodes: ['.promo'] },
    { kind: 'page_heading', nodes: ['main h1'], heading: 'main h1' },
    { kind: 'tabs', nodes: ['.tabs'] },
    { kind: 'sort_and_view', nodes: ['.sort'] },
    { kind: 'main_list', nodes: ['#results'], layout: 'row_list' },
    { kind: 'pagination', nodes: ['nav.pages'] },
    {
      kind: 'related',
      nodes: ['aside .trending'],
      heading: 'aside .trending h2',
    },
    { kind: 'form', nodes: ['aside form'] },
    { kind: 'ads', nodes: ['#side-ad .sponsor-label'], importance: 'fold' },
    { kind: 'footer', nodes: ['footer'], importance: 'tertiary' },
  ],
  collections: [
    {
      list: '#results',
      item_kind: 'search_result',
      open: 'h3 a',
      fields: [
        { slot: 'img', role: 'thumbnail' },
        { slot: 'h3', role: 'title' },
        { slot: '.source', role: 'author_or_channel' },
        { slot: '.date', role: 'timestamp' },
        { slot: '.snippet', role: 'description' },
        { slot: '.save', role: 'state_toggle' },
        { slot: '.share', role: 'secondary_action' },
      ],
    },
  ],
  primary: 8,
  pageType: 'search_results',
};

const LONGREAD: OpenOpts = {
  sections: [
    { kind: 'header', nodes: ['header a'] },
    { kind: 'article', nodes: ['#story'] },
  ],
  primary: 1,
  pageType: 'article',
};

/** Tune's Focus effects all at P >= 0.8 (the eval's `focus` persona). */
const LEVEL2 = {
  F: 16,
  T: 32,
  inlineMax: 5,
  structure: {
    level: 2 as const,
    listFirst: 8,
    groupEvery: 4,
    splitSentences: 3,
    outline: true,
    sectionsOpen: 1,
  },
};

test.describe('Fit view: restructure (docs/11)', () => {
  test('a cluttered page: its title and one page line, the list first, small groups, Show n more, ads folded, drawers with counts', async ({
    page,
  }) => {
    // The scorecard's first screen (docs/11 §4).
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page, 'fv-clutter');
    const before = await page.evaluate(() =>
      window.__fv.measure('page', 16, 32),
    );
    await open(page, { ...CLUTTER, layout: LEVEL2 });
    await shot(page, 'clutter-focus');
    const v = await page.evaluate(() => ({
      h1: window.__fv.texts('h1'),
      line: window.__fv.texts('.fv-pageline'),
      chips: window.__fv.texts('[data-primary] .fv-listtools .fv-pill'),
      order: window.__fv
        .q('main.fv-main > *')
        .map((e) => (e as HTMLElement).dataset.kind ?? e.className),
      records: window.__fv.q('[data-primary] li.fv-rec').length,
      groups: window.__fv
        .q('[data-primary] ul.fv-rows')
        .map((g) => g.children.length),
      after: window.__fv.texts('[data-primary] .fv-listmore > .fv-wa'),
      sponsored: window.__fv.texts('.fv-sponsored .fv-wa'),
      titles: window.__fv.texts('[data-primary] li.fv-rec h3'),
      facts: window.__fv.texts('[data-primary] li.fv-rec .fv-facts')[0],
      snippet: window.__fv.texts('[data-primary] li.fv-rec .fv-desc')[0],
      side: window.__fv.q('[data-primary] li.fv-rec .fv-rec__side .fv-btn')
        .length,
      drawers: window.__fv.texts(
        '.fv-drawers > .fv-drawer > .fv-disclosure > .fv-disclosure__bar .fv-wa',
      ),
      pages: window.__fv.texts('[data-primary] [data-kind="pagination"] a'),
    }));
    expect(v.h1).toEqual(['Results for lighthouses']);
    expect(v.line).toEqual([
      'Search results · 12 results · Tabs above the list',
    ]);
    // The selected tab and the next two; the rest one click away.
    expect(v.chips).toEqual(['All', 'News', 'Images']);
    // Orientation, then the main thing, then one open section, then drawers.
    expect(v.order).toEqual([
      'fv-orient',
      'main_list',
      'related',
      'fv-drawers',
    ]);
    expect(v.records).toBe(8);
    expect(v.groups).toEqual([4, 4]);
    expect(v.titles).not.toContain('Lighthouse lamps, 40% off');
    expect(v.sponsored).toEqual(['Sponsored (2)']);
    expect(v.after).toEqual(['Show 4 more', 'Show details']);
    // Two facts: the source (its "- " separator gone) and the snippet; the
    // date, the star and Share wait under "Show details".
    expect(v.facts).toBe('Coast Weekly');
    expect(v.snippet).toBe(
      'For more than a century the light was tended by hand.',
    );
    expect(v.side).toBe(0);
    expect(v.pages).toEqual(['1', '2', '3', 'Next']);
    expect(v.drawers).toEqual([
      'Site links (10)',
      'Featured (2)',
      'Form (3)',
      'Sponsored (1)',
      'Site footer (8)',
    ]);
    // The scorecard (docs/11 §4), the same measure on the page and the view.
    const after = await page.evaluate(() =>
      window.__fv.measure('view', 16, 32, true),
    );
    expect(after.mainStartShare).toBeLessThanOrEqual(0.5);
    expect(
      after.itemsInView,
      JSON.stringify(after.explain?.items),
    ).toBeLessThanOrEqual(before.itemsInView * 0.5);
    // At most half the original's choices; the absolute level-2 cap (15) is
    // the eval's to report on real pages (scripts/eval/report.mjs).
    expect(after.choicesInView).toBeLessThanOrEqual(before.choicesInView / 2);
    expect(after.textStyles).toBeLessThanOrEqual(5);
    expect(after.adsInView).toBe(0);
    expect(after.moving).toBe(0);
    expect(after.maxGroup).toBeLessThanOrEqual(4);
    expect(after.recordsBeforeMore).toBeLessThanOrEqual(8);
    expect(after.templateMismatches).toBe(0);
    expect(after.belowFloorText).toBe(0);
    expect(after.belowTargetControls).toBe(0);
    expect(before.belowFloorText).toBeGreaterThan(0);
    // Nothing is lost: every record is in the view or one click away.
    const s = await state(page);
    expect(s.conservation?.ok, JSON.stringify(s.conservation)).toBe(true);
    // "Show 4 more": the rest of the list, in groups of 4, focus on the first
    // new record (without a ring: the keyboard was not used).
    await clickIn(page, '[data-primary] .fv-listmore > .fv-wa');
    const more = await page.evaluate(() => ({
      records: window.__fv.q('[data-primary] li.fv-rec').length,
      groups: window.__fv
        .q('[data-primary] ul.fv-rows')
        .map((g) => g.children.length),
      after: window.__fv.texts('[data-primary] .fv-listmore > .fv-wa'),
      focused: window.__fv.root().activeElement?.textContent,
    }));
    expect(more.records).toBe(12);
    expect(more.groups).toEqual([4, 4, 4]);
    expect(more.after).toEqual(['Show details']);
    expect(more.focused).toBe('Saving the old harbour cranes');
    // The folded ads are one click away, after the list.
    await clickIn(page, '.fv-sponsored .fv-wa');
    expect(
      await page.evaluate(() => window.__fv.texts('.fv-sponsored h3')),
    ).toEqual(['Lighthouse lamps, 40% off', 'Coastal cruises from $499']);
  });

  test('state controls: a star is an icon with its own name and pressed state; separators are stripped', async ({
    page,
  }) => {
    await load(page, 'fv-clutter');
    await open(page, CLUTTER);
    const r = await page.evaluate(() => {
      const rows = window.__fv.q('[data-primary] li.fv-rec') as HTMLElement[];
      const star = (i: number) =>
        rows[i]?.querySelector('.fv-rec__side .fv-toggle') as HTMLElement;
      return {
        name: star(0)?.querySelector('.fv-sr')?.textContent,
        icon: !!star(0)?.querySelector('svg.fv-icon'),
        text: clean(star(0)?.textContent),
        pressed: [star(0), star(1)].map((s) => s?.getAttribute('aria-pressed')),
        facts: rows[0]?.querySelector('.fv-facts')?.textContent,
        detail: Array.from(
          rows[0]?.querySelectorAll('.fv-rec__more span') ?? [],
        ).map((e) => e.textContent),
      };
      function clean(s: string | null | undefined): string {
        return (s ?? '').replace(/\s+/g, ' ').trim();
      }
    });
    expect(r.name).toBe('Save');
    expect(r.icon).toBe(true);
    expect(r.text).toBe('Save');
    // r1 is not saved; r3 (the second organic row) is.
    expect(r.pressed).toEqual(['false', 'true']);
    expect(r.facts).toBe('Coast Weekly');
    expect(r.detail).toEqual(['3 days ago']);
  });

  test('a long read: On this page above the text; long paragraphs split at sentence ends with links and emphasis whole', async ({
    page,
  }) => {
    await load(page, 'fv-longread');
    await open(page, { ...LONGREAD, layout: LEVEL2 });
    await shot(page, 'longread-focus');
    const a = await page.evaluate(() => {
      const prose = window.__fv.q('.fv-prose')[0] as HTMLElement;
      const paras = Array.from(prose.querySelectorAll(':scope > p')).map((p) =>
        (p.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
      return {
        h1: window.__fv.texts('h1'),
        line: window.__fv.texts('.fv-pageline'),
        outline: window.__fv.texts('.fv-outline .fv-jump'),
        first: paras.slice(0, 2),
        link: window.__fv.texts('.fv-prose a.fv-inline'),
        strong: window.__fv.texts('.fv-prose strong'),
      };
    });
    expect(a.h1).toEqual(['Reading the weather at sea']);
    expect(a.line).toEqual(['Article · 4 sections · Contents below']);
    expect(a.outline).toEqual(['Wind', 'Swell', 'Cloud', 'Pressure']);
    expect(a.first).toEqual([
      'Keepers kept a weather log every three hours. Each entry noted the wind, the swell and the cloud. The barometer reading came last, in pencil.',
      'Over a winter the pages filled with small numbers. Nobody skipped a line. The harbour master read them every spring.',
    ]);
    expect(a.link).toEqual(['barometer reading']);
    expect(a.strong).toEqual(['Nobody skipped a line.']);
    // A jump moves to its section and takes focus there.
    await clickIn(page, '.fv-outline .fv-jump', 2);
    expect(
      await page.evaluate(() => window.__fv.root().activeElement?.textContent),
    ).toBe('Cloud');
    // Without the setting nothing is split and there is no outline.
    await open(page, LONGREAD);
    expect(
      await page.evaluate(() => ({
        p: window.__fv.q('.fv-prose > p').length,
        outline: window.__fv.q('.fv-outline').length,
      })),
    ).toEqual({ p: 5, outline: 0 });
  });

  test('strip: the intro line, "Always here" in More, and no focus ring until the keyboard is used', async ({
    page,
  }) => {
    await load(page, 'fv-feed');
    await page.evaluate(() => window.__fv.resetLog());
    await open(page, { ...FEED, intro: true, alwaysHere: false });
    expect(await page.evaluate(() => window.__fv.texts('.fv-intro p'))).toEqual(
      [
        'WebAble simplified this page for your fit. Original page brings the site back.',
      ],
    );
    await clickIn(page, '.fv-intro .fv-wa');
    expect(
      await page.evaluate(
        () => (window.__fv.q('.fv-intro')[0] as HTMLElement).hidden,
      ),
    ).toBe(true);
    await clickIn(page, '.fv-wa-controls .fv-wa[aria-controls]');
    const sw = '.fv-more [role="switch"]';
    expect(
      await page.evaluate(
        (sel) => window.__fv.q(sel)[0]?.getAttribute('aria-checked'),
        sw,
      ),
    ).toBe('false');
    await clickIn(page, sw);
    expect(
      await page.evaluate(
        (sel) => window.__fv.q(sel)[0]?.getAttribute('aria-checked'),
        sw,
      ),
    ).toBe('true');
    expect((await state(page)).events).toContainEqual({
      kind: 'always',
      on: true,
    });
    // Without alwaysHere in the reply there is no switch.
    await open(page, FEED);
    await clickIn(page, '.fv-wa-controls .fv-wa[aria-controls]');
    expect(await page.evaluate((sel) => window.__fv.q(sel).length, sw)).toBe(0);
    // Focus the view moves itself draws no ring; the keyboard brings it back.
    await open(page, FEED);
    const ring = () =>
      page.evaluate(() => {
        const a = window.__fv.root().activeElement as HTMLElement | null;
        return a ? getComputedStyle(a).outlineStyle : null;
      });
    await page.evaluate(() =>
      (window.__fv.q('li.fv-rec h3 a')[0] as HTMLElement).focus(),
    );
    expect(await ring()).toBe('none');
    await page.keyboard.press('Tab');
    expect(await ring()).not.toBe('none');
  });
});

test.describe('Fit view end to end: real reader, heuristic spec, real live layer', () => {
  const PAGES = ['feed', 'inbox', 'product', 'article', 'app'] as const;

  for (const name of PAGES) {
    test(`${name}: renders, conserves, stays healthy, and every site control is bound`, async ({
      page,
    }) => {
      await load(page, name);
      const before = await siteDom(page);
      await page.evaluate(() => window.__fv.resetLog());
      const spec = await page.evaluate(() => window.__fv.openReal());
      const s = await state(page);
      expect(s.open, JSON.stringify(spec)).toBe(true);
      expect(
        s.conservation?.ok,
        `${name} ${JSON.stringify(spec)} ${JSON.stringify(s.conservation)}`,
      ).toBe(true);
      expect(s.health?.ok, JSON.stringify(s.health)).toBe(true);
      // Drawers and More render when opened: open them all, then every site
      // control in the view must drive its original.
      await page.evaluate(() => {
        for (const b of window.__fv.q(
          '.fv-drawer .fv-wa[aria-expanded="false"], .fv-wa-controls .fv-wa[aria-controls]',
        ))
          (b as HTMLElement).click();
      });
      expect((await state(page)).targets).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.__fv.unbound())).toEqual([]);
      expect(s.events.map((e) => e.kind)).toEqual(['opened']);
      expect(s.frozen).toEqual([true]);
      if (process.env.FV_DEBUG)
        console.log(
          name,
          JSON.stringify(spec),
          s.targets,
          JSON.stringify(s.health?.controls),
          JSON.stringify(s.conservation?.lists),
        );
      await page.evaluate(() => window.__fv.close('original'));
      expect(await siteDom(page), `${name} after close`).toBe(before);
      // Screenshots last: Playwright hides the caret with inline styles.
      if (SHOTS) {
        await page.evaluate(() => window.__fv.openReal());
        await shot(page, `e2e-${name}`);
      }
    });
  }

  test('narrow and large: no horizontal overflow at 800 px, controls >= T at 24 px text', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    for (const name of PAGES) {
      await load(page, name);
      await page.evaluate(() =>
        window.__fv.openReal({ layout: { F: 24, T: 48 } }),
      );
      const s = await state(page);
      expect(s.health?.overflowPx, name).toBe(0);
      expect(s.health?.ok, `${name} ${JSON.stringify(s.health)}`).toBe(true);
      await shot(page, `e2e-narrow-${name}`);
    }
  });

  test('axe-core: no serious or critical violations in the real views', async ({
    page,
  }) => {
    for (const name of PAGES) {
      await load(page, name);
      await page.evaluate(() => window.__fv.openReal({ shadow: 'open' }));
      const result = await new AxeBuilder({ page })
        .include('webable-ui')
        .analyze();
      const bad = result.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v) =>
            `${v.id}: ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        );
      expect(bad, name).toEqual([]);
    }
  });

  /** Watch the page: clicks on originals, and any event that reached the page from the view's host. */
  async function watchPage(page: Page): Promise<void> {
    await page.evaluate(() => {
      const w = window as unknown as { __seen: string[]; __leaks: string[] };
      w.__seen = [];
      w.__leaks = [];
      for (const type of [
        'pointerdown',
        'mousedown',
        'click',
        'keydown',
        'input',
      ])
        document.addEventListener(
          type,
          (e) => {
            const t = e.target as Element;
            if (t.localName === 'webable-ui') w.__leaks.push(type);
          },
          true,
        );
    });
  }

  test('feed: a pill and the search field drive their originals; the page never sees the input', async ({
    page,
  }) => {
    await load(page, 'feed');
    await watchPage(page);
    await page.evaluate(() => {
      const w = window as unknown as { __seen: string[] };
      const chip = Array.from(document.querySelectorAll('.chips .chip')).find(
        (c) => c.textContent?.trim() === 'Music',
      ) as HTMLElement;
      chip.addEventListener('click', () => {
        w.__seen.push('Music');
        for (const c of Array.from(document.querySelectorAll('.chips .chip')))
          c.setAttribute('aria-selected', String(c === chip));
      });
    });
    await page.evaluate(() => window.__fv.openReal());
    const p = await page.evaluate(() =>
      window.__fv.centerText('button.fv-pill', 'Music'),
    );
    expect(p).not.toBeNull();
    await page.mouse.click(p!.x, p!.y);
    await page.waitForFunction(
      () => (window as unknown as { __seen: string[] }).__seen.length > 0,
    );
    // The view re-reads the original's state.
    await page.waitForFunction(() =>
      window.__fv
        .q('button.fv-pill[aria-pressed="true"]')
        .some((b) => b.textContent?.trim() === 'Music'),
    );

    await clickIn(page, '.fv-search input');
    await page.keyboard.type('bread');
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-qa="search-input"]') as HTMLInputElement)
          .value === 'bread',
    );
    expect(await page.evaluate(() => window.__fv.actions())).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __leaks: string[] }).__leaks,
      ),
    ).toEqual([]);
    const s = await state(page);
    expect(s.events.filter((e) => e.kind === 'proxy_failed')).toEqual([]);
  });

  test('inbox: a record toggle drives its own row, found by key', async ({
    page,
  }) => {
    await load(page, 'inbox');
    await watchPage(page);
    // Gmail-style checkbox divs flip on click.
    await page.evaluate(() => {
      document.addEventListener('click', (e) => {
        const cb = (e.target as Element).closest?.('.cb');
        if (cb)
          cb.setAttribute(
            'aria-checked',
            String(cb.getAttribute('aria-checked') !== 'true'),
          );
      });
    });
    await page.evaluate(() => window.__fv.openReal());
    await clickIn(page, 'li.fv-rec label.fv-check', 2);
    await page.waitForFunction(
      () =>
        document
          .querySelectorAll('#rows tr')[2]
          ?.querySelector('.cb')
          ?.getAttribute('aria-checked') === 'true',
    );
    const others = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('#rows .cb')).filter(
          (c) => c.getAttribute('aria-checked') === 'true',
        ).length,
    );
    expect(others).toBe(1);
    expect(
      await page.evaluate(
        () => (window as unknown as { __leaks: string[] }).__leaks,
      ),
    ).toEqual([]);
  });
});

test.describe('Fit view: a product first screen (docs/11 §4 polish)', () => {
  /** The `focus` persona's settings: structure level 2 at F 16, T 32. */
  const CALM = {
    F: 16,
    T: 32,
    structure: {
      level: 2 as const,
      listFirst: 8,
      groupEvery: 4,
      sectionsOpen: 1,
      splitSentences: 3,
      outline: true,
    },
  };

  test('picture, price, stars, one picker per option group and the buying actions first', async ({
    page,
  }) => {
    await load(page, 'fv-shop');
    await page.evaluate((layout) => window.__fv.openReal({ layout }), CALM);
    const s = await state(page);
    expect(s.conservation?.ok, JSON.stringify(s.conservation)).toBe(true);
    expect(s.health?.ok, JSON.stringify(s.health)).toBe(true);
    await shot(page, 'product-first-screen');
    const v = await page.evaluate(() => {
      const fv = window.__fv;
      return {
        line: fv.texts('.fv-pageline'),
        img: fv.q('.fv-product__media img').length,
        opener: fv.q('.fv-product__media .fv-thumb-open').length,
        prices: fv.texts('.fv-prices > span'),
        primary: fv.texts('.fv-prices .is-primary'),
        stars: fv.texts('.fv-rating > span[aria-hidden="true"]:not(.fv-sep)'),
        spoken: fv.texts('.fv-rating > .fv-sr'),
        count: fv.texts('.fv-rating a'),
        pickers: fv.texts('.fv-picker .fv-wa'),
        pills: fv.q('.fv-picker .fv-pill').length,
        actions: fv
          .q('.fv-product__buy .fv-actions > *')
          .map((e) => [
            (e.textContent ?? '').trim(),
            e.classList.contains('fv-btn--fill'),
          ]),
        more: fv.texts('.fv-product__more .fv-disclosure__bar .fv-wa'),
        thumbs: fv.texts('.fv-product__media .fv-quiet'),
      };
    });
    expect(v.line).toEqual(['Product · Price and buying options first']);
    expect(v.img).toBe(1);
    // The current price leads; the unit and list prices keep their words.
    expect(v.primary).toEqual(['CAD14.16']);
    expect(v.prices).toEqual([
      'CAD14.16',
      '(CAD4.72 / count)',
      'List Price: CAD16.99',
    ]);
    // The stars read as a fact for a person who needs calm.
    expect(v.stars).toEqual(['4.4 ★']);
    expect(v.spoken).toEqual(['4.4 out of 5 stars']);
    expect(v.count).toEqual(['2,466 ratings']);
    // Each option group is one control that says what is chosen and how
    // many there are; no list of values down the page.
    expect(v.pickers).toEqual([
      'Color: Multi-01 · 4 options',
      'Strength: 1.5 X · 16 options',
    ]);
    expect(v.pills).toBe(0);
    // Buying only, the first one emphasised; the expanded price panel and
    // the drawn quantity dropdown are not actions, and keeping (Add to
    // List) waits with the rest for a person who needs calm.
    expect(v.actions).toEqual([
      ['Add to cart', true],
      ['Buy Now', false],
    ]);
    // The picture is a picture: its viewer's control waits with the rest.
    expect(v.opener).toBe(0);
    // The thumbnails and the rest wait under one labelled control.
    expect(v.thumbs).toEqual([]);
    expect(v.more).toHaveLength(1);
    expect(v.more[0]).toMatch(/^More about this product \(\d+\)$/);
    // The first screen meets the level-2 caps (docs/11 §4).
    const m = await page.evaluate(() =>
      window.__fv.measure('view', 16, 32, true),
    );
    expect(m.itemsInView, JSON.stringify(m.explain?.items)).toBeLessThanOrEqual(
      30,
    );
    expect(m.choicesInView).toBeLessThanOrEqual(15);
    expect(m.ownChoicesInView).toBeLessThanOrEqual(6);
    expect(m.belowTargetControls).toBe(0);

    // The strength picker opens on its 16 options; the chosen one is
    // pressed, and choosing another drives the store's own swatch.
    await clickIn(page, '.fv-picker .fv-wa', 1);
    const opts = await page.evaluate(() =>
      window.__fv
        .q('.fv-picker .fv-pill')
        .map((p) => [
          (p.textContent ?? '').trim(),
          p.getAttribute('aria-pressed'),
        ]),
    );
    expect(opts).toHaveLength(16);
    expect(opts[0]?.[0]).toBe('0.0 X');
    expect(opts.filter(([, on]) => on === 'true').map(([t]) => t)).toEqual([
      '1.5 X',
    ]);
    const two = opts.findIndex(([t]) => t === '2.0 X');
    await clickIn(page, '.fv-picker .fv-pill', two);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.querySelector('#strength-head b')?.textContent?.trim(),
        ),
      )
      .toBe('2.0 X');
    // The view follows: the new choice is the pressed one.
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__fv
            .q('.fv-picker .fv-pill[aria-pressed="true"]')
            .map((p) => (p.textContent ?? '').trim()),
        ),
      )
      .toEqual(['2.0 X']);

    // The rest: a control whose name is a paragraph is its words and a
    // small button; no "&nbsp;" from a site's attribute reaches the view.
    await clickIn(page, '.fv-product__more .fv-wa');
    const rest = await page.evaluate(() => {
      const fv = window.__fv;
      const all = fv.q('*');
      return {
        long: fv
          .q('.fv-longctl button')
          .map((b) => [
            (b.textContent ?? '').trim(),
            b.getAttribute('aria-label'),
          ]),
        nbsp: all.some(
          (e) =>
            /&nbsp;/.test(e.getAttribute('aria-label') ?? '') ||
            Array.from(e.childNodes).some(
              (n) => n.nodeType === 3 && /&nbsp;/.test(n.nodeValue ?? ''),
            ),
        ),
      };
    });
    expect(rest.long).toEqual([
      [
        'Show',
        'Show: Top highlights Care instructions Handle with care, clean gently with a soft cloth, store in a safe place when not in use. Origin Imported',
      ],
    ]);
    expect(rest.nbsp).toBe(false);
    expect(await page.evaluate(() => window.__fv.unbound())).toEqual([]);
  });

  test('search cards: the current price first, then the stars with their count; one sort control', async ({
    page,
  }) => {
    await load(page, 'read-shop');
    await page.evaluate((layout) => window.__fv.openReal({ layout }), CALM);
    expect((await state(page)).conservation?.ok).toBe(true);
    const v = await page.evaluate(() => {
      const shown = (e: Element): string => {
        const c = e.cloneNode(true) as Element;
        for (const sr of Array.from(c.querySelectorAll('.fv-sr'))) sr.remove();
        return (c.textContent ?? '').replace(/\s+/g, ' ').trim();
      };
      const fv = window.__fv;
      return {
        facts: fv
          .q('[data-primary] li.fv-rec .fv-facts')
          .slice(0, 2)
          .map(shown),
        spoken: fv.texts('[data-primary] li.fv-rec .fv-facts .fv-sr')[0],
        // A short select is spread as a list of options for a person who
        // needs calm; either way, one sort control.
        sorts: [...fv.texts('legend'), ...fv.texts('label.fv-label')].filter(
          (t) => /sort by/i.test(t),
        ),
        sortButtons: fv
          .q('button, a')
          .filter((e) => /sort by|featured/i.test(e.textContent ?? '')).length,
      };
    });
    // Never "Save CAD 1.00", the "Typical" price or the price per count.
    expect(v.facts).toEqual([
      'CAD14.10 · 4.0 ★ (2,401)',
      'CAD15.17 · 4.1 ★ (2,411)',
    ]);
    expect(v.spoken).toBe('4.0 out of 5 stars, rating details, (2,401)');
    expect(v.sorts).toEqual(['Sort by:']);
    expect(v.sortButtons).toBe(0);
  });

  test('with no buying action showing, the price panels are how to buy', async ({
    page,
  }) => {
    await load(page, 'fv-shop');
    // As on a store page whose "Add to cart" waits inside a closed panel.
    await page.evaluate(() => {
      document.getElementById('add')?.remove();
      document.getElementById('buy')?.remove();
    });
    await page.evaluate((layout) => window.__fv.openReal({ layout }), CALM);
    const v = await page.evaluate(() => ({
      options: window.__fv.texts('.fv-product__buy .fv-buyopts > *'),
      filled: window.__fv.q('.fv-product__buy .fv-buyopts .fv-btn--fill')
        .length,
    }));
    // The panel's own name, its "&nbsp;" read as a space.
    expect(v.options).toEqual([
      'Prime Member Price CAD14.16 CAD 4.72 per count',
    ]);
    expect(v.filled).toBe(0);
    expect((await state(page)).conservation?.ok).toBe(true);
  });

  test('at level 0 the thumbnails are one quiet line and the stars keep their control', async ({
    page,
  }) => {
    await load(page, 'fv-shop');
    await page.evaluate(() =>
      window.__fv.openReal({ layout: { F: 16, T: 32 } }),
    );
    const v = await page.evaluate(() => ({
      thumbs: window.__fv.texts('.fv-product__media .fv-quiet span'),
      go: window.__fv.texts('.fv-product__media .fv-quiet button'),
      stars: window.__fv
        .q('.fv-rating .fv-btn')
        .map((b) => [b.textContent, b.getAttribute('aria-label')]),
      actions: window.__fv.texts('.fv-product__buy .fv-actions > *'),
      opener: window.__fv.q('.fv-product__media .fv-thumb-open').length,
    }));
    expect(v.thumbs).toEqual(['6 images']);
    expect(v.go).toEqual(['Show on the page']);
    expect(v.stars).toEqual([['4.4 ★', '4.4 out of 5 stars']]);
    expect(v.actions).toEqual(['Add to cart', 'Buy Now', 'Add to List']);
    expect(v.opener).toBe(1);
    expect((await state(page)).conservation?.ok).toBe(true);
  });
});
