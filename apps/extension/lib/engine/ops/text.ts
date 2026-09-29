import type { PlannedOp } from '@webable/core/policy/types';

import type { TextFact } from '../types';
import { median, round, weightedMedian } from '../util/buckets';
import { avgCharWidth, lineHeightPx, xHeightRatio } from '../extract/text';
import { composedContains } from '../util/dom';
import { tok } from './css';
import { notNeeded, type OpEnv, type OpImpl } from './types';

/** Digits, a no-break space, then the unit (design-final.md 13.1 rule 3). */
export const px = (n: number): string => `${Math.round(n)}\u00a0px`;
export const ch = (n: number): string => `${Math.round(n)}\u00a0characters`;

/** Text the reading ops never restyle: code, form fields, editors. */
const NO_TEXT_OPS =
  'pre, code, kbd, samp, textarea, select, option, input, [contenteditable="true"], [contenteditable=""]';
const RUNNING_TEXT =
  /^(p|li|dd|dt|blockquote|figcaption|td|th|div|section|article|span|label|small|em|strong|a)$/;
const BLOCK_DISPLAY = /^(block|list-item|flow-root|table-cell)$/;

function liveText(env: OpEnv): TextFact[] {
  return env.facts.text.filter(
    (t) => t.el.isConnected && !t.icon && !t.el.closest(NO_TEXT_OPS),
  );
}

/** Text facts inside the op's scope: plan regions, else main content, else the page. */
function scopedText(env: OpEnv, scope: PlannedOp['scope']): TextFact[] {
  const all = liveText(env);
  const roots =
    scope === 'page'
      ? env.facts.main
        ? [env.facts.main]
        : []
      : env.resolve(scope);
  if (roots.length === 0) return all;
  return all.filter((t) => roots.some((r) => composedContains(r, t.el)));
}

function inViewportFirst(env: OpEnv, els: Element[]): Element[] {
  const vh = env.view.innerHeight;
  const scored = els.slice(0, 200).map((el) => {
    const r = el.getBoundingClientRect();
    return { el, s: r.bottom > 0 && r.top < vh ? 0 : 1 };
  });
  return scored.sort((a, b) => a.s - b.s).map((x) => x.el);
}

// ---------------------------------------------------------------------------
// text_floor: per-element minimum font size (engine.md 3.4.1, strategy 3)
// ---------------------------------------------------------------------------

const LH_BUCKETS = [1.35, 1.5, 1.65, 1.8] as const;

/**
 * A fixed (px) line-height would make floored text overlap itself: loosen it
 * to at least 1.35, keeping the page's own ratio when that was larger.
 */
function lineHeightToken(
  cs: CSSStyleDeclaration,
  size: number,
  floor: number,
): string | null {
  const lh = lineHeightPx(cs);
  if (lh === null || lh >= 1.2 * floor) return null;
  const want = Math.max(1.35, lh / size);
  const bucket = LH_BUCKETS.find((b) => b >= want - 0.01) ?? 1.8;
  return `tflh${Math.round(bucket * 100)}`;
}

