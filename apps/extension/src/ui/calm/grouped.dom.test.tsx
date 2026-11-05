// @vitest-environment happy-dom
// Round 10 on the WebAble page: a group shows the page's own words until its layout is ready and allowed to settle in;
// then the layout, with the thin mark that switches the group back to the page's own words. After the first moments
// (or once the person acts) a group on screen waits until it is off screen.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposeGroupState, EngineApi, EngineState } from '../../contracts';
import { type GroupSeg, segmentBlocks } from './compose/composeGroups';
import { Calm, type CalmCtx } from './context';
import { Blocks } from './Blocks';
import { Segments } from './Grouped';
import { newCtx, readBlocks } from './model';
import { SCROLL_END_MS, type SettleCtl, createSettle } from './settle';

const seen: Array<{ id: string; settle: boolean; links: number }> = [];
vi.mock('./compose/Composed', () => ({
  Composed: (p: { id: string; settle: boolean; links: unknown[] }) => {
    seen.push({ id: p.id, settle: p.settle, links: p.links.length });
    return <div data-wa-compose={p.id}>Laid out</div>;
  },
}));

let onScreen = true;
beforeEach(() => {
  onScreen = true;
  seen.length = 0;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const r = this.classList.contains('wa-cg') ? (onScreen ? { top: 100, bottom: 500 } : { top: 1200, bottom: 1600 }) : { top: 0, bottom: 800 };
    return { ...r, left: 0, right: 600, width: 600, height: r.bottom - r.top, x: 0, y: r.top, toJSON: () => r } as DOMRect;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');

function page(): { segs: ReturnType<typeof segmentBlocks>; seg: GroupSeg } {
  const main = document.createElement('main');
  main.innerHTML = `<p>${text} and <a href="https://example.gov/x">the page link</a>.</p>`;
  document.body.append(main);
  const segs = segmentBlocks(readBlocks(main, newCtx()), { heading: 'About' });
  return { segs, seg: segs.find((s): s is GroupSeg => s.k === 'group')! };
}

function compose(id: string, state: ComposeGroupState['state'], version = 1): NonNullable<EngineState['compose']> {
  const g: ComposeGroupState = {
    id, state, better: state === 'ready' ? 0.9 : null, readyAt: state === 'ready' ? performance.now() - 5000 : undefined,
    blocks: state === 'ready' ? [{ k: 'prose', src: ['u1'], text: 'Plainer words with ⟦1⟧.' }] : null,
  };
  return { status: 'working', groups: { [id]: g }, version };
}

function mount(segs: ReturnType<typeof segmentBlocks>, c: EngineState['compose'], settle: SettleCtl, host?: HTMLElement): HTMLElement {
  const el = host ?? document.body.appendChild(document.createElement('div'));
  const ctx = {
    api: { rewordFor: () => null } as unknown as EngineApi, splitN: Infinity, groupSize: 8, reduceMotion: false,
    click: vi.fn(), compose: c, groupOrder: [], settle,
  } as unknown as CalmCtx;
  act(() => {
    render(
      <Calm.Provider value={ctx}>
        <Segments segs={segs} render={(bs) => <Blocks blocks={bs} />} />
      </Calm.Provider>,
      el,
    );
  });
  return el;
}

describe('a group on the WebAble page', () => {
  it("shows the page's own words, with no mark, while its layout is being made", () => {
    const { segs, seg } = page();
    const host = mount(segs, compose(seg.group.id, 'waiting'), createSettle(() => null));
    expect(host.querySelector('[data-wa-compose]')).toBeNull();
    expect(host.querySelector('.wa-rw-mark')).toBeNull();
    expect(host.textContent).toContain('word39 and the page link.');
    expect(host.querySelector('.wa-cg')?.getAttribute('data-showing')).toBe('waiting');
  });

  it('settles in once ready in the first moments, with one soft motion and a green mark that switches it', () => {
    const { segs, seg } = page();
    const settle = createSettle(() => null);
    const host = mount(segs, compose(seg.group.id, 'ready'), settle);
    expect(host.querySelector(`[data-wa-compose="${seg.group.id}"]`)).not.toBeNull();
    expect(host.textContent).not.toContain('word39');
    expect(seen.at(-1)).toEqual({ id: seg.group.id, settle: true, links: 1 });
    const mark = host.querySelector<HTMLButtonElement>('button.wa-rw-mark')!;
    expect(mark.getAttribute('data-showing')).toBe('new');
    expect(mark.title).toBe('Laid out for you by WebAble. Click to see the page’s own words.');
    act(() => mark.click());
    expect(host.querySelector('[data-wa-compose]')).toBeNull();
    expect(host.textContent).toContain('word39');
    expect(host.querySelector('button.wa-rw-mark')!.getAttribute('data-showing')).toBe('original');
    act(() => host.querySelector<HTMLButtonElement>('button.wa-rw-mark')!.click());
    expect(host.querySelector('[data-wa-compose]')).not.toBeNull();
    // Back again by the person's own press: no second motion.
    expect(seen.at(-1)!.settle).toBe(false);
  });

  it('never changes a group the person may be reading: it waits until scrolling leaves it off screen', () => {
    vi.useFakeTimers();
    const { segs, seg } = page();
    const settle = createSettle(() => null);
    settle.markInteracted();
    const host = document.body.appendChild(document.createElement('div'));
    mount(segs, compose(seg.group.id, 'waiting'), settle, host);
    mount(segs, compose(seg.group.id, 'ready', 2), settle, host);
    expect(host.querySelector('[data-wa-compose]')).toBeNull();
    expect(host.textContent).toContain('word39');
    // Still on screen after a scroll: still the page's own words.
    act(() => {
      settle.scrolled();
      vi.advanceTimersByTime(SCROLL_END_MS + 10);
    });
    expect(host.querySelector('[data-wa-compose]')).toBeNull();
    onScreen = false;
    act(() => {
      settle.scrolled();
      vi.advanceTimersByTime(SCROLL_END_MS + 10);
    });
    expect(host.querySelector('[data-wa-compose]')).not.toBeNull();
  });

  it("keeps the page's own words when the layout was not used", () => {
    const { segs, seg } = page();
    for (const st of ['kept', 'failed'] as const) {
      const host = mount(segs, compose(seg.group.id, st), createSettle(() => null));
      expect(host.querySelector('[data-wa-compose]')).toBeNull();
      expect(host.querySelector('.wa-rw-mark')).toBeNull();
      expect(host.textContent).toContain('word39');
    }
  });
});
