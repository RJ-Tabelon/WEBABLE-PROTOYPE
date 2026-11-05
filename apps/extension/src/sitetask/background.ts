// The worker's side of the real-website tasks (docs/design/ONBOARDING.md, round 8c, point 4).
//
// The onboarding sends {siteTask:'start', tasks}. We open one task tab at the first site, answer that tab's
// {siteTask:'whoami'} with the current task, take each {siteTask:'done'} result and load the next site in the same tab.
// After the last site (or when the person closes the task tab early) the task tab closes, the onboarding tab comes back,
// and the onboarding gets {siteTask:'finished', results}, also written to chrome.storage.session as a fallback.
// A site whose card hasn't appeared 20 s after it started loading is skipped.
//
// State lives in chrome.storage.session so a worker restart mid-run carries on. Every event runs one at a time.
import {
  cleanResult,
  FINISHED_KEY,
  isRunState,
  isSiteTaskMessage,
  isTaskSpec,
  LOAD_TIMEOUT_MS,
  RUN_KEY,
  sameSite,
  skippedResult,
  type RunState,
  type WhoamiReply,
} from './shared';
import type { SiteTaskMessage, SiteTaskResult, SiteTaskSpec } from './types';

/** Where the onboarding tab is, so the task tab opens next to it and focus can come back to it. */
export interface Opener {
  tabId: number | null;
  windowId: number | null;
  index: number | null;
}

