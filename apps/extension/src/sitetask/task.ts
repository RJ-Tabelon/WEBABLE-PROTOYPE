// Task mode in the content script (docs/design/ONBOARDING.md, round 8c, point 4).
//
// In the task tab WebAble changes nothing on the page: no engine, no in-page button. We show one card ("Find and click:
// …"), let buttons, menus and scrolling work normally, stop link clicks from navigating, and measure: the time from the
// card's first paint to the found click, other clicks, near-misses (within 24 px of a target's box), slips (a press that
// lets go on something else), scrolling in screen heights, whether something moved in view, and how many ads showed.
// A found click shows "Found it" for 700 ms, then the result goes to the worker, which loads the next site.
import { mountCard, type TaskCard } from './card';
import { clickMatchesTarget, findClickable, findLink, findTargets, isNearMiss, isShown, type Box } from './match';
import { FOUND_HOLD_MS, RUN_KEY, type WhoamiReply } from './shared';
import { countAds, MotionWatch } from './signals';
import type { SiteTaskMessage, SiteTaskResult, SiteTaskSpec } from './types';

type Send = (msg: SiteTaskMessage) => Promise<unknown>;

const defaultSend: Send = (msg) => chrome.runtime.sendMessage(msg);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(undefined);
      },
    );
  });
}

function asWhoami(v: unknown): WhoamiReply | null {
  if (!v || typeof v !== 'object' || !('task' in v)) return null;
  const r = v as { task: unknown; index?: unknown; total?: unknown };
  if (r.task === null) return { task: null };
  const t = r.task as Partial<SiteTaskSpec> | undefined;
  if (!t || typeof t.id !== 'string' || typeof t.prompt !== 'string' || !t.target) return null;
  const index = typeof r.index === 'number' ? r.index : 0;
  const total = typeof r.total === 'number' ? r.total : 1;
  return { task: t as SiteTaskSpec, index, total };
}

/**
 * Asks the worker whether this tab is the onboarding's task tab. Answers fast on ordinary pages; if the worker is slow
 * and a run is in progress, waits a little longer so a task page never starts the engine by mistake.
 */
export async function askWhoami(timeoutMs = 700): Promise<WhoamiReply | null> {
  const msg: SiteTaskMessage = { siteTask: 'whoami' };
  let reply: unknown;
  try {
    reply = await withTimeout(chrome.runtime.sendMessage(msg), timeoutMs);
  } catch {
    reply = undefined;
  }
  if (reply !== undefined) return asWhoami(reply);
  // No answer in time. Only worth waiting longer when a run is in progress.
  let running = false;
  try {
    const got = await withTimeout(chrome.storage.session.get(RUN_KEY), 300);
    running = !!got && RUN_KEY in got;
  } catch {
    running = false;
  }
  if (!running) return null;
  try {
    reply = await withTimeout(chrome.runtime.sendMessage(msg), 3000);
  } catch {
    reply = undefined;
  }
  return asWhoami(reply);
}

/** Does following this link leave the page? Same-page #jumps and javascript: links act like buttons, so they work. */
export function linkNavigates(link: HTMLAnchorElement | HTMLAreaElement, here: string): boolean {
  const raw = (link.getAttribute('href') ?? '').trim();
  if (!raw) return false;
  if (/^javascript:/i.test(raw)) return false;
  if (link.target && link.target !== '_self') return true;
  let url: URL;
  try {
    url = new URL(raw, here);
  } catch {
    return false;
  }
  const cur = new URL(here);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true; // mailto:, tel:, other apps
  const same = url.origin === cur.origin && url.pathname === cur.pathname && url.search === cur.search;
  return !(same && (url.hash !== '' || raw.startsWith('#')));
}

function deepTarget(e: Event): Element | null {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  const first = path[0] ?? e.target;
  if (first instanceof Element) return first;
  if (first instanceof Node) return first.parentElement;
  return null;
}

/** What a press is "on": the clickable it's inside, or the element itself. */
function pressUnit(el: Element | null): Element | null {
  return el ? findClickable(el) ?? el : null;
}

function idle(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') ric(() => resolve(), { timeout: timeoutMs });
    else setTimeout(resolve, 200);
  });
}

function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export interface TaskInfo {
  task: SiteTaskSpec;
  index: number;
  total: number;
}

