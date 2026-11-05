// Owner: P. The sheet's words: plain lines from the kind of change and a count, the states, and the text size.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ElementDecision, type OpRecord, type OverlayAction } from '@webable/core';
import type { EngineState } from '../../contracts';
import { pausedList } from './actions';
import { changedHere, didLines, movedPopups, pageUnread, rewordLine, sheetMode, sizeWord, showViewSwitch, shownTextPx, siteName, UNREAD } from './model';

const op = (id: string, kind: OpRecord['kind'], targets = 0, status: OpRecord['status'] = 'applied'): OpRecord => ({
  id,
  kind,
  scope: 'page',
  targetIds: Array.from({ length: targets }, (_, i) => `${id}-t${i}`),
  status,
  reason: 'zoom 150% (own 100%) for body 21 px, Jev 0.97',
});

const base = { ops: [] as OpRecord[], overlays: [] as OverlayAction[], decisions: [] as ElementDecision[], pageZoom: 1.5, textZoom: 1.5 };

/** Words the sheet must never say (engineering words and the old feature names). */
const BANNED = /\b(jev|lens|calm view|probabilit|score|result|calibrat|profile|fold|digest|op\b|ops\b|confidence|p\s?\d)/i;

describe('what WebAble did here', () => {
  it('says each kind of change once, in plain words, most noticeable first', () => {
    const lines = didLines({
      ...base,
      ops: [op('a', 'targets'), op('b', 'page_zoom'), op('c', 'heading_scale'), op('d', 'contrast'), op('e', 'steady_clicks'), op('f', 'debounce')],
    });
    expect(lines.map((l) => l.text)).toEqual(['Made the text bigger', 'Made faint text darker', 'Made buttons easier to hit', 'Kept your clicks steady']);
    // Undo takes back every change behind a line.
    expect(lines[0]!.action).toEqual({ kind: 'undo', opIds: ['b', 'c'] });
    expect(lines[3]!.action).toEqual({ kind: 'undo', opIds: ['e', 'f'] });
    for (const l of lines) expect(l.text).not.toMatch(BANNED);
  });

  it('counts faded ads and paused slideshows, and never parses engine titles', () => {
    const ads: ElementDecision[] = ['g-t0', 'g-t1', 'g-t2'].map((id) => ({ id, verdict: 'fold', reasons: [], judgment: { role: 'advertising' } as ElementDecision['judgment'] }));
    const lines = didLines({ ...base, decisions: ads, ops: [op('g', 'dim', 3), op('h', 'motion', 1)] });
    expect(lines.map((l) => l.text)).toEqual(['Faded 3 ads', 'Paused a moving slideshow']);
    const mixed = didLines({ ...base, ops: [op('g', 'dim', 6), op('h', 'motion', 2)] });
    expect(mixed.map((l) => l.text)).toEqual(['Faded 6 ads and promotions', 'Paused 2 moving slideshows']);
  });

  it('lists a moved pop-up with "Show it", and skips ones already brought back', () => {
    const overlays: OverlayAction[] = [
      { id: 'n9', kind: 'survey', action: 'tucked', coverageBefore: 0.3, coverageAfter: 0, opId: 'u1', detail: '' },
      { id: 'n10', kind: 'consent', action: 'docked', coverageBefore: 0.3, coverageAfter: 0.05, detail: '' },
    ];
    const s = { ...base, overlays, ops: [op('u1', 'unobstruct')] };
    const lines = didLines(s);
    expect(lines).toEqual([{ key: 'popups', icon: 'popup', text: 'Moved a survey out of the way', action: { kind: 'show', overlayIds: ['n9'] } }]);
    expect(movedPopups(s, new Set(['n9']))).toEqual([]);
    expect(movedPopups({ ...s, ops: [op('u1', 'unobstruct', 0, 'reversed')] })).toEqual([]);
  });

  it('leaves out undone changes, keeps at most five lines, and is empty when nothing changed', () => {
    expect(didLines({ ...base, ops: [op('a', 'targets', 0, 'reversed')] })).toEqual([]);
    const many = didLines({
      ...base,
      ops: [op('1', 'page_zoom'), op('2', 'contrast'), op('3', 'targets'), op('4', 'dim', 2), op('5', 'motion'), op('6', 'steady_clicks'), op('7', 'focus_ring')],
    });
    expect(many).toHaveLength(5);
    expect(many.at(-1)!.text).toBe('Paused moving things');
  });

  it('says smaller when the person made text smaller than the page', () => {
    expect(didLines({ ...base, pageZoom: 0.9, textZoom: 0.9, ops: [op('a', 'page_zoom')] })[0]!.text).toBe('Made the text smaller');
  });
});

