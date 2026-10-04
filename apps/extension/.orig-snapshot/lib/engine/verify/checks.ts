import type { OpId } from '@webable/core/ops/catalog';
import type { VerifyCode } from '@webable/core/policy/types';

import { measureContrast } from '../extract/contrast';
import { opsNear, opsWithin } from '../ops/marks';
import { area, boxOf, intersection, type Box } from '../util/geometry';
import {
  composedContains,
  FOCUSABLE_SELECTOR,
  isOurs,
  isRendered,
} from '../util/dom';

/**
 * Native, geometry-based verification (engine.md 4). A baseline snapshot of a
 * bounded probe set is taken before the write and diffed after it settles.
 * Nearby tokens identify candidates only; the engine confirms causal layout
 * changes with synchronous counterfactual reads before rolling anything back.
 */

export interface ProbeSet {
  /** Text elements whose size/spacing changes (overlap check). */
  text: Element[];
  /** Nearby text blocks each marked element could now overlap. */
  neighbours: Map<Element, Element[]>;
  /** Overflow-clipping containers of marked elements (clip check). */
  containers: Element[];
  /** Interactive elements in and near the viewport. */
  controls: Element[];
  /** Text with a known baseline contrast. */
  contrast: Element[];
}

interface State {
  box: Box;
  visible: boolean;
  visibleRead: boolean;
  /** Hit-test at the centre lands on the element (null: centre off-screen). */
  hit: boolean | null;
  clipped: boolean;
  ratio: number | null;
}

export interface Snapshot {
  states: Map<Element, State>;
  overflowX: number;
  active: Element | null;
}

export interface Failure {
  code: VerifyCode;
  el: Element;
  ops: Set<OpId>;
}

const LAYOUT_TOKENS_TEXT = /^(tf|ls|ll)/;

function overflowOf(cs: CSSStyleDeclaration): 'hidden' | 'scroll' | 'visible' {
  const vals = [cs.overflowX, cs.overflowY];
  if (vals.some((v) => v === 'hidden' || v === 'clip')) return 'hidden';
  if (vals.some((v) => v === 'auto' || v === 'scroll')) return 'scroll';
  return 'visible';
}

function isClipped(el: Element, view: Window): boolean {
  const h = el as HTMLElement;
  const cs = view.getComputedStyle(el);
  const kind = overflowOf(cs);
  if (kind === 'visible') return false;
  // Large scroll panes are designed to scroll; only small boxes count.
  if (kind === 'scroll' && h.clientHeight >= 200 && h.clientWidth >= 200)
    return false;
  return (
    h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1
  );
}

/** Up to 3 clipping ancestors (and the element itself) of each marked element. */
export function clippingContainers(
  els: readonly Element[],
  view: Window,
  cap = 200,
): Element[] {
  const out = new Set<Element>();
  for (const el of els) {
    let n: Element | null = el;
    for (let i = 0; n && i < 4 && out.size < cap; i++, n = n.parentElement) {
      if (n.localName === 'body' || n.localName === 'html') break;
      if (overflowOf(view.getComputedStyle(n)) !== 'visible') out.add(n);
    }
  }
  return [...out];
}

function neighboursOf(el: Element): Element[] {
  const out: Element[] = [];
  for (
    let n: Element | null = el, i = 0;
    n && i < 3;
    n = n.parentElement, i++
  ) {
    if (n.localName === 'body') break;
    for (const s of [n.previousElementSibling, n.nextElementSibling]) {
      if (!s || s.contains(el) || el.contains(s) || isOurs(s)) continue;
      if (!(s.textContent ?? '').trim()) continue;
      out.push(s);
    }
  }
  return out.slice(0, 6);
}

export interface ProbeInput {
  doc: Document;
  view: Window;
  /** Elements the batch will mark, by op. */
  marked: ReadonlyArray<readonly [Element, string]>;
  /** Already-marked elements (earlier batches) worth re-checking. */
  existing: readonly Element[];
  targets: readonly Element[];
  contrast: readonly Element[];
}

