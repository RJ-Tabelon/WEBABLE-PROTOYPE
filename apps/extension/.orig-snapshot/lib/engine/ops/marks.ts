import type { OpId } from '@webable/core/ops/catalog';

/**
 * Element marking. One attribute holds space-separated tokens so CSS selects
 * with `[attr~="tok"]` and each op is removable on its own by dropping its
 * tokens (engine.md 3.2). Marks never touch ARIA, names, tabindex or anything
 * else the accessibility tree reads.
 *
 * Nothing in the page names WebAble or a value: the attribute is `data-` plus
 * six random letters per page view, and each internal token ('tf', 'ct3',
 * 'hx12') is written as a random opaque token mapped only here. Ops and CSS
 * keep using internal tokens; `tok()`/`sel()` and MarkBook translate.
 * (Adopted-sheet contents remain readable to the page: a known residual.)
 */

function randomLetters(n: number): string {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += String.fromCharCode(97 + (b % 26));
  return out;
}

/** The mark attribute for this page view. */
export const MARK_ATTR = `data-${randomLetters(6)}`;
/**
 * On <html>: ops whose pre-paint stylesheet must stand down ("all" = paused).
 * The pre-paint files are static (public/prepaint), so this name is fixed.
 */
export const OFF_ATTR = 'data-wa-off';

const toOpaque = new Map<string, string>();
const toInternal = new Map<string, string>();

/** The opaque token written into the page for an internal token. */
export function opaque(token: string): string {
  let o = toOpaque.get(token);
  if (o) return o;
  do o = randomLetters(5);
  while (toInternal.has(o));
  toOpaque.set(token, o);
  toInternal.set(o, token);
  return o;
}

/** `[attr~="opaque"]` for an internal token, without the specificity boost. */
export const sel = (token: string): string =>
  `[${MARK_ATTR}~="${opaque(token)}"]`;

const TOKEN_RULES: ReadonlyArray<readonly [RegExp, OpId]> = [
  [/^tf[a-z0-9]*$/, 'text_floor'],
  [/^ls$/, 'line_spacing'],
  [/^ll$/, 'line_length'],
  [/^ct\d+$/, 'contrast'],
  [/^h[sxyp]\d*$/, 'target_size'],
  [/^tg\d+$/, 'target_spacing'],
  [/^dm$/, 'dim_distractions'],
  [/^fv$/, 'focus_view'],
  [/^up[sf]$/, 'unpin_bars'],
  [/^mgt?$/, 'menu_grace'],
  [/^pm$/, 'pause_media'],
];

/** The op a token belongs to, or null for foreign tokens. */
export function tokenOp(token: string): OpId | null {
  for (const [re, op] of TOKEN_RULES) if (re.test(token)) return op;
  return null;
}

/** Internal tokens on an element (opaque tokens this page view did not write are skipped). */
export function tokensOf(el: Element): string[] {
  const v = el.getAttribute(MARK_ATTR);
  if (!v) return [];
  const out: string[] = [];
  for (const o of v.split(/\s+/)) {
    const t = toInternal.get(o);
    if (t) out.push(t);
  }
  return out;
}

/** Opaque tokens as written on the element. */
function rawTokens(el: Element): string[] {
  const v = el.getAttribute(MARK_ATTR);
  return v ? v.split(/\s+/).filter(Boolean) : [];
}

export function hasToken(el: Element, token: string): boolean {
  return rawTokens(el).includes(opaque(token));
}

/** Ops that marked this element or one of its `depth` ancestors. */
export function opsNear(el: Element, depth = 5): Set<OpId> {
  const out = new Set<OpId>();
  let n: Element | null = el;
  for (let i = 0; n && i <= depth; i++, n = n.parentElement) {
    for (const t of tokensOf(n)) {
      const op = tokenOp(t);
      if (op) out.add(op);
    }
  }
  return out;
}

/** Ops that marked any descendant (bounded), for clip failures on unmarked containers. */
export function opsWithin(el: Element, cap = 60): Set<OpId> {
  const out = new Set<OpId>();
  const marked = el.querySelectorAll(`[${MARK_ATTR}]`);
  const n = Math.min(marked.length, cap);
  for (let i = 0; i < n; i++) {
    const m = marked[i];
    if (!m) continue;
    for (const t of tokensOf(m)) {
      const op = tokenOp(t);
      if (op) out.add(op);
    }
  }
  return out;
}

