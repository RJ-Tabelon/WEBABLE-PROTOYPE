// The Finding part on real websites (docs/design/ONBOARDING.md, round 8c, point 4).
// SITE_TASKS are the three sites, in order; runSiteTasks asks the worker to walk the person through them in one task tab
// and resolves with one result per site once the task tab has closed and this tab is back.
import {
  FINISHED_KEY,
  resultsForTasks,
  RUN_KEY,
  skippedResult,
  type FinishedRecord,
  type RunState,
} from '../../../src/sitetask/shared';
import type { SiteTaskMessage, SiteTaskResult, SiteTaskSpec } from '../../../src/sitetask/types';

/**
 * Checked against the live pages at 1440×900 on 2026-10-25. CNN's "Sports" now sits behind the "More" menu at that
 * width (only the footer copy is on the page), so the CNN task uses "Health", which is in the top bar at 1024 px and up.
 */
export const SITE_TASKS: SiteTaskSpec[] = [
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Gainesville,_Florida',
    prompt: 'the link to the University of Florida',
    target: { hrefIncludes: ['/wiki/University_of_Florida'], text: ['University of Florida'] },
    busy: false,
  },
  {
    id: 'cnn',
    name: 'CNN',
    url: 'https://www.cnn.com/',
    prompt: 'Health',
    target: { hrefIncludes: ['cnn.com/health'], text: ['Health'] },
    busy: true,
  },
  {
    id: 'allrecipes',
    name: 'Allrecipes',
    url: 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/',
    prompt: 'Jump to Recipe',
    target: { text: ['Jump to Recipe'] },
    busy: true,
  },
];

/** How often the stored run is read, as a fallback to the message and storage events. */
const POLL_MS = 1500;

type ChromeLike = typeof chrome;

function chromeApi(): ChromeLike | null {
  const c = (globalThis as { chrome?: ChromeLike }).chrome;
  return c && c.runtime && typeof c.runtime.sendMessage === 'function' ? c : null;
}

function isFinishedMessage(msg: unknown): msg is Extract<SiteTaskMessage, { siteTask: 'finished' }> {
  return !!msg && typeof msg === 'object' && (msg as { siteTask?: unknown }).siteTask === 'finished' && Array.isArray((msg as { results?: unknown }).results);
}

function finishedResults(v: unknown): SiteTaskResult[] | null {
  if (!v || typeof v !== 'object') return null;
  const r = (v as Partial<FinishedRecord>).results;
  return Array.isArray(r) ? r : null;
}

function runResults(v: unknown): SiteTaskResult[] | null {
  if (!v || typeof v !== 'object') return null;
  const r = (v as Partial<RunState>).results;
  return Array.isArray(r) ? r : null;
}

/**
 * Opens the real sites one after another in a task tab and resolves when they're done, with one result per task in
 * task order (skipped where the person skipped, a site didn't load, or the task tab was closed early). Never rejects:
 * if the sites can't be opened at all, every task comes back skipped and the onboarding carries on.
 * `onProgress(done, total)` is called with 0 at the start and after each site.
 */
export function runSiteTasks(
  tasks: SiteTaskSpec[],
  onProgress?: (done: number, total: number) => void,
): Promise<SiteTaskResult[]> {
  const total = tasks.length;
  if (total === 0) return Promise.resolve([]);
  const c = chromeApi();
  if (!c) return Promise.resolve(tasks.map(skippedResult));
  const session = c.storage?.session;

  return new Promise<SiteTaskResult[]>((resolve) => {
    let settled = false;
    let lastDone = -1;
    let partial: SiteTaskResult[] = [];
    let seenRun = false;
    let started = false;
    let missing = 0;
    let poll: ReturnType<typeof setInterval> | null = null;

    const progress = (n: number) => {
      const done = Math.max(0, Math.min(total, n));
      if (done === lastDone || !onProgress) return;
      lastDone = done;
      try {
        onProgress(done, total);
      } catch {
        /* the flow's own problem */
      }
    };

    const cleanup = () => {
      if (poll !== null) clearInterval(poll);
      try {
        c.runtime.onMessage.removeListener(onMessage);
      } catch {
        /* gone */
      }
      try {
        c.storage?.onChanged?.removeListener(onChanged);
      } catch {
        /* gone */
      }
    };

    const finish = (results: readonly unknown[] | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      const out = resultsForTasks(tasks, results ?? partial);
      progress(total);
      resolve(out);
    };

    const sawRun = (v: unknown) => {
      const r = runResults(v);
      if (!r) return false;
      seenRun = true;
      missing = 0;
      partial = r;
      progress(r.length);
      return true;
    };

    const onMessage = (msg: unknown) => {
      if (isFinishedMessage(msg)) finish(msg.results);
      return false;
    };

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session') return;
      const fin = finishedResults(changes[FINISHED_KEY]?.newValue);
      if (fin) {
        finish(fin);
        return;
      }
      if (changes[RUN_KEY]) sawRun(changes[RUN_KEY].newValue);
    };

    const check = async () => {
      if (settled || !started || !session) return;
      let got: Record<string, unknown> = {};
      try {
        got = await session.get([RUN_KEY, FINISHED_KEY]);
      } catch {
        return;
      }
      if (settled) return;
      const fin = finishedResults(got[FINISHED_KEY]);
      if (fin) {
        finish(fin);
        return;
      }
      if (sawRun(got[RUN_KEY])) return;
      // Neither a run nor a finished record: the worker lost the run. Finish with what we have.
      missing += 1;
      if (missing >= (seenRun ? 2 : 4)) finish(null);
    };

    try {
      c.runtime.onMessage.addListener(onMessage);
    } catch {
      /* no messages: the storage fallback still works */
    }
    try {
      c.storage?.onChanged?.addListener(onChanged);
    } catch {
      /* polling still works */
    }

    void (async () => {
      try {
        await session?.remove(FINISHED_KEY);
      } catch {
        /* nothing stale to clear */
      }
      progress(0);
      const msg: SiteTaskMessage = { siteTask: 'start', tasks };
      let reply: unknown = null;
      try {
        reply = await c.runtime.sendMessage(msg);
      } catch {
        reply = null;
      }
      if (settled) return;
      if (!reply || typeof reply !== 'object' || (reply as { ok?: unknown }).ok !== true) {
        finish(null);
        return;
      }
      started = true;
      poll = setInterval(() => void check(), POLL_MS);
    })();
  });
}