export const textFloor: OpImpl = {
  id: 'text_floor',
  prepare(env, floor) {
    const marks: Array<[Element, string]> = [];
    const beforeSizes: Array<[number, number]> = [];
    let adjust = false;
    for (const t of liveText(env)) {
      const cs = env.view.getComputedStyle(t.el);
      const size = parseFloat(cs.fontSize);
      if (!Number.isFinite(size) || size >= floor - 0.25) continue;
      marks.push([t.el, 'tf']);
      beforeSizes.push([size, t.chars]);
      const lhToken = lineHeightToken(cs, size, floor);
      if (lhToken) marks.push([t.el, lhToken]);
      // font-size-adjust aware: small x-height families get scaled up to a 0.5 aspect.
      if (t.el.childElementCount === 0) {
        const aspect = xHeightRatio(env.doc, cs.fontFamily, cs.fontWeight);
        if (aspect !== null && aspect < 0.47) {
          marks.push([t.el, 'tfa']);
          adjust = true;
        }
      }
    }
    if (marks.length === 0) return notNeeded('no text below the floor');
    // Every line-height bucket is defined up front so content that arrives
    // later (incremental marking) can use any of them.
    const rules = [`${tok('tf')} { font-size: ${floor}px !important; }`];
    for (const b of LH_BUCKETS)
      rules.push(
        `${tok(`tflh${Math.round(b * 100)}`)} { line-height: ${b} !important; }`,
      );
    if (adjust)
      rules.push(`${tok('tfa')} { font-size-adjust: 0.5 !important; }`);
    const els = marks.filter(([, k]) => k === 'tf').map(([el]) => el);
    const before = weightedMedian(beforeSizes);
    return {
      status: 'ready',
      css: { doc: rules.join('\n') },
      marks,
      count: els.length,
      fit: { before: px(before ?? floor), after: px(floor) },
      show: inViewportFirst(env, els),
    };
  },
  afterApply(env, applied) {
    const els = env.marks
      .elementsFor('text_floor')
      .filter((el) => el.isConnected)
      .slice(0, 80);
    const sizes = els
      .map((el) => parseFloat(env.view.getComputedStyle(el).fontSize))
      .filter(Number.isFinite);
    const m = median(sizes);
    if (m !== null && applied.prepared.fit)
      applied.prepared.fit = { ...applied.prepared.fit, after: px(m) };
    applied.prepared.count = env.marks.countFor('text_floor');
  },
  incremental(env, applied, roots) {
    const floor = applied.value;
    const out: Array<[Element, string]> = [];
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('*')].slice(0, 400)) {
        if (el.closest(NO_TEXT_OPS)) continue;
        if (
          !el.firstChild ||
          ![...el.childNodes].some(
            (n) => n.nodeType === 3 && (n.nodeValue ?? '').trim(),
          )
        )
          continue;
        const cs = env.view.getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        if (!Number.isFinite(size) || size >= floor - 0.25) continue;
        out.push([el, 'tf']);
        const lhToken = lineHeightToken(cs, size, floor);
        if (lhToken) out.push([el, lhToken]);
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// line_spacing: running text in main content (engine.md 3.4.2)
// ---------------------------------------------------------------------------

/** Word spacing that accompanies each line-height level (never above WCAG's 0.16em). */
export function wordSpacingFor(lineHeight: number): number {
  if (lineHeight >= 2) return 0.16;
  if (lineHeight >= 1.8) return 0.12;
  if (lineHeight >= 1.6) return 0.08;
  return 0.06;
}

function isRunningText(env: OpEnv, t: TextFact, minChars: number): boolean {
  if (t.chars < minChars) return false;
  const tag = t.el.localName;
  if (/^h[1-6]$/.test(tag)) return false;
  if (!RUNNING_TEXT.test(tag)) return false;
  if (
    t.el.closest(
      'nav, [role="navigation"], [role="menu"], [role="tablist"], a, button, label, header',
    )
  ) {
    return false;
  }
  const d = env.view.getComputedStyle(t.el).display;
  return BLOCK_DISPLAY.test(d);
}

export const lineSpacing: OpImpl = {
  id: 'line_spacing',
  prepare(env, target, scope) {
    const marks: Array<[Element, string]> = [];
    const before: Array<[number, number]> = [];
    for (const t of scopedText(env, scope)) {
      if (!isRunningText(env, t, 40)) continue;
      const cs = env.view.getComputedStyle(t.el);
      const size = parseFloat(cs.fontSize);
      const ratio = (lineHeightPx(cs) ?? size * 1.2) / size;
      if (!Number.isFinite(ratio) || ratio >= target - 0.02) continue;
      marks.push([t.el, 'ls']);
      before.push([ratio, t.chars]);
    }
    if (marks.length === 0) return notNeeded('running text already spaced');
    const b = weightedMedian(before) ?? 1.2;
    return {
      status: 'ready',
      css: {
        doc: `${tok('ls')} { line-height: ${target} !important; word-spacing: ${wordSpacingFor(target)}em !important; }`,
      },
      marks,
      count: marks.length,
      fit: { before: String(round(b, 1)), after: String(target) },
      show: inViewportFirst(
        env,
        marks.map(([el]) => el),
      ),
    };
  },
  incremental(env, applied, roots) {
    const main = env.facts.main;
    const out: Array<[Element, string]> = [];
    for (const root of roots) {
      if (main && !composedContains(main, root)) continue;
      for (const el of [
        root,
        ...root.querySelectorAll('p, li, dd, blockquote, figcaption'),
      ].slice(0, 200)) {
        if (!RUNNING_TEXT.test(el.localName) || el.closest(NO_TEXT_OPS))
          continue;
        if ((el.textContent ?? '').trim().length < 40) continue;
        const cs = env.view.getComputedStyle(el);
        if (!BLOCK_DISPLAY.test(cs.display)) continue;
        const size = parseFloat(cs.fontSize);
        const ratio = (lineHeightPx(cs) ?? size * 1.2) / size;
        if (ratio < applied.value - 0.02) out.push([el, 'ls']);
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// line_length: cap the measure of main-content paragraphs (engine.md 3.4.4)
// ---------------------------------------------------------------------------

function charsPerLine(env: OpEnv, el: Element): number | null {
  const cs = env.view.getComputedStyle(el);
  const avg = avgCharWidth(el, cs);
  if (!avg) return null;
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const width =
    (el as HTMLElement).clientWidth - (Number.isFinite(pad) ? pad : 0);
  return width > 0 ? width / avg : null;
}

export const lineLength: OpImpl = {
  id: 'line_length',
  prepare(env, maxCh, scope) {
    const marks: Array<[Element, string]> = [];
    const before: number[] = [];
    for (const t of scopedText(env, scope)) {
      if (!isRunningText(env, t, 80)) continue;
      const cs = env.view.getComputedStyle(t.el);
      if (cs.float !== 'none') continue;
      const parent = t.el.parentElement;
      if (parent) {
        const pd = env.view.getComputedStyle(parent).display;
        if (/flex|grid/.test(pd)) continue;
      }
      const cpl = charsPerLine(env, t.el);
      if (cpl === null || cpl <= maxCh + 5 || t.chars < maxCh) continue;
      marks.push([t.el, 'll']);
      before.push(cpl);
    }
    if (marks.length === 0)
      return notNeeded('lines already within the measure');
    return {
      status: 'ready',
      css: { doc: `${tok('ll')} { max-inline-size: ${maxCh}ch !important; }` },
      marks,
      count: marks.length,
      fit: { before: ch(median(before) ?? maxCh), after: ch(maxCh) },
      show: inViewportFirst(
        env,
        marks.map(([el]) => el),
      ),
    };
  },
  afterApply(env, applied) {
    const after = env.marks
      .elementsFor('line_length')
      .slice(0, 30)
      .map((el) => charsPerLine(env, el))
      .filter((v): v is number => v !== null);
    const m = median(after);
    if (m !== null && applied.prepared.fit)
      applied.prepared.fit = { ...applied.prepared.fit, after: ch(m) };
  },
};
