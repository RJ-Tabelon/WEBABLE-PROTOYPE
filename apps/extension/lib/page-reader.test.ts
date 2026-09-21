import { describe, expect, it } from 'vitest';

import { readPage } from './page-reader';

describe('readPage', () => {
  it('returns a useful structural snapshot without form values', () => {
    document.documentElement.lang = 'en';
    document.title = 'Example article';
    document.body.innerHTML = `
      <header>Site header</header>
      <main>
        <h1>A readable heading</h1>
        <p style="font-size: 12px">Useful page text for a visitor.</p>
        <p style="display: none">Hidden private text</p>
        <div style="display: none"><span>Nested hidden text</span></div>
        <a href="/about">About</a>
        <a href="https://elsewhere.example/story">Elsewhere</a>
        <label>Email <input value="private@example.com" /></label>
        <button>Continue</button>
        <img src="one.png" alt="A description" />
        <img src="two.png" />
      </main>
      <script>superSecret()</script>
    `;

    const snapshot = readPage(document, window.location);

    expect(snapshot.title).toBe('Example article');
    expect(snapshot.language).toBe('en');
    expect(snapshot.headingCount).toBe(1);
    expect(snapshot.headings).toEqual([
      { level: 1, text: 'A readable heading' },
    ]);
    expect(snapshot.links).toEqual({ total: 2, sameOrigin: 1, external: 1 });
    expect(snapshot.controls).toMatchObject({ buttons: 1, inputs: 1 });
    expect(snapshot.images).toEqual({ total: 2, withAlt: 1, withoutAlt: 1 });
    expect(snapshot.text.excerpt).toContain('Useful page text');
    expect(snapshot.text.excerpt).not.toContain('private@example.com');
    expect(snapshot.text.excerpt).not.toContain('superSecret');
    expect(snapshot.text.excerpt).not.toContain('Hidden private text');
    expect(snapshot.text.excerpt).not.toContain('Nested hidden text');
    expect(snapshot.text.belowMinimumSize).toBeGreaterThan(0);
    expect(snapshot.layout.viewportWidth).toBeGreaterThan(0);
    expect(snapshot.domRevision).toBe(0);
  });

  it('truncates long page text to a bounded preview', () => {
    document.body.textContent = 'word '.repeat(1_000);

    const snapshot = readPage(document, window.location, 3);

    expect(snapshot.text.excerpt).toHaveLength(2_000);
    expect(snapshot.text.truncated).toBe(true);
    expect(snapshot.text.wordCount).toBe(1_000);
    expect(snapshot.domRevision).toBe(3);
  });
});
