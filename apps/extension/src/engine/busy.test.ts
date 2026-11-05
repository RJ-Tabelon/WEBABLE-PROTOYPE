// Round 8, round 10: the open rule (the WebAble page by default on every reading page, busy or not).
import { describe, expect, it } from 'vitest';
import { type OpenInput, countDistractions, distractionShare, openVerdict } from './busy';

const ad = (p = 0.9) => ({ fine: 'advertising' as const, fineP: p });
const teaser = (p = 0.8) => ({ fine: 'teaser_other_content' as const, fineP: p });
const body = { fine: 'body_text' as const, fineP: 0.95, importance: 4 };

function input(over: Partial<OpenInput> = {}): OpenInput {
  return {
    purpose: { kind: 'news_index', p: 0.92 },
    mainRegion: { id: 'n4', p: 0.9 },
    elements: [body, ...Array.from({ length: 14 }, () => teaser())],
    share: 0.3,
    sensitive: false,
    meaningPass: true,
    interacted: false,
    pinned: false,
    ...over,
  };
}

describe('open rule', () => {
  it('opens on a busy reading page', () => {
    const v = openVerdict(input());
    expect(v.open).toBe(true);
    expect(v.count).toBe(14);
  });

  it('counts only the distraction family at p >= 0.7 (popup included, comments, not body text)', () => {
    expect(countDistractions([ad(0.69), ad(0.7), { fine: 'popup', fineP: 0.8 }, { fine: 'comments', fineP: 0.9 }, body, { fine: 'site_nav', fineP: 0.99 }])).toBe(3);
  });

  it('needs a reading purpose Jev is sure about', () => {
    expect(openVerdict(input({ purpose: { kind: 'news_index', p: 0.79 } })).open).toBe(false);
    // Sure it is for reading, less sure which kind (a news home page): the reading kinds together count.
    expect(openVerdict(input({ purpose: { kind: 'news_index', p: 0.64, probs: { news_index: 0.64, home_portal: 0.22, other: 0.14 } } })).open).toBe(true);
    expect(openVerdict(input({ purpose: { kind: 'news_index', p: 0.64, probs: { news_index: 0.64, product: 0.3, other: 0.06 } } })).open).toBe(false);
    expect(openVerdict(input({ purpose: { kind: 'form_task', p: 0.99 } })).open).toBe(false);
    expect(openVerdict(input({ purpose: { kind: 'product', p: 0.99 } })).open).toBe(false);
    expect(openVerdict(input({ purpose: null })).open).toBe(false);
    for (const kind of ['article', 'recipe', 'record_stats', 'scoreboard', 'schedule', 'standings', 'info_guide', 'faq', 'home_portal', 'directory_listing', 'comparison']) {
      expect(openVerdict(input({ purpose: { kind, p: 0.85 } })).open).toBe(true);
    }
  });

  it('never replaces sign-in, checkout, account or statement pages, or pages with password or payment fields', () => {
    for (const kind of ['sign_in', 'checkout', 'account_dashboard', 'bill_statement']) {
      const v = openVerdict(input({ purpose: { kind, p: 0.99 } }));
      expect(v.open).toBe(false);
      expect(v.reason).toMatch(/keep their own layout/);
    }
    expect(openVerdict(input({ sensitive: true })).open).toBe(false);
    // Read as an article, but a fair chance it is a sign-in page: keep it.
    expect(openVerdict(input({ purpose: { kind: 'article', p: 0.75, probs: { article: 0.75, sign_in: 0.25 } } })).open).toBe(false);
  });

  it('opens on a quiet reading page too (round 10: busy or not)', () => {
    const v = openVerdict(input({ elements: [body, teaser(), ad()], share: 0.04 }));
    expect(v.open).toBe(true);
    expect(v.reason).toBe('a page for reading');
    expect(v.count).toBe(2);
    expect(openVerdict(input({ elements: [body], share: 0 })).open).toBe(true);
    // A plain government guide with no distractions at all.
    expect(openVerdict(input({ purpose: { kind: 'info_guide', p: 0.93 }, elements: [body], share: 0 })).open).toBe(true);
  });

  it('keeps the distraction count and share for the log only', () => {
    const v = openVerdict(input({ share: 0.31 }));
    expect(v).toMatchObject({ open: true, count: 14, share: 0.31 });
    expect(openVerdict(input({ elements: [body, ad()], share: 0.6 })).open).toBe(true);
  });

  it('needs clear main content: a main region Jev is sure of, or an important content block', () => {
    const noBody = Array.from({ length: 14 }, () => teaser());
    expect(openVerdict(input({ mainRegion: { id: 'none', p: 0.95 }, elements: noBody })).open).toBe(false);
    expect(openVerdict(input({ mainRegion: { id: 'n4', p: 0.6 }, elements: noBody })).open).toBe(false);
    expect(openVerdict(input({ mainRegion: { id: 'n4', p: 0.6 }, elements: [{ fine: 'headline', fineP: 0.9, importance: 3 }, ...noBody] })).open).toBe(true);
    // An important-looking distraction does not count as main content.
    expect(openVerdict(input({ mainRegion: null, elements: [{ ...teaser(), importance: 3 }, ...noBody] })).open).toBe(false);
  });

  it('needs the meaning check to pass', () => {
    expect(openVerdict(input({ meaningPass: false })).open).toBe(false);
    expect(openVerdict(input({ meaningPass: null })).open).toBe(false);
  });

  it('never swaps the page once the person has started using it', () => {
    const v = openVerdict(input({ interacted: true }));
    expect(v.open).toBe(false);
    expect(v.reason).toMatch(/already started/);
  });

  it('keeps a site set to "Original page"', () => {
    expect(openVerdict(input({ pinned: true })).open).toBe(false);
  });
});

describe('distraction share', () => {
  interface Box { id: string; kids: string[] }
  const contains = (a: Box, b: Box) => a.kids.includes(b.id);
  it('counts outermost boxes once', () => {
    const outer: Box = { id: 'a', kids: ['b'] };
    const inner: Box = { id: 'b', kids: [] };
    const other: Box = { id: 'c', kids: [] };
    expect(distractionShare([[inner, 100], [outer, 300], [other, 100]], 1000, contains)).toBeCloseTo(0.4);
    expect(distractionShare([[outer, 400]], 0, contains)).toBe(0);
  });

  it('leaves out a single box bigger than 40% of the page (a container or an overlay, not a part)', () => {
    const big: Box = { id: 'a', kids: ['b'] };
    const ad: Box = { id: 'b', kids: [] };
    expect(distractionShare([[big, 900], [ad, 50]], 1000, contains)).toBeCloseTo(0.05);
    expect(distractionShare([[big, 4000]], 1000, contains)).toBe(0);
  });
});
