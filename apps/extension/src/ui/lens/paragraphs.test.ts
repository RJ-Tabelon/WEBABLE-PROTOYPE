// Owner: D (round 9). The Lens's words about paragraphs and where their tags sit.
import { describe, expect, it } from 'vitest';
import type { EngineState, RewordItem } from '../../contracts';
import { paraFace, paraSummary, placeParaTags } from './paragraphs';

const item = (id: string, need: number, pick: RewordItem['pick'], state: RewordItem['state'], reason?: string): RewordItem => ({
  id, need, how: { keep: 1 - need, plain: need, list: 0, shorter: 0, point_first: 0 }, pick, state, snippet: 'Paragraph', ...(reason ? { reason } : {}),
});
const rw = (status: NonNullable<EngineState['reword']>['status'], items: RewordItem[]): EngineState['reword'] => ({
  status, source: 'ChatGPT', items, showingOriginal: false, version: 3,
});

describe('paragraph tags in the Lens', () => {
  it("names Jev's probability, the change and what happened", () => {
    expect(paraFace(item('w1', 0.842, 'plain', 'rewritten'))).toMatchObject({
      num: '0.84', sub: 'plainer words · rewritten', tone: 'new',
      say: "Jev's probability this is harder than it needs to be for you: 0.84 · plainer words · rewritten",
    });
    expect(paraFace(item('w2', 0.12, null, 'kept'))).toMatchObject({ num: '0.12', sub: 'kept', tone: 'kept' });
    expect(paraFace(item('w3', 0.9, 'list', 'failed', 'numbers'))).toMatchObject({
      sub: 'steps or a list · checked: kept the original', why: 'a number changed', tone: 'checked',
      say: "Jev's probability this is harder than it needs to be for you: 0.90 · steps or a list · checked: kept the original (a number changed)",
    });
    expect(paraFace(item('w4', 0.7, 'point_first', 'waiting')).sub).toBe('main point first · being rewritten');
    expect(paraFace(item('w5', 0.7, 'shorter', 'original')).sub).toBe("shorter · rewritten; showing the page's words");
  });

  it('sums up the page in one line', () => {
    const items = [
      item('w1', 0.9, 'plain', 'rewritten'), item('w2', 0.8, 'list', 'rewritten'), item('w3', 0.2, null, 'kept'), item('w4', 0.1, null, 'kept'),
    ];
    expect(paraSummary(rw('done', items))).toBe('Jev read 4 for you, picked 2, 2 rewritten, all checked');
    expect(paraSummary(rw('done', [...items, item('w5', 0.85, 'shorter', 'failed', 'dropped')]))).toBe(
      "Jev read 5 for you, picked 3, 2 rewritten, 1 kept the page's words after the check",
    );
    expect(paraSummary(rw('writing', [...items, item('w6', 0.7, 'plain', 'waiting')]))).toBe('Jev read 5 for you, picked 3, 2 rewritten, 1 being written');
    expect(paraSummary(rw('none', [item('w1', 0.1, null, 'kept')]))).toBe('Jev read 1 for you; none needed changing');
    expect(paraSummary(rw('scoring', []))).toBe('Jev is reading the paragraphs for you…');
    expect(paraSummary(rw('off', items))).toBeNull();
    expect(paraSummary(undefined)).toBeNull();
  });

  it('puts tags in the left gutter, stacked so they never overlap, and above when there is no room', () => {
    const size = { w: 272, h: 42 };
    const view = { vw: 1440, vh: 900, top: 60 };
    const tags = placeParaTags(
      [
        { id: 'w1', r: { x: 400, y: 100, w: 640, h: 24 } },
        { id: 'w2', r: { x: 400, y: 130, w: 640, h: 24 } },
        { id: 'w3', r: { x: 120, y: 400, w: 900, h: 80 } },
      ],
      size,
      view,
      [],
    );
    const a = tags.get('w1')!;
    const b = tags.get('w2')!;
    expect(a).toEqual({ x: 400 - 10 - 272, y: 100, w: 272, h: 42 });
    expect(b.x).toBe(a.x);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
    const c = tags.get('w3')!;
    expect(c.x).toBe(120);
    expect(c.y).toBe(400 - 42 - 6);
  });

  it('keeps tags under the header and leaves out the ones pushed off screen', () => {
    const tags = placeParaTags([{ id: 'w1', r: { x: 400, y: 10, w: 600, h: 30 } }, { id: 'w2', r: { x: 400, y: 950, w: 600, h: 30 } }], { w: 272, h: 42 }, { vw: 1440, vh: 900, top: 60 }, []);
    expect(tags.get('w1')!.y).toBe(60);
    expect(tags.has('w2')).toBe(false);
  });
});
