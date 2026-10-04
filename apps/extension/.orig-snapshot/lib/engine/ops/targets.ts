import type { TargetFact } from '../types';
import { median } from '../util/buckets';
import { composedContains, isOurs, NO_PSEUDO_TAGS } from '../util/dom';
import {
  BoxGrid,
  gaps,
  inflate,
  nearestGaps,
  spacingFailures,
  type Box,
  type TargetBox,
} from '../util/geometry';
import { tok } from './css';
import { hasToken } from './marks';
import { px } from './text';
import { notNeeded, type OpEnv, type OpImpl } from './types';

/**
 * target_size (engine.md 3.4.5): an invisible, absolutely positioned ::after
 * with negative insets enlarges the hit area without moving layout. The pad
 * is capped at half the gap to the nearest neighbour so expanded areas never
 * overlap. Clicking the pseudo-element dispatches to the element itself.
 *
 * target_spacing (3.4.6): raises column/row gap on flex or grid toolbars whose
 * items are crowded. Margins and inline links are never touched.
 */

/** Inset buckets (px). Small values let thin borders be compensated exactly. */
export const PAD_BUCKETS = [
  1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28,
] as const;

/** Largest bucket <= v (0 when v < 2). */
export function padBucket(v: number): number {
  let best = 0;
  for (const b of PAD_BUCKETS) if (b <= v) best = b;
  return best;
}

interface Live extends TargetBox {
  el: Element;
  host: Element;
  w: number;
  h: number;
  inline: boolean;
}

