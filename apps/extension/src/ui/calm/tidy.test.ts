// @vitest-environment happy-dom
// Round 8b (SIMPLIFIED.md): the site's chrome, machine labels and repeats never show; related stories and site links
// are sorted out of the end of a reading page.
import { afterEach, describe, expect, it } from 'vitest';
import type { Block, CardLinkBlock, ControlBlock, FlowBlock } from './model';
import { Seen, cleanLabel, findListen, isCaptionEcho, isChromeLabel, isMachineLabel, normText, scrubBlocks, sortEnd } from './tidy';

let n = 0;
function link(text: string, href: string | null, opts: { role?: 'link' | 'button'; parent?: Element } = {}): ControlBlock {
  const el = document.createElement(opts.role === 'button' ? 'button' : 'a');
  if (href) el.setAttribute('href', href);
  el.textContent = text;
  (opts.parent ?? document.body).appendChild(el);
  return {
    b: 'control', el, role: opts.role ?? 'link', text, href: href ? new URL(href, location.href).href : null,
    primary: false, help: false, selected: false, popup: false, key: `k${++n}`, src: el,
  };
}
function card(title: string, href: string, parent?: Element): CardLinkBlock {
  const el = document.createElement('a');
  el.setAttribute('href', href);
  (parent ?? document.body).appendChild(el);
  return {
    b: 'cardlink', el, href: new URL(href, location.href).href, title, lines: [], image: null, kicker: null, dek: null, time: null,
    top: 0, headPx: 16, key: `k${++n}`, src: el,
  };
}
function flow(text: string): FlowBlock {
  const p = document.createElement('p');
  p.textContent = text;
  document.body.appendChild(p);
  return { b: 'flow', parts: [{ t: 'text', text }], text, help: false, key: `k${++n}`, src: p };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('machine labels and placeholders (rule 2)', () => {
  it('drops the labels from the CNN review', () => {
    for (const t of ['Related card', 'Related item', 'Open Menu Icon', 'CNN logo', 'Dianomi ad container (4015-358)', 'share with x', 'copy link to clipboard', 'header-nav-toggle', 'openMenu', 'btn_share', 'Links']) {
      expect(isMachineLabel(t), t).toBe(true);
    }
  });
  it('keeps real words', () => {
    for (const t of ['Politics', 'Terms of Use', 'Ukraine-Russia War', 'iPhone', 'Satellite image shows the storm growing', 'Full Boxscore', 'Economic woes transform the Midwest']) {
      expect(isMachineLabel(t), t).toBe(false);
    }
  });
  it('puts all-lowercase labels in sentence case, but not addresses', () => {
    expect(cleanLabel('share with Email')).toBe('share with Email');
    expect(cleanLabel('terms of use')).toBe('Terms of use');
    expect(cleanLabel('wcjb.com/livestream')).toBe('wcjb.com/livestream');
    expect(cleanLabel('University of Florida, opens in new window')).toBe('University of Florida');
  });
});

describe('site chrome (rule 1)', () => {
  it('knows share, follow, app, account, ad and menu labels', () => {
    for (const t of ['Share with Threads', 'share with facebook', 'Visit us on Instagram', 'Follow CNN Politics', 'Download the CNN app', 'Download on Apple App Store', 'Get it on Google Play', 'Our news and weather apps', 'Subscribe', 'Sign in', 'Paid Content', 'Sponsored', 'Advertisement', 'Open Menu', 'Search', 'Add Us On Google', 'Listen']) {
      expect(isChromeLabel(t), t).toBe(true);
    }
  });
  it('leaves menu and footer destinations alone', () => {
    for (const t of ['Politics', 'Terms of Use', 'Privacy Policy', 'Ad Choices', 'Newsletters', 'Watch', 'About CNN', 'Sitemap']) {
      expect(isChromeLabel(t), t).toBe(false);
    }
  });
});

describe('the end of a reading page (rules 1, 3, 5)', () => {
  it('sorts stories, site links and chrome, each once', () => {
    const nav = document.createElement('nav');
    document.body.appendChild(nav);
    const parts = [
      {
        key: 'rel', label: 'Related items', chrome: false,
        blocks: [
          link('share with facebook', '#'), link('share with x', '#'), link('copy link to clipboard', null, { role: 'button' }),
          card('Related card', '/2026/10/24/politics/a'),
          card('Trump’s closing pitch leans on tariffs in Michigan', '/2026/10/24/politics/tariffs'),
          card('Trump’s closing pitch leans on tariffs in Michigan', '/2026/10/24/politics/tariffs#comments'),
          flow('Paid Content'),
        ] as Block[],
      },
      {
        key: 'clouds', label: 'Site links', chrome: true,
        blocks: [
          link('Politics', '/politics', { parent: nav }), link('Politics', '/politics'), link('Open Menu Icon', null, { role: 'button' }),
          link('CNN logo', '/'), link('Terms of Use', '/terms'), link('Subscribe', '/subscribe'), link('Visit us on X', 'https://x.com/cnn'),
          flow('© 2026 Cable News Network. All Rights Reserved.'),
        ] as Block[],
      },
    ];
    const end = sortEnd(parts);
    expect(end.stories.map((s) => s.title)).toEqual(['Trump’s closing pitch leans on tariffs in Michigan']);
    expect(end.links.map((l) => l.text)).toEqual(['Politics', 'Terms of Use']);
    expect(end.rest).toEqual([]);
  });

  it('keeps real words that are neither a story nor a link', () => {
    const note = flow('Eric Bradner is a senior reporter covering national politics, campaigns and elections for CNN.');
    const end = sortEnd([{ key: 'x', label: 'More on this page', chrome: false, blocks: [note] }]);
    expect(end.rest[0]?.blocks).toEqual([note]);
  });

  it('never lists a story the page already shows', () => {
    const c = card('A story the article already links to in its body', '/2026/10/24/politics/b');
    expect(sortEnd([{ key: 'a', label: 'x', chrome: false, blocks: [c] }]).stories).toHaveLength(1);
    const seen = new Seen();
    seen.fresh(c.href, c.title);
    expect(sortEnd([{ key: 'a', label: 'x', chrome: false, blocks: [c] }], seen).stories).toHaveLength(0);
  });
});

describe('inside the content', () => {
  it('drops share bars, ad lines and repeated addresses on a reading page, and keeps a form’s Change links', () => {
    const blocks: Block[] = [link('share with x', '#'), flow('Advertisement'), link('Full Boxscore', '/box'), link('Full box score', '/box')];
    expect(scrubBlocks(blocks, { reading: true }).map((b) => (b.b === 'control' ? b.text : b.b))).toEqual(['Full Boxscore']);
    const change: Block[] = [link('Change', '/a'), link('Change', '/b')];
    expect(scrubBlocks(change, { reading: false })).toHaveLength(2);
  });
  it('moves the site footer’s links out of the content on a reading page', () => {
    const footer = document.createElement('footer');
    document.body.appendChild(footer);
    const chrome: Block[] = [];
    const kept = scrubBlocks([link('Contact', '/contact', { parent: footer }), flow('A paragraph of the story itself that stays.')], { reading: true, chrome });
    expect(kept).toHaveLength(1);
    expect(chrome).toHaveLength(1);
  });
  it('drops a caption printed again, cut short', () => {
    const cap = normText('Iowa Republican nominee for Governor Zach Lahn speaks to fairgoers at the Iowa State Fair on August 14, 2026.');
    expect(isCaptionEcho('Iowa Republican nominee for Governor Zach Lahn speaks to fairgoers at the Iowa State Fair on ...', [cap])).toBe(true);
    expect(isCaptionEcho('As the debate season kicked off in Iowa’s heated gubernatorial race', [cap])).toBe(false);
  });
});

describe('listen to this article (rule 7)', () => {
  it('finds the article’s own listen button, never the site’s podcast link', () => {
    document.body.innerHTML = '<header><a href="/audio">Listen</a></header><main><h1>Title</h1><button>Listen to this article</button></main>';
    const h1 = document.querySelector('h1');
    // happy-dom lays nothing out: give the button and the title a box.
    for (const e of Array.from(document.querySelectorAll('h1,button,a'))) {
      (e as HTMLElement).getBoundingClientRect = () => ({ top: 100, left: 0, width: 200, height: 40, right: 200, bottom: 140, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
    }
    const found = findListen(h1);
    expect(found?.localName).toBe('button');
  });
  it('is null when the page has none', () => {
    document.body.innerHTML = '<header><a href="/audio">Listen</a></header><main><h1>Title</h1><button>Play</button></main>';
    expect(findListen(document.querySelector('h1'))).toBeNull();
  });
});
