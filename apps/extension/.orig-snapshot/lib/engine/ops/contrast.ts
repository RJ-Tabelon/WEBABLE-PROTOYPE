import {
  ancestorBackground,
  effectiveBackground,
  foregroundOf,
} from '../extract/contrast';
import {
  BLACK,
  contrastRatio,
  formatRatio,
  rgbaToCss,
  solveForeground,
  WHITE,
  type RGBA,
} from '../util/color';
import { tok } from './css';
import { notNeeded, type OpEnv, type OpImpl } from './types';

/**
 * Contrast (engine.md 3.4.3): per-element OKLCH lightness solve against the
 * element's own effective background. Only solid or translucent backgrounds
 * are solved; image, gradient, overlapped or unknown backgrounds are skipped.
 * Hue, backgrounds and layout never change. Colours are bucketed to <= 16
 * tokens per page (extra pairs snap to black or white).
 */

const MAX_COLOURS = 16;
const MAX_ELEMENTS = 800;

interface Solved {
  el: Element;
  before: number;
  color: RGBA;
}

function measureOne(env: OpEnv, el: Element): { fg: RGBA; bg: RGBA } | null {
  const cs = env.view.getComputedStyle(el);
  const f = foregroundOf(cs);
  if (f.unknown || !f.fg) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const inView =
    r.bottom > 0 &&
    r.top < env.view.innerHeight &&
    r.right > 0 &&
    r.left < env.view.innerWidth;
  const b = inView
    ? effectiveBackground(el, r, env.view)
    : ancestorBackground(el, env.view);
  if (b.kind !== 'solid' && b.kind !== 'translucent') return null;
  return { fg: f.fg, bg: b.bg };
}

export const contrast: OpImpl = {
  id: 'contrast',
  prepare(env, target) {
    const solved: Solved[] = [];
    let examined = 0;
    for (const t of env.facts.text) {
      if (examined >= MAX_ELEMENTS) break;
      if (t.icon || !t.el.isConnected) continue;
      examined++;
      const m = measureOne(env, t.el);
      if (!m) continue;
      const ratio = contrastRatio(m.fg, m.bg);
      if (ratio >= target - 0.01) continue;
      const s = solveForeground(m.fg, m.bg, target);
      solved.push({ el: t.el, before: ratio, color: s.color });
    }
    if (solved.length === 0) return notNeeded('text already meets the target');

    // Bucket to at most 16 colours; the rest snap to whichever pole contrasts most.
    const palette = new Map<string, number>();
    const marks: Array<[Element, string]> = [];
    const rules: string[] = [];
    const tokenFor = (c: RGBA): string => {
      const css = rgbaToCss(c);
      let idx = palette.get(css);
      if (idx === undefined) {
        idx = palette.size;
        palette.set(css, idx);
        rules.push(`${tok(`ct${idx}`)} { color: ${css} !important; }`);
      }
      return `ct${idx}`;
    };
    for (const s of solved) {
      let color = s.color;
      if (!palette.has(rgbaToCss(color)) && palette.size >= MAX_COLOURS - 2) {
        const m = measureOne(env, s.el);
        color =
          m && contrastRatio(BLACK, m.bg) >= contrastRatio(WHITE, m.bg)
            ? BLACK
            : WHITE;
      }
      marks.push([s.el, tokenFor(color)]);
    }
    const minBefore = Math.min(...solved.map((s) => s.before));
    return {
      status: 'ready',
      css: { doc: rules.join('\n') },
      marks,
      count: solved.length,
      fit: {
        before: formatRatio(minBefore),
        after: formatRatio(target >= 21 ? 21 : target),
      },
      show: solved.map((s) => s.el),
    };
  },
  afterApply(env, applied) {
    // Real "after": the weakest pair among changed elements, re-measured.
    let worst = Infinity;
    for (const el of env.marks.elementsFor('contrast').slice(0, 120)) {
      const m = measureOne(env, el);
      if (m) worst = Math.min(worst, contrastRatio(m.fg, m.bg));
    }
    if (Number.isFinite(worst) && applied.prepared.fit) {
      applied.prepared.fit = {
        ...applied.prepared.fit,
        after: formatRatio(worst),
      };
    }
    applied.prepared.count = env.marks.countFor('contrast');
  },
};
