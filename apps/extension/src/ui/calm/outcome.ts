// Owner: C. What happened after the person pressed the page's main action: a confirmation (success), a list of
// problems (errors), or something else the page now shows. Read from the live page only; nothing is guessed.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { isShown, linesOf, textOf } from './model';

export interface Outcome {
  kind: 'success' | 'error' | 'other';
  el: Element;
  /** The page's own heading for it ("Refill requested ✓ Ready around 4:30 PM"). */
  heading: string;
  /** Up to three next-step lines from the page. */
  lines: string[];
  /** A reference number the page gave, if any. */
  ref: string | null;
  /** The dock's disabled button after success ("Refill requested ✓"). */
  doneLabel: string;
}

const SUCCESS_RE = /\b(thank you|thanks|confirm(ed|ation)|complete(d)?|submitted|reference|requested|received|success(ful(ly)?)?|saved|booked|scheduled|placed|sent)\b|✓/i;
const ERROR_RE = /\b(error|errors|fix|problem|required|enter (a|an|your)|select (a|an|the|how|your)|invalid|must|missing|try again|answer the)\b/i;
const REF_RE = /\b(?:reference|confirmation|order|case|application|tracking|request)\s*(?:number|no\.?|#|id|code)?\s*[:#]?\s*([A-Z]{0,4}[-#]?\d[A-Z0-9-]{3,})\b/i;
const WATCH = '[role=status],[role=alert],[aria-live],h1,h2,h3,[class*="success" i],[class*="confirm" i],[class*="error" i],[class*="thank" i]';
const WINDOW_MS = 8000;

function candidates(): Element[] {
  return Array.from(document.querySelectorAll(WATCH)).filter((e) => !e.closest('webable-ui'));
}

function visibleWithText(e: Element): boolean {
  return isShown(e) && textOf(e).length > 1 && e.getBoundingClientRect().height > 0;
}

function headingOf(el: Element): string {
  if (/^h[1-6]$/.test(el.localName)) return textOf(el);
  const h = el.querySelector('h1,h2,h3,h4,[role=heading],[class*="title" i]');
  if (h && textOf(h)) return textOf(h);
  return linesOf(el)[0] ?? textOf(el).slice(0, 120);
}

function doneLabelOf(heading: string): string {
  const tick = heading.indexOf('✓');
  if (tick > 0 && tick <= 40) return heading.slice(0, tick + 1).trim();
  const t = heading.replace(/[.!:]+$/, '').trim();
  if (t.length <= 28) return `${t} ✓`;
  return 'Done ✓';
}

export function readOutcome(el: Element, kind: Outcome['kind']): Outcome {
  // A status inside a heading-less wrapper: use the nearest block that holds the whole message.
  let box = el;
  if (/^h[1-6]$/.test(el.localName) && el.parentElement && textOf(el.parentElement).length < 600) box = el.parentElement;
  const heading = headingOf(box);
  const lines = linesOf(box).filter((l) => l !== heading && l.length > 3).slice(0, 3);
  const all = textOf(box);
  return { kind, el: box, heading, lines, ref: REF_RE.exec(all)?.[1] ?? null, doneLabel: doneLabelOf(heading) };
}

/** Errors the page shows now: an alert or summary with words that ask for a fix, or fields marked invalid. */
function findErrors(before: Set<Element>): Element | null {
  for (const e of candidates()) {
    if (before.has(e) || !visibleWithText(e)) continue;
    const role = e.getAttribute('role');
    const t = textOf(e);
    if ((role === 'alert' || /error/i.test(e.getAttribute('class') ?? '')) && ERROR_RE.test(t) && t.length < 1200) return e;
  }
  return null;
}

function findSuccess(before: Set<Element>): Element | null {
  for (const e of candidates()) {
    if (before.has(e) || !visibleWithText(e)) continue;
    const t = textOf(e);
    if (t.length > 600 || ERROR_RE.test(t.slice(0, 80)) && !SUCCESS_RE.test(t.slice(0, 80))) continue;
    if (SUCCESS_RE.test(t)) return e;
  }
  return null;
}

/**
 * Watch the page after the main action: within eight seconds, a new visible status, alert or heading decides the
 * outcome. Errors win over a success message shown at the same time.
 */
export function useOutcome(): { outcome: Outcome | null; arm: () => void; clear: () => void } {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const clear = useCallback(() => {
    stop.current?.();
    stop.current = null;
    setOutcome(null);
  }, []);
  const arm = useCallback(() => {
    stop.current?.();
    setOutcome((o) => (o?.kind === 'error' ? null : o));
    const before = new Set(candidates().filter(visibleWithText));
    const t0 = performance.now();
    let raf = 0;
    const check = (): void => {
      raf = 0;
      const err = findErrors(before);
      if (err) {
        setOutcome(readOutcome(err, 'error'));
        return;
      }
      const ok = findSuccess(before);
      if (ok) {
        setOutcome(readOutcome(ok, 'success'));
        done();
      }
    };
    const later = (): void => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    const mo = new MutationObserver((recs) => {
      if (recs.some((r) => !(r.target instanceof Element && r.target.closest('webable-ui')))) later();
    });
    mo.observe(document.body ?? document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-hidden', 'open'] });
    const poll = window.setInterval(() => {
      if (performance.now() - t0 > WINDOW_MS) done();
      else later();
    }, 400);
    function done(): void {
      mo.disconnect();
      window.clearInterval(poll);
      if (raf) cancelAnimationFrame(raf);
      if (stop.current === done) stop.current = null;
    }
    stop.current = done;
    later();
  }, []);
  useEffect(() => () => stop.current?.(), []);
  // A success or error that the page removes again (the person fixed the field, the page went back) clears itself.
  useEffect(() => {
    if (!outcome) return;
    const t = window.setInterval(() => {
      if (!outcome.el.isConnected || !isShown(outcome.el)) setOutcome(null);
    }, 1000);
    return () => window.clearInterval(t);
  }, [outcome]);
  return { outcome, arm, clear };
}
