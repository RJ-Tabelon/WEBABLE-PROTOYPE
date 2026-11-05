// Owner: C1. SPA navigation detection and DOM-quiet waits.
//
// Per the engineering brief (§13.1): act on the Navigation API's `navigatesuccess` (with `currententrychange`
// as a backup), never on `navigate` alone, which fires before the router renders. Then wait for a quiet DOM:
// no childList mutations for 400 ms, capped at 2 s. Without the Navigation API, fall back to popstate,
// hashchange and a 1 s URL poll.

const OUR_TAG = 'WEBABLE-UI';

function isOurs(node: Node): boolean {
  let n: Node | null = node;
  while (n) {
    if (n.nodeType === 1 && (n as Element).tagName === OUR_TAG) return true;
    n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null);
  }
  return false;
}

/** Resolve once no childList mutations (outside our own UI) happened for `quietMs`, or after `capMs`. */
export function waitForQuiet(quietMs = 400, capMs = 2000): Promise<{ waitedMs: number; capped: boolean }> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const root = document.documentElement;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    const finish = (capped: boolean) => {
      if (finished) return;
      finished = true;
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(capTimer);
      mo.disconnect();
      resolve({ waitedMs: Math.round(performance.now() - t0), capped });
    };
    const arm = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(false), quietMs);
    };
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type !== 'childList') continue;
        if (isOurs(r.target)) continue;
        arm();
        return;
      }
    });
    const capTimer = setTimeout(() => finish(true), capMs);
    mo.observe(root, { childList: true, subtree: true });
    arm();
  });
}

/** Resolve when the document has loaded (or after `capMs`). */
export function waitForLoad(capMs = 1500): Promise<void> {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, capMs);
    function done() {
      clearTimeout(t);
      window.removeEventListener('load', done);
      resolve();
    }
    window.addEventListener('load', done, { once: true });
  });
}

/** Resolve when the tab is visible ("do nothing in hidden tabs"). */
export function waitForVisible(): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', on);
      resolve();
    };
    document.addEventListener('visibilitychange', on);
  });
}

/** A URL key that changes on route changes but not on in-page anchors (#section). */
export function routeKey(href: string): string {
  try {
    const u = new URL(href);
    // Hash routers (#/path or #!/path) count as routes; plain anchors do not.
    const hashRoute = /^#!?\//.test(u.hash) ? u.hash : '';
    return `${u.origin}${u.pathname}${u.search}${hashRoute}`;
  } catch {
    return href;
  }
}

interface NavigationLike extends EventTarget {
  currentEntry?: { url: string | null } | null;
}

/**
 * Watch for same-document navigations. `onNavigate` runs after the new route has rendered
 * (DOM quiet 400 ms, 2 s cap). Returns a stop function.
 */
export function watchNavigation(onNavigate: (url: string) => void, opts: { quietMs?: number; capMs?: number } = {}): () => void {
  const quietMs = opts.quietMs ?? 400;
  const capMs = opts.capMs ?? 2000;
  let lastKey = routeKey(location.href);
  let pending = 0; // generation counter: only the latest navigation fires
  let stopped = false;

  const check = () => {
    if (stopped) return;
    const key = routeKey(location.href);
    if (key === lastKey) return;
    lastKey = key;
    const gen = ++pending;
    void waitForQuiet(quietMs, capMs).then(() => {
      if (stopped || gen !== pending) return;
      onNavigate(location.href);
    });
  };

  const cleanups: Array<() => void> = [];
  const nav = (globalThis as { navigation?: NavigationLike }).navigation;
  if (nav && typeof nav.addEventListener === 'function') {
    const onSuccess = () => check();
    nav.addEventListener('navigatesuccess', onSuccess);
    nav.addEventListener('currententrychange', onSuccess);
    cleanups.push(() => {
      nav.removeEventListener('navigatesuccess', onSuccess);
      nav.removeEventListener('currententrychange', onSuccess);
    });
  } else {
    const on = () => check();
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    const poll = setInterval(check, 1000);
    cleanups.push(() => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('hashchange', on);
      clearInterval(poll);
    });
  }
  // A slow poll as a final backstop (some routers replace history in ways the events above miss).
  const backstop = setInterval(check, 2500);
  cleanups.push(() => clearInterval(backstop));

  return () => {
    stopped = true;
    for (const c of cleanups) c();
  };
}

/** Two animation frames: styles and layout from the last write have been applied. */
export function twoFrames(): Promise<void> {
  return new Promise((resolve) => {
    // rAF does not run in background tabs; fall back to a timeout.
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        resolve();
      }
    }, 120);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve();
      }),
    );
  });
}

/** Settle after a write phase: two frames plus `document.fonts.ready` (capped). */
export async function settle(fontCapMs = 400): Promise<void> {
  await twoFrames();
  await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, fontCapMs))]);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
