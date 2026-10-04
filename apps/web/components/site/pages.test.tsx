import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccessibilityDoc } from './doc/AccessibilityDoc';
import { HelpDoc } from './doc/HelpDoc';
import { PrivacyDoc } from './doc/PrivacyDoc';
import { ResearchDoc } from './doc/ResearchDoc';
import { GetPage } from './GetPage';
import { HomePage } from './home/HomePage';

/**
 * Whole-page checks on the server-rendered markup: heading outline, the words and
 * glyphs the copy rules forbid (design-final §13), anchors other surfaces link to,
 * and internal links that go somewhere real.
 */

interface Page {
  path: string;
  element: ReactElement;
  /** The accessibility statement describes how we test our own pages. */
  allowTestWord?: boolean;
}

const PAGES: readonly Page[] = [
  { path: '/', element: <HomePage /> },
  { path: '/privacy', element: <PrivacyDoc /> },
  { path: '/research', element: <ResearchDoc /> },
  {
    path: '/accessibility',
    element: <AccessibilityDoc />,
    allowTestWord: true,
  },
  { path: '/help', element: <HelpDoc /> },
  {
    path: '/get',
    element: (
      <GetPage storeUrl="https://chromewebstore.google.com/detail/abcdefghijklmnopabcdefghijklmnop" />
    ),
  },
  { path: '/get (no store listing)', element: <GetPage storeUrl={null} /> },
];

/** Routes that exist in apps/web (site, app, tune and auth). */
const KNOWN_ROUTES = new Set([
  '/',
  '/privacy',
  '/research',
  '/accessibility',
  '/help',
  '/get',
  '/tune',
  '/sign-in',
  '/app',
  '/app/privacy',
]);

const render = (el: ReactElement) => renderToStaticMarkup(el);

function textOf(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|\u00a0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
}

function ids(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/\shref="([^"]+)"/g)].map((m) =>
    m[1]!.replace(/&amp;/g, '&'),
  );
}

