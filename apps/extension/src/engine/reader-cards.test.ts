// @vitest-environment happy-dom
// An article body is prose, not a card list: AP's paragraphs (most with an inline link) were read as "cards x 24", so
// Jev called the whole article "recommendations" and the simplified page folded it into the end drawer.
import { describe, expect, it } from 'vitest';
import { repeatedCards } from './reader';

function box(html: string): Element {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

const sentence = (i: number) =>
  `<p>Paragraph ${i} of the story goes on for a while about the mission and links <a href="/x${i}">one word</a> in the middle of it.</p>`;

describe('repeatedCards', () => {
  it('a run of paragraphs with inline links is prose, not cards', () => {
    expect(repeatedCards(box(Array.from({ length: 12 }, (_, i) => sentence(i)).join('')))).toBe(0);
  });

  it('repeated blocks whose only link is a word inside a sentence are not cards', () => {
    const html = Array.from({ length: 8 }, (_, i) => `<div class="para">${sentence(i).slice(3, -4)}</div>`).join('');
    expect(repeatedCards(box(html))).toBe(0);
  });

  it('teasers titled by a link are cards', () => {
    const html = Array.from({ length: 6 }, (_, i) => `<div class="card"><a href="/s${i}">Story headline number ${i}</a><span>2h ago</span></div>`).join('');
    expect(repeatedCards(box(html))).toBe(6);
  });

  it('blocks titled by a heading are cards', () => {
    const html = Array.from({ length: 5 }, (_, i) => `<article class="tile"><h3>Title ${i}</h3><p>A short summary of item ${i} that runs on for a little while.</p></article>`).join('');
    expect(repeatedCards(box(html))).toBe(5);
  });
});
