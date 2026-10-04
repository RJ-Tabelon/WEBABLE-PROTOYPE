import { describe, expect, it } from 'vitest';

import {
  classifyPage,
  type CategoryFeatures,
} from '../../../lib/engine/extract/classify';
import {
  findMainContent,
  isProbablyReaderable,
  linkDensity,
} from '../../../lib/engine/extract/main';
import { tagPath, zoneOf } from '../../../lib/engine/extract/regions';
import {
  iframeKindOfHost,
  isIabSize,
  ruleFor,
  type RuleContext,
} from '../../../lib/engine/extract/rules';
import { hoverTargetSelector } from '../../../lib/engine/extract/hover';
import {
  heightBucket,
  linkDensityBucket,
  pageTextBucket,
  regionTextBucket,
  weightedMedian,
  widthBucket,
} from '../../../lib/engine/util/buckets';
import { landmarkOf } from '../../../lib/engine/util/dom';
import {
  componentKey,
  cyrb53,
  sanitizeToken,
  sanitizedTokens,
} from '../../../lib/engine/util/hash';

const html = (body: string): Document =>
  new DOMParser().parseFromString(
    `<!doctype html><body>${body}</body>`,
    'text/html',
  );
const para = (n: number): string =>
  `<p>${'Words of running text, with commas, go here. '.repeat(n)}</p>`;