function liveTargets(env: OpEnv): Live[] {
  const sx = env.view.scrollX;
  const sy = env.view.scrollY;
  const out: Live[] = [];
  const seen = new Set<Element>();
  for (const t of env.facts.targets) {
    if (!t.el.isConnected || isOurs(t.el)) continue;
    // Replaced elements cannot host ::after; enlarge their label instead.
    let host: Element = t.el;
    if (NO_PSEUDO_TAGS.has(t.el.localName)) {
      const label =
        (t.el as HTMLInputElement).labels?.[0] ?? t.el.closest('label');
      if (!label) continue;
      host = label;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    const r = host.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.push({
      id: t.id,
      el: t.el,
      host,
      box: {
        left: r.left + sx,
        top: r.top + sy,
        right: r.right + sx,
        bottom: r.bottom + sy,
      },
      w: r.width,
      h: r.height,
      inline: t.inline,
    });
  }
  return out;
}

function hasPositionedDescendant(env: OpEnv, el: Element): boolean {
  const all = el.querySelectorAll('*');
  const n = Math.min(all.length, 60);
  if (all.length > 60) return true; // large subtrees: do not risk re-parenting abs children
  for (let i = 0; i < n; i++) {
    const d = all[i];
    if (!d) continue;
    const p = env.view.getComputedStyle(d).position;
    if (p === 'absolute' || p === 'fixed') return true;
  }
  return false;
}

interface Pads {
  x: number;
  y: number;
}

export const targetSize: OpImpl = {
  id: 'target_size',
  prepare(env, size) {
    const live = liveTargets(env);
    const grid = new BoxGrid(live, Math.max(2 * size, 64));
    const pads = new WeakMap<Element, Pads>();
    const marks: Array<[Element, string]> = [];
    const beforeSides: number[] = [];
    const afterSides: number[] = [];
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const t of live) {
      if (Math.min(t.w, t.h) >= size) continue;
      const cs = env.view.getComputedStyle(t.host);
      if (cs.display === 'contents' || cs.display === 'none') continue;
      if (t.inline && t.host.getClientRects().length > 1) continue; // wrapped inline link
      const after = env.view.getComputedStyle(t.host, '::after').content;
      if (after && after !== 'none' && after !== 'normal') continue; // never override a site pseudo
      const needX = Math.max(0, Math.ceil((size - t.w) / 2));
      const needY = Math.max(0, Math.ceil((size - t.h) / 2));
      const g = nearestGaps(
        t,
        grid,
        size,
        (o) =>
          composedContains(o.host, t.host) || composedContains(t.host, o.host),
      );
      const capX = Number.isFinite(g.x) ? Math.floor(g.x / 2) - 1 : needX;
      const capY = Number.isFinite(g.y) ? Math.floor(g.y / 2) - 1 : needY;
      // ::after insets are measured from the padding box: add the border back so
      // the extension beyond the visible (border) box is what was capped.
      const bx = Math.min(
        parseFloat(cs.borderLeftWidth) || 0,
        parseFloat(cs.borderRightWidth) || 0,
      );
      const by = Math.min(
        parseFloat(cs.borderTopWidth) || 0,
        parseFloat(cs.borderBottomWidth) || 0,
      );
      // Pseudo-elements contribute to scrollable overflow even though the
      // button's own rect never grows. Keep the hit area inside native page
      // bounds, including pages already horizontally scrollable.
      let edgeX = Math.min(
        t.box.left,
        Math.max(
          env.doc.documentElement.clientWidth,
          env.doc.documentElement.scrollWidth,
        ) - t.box.right,
      );
      for (
        let n = t.host.parentElement;
        n && n !== env.doc.body;
        n = n.parentElement
      ) {
        const nc = env.view.getComputedStyle(n);
        if (nc.overflowX === 'visible') continue;
        const r = n.getBoundingClientRect();
        const left = r.left + env.view.scrollX + n.clientLeft;
        edgeX = Math.min(
          edgeX,
          t.box.left - left,
          left + n.clientWidth - t.box.right,
        );
      }
      const extX = Math.min(needX, Math.max(0, capX), Math.max(0, edgeX));
      const extY = Math.min(needY, Math.max(0, capY));
      if (extX < 2 && extY < 2) continue;
      const cssX = padBucket(extX + bx);
      const cssY = padBucket(extY + by);
      const x = Math.max(0, cssX - bx);
      const y = Math.max(0, cssY - by);
      if (x < 1 && y < 1) continue;
      const needsPosition = cs.position === 'static';
      if (needsPosition && hasPositionedDescendant(env, t.host)) continue;
      marks.push([t.host, 'hs'], [t.host, `hx${cssX}`], [t.host, `hy${cssY}`]);
      if (needsPosition) marks.push([t.host, 'hp']);
      xs.add(cssX);
      ys.add(cssY);
      pads.set(t.host, { x, y });
      beforeSides.push(Math.min(t.w, t.h));
      afterSides.push(Math.min(t.w + 2 * x, t.h + 2 * y));
    }
    if (marks.length === 0)
      return notNeeded('no small targets with room to grow');
    const rules = [
      `${tok('hp')} { position: relative !important; }`,
      `${tok('hs')}::after { content: "" !important; display: block !important; position: absolute !important; inset: 0 !important; pointer-events: auto !important; background: none !important; border: 0 !important; outline: 0 !important; box-shadow: none !important; transform: none !important; opacity: 0 !important; margin: 0 !important; padding: 0 !important; }`,
    ];
    for (const x of [...xs].sort((a, b) => a - b)) {
      rules.push(
        `${tok(`hx${x}`)}::after { left: -${x}px !important; right: -${x}px !important; }`,
      );
    }
    for (const y of [...ys].sort((a, b) => a - b)) {
      rules.push(
        `${tok(`hy${y}`)}::after { top: -${y}px !important; bottom: -${y}px !important; }`,
      );
    }
    const hosts = marks.filter(([, k]) => k === 'hs').map(([el]) => el);
    return {
      status: 'ready',
      css: { doc: rules.join('\n') },
      marks,
      count: hosts.length,
      fit: {
        before: px(median(beforeSides) ?? size),
        after: px(median(afterSides) ?? size),
      },
      show: hosts,
      fitBox: (el, box) => {
        const p = pads.get(el);
        return p ? inflate(box, p.x, p.y) : box;
      },
    };
  },
  /**
   * Ring probe (engine.md 4.2): hit-test the four edge midpoints of each
   * expanded area; where a probe lands on something else (clipped by an
   * ancestor, covered by a later sibling) the hit area had no effect, so its
   * tokens are dropped. This is not a rollback of the op.
   */
  afterApply(env, applied) {
    const vw = env.view.innerWidth;
    const vh = env.view.innerHeight;
    const effective: number[] = [];
    for (const el of env.marks.elementsFor('target_size')) {
      if (!el.isConnected || !hasToken(el, 'hs')) continue;
      const r = el.getBoundingClientRect();
      const box = applied.prepared.fitBox?.(el, r) ?? r;
      const inset = 1;
      const probes: Array<[number, number]> = [
        [(box.left + box.right) / 2, box.top + inset],
        [(box.left + box.right) / 2, box.bottom - inset],
        [box.left + inset, (box.top + box.bottom) / 2],
        [box.right - inset, (box.top + box.bottom) / 2],
      ];
      let ok = true;
      let tested = 0;
      for (const [x, y] of probes) {
        if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
        tested++;
        const hit = env.doc.elementFromPoint(x, y);
        if (!hit || isOurs(hit)) continue;
        if (!composedContains(el, hit)) {
          ok = false;
          break;
        }
      }
      if (!ok) {
        env.marks.unmarkOpOn(el, 'target_size');
        continue;
      }
      if (tested > 0)
        effective.push(Math.min(box.right - box.left, box.bottom - box.top));
    }
    applied.prepared.count = env.marks
      .elementsFor('target_size')
      .filter((e) => hasToken(e, 'hs')).length;
    const m = median(effective);
    if (m !== null && applied.prepared.fit)
      applied.prepared.fit = { ...applied.prepared.fit, after: px(m) };
    if (applied.prepared.count === 0) applied.prepared.fit = undefined;
  },
};