describe('the sheet and the button', () => {
  const settings = { ...DEFAULT_SETTINGS, pausedOrigins: ['https://cvs.com'] };
  it('knows when it is on, paused, off or showing the original page', () => {
    expect(sheetMode({ settings, showingOriginal: false }, 'https://cnn.com')).toBe('on');
    expect(sheetMode({ settings, showingOriginal: false }, 'https://cvs.com')).toBe('paused');
    expect(sheetMode({ settings: { ...settings, enabled: false }, showingOriginal: false }, 'https://cnn.com')).toBe('off');
    expect(sheetMode({ settings, showingOriginal: true }, 'https://cnn.com')).toBe('original');
  });
  it('turns the ring green only when something on the page changed', () => {
    const calm = { open: false } as EngineState['calm'];
    expect(changedHere({ ops: [], calm, showingOriginal: false })).toBe(false);
    expect(changedHere({ ops: [op('a', 'targets')], calm, showingOriginal: false })).toBe(true);
    expect(changedHere({ ops: [op('a', 'targets', 0, 'reversed')], calm, showingOriginal: false })).toBe(false);
    expect(changedHere({ ops: [], calm: { ...calm, open: true }, showingOriginal: false })).toBe(true);
    expect(changedHere({ ops: [op('a', 'targets')], calm, showingOriginal: true })).toBe(false);
  });
  it('shows Simplified | Original only where the simplified page is in use', () => {
    const calm = { open: false } as EngineState['calm'];
    expect(showViewSwitch(calm)).toBe(false);
    expect(showViewSwitch({ ...calm, open: true })).toBe(true);
    expect(showViewSwitch({ ...calm, auto: true })).toBe(true);
    expect(showViewSwitch(undefined)).toBe(false);
  });
  it('knows when the page could not be read', () => {
    expect(pageUnread({ phase: 'error', ledger: [], understanding: null })).toBe(true);
    expect(pageUnread({ phase: 'tailored', ledger: [{ at: 1, source: 'jev', title: UNREAD }], understanding: null })).toBe(true);
    expect(pageUnread({ phase: 'tailored', ledger: [], understanding: null })).toBe(false);
  });
  it('names the text size in words as the person sees it, never in px', () => {
    const calm = { open: false, textStep: 0 } as EngineState['calm'];
    expect(sizeWord(shownTextPx({ calm, fit: null, pageZoom: 1.5, textZoom: 1.5 }, 1.5, 14))).toBe('Large'); // 21
    const fit = { text: { bodyPx: 20 } } as EngineState['fit'];
    expect(sizeWord(shownTextPx({ calm: { ...calm, open: true, textStep: 2 }, fit, pageZoom: 1, textZoom: 1 }, 1, null))).toBe('Largest'); // 26, nearer 28 than 24 by ratio
    expect(sizeWord(shownTextPx({ calm, fit, pageZoom: 1, textZoom: 1 }, 1, null))).toBe('');
    expect(sizeWord(15)).toBe('Standard');
    expect(sizeWord(16)).toBe('Standard');
    expect(sizeWord(18)).toBe('Larger');
    expect(sizeWord(40)).toBe('Largest');
    for (const px of [12, 16, 19, 22, 26, 30]) expect(sizeWord(px)).not.toMatch(/px|\d/);
  });
  it('names the site and pauses it without touching other sites', () => {
    expect(siteName('https://www.nytimes.com')).toBe('nytimes.com');
    expect(siteName('')).toBe('');
    expect(pausedList(['https://a.com'], 'https://b.com', true)).toEqual(['https://a.com', 'https://b.com']);
    expect(pausedList(['https://a.com', 'https://b.com'], 'https://b.com', false)).toEqual(['https://a.com']);
    expect(pausedList(['https://b.com'], 'https://b.com', true)).toEqual(['https://b.com']);
  });
});

describe('paragraphs rewritten for the person', () => {
  const item = (id: string, state: NonNullable<EngineState['reword']>['items'][number]['state']) => ({
    id, need: 0.8, how: { keep: 0.1, plain: 0.7, list: 0.1, shorter: 0.05, point_first: 0.05 }, pick: 'plain' as const, state, snippet: 'The IRS',
  });
  const rw = (status: NonNullable<EngineState['reword']>['status'], states: Array<Parameters<typeof item>[1]>, showingOriginal = false): EngineState['reword'] => ({
    status, source: 'ChatGPT', items: states.map((st, i) => item(`w${i}`, st)), showingOriginal, version: 1,
  });

  it('says how many paragraphs were rewritten, in plain words, with the switch back', () => {
    expect(rewordLine(rw('done', ['rewritten', 'rewritten', 'kept', 'failed', 'original']))).toEqual({
      text: '3 paragraphs rewritten the way you like', busy: false, count: 3, showingOriginal: false,
    });
    expect(rewordLine(rw('done', ['rewritten']))?.text).toBe('1 paragraph rewritten the way you like');
    expect(rewordLine(rw('done', ['rewritten'], true))?.showingOriginal).toBe(true);
    for (const st of ['scoring', 'writing'] as const) {
      const l = rewordLine(rw(st, []));
      expect(l).toEqual({ text: 'Making hard paragraphs easier…', busy: true, count: 0, showingOriginal: false });
      expect(l!.text).not.toMatch(BANNED);
      expect(l!.text).not.toMatch(/reword/i);
    }
    expect(rewordLine(rw('done', ['rewritten', 'rewritten']))!.text).not.toMatch(BANNED);
  });

  it('says nothing when nothing was rewritten or WebAble is not doing this here', () => {
    expect(rewordLine(undefined)).toBeNull();
    expect(rewordLine(rw('off', []))).toBeNull();
    expect(rewordLine(rw('none', ['kept', 'kept']))).toBeNull();
    expect(rewordLine(rw('done', ['failed']))).toBeNull();
  });

  it('turns the button green while rewritten paragraphs are showing', () => {
    const quiet = { ops: [] as OpRecord[], calm: { open: false } as EngineState['calm'], showingOriginal: false };
    expect(changedHere(quiet)).toBe(false);
    expect(changedHere({ ...quiet, reword: rw('done', ['rewritten']) })).toBe(true);
    expect(changedHere({ ...quiet, reword: rw('done', ['rewritten'], true) })).toBe(false);
    expect(changedHere({ ...quiet, reword: rw('done', ['kept']) })).toBe(false);
  });
});
