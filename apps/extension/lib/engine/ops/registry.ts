import { OP_CATALOG, type OpId } from '@webable/core/ops/catalog';

import { menuGrace, steadyClicks } from './behavior';
import { contrast } from './contrast';
import { focusOutlineCss } from './css';
import { setOffGate } from './marks';
import { calmMotion, pauseMedia } from './motion';
import { dimDistractions, focusView, unpinBars } from './regions';
import { targetSize, targetSpacing } from './targets';
import { lineLength, lineSpacing, textFloor } from './text';
import { notNeeded, type OpImpl } from './types';

/**
 * focus_outline: a :focus-visible ring (a selector; focus behaviour and order
 * are untouched). Pre-paint in the document when registered; the engine adds
 * it to shadow roots, which registered stylesheets cannot reach.
 */
const focusOutline: OpImpl = {
  id: 'focus_outline',
  prepare(env, widthPx) {
    const prePaint = env.prePaint.has('focus_outline');
    return {
      status: 'ready',
      css: {
        doc: prePaint ? '' : focusOutlineCss(widthPx, 'doc'),
        shadow: focusOutlineCss(widthPx, 'shadow'),
      },
      count: env.facts.targets.filter((t) => t.el.isConnected).length,
      run: prePaint
        ? () => {
            setOffGate(env.doc, 'focus_outline', false);
            return () => setOffGate(env.doc, 'focus_outline', true);
          }
        : undefined,
    };
  },
};

/** reading_guide: an overlay in WebAble's layer; zero page mutation. */
const readingGuide: OpImpl = {
  id: 'reading_guide',
  prepare(env) {
    const main = env.facts.text.find(
      (t) => t.inMain && t.lineHeightPx !== null,
    );
    const lh = main?.lineHeightPx ?? 24;
    return {
      status: 'ready',
      count: 1,
      fit: { before: 'Off', after: 'On' },
      run: () => {
        env.overlay.setReadingGuide(true, lh);
        return () => env.overlay.setReadingGuide(false);
      },
    };
  },
};

/** page_zoom is the service worker's (chrome.tabs.setZoom); nothing to do in the page. */
const pageZoom: OpImpl = {
  id: 'page_zoom',
  prepare: () => notNeeded('the service worker zooms the tab'),
};

export const OPS: Readonly<Record<OpId, OpImpl>> = {
  text_floor: textFloor,
  page_zoom: pageZoom,
  line_spacing: lineSpacing,
  line_length: lineLength,
  contrast,
  focus_outline: focusOutline,
  target_size: targetSize,
  target_spacing: targetSpacing,
  steady_clicks: steadyClicks,
  menu_grace: menuGrace,
  calm_motion: calmMotion,
  pause_media: pauseMedia,
  dim_distractions: dimDistractions,
  focus_view: focusView,
  unpin_bars: unpinBars,
  reading_guide: readingGuide,
};

/** Value on the op's reviewed ladder for a level index (clamped). */
export function levelValue(op: OpId, level: number): number {
  const levels = OP_CATALOG[op].levels;
  const i = Math.max(0, Math.min(levels.length - 1, Math.round(level)));
  return levels[i] ?? levels[0] ?? 0;
}

/**
 * Rollback order when a failure cannot be attributed (engine.md 4.2):
 * riskiest layout ops first, then paint ops that can reorder stacking.
 */
export const BISECT_ORDER: readonly OpId[] = [
  'text_floor',
  'line_spacing',
  'line_length',
  'target_spacing',
  'unpin_bars',
  'target_size',
  'dim_distractions',
  'focus_view',
  'contrast',
];
