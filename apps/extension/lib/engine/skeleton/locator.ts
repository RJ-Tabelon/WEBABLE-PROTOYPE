import { cyrb53 } from '../util/hash';
import { composedKids, composedParentOf, type OpenClosed } from './dom';
import { explicitRole } from './roles';
import { nameKey } from './text';

/**
 * In-page structural paths (the registry's locators, docs/10 §4.4).
 *
 * A path is a list of steps through the composed tree, from <body> (or from
 * a record's root, for slots) down to the element. A step is `tag` or
 * `tag[role]` (the element's own localName and explicit role), followed by
 * `:i`, its index among same-signature siblings, only when it has such
 * siblings. These paths are DOM-structural and are meaningful only to
 * `matchPath`/`resolve` in a page; the cache's skeleton-structural locators
 * are built separately, in the service worker (core/skeleton/locate.ts).
 */

export function stepSig(el: Element): string {
  const r = explicitRole(el);
  return r ? `${el.localName}[${r}]` : el.localName;
}

export function parseStep(step: string): { sig: string; index: number | null } {
  const m = /^(.*?)(?::(\d+))?$/.exec(step);
  const sig = m?.[1] ?? step;
  const idx = m?.[2];
  return { sig, index: idx === undefined ? null : Number(idx) };
}

/** Steps from `root` (exclusive) down to `el`; null when `el` is not under `root`. */
export function domPath(
  el: Element,
  root: Element,
  openClosed?: OpenClosed,
): string[] | null {
  const steps: string[] = [];
  let cur: Element | null = el;
  for (let i = 0; cur && cur !== root; i++) {
    if (i > 256) return null;
    const parent: Element | null = composedParentOf(cur, openClosed);
    if (!parent) return null;
    const sig = stepSig(cur);
    let count = 0;
    let index = -1;
    for (const k of composedKids(parent, openClosed)) {
      if (stepSig(k) !== sig) continue;
      if (k === cur) index = count;
      count++;
    }
    if (index < 0) return null;
    steps.unshift(count > 1 ? `${sig}:${index}` : sig);
    cur = parent;
  }
  return cur === root ? steps : null;
}

/**
 * Elements under `root` that the steps lead to. At each level the indexed
 * sibling is tried first; when it leads to a match no other sibling is
 * explored (the match is unique by construction). Otherwise every
 * same-signature sibling is explored, so a sibling inserted or removed
 * since the path was taken does not break it. At most `limit` results.
 * `accept` vets the element a path ends on (a record's subject span, not
 * the label badge that took its index).
 */
export function matchPath(
  root: Element,
  steps: readonly string[],
  openClosed?: OpenClosed,
  limit = 2,
  budget = 4000,
  accept?: (el: Element) => boolean,
): Element[] {
  const out: Element[] = [];
  if (steps.length === 0) return out;
  const parsed = steps.map(parseStep);
  let visits = 0;
  const go = (cur: Element, i: number): void => {
    if (out.length >= limit || ++visits > budget) return;
    if (i === parsed.length) {
      if (!accept || accept(cur)) out.push(cur);
      return;
    }
    const { sig, index } = parsed[i] as { sig: string; index: number | null };
    const cands = composedKids(cur, openClosed).filter(
      (k) => stepSig(k) === sig,
    );
    if (index !== null && index < cands.length) {
      const before = out.length;
      go(cands[index] as Element, i + 1);
      if (out.length > before) return;
    }
    for (const [j, c] of cands.entries()) {
      if (j === index) continue;
      go(c, i + 1);
      if (out.length >= limit) return;
    }
  };
  go(root, 0);
  return out;
}

/** Local hash of an accessible name (digits folded). Never the name itself. */
export function nameHash(name: string): string | undefined {
  const k = nameKey(name);
  return k ? `n${cyrb53(k).toString(36)}` : undefined;
}

/** Composed descendants of `root`, depth-first, at most `max`. */
export function* composedDescendants(
  root: Element,
  openClosed?: OpenClosed,
  max = 6000,
): Generator<Element> {
  const stack: Element[] = [...composedKids(root, openClosed)].reverse();
  let n = 0;
  while (stack.length && n < max) {
    const el = stack.pop() as Element;
    n++;
    yield el;
    const kids = composedKids(el, openClosed);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as Element);
  }
}

/**
 * Depth-free match inside `scope`: elements with the path's last signature
 * whose ancestors (up to `scope`) agree with the path's preceding steps,
 * scored by how many trailing steps agree. The unique best scorer with at
 * least `minScore` agreeing steps, or null.
 */
export function suffixMatch(
  scope: Element,
  steps: readonly string[],
  ok: (el: Element) => boolean,
  minScore: number,
  openClosed?: OpenClosed,
): Element | null {
  const sigs = steps.map((s) => parseStep(s).sig);
  const last = sigs[sigs.length - 1];
  if (!last) return null;
  let best: Element | null = null;
  let bestScore = 0;
  let tie = false;
  for (const el of composedDescendants(scope, openClosed)) {
    if (stepSig(el) !== last || !ok(el)) continue;
    let score = 1;
    let a = composedParentOf(el, openClosed);
    for (
      let k = sigs.length - 2;
      k >= 0 && a && a !== scope && stepSig(a) === sigs[k];
      k--
    ) {
      score++;
      a = composedParentOf(a, openClosed);
    }
    if (score > bestScore) {
      best = el;
      bestScore = score;
      tie = false;
    } else if (score === bestScore) tie = true;
  }
  return best && !tie && bestScore >= minScore ? best : null;
}
