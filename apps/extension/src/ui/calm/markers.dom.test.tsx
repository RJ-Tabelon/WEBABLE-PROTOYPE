// @vitest-environment happy-dom
// Round 8 markers in a page: the reading-time line and the live dot's motion.
import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { AdTag, Kicker, readTimeLine } from './markers';

const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('reading time line', () => {
  it('is words / 230 from the article paragraphs', () => {
    document.body.innerHTML = `<nav>${words(500)}</nav><article><h1>A headline</h1><p>${words(900)}</p><p>${words(480)}</p></article>`;
    expect(readTimeLine(document, null, () => null)).toBe('6 min read');
  });

  it("keeps the page's own reading time next to its headline", () => {
    document.body.innerHTML = `<main><h1>How to respond to the stare</h1><div>By Terry Ward · 5 min read</div><p>${words(2000)}</p></main>`;
    expect(readTimeLine(document, null, () => null)).toBe('5 min read');
  });

  it('adds nothing when the page says it somewhere else', () => {
    document.body.innerHTML = `<article><h1>A headline</h1><p>${words(900)}</p></article><aside><a>Another story · 3 min read</a></aside>`;
    expect(readTimeLine(document, null, () => null)).toBeNull();
  });

  it('uses the main region Jev is sure of', () => {
    document.body.innerHTML = `<div id="m"><h1>Title</h1><p>${words(460)}</p></div><article><p>${words(5000)}</p></article>`;
    const u = { elements: [], mainPick: { id: 'none', p: 0, probs: {} }, metrics: {} as never, cached: false, mainRegion: { id: 'n1', p: 0.9, probs: {} } };
    expect(readTimeLine(document, u, (id) => (id === 'n1' ? document.getElementById('m') : null))).toBe('2 min read');
  });
});

describe('live dot and ad tag', () => {
  it('pulses only when motion is fine', () => {
    const host = document.createElement('div');
    document.body.append(host);
    render(<Kicker text="Live" live="Live" pulse />, host);
    expect(host.querySelector('.wa-live__dot')?.hasAttribute('data-pulse')).toBe(true);
    render(<Kicker text="Live" live="Live" pulse={false} />, host);
    expect(host.querySelector('.wa-live__dot')?.hasAttribute('data-pulse')).toBe(false);
    expect(host.textContent).toBe('Live');
  });

  it('a plain kicker stays plain, and the tag says Ad', () => {
    const host = document.createElement('div');
    document.body.append(host);
    render(<Kicker text="Politics" live={null} pulse />, host);
    expect(host.querySelector('.wa-live__dot')).toBeNull();
    render(<AdTag />, host);
    expect(host.textContent).toBe('Ad');
  });
});
