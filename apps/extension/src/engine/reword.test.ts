// @vitest-environment happy-dom
// Round 9: paragraphs fitted to the person. Collecting (filters and ⟦n⟧ markers), swapping in place and back exactly,
// rewordFor, code's own checks, and the rule that never changes what the person is reading.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BgRequest, ReaderProfile, RewordOut, RewordScoreResult, RewordWriteResult } from '@webable/core';
import type { EngineState } from '../contracts';
import {
  APPLY_ANYWAY_MS, MAX_PICKS, canSwapNow, checkOut, collectParagraphs, createReword, numbersIn, orderPicks, pieces,
  type RewordHost, type RewordSummary,
} from './reword';

const LONG =
  'If you filed your tax return electronically, most refunds are issued in less than 21 days, but some returns need more review and may take longer than that to process fully.';
const PLAIN =
  'The agency checks every return for mistakes and missing forms before it sends the money, which is why some people wait a little longer than their friends or family members.';
const LEAF45 = `${LONG} Paper returns can take six weeks or more from the date we receive them, and checking often will not speed it up.`;

const all = () => true;

function page(html: string, lang = 'en'): void {
  document.documentElement.setAttribute('lang', lang);
  document.body.innerHTML = html;
}

const jev = { model: 'jev', calls: 1, questions: 2, inputTokens: 10, wallMs: 300, serverMs: 200, costUsd: 0.001 };
const reader: ReaderProfile = {
  v: 'reader.1', createdAt: '2026-10-25T00:00:00Z', source: 'ChatGPT', headline: 'Short answers and plain words for money.',
  points: [{ id: 'r1', kind: 'new_to', says: 'Money and tax words are new to you.', evidence: 'explain like I am new to taxes', support: 0.93, on: true }],
  level: 'plain', length: 'shorter', shape: 'steps', answerFirst: true,
};

describe('collectParagraphs', () => {
  beforeEach(() => page(''));

  it('keeps reading paragraphs, turns links into ⟦n⟧ markers and keeps the anchors', () => {
    page(`<main><p id="a">Check <a href="/refunds/wmr">Where’s My Refund</a> once a day. ${LONG} See <a href="/faq">the questions</a>.</p></main>`);
    const got = collectParagraphs({ visible: all });
    expect(got).toHaveLength(1);
    expect(got[0]!.id).toBe('w1');
    expect(got[0]!.text).toMatch(/^Check ⟦1⟧ once a day\. If you filed/);
    expect(got[0]!.text).toMatch(/See ⟦2⟧\.$/);
    expect(got[0]!.plain).toContain('Where’s My Refund once a day');
    expect(got[0]!.links.map((a) => a.getAttribute('href'))).toEqual(['/refunds/wmr', '/faq']);
    expect(got[0]!.links[0]).toBe(document.querySelector('#a a'));
  });

  it('leaves out short text, navigation, forms, pictures, controls and link lists', () => {
    page(`
      <p>Too short to matter.</p>
      <nav><p>${LONG}</p></nav>
      <header><p>${LONG}</p></header>
      <form><p>${LONG}</p></form>
      <div role="navigation"><p>${LONG}</p></div>
      <p>${LONG} <img src="x.png" alt=""></p>
      <p>${LONG} <button>Go</button></p>
      <p><a href="/1">${LONG}</a> and a few more words here.</p>
      <div contenteditable="true"><p>${LONG}</p></div>
      <div role="dialog"><p>${LONG}</p></div>
      <div style="position: fixed; bottom: 0"><p>${LONG}</p></div>
      <p id="short">Refund delays can happen when a tax return needs corrections or extra review.</p>
      <p id="ok"><strong>Note:</strong> ${LONG}</p>
    `);
    const got = collectParagraphs({ visible: all });
    expect(got.map((c) => c.el.id)).toEqual(['short', 'ok']);
  });

  it('takes div blocks of inline text only when they are long enough, never containers', () => {
    page(`<div id="leaf">${LEAF45}</div><div id="short">${LONG}</div><div id="box"><p id="inner">${LONG}</p></div>`);
    const got = collectParagraphs({ visible: all });
    expect(got.map((c) => c.el.id)).toEqual(['leaf', 'inner']);
  });

  it('runs on English pages only, caps at 40 and numbers ids from firstId', () => {
    page(`<p>${LONG}</p>`, 'fr');
    expect(collectParagraphs({ visible: all })).toEqual([]);
    page(Array.from({ length: 50 }, () => `<p>${LONG}</p>`).join(''), 'en-US');
    const got = collectParagraphs({ visible: all, firstId: 7 });
    expect(got).toHaveLength(40);
    expect(got[0]!.id).toBe('w7');
    expect(got[39]!.id).toBe('w46');
  });

  it('skips paragraphs that are not visible', () => {
    page(`<p id="a">${LONG}</p><p id="b">${LONG}</p>`);
    const got = collectParagraphs({ visible: (el) => el.id === 'b' });
    expect(got.map((c) => c.el.id)).toEqual(['b']);
  });
});