/** Runs the task on this page. Returns a stop function (removes the card and every listener). */
export function runTaskMode(info: TaskInfo, send: Send = defaultSend): () => void {
  const { task } = info;
  let phase: 'waiting' | 'running' | 'done' = 'waiting';
  let stopped = false;
  let card: TaskCard | null = null;
  let shownAt = 0;
  let foundAt = 0;

  const m = {
    wrongClicks: 0,
    nearMisses: 0,
    slips: 0,
    presses: 0,
    scrolled: 0,
    motionSeen: false,
    adsSeen: 0,
  };

  const isOurs = (e: Event): boolean => !!card && typeof e.composedPath === 'function' && e.composedPath().includes(card.host);
  const isOurEl = (el: Element): boolean => !!card && (el === card.host || card.host.contains(el));
  const motion = new MotionWatch(isOurEl);

  /* ---------------- presses and slips ---------------- */
  const downs = new Map<number, { unit: Element | null; x: number; y: number; dragged: boolean }>();
  // A press that starts on our card and lets go on the page ends in a click on their common ancestor: not the page's.
  let lastDownOurs = false;
  const onPointerDown = (e: PointerEvent) => {
    lastDownOurs = isOurs(e);
    if (!e.isTrusted || lastDownOurs) return;
    motion.noteInput(performance.now());
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (phase === 'running') m.presses++;
    downs.set(e.pointerId, { unit: pressUnit(deepTarget(e)), x: e.clientX, y: e.clientY, dragged: false });
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = downs.get(e.pointerId);
    downs.delete(e.pointerId);
    if (!d || !e.isTrusted || isOurs(e) || phase !== 'running') return;
    // A long drag (selecting text, a scrollbar) isn't a slip; a press that lets go on something else is.
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 80) return;
    if (pressUnit(deepTarget(e)) !== d.unit) m.slips++;
  };
  const onPointerCancel = (e: PointerEvent) => {
    const d = downs.get(e.pointerId);
    downs.delete(e.pointerId);
    // A press on a link that moved far enough to start dragging it slipped off what it was pressing.
    if (d?.dragged && phase === 'running') m.slips++;
  };
  // No dragging links or images away during a task (a drop on the tab strip would open them). Chrome then keeps
  // sending the press's pointer events, so a press that drifts off its link still ends in pointerup as a slip.
  const onDragStart = (e: DragEvent) => {
    if (isOurs(e)) return;
    for (const d of downs.values()) d.dragged = true;
    e.preventDefault();
  };

  /* ---------------- clicks ---------------- */
  const targetBoxes = (): Box[] => {
    const out: Box[] = [];
    for (const el of findTargets(document, task.target)) {
      if (!isShown(el)) continue;
      const r = el.getBoundingClientRect();
      out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    return out;
  };

  const onClick = (e: MouseEvent) => {
    if (isOurs(e)) return;
    const el = deepTarget(e);
    const link = findLink(el);
    const isTarget = phase === 'running' && e.isTrusted && clickMatchesTarget(el, task.target);
    if (isTarget || (link && linkNavigates(link, location.href))) {
      // Link clicks never navigate while the task is on; the found click does nothing else either.
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    if (phase !== 'running' || !e.isTrusted) return;
    if (e.detail > 0 && lastDownOurs && !isTarget) return;
    if (isTarget) {
      void found();
      return;
    }
    m.wrongClicks++;
    // Keyboard activation has no position (detail 0), so it can't be a near-miss.
    if (e.detail > 0) {
      try {
        if (isNearMiss(e.clientX, e.clientY, targetBoxes())) m.nearMisses++;
      } catch {
        /* layout unavailable */
      }
    }
  };
  // Middle-click and other buttons on a link would open it in a new tab.
  const onAuxClick = (e: MouseEvent) => {
    if (isOurs(e)) return;
    const link = findLink(deepTarget(e));
    if (link && linkNavigates(link, location.href)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  /* ---------------- scrolling ---------------- */
  let lastWinY = window.scrollY;
  const lastElY = new WeakMap<Element, number>();
  const onScroll = (e: Event) => {
    const t = e.target;
    let delta = 0;
    if (t === document || t === document.documentElement || t === document.body) {
      const y = window.scrollY;
      delta = Math.abs(y - lastWinY);
      lastWinY = y;
    } else if (t instanceof Element) {
      if (isOurEl(t)) return;
      const y = t.scrollTop;
      delta = Math.abs(y - (lastElY.get(t) ?? y));
      lastElY.set(t, y);
    }
    if (phase === 'running') m.scrolled += delta;
  };
  const onInput = () => motion.noteInput(performance.now());

  const opts: AddEventListenerOptions = { capture: true };
  window.addEventListener('pointerdown', onPointerDown, opts);
  window.addEventListener('pointerup', onPointerUp, opts);
  window.addEventListener('pointercancel', onPointerCancel, opts);
  window.addEventListener('click', onClick, opts);
  window.addEventListener('auxclick', onAuxClick, opts);
  window.addEventListener('dragstart', onDragStart, opts);
  window.addEventListener('wheel', onInput, { capture: true, passive: true });
  window.addEventListener('keydown', onInput, opts);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  /* ---------------- ticks: motion, ads, keeping the card up ---------------- */
  let ticker: ReturnType<typeof setInterval> | null = null;
  const adChecks = [0, 3000, 8000];
  const tick = () => {
    if (stopped || !card) return;
    card.keepUp();
    if (phase !== 'running') return;
    const now = performance.now();
    if (!m.motionSeen && motion.check(now)) m.motionSeen = true;
    while (adChecks.length && now - shownAt >= (adChecks[0] ?? 0)) {
      adChecks.shift();
      try {
        m.adsSeen = Math.max(m.adsSeen, countAds(document, isOurEl));
      } catch {
        /* keep what we have */
      }
    }
  };

  /** One last look at motion and ads before reporting. */
  const finalLook = () => {
    try {
      if (!m.motionSeen && motion.check(performance.now())) m.motionSeen = true;
      if (adChecks.length) m.adsSeen = Math.max(m.adsSeen, countAds(document, isOurEl));
    } catch {
      /* keep what we have */
    }
  };

  /* ---------------- reporting ---------------- */
  const result = (over: Partial<SiteTaskResult>): SiteTaskResult => ({
    id: task.id,
    name: task.name,
    busy: task.busy,
    found: false,
    skipped: false,
    ms: null,
    wrongClicks: m.wrongClicks,
    nearMisses: m.nearMisses,
    slips: m.slips,
    presses: m.presses,
    scrollScreens: Math.round((m.scrolled / Math.max(1, window.innerHeight)) * 10) / 10,
    motionSeen: m.motionSeen,
    adsSeen: m.adsSeen,
    ...over,
  });

  const report = async (r: SiteTaskResult) => {
    const msg: SiteTaskMessage = { siteTask: 'done', result: r };
    for (let attempt = 0; attempt < 3 && !stopped; attempt++) {
      try {
        await send(msg);
        return;
      } catch {
        await new Promise((res) => setTimeout(res, 400));
      }
    }
  };

  const found = async () => {
    if (phase !== 'running') return;
    foundAt = performance.now();
    phase = 'done';
    finalLook();
    card?.disableSkip();
    card?.showFound();
    const r = result({ found: true, ms: Math.round(foundAt - shownAt) });
    await new Promise((res) => setTimeout(res, FOUND_HOLD_MS));
    if (!stopped) await report(r);
  };

  const skip = () => {
    if (phase === 'done') return;
    const wasRunning = phase === 'running';
    phase = 'done';
    if (wasRunning) finalLook();
    card?.disableSkip();
    void report(result({ skipped: true }));
  };

  /* ---------------- start: card after the page is idle, timer from its first paint ---------------- */
  void (async () => {
    await idle(2000);
    if (stopped) return;
    card = mountCard({ index: info.index, total: info.total, prompt: task.prompt, onSkip: skip });
    await afterPaint();
    if (stopped) return;
    shownAt = performance.now();
    lastWinY = window.scrollY;
    phase = 'running';
    tick();
    ticker = setInterval(tick, 1000);
  })();

  return () => {
    stopped = true;
    if (ticker !== null) clearInterval(ticker);
    window.removeEventListener('pointerdown', onPointerDown, opts);
    window.removeEventListener('pointerup', onPointerUp, opts);
    window.removeEventListener('pointercancel', onPointerCancel, opts);
    window.removeEventListener('click', onClick, opts);
    window.removeEventListener('auxclick', onAuxClick, opts);
    window.removeEventListener('dragstart', onDragStart, opts);
    window.removeEventListener('wheel', onInput, opts);
    window.removeEventListener('keydown', onInput, opts);
    document.removeEventListener('scroll', onScroll, opts);
    card?.destroy();
    card = null;
  };
}
