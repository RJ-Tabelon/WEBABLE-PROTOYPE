// AI-generated. Tier 0 renderer PoC: tries user-origin CSS, then
// constructable stylesheets on open shadow roots, then a direct DOM
// fallback. Logs which tier succeeded and injection-call -> next-paint time.

function timeToNextPaint(startMark) {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve(performance.now() - startMark));
  });
}

// Tier 1: chrome.scripting.insertCSS with origin: 'USER'.
// Must be requested from the background service worker; user-origin
// stylesheets apply above author CSS and are not subject to the page's
// style-src CSP.
async function tryUserOriginCss() {
  const start = performance.now();
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: 'tier0-insert-user-css' });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  if (!response?.ok) return { ok: false, error: response?.error ?? 'unknown error' };
  const ms = await timeToNextPaint(start);
  return { ok: true, ms };
}

// Tier 2: constructable stylesheets via adoptedStyleSheets, for any open
// shadow roots we can discover by walking the light DOM. Closed shadow
// roots are unreachable from outside by spec, so this tier is a no-op for
// them (expected, not a bug).
function findOpenShadowRoots(root = document.body, found = []) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = root.matches?.('*') ? root : walker.nextNode();
  while (node) {
    if (node.shadowRoot) {
      found.push(node.shadowRoot);
      findOpenShadowRoots(node.shadowRoot, found);
    }
    node = walker.nextNode();
  }
  return found;
}

async function tryAdoptedStyleSheets() {
  const start = performance.now();
  const roots = findOpenShadowRoots(document.body);
  if (roots.length === 0) return { ok: false, error: 'no open shadow roots found' };

  let sheet;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(
      'p, li, button, a { font-size: 1.25em !important; line-height: 1.6 !important; }'
    );
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  for (const root of roots) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
  const ms = await timeToNextPaint(start);
  return { ok: true, ms, count: roots.length };
}

// Tier 3: direct DOM/inline-style fallback. Always available; last resort
// because it fights author !important with per-node inline !important and
// doesn't reach closed shadow roots either.
async function tryDomFallback() {
  const start = performance.now();
  const targets = document.body.querySelectorAll('p, li, button, a');
  for (const el of targets) {
    el.style.setProperty('font-size', '1.25em', 'important');
    el.style.setProperty('line-height', '1.6', 'important');
  }
  const ms = await timeToNextPaint(start);
  return { ok: targets.length > 0, ms, count: targets.length };
}

// Tier 1 (user-origin CSS, non-shadow-piercing selectors) only ever reaches
// light DOM — CSS scoping is a DOM-tree boundary, not a cascade-origin
// property, so it can't select into a shadow tree regardless of origin.
// Tier 2 (adoptedStyleSheets) is the one that can still reach *open*
// shadow roots. So we run tier 1 for the page, then separately check
// whether open shadow roots still need tier 2, then fall back to tier 3
// only if nothing has styled the page at all.
async function runTier0() {
  const log = (tier, result) =>
    console.log(`[tier0] ${location.href} — ${tier}:`, result);

  const t1 = await tryUserOriginCss();
  log('tier1 insertCSS(USER)', t1);

  const openRoots = findOpenShadowRoots(document.body);
  if (t1.ok && openRoots.length === 0) {
    console.log(`[tier0] SUCCEEDED at tier1 in ${t1.ms.toFixed(2)}ms (call->paint)`);
    return;
  }

  if (openRoots.length > 0) {
    const t2 = await tryAdoptedStyleSheets();
    log('tier2 adoptedStyleSheets', t2);
    if (t2.ok) {
      const summary = t1.ok
        ? `tier1 (light DOM) + tier2 (${t2.count} open shadow root(s))`
        : `tier2 (${t2.count} open shadow root(s))`;
      console.log(`[tier0] SUCCEEDED at ${summary} in ${t2.ms.toFixed(2)}ms (call->paint)`);
      if (t1.ok) return;
    }
  }

  if (t1.ok) {
    console.log(`[tier0] SUCCEEDED at tier1 in ${t1.ms.toFixed(2)}ms (call->paint)`);
    return;
  }

  const t3 = await tryDomFallback();
  log('tier3 DOM fallback', t3);
  console.log(`[tier0] SUCCEEDED at tier3 in ${t3.ms.toFixed(2)}ms (call->paint)`);
}

runTier0();
