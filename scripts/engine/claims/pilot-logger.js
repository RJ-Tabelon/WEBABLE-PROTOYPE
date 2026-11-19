// Pilot logger for the Alderra refill task (docs/CLAIMS.md, "Pilot"). Paste into the DevTools console of
// http://127.0.0.1:41741/demo/alderra/refill.html?reset=1 right before saying "go". Records nothing about the person:
// only times, click positions relative to controls, and which control was pressed. Result: window.__pilot and a
// console line Sid copies into the sheet (participant code, condition, order, seconds, misses, wrong presses);
// node scripts/engine/claims/pilot-summary.mjs pilot.csv turns the sheet into "N of 8 were faster" with a sign test.
(() => {
  const t0 = performance.now();
  const ACT =
    'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"], [tabindex]';
  const log = { presses: 0, misses: 0, nearMisses: 0, wrong: [], done: null };
  const nearest = (x, y) => {
    let best = Infinity;
    for (const el of document.querySelectorAll(ACT)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  };
  addEventListener(
    'pointerdown',
    (e) => {
      if (log.done) return;
      log.presses++;
      // WebAble's own UI (pill, offers, Calm view) is a closed shadow root: the page only sees its <webable-ui> host,
      // so presses there are counted apart and not judged. Run the pilot in tailored mode (Calm view closed) for misses.
      if (e.target instanceof Element && e.target.tagName === 'WEBABLE-UI') {
        log.uiPresses = (log.uiPresses ?? 0) + 1;
        return;
      }
      const hit = e.target instanceof Element ? e.target.closest(ACT) : null;
      if (!hit) {
        log.misses++;
        if (nearest(e.clientX, e.clientY) <= 24) log.nearMisses++;
        return;
      }
      const text = (hit.textContent || hit.getAttribute('aria-label') || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40);
      if (
        /continue shopping|add flu shot|alderra\+|add$|learn more|accept all|schedule now|join now/i.test(
          text,
        )
      )
        log.wrong.push(text);
    },
    true,
  );
  const obs = new MutationObserver(() => {
    if (!log.done && /Refill requested/i.test(document.body.innerText)) {
      log.done = Math.round((performance.now() - t0) / 100) / 10;
      obs.disconnect();
      window.__pilot = log;
      console.log(
        `PILOT seconds=${log.done} presses=${log.presses} misses=${log.misses} nearMisses=${log.nearMisses} wrong=${log.wrong.length} [${log.wrong.join(' | ')}]`,
      );
    }
  });
  obs.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  window.__pilot = log;
  console.log('PILOT started: the task ends when "Refill requested" appears.');
})();
