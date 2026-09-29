import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccessibilityDoc } from './doc/AccessibilityDoc';
import { HelpDoc } from './doc/HelpDoc';
import { PrivacyDoc } from './doc/PrivacyDoc';
import { ResearchDoc } from './doc/ResearchDoc';
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
];

/** Routes that exist in apps/web (site, app, tune and auth). */
const KNOWN_ROUTES = new Set([
  '/',
  '/privacy',
  '/research',
  '/accessibility',
  '/help',
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
    .replace(/&nbsp;|&#160;/g, ' ')
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
    expect(
      hrefs(html).filter((h) => h === '/tune').length,
    ).toBeGreaterThanOrEqual(1);
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

  it('tells the verifier story with the exact rollback sentence', () => {
    expect(text).toContain('Line spacing was undone');
    expect(text).toContain(
      'It made text overlap here, so WebAble put it back.',
    );
  });

  it('says what is and is not sent, in plain nouns', () => {
    expect(text).toMatch(/Sent .*Page structure/);
    expect(text).toMatch(
      /Not sent .*Page text .*Anything you typed .*Your browsing history/,
    );
    expect(hrefs(html)).toContain('/privacy');
  });

  it('makes no compliance claim', () => {
    expect(text).toContain(
      'It never claims a site is accessible or compliant.',
    );
  });
});
