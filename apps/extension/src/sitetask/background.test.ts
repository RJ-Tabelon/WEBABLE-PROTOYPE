import { describe, expect, it } from 'vitest';
import { SiteTaskRunner, type SiteTaskHost } from './background';
import { LOAD_TIMEOUT_MS, type RunState } from './shared';
import type { SiteTaskResult, SiteTaskSpec } from './types';

const TASKS: SiteTaskSpec[] = [
  { id: 'a', name: 'Quiet', url: 'https://en.wikipedia.org/wiki/X', prompt: 'X', target: { text: ['X'] }, busy: false },
  { id: 'b', name: 'Busy', url: 'https://www.cnn.com/', prompt: 'Health', target: { text: ['Health'] }, busy: true },
  { id: 'c', name: 'Food', url: 'https://www.allrecipes.com/recipe/1/', prompt: 'Jump', target: { text: ['Jump'] }, busy: true },
];

function fakeHost() {
  let now = 1000;
  let nextTab = 50;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const log: string[] = [];
  let stored: RunState | null = null;
  let finished: SiteTaskResult[] | null = null;
  const host: SiteTaskHost = {
    now: () => now,
    load: async () => (stored ? structuredClone(stored) : null),
    save: async (s) => {
      stored = s ? structuredClone(s) : null;
    },
    clearFinished: async () => {
      finished = null;
    },
    publishFinished: async (r) => {
      finished = r;
      log.push('finished');
    },
    openTab: async (url) => {
      log.push(`open ${url}`);
      return nextTab++;
    },
    navigate: async (tab, url) => {
      log.push(`nav ${tab} ${url}`);
    },
    closeTab: async (tab) => {
      log.push(`close ${tab}`);
    },
    focusTab: async (tab) => {
      log.push(`focus ${tab}`);
    },
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { live: boolean }).live = false;
    },
  };
  return {
    host,
    log,
    get stored() {
      return stored;
    },
    get finished() {
      return finished;
    },
    async advance(ms: number) {
      now += ms;
      for (const t of timers) {
        if (t.live && t.at <= now) {
          t.live = false;
          t.fn();
        }
      }
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

const opener = { tabId: 7, windowId: 1, index: 3 };
const found = (id: string, ms = 3000) => ({ id, found: true, skipped: false, ms, wrongClicks: 2, nearMisses: 1, slips: 1, presses: 4, scrollScreens: 0.5, motionSeen: true, adsSeen: 6 });

describe('SiteTaskRunner', () => {
  it('walks one tab through every site and hands the results back', async () => {
    const f = fakeHost();
    const r = new SiteTaskRunner(f.host);
    expect(await r.start(TASKS, opener)).toBe(true);
    const tab = r.current!.taskTabId;
    expect(f.log).toEqual([`open ${TASKS[0]!.url}`]);

    expect(await r.whoami(999, TASKS[0]!.url)).toBeNull(); // another tab: an ordinary page
    expect(await r.whoami(tab, 'https://en.m.wikipedia.org/wiki/X')).toEqual({ task: TASKS[0], index: 0, total: 3 });
    await r.done(tab, { id: 'b' }); // stale: not the current site
    expect(r.current!.index).toBe(0);
    await r.done(tab, found('a'));
    expect(f.log.at(-1)).toBe(`nav ${tab} ${TASKS[1]!.url}`);

    expect(await r.whoami(tab, 'https://edition.cnn.com/')).toMatchObject({ index: 1 });
    await r.done(tab, found('b', 9000));
    expect(await r.whoami(tab, TASKS[2]!.url)).toMatchObject({ index: 2 });
    await r.done(tab, { id: 'c', skipped: true });

    expect(f.log.slice(-3)).toEqual([`close ${tab}`, 'focus 7', 'finished']);
    expect(f.finished!.map((x) => [x.id, x.found, x.skipped, x.ms])).toEqual([
      ['a', true, false, 3000],
      ['b', true, false, 9000],
      ['c', false, true, null],
    ]);
    expect(f.finished![1]).toMatchObject({ name: 'Busy', busy: true, adsSeen: 6, motionSeen: true });
    expect(f.stored).toBeNull();
    expect(r.current).toBeNull();
  });

  it('stays quiet in the task tab off the task site', async () => {
    const f = fakeHost();
    const r = new SiteTaskRunner(f.host);
    await r.start(TASKS, opener);
    expect(await r.whoami(r.current!.taskTabId, 'https://example.org/')).toEqual({ task: null });
  });

  it('skips a site whose card never shows within 20 s', async () => {
    const f = fakeHost();
    const r = new SiteTaskRunner(f.host);
    await r.start(TASKS, opener);
    const tab = r.current!.taskTabId;
    await f.advance(LOAD_TIMEOUT_MS - 100);
    expect(r.current!.index).toBe(0);
    await f.advance(200);
    expect(r.current!.index).toBe(1);
    expect(r.current!.results[0]).toMatchObject({ id: 'a', skipped: true });
    // Once the card shows, there's no limit.
    await r.whoami(tab, TASKS[1]!.url);
    await f.advance(LOAD_TIMEOUT_MS * 3);
    expect(r.current!.index).toBe(1);
  });

  it('finishes with what it has when the person closes the task tab early', async () => {
    const f = fakeHost();
    const r = new SiteTaskRunner(f.host);
    await r.start(TASKS, opener);
    const tab = r.current!.taskTabId;
    await r.whoami(tab, TASKS[0]!.url);
    await r.done(tab, found('a'));
    await r.tabRemoved(tab);
    expect(f.log).not.toContain(`close ${tab}`);
    expect(f.log.slice(-2)).toEqual(['focus 7', 'finished']);
    expect(f.finished!.map((x) => x.skipped)).toEqual([false, true, true]);
  });

  it('carries on after a worker restart from the stored run', async () => {
    const f = fakeHost();
    const r1 = new SiteTaskRunner(f.host);
    await r1.start(TASKS, opener);
    const tab = r1.current!.taskTabId;
    await r1.whoami(tab, TASKS[0]!.url);
    const r2 = new SiteTaskRunner(f.host); // a fresh worker
    await r2.done(tab, found('a'));
    expect(r2.current!.index).toBe(1);
    expect(f.log.at(-1)).toBe(`nav ${tab} ${TASKS[1]!.url}`);
  });

  it('refuses an empty or invalid task list', async () => {
    const f = fakeHost();
    const r = new SiteTaskRunner(f.host);
    expect(await r.start([], opener)).toBe(false);
    expect(await r.start([{ ...TASKS[0]!, url: 'javascript:alert(1)' }], opener)).toBe(false);
    expect(f.log).toEqual([]);
  });
});
