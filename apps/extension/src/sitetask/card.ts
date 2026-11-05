// The task card on a real website (docs/design/ONBOARDING.md, round 8c, point 4): a white card at the bottom centre,
// 24 px from the edge and 520 px wide, with "WebAble · 2 of 3", "Find and click: **Sports**" at 26/600 and a quiet
// "Skip this one". A found click turns it into a green check with "Found it".
// Plain DOM in a closed shadow root, raised into the top layer with a manual popover. No CSS url(); no animation, so the
// prompt appears on its first frame.

const HOST_TAG = 'webable-task';

const CSS = /* css */ `
:host { all: initial; }
.card {
  position: fixed; inset: auto auto 24px 50%; transform: translateX(-50%); margin: 0;
  box-sizing: border-box; width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto;
  display: flex; flex-direction: column; gap: 8px; padding: 22px 24px 18px 28px;
  background: #ffffff; color: #16150f; border: 1px solid #e6e3dc; border-radius: 28px;
  box-shadow: 0 1px 2px rgba(22, 21, 15, 0.04), 0 12px 40px rgba(22, 21, 15, 0.10);
  --f: system-ui, -apple-system, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font: 400 18px/28px var(--f); -webkit-font-smoothing: antialiased; text-align: left; z-index: 2147483647; pointer-events: auto;
}
.card *, .card *::before, .card *::after { box-sizing: border-box; }
.eyebrow { margin: 0; font: 600 15px/22px var(--f); color: #5e5c55; letter-spacing: 0.01em; }
.ask { margin: 0; font: 600 26px/32px var(--f); color: #16150f; letter-spacing: -0.01em; }
.ask strong { font-weight: 700; }
.row { display: flex; justify-content: flex-end; margin-top: 2px; }
.skip {
  appearance: none; border: 0; background: transparent; color: #5e5c55; cursor: pointer;
  min-height: 48px; padding: 0 18px; margin-right: -10px; border-radius: 999px;
  font: 600 18px/1 var(--f);
}
.skip:hover { background: #f6f5f2; color: #16150f; }
.skip:focus-visible { outline: none; box-shadow: 0 0 0 3px #ffffff, 0 0 0 6px #17694a; }
.skip:disabled { opacity: 0.5; cursor: default; }
.found { display: none; align-items: center; gap: 14px; min-height: 64px; }
.card.is-found .found { display: flex; }
.card.is-found .eyebrow, .card.is-found .ask, .card.is-found .row { display: none; }
.check { flex: none; width: 40px; height: 40px; }
.found-text { font: 600 26px/32px var(--f); color: #17694a; }
`;

const CHECK_SVG =
  '<svg class="check" viewBox="0 0 40 40" aria-hidden="true" focusable="false">' +
  '<circle cx="20" cy="20" r="20" fill="#17694a"></circle>' +
  '<path d="M12 20.5l5.5 5.5L28.5 14.5" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path>' +
  '</svg>';

export interface TaskCard {
  /** The host element: events from inside the card reach page listeners retargeted to it. */
  host: HTMLElement;
  showFound(): void;
  disableSkip(): void;
  /** Re-attach and re-raise if the page removed us or put something above. */
  keepUp(): void;
  destroy(): void;
}

function shadowMode(): ShadowRootMode {
  try {
    return import.meta.env.MODE === 'e2e' ? 'open' : 'closed';
  } catch {
    return 'closed';
  }
}

export function mountCard(opts: { index: number; total: number; prompt: string; onSkip(): void }): TaskCard {
  const host = document.createElement(HOST_TAG);
  host.style.cssText =
    'all: initial; display: block; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: shadowMode() });

  let adopted = false;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sheet];
    adopted = true;
  } catch {
    /* fall back to a <style> element */
  }
  if (!adopted) {
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.append(style);
  }

  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('popover', 'manual');
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', 'WebAble');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = `WebAble · ${opts.index + 1} of ${opts.total}`;

  const ask = document.createElement('p');
  ask.className = 'ask';
  ask.setAttribute('aria-live', 'polite');
  const strong = document.createElement('strong');
  strong.textContent = opts.prompt.replace(/\.\s*$/, '');
  ask.append('Find and click: ', strong);

  const row = document.createElement('div');
  row.className = 'row';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'skip';
  skip.textContent = 'Skip this one';
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!skip.disabled) opts.onSkip();
  });
  row.append(skip);

  const found = document.createElement('div');
  found.className = 'found';
  found.setAttribute('role', 'status');
  found.innerHTML = CHECK_SVG;
  const foundText = document.createElement('span');
  foundText.className = 'found-text';
  foundText.textContent = 'Found it';
  found.append(foundText);

  card.append(eyebrow, ask, row, found);
  shadow.append(card);

  // Keys typed in the card must not reach page shortcuts.
  const stopKeys = (e: Event) => e.stopPropagation();
  for (const type of ['keydown', 'keyup', 'keypress'] as const) host.addEventListener(type, stopKeys);

  const supportsPopover = typeof (card as { showPopover?: unknown }).showPopover === 'function';
  const raise = () => {
    if (!supportsPopover) return;
    try {
      if (card.matches(':popover-open')) card.hidePopover();
      card.showPopover();
    } catch {
      /* not in the top layer: the fixed position and z-index still hold */
    }
  };

  document.documentElement.append(host);
  raise();

  let topCount = 0;
  return {
    host,
    showFound() {
      card.classList.add('is-found');
    },
    disableSkip() {
      skip.disabled = true;
    },
    keepUp() {
      if (!host.isConnected) {
        document.documentElement.append(host);
        raise();
        return;
      }
      if (!supportsPopover) return;
      // Re-raise when the page has opened its own popovers since (a page's modal dialog may sit above us).
      try {
        const open = document.querySelectorAll(':popover-open').length;
        if (!card.matches(':popover-open') || open !== topCount) raise();
        topCount = document.querySelectorAll(':popover-open').length;
      } catch {
        /* selector unsupported */
      }
    },
    destroy() {
      try {
        if (supportsPopover && card.matches(':popover-open')) card.hidePopover();
      } catch {
        /* already gone */
      }
      host.remove();
    },
  };
}
