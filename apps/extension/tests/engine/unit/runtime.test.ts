import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ContentAdapter,
  isWorkerMessage,
  type Transport,
} from '../../../lib/engine/adapter';
import {
  controlName,
  repeatedCards,
  safeVocab,
  vocabPhrase,
} from '../../../lib/engine/extract/evidence';
import {
  DEFAULT_FRICTION,
  FrictionDetector,
  type FrictionSignal,
} from '../../../lib/engine/runtime/friction';
import { MutationScheduler } from '../../../lib/engine/runtime/mutations';
import { fallbackVocab } from '../harness/vocab-fallback';

describe('friction detector', () => {
  let got: FrictionSignal[];
  let d: FrictionDetector;
  beforeEach(() => {
    got = [];
    d = new FrictionDetector((s) => got.push(s));
  });

  it('raises a misclick burst after two near-misses within a minute', () => {
    expect(d.misclick(0)).toBe(false);
    expect(d.misclick(30_000)).toBe(true);
    expect(got).toEqual(['misclick_burst']);
  });

  it('forgets misses outside the window', () => {
    d.misclick(0);
    expect(d.misclick(61_000)).toBe(false);
  });

  it('raises a rage click for three quick clicks in one spot, not spread clicks', () => {
    d.click(100, 100, 0);
    d.click(300, 100, 100);
    d.click(101, 99, 200);
    expect(got).toEqual([]);
    d.click(100, 101, 300);
    expect(got).toEqual(['rage_click']);
  });

  it('counts short scroll reversals over the same lines', () => {
    const vh = 800;
    let t = 0;
    const seq = [0, 200, 100, 200, 100, 200, 100];
    for (const y of seq) d.scroll(y, vh, (t += 500));
    expect(got).toEqual(['scroll_reversal']);
  });

  it('ignores long scrolls in one direction', () => {
    for (let y = 0, t = 0; y < 5000; y += 400, t += 200) d.scroll(y, 800, t);
    expect(got).toEqual([]);
  });

  it('respects the cooldown and the per-page cap', () => {
    expect(d.zoomIn(0)).toBe(true);
    expect(d.zoomIn(10_000)).toBe(false);
    expect(d.zoomIn(DEFAULT_FRICTION.cooldownMs + 1)).toBe(true);
    expect(d.zoomIn(3 * DEFAULT_FRICTION.cooldownMs)).toBe(false);
    expect(got).toEqual(['zoom_in', 'zoom_in']);
  });
});

describe('evidence helpers', () => {
  it('fail closed when the vocabulary throws', () => {
    const throwing = {
      vocabFilter: () => {
        throw new Error('not implemented');
      },
    };
    expect(safeVocab(throwing, 'Related stories', 6)).toEqual([]);
    expect(vocabPhrase(throwing, 'Related stories', 6)).toBe('');
  });

  it('re-check every word the vocabulary returns', () => {
    const sloppy = {
      vocabFilter: () => ['related', 'Caden Smith', '·', '·', 'news', 'x'],
    };
    expect(safeVocab(sloppy, 'anything', 6)).toEqual(['related', '·', 'news']);
  });

  it('cap words, not dots', () => {
    const port = { vocabFilter: fallbackVocab };
    expect(vocabPhrase(port, 'Welcome back Caden, related news', 6)).toBe(
      '· related news',
    );
  });

  it('never read the value of a text field', () => {
    document.body.innerHTML =
      '<input id="t" type="email" value="private@example.com"><input id="s" type="submit" value="Subscribe">' +
      '<button id="b" aria-label="Close banner">x</button>';
    expect(controlName(document.getElementById('t') as Element)).toBe('');
    expect(controlName(document.getElementById('s') as Element)).toBe(
      'Subscribe',
    );
    expect(controlName(document.getElementById('b') as Element)).toBe(
      'Close banner',
    );
  });

  it('count repeated sibling cards', () => {
    document.body.innerHTML = `<ul id="u">${'<li class="card"><a href="/x">x</a></li>'.repeat(5)}</ul>`;
    expect(repeatedCards(document.getElementById('u') as Element)).toBe(5);
  });
});

