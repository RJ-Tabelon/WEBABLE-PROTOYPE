// Round 8 markers (ROUND8 §5): a green dot before "Live", an "Ad" tag on paid content, "N min read" on articles.
import { describe, expect, it } from 'vitest';
import { countWords, isAdItem, isLiveText, liveLabelFor, marksFrom, readMinutes, saysMinRead } from './markers';

/** A tiny element stand-in: contains() over its descendants, and its text. */
interface Fake { id: string; text: string; kids: Fake[]; contains(o: Fake): boolean }
function el(id: string, text = '', kids: Fake[] = []): Fake {
  const self: Fake = {
    id, text, kids,
    contains(o: Fake): boolean {
      return o === self || self.kids.some((k) => k.contains(o));
    },
  };
  return self;
}
const asEl = (f: Fake) => ({ ...f, textContent: f.text, contains: f.contains }) as unknown as Element;

describe('live label', () => {
  it('matches only short live labels', () => {
    for (const t of ['Live', 'LIVE', 'Live updates', 'live now', 'Watch live', ' • Live ']) expect(isLiveText(t)).toBe(true);
    for (const t of ['Live: Senate votes on the budget', 'Delivered', 'Alive', 'Live music in Gainesville', '', null]) expect(isLiveText(t)).toBe(false);
  });

  it('uses a live badge Jev found in the item', () => {
    const badge = el('b', 'LIVE');
    const card = el('c', 'LIVE Storm updates', [badge]);
    const cardEl = asEl(card);
    const badgeEl = { textContent: 'LIVE', contains: (o: unknown) => o === badgeEl } as unknown as Element;
    const marks = { live: [badgeEl], ads: [] };
    // The card element contains the badge.
    const cardWithBadge = { contains: (o: unknown) => o === badgeEl || o === cardWithBadge } as unknown as Element;
    expect(liveLabelFor(cardWithBadge, null, marks)).toBe('LIVE');
    expect(liveLabelFor(cardWithBadge, 'live', marks)).toBe('live');
    expect(liveLabelFor(cardWithBadge, 'Politics', marks)).toBeNull();
    expect(liveLabelFor(cardEl, 'Politics', { live: [], ads: [] })).toBeNull();
  });
});

describe('ad tag', () => {
  it('tags items that are, or sit inside, paid content Jev is sure about', () => {
    const story = el('s');
    const sponsored = el('sp', '', [story]);
    const other = el('o');
    const elements = [
      { id: 'sp', fine: 'sponsored' as const, fineP: 0.93 },
      { id: 'o', fine: 'advertising' as const, fineP: 0.85 },
    ];
    const byId: Record<string, Fake> = { sp: sponsored, o: other };
    const marks = marksFrom(elements, (id) => byId[id] ?? null);
    expect(marks.ads).toEqual([sponsored]);
    const m = marks as unknown as { live: Element[]; ads: Element[] };
    expect(isAdItem(story as unknown as Element, m)).toBe(true);
    expect(isAdItem(sponsored as unknown as Element, m)).toBe(true);
    expect(isAdItem(other as unknown as Element, m)).toBe(false);
  });

  it('reads Jev live badges and live answers, and its paid-as-story answer at 0.9', () => {
    const b = el('b', 'Live');
    expect(marksFrom([{ id: 'b', fine: 'live_badge', fineP: 0.8 }], () => b).live).toEqual([b]);
    expect(marksFrom([{ id: 'b', fine: 'live_badge', fineP: 0.3 }], () => b).live).toEqual([]);
    expect(marksFrom([{ id: 'b', fine: 'headline', fineP: 0.9, liveP: 0.7 }], () => b).live).toEqual([b]);
    expect(marksFrom([{ id: 'b', fine: 'headline', fineP: 0.9, paidAsStoryP: 0.93 }], () => b).ads).toEqual([b]);
    expect(marksFrom([{ id: 'b', fine: 'headline', fineP: 0.9, paidAsStoryP: 0.7 }], () => b).ads).toEqual([]);
  });
});

describe('reading time', () => {
  it('is words / 230, rounded, at least 1', () => {
    expect(readMinutes(0)).toBe(1);
    expect(readMinutes(100)).toBe(1);
    expect(readMinutes(1380)).toBe(6);
    expect(readMinutes(1500)).toBe(7);
  });

  it('counts words, not punctuation', () => {
    expect(countWords('  Hello, world — this is 4 words?  ')).toBe(6);
  });

  it('knows when the page already says it', () => {
    for (const t of ['6 min read', 'By Jane Doe · 4 minute read', '12 mins read', 'Min read']) expect(saysMinRead(t)).toBe(true);
    for (const t of ['Read more', 'Minimum reading age', 'We read 6 minutes ago']) expect(saysMinRead(t)).toBe(false);
  });
});
