/**
 * SPA route changes (engine.md 3.5). The Navigation API covers pushState and
 * replaceState; popstate and a cheap location check on each mutation flush
 * are the fallback. Hash-only changes are not routes. A change is reported
 * once the DOM has been quiet for `quietMs` (bounded by `maxWaitMs`).
 * The URL is compared locally and never stored or sent.
 */

interface NavigationLike {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export class RouteWatcher {
  private current: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline = 0;
  private readonly off: Array<() => void> = [];

  constructor(
    private readonly win: Window,
    private readonly onRoute: () => void,
    private readonly quietMs = 500,
    private readonly maxWaitMs = 3000,
  ) {
    this.current = this.key();
    const check = (): void => this.check();
    const nav = (win as Window & { navigation?: NavigationLike }).navigation;
    if (nav) {
      nav.addEventListener('currententrychange', check);
      this.off.push(() => nav.removeEventListener('currententrychange', check));
    }
    win.addEventListener('popstate', check);
    this.off.push(() => win.removeEventListener('popstate', check));
  }

  private key(): string {
    const l = this.win.location;
    return `${l.pathname}${l.search}`;
  }

  /** Call on DOM activity: detects a route change and extends the quiet wait. */
  check(): void {
    const k = this.key();
    if (k !== this.current) {
      this.current = k;
      this.deadline = performance.now() + this.maxWaitMs;
      this.arm();
    } else if (this.timer) {
      this.arm();
    }
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(
      0,
      Math.min(this.quietMs, this.deadline - performance.now()),
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onRoute();
    }, wait);
  }

  dispose(): void {
    for (const f of this.off.splice(0)) f();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
