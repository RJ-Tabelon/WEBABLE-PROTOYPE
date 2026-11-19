// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FitSpec, PageOutline } from '@webable/engine';
import { Picture } from './Blocks';
import {
  newCtx,
  newsStories,
  readBlocks,
  pageLeadImage,
  type ImageBlock,
} from './model';
import { buildPlan } from './plan';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 640,
    bottom: 360,
    width: 640,
    height: 360,
    toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function news() {
  document.body.innerHTML = `<main id="news">
    <section class="container_streaming-carousel"><a href="https://example.com/series/promotion"><img src="https://example.com/promotion.jpg"></a><h2><a href="https://example.com/series/promotion">Join our special streaming event tonight</a></h2></section>
    <section><a href="https://example.com/watch/cnn-stream"><img src="https://example.com/stream.jpg"></a><h2><a href="https://example.com/watch/cnn-stream">Watch live news on CNN</a></h2></section>
    <section><h2><a href="https://example.com/games/crossword">Play our daily crossword puzzle</a></h2><img src="https://example.com/game.jpg"></section>
    ${Array.from({ length: 12 }, (_, i) => `<article><a href="https://example.com/story-${i}"><picture><img src="https://example.com/story-${i}.jpg" width="640" height="360"></picture></a><header><h2><a href="https://example.com/story-${i}">The original headline for news story ${i}</a></h2></header></article>`).join('')}
  </main>`;
}

describe('news content preservation', () => {
  it('keeps destinations and paired photos when anchors sit inside headings', () => {
    news();
    const headline = document.querySelector('article h2')!;
    const blocks = readBlocks(headline, newCtx());
    expect(blocks[0]).toMatchObject({
      b: 'cardlink',
      href: 'https://example.com/story-0',
      image: { url: 'https://example.com/story-0.jpg', important: true },
    });
  });

  it('recovers stories omitted by an outline and keeps games out of the lead', () => {
    news();
    // A lead video or text story must not be demoted just because a later card has a photo.
    document.querySelector('article img')!.remove();
    const stories = newsStories();
    expect(stories.length).toBe(15);
    const plan = buildPlan({
      spec: {
        page_type: 'other',
        task: 'navigate',
        primary_action: null,
        strip: [],
        form_steps: [],
        sections: [],
        density: 'comfortable',
      } as FitSpec,
      outline: { nodes: [] } as unknown as PageOutline,
      elementFor: () => null,
      decisions: [],
      listFirst: 4,
    });
    expect(plan.kind).toBe('index');
    expect(plan.index?.lead?.href).toBe('https://example.com/story-0');
    expect(plan.index?.total).toBe(15);
    const all = [
      plan.index?.lead,
      ...(plan.index?.top ?? []),
      ...(plan.index?.sections.flatMap((s) => [...s.first, ...s.rest]) ?? []),
    ];
    for (let i = 0; i < 12; i++)
      expect(
        all.some((s) => s?.href === `https://example.com/story-${i}`),
      ).toBe(true);
  });

  it('keeps editorial pictures drawn as CSS backgrounds or video posters', () => {
    document.body.innerHTML = `<main>
      <article><a href="https://example.com/background" style="display:block;background-image:url('https://example.com/background.jpg')"><h2>A source story with a background photo</h2></a></article>
      <article><a href="https://example.com/video"><video poster="https://example.com/poster.jpg" width="640" height="360"></video><h2>A source story with a video preview</h2></a></article>
    </main>`;
    expect(newsStories().map((s) => s.image?.url)).toEqual([
      'https://example.com/background.jpg',
      'https://example.com/poster.jpg',
    ]);
  });

  it('recovers a replaced photo without reusing a disconnected cached image', () => {
    news();
    expect(newsStories()[3]?.image?.url).toBe(
      'https://example.com/story-0.jpg',
    );
    const old = document.querySelector('article img')!;
    const photo = old.cloneNode() as HTMLImageElement;
    photo.src = 'https://example.com/updated-story.jpg';
    old.replaceWith(photo);
    expect(newsStories()[3]?.image?.url).toBe(
      'https://example.com/updated-story.jpg',
    );
  });

  it('refreshes the lead image when a client-rendered article replaces its metadata', () => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@type': 'NewsArticle',
      image: 'https://example.com/first.jpg',
    });
    document.body.append(script);
    expect(pageLeadImage()?.url).toBe('https://example.com/first.jpg');
    script.textContent = JSON.stringify({
      '@type': 'NewsArticle',
      image: 'https://example.com/second.jpg',
    });
    expect(pageLeadImage()?.url).toBe('https://example.com/second.jpg');
  });

  it('shows an image already loaded from cache without waiting for another load event', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(
      true,
    );
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(
      640,
    );
    vi.spyOn(
      HTMLImageElement.prototype,
      'naturalHeight',
      'get',
    ).mockReturnValue(360);
    const host = document.body.appendChild(document.createElement('div'));
    const b: ImageBlock = {
      b: 'image',
      url: 'https://example.com/cached.jpg',
      alt: 'The news photo',
      w: 640,
      h: 360,
      nw: 640,
      nh: 360,
      important: true,
      fit: 'cover',
      key: 'pic',
      src: host,
      logo: false,
      caption: '',
      credit: '',
      linked: true,
      banner: false,
    };
    act(() => render(<Picture b={b} lead />, host));
    expect(host.querySelector('.wa-pic__box')?.getAttribute('data-state')).toBe(
      'ok',
    );
    expect(host.querySelector('img')?.getAttribute('src')).toBe(b.url);
  });
});
