// Round 10: the WebAble page's groups laid out for the person. Dedupe, priority, batching, state changes, code's own
// checks and late answers for an old page.
import { describe, expect, it } from 'vitest';
import type { BgRequest, ComposeBlock, ComposeGroupIn, ComposeResponse, ComposeResult } from '@webable/core';
import { COMPOSE_BATCH, COMPOSE_IN_FLIGHT, checkBlocks, createCompose, nextQueue, type ComposeHost, type ComposeState, type ComposeSummary } from './compose';

const jev = { model: 'jev', calls: 1, questions: 2, inputTokens: 10, wallMs: 300, serverMs: 200, costUsd: 0.001 };

const group = (id: string, text = 'Most refunds arrive within 21 days. See ⟦1⟧ for more.', links = ['Where’s My Refund']): ComposeGroupIn => ({
  id, heading: 'When to expect your refund', units: [{ id: 'u1', kind: 'para', text }], linkTexts: links,
});

const good = (id: string, better = 0.82): ComposeResult => ({
  id, ok: true, better,
  blocks: [{ src: ['u1'], k: 'keyfacts', title: null, icon: 'clock', rows: [{ label: 'Refunds', value: 'within 21 days', icon: null }] },
    { src: ['u1'], k: 'prose', text: 'See ⟦1⟧ for more.' }],
  checks: { covered: true, numbersKept: true, noNewNumbers: true, linksKept: true, quotesKept: true, dropped: 0.05, added: 0.04 },
});

interface Pending { req: Extract<BgRequest, { type: 'compose' }>; resolve: (r: unknown) => void; reject: (e: unknown) => void }