/** Everything the runner needs from Chrome, so tests can drive it with a fake. */
export interface SiteTaskHost {
  now(): number;
  load(): Promise<RunState | null>;
  save(state: RunState | null): Promise<void>;
  clearFinished(): Promise<void>;
  publishFinished(results: SiteTaskResult[]): Promise<void>;
  openTab(url: string, opener: Opener): Promise<number | null>;
  navigate(tabId: number, url: string): Promise<void>;
  closeTab(tabId: number): Promise<void>;
  focusTab(tabId: number, windowId: number | null): Promise<void>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export class SiteTaskRunner {
  /** undefined until loaded from storage. */
  private state: RunState | null | undefined = undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: unknown = null;

  constructor(private readonly host: SiteTaskHost) {}

  /** Read only, for tests and debugging. */
  get current(): RunState | null {
    return this.state ?? null;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async ensure(): Promise<RunState | null> {
    if (this.state === undefined) {
      try {
        this.state = await this.host.load();
      } catch {
        this.state = null;
      }
      this.arm();
    }
    return this.state;
  }

  private async persist(): Promise<void> {
    try {
      await this.host.save(this.state ?? null);
    } catch {
      /* storage full or gone: the in-memory run still works */
    }
  }

  private disarm(): void {
    if (this.timer !== null) this.host.clearTimer(this.timer);
    this.timer = null;
  }

  /** While the current site hasn't shown its card, skip it when its 20 s are up. */
  private arm(): void {
    this.disarm();
    const s = this.state;
    if (!s || s.arrived) return;
    const index = s.index;
    const wait = Math.max(0, s.loadStartedAt + LOAD_TIMEOUT_MS - this.host.now());
    this.timer = this.host.setTimer(() => {
      this.timer = null;
      void this.serial(() => this.timedOut(index));
    }, wait);
  }

  private async timedOut(index: number): Promise<void> {
    const s = await this.ensure();
    if (!s || s.index !== index || s.arrived) return;
    if (this.host.now() < s.loadStartedAt + LOAD_TIMEOUT_MS - 50) {
      this.arm();
      return;
    }
    const task = s.tasks[s.index];
    if (task) s.results.push(skippedResult(task));
    await this.advance();
  }

  /** On to the next site in the same tab, or finish after the last. */
  private async advance(): Promise<void> {
    const s = this.state;
    if (!s) return;
    s.index += 1;
    const next = s.tasks[s.index];
    if (!next) {
      await this.finish({ closeTask: true, focus: true });
      return;
    }
    s.loadStartedAt = this.host.now();
    s.arrived = false;
    await this.persist();
    this.arm();
    try {
      await this.host.navigate(s.taskTabId, next.url);
    } catch {
      // The task tab is gone: finish with what we have.
      await this.finish({ closeTask: false, focus: true });
    }
  }

  private async finish(how: { closeTask: boolean; focus: boolean }): Promise<void> {
    const s = this.state;
    if (!s) return;
    this.disarm();
    const results = s.tasks.map((t) => s.results.find((r) => r.id === t.id) ?? skippedResult(t));
    this.state = null;
    await this.persist();
    if (how.closeTask) await this.host.closeTab(s.taskTabId).catch(() => undefined);
    if (how.focus && s.fittingTabId !== null) {
      await this.host.focusTab(s.fittingTabId, s.fittingWindowId).catch(() => undefined);
    }
    await this.host.publishFinished(results).catch(() => undefined);
  }

  /** Worker start: pick up a run that was in progress and re-arm its load timer. */
  resume(): Promise<void> {
    return this.serial(async () => {
      await this.ensure();
    });
  }

  /** Start a run. False when nothing could be opened (the onboarding then carries on without real sites). */
  start(tasks: SiteTaskSpec[], opener: Opener): Promise<boolean> {
    return this.serial(async () => {
      const prior = await this.ensure();
      if (prior) {
        // A run left over from an earlier onboarding: close its tab quietly.
        this.disarm();
        this.state = null;
        await this.host.closeTab(prior.taskTabId).catch(() => undefined);
      }
      await this.host.clearFinished().catch(() => undefined);
      const valid = tasks.filter(isTaskSpec);
      const first = valid[0];
      if (!first) {
        await this.persist();
        return false;
      }
      let tabId: number | null = null;
      try {
        tabId = await this.host.openTab(first.url, opener);
      } catch {
        tabId = null;
      }
      if (tabId === null) {
        await this.persist();
        return false;
      }
      this.state = {
        taskTabId: tabId,
        fittingTabId: opener.tabId,
        fittingWindowId: opener.windowId,
        tasks: valid,
        index: 0,
        results: [],
        loadStartedAt: this.host.now(),
        arrived: false,
      };
      await this.persist();
      this.arm();
      return true;
    });
  }

  whoami(tabId: number, url: string): Promise<WhoamiReply | null> {
    return this.serial(async () => {
      const s = await this.ensure();
      if (!s || tabId !== s.taskTabId) return null;
      const task = s.tasks[s.index];
      if (!task) return { task: null };
      if (!sameSite(url, task.url)) {
        // The task tab left the site (a redirect, a form). Stay quiet; if the card had shown, give it 20 s to come back.
        if (s.arrived) {
          s.arrived = false;
          s.loadStartedAt = this.host.now();
          await this.persist();
          this.arm();
        }
        return { task: null };
      }
      if (!s.arrived) {
        s.arrived = true;
        this.disarm();
        await this.persist();
      }
      return { task, index: s.index, total: s.tasks.length };
    });
  }

  done(tabId: number, raw: unknown): Promise<void> {
    return this.serial(async () => {
      const s = await this.ensure();
      if (!s || tabId !== s.taskTabId) return;
      const task = s.tasks[s.index];
      const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : undefined;
      if (!task || id !== task.id) return; // late or stale report
      s.results.push(cleanResult(task, raw));
      await this.advance();
    });
  }

  tabRemoved(tabId: number): Promise<void> {
    return this.serial(async () => {
      const s = await this.ensure();
      if (!s) return;
      if (tabId === s.taskTabId) await this.finish({ closeTask: false, focus: true });
      else if (tabId === s.fittingTabId) await this.finish({ closeTask: true, focus: false });
    });
  }
}

function chromeHost(): SiteTaskHost {
  return {
    now: () => Date.now(),
    async load() {
      const got = await chrome.storage.session.get(RUN_KEY);
      const v: unknown = got[RUN_KEY];
      return isRunState(v) ? v : null;
    },
    async save(state) {
      if (state) await chrome.storage.session.set({ [RUN_KEY]: state });
      else await chrome.storage.session.remove(RUN_KEY);
    },
    async clearFinished() {
      await chrome.storage.session.remove(FINISHED_KEY);
    },
    async publishFinished(results) {
      await chrome.storage.session.set({ [FINISHED_KEY]: { results, at: Date.now() } }).catch(() => undefined);
      const msg: SiteTaskMessage = { siteTask: 'finished', results };
      await chrome.runtime.sendMessage(msg).catch(() => undefined);
    },
    async openTab(url, opener) {
      const props: chrome.tabs.CreateProperties = { url, active: true };
      if (opener.windowId !== null) props.windowId = opener.windowId;
      if (opener.index !== null) props.index = opener.index + 1;
      if (opener.tabId !== null) props.openerTabId = opener.tabId;
      try {
        const tab = await chrome.tabs.create(props);
        return tab.id ?? null;
      } catch {
        const tab = await chrome.tabs.create({ url, active: true });
        return tab.id ?? null;
      }
    },
    async navigate(tabId, url) {
      await chrome.tabs.update(tabId, { url });
    },
    async closeTab(tabId) {
      await chrome.tabs.remove(tabId);
    },
    async focusTab(tabId, windowId) {
      await chrome.tabs.update(tabId, { active: true });
      if (windowId !== null) await chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}

function fromOurPage(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  const base = chrome.runtime.getURL('');
  return typeof sender.url === 'string' && sender.url.startsWith(base);
}

/** Called once from the worker (entrypoints/background.ts). Handles only messages that carry a `siteTask` field. */
export function registerSiteTasks(): void {
  const runner = new SiteTaskRunner(chromeHost());

  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (!isSiteTaskMessage(msg)) return false;
    if (sender.id !== chrome.runtime.id) return false;
    switch (msg.siteTask) {
      case 'start': {
        if (!fromOurPage(sender) || !Array.isArray(msg.tasks)) {
          sendResponse({ ok: false });
          return false;
        }
        const tab = sender.tab;
        const opener: Opener = { tabId: tab?.id ?? null, windowId: tab?.windowId ?? null, index: tab?.index ?? null };
        runner.start(msg.tasks, opener).then(
          (ok) => sendResponse({ ok }),
          () => sendResponse({ ok: false }),
        );
        return true;
      }
      case 'whoami': {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          sendResponse(null);
          return false;
        }
        const url = sender.url ?? sender.tab?.url ?? '';
        runner.whoami(tabId, url).then(
          (reply) => sendResponse(reply),
          () => sendResponse(null),
        );
        return true;
      }
      case 'done': {
        const tabId = sender.tab?.id;
        if (tabId === undefined) return false;
        runner.done(tabId, msg.result).then(
          () => sendResponse({ ok: true }),
          () => sendResponse({ ok: false }),
        );
        return true;
      }
      default:
        return false; // 'finished' goes out from here; nothing to answer
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void runner.tabRemoved(tabId);
  });

  void runner.resume();
}