const FLEX_GRID = /^(flex|inline-flex|grid|inline-grid)$/;

export const targetSpacing: OpImpl = {
  id: 'target_spacing',
  prepare(env, gap) {
    const live = liveTargets(env).filter((t) => !t.inline);
    const fails = spacingFailures(
      live.map((t) => ({
        id: t.id,
        box: t.box,
        small: Math.min(t.w, t.h) < 24,
      })),
      24,
    );
    const byId = new Map(live.map((t) => [t.id, t] as const));
    const containers = new Map<Element, number>();
    for (const id of fails.keys()) {
      const t = byId.get(id);
      if (!t) continue;
      let c: Element | null = t.host.parentElement;
      for (let i = 0; c && i < 2; i++, c = c.parentElement) {
        const cs = env.view.getComputedStyle(c);
        if (!FLEX_GRID.test(cs.display)) continue;
        if (c.children.length < 2 || c.children.length > 30) break;
        const cg = parseFloat(cs.columnGap);
        const rg = parseFloat(cs.rowGap);
        const current = Math.min(
          Number.isFinite(cg) ? cg : 0,
          Number.isFinite(rg) ? rg : 0,
        );
        if (current >= gap) break;
        containers.set(c, current);
        break;
      }
    }
    if (containers.size === 0)
      return notNeeded('no crowded flex or grid toolbars');
    const els = [...containers.keys()];
    const beforeGap = Math.min(...[...containers.values()]);
    return {
      status: 'ready',
      css: {
        doc: `${tok(`tg${gap}`)} { column-gap: ${gap}px !important; row-gap: ${gap}px !important; }`,
      },
      marks: els.map((el) => [el, `tg${gap}`] as [Element, string]),
      count: els.length,
      fit: { before: px(beforeGap), after: px(gap) },
      show: els,
    };
  },
  afterApply(env, applied) {
    // Real "after": the smallest gap between adjacent children now.
    let smallest = Infinity;
    for (const c of env.marks.elementsFor('target_spacing').slice(0, 20)) {
      const kids = [...c.children]
        .slice(0, 30)
        .map((k) => k.getBoundingClientRect());
      for (let i = 1; i < kids.length; i++) {
        const a = kids[i - 1];
        const b = kids[i];
        if (!a || !b) continue;
        const g = gaps(a as Box, b as Box);
        const d = Math.max(g.dx, g.dy);
        if (d >= 0) smallest = Math.min(smallest, d);
      }
    }
    if (Number.isFinite(smallest) && applied.prepared.fit) {
      applied.prepared.fit = { ...applied.prepared.fit, after: px(smallest) };
    }
  },
};

export type { TargetFact };