describe('component keys', () => {
  it('drops digits and hash-like class tokens', () => {
    expect(sanitizeToken('sidebar')).toBe('sidebar');
    expect(sanitizeToken('RelatedLinks')).toBe('relatedlinks');
    expect(sanitizeToken('css-1x9k2')).toBeNull();
    expect(sanitizeToken('sc-bdVaJa')).toBeNull();
    expect(sanitizeToken('post-123')).toBeNull();
    expect(sanitizedTokens('nav  nav css-1x9k2 main-nav', 'top')).toEqual([
      'main-nav',
      'nav',
      'top',
    ]);
  });

  it('is deterministic and changes with structure', () => {
    const a = componentKey({
      landmark: 'complementary',
      tagPath: 'body>div>aside',
      tokens: ['related'],
    });
    const b = componentKey({
      landmark: 'complementary',
      tagPath: 'body>div>aside',
      tokens: ['related'],
    });
    const c = componentKey({
      landmark: 'none',
      tagPath: 'body>div>aside',
      tokens: ['related'],
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^c[0-9a-z]+$/);
    expect(cyrb53('x')).toBe(cyrb53('x'));
  });

  it('tag paths stop at the nearest landmark', () => {
    const doc = html(
      '<div><main><div><aside id="x"></aside></div></main></div>',
    );
    expect(tagPath(doc.getElementById('x') as Element)).toBe('main>div>aside');
  });
});

describe('landmarks (read-only)', () => {
  it('follows HTML-AAM for header, footer, section and form', () => {
    const doc = html(
      '<header id="h"></header><article><header id="ah"></header></article><section id="s"></section>' +
        '<section id="sl" aria-label="x"></section><form id="f"></form><div role="navigation" id="n"></div>',
    );
    const lm = (id: string): string =>
      landmarkOf(doc.getElementById(id) as Element);
    expect(lm('h')).toBe('banner');
    expect(lm('ah')).toBe('none');
    expect(lm('s')).toBe('none');
    expect(lm('sl')).toBe('region');
    expect(lm('f')).toBe('none');
    expect(lm('n')).toBe('navigation');
  });
});

describe('rules', () => {
  const ctx = (o: Partial<RuleContext> = {}): RuleContext => ({
    width: 300,
    height: 400,
    pinned: 'no',
    iframeKind: 'none',
    landmark: 'none',
    labelText: '',
    shortText: '',
    buttonTexts: [],
    hasRequiredFields: false,
    ...o,
  });

  it('decides known third-party roots with high precision', () => {
    const doc = html(
      '<div id="onetrust-banner-sdk"></div><div class="intercom-lightweight-app"></div><ins class="adsbygoogle"></ins>',
    );
    expect(
      ruleFor(doc.getElementById('onetrust-banner-sdk') as Element, ctx())
        ?.role,
    ).toBe('consent_banner');
    expect(
      ruleFor(doc.querySelector('.intercom-lightweight-app') as Element, ctx())
        ?.role,
    ).toBe('chat_widget');
    expect(ruleFor(doc.querySelector('ins') as Element, ctx())).toMatchObject({
      role: 'promo_ad',
      ruleId: 'ad_markup',
    });
  });

  it('uses iframe hosts, IAB sizes and landmarks', () => {
    const div = html('<div></div>').querySelector('div') as Element;
    expect(
      ruleFor(div, ctx({ iframeKind: 'ad_network' }))?.precision,
    ).toBeGreaterThanOrEqual(0.9);
    expect(ruleFor(div, ctx({ landmark: 'main' }))?.role).toBe('main_content');
    expect(ruleFor(div, ctx({ hasRequiredFields: true }))?.role).toBe('form');
    // IAB size alone is evidence, not a decision.
    expect(
      ruleFor(div, ctx({ width: 300, height: 250 }))?.precision,
    ).toBeLessThan(0.9);
    expect(
      ruleFor(div, ctx({ width: 300, height: 250, labelText: 'Advertisement' }))
        ?.precision,
    ).toBeGreaterThanOrEqual(0.9);
    expect(ruleFor(div, ctx())).toBeNull();
  });

  it('recognises consent banners from local text only when pinned with consent buttons', () => {
    const div = html('<div></div>').querySelector('div') as Element;
    const text = { shortText: 'We use cookies', buttonTexts: ['Accept all'] };
    expect(ruleFor(div, ctx({ ...text, pinned: 'fixed' }))?.role).toBe(
      'consent_banner',
    );
    expect(ruleFor(div, ctx(text))).toBeNull();
  });

  it('classifies iframe hosts without keeping the host', () => {
    expect(iframeKindOfHost('googleads.g.doubleclick.net')).toBe('ad_network');
    expect(iframeKindOfHost('widget.intercom.io')).toBe('chat_vendor');
    expect(iframeKindOfHost('www.youtube-nocookie.com')).toBe('video_host');
    expect(iframeKindOfHost('www.google.com', '/maps/embed')).toBe('map');
    expect(iframeKindOfHost('example.org')).toBe('other');
    expect(iframeKindOfHost('notdoubleclick.net')).toBe('other');
    expect(isIabSize(301, 249)).toBe(true);
    expect(isIabSize(310, 250)).toBe(false);
  });
});

describe('zones', () => {
  it('places regions by geometry and pinning', () => {
    const z = (
      b: [number, number, number, number],
      pinned: 'fixed' | 'sticky' | 'no' = 'no',
    ): string =>
      zoneOf(
        { left: b[0], top: b[1], right: b[2], bottom: b[3] },
        { left: b[0], top: b[1], right: b[2], bottom: b[3] },
        pinned,
        1280,
        800,
        4000,
      );
    expect(z([0, 0, 1280, 72])).toBe('header_band');
    expect(z([0, 3900, 1280, 4000])).toBe('footer_band');
    expect(z([0, 200, 280, 1400])).toBe('left_rail');
    expect(z([980, 200, 1260, 1400])).toBe('right_rail');
    expect(z([320, 200, 960, 2400])).toBe('center_column');
    expect(z([0, 700, 1280, 1400])).toBe('full_width_mid');
    expect(z([1180, 700, 1260, 780], 'fixed')).toBe('overlay_corner');
    expect(z([0, 700, 1280, 800], 'fixed')).toBe('overlay_bottom');
    expect(z([0, 0, 1280, 60], 'fixed')).toBe('overlay_top');
  });
});

describe('main content (readability-lite)', () => {
  it('prefers a main landmark with enough text', () => {
    const doc = html(`<nav>menu</nav><main id="m">${para(20)}</main>`);
    const r = findMainContent(doc);
    expect(r).toMatchObject({ foundBy: 'landmark', ambiguous: false });
    expect(r.el?.id).toBe('m');
  });

  it('uses a single article', () => {
    const doc = html(`<div><article id="a">${para(20)}</article></div>`);
    expect(findMainContent(doc)).toMatchObject({ foundBy: 'single_article' });
  });

  it('scores paragraphs and reports ambiguity between close rivals', () => {
    const clear = html(
      `<div class="sidebar">${para(1)}</div><div class="content" id="c">${para(8)}${para(8)}${para(8)}</div>`,
    );
    const r = findMainContent(clear);
    expect(r.el?.id).toBe('c');
    expect(r.ambiguous).toBe(false);
    const rivals = html(
      `<div id="a">${para(6)}${para(6)}</div><div id="b">${para(6)}${para(6)}</div>`,
    );
    const r2 = findMainContent(rivals);
    expect(r2.ambiguous).toBe(true);
    expect(r2.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('link density and readerable', () => {
    const doc = html(
      `<div id="l"><a href="/x">all link text</a></div><div id="t">plain text only</div>${para(12)}${para(12)}`,
    );
    expect(linkDensity(doc.getElementById('l') as Element)).toBe(1);
    expect(linkDensity(doc.getElementById('t') as Element)).toBe(0);
    expect(isProbablyReaderable(doc)).toBe(true);
    expect(isProbablyReaderable(html('<p>short</p>'))).toBe(false);
  });
});

describe('hover menus', () => {
  it('derives the revealed element from :hover rules', () => {
    expect(hoverTargetSelector('.menu li:hover > ul')).toBe('.menu li > ul');
    expect(hoverTargetSelector('nav li:hover .dropdown')).toBe(
      'nav li .dropdown',
    );
    expect(hoverTargetSelector('button:hover + .tip')).toBe('button + .tip');
    expect(hoverTargetSelector('a:hover')).toBeNull();
    expect(hoverTargetSelector('.x:hover::after')).toBeNull();
  });
});

describe('page classifier', () => {
  const base: CategoryFeatures = {
    signals: new Set(),
    structuredMain: false,
    mainTextShare: 0,
    textChars: 500,
    controlsPerKChars: 5,
    repeatedCards: 0,
    forms: 0,
    requiredFields: 0,
  };
  it('recognises articles, checkouts, apps and video pages', () => {
    const article = classifyPage({
      ...base,
      signals: new Set(['jsonld_article', 'og_type_article', 'readerable']),
      structuredMain: true,
      mainTextShare: 0.8,
      textChars: 9000,
    });
    expect(article.top).toBe('article');
    expect(article.p).toBeGreaterThan(0.9);
    expect(
      classifyPage({
        ...base,
        signals: new Set(['has_payment_fields', 'multi_step_form']),
        forms: 1,
        requiredFields: 6,
      }).top,
    ).toBe('form_checkout');
    expect(
      classifyPage({
        ...base,
        signals: new Set(['data_grid', 'rich_text_editor']),
        controlsPerKChars: 40,
      }).top,
    ).toBe('web_app');
    expect(
      classifyPage({
        ...base,
        signals: new Set(['large_video_in_main', 'og_type_video']),
      }).top,
    ).toBe('media_video');
    const none = classifyPage(base);
    expect(none.top).toBe('other');
    const total = Object.values(none.probs).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 2);
  });
});

describe('buckets', () => {
  it('uses the contract edges', () => {
    expect(widthBucket(14.9)).toBe('<15%');
    expect(widthBucket(95)).toBe('>90%');
    expect(heightBucket(0.05)).toBe('<0.1 screens');
    expect(heightBucket(3)).toBe('1-3 screens');
    expect(linkDensityBucket(0.7)).toBe('high');
    expect(regionTextBucket(0)).toBe('0');
    expect(regionTextBucket(2001)).toBe('>2k chars');
    expect(pageTextBucket(50_001)).toBe('>50k chars');
    expect(
      weightedMedian([
        [13, 100],
        [32, 10],
        [16, 20],
      ]),
    ).toBe(13);
    expect(weightedMedian([])).toBeNull();
  });
});
