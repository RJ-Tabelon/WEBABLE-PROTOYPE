// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { clickMatchesTarget, findTargets, hrefMatches, isNearMiss } from './match';
import { sameSite } from './shared';
import { looksLikeAd } from './signals';
import { linkNavigates } from './task';

describe('hrefMatches', () => {
  it('matches a needle that ends where the href word ends', () => {
    const uf = ['/wiki/University_of_Florida'];
    expect(hrefMatches('https://en.wikipedia.org/wiki/University_of_Florida', uf)).toBe(true);
    expect(hrefMatches('https://en.wikipedia.org/wiki/University_of_Florida#History', uf)).toBe(true);
    expect(hrefMatches('https://en.wikipedia.org/wiki/University_of_Florida_Health', uf)).toBe(false);
    expect(hrefMatches('https://www.cnn.com/health', ['cnn.com/health'])).toBe(true);
    expect(hrefMatches('https://www.cnn.com/health/article', ['cnn.com/health'])).toBe(true);
    expect(hrefMatches('https://www.cnn.com/healthcare', ['cnn.com/health'])).toBe(false);
    expect(hrefMatches(null, ['x'])).toBe(false);
  });
});

describe('clickMatchesTarget', () => {
  it('counts a click on a link or anything inside it; not on plain text with the same words', () => {
    document.body.innerHTML = `
      <nav><a id="h" href="https://www.cnn.com/health"><span id="hs">Health</span></a></nav>
      <h2 id="plain">Health</h2>
      <button id="j"><i id="ji"></i> Jump to Recipe </button>
      <a id="other" href="https://www.cnn.com/travel">Travel</a>`;
    const health = { hrefIncludes: ['cnn.com/health'], text: ['Health'] };
    expect(clickMatchesTarget(document.getElementById('hs'), health)).toBe(true);
    expect(clickMatchesTarget(document.getElementById('h'), health)).toBe(true);
    expect(clickMatchesTarget(document.getElementById('plain'), health)).toBe(false);
    expect(clickMatchesTarget(document.getElementById('other'), health)).toBe(false);
    expect(clickMatchesTarget(document.getElementById('ji'), { text: ['jump to recipe'] })).toBe(true);
    expect(findTargets(document, health).map((e) => e.id)).toEqual(['h']);
  });
});

describe('isNearMiss', () => {
  const box = { left: 100, top: 100, right: 200, bottom: 120 };
  it('is outside the box but within 24 px of it', () => {
    expect(isNearMiss(150, 110, [box])).toBe(false);
    expect(isNearMiss(210, 110, [box])).toBe(true);
    expect(isNearMiss(150, 143, [box])).toBe(true);
    expect(isNearMiss(260, 110, [box])).toBe(false);
    expect(isNearMiss(210, 110, [box, { left: 205, top: 100, right: 300, bottom: 120 }])).toBe(false);
  });
});

describe('linkNavigates', () => {
  const here = 'https://www.allrecipes.com/recipe/10813/best/';
  const a = (href: string, target = '') => {
    const el = document.createElement('a');
    el.setAttribute('href', href);
    if (target) el.target = target;
    return el;
  };
  it('stops links that leave the page; lets #jumps and javascript: links work', () => {
    expect(linkNavigates(a('https://www.allrecipes.com/'), here)).toBe(true);
    expect(linkNavigates(a('/recipes/'), here)).toBe(true);
    expect(linkNavigates(a('mailto:x@example.com'), here)).toBe(true);
    expect(linkNavigates(a('#recipe-body', '_blank'), here)).toBe(true);
    expect(linkNavigates(a('#recipe-body'), here)).toBe(false);
    expect(linkNavigates(a('#'), here)).toBe(false);
    expect(linkNavigates(a('javascript:void(0)'), here)).toBe(false);
  });
});

describe('looksLikeAd', () => {
  it('reads ad boxes by class or id without catching headers', () => {
    for (const c of ['ad', 'ad-slot', 'adslot', 'top-ad', 'ad_feedback', 'mntl-sc-block-adslot', 'div-gpt-ad-123', 'sponsored-content', 'taboola-below'])
      expect(looksLikeAd(c)).toBe(true);
    for (const c of ['header', 'head-container', 'shadow', 'loading', 'badge', 'gradient', 'download', 'advanced-search'])
      expect(looksLikeAd(c)).toBe(false);
  });
});

describe('sameSite', () => {
  it('treats subdomains of one site as the same', () => {
    expect(sameSite('https://edition.cnn.com/', 'https://www.cnn.com/')).toBe(true);
    expect(sameSite('https://en.m.wikipedia.org/wiki/X', 'https://en.wikipedia.org/wiki/Y')).toBe(true);
    expect(sameSite('https://example.org/', 'https://www.cnn.com/')).toBe(false);
    expect(sameSite('https://a.bbc.co.uk/', 'https://www.bbc.co.uk/')).toBe(true);
    expect(sameSite('https://a.co.uk/', 'https://b.co.uk/')).toBe(false);
  });
});
