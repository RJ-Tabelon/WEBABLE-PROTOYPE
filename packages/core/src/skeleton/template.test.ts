import { describe, expect, it } from 'vitest';

import { pathShape } from './template';

describe('pathShape', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', '/watch'],
    ['https://www.youtube.com/@veritasium/videos', '/@*/videos'],
    ['https://www.youtube.com/results?search_query=travel+books', '/results'],
    ['https://www.youtube.com/shorts/aBcD123xYz', '/shorts/*'],
    ['https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA', '/channel/*'],
    ['https://www.amazon.com/dp/B07XJ8C8F5', '/dp/*'],
    [
      'https://www.amazon.com/Some-Book-Title/dp/B07XJ8C8F5/ref=sr_1_1',
      '/*/dp/*/*',
    ],
    ['https://www.amazon.com/s?k=marmalade', '/s'],
    ['https://en.wikipedia.org/wiki/Alan_Turing', '/wiki/*'],
    ['https://en.wikipedia.org/wiki/Main_Page', '/wiki/*'],
    [
      'https://www.reddit.com/r/books/comments/1q2w3e/what_to_read/',
      '/r/*/comments/*/*',
    ],
    ['https://www.reddit.com/u/quillon', '/u/*'],
    ['https://github.com/', '/'],
    ['https://www.gov.uk/browse/driving', '/browse/driving'],
    [
      'https://news.example.com/2026/10/15/a-very-long-story-about-things',
      '/*/*/*/*',
    ],
    ['https://www.example.com/sign-in', '/sign-in'],
    ['https://www.example.com/best-sellers/books', '/best-sellers/books'],
    ['https://www.example.com/index.html', '/index'],
    ['https://www.example.com/caf%C3%A9', '/*'],
    ['https://www.example.com/%E4%B8%AD%E6%96%87', '/*'],
    ['https://www.example.com/shop//books/', '/shop/books'],
    [
      'https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKlqWnTwTqWzc',
      '/mail/u/*/#/inbox/*',
    ],
    [
      'https://mail.google.com/mail/u/0/#search/quillon+invoice',
      '/mail/u/*/#/search/*',
    ],
    ['https://app.example.com/#/settings/profile?tab=2', '/#/settings/profile'],
    ['https://app.example.com/#!/item/48151623', '/#!/item/*'],
    ['https://www.example.com/docs#installation', '/docs'],
  ])('%s -> %s', (url, shape) => {
    expect(pathShape(url)).toBe(shape);
  });

  it('never contains the query, digits or capitalised page text', () => {
    for (const url of [
      'https://www.example.com/search?q=secret+quartzite',
      'https://www.example.com/Users/Quillon/Orders/48151623',
      'https://www.example.com/p/zebulon-vesperine',
    ]) {
      const shape = pathShape(url);
      expect(shape).not.toMatch(
        /\d|quartzite|quillon|zebulon|vesperine|secret/i,
      );
    }
  });

  it('caps very deep paths', () => {
    const deep = `https://docs.example.com/${'section/'.repeat(20)}`;
    expect(pathShape(deep)).toBe(`/${'section/'.repeat(8)}**`);
  });

  it('falls back to / for anything that is not a URL', () => {
    expect(pathShape('not a url')).toBe('/');
    expect(pathShape('')).toBe('/');
  });
});