function harness(over: Partial<ComposeHost> = {}) {
  const calls: Pending[] = [];
  const states: ComposeState[] = [];
  const done: ComposeSummary[] = [];
  let t = 1000;
  const host: ComposeHost = {
    ask: <T,>(req: BgRequest) => new Promise<T>((resolve, reject) => {
      calls.push({ req: req as Pending['req'], resolve: resolve as (r: unknown) => void, reject });
    }),
    page: () => ({ title: 'Refunds', host: 'example.gov', purpose: 'info_guide' }),
    blocked: () => false,
    publish: (s) => states.push(s),
    finished: (s) => done.push(s),
    now: () => (t += 10),
    ...over,
  };
  const runner = createCompose(host);
  const answer = (i: number, results: ComposeResult[]) => {
    const res: ComposeResponse = { results, model: 'gpt-5.4-mini', ms: 900, jev };
    calls[i]!.resolve(res);
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { runner, calls, states, done, answer, flush };
}

const ids = (p: Pending) => p.req.req.groups.map((g) => g.id);

describe('compose runner', () => {
  it('sends up to 2 groups a request, up to 6 requests at once, in the order given', async () => {
    const h = harness();
    h.runner.compose(Array.from({ length: 14 }, (_, i) => group(`g${i + 1}`)));
    expect(COMPOSE_BATCH).toBe(2);
    expect(COMPOSE_IN_FLIGHT).toBe(6);
    expect(h.calls).toHaveLength(COMPOSE_IN_FLIGHT);
    expect(h.calls.map(ids)).toEqual([['g1', 'g2'], ['g3', 'g4'], ['g5', 'g6'], ['g7', 'g8'], ['g9', 'g10'], ['g11', 'g12']]);
    expect(h.calls[0]!.req.req.page.host).toBe('example.gov');
    expect(h.runner.state().status).toBe('working');
    expect(Object.values(h.runner.state().groups).every((g) => g.state === 'waiting')).toBe(true);
    h.answer(1, [good('g3'), good('g4')]);
    await h.flush();
    // One answer frees a slot: the next two go out.
    expect(h.calls).toHaveLength(7);
    expect(ids(h.calls[6]!)).toEqual(['g13', 'g14']);
  });

  it('never asks twice for the same group on this page', async () => {
    const h = harness();
    h.runner.compose([group('g1'), group('g1'), group('g2')]);
    expect(h.calls.map(ids)).toEqual([['g1', 'g2']]);
    h.runner.compose([group('g2'), group('g1')]);
    expect(h.calls).toHaveLength(1);
    h.answer(0, [good('g1'), { id: 'g2', ok: false, blocks: null, better: 0.3, checks: good('g2').checks, reason: 'numbers' }]);
    await h.flush();
    // Answered (even failed) groups are not asked again either.
    h.runner.compose([group('g1'), group('g2')]);
    expect(h.calls).toHaveLength(1);
  });

  it('a later call moves its groups that are still waiting to the front', async () => {
    const h = harness();
    h.runner.compose(Array.from({ length: 16 }, (_, i) => group(`g${i + 1}`)));
    expect(h.calls).toHaveLength(6);
    // The person's screen now shows g15: it goes next, before g13 and g14.
    h.runner.compose([group('g15'), group('g1')]);
    h.answer(0, [good('g1'), good('g2')]);
    await h.flush();
    expect(ids(h.calls[6]!)).toEqual(['g15', 'g13']);
  });

  it('waiting -> ready (with readyAt), kept, or failed; version bumps on each change; done once', async () => {
    const h = harness();
    h.runner.compose([group('g1'), group('g2'), group('g3')]);
    const v0 = h.runner.state().version;
    h.answer(0, [
      good('g1', 0.91),
      { id: 'g2', ok: false, blocks: null, better: 0.31, checks: good('g2').checks, reason: 'plain_is_better' },
    ]);
    await h.flush();
    let s = h.runner.state();
    expect(s.version).toBeGreaterThan(v0);
    expect(s.groups.g1).toMatchObject({ state: 'ready', better: 0.91 });
    expect(typeof s.groups.g1!.readyAt).toBe('number');
    expect(s.groups.g1!.blocks).toHaveLength(2);
    expect(s.groups.g2).toMatchObject({ state: 'kept', blocks: null, better: 0.31, reason: 'plain_is_better' });
    expect(s.status).toBe('working');
    expect(h.done).toHaveLength(0);
    h.answer(1, [{ id: 'g3', ok: false, blocks: null, better: null, checks: good('g3').checks, reason: 'dropped' }]);
    await h.flush();
    s = h.runner.state();
    expect(s.groups.g3).toMatchObject({ state: 'failed', reason: 'dropped' });
    expect(s.status).toBe('done');
    expect(h.done).toHaveLength(1);
    expect(h.done[0]).toMatchObject({ asked: 3, laidOut: 1, kept: 1, failed: 1, unreachable: 0, better: [0.91] });
    expect(h.runner.ownsOp(h.done[0]!.opId)).toBe(true);
    // Each published state is a new object, so the page re-renders.
    expect(h.states.at(-1)!.groups).not.toBe(h.states.at(-2)!.groups);
  });

  it('marks a group failed when the server cannot be reached or leaves it out', async () => {
    const h = harness();
    h.runner.compose([group('g1'), group('g2'), group('g3')]);
    h.calls[0]!.reject(new Error('The WebAble server on this computer could not be reached.'));
    h.answer(1, []);
    await h.flush();
    const s = h.runner.state();
    expect(s.groups.g1).toMatchObject({ state: 'failed', reason: 'unreachable' });
    expect(s.groups.g2).toMatchObject({ state: 'failed', reason: 'unreachable' });
    expect(s.groups.g3).toMatchObject({ state: 'failed', reason: 'llm_unavailable' });
    expect(s.status).toBe('done');
    expect(h.done[0]).toMatchObject({ laidOut: 0, failed: 3, unreachable: 2 });
  });

  it('code checks the blocks again: a dropped link or number shows the page’s own words', async () => {
    const h = harness();
    h.runner.compose([group('g1'), group('g2')]);
    const noLink = good('g1');
    noLink.blocks = [{ src: ['u1'], k: 'prose', text: 'Most refunds arrive within 21 days.' }];
    const newNumber = good('g2');
    newNumber.blocks = [{ src: ['u1'], k: 'prose', text: 'Most refunds arrive within 21 days, 9 in 10 of them. See ⟦1⟧.' }];
    h.answer(0, [noLink, newNumber]);
    await h.flush();
    expect(h.runner.state().groups.g1).toMatchObject({ state: 'failed', reason: 'links' });
    expect(h.runner.state().groups.g2).toMatchObject({ state: 'failed', reason: 'new_numbers' });
  });

  it('drops late answers for an old page, and starts again on the new one', async () => {
    const h = harness();
    h.runner.compose(Array.from({ length: 15 }, (_, i) => group(`g${i + 1}`)));
    expect(h.calls).toHaveLength(6);
    h.runner.reset();
    expect(h.runner.state()).toMatchObject({ status: 'idle', groups: {} });
    h.answer(0, [good('g1'), good('g2')]);
    await h.flush();
    expect(h.runner.state().groups).toEqual({});
    // The old page's in-flight requests don't hold back the new page, and nothing from the old queue is sent.
    h.runner.compose([group('g1'), group('h2'), group('h3'), group('h4'), group('h5'), group('h6')]);
    expect(h.calls.slice(6).map(ids)).toEqual([['g1', 'h2'], ['h3', 'h4'], ['h5', 'h6']]);
    h.answer(1, [good('g3'), good('g4')]);
    await h.flush();
    expect(h.calls).toHaveLength(9);
    expect(h.runner.state().groups.g3).toBeUndefined();
    expect(h.done).toHaveLength(0);
  });

  it('sends nothing from a page with password or payment fields', () => {
    const h = harness({ blocked: () => true });
    h.runner.compose([group('g1')]);
    expect(h.calls).toHaveLength(0);
    expect(h.runner.state().status).toBe('idle');
  });

  it('later groups after done: working again, then one summary for the whole page (same opId)', async () => {
    const h = harness();
    h.runner.compose([group('g1')]);
    h.answer(0, [good('g1', 0.7)]);
    await h.flush();
    expect(h.done).toHaveLength(1);
    h.runner.compose([group('g1'), group('g2')]);
    expect(h.runner.state().status).toBe('working');
    expect(h.calls.map(ids)).toEqual([['g1'], ['g2']]);
    h.answer(1, [good('g2', 0.9)]);
    await h.flush();
    expect(h.done).toHaveLength(2);
    expect(h.done[1]).toMatchObject({ asked: 2, laidOut: 2, better: [0.7, 0.9], opId: h.done[0]!.opId });
  });
});

describe('checkBlocks', () => {
  const g = group('g1', 'Call ⟦1⟧ or 800-829-1954 between 7 a.m. and 7 p.m. Refunds of $1,000 or more take 3 weeks.', ['the help line']);
  const ok: ComposeBlock[] = [
    { src: ['u1'], k: 'contact', title: null, rows: [{ kind: 'phone', label: 'Phone', value: '800-829-1954' }, { kind: 'hours', label: 'Hours', value: '7 a.m. to 7 p.m.' }] },
    { src: ['u1'], k: 'callout', tone: 'important', title: 'Large refunds', text: 'Refunds of $1000 or more take 3 weeks. Call ⟦1⟧.', icon: 'triangle-alert' },
  ];

  it('passes blocks that keep every link and number', () => {
    expect(checkBlocks(g, ok)).toBeNull();
  });

  it('fails unknown kinds and empty answers', () => {
    expect(checkBlocks(g, [])).toBe('invalid');
    expect(checkBlocks(g, null)).toBe('invalid');
    expect(checkBlocks(g, [{ src: ['u1'], k: 'html', text: '<b>hi</b>' }])).toBe('invalid');
  });

  it('fails a marker out of range or a link left out', () => {
    const extra = structuredClone(ok);
    (extra[1] as { text: string }).text += ' ⟦2⟧';
    expect(checkBlocks(g, extra)).toBe('links');
    const none = structuredClone(ok);
    (none[1] as { text: string }).text = 'Refunds of $1000 or more take 3 weeks.';
    expect(checkBlocks(g, none)).toBe('links');
  });

  it('fails a number dropped or one the page doesn’t have; icon and kind names are not text', () => {
    const dropped = structuredClone(ok);
    (dropped[1] as { text: string }).text = 'Large refunds take a few weeks. Call ⟦1⟧.';
    expect(checkBlocks(g, dropped)).toBe('numbers');
    const invented = structuredClone(ok);
    (invented[1] as { text: string }).text += ' Most arrive in 10 days.';
    expect(checkBlocks(g, invented)).toBe('new_numbers');
    // A number in the page's heading may be used as a title.
    const titled = structuredClone(ok);
    (titled[1] as { title: string }).title = 'Step 2';
    expect(checkBlocks({ ...g, heading: 'Step 2: call us' }, titled)).toBeNull();
  });
});

describe('nextQueue', () => {
  it('puts this call’s unsent groups first, in its order, and drops ones already sent', () => {
    const q = [group('a'), group('b'), group('c')];
    expect(nextQueue(q, [group('c'), group('x'), group('s')], new Set(['s'])).map((g) => g.id)).toEqual(['c', 'x', 'a', 'b']);
  });
});

describe('the Jev view line for a part', () => {
  it('says Jev’s probability and what WebAble did, in plain words', async () => {
    const { composeLine } = await import('../ui/lens/Sheet');
    expect(composeLine({ id: 'g1', state: 'ready', blocks: [], better: 0.823 })).toBe('Jev’s probability this layout is easier for you: 0.82 · laid out');
    expect(composeLine({ id: 'g2', state: 'kept', blocks: null, better: 0.31, reason: 'plain_is_better' })).toBe('Jev’s probability this layout is easier for you: 0.31 · kept the page’s words');
    expect(composeLine({ id: 'g3', state: 'failed', blocks: null, better: null, reason: 'unreachable' })).toBe('Couldn’t be checked · kept the page’s words');
    expect(composeLine({ id: 'g4', state: 'waiting', blocks: null, better: null })).toBe('Waiting for Jev');
  });
});

describe('a real answer from /v1/compose (irs.gov refunds, 2026-10-25)', () => {
  it('passes code’s own checks here too', () => {
    const g: ComposeGroupIn = {"id": "gtest1", "heading": "How to check your refund", "units": [{"id": "u1", "kind": "para", "text": "Use ⟦1⟧ to check your refund status. You can start checking 24 hours after you e-file a current-year return, 3 or 4 days after you e-file a prior-year return, or 4 weeks after you mail a paper return."}, {"id": "u2", "kind": "list", "text": "• Your Social Security or individual taxpayer ID number\n• Your filing status\n• Your exact refund amount"}, {"id": "u3", "kind": "para", "text": "Don't file a second tax return or call us. Doing so may delay your refund. Most refunds are issued in less than 21 days."}], "linkTexts": ["Where's My Refund?"]};
    const blocks = [{"k": "prose", "src": ["u1"], "text": "Use ⟦1⟧ to check your refund status. You can start checking 24 hours after you e-file a current-year return, 3 or 4 days after you e-file a prior-year return, or 4 weeks after you mail a paper return."}, {"k": "keyfacts", "src": ["u2"], "title": "What you need", "icon": "clipboard-list", "rows": [{"label": "Social Security", "value": "Your Social Security or individual taxpayer ID number", "icon": "user"}, {"label": "Filing status", "value": "Your filing status", "icon": "file-text"}, {"label": "Refund amount", "value": "Your exact refund amount", "icon": "banknote"}]}, {"k": "stats", "src": ["u3"], "tiles": [{"label": "Refunds", "value": "less than 21 days", "note": "Most refunds are issued", "icon": "clock"}]}, {"k": "callout", "src": ["u3"], "tone": "warning", "title": "Do not file again", "text": "Don't file a second tax return or call us. Doing so may delay your refund.", "icon": "triangle-alert"}];
    expect(checkBlocks(g, blocks)).toBeNull();
  });
});