/**
 * Book-keeping for every mark the engine made, so removal needs no document
 * query and disconnected elements can be pruned.
 */
export class MarkBook {
  private readonly byToken = new Map<string, Set<Element>>();

  mark(el: Element, token: string): void {
    const cur = rawTokens(el);
    const o = opaque(token);
    if (!cur.includes(o)) {
      cur.push(o);
      el.setAttribute(MARK_ATTR, cur.join(' '));
    }
    let set = this.byToken.get(token);
    if (!set) this.byToken.set(token, (set = new Set()));
    set.add(el);
  }

  unmark(el: Element, token: string): void {
    this.unmarkRaw(el, token);
    this.byToken.get(token)?.delete(el);
  }

  /** Remove every token belonging to `op`, everywhere. Returns elements touched. */
  unmarkOp(op: OpId): number {
    let n = 0;
    for (const [token, set] of this.byToken) {
      if (tokenOp(token) !== op) continue;
      for (const el of set) {
        this.unmarkRaw(el, token);
        n++;
      }
      this.byToken.delete(token);
    }
    return n;
  }

  /** Replace an op's marks without touching tokens that have stayed the same. */
  replaceOp(op: OpId, marks: readonly (readonly [Element, string])[]): void {
    const next = new Map<string, Set<Element>>();
    for (const [el, token] of marks) {
      let set = next.get(token);
      if (!set) next.set(token, (set = new Set()));
      set.add(el);
    }
    for (const [token, set] of this.byToken) {
      if (tokenOp(token) !== op) continue;
      for (const el of [...set]) {
        if (!next.get(token)?.has(el)) this.unmark(el, token);
      }
      if (set.size === 0) this.byToken.delete(token);
    }
    for (const [el, token] of marks) this.mark(el, token);
  }

  /** Remove `op`'s tokens from one element only (partial rollback). */
  unmarkOpOn(el: Element, op: OpId): void {
    for (const t of tokensOf(el)) if (tokenOp(t) === op) this.unmark(el, t);
  }

  elementsFor(op: OpId): Element[] {
    const out = new Set<Element>();
    for (const [token, set] of this.byToken) {
      if (tokenOp(token) !== op) continue;
      for (const el of set) out.add(el);
    }
    return [...out];
  }

  countFor(op: OpId): number {
    return this.elementsFor(op).filter((el) => el.isConnected).length;
  }

  /** Every marked element (bounded), for the verifier's probe set. */
  all(cap = 600): Element[] {
    const out = new Set<Element>();
    for (const set of this.byToken.values()) {
      for (const el of set) {
        out.add(el);
        if (out.size >= cap) return [...out];
      }
    }
    return [...out];
  }

  /** Forget elements the page removed. */
  prune(): void {
    for (const [token, set] of this.byToken) {
      for (const el of set) if (!el.isConnected) set.delete(el);
      if (set.size === 0) this.byToken.delete(token);
    }
  }

  clear(): void {
    for (const [token, set] of this.byToken)
      for (const el of set) this.unmarkRaw(el, token);
    this.byToken.clear();
  }

  private unmarkRaw(el: Element, token: string): void {
    const o = opaque(token);
    const rest = rawTokens(el).filter((t) => t !== o);
    if (rest.length) el.setAttribute(MARK_ATTR, rest.join(' '));
    else el.removeAttribute(MARK_ATTR);
  }
}

/** Add or remove a token in the `data-wa-off` list on <html>. */
export function setOffGate(doc: Document, token: string, off: boolean): void {
  const root = doc.documentElement;
  if (!root) return; // document_start can run before the parser creates <html>.
  const cur = (root.getAttribute(OFF_ATTR) ?? '').split(/\s+/).filter(Boolean);
  const has = cur.includes(token);
  if (has === off) return;
  if (off && !has) cur.push(token);
  if (!off && has) cur.splice(cur.indexOf(token), 1);
  if (cur.length) root.setAttribute(OFF_ATTR, cur.join(' '));
  else root.removeAttribute(OFF_ATTR);
}
