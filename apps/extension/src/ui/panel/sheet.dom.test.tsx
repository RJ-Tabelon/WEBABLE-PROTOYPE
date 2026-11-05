// @vitest-environment happy-dom
// Round 9 in the sheet: one row under "What WebAble did here" for paragraphs rewritten for the person, with one switch
// back to the page's own words. Plain words only.
import { render } from 'preact';
import { DEFAULT_SETTINGS } from '@webable/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineApi, EngineState } from '../../contracts';
import { Sheet } from './Sheet';

afterEach(() => {
  document.body.innerHTML = '';
});

const item = (id: string, state: 'rewritten' | 'kept') => ({
  id, need: 0.8, how: { keep: 0.2, plain: 0.8, list: 0, shorter: 0, point_first: 0 }, pick: state === 'kept' ? null : ('plain' as const), state, snippet: 'The IRS',
});

function state(reword: EngineState['reword']): EngineState {
  return {
    phase: 'understood', fit: null, settings: { ...DEFAULT_SETTINGS }, startedAt: 0, digest: null, outline: null, ops: [], checks: [], ledger: [],
    understanding: { elements: [], mainPick: { id: 'none', p: 0, probs: {} }, metrics: {} as never, cached: false }, decisions: [], lens: { on: false },
    calm: { open: false, loading: false, spec: null, source: null, aiReady: false, redesign: null, visual: null },
    struggle: { latest: null, history: [], waiting: [], offers: [] }, toasts: [],
    showingOriginal: false, overlays: [], ai: 'on', column: { on: false, widthPx: null, minPx: 720, maxPx: 1600 }, textStep: 0, pageZoom: 1,
    passive: null, reword,
  } as EngineState;
}

function mount(s: EngineState, api: Partial<EngineApi>): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  render(
    <Sheet api={api as EngineApi} s={s} origin="https://www.irs.gov" side="right" maxHeightPx={800} pageZoom={1} gone={new Set()} onGone={() => {}} note={null} onClose={() => {}} />,
    host,
  );
  return host;
}

describe('the sheet row for rewritten paragraphs', () => {
  it('counts them in plain words and switches every one back to the page’s own words', () => {
    const showOriginalWords = vi.fn();
    const host = mount(
      state({ status: 'done', source: 'ChatGPT', items: [item('w1', 'rewritten'), item('w2', 'rewritten'), item('w3', 'kept')], showingOriginal: false, version: 2 }),
      { showOriginalWords },
    );
    const text = host.querySelector('.wa-did-list')!.textContent!;
    expect(text).toContain('2 paragraphs rewritten the way you like');
    expect(host.textContent).not.toMatch(/reword|profile|score|probabilit|confidence|calibrat/i);
    expect(host.textContent).not.toContain('Nothing needed changing here.');
    const sw = host.querySelector<HTMLButtonElement>('.wa-did-switch')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.textContent).toBe("Show the page's own words");
    sw.click();
    expect(showOriginalWords).toHaveBeenCalledWith(true);
  });

  it('says it is working while the paragraphs are being read, with no switch yet', () => {
    const host = mount(state({ status: 'scoring', source: 'ChatGPT', items: [], showingOriginal: false, version: 1 }), {});
    expect(host.textContent).toContain('Making hard paragraphs easier…');
    expect(host.querySelector('.wa-did-switch')).toBeNull();
  });

  it('has no row when nothing was rewritten', () => {
    const host = mount(state({ status: 'none', source: 'ChatGPT', items: [item('w1', 'kept')], showingOriginal: false, version: 1 }), {});
    expect(host.querySelector('.wa-did-rw')).toBeNull();
    expect(host.textContent).toContain('Nothing needed changing here.');
  });
});