describe.each(PAGES)('$path', ({ element, allowTestWord }) => {
  const html = render(element);
  const text = textOf(html);

  it('has one h1 and never skips a heading level', () => {
    const levels = headingLevels(html);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(
        levels[i]! - levels[i - 1]!,
        `h${levels[i - 1]} then h${levels[i]}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('never types arrows, checks or undo glyphs (they are SVG)', () => {
    expect(text.match(/[\u2190-\u21FF\u2713\u2714\u2715\u2717]/g)).toBeNull();
  });

  it('follows the copy rules', () => {
    // Report the offending words, not the whole page.
    const found = (re: RegExp) =>
      [...text.matchAll(new RegExp(re.source, 'gi'))].map((m) => m[0]);
    expect(found(/!/)).toEqual([]);
    expect(
      found(
        /\b(normal|disabilit\w*|disabled people|impairment\w*|patients?|diagnos(is|e|ed)|symptoms?|assessment|scores?|results|below average|acuity)\b/,
      ),
    ).toEqual([]);
    expect(
      found(
        /\b(magic|seamless(ly)?|effortless(ly)?|revolutionary|empower\w*|smart)\b/,
      ),
    ).toEqual([]);
    expect(found(/\b(WCAG|ADA)[ -]?(compliant|conformant)\b/)).toEqual([]);
    expect(found(/\bfix(es|ed)? accessibility\b/)).toEqual([]);
    if (!allowTestWord) expect(found(/\btests?\b/)).toEqual([]);
  });

  it('links every in-page anchor to a section that exists', () => {
    const present = ids(html);
    for (const href of hrefs(html)) {
      if (href.startsWith('#'))
        expect(present.has(href.slice(1)), href).toBe(true);
    }
  });

  it('links internally only to routes that exist', () => {
    for (const href of hrefs(html)) {
      if (!href.startsWith('/')) continue;
      const path = href.split('#')[0]!.split('?')[0]!;
      expect(KNOWN_ROUTES.has(path || '/'), href).toBe(true);
    }
  });

  it('opens external links safely', () => {
    for (const m of html.matchAll(/<a [^>]*href="https?:[^"]*"[^>]*>/g)) {
      expect(m[0]).toContain('rel="noopener noreferrer"');
    }
  });
});

describe('anchors other surfaces rely on', () => {
  it('has the sections the header, footer and popup link to', () => {
    expect(ids(render(<PrivacyDoc />)).has('what-webable-sends')).toBe(true);
    expect(ids(render(<HelpDoc />)).has('contact')).toBe(true);
    expect(ids(render(<HomePage />)).has('how')).toBe(true);
  });
});

describe('home page', () => {
  const html = render(<HomePage />);
  const text = textOf(html);

  it('leads with the hero promise and one call to action', () => {
    expect(html).toMatch(/<h1[^>]*>The web, made to measure\.<\/h1>/);
    expect(text).toContain(
      'WebAble learns how you read, point and focus, then adjusts each site to fit. You see every change and can undo it.',
    );
    const hero = html.slice(0, html.indexOf('aria-labelledby="fits-title"'));
    // The one ink button goes to the install page; Tune is the secondary path.
    expect(hero.match(/wa-btn--primary/g)).toHaveLength(1);
    expect(hrefs(hero)).toEqual(expect.arrayContaining(['/get', '/tune']));
    expect(textOf(hero)).toContain('Add to Chrome');
    expect(textOf(hero)).toContain('Or tune it first');
  });

  it('says how long Tune takes, and that nothing is graded, once each', () => {
    expect(text.match(/6 minutes/g)).toHaveLength(1);
    expect(text.match(/no passing or failing/g)).toHaveLength(1);
    const cta = html.slice(html.indexOf('id="cta-title"'));
    expect(textOf(cta)).toContain('About 6 minutes.');
    expect(hrefs(cta)).toContain('/tune');
    expect(textOf(cta)).toContain('Start tuning');
  });

  it('shows three fits side by side, with nothing to choose', () => {
    const fits = html.slice(
      html.indexOf('aria-labelledby="fits-title"'),
      html.indexOf('id="how"'),
    );
    expect(fits).not.toMatch(/role="radiogroup"|<select|role="radio"/);
    expect(fits).not.toMatch(/<h3/);
    expect(fits).not.toContain('preset');
    for (const head of [
      'Fit from a reading-heavy Tune',
      'Fit from a pointing-heavy Tune',
      'Fit from a focus-heavy Tune',
    ])
      expect(textOf(fits)).toContain(head);
    expect(fits.match(/class="ws-sample"/g)).toHaveLength(3);
  });

  it('explains how it works without pictures of controls', () => {
    const how = html.slice(
      html.indexOf('id="how"'),
      html.indexOf('aria-labelledby="verify-title"'),
    );
    expect(textOf(how)).toContain('Three short tasks. Then sites fit you.');
    expect(how).not.toMatch(/ws-pill|wa-fit-mark|ws-step__visual/);
    expect(how.match(/class="ws-step"/g)).toHaveLength(3);
  });

  it('reports every check as clear except the one it found', () => {
    expect(text).not.toContain('Passed');
    expect(text.match(/\bClear\b/g)).toHaveLength(6);
    expect(text.match(/\bFound\b/g)).toHaveLength(1);
  });

  it('shows part of the payload and links to all of it', () => {
    expect(text).toContain('"zone":');
    expect(text).toContain('"control_words":');
    expect(text).not.toContain('"iframe_kind":');
    expect(text).toMatch(/And 13 more fields\. See them all/);
    expect(hrefs(html)).toContain('/privacy#what-webable-sends');
  });

  it('describes each sample page for screen readers', () => {
    const samples = [
      ...html.matchAll(
        /class="ws-sample"[^>]*|role="img"[^>]*class="ws-sample"/g,
      ),
    ];
    expect(samples.length).toBeGreaterThan(0);
    expect(html).toMatch(
      /role="img" aria-label="The same news page fitted by WebAble\. Changes: text size, 13 to 18 pixels/,
    );
  });

  it('keeps the hero values for narrow screens out of the spoken page', () => {
    const start = html.indexOf('ws-demo__legend');
    expect(start).toBeGreaterThan(0);
    const legend = html.slice(
      html.lastIndexOf('<ul', start),
      html.indexOf('</ul>', start),
    );
    expect(legend).toContain('aria-hidden="true"');
    const words = textOf(legend);
    for (const label of ['Text size', 'Click targets', 'Moving things'])
      expect(words).toContain(label);
    expect(legend.match(/wa-fit-mark__label/g)).toHaveLength(3);
  });

  it('tells the verifier story with the exact rollback sentence', () => {
    expect(text).toContain('Line spacing was undone');
    expect(text).toContain(
      'It made text overlap here, so WebAble put it back.',
    );
  });

  it('says what is and is not sent, in plain nouns', () => {
    expect(text).toMatch(/Sent with page analysis .*Page structure/);
    expect(text).toMatch(
      /Never sent with page analysis .*Page text .*Anything you typed .*Your browsing history/,
    );
    expect(hrefs(html)).toContain('/privacy');
  });

  it('makes no compliance claim', () => {
    expect(text).toContain(
      'It never claims a site is accessible or compliant.',
    );
  });
});

describe('install page', () => {
  it('goes to the store in one activation, in a new tab', () => {
    const store =
      'https://chromewebstore.google.com/detail/abcdefghijklmnopabcdefghijklmnop';
    const html = render(<GetPage storeUrl={store} />);
    expect(html).toMatch(/<h1[^>]*>Add WebAble to Chrome\.<\/h1>/);
    expect(hrefs(html)).toContain(store);
    expect(html).toMatch(/wa-btn--primary/);
    expect(textOf(html)).toContain('(opens in a new tab)');
    expect(hrefs(html)).toContain('/tune');
    expect(textOf(html)).toContain('WebAble runs in Chrome on a computer.');
  });

  it('offers install instructions when there is no store listing', () => {
    const html = render(<GetPage storeUrl={null} />);
    expect(html).not.toMatch(/wa-btn--primary/);
    expect(hrefs(html)).toContain('/help#setup');
    expect(textOf(html)).toContain('Install instructions');
    expect(ids(render(<HelpDoc />)).has('setup')).toBe(true);
  });
});

describe('document pages', () => {
  it('says which way the evidence points', () => {
    const text = textOf(render(<ResearchDoc />));
    expect(text).toContain('Evidence against it: strong');
    expect(text).toContain('Evidence: strong');
  });

  it('opens the research with a table of every change, linked to its block', () => {
    const html = render(<ResearchDoc />);
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    expect(table).toContain('What WebAble does');
    const present = ids(html);
    const links = hrefs(table);
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const href of links)
      expect(present.has(href.slice(1)), href).toBe(true);
    expect(html).not.toMatch(/\+\d+ more/);
  });

  it('lists every source of a block on one line, opening in a new tab', () => {
    const html = render(<ResearchDoc />);
    expect(html).toContain('ws-doc ws-doc--notes');
    const cites = [...html.matchAll(/<p class="ws-cites">([\s\S]*?)<\/p>/g)];
    expect(cites.length).toBeGreaterThan(10);
    for (const [, inner] of cites) {
      const links = [...inner!.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
      expect(links.length).toBeGreaterThan(0);
      for (const a of links) {
        expect(a).toContain('target="_blank"');
        expect(a).toContain('rel="noopener noreferrer"');
      }
      expect(textOf(inner!).match(/opens in a new tab/g)).toHaveLength(
        links.length,
      );
      expect((textOf(inner!).match(/ · /g) ?? []).length).toBe(
        links.length - 1,
      );
    }
  });

  it('marks the section being read, and folds the list on small screens', () => {
    const html = render(<PrivacyDoc />);
    expect(html).toMatch(/<details class="ws-toc__details">/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain('<nav class="ws-toc" aria-label="On this page">');
  });

  it('is plain about product learning and about questions', () => {
    const text = textOf(render(<PrivacyDoc />));
    expect(text).toContain(
      'Your account is used to check you turned this on and to allow one report every 4 weeks. It isn’t stored with the counts.',
    );
    expect(text).toContain('Questions about your data:');
    expect(textOf(render(<HelpDoc />))).not.toContain('passwords or personal');
  });
});
