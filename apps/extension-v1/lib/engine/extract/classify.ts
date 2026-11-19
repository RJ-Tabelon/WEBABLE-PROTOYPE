import type { PageCategory, PageSignal } from '@webable/core/page/types';

import { PAGE_CATEGORIES } from '../contract';

/**
 * Local page-category classifier (engine.md 2.14). Structural signals only.
 * A small linear model over binary and ratio features, then a softmax, so the
 * output is a probability distribution the policy can threshold (page
 * analysis is asked only when the top probability is below 0.75).
 */

export interface CategoryFeatures {
  signals: ReadonlySet<PageSignal>;
  /** Main content found by landmark or a single article. */
  structuredMain: boolean;
  /** Share of visible text inside the main content, 0-1. */
  mainTextShare: number;
  /** Visible text characters on the page. */
  textChars: number;
  /** Actionable controls per 1,000 visible characters. */
  controlsPerKChars: number;
  /** Largest group of repeated sibling cards inside main (or the page). */
  repeatedCards: number;
  forms: number;
  requiredFields: number;
}

type Weights = Record<
  PageCategory,
  (f: CategoryFeatures, s: (x: PageSignal) => number) => number
>;

const WEIGHTS: Weights = {
  article: (f, s) =>
    2.4 * s('jsonld_article') +
    2 * s('og_type_article') +
    2.2 * s('readerable') +
    0.8 * Number(f.structuredMain) +
    1.4 * Number(f.mainTextShare > 0.5 && f.textChars > 2500) -
    1.2 * Number(f.controlsPerKChars > 25) -
    1.5 * s('has_payment_fields') -
    0.8 * s('role_feed'),
  feed_social: (f, s) =>
    3 * s('role_feed') +
    1.5 * s('infinite_scroll') +
    1.4 * Number(f.repeatedCards >= 8 && !s('readerable')),
  search_results: (_f, s) =>
    3.2 * s('search_results_pattern') + 0.4 * s('has_site_search'),
  form_checkout: (f, s) =>
    3.2 * s('has_payment_fields') +
    2 * s('has_password_field') +
    1.6 * s('multi_step_form') +
    1 * Number(f.requiredFields >= 3) +
    0.8 * Number(f.forms >= 1 && f.textChars < 3000),
  web_app: (f, s) =>
    2.2 * s('rich_text_editor') +
    2.2 * s('data_grid') +
    1.6 * Number(f.controlsPerKChars > 25 && f.textChars < 6000) +
    1.2 * s('map_container'),
  docs_reference: (f, s) =>
    2.4 * s('code_blocks') +
    1.4 * s('many_tables') +
    0.6 * Number(f.structuredMain && s('readerable') === 1),
  media_video: (_f, s) =>
    3 * s('jsonld_video') +
    2 * s('og_type_video') +
    2.6 * s('large_video_in_main'),
  other: (_f, s) => 1.2 + 0.8 * s('jsonld_product'),
};

/** Softmax temperature: higher = more confident separations. */
const SCALE = 1.6;

export function classifyPage(f: CategoryFeatures): {
  probs: Record<PageCategory, number>;
  top: PageCategory;
  p: number;
} {
  const s = (x: PageSignal): number => (f.signals.has(x) ? 1 : 0);
  const scores = PAGE_CATEGORIES.map((c) => WEIGHTS[c](f, s) * SCALE);
  const max = Math.max(...scores);
  const exps = scores.map((v) => Math.exp(v - max));
  const total = exps.reduce((a, b) => a + b, 0);
  const probs = {} as Record<PageCategory, number>;
  let top: PageCategory = 'other';
  let p = 0;
  PAGE_CATEGORIES.forEach((c, i) => {
    const v = (exps[i] ?? 0) / total;
    probs[c] = Math.round(v * 1000) / 1000;
    if (v > p) {
      p = v;
      top = c;
    }
  });
  return { probs, top, p: Math.round(p * 1000) / 1000 };
}
