import { PROTECTED_ROLES } from '../contract';

import { CMP_SELECTOR } from '../extract/rules';
import type { RegionFact } from '../types';
import { HOST_TAG, isOurs, isRendered } from '../util/dom';
import { BOOST, tok } from './css';
import { px } from './text';
import { notNeeded, type OpEnv, type OpImpl } from './types';

/**
 * Region ops. Softening uses opacity only and restores on hover and
 * focus-within, so keyboard users see where focus went (engine.md 3.4.9).
 * Never inert, display:none, visibility:hidden or aria-hidden. Protected
 * regions (main content, navigation, forms, help, consent, footer) are never
 * dimmed, whatever the plan says: the engine re-checks locally.
 */

const percent = (v: number): string => `${Math.round(v * 100)}%`;
const MODAL =
  'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

function factFor(env: OpEnv, el: Element): RegionFact | undefined {
  for (const list of env.facts.regions.values()) {
    const f = list.find((r) => r.el === el);
    if (f) return f;
  }
  return undefined;
}

/** Local veto: true when the engine must not soften or unpin this element. */
export function isProtected(env: OpEnv, el: Element): boolean {
  const doc = env.doc;
  if (el === doc.body || el === doc.documentElement || isOurs(el)) return true;
  const main = env.facts.main;
  if (main && (el === main || el.contains(main))) return true;
  const active = doc.activeElement;
  if (active && active !== doc.body && el.contains(active)) return true;
  if (el.matches(CMP_SELECTOR) || el.querySelector(CMP_SELECTOR)) return true;
  if (el.matches(MODAL) || el.closest(MODAL)) return true;
  if (
    el.querySelector(
      '[required], [aria-required="true"], input[type="password"]',
    )
  )
    return true;
  const fact = factFor(env, el);
  if (
    fact?.rule &&
    fact.rule.precision >= 0.9 &&
    PROTECTED_ROLES.includes(fact.rule.role)
  )
    return true;
  if (fact?.hasRequiredFields || fact?.containsMain) return true;
  return false;
}

function softenCss(token: string, opacity: number): string {
  return [
    `${tok(token)} { opacity: ${opacity} !important; }`,
    `[data-wa~="${token}"]${BOOST}:is(:hover, :focus-within) { opacity: 1 !important; }`,
  ].join('\n');
}

export const dimDistractions: OpImpl = {
  id: 'dim_distractions',
  prepare(env, opacity, scope) {
    if (scope === 'page') return notNeeded('dimming needs region targets');
    const targets = env
      .resolve(scope)
      .filter(
        (el) => el.isConnected && isRendered(el) && !isProtected(env, el),
      );
    // Nested targets: soften the outermost only (opacity multiplies).
    const outer = targets.filter(
      (el) => !targets.some((o) => o !== el && o.contains(el)),
    );
    if (outer.length === 0) return notNeeded('no dimmable regions');
    return {
      status: 'ready',
      css: { doc: softenCss('dm', opacity) },
      marks: outer.map((el) => [el, 'dm'] as [Element, string]),
      count: outer.length,
      fit: { before: '100%', after: percent(opacity) },
      show: outer,
    };
  },
};

export const focusView: OpImpl = {
  id: 'focus_view',
  prepare(env, opacity, scope) {
    const scoped = scope === 'page' ? [] : env.resolve(scope);
    const main = scoped[0] ?? env.facts.main;
    if (!main || !main.isConnected) return notNeeded('main content unknown');
    const marks: Array<[Element, string]> = [];
    for (
      let a: Element | null = main;
      a && a !== env.doc.body;
      a = a.parentElement
    ) {
      const parent: Element | null = a.parentElement;
      if (!parent) break;
      for (const sib of Array.from(parent.children) as Element[]) {
        if (sib === a || sib.localName === HOST_TAG) continue;
        if (/^(script|style|template|link|meta|noscript)$/.test(sib.localName))
          continue;
        if (!isRendered(sib)) continue;
        if (
          sib.matches(CMP_SELECTOR) ||
          sib.querySelector(CMP_SELECTOR) ||
          sib.matches(MODAL)
        )
          continue;
        marks.push([sib, 'fv']);
      }
    }
    if (marks.length === 0)
      return notNeeded('nothing outside the main content');
    return {
      status: 'ready',
      css: { doc: softenCss('fv', opacity) },
      marks,
      count: marks.length,
      fit: { before: '100%', after: percent(opacity) },
      show: [main],
    };
  },
};

export const unpinBars: OpImpl = {
  id: 'unpin_bars',
  prepare(env, _v, scope) {
    if (scope === 'page') return notNeeded('unpinning needs region targets');
    const vw = env.view.innerWidth;
    const vh = env.view.innerHeight;
    const marks: Array<[Element, string]> = [];
    let band = 0;
    for (const el of env.resolve(scope)) {
      if (!el.isConnected || isOurs(el)) continue;
      if (
        el.matches(CMP_SELECTOR) ||
        el.querySelector(CMP_SELECTOR) ||
        el.matches(MODAL)
      )
        continue;
      const fact = factFor(env, el);
      if (
        fact?.rule &&
        ['consent_banner', 'chat_widget'].includes(fact.rule.role)
      )
        continue;
      const cs = env.view.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.height >= 0.5 * vh || r.height < 8) continue;
      if (cs.position === 'sticky') {
        marks.push([el, 'ups']);
        if (r.top <= 8) band += r.height;
      } else if (cs.position === 'fixed') {
        // Only top-anchored bars: absolute keeps them out of flow (no reflow)
        // and lets them scroll away from the top of the document.
        if (r.top > 8 || r.width < 0.5 * vw) continue;
        marks.push([el, 'upf']);
        band += r.height;
      }
    }
    if (marks.length === 0) return notNeeded('no pinned bars in scope');
    return {
      status: 'ready',
      css: {
        doc: [
          `${tok('ups')} { position: relative !important; inset: auto !important; }`,
          `${tok('upf')} { position: absolute !important; }`,
        ].join('\n'),
      },
      marks,
      count: marks.length,
      fit: { before: px(band), after: px(0) },
      show: marks.map(([el]) => el),
    };
  },
  afterApply(env, applied) {
    // Real "after": what still pins to the top of the viewport.
    let pinnedTop = 0;
    for (const p of env.facts.pinned) {
      if (!p.el.isConnected) continue;
      const cs = env.view.getComputedStyle(p.el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const r = p.el.getBoundingClientRect();
      if (r.top <= 8 && r.width >= 0.9 * env.view.innerWidth)
        pinnedTop = Math.max(pinnedTop, r.bottom);
    }
    if (applied.prepared.fit)
      applied.prepared.fit = { ...applied.prepared.fit, after: px(pinnedTop) };
  },
};
