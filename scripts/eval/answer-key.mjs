/**
 * Hand-labelled answer key for the planner re-benchmark (bench.mjs) and the
 * rubric in lib/rubric.mjs. Labelled on 2026-10-15 from the pages as they
 * rendered then (signed out, en-US, 1440x900), by CSS selector, so a fresh
 * capture resolves them again (run.mjs freezes each skeleton with the ids
 * they resolve to; unresolved entries are listed and left out of the score).
 *
 *   pageTypes  accepted PageSpec page_type values
 *   select.main     the page's true main content (what the primary section
 *                   should cover: the result list, the article, the buy box)
 *   select.search   the site's own search field
 *   select.nav      navigation blocks a person needs (site nav, tabs, filters)
 *   select.lists    record collections, with the title inside one record
 *   select.clutter  blocks that should be folded (ads, site pop-ups)
 */
export const ANSWER_KEY = {
  'youtube-channel': {
    pageTypes: ['channel_or_profile', 'listing_grid', 'feed'],
    select: {
      main: ['ytd-rich-grid-renderer #contents'],
      search: ['yt-searchbox input', 'input[name="search_query"]'],
      nav: ['#guide', '#tabsContent', 'chip-bar-view-model'],
      lists: [{ sel: 'ytd-rich-grid-renderer #contents', title: 'h3' }],
    },
  },
  'youtube-search': {
    pageTypes: ['search_results'],
    select: {
      main: ['ytd-two-column-search-results-renderer #primary'],
      search: ['yt-searchbox input', 'input[name="search_query"]'],
      nav: ['#guide', '#chips'],
      lists: [
        {
          sel: 'ytd-section-list-renderer > #contents',
          title: 'a#video-title, h3',
        },
      ],
    },
  },
  wikipedia: {
    pageTypes: ['article', 'docs_reference'],
    select: {
      main: ['#mw-content-text', '#bodyContent'],
      search: ['#searchInput', 'input[name="search"]'],
      nav: ['#mw-panel-toc', '#p-views', '#left-navigation'],
    },
  },
  'amazon-search': {
    pageTypes: ['search_results', 'listing_grid'],
    select: {
      main: ['div.s-main-slot'],
      search: ['#twotabsearchtextbox'],
      nav: ['#nav-xshop', '#s-refinements'],
      lists: [{ sel: 'div.s-main-slot', title: 'h2' }],
      clutter: ['#nav-flyout-iss-anchor .glow-toaster'],
    },
  },
  'amazon-product': {
    pageTypes: ['product_detail'],
    select: {
      main: ['#ppd', '#dp-container'],
      search: ['#twotabsearchtextbox'],
      nav: ['#nav-xshop', '#wayfinding-breadcrumbs_feature_div'],
      clutter: ['#nav-flyout-iss-anchor .glow-toaster'],
    },
  },
  meta: {
    pageTypes: ['product_marketing', 'home_portal'],
    select: {
      main: ['#mdc-main-content'],
      nav: ['nav[aria-label="Main"]'],
    },
  },
  reddit: {
    pageTypes: ['feed', 'listing_grid', 'channel_or_profile'],
    select: {
      main: ['shreddit-feed', 'main'],
      search: ['faceplate-search-input input', 'input[type="search"]'],
      nav: ['#left-sidebar', 'nav'],
      lists: [{ sel: 'shreddit-feed', title: 'a[slot="title"], h2' }],
    },
  },
  'bbc-article': {
    pageTypes: ['article'],
    select: {
      main: ['#bbc-main > article', 'main article'],
      nav: ['#main-navigation-container nav'],
      clutter: [
        '#dotcom-mid_1 .dotcom-ad-inner',
        '#dotcom-mid_2 .dotcom-ad-inner',
      ],
    },
  },
  'govuk-browse': {
    pageTypes: ['home_portal', 'listing_grid', 'docs_reference'],
    select: {
      main: ['.gem-c-cards'],
      nav: [
        'nav[aria-label="Breadcrumb"]',
        'header nav[aria-label="Navigation menu"]',
      ],
      lists: [{ sel: '.gem-c-cards ul', title: 'a' }],
    },
  },
  'govuk-passport': {
    pageTypes: ['article', 'docs_reference', 'other'],
    select: {
      main: ['main#content .govuk-grid-column-two-thirds', 'main#content'],
      nav: [
        'nav[aria-label="Breadcrumb"]',
        'header nav[aria-label="Navigation menu"]',
      ],
    },
  },
  craigslist: {
    pageTypes: ['search_results', 'listing_grid'],
    select: {
      main: ['#search-results-1', '.cl-search-results'],
      search: ['.cl-query-bar input'],
      nav: ['.cl-search-filters-panel'],
      lists: [
        {
          sel: '#search-results-1',
          title: 'a.posting-title, a.cl-app-anchor, .label',
        },
      ],
    },
  },
  github: {
    pageTypes: ['docs_reference', 'dashboard_or_app', 'article', 'other'],
    select: {
      main: ['article.markdown-body', '#readme'],
      nav: ['nav[aria-label="Repository"]', 'nav[aria-label="Global"]'],
    },
  },
  nngroup: {
    pageTypes: ['article'],
    select: {
      main: ['div.article-body', 'article'],
      search: ['#search'],
      nav: ['nav.nav-main'],
    },
  },
  webaim: {
    pageTypes: ['listing_grid', 'docs_reference', 'home_portal', 'feed'],
    select: {
      main: ['#maincontent'],
      search: ['#q'],
      nav: ['#headcontainer nav'],
      lists: [{ sel: '#maincontent', title: 'h2' }],
    },
  },
  'inbox-fixture': {
    pageTypes: ['inbox_or_messages'],
    select: {
      main: ['#rows'],
      search: ['[data-qa="search-input"]'],
      nav: ['nav.side'],
      lists: [{ sel: '#rows', title: '.bog' }],
    },
  },
  'feed-fixture': {
    pageTypes: ['feed', 'listing_grid', 'home_portal'],
    select: {
      main: ['#grid'],
      search: ['header.masthead form.search input'],
      nav: ['nav.guide', '#content > div.chips'],
      lists: [{ sel: '#grid', title: '.title-wrap, .title' }],
      clutter: ['section.ad'],
    },
  },
};
