/**
 * SPA route changes (engine.md 3.5). The Navigation API covers pushState and
 * replaceState; popstate and a cheap location check on each mutation flush
 * are the fallback. A change is reported once the DOM has been quiet for
 * `quietMs` (bounded by `maxWaitMs`). The URL is compared locally and never
 * stored or sent.
 *
 * Hash routes count as page views (docs/10 §4.5): `#/...` and `#!/...`, and
 * Gmail-style routes (`#inbox`, `#inbox/<id>`, `#search/<q>`, `#label/<l>`)
 * when no element in the document has that id or name. Document anchors
 * (`#section-2` with a matching element) stay local and change nothing.
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
  /** Classifications of hash values seen in this document (an anchor stays an anchor). */
  private readonly hashes = new Map<string, boolean>();

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
    win.addEventListener('hashchange', check);
    this.off.push(() => win.removeEventListener('hashchange', check));
    if (!nav) {
      const poll = setInterval(() => {
        if (this.key() !== this.current) this.check();
      }, 500);
      this.off.push(() => clearInterval(poll));
    }
  }

  private key(): string {
    const l = this.win.location;
    return `${l.pathname}${l.search}${this.routeHash(l.hash)}`;
  }

  /** The hash when it is a route, '' when it is a document anchor or empty. */
  private routeHash(hash: string): string {
    if (!hash || hash === '#') return '';
    let route = this.hashes.get(hash);
    if (route === undefined) {
      route = isRouteHash(hash, this.win.document);
      // Decided once per value: a target rendered later must not flip it.
      if (this.hashes.size >= 64) this.hashes.clear();
      this.hashes.set(hash, route);
    }
    return route ? hash : '';
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

/** A route segment: a word-like name, as in `#inbox`, `#search/...`, `#label/...`. */
const ROUTE_NAME = /^[A-Za-z][\w-]*$/;

/**
 * Whether a location hash names an app route rather than a place in the
 * document. `#/` and `#!/` always do. `#name` and `#name/...` do when the
 * first segment is word-like and no element has the whole fragment or that
 * name as its id or name; `#top` (the page top) never does.
 */
export function isRouteHash(hash: string, doc: Document): boolean {
  if (/^#!?\//.test(hash)) return true;
  let fragment = hash.slice(1);
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    // keep it as is
  }
  const name = fragment.split('/')[0] ?? '';
  if (!ROUTE_NAME.test(name) || name.toLowerCase() === 'top') return false;
  const target = (id: string): boolean =>
    doc.getElementById(id) !== null || doc.getElementsByName(id).length > 0;
  return !target(fragment) && !target(name);
}