export function buildProbes(p: ProbeInput): ProbeSet {
  const vh = p.view.innerHeight;
  const vw = p.view.innerWidth;
  const text = new Set<Element>();
  const all = new Set<Element>();
  for (const [el, token] of p.marked) {
    all.add(el);
    if (LAYOUT_TOKENS_TEXT.test(token)) text.add(el);
  }
  for (const el of p.existing) all.add(el);
  const near = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return (
      r.bottom > -0.25 * vh && r.top < 1.25 * vh && r.right > 0 && r.left < vw
    );
  };
  const textList = [...text].filter(near).slice(0, 100);
  const neighbours = new Map<Element, Element[]>();
  for (const el of textList) neighbours.set(el, neighboursOf(el));
  const containers = clippingContainers(
    [...all].filter(near).slice(0, 300),
    p.view,
    150,
  );
  const controls = p.targets
    .filter((el) => el.isConnected && !isOurs(el) && near(el))
    .slice(0, 150);
  const contrast = p.contrast.filter((el) => el.isConnected).slice(0, 60);
  return { text: textList, neighbours, containers, controls, contrast };
}

interface Needs {
  visible?: boolean;
  hit?: boolean;
  clip?: boolean;
  ratio?: boolean;
}

/** Read only what each probe kind needs: hit tests and colour reads are the costly ones. */
function fill(
  st: State,
  el: Element,
  doc: Document,
  view: Window,
  need: Needs,
  r: DOMRect,
): void {
  if ((need.visible || need.hit) && !st.visibleRead) {
    st.visible = isRendered(el, { opacity: true }) && r.width * r.height >= 1;
    st.visibleRead = true;
  }
  if (need.hit && st.hit === null && st.visible) {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx >= 0 && cy >= 0 && cx < view.innerWidth && cy < view.innerHeight) {
      const h = doc.elementFromPoint(cx, cy);
      st.hit = h === null || isOurs(h) || composedContains(el, h);
    }
  }
  if (need.clip) st.clipped = isClipped(el, view);
  if (need.ratio && st.ratio === null) {
    st.ratio = measureContrast(
      el,
      view,
      r.bottom > 0 && r.top < view.innerHeight,
    ).ratio;
  }
}

export function takeSnapshot(doc: Document, probes: ProbeSet): Snapshot {
  const view = doc.defaultView as Window;
  const states = new Map<Element, State>();
  const put = (el: Element, need: Needs): void => {
    const r = el.getBoundingClientRect();
    let st = states.get(el);
    if (!st) {
      st = {
        box: boxOf(r),
        visible: true,
        visibleRead: false,
        hit: null,
        clipped: false,
        ratio: null,
      };
      states.set(el, st);
    }
    fill(st, el, doc, view, need, r);
  };
  for (const el of probes.text) {
    put(el, {});
    for (const n of probes.neighbours.get(el) ?? []) put(n, { visible: true });
  }
  for (const el of probes.containers) put(el, { clip: true });
  for (const el of probes.controls) put(el, { visible: true, hit: true });
  for (const el of probes.contrast) put(el, { ratio: true });
  const root = doc.documentElement;
  const active =
    doc.activeElement && doc.activeElement !== doc.body
      ? doc.activeElement
      : null;
  return { states, overflowX: root.scrollWidth - root.clientWidth, active };
}

