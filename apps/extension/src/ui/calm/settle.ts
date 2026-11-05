// Owner: D (round 10). When a group laid out for the person may take the place of the page's own words on the WebAble
// page. In the first 8 s after the page opened, and before the person scrolls, clicks or types in it, any group may
// settle in (top to bottom); after that only a group that is entirely off screen changes, so nothing moves while they
// read. A group above the reading position keeps the reading position where it is.

export const SETTLE_GRACE_MS = 8000;
/** In the first moments a ready group waits this long for groups above it, so the page settles top to bottom. */
export const ORDER_WAIT_MS = 1200;
/** Scrolling has stopped once no scroll event came for this long. */
export const SCROLL_END_MS = 140;

export interface Box { top: number; bottom: number }

/** Pure rule: may a ready group switch to its layout now? `box` null: not laid out (nothing on screen moves). */
export function maySwitch(o: { sinceOpenMs: number; interacted: boolean; box: Box | null; view: Box }): boolean {
  if (!o.interacted && o.sinceOpenMs <= SETTLE_GRACE_MS) return true;
  if (!o.box || o.box.bottom - o.box.top <= 0) return true;
  return o.box.bottom <= o.view.top || o.box.top >= o.view.bottom;
}

/** Pure rule: in the first moments, a group waits for an earlier group that is still being laid out (for a while). */
export function waitsForEarlier(o: { inGrace: boolean; earlierWaiting: boolean; readyForMs: number }): boolean {
  return o.inGrace && o.earlierWaiting && o.readyForMs < ORDER_WAIT_MS;
}

/** One per open WebAble page: what each group shows, and who waits for scrolling to stop. */
export interface SettleCtl {
  openedAt: number;
  interacted: boolean;
  /** What each group shows now ('composed' once it settled in; the person's choice after they pressed its mark). */
  shown: Map<string, 'composed' | 'own'>;
  /** Groups the person switched with the mark: never switched by WebAble again. */
  user: Set<string>;
  /** Groups that already settled in once (the soft motion plays only the first time). */
  settled: Set<string>;
  scroller(): HTMLElement | null;
  inGrace(now?: number): boolean;
  markInteracted(): void;
  /** Call `check` again whenever scrolling stops (and once the person first interacts); returns the way to stop. */
  wait(check: () => void): () => void;
  /** The scroll container scrolled. */
  scrolled(): void;
  dispose(): void;
}

export function createSettle(scroller: () => HTMLElement | null, now: () => number = () => performance.now()): SettleCtl {
  const waiters = new Set<() => void>();
  let timer = 0;
  const run = (): void => {
    for (const w of Array.from(waiters)) w();
  };
  const ctl: SettleCtl = {
    openedAt: now(),
    interacted: false,
    shown: new Map(),
    user: new Set(),
    settled: new Set(),
    scroller,
    inGrace: (t = now()) => !ctl.interacted && t - ctl.openedAt <= SETTLE_GRACE_MS,
    markInteracted: () => {
      ctl.interacted = true;
    },
    wait: (check) => {
      waiters.add(check);
      return () => {
        waiters.delete(check);
      };
    },
    scrolled: () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, SCROLL_END_MS);
    },
    dispose: () => {
      window.clearTimeout(timer);
      waiters.clear();
    },
  };
  return ctl;
}