describe('mutation scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const rec = (nodes: Node[]): MutationRecord =>
    ({
      addedNodes: nodes as unknown as NodeList,
      type: 'childList',
    }) as unknown as MutationRecord;

  it('debounces additions and collapses nested roots', async () => {
    const run = vi.fn(async (_roots: Element[] | 'all') => undefined);
    const s = new MutationScheduler(run);
    document.body.innerHTML =
      '<div id="a"><p id="b"></p></div><div id="c"></div>';
    const a = document.getElementById('a') as Element;
    const b = document.getElementById('b') as Element;
    const c = document.getElementById('c') as Element;
    s.onRecords([rec([a, b])]);
    s.onRecords([rec([c, document.createTextNode('x')])]);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toEqual([a, c]);
    s.disconnect();
  });

  it('switches to a full pass on huge bursts and ignores WebAble own host', async () => {
    const run = vi.fn(async (_roots: Element[] | 'all') => undefined);
    const s = new MutationScheduler(run, {
      debounceMs: 10,
      maxWaitMs: 100,
      huge: 3,
    });
    const els = Array.from({ length: 5 }, () => document.createElement('div'));
    for (const e of els) document.body.append(e);
    s.onRecords([rec(els)]);
    await vi.advanceTimersByTimeAsync(20);
    // The second argument counts the elements added since the last pass.
    expect(run).toHaveBeenLastCalledWith('all', 5);
    const host = document.createElement('webable-ui');
    s.onRecords([rec([host])]);
    await vi.advanceTimersByTimeAsync(20);
    expect(run).toHaveBeenCalledTimes(1);
    s.disconnect();
  });

  it('observes text, class and visibility updates on reused nodes', async () => {
    document.body.innerHTML = '<p id="reuse" hidden>Loading</p>';
    const p = document.querySelector('p')!;
    const run = vi.fn(async (_roots: Element[] | 'all') => undefined);
    const s = new MutationScheduler(run);
    s.observe(document);
    p.firstChild!.textContent = 'Rendered content';
    p.className = 'small';
    p.hidden = false;
    await vi.advanceTimersByTimeAsync(400);
    expect(run).toHaveBeenCalledOnce();
    // Updates to existing nodes add nothing: no fresh decision is due.
    expect(run).toHaveBeenCalledWith([p], 0);
    s.disconnect();
  });

  it('marks before paint: inserted and restyled elements reach the sync hook', async () => {
    document.body.innerHTML = '<p id="old">Old</p>';
    const old = document.querySelector('p')!;
    const run = vi.fn(async (_roots: Element[] | 'all') => undefined);
    const sync = vi.fn();
    const s = new MutationScheduler(run, undefined, undefined, sync);
    const fresh = document.createElement('p');
    s.onRecords([rec([fresh])]);
    expect(sync).toHaveBeenLastCalledWith([fresh], []);
    s.onRecords([
      {
        type: 'attributes',
        attributeName: 'class',
        target: old,
        addedNodes: [] as unknown as NodeList,
      } as unknown as MutationRecord,
    ]);
    expect(sync).toHaveBeenLastCalledWith([], [old]);
    // WebAble's own host never reaches it.
    s.onRecords([rec([document.createElement('webable-ui')])]);
    expect(sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(400);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[1]).toBe(1);
    s.disconnect();
  });

  it('ignores extension marks and cancels pending work on disconnect', async () => {
    document.body.innerHTML = '<p id="reuse">Text</p>';
    const p = document.querySelector('p')!;
    const run = vi.fn(async (_roots: Element[] | 'all') => undefined);
    const s = new MutationScheduler(run);
    s.observe(document);
    p.setAttribute('data-wa-off', 'text_floor');
    await vi.advanceTimersByTimeAsync(400);
    expect(run).not.toHaveBeenCalled();
    p.className = 'small';
    await vi.advanceTimersByTimeAsync(1);
    s.disconnect();
    await vi.advanceTimersByTimeAsync(400);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('content adapter', () => {
  it('accepts only known service-worker messages', () => {
    expect(isWorkerMessage({ type: 'sw:undo', op: 'all' })).toBe(true);
    expect(isWorkerMessage({ type: 'sw:focus-layer' })).toBe(true);
    expect(isWorkerMessage({ type: 'cs:hello' })).toBe(false);
    expect(isWorkerMessage('sw:undo')).toBe(false);
    expect(isWorkerMessage(null)).toBe(false);
  });

  it('stands everything down when WebAble is turned off', async () => {
    const sent: string[] = [];
    const transport: Transport = {
      send: async (msg) => {
        sent.push(msg.type);
        return {
          enabled: false,
          paused: false,
          prePaint: ['focus_outline'],
          tabSession: 't',
        } as never;
      },
      listen: () => () => undefined,
    };
    const adapter = new ContentAdapter({
      transport,
      vocab: { vocabFilter: fallbackVocab },
    });
    await adapter.start();
    expect(sent).toEqual(['cs:hello']);
    expect(document.documentElement.getAttribute('data-wa-off')).toBe('all');
    document.documentElement.removeAttribute('data-wa-off');
    adapter.stop();
  });

  it('answers status requests before the engine exists', async () => {
    const adapter = new ContentAdapter({
      transport: {
        send: async () => {
          throw new Error('no worker');
        },
        listen: () => () => undefined,
      },
      vocab: { vocabFilter: fallbackVocab },
    });
    await adapter.start();
    expect(await adapter.handle({ type: 'sw:get-changes' })).toEqual({
      changes: [],
      status: 'idle',
    });
    expect(await adapter.handle({ type: 'sw:undo', op: 'all' })).toEqual({
      changes: [],
    });
    adapter.stop();
  });
});