/** Elements inside a fixed or sticky layer (hit tests there are scroll artefacts). */
function inPinnedLayer(el: Element, view: Window): boolean {
  for (
    let n: Element | null = el, i = 0;
    n && i < 12;
    n = n.parentElement, i++
  ) {
    const p = view.getComputedStyle(n).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

export interface DiffContext {
  /** Personal contrast target when the contrast op is active, else 4.5. */
  contrastTarget: number;
  /** Marked elements to scan when the page gains horizontal overflow. */
  marked: readonly Element[];
}

export function diffSnapshots(
  doc: Document,
  probes: ProbeSet,
  base: Snapshot,
  ctx: DiffContext,
): Failure[] {
  const view = doc.defaultView as Window;
  const now = takeSnapshot(doc, probes);
  const fails: Failure[] = [];
  const get = (s: Snapshot, el: Element): State | undefined => s.states.get(el);

  // Clipping: newly clipped relative to baseline (sites often clip by design).
  for (const c of probes.containers) {
    const b = get(base, c);
    const a = get(now, c);
    if (b && a && !b.clipped && a.clipped) {
      const ops = opsNear(c);
      for (const op of opsWithin(c)) ops.add(op);
      fails.push({ code: 'clip', el: c, ops });
    }
  }

  // Overlap: a changed text block now covers a neighbour it did not cover.
  for (const el of probes.text) {
    const b = get(base, el);
    const a = get(now, el);
    if (!b || !a) continue;
    for (const n of probes.neighbours.get(el) ?? []) {
      const bn = get(base, n);
      const an = get(now, n);
      if (!bn || !an || !an.visible) continue;
      const before = intersection(b.box, bn.box);
      const after = intersection(a.box, an.box);
      const smallA = Math.min(area(a.box), area(an.box));
      const smallB = Math.min(area(b.box), area(bn.box));
      if (
        smallA > 0 &&
        after >= 0.15 * smallA &&
        before < 0.05 * Math.max(1, smallB)
      ) {
        fails.push({ code: 'overlap', el, ops: opsNear(el) });
        break;
      }
    }
  }

  // Horizontal overflow of the page.
  if (now.overflowX - base.overflowX > 8) {
    const culprits = new Set<OpId>();
    let culpritEl: Element = doc.documentElement;
    for (const el of ctx.marked) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.right + view.scrollX > doc.documentElement.clientWidth + 1) {
        for (const op of opsNear(el)) culprits.add(op);
        culpritEl = el;
      }
    }
    fails.push({ code: 'overflow', el: culpritEl, ops: culprits });
  }

  // Controls: collapsed, hidden, or covered.
  for (const c of probes.controls) {
    const b = get(base, c);
    const a = get(now, c);
    if (!b || !a || !b.visible) continue;
    const focusable = c.matches(FOCUSABLE_SELECTOR);
    if (!a.visible) {
      const ops = opsNear(c);
      for (const op of opsWithin(c)) ops.add(op);
      fails.push({
        code: focusable ? 'focus_hidden' : 'control_collapsed',
        el: c,
        ops,
      });
      continue;
    }
    if (b.hit === true && a.hit === false) {
      const r = c.getBoundingClientRect();
      const cover = doc.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      if (cover && inPinnedLayer(cover, view) && opsNear(cover).size === 0)
        continue;
      const ops = opsNear(c);
      if (cover) for (const op of opsNear(cover)) ops.add(op);
      fails.push({ code: 'control_collapsed', el: c, ops });
    }
  }

  // Focus: never lose the person's place.
  if (base.active && base.active.isConnected) {
    const cur = doc.activeElement;
    if (!cur || cur === doc.body) {
      if (isRendered(base.active)) {
        (base.active as HTMLElement).focus?.({ preventScroll: true });
      } else {
        fails.push({
          code: 'focus_lost',
          el: base.active,
          ops: opsNear(base.active),
        });
      }
    }
  }

  // Contrast must never get worse than baseline or the personal target.
  for (const el of probes.contrast) {
    const b = get(base, el);
    const a = get(now, el);
    if (!b || !a || b.ratio === null || a.ratio === null) continue;
    if (a.ratio < Math.min(b.ratio, ctx.contrastTarget) - 0.1) {
      fails.push({ code: 'contrast_drop', el, ops: opsNear(el) });
    }
  }
  return fails;
}
