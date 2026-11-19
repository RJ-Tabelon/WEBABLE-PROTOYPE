import { describe, expect, it } from 'vitest';

import {
  backgroundImageUrl,
  hrefKind,
  parseSrcset,
  safeHrefUrl,
  safeMediaUrl,
  sanitizeSrcset,
  siteOf,
} from './media';

const BASE = 'https://www.example.com/watch/page?x=1';

describe('media URLs', () => {
  it('resolves relative URLs and keeps only http(s), data:image and blob', () => {
    expect(safeMediaUrl('/a.jpg', BASE)).toBe('https://www.example.com/a.jpg');
    expect(safeMediaUrl('data:image/png;base64,AAAA', BASE)).toBe(
      'data:image/png;base64,AAAA',
    );
    expect(safeMediaUrl('blob:https://www.example.com/1234', BASE)).toBe(
      'blob:https://www.example.com/1234',
    );
    expect(safeMediaUrl('javascript:alert(1)', BASE)).toBeNull();
    expect(safeMediaUrl('data:text/html,<script>1</script>', BASE)).toBeNull();
    expect(safeMediaUrl('  ', BASE)).toBeNull();
    expect(safeMediaUrl(null, BASE)).toBeNull();
  });

  it('parses srcset candidates, data: URLs keep their commas', () => {
    expect(parseSrcset('a.jpg 1x, b.jpg 2x')).toEqual([
      { url: 'a.jpg', desc: '1x' },
      { url: 'b.jpg', desc: '2x' },
    ]);
    expect(parseSrcset('data:image/png;base64,AA,BB 640w,c.jpg')).toEqual([
      { url: 'data:image/png;base64,AA,BB', desc: '640w' },
      { url: 'c.jpg', desc: '' },
    ]);
    expect(parseSrcset('a.jpg,, b.jpg 100w')).toEqual([
      { url: 'a.jpg', desc: '' },
      { url: 'b.jpg', desc: '100w' },
    ]);
  });

  it('sanitises srcset: absolute safe URLs, valid descriptors only', () => {
    expect(
      sanitizeSrcset(
        '/s.jpg 1x, javascript:x 2x, /l.jpg 2x, /w.jpg bogus',
        BASE,
      ),
    ).toBe(
      'https://www.example.com/s.jpg 1x, https://www.example.com/l.jpg 2x, https://www.example.com/w.jpg',
    );
    expect(sanitizeSrcset('javascript:x 1x', BASE)).toBeNull();
    expect(sanitizeSrcset('', BASE)).toBeNull();
  });

  it('reads the first url() of a computed background-image', () => {
    expect(backgroundImageUrl('url("https://a.test/x.jpg")')).toBe(
      'https://a.test/x.jpg',
    );
    expect(backgroundImageUrl('linear-gradient(red, blue), url(/y.png)')).toBe(
      '/y.png',
    );
    expect(backgroundImageUrl("url('a\\'b.png')")).toBe("a'b.png");
    expect(backgroundImageUrl('none')).toBeNull();
    expect(backgroundImageUrl('linear-gradient(red, blue)')).toBeNull();
  });
});

describe('hrefs', () => {
  it('exposes only http(s), mailto and tel', () => {
    expect(safeHrefUrl('/p?q=1#x', BASE)).toBe(
      'https://www.example.com/p?q=1#x',
    );
    expect(safeHrefUrl('mailto:a@b.test', BASE)).toBe('mailto:a@b.test');
    expect(safeHrefUrl('tel:+15555555555', BASE)).toBe('tel:+15555555555');
    expect(safeHrefUrl('javascript:void(0)', BASE)).toBeNull();
    expect(safeHrefUrl('data:text/html,x', BASE)).toBeNull();
    expect(safeHrefUrl('ftp://x.test/f', BASE)).toBeNull();
  });

  it('approximates the registrable site', () => {
    expect(siteOf('www.youtube.com')).toBe('youtube.com');
    expect(siteOf('m.youtube.com')).toBe('youtube.com');
    expect(siteOf('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(siteOf('www.amazon.com.au')).toBe('amazon.com.au');
    expect(siteOf('example.org')).toBe('example.org');
    expect(siteOf('127.0.0.1')).toBe('127.0.0.1');
  });

  it('classifies link targets relative to the page', () => {
    expect(hrefKind('/other', BASE)).toBe('same');
    expect(hrefKind('https://m.example.com/x', BASE)).toBe('same');
    expect(hrefKind('https://elsewhere.test/', BASE)).toBe('other');
    expect(hrefKind('mailto:a@b.test', BASE)).toBe('other');
    expect(hrefKind('#comments', BASE)).toBe('fragment');
    expect(hrefKind('/watch/page?x=1#top', BASE)).toBe('fragment');
    expect(hrefKind('javascript:void(0)', BASE)).toBe('none');
    expect(hrefKind(null, BASE)).toBe('none');
    expect(hrefKind('', BASE)).toBe('none');
  });
});
