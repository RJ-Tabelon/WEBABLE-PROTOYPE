import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FINISHED_KEY, RUN_KEY } from '../../../src/sitetask/shared';
import type { SiteTaskResult } from '../../../src/sitetask/types';
import { runSiteTasks, SITE_TASKS } from './sites';

type Listener = (msg: unknown) => unknown;
type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

function result(id: string, over: Partial<SiteTaskResult> = {}): SiteTaskResult {
  const t = SITE_TASKS.find((s) => s.id === id)!;
  return {
    id, name: t.name, busy: t.busy, found: true, skipped: false, ms: 4200, wrongClicks: 1, nearMisses: 1, slips: 0,
    presses: 3, scrollScreens: 1.5, motionSeen: false, adsSeen: 0, ...over,
  };
}

function fakeChrome(opts: { startReply?: unknown; startThrows?: boolean } = {}) {
  const messageListeners = new Set<Listener>();
  const changeListeners = new Set<ChangeListener>();
  const store: Record<string, unknown> = {};
  const sent: unknown[] = [];
  const api = {
    runtime: {
      sendMessage: vi.fn(async (msg: unknown) => {
        sent.push(msg);
        if (opts.startThrows) throw new Error('no receiver');
        return opts.startReply === undefined ? { ok: true } : opts.startReply;
      }),
      onMessage: {
        addListener: (l: Listener) => messageListeners.add(l),
        removeListener: (l: Listener) => messageListeners.delete(l),
      },
    },
    storage: {
      session: {
        get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]))),
        remove: vi.fn(async (k: string) => {
          delete store[k];
        }),
      },
      onChanged: {
        addListener: (l: ChangeListener) => changeListeners.add(l),
        removeListener: (l: ChangeListener) => changeListeners.delete(l),
      },
    },
  };
  return {
    api,
    sent,
    store,
    messageListeners,
    changeListeners,
    emit(msg: unknown) {
      for (const l of Array.from(messageListeners)) l(msg);
    },
    change(key: string, value: unknown) {
      store[key] = value;
      for (const l of Array.from(changeListeners)) l({ [key]: { newValue: value } }, 'session');
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SITE_TASKS', () => {
  it('is Wikipedia (quiet), then CNN and Allrecipes (busy), with real https pages and a target each', () => {
    expect(SITE_TASKS.map((t) => t.name)).toEqual(['Wikipedia', 'CNN', 'Allrecipes']);
    expect(SITE_TASKS.map((t) => t.busy)).toEqual([false, true, true]);
    expect(new Set(SITE_TASKS.map((t) => t.id)).size).toBe(3);
    for (const t of SITE_TASKS) {
      expect(t.url).toMatch(/^https:\/\//);
      expect((t.target.hrefIncludes?.length ?? 0) + (t.target.text?.length ?? 0)).toBeGreaterThan(0);
      expect(t.prompt).not.toMatch(/\bpx\b|pixel/i);
    }
    expect(SITE_TASKS[0]!.prompt).toBe('the link to the University of Florida');
    expect(SITE_TASKS[2]!.prompt).toBe('Jump to Recipe');
  });
});

describe('runSiteTasks', () => {
  let fake: ReturnType<typeof fakeChrome>;

  beforeEach(() => {
    fake = fakeChrome();
    vi.stubGlobal('chrome', fake.api);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts the run, reports progress, and resolves on the finished message in task order', async () => {
    const progress: Array<[number, number]> = [];
    const p = runSiteTasks(SITE_TASKS, (d, t) => progress.push([d, t]));
    await flush();
    await flush();
    expect(fake.sent[0]).toEqual({ siteTask: 'start', tasks: SITE_TASKS });
    fake.change(RUN_KEY, { taskTabId: 9, tasks: SITE_TASKS, index: 1, results: [result('wikipedia')] });
    fake.emit({ siteTask: 'finished', results: [result('allrecipes', { found: false, skipped: true, ms: null }), result('wikipedia'), result('cnn')] });
    const out = await p;
    expect(out.map((r) => r.id)).toEqual(['wikipedia', 'cnn', 'allrecipes']);
    expect(out[2]!.skipped).toBe(true);
    expect(out[0]!.ms).toBe(4200);
    expect(progress).toEqual([[0, 3], [1, 3], [3, 3]]);
    expect(fake.messageListeners.size).toBe(0);
    expect(fake.changeListeners.size).toBe(0);
  });

  it('falls back to the stored finished record when the message is missed', async () => {
    vi.useFakeTimers();
    const p = runSiteTasks(SITE_TASKS);
    await vi.advanceTimersByTimeAsync(10);
    fake.store[RUN_KEY] = { taskTabId: 9, tasks: SITE_TASKS, index: 2, results: [result('wikipedia'), result('cnn')] };
    await vi.advanceTimersByTimeAsync(1600);
    delete fake.store[RUN_KEY];
    fake.store[FINISHED_KEY] = { results: [result('wikipedia'), result('cnn'), result('allrecipes')], at: 1 };
    await vi.advanceTimersByTimeAsync(1600);
    const out = await p;
    expect(out.every((r) => r.found)).toBe(true);
  });

  it('finishes with what it has when the worker loses the run', async () => {
    vi.useFakeTimers();
    const p = runSiteTasks(SITE_TASKS);
    await vi.advanceTimersByTimeAsync(10);
    fake.store[RUN_KEY] = { taskTabId: 9, tasks: SITE_TASKS, index: 1, results: [result('wikipedia')] };
    await vi.advanceTimersByTimeAsync(1600);
    delete fake.store[RUN_KEY];
    await vi.advanceTimersByTimeAsync(3200);
    const out = await p;
    expect(out.map((r) => r.found)).toEqual([true, false, false]);
    expect(out.map((r) => r.skipped)).toEqual([false, true, true]);
  });

  it('comes back all skipped when the worker refuses or is unreachable', async () => {
    vi.stubGlobal('chrome', fakeChrome({ startReply: { ok: false } }).api);
    expect((await runSiteTasks(SITE_TASKS)).every((r) => r.skipped)).toBe(true);
    vi.stubGlobal('chrome', fakeChrome({ startThrows: true }).api);
    expect((await runSiteTasks(SITE_TASKS)).every((r) => r.skipped)).toBe(true);
    vi.stubGlobal('chrome', undefined);
    const out = await runSiteTasks(SITE_TASKS);
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.skipped && r.ms === null)).toBe(true);
  });

  it('cleans what pages report: the task decides id, name and busy; ms only when found', async () => {
    const p = runSiteTasks(SITE_TASKS);
    await flush();
    fake.emit({
      siteTask: 'finished',
      results: [{ id: 'wikipedia', name: 'X', busy: true, found: false, skipped: false, ms: 900, wrongClicks: -2, presses: 'many' }],
    });
    const [w] = await p;
    expect(w).toMatchObject({ id: 'wikipedia', name: 'Wikipedia', busy: false, found: false, ms: null, wrongClicks: 0, presses: 0 });
  });
});
