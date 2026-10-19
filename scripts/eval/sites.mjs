/* global document, location */

/**
 * The real-site corpus (docs/10 §10): one page per entry, loaded signed out.
 * `smoke` marks the four pages where the interaction smoke test runs (real
 * mouse and keyboard input in the heuristic Fit view). `local` pages are
 * served from apps/extension/tests/v2/fixtures by the runner's own server:
 * Gmail needs a login, and the evaluation never logs in to anything.
 *
 * `resolve(page)` picks the page to evaluate at run time (an article from a
 * front page, a product from a results page) and returns its URL.
 */

async function firstAmazonProduct(page) {
  await page.goto('https://www.amazon.com/s?k=reading+glasses', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  await page.waitForTimeout(2500);
  const href = await page.evaluate(() => {
    const results = Array.from(
      document.querySelectorAll('[data-component-type="s-search-result"]'),
    );
    for (const r of results) {
      if (
        r.querySelector(
          '.puis-sponsored-label-text, .s-sponsored-label-info-icon',
        )
      )
        continue;
      const a = r.querySelector('a[href*="/dp/"]');
      if (a) return a.href;
    }
    const any = document.querySelector('a[href*="/dp/"]');
    return any ? any.href : null;
  });
  if (!href) throw new Error('no product link on the results page');
  // The product page itself, without the search's tracking parameters.
  const m = /^(https:\/\/www\.amazon\.com\/(?:[^/]+\/)?dp\/[A-Z0-9]{10})/.exec(
    href,
  );
  return m ? m[1] : href;
}

async function firstBbcArticle(page) {
  await page.goto('https://www.bbc.com/news', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  await page.waitForTimeout(2500);
  const href = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const a = links.find((l) =>
      /\/news\/articles\/[a-z0-9]+\/?$/.test(new URL(l.href).pathname),
    );
    return a ? a.href : null;
  });
  if (!href) throw new Error('no article link on the front page');
  return href;
}

/**
 * Gmail opens a conversation when its row is clicked (#inbox/<thread>); the
 * fixture's rows are static, so the runner adds that one behaviour (as the
 * Fit view tests add the feed's chip handler) before the smoke test.
 */
async function gmailRows(page) {
  await page.evaluate(() => {
    document.addEventListener('click', (e) => {
      const t = e.target;
      const tr = t && t.closest ? t.closest('tr.zA') : null;
      if (!tr || t.closest('.cb, .star, .bqX')) return;
      const id = tr.querySelector('[data-legacy-thread-id]');
      if (id)
        location.hash = `#inbox/${id.getAttribute('data-legacy-thread-id')}`;
    });
  });
}

export const SITES = [
  {
    id: 'youtube-channel',
    label: 'YouTube channel videos',
    url: 'https://www.youtube.com/@veritasium/videos',
    smoke: true,
  },
  {
    id: 'youtube-search',
    label: 'YouTube search',
    url: 'https://www.youtube.com/results?search_query=accessibility',
  },
  {
    id: 'wikipedia',
    label: 'Wikipedia article',
    url: 'https://en.wikipedia.org/wiki/Fitts%27s_law',
    smoke: true,
  },
  {
    id: 'amazon-search',
    label: 'Amazon search',
    url: 'https://www.amazon.com/s?k=reading+glasses',
    smoke: true,
  },
  {
    id: 'amazon-product',
    label: 'Amazon product (first result)',
    url: 'https://www.amazon.com/s?k=reading+glasses',
    resolve: firstAmazonProduct,
  },
  {
    id: 'meta',
    label: 'Meta AI glasses',
    url: 'https://www.meta.com/ai-glasses/',
  },
  {
    id: 'reddit',
    label: 'Reddit r/accessibility',
    url: 'https://www.reddit.com/r/accessibility/',
  },
  {
    id: 'bbc-article',
    label: 'BBC News article',
    url: 'https://www.bbc.com/news',
    resolve: firstBbcArticle,
  },
  {
    id: 'govuk-browse',
    label: 'GOV.UK browse: benefits',
    url: 'https://www.gov.uk/browse/benefits',
  },
  {
    id: 'govuk-passport',
    label: 'GOV.UK apply for or renew a passport',
    // The brief named /apply-for-a-uk-passport; it answers 404 since GOV.UK
    // merged it into this start page (checked 2026-10-15).
    url: 'https://www.gov.uk/apply-renew-passport',
  },
  {
    id: 'craigslist',
    label: 'Craigslist bikes search',
    url: 'https://sfbay.craigslist.org/search/bia',
  },
  {
    id: 'github',
    label: 'GitHub repository',
    url: 'https://github.com/microsoft/vscode',
  },
  {
    id: 'nngroup',
    label: 'NN/g article',
    url: 'https://www.nngroup.com/articles/usability-for-senior-citizens/',
  },
  {
    id: 'webaim',
    label: 'WebAIM articles index',
    url: 'https://webaim.org/articles/',
  },
  {
    id: 'inbox-fixture',
    label: 'Gmail-like inbox (local fixture)',
    local: 'inbox.html',
    smoke: true,
    setup: gmailRows,
  },
  {
    id: 'feed-fixture',
    label: 'Video feed (local fixture)',
    local: 'feed.html',
  },
];