describe('pure rules', () => {
  it('changes a visible paragraph only early and before the person starts', () => {
    expect(canSwapNow({ sinceStartMs: 1500, interacted: false, onScreen: true, calmOpen: false })).toBe(true);
    expect(canSwapNow({ sinceStartMs: APPLY_ANYWAY_MS + 1, interacted: false, onScreen: true, calmOpen: false })).toBe(false);
    expect(canSwapNow({ sinceStartMs: 500, interacted: true, onScreen: true, calmOpen: false })).toBe(false);
    expect(canSwapNow({ sinceStartMs: 9000, interacted: true, onScreen: false, calmOpen: false })).toBe(true);
    expect(canSwapNow({ sinceStartMs: 9000, interacted: true, onScreen: false, calmOpen: true })).toBe(false);
    expect(canSwapNow({ sinceStartMs: 1000, interacted: false, onScreen: true, calmOpen: true })).toBe(true);
  });

  it('writes first-screen picks first, nearest the top, then document order, at most MAX_PICKS', () => {
    const at = (idx: number, top: number) => ({ idx, top, bottom: top + 80 });
    const got = orderPicks([at(0, -500), at(1, 400), at(2, 100), at(3, 1500), at(4, 2400)], 900);
    expect(got.map((x) => x.idx)).toEqual([2, 1, 0, 3, 4]);
    expect(orderPicks(Array.from({ length: 30 }, (_, i) => at(i, 2000 + i)), 900)).toHaveLength(MAX_PICKS);
  });

  it('checks links and numbers before anything touches the page', () => {
    const orig = 'Most refunds come in 21 days. Use ⟦1⟧ to check, or call 800-829-1040 about ⟦2⟧.';
    const out = (lead: string, items: string[] = []): RewordOut => ({ lead, items, ordered: false });
    expect(checkOut(out('Use ⟦1⟧ to check. Most come in 21 days.', ['Call 800-829-1040 about ⟦2⟧.']), 2, orig)).toBeNull();
    expect(checkOut(out('Use ⟦1⟧ to check. Most come in 21 days. Call 800-829-1040.'), 2, orig)).toBe('links');
    expect(checkOut(out('Use ⟦1⟧ and ⟦1⟧ to check in 21 days, 800-829-1040 about ⟦2⟧.'), 2, orig)).toBe('links');
    expect(checkOut(out('Use ⟦1⟧ to check. Most come in three weeks. Call 800-829-1040 about ⟦2⟧.'), 2, orig)).toBe('numbers');
    expect(checkOut(out('⟦1⟧ ⟦2⟧'), 2, orig)).toBe('empty');
    expect(numbersIn('$1,500.00 in 2026')).toEqual(['1500', '2026']);
    expect(pieces('a ⟦1⟧ b⟦2⟧')).toEqual(['a ', 1, ' b', 2]);
  });
});

describe('the runner', () => {
  let state: NonNullable<EngineState['reword']> | null;
  let summaries: RewordSummary[];
  let writes: Record<string, RewordOut>;
  let picks: Record<string, 'plain' | 'list' | null>;
  let layoutOk: (el: HTMLElement) => boolean;

  const html = () => `
    <main>
      <p id="p1">Check <a href="/wmr" class="x">Where’s My Refund</a> once a day. ${LONG}</p>
      <p id="p2">You need your Social Security number, your filing status and the exact refund amount. ${PLAIN}</p>
      <p id="p3">${LONG} This one stays as it is.</p>
    </main>`;

  function host(over: Partial<RewordHost> = {}): RewordHost {
    return {
      ask: async <T,>(req: BgRequest): Promise<T> => {
        if (req.type === 'getReader') return reader as T;
        if (req.type === 'rewordScore') {
          const res: RewordScoreResult = {
            scores: req.req.paras.map((p) => ({
              id: p.id, need: picks[p.id] ? 0.91 : 0.12,
              how: { keep: picks[p.id] ? 0.05 : 0.88, plain: picks[p.id] === 'plain' ? 0.8 : 0.03, list: picks[p.id] === 'list' ? 0.85 : 0.03, shorter: 0.02, point_first: 0.02 },
              pick: picks[p.id] ?? null,
            })),
            jev, ms: 300,
          };
          return res as T;
        }
        if (req.type === 'rewordWrite') {
          const res: RewordWriteResult = {
            results: req.req.items.map((it) => ({
              id: it.id, kind: it.kind, ok: true, out: writes[it.id] ?? null,
              checks: { numbersKept: true, conditionWordsKept: true, linksKept: true, dropped: 0.05, added: 0.04 },
            })),
            model: 'gpt-5.4-mini', ms: 1200, jev,
          };
          return res as T;
        }
        throw new Error(`unexpected ${req.type}`);
      },
      isOurs: () => false,
      sensitive: () => false,
      purpose: () => 'government_info',
      calmOpen: () => false,
      reducedMotion: () => true,
      publish: (s) => {
        state = s;
      },
      log: () => undefined,
      finished: (s) => summaries.push(s),
      visible: all,
      layoutOk: (el) => layoutOk(el),
      ...over,
    };
  }

  beforeEach(() => {
    page(html());
    state = null;
    summaries = [];
    layoutOk = () => true;
    picks = { w1: 'plain', w2: 'list' };
    writes = {
      w1: { lead: 'Use ⟦1⟧ once a day to see your refund. Most e-filed refunds come in under 21 days; some take longer.', items: [], ordered: false },
      w2: { lead: 'You need three things:', items: ['your Social Security number', 'your filing status', 'the exact refund amount'], ordered: false },
    };
  });

  afterEach(() => vi.restoreAllMocks());

  it('swaps the picked paragraphs in place, with the mark, clones of the page’s links and a real list', async () => {
    const p1 = document.getElementById('p1')!;
    const p2 = document.getElementById('p2')!;
    const before1 = p1.innerHTML;
    const anchor = p1.querySelector('a')!;
    const r = createReword(host());
    await r.start();

    expect(p1.getAttribute('data-wa-rw')).toBe('w1');
    expect(p1.textContent).toBe('Use Where’s My Refund once a day to see your refund. Most e-filed refunds come in under 21 days; some take longer.');
    const clone = p1.querySelector('a')!;
    expect(clone).not.toBe(anchor);
    expect(clone.getAttribute('href')).toBe('/wmr');
    expect(clone.className).toBe('x');
    const mark = p1.querySelector('[data-wa-rw-mark]')!;
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.getAttribute('title')).toBe('Rewritten for you by WebAble. Click to see the original.');

    const list = p2.querySelector('ul')!;
    expect(list.querySelectorAll('li')).toHaveLength(3);
    expect(list.style.getPropertyValue('list-style-type')).toBe('disc');
    expect(list.style.getPropertyPriority('list-style-type')).toBe('important');
    expect(document.getElementById('p3')!.hasAttribute('data-wa-rw')).toBe(false);

    expect(state!.status).toBe('done');
    expect(state!.source).toBe('ChatGPT');
    expect(state!.items.map((i) => [i.id, i.state])).toEqual([['w1', 'rewritten'], ['w2', 'rewritten'], ['w3', 'kept']]);
    expect(state!.items[0]!.need).toBeCloseTo(0.91);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ source: 'ChatGPT', looked: 3, picked: 2, changed: 2, failed: 0 });
    expect(r.ownsOp(summaries[0]!.opId)).toBe(true);
    expect(r.elementFor('w2')).toBe(p2);

    // Back to the page's own nodes, exactly.
    r.reset();
    expect(p1.innerHTML).toBe(before1);
    expect(p1.querySelector('a')).toBe(anchor);
    expect(p1.hasAttribute('data-wa-rw')).toBe(false);
    expect(state!.status).toBe('off');
  });

  it('flips one paragraph to the page’s own words and back, and rewordFor follows', async () => {
    const p1 = document.getElementById('p1')!;
    const origNodes = Array.from(p1.childNodes);
    const r = createReword(host());
    await r.start();

    const clone = p1.querySelector('a')!;
    const view = r.rewordFor(clone.firstChild!)!;
    expect(view).toMatchObject({ id: 'w1', kind: 'plain', showing: 'new', ordered: false, items: [] });
    const link = view.lead.find((x) => x.t === 'link');
    expect(link && link.t === 'link' && link.el).toBe(clone);
    expect(link && link.t === 'link' && link.href).toBe('/wmr');
    expect(r.rewordFor(document.getElementById('p3')!)).toBeNull();

    const v0 = state!.version;
    r.toggleParagraph('w1');
    expect(Array.from(p1.childNodes).slice(0, -1)).toEqual(origNodes);
    const mark = p1.lastChild as HTMLElement;
    expect(mark.getAttribute('data-showing')).toBe('original');
    expect(mark.title).toBe('The page’s own words. Click to see WebAble’s version.');
    expect(r.rewordFor(p1)!.showing).toBe('original');
    expect(state!.items[0]!.state).toBe('original');
    expect(state!.version).toBeGreaterThan(v0);

    // Clicking the mark flips it back.
    mark.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(p1.querySelector('a')).toBe(clone);
    expect(r.rewordFor(p1)!.showing).toBe('new');

    // Every paragraph to the page's own words (Undo), then the untouched page ("Original page").
    r.showOriginalWords(true);
    expect(state!.showingOriginal).toBe(true);
    expect(document.querySelectorAll('[data-wa-rw-mark][data-showing="original"]')).toHaveLength(2);
    r.pageOriginal(true);
    expect(document.querySelectorAll('[data-wa-rw], [data-wa-rw-mark]')).toHaveLength(0);
    expect(Array.from(p1.childNodes)).toEqual(origNodes);
    expect(r.rewordFor(p1)).toBeNull();
    r.pageOriginal(false);
    expect(p1.getAttribute('data-wa-rw')).toBe('w1');
    r.showOriginalWords(false);
    expect(p1.querySelector('a')).toBe(clone);
  });

  it('keeps the page’s own words when a rewrite drops a link or a number, or does not fit', async () => {
    picks = { w1: 'plain', w2: 'list', w3: 'plain' };
    writes.w1 = { lead: 'Check once a day. Most e-filed refunds come in under 21 days.', items: [], ordered: false };
    writes.w3 = { lead: 'E-filed refunds usually come in about three weeks; some take longer.', items: [], ordered: false };
    const p2 = document.getElementById('p2')!;
    const before2 = p2.innerHTML;
    layoutOk = (el) => el.id !== 'p2';
    const r = createReword(host());
    await r.start();
    const items = Object.fromEntries(state!.items.map((i) => [i.id, i]));
    expect(items.w1).toMatchObject({ state: 'failed', reason: 'links' });
    expect(items.w2).toMatchObject({ state: 'failed', reason: 'layout' });
    expect(items.w3).toMatchObject({ state: 'failed', reason: 'numbers' });
    expect(p2.innerHTML).toBe(before2);
    expect(document.querySelectorAll('[data-wa-rw]')).toHaveLength(0);
    expect(summaries[0]).toMatchObject({ picked: 3, changed: 0, failed: 3 });
    expect(state!.status).toBe('none');
  });

  it('waits for a visible paragraph to leave the screen once the first moments have passed', async () => {
    const t0 = performance.now();
    let t = t0;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const p1 = document.getElementById('p1')!;
    vi.spyOn(p1, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 200, left: 40, right: 700, width: 660, height: 100, x: 40, y: 100, toJSON: () => ({}) });
    const r = createReword(host({
      ask: async <T,>(req: BgRequest): Promise<T> => {
        if (req.type === 'rewordWrite') t = t0 + APPLY_ANYWAY_MS + 500;
        return host().ask<T>(req);
      },
    }));
    await r.start();
    expect(p1.hasAttribute('data-wa-rw')).toBe(false);
    expect(state!.items.find((i) => i.id === 'w1')!.state).toBe('waiting');
    // Off screen (zero box in this DOM): changes right away.
    expect(document.getElementById('p2')!.getAttribute('data-wa-rw')).toBe('w2');
    expect(summaries[0]).toMatchObject({ changed: 2 });
  });

  it('stays off without an AI answer, on sensitive pages and on short pages', async () => {
    const off = async (over: Partial<RewordHost>) => {
      const r = createReword(host(over));
      await r.start();
      return state!.status;
    };
    expect(await off({ ask: async <T,>() => null as T })).toBe('off');
    expect(await off({ sensitive: () => true })).toBe('off');
    page(`<p>${LONG}</p>`);
    expect(await off({})).toBe('off');
    expect(document.querySelectorAll('[data-wa-rw]')).toHaveLength(0);
  });

  it('says one plain line when the server is unreachable and leaves the page alone', async () => {
    const lines: string[] = [];
    const r = createReword(host({
      ask: async <T,>(req: BgRequest): Promise<T> => {
        if (req.type === 'getReader') return reader as T;
        throw new Error('The WebAble server on this computer could not be reached.');
      },
      log: (e) => lines.push(e.title),
    }));
    await r.start();
    expect(state!.status).toBe('error');
    expect(lines).toEqual(['Couldn’t rewrite paragraphs for you right now; the page keeps its own words']);
    expect(document.querySelectorAll('[data-wa-rw]')).toHaveLength(0);
  });
});
