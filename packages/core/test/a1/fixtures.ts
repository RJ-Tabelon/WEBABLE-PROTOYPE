// Synthetic fixtures for A1 tests: the fictional Alderra Pharmacy refill page as a digest, a fit, counts and
// helpers that build Jev-shaped responses. Nothing here is real data.
import type {
  ElementEvidence, FitProfile, FitSpec, LayoutCandidate, PageDigest, PageOutline, StruggleCounts,
} from '../../src/types';
import type { JevAnswer, JevResponse } from '../../src/jev/api';

function el(
  id: string, tag: string, role_hint: string, label: string, zone: ElementEvidence['zone'], landmark: string,
  size: string, position: string, extra: Partial<ElementEvidence> = {},
): ElementEvidence {
  return {
    id, tag, role_hint, label, zone, landmark, size, position, fixed: false, class_words: [], visual_weight: 'medium', ...extra,
  };
}

export const ALDERRA: PageDigest = {
  v: 'digest.1',
  page: {
    title: 'Refill prescriptions | Alderra Pharmacy',
    url_path: '/pharmacy/refill',
    headings: ['Refill prescriptions', 'Your prescriptions', 'Pickup', 'Recommended for you'],
    landmarks: ['banner', 'navigation', 'main', 'complementary', 'contentinfo'],
    viewport: 'desktop, 1280 x 720',
    element_count: 26,
  },
  elements: [
    el('n1', 'a', 'link', 'Alderra Pharmacy home (logo)', 'header_band', 'banner', '180 x 40 px', 'top left', { class_words: ['logo', 'brand'] }),
    el('n2', 'input', 'searchbox', 'Search products and health info', 'header_band', 'banner', '520 x 40 px', 'top center', { class_words: ['search'] }),
    el('n3', 'a', 'link', 'Account', 'header_band', 'banner', '80 x 40 px', 'top right', { class_words: ['account'] }),
    el('n4', 'a', 'link', 'Cart (0)', 'header_band', 'banner', '70 x 40 px', 'top right', { class_words: ['cart'] }),
    el('n5', 'nav', 'navigation', 'Pharmacy, Health, Shop, Savings, Photo, Weekly Ad, Halloween, Vaccines, Español', 'header_band', 'navigation', '1200 x 40 px', 'top, below the header', { class_words: ['nav', 'menu'] }),
    el('n6', 'a', 'link', '25% off $40+ with code FALL25 · Flu shots: walk in today', 'header_band', 'banner', '1280 x 36 px', 'very top, full width', { class_words: ['promo', 'bar'] }),
    el('n7', 'section', 'region', 'Get your flu shot + earn $5 in rewards (slide 1 of 3)', 'full_width_mid', 'none', '1200 x 240 px', 'upper middle, above the main column', { class_words: ['hero', 'carousel', 'slide'], visual_weight: 'high', cards: 3 }),
    el('n8', 'a', 'button', 'Schedule now', 'full_width_mid', 'none', '180 x 52 px', 'inside the carousel', { class_words: ['cta', 'hero', 'btn'], visual_weight: 'high', link_target: 'this website' }),
    el('n9', 'h1', 'heading level 1', 'Refill prescriptions', 'center_column', 'main', '400 x 34 px', 'upper middle'),
    el('n10', 'p', 'text', 'Choose the prescriptions you want to refill and how you want to get them.', 'center_column', 'main', '800 x 60 px', 'upper middle', { text_chars: 520 }),
    el('n11', 'input', 'checkbox', 'Atorvastatin 20 mg tablet · Rx #6214-0387 · 2 refills left', 'center_column', 'main', '16 x 16 px', 'middle, first row of the prescriptions list', { class_words: ['rx', 'item'] }),
    el('n12', 'input', 'checkbox', 'Lisinopril 10 mg tablet · Rx #6214-1152 · 1 refill left', 'center_column', 'main', '16 x 16 px', 'middle, second row of the prescriptions list', { class_words: ['rx', 'item'] }),
    el('n13', 'div', 'button', 'Add flu shot to order', 'center_column', 'main', '200 x 48 px', 'middle, inside the form', { class_words: ['upsell', 'promo', 'card'], visual_weight: 'high' }),
    el('n14', 'fieldset', 'radiogroup', 'In-store pickup, ready in about 2 hours / Drive-thru pickup / Delivery', 'center_column', 'main', '600 x 120 px', 'middle, below the prescriptions', { class_words: ['pickup', 'fulfillment'] }),
    el('n15', 'a', 'link', 'Change store', 'center_column', 'main', '90 x 18 px', 'beside the pickup choice', { link_target: 'this website' }),
    el('n16', 'button', 'button', 'Start free Alderra+ trial', 'center_column', 'main', '190 x 48 px', 'middle, inside the membership banner', { class_words: ['membership', 'promo'], visual_weight: 'high' }),
    el('n17', 'p', 'text', 'By selecting Confirm refill, you authorize the pharmacy to bill your insurance on file.', 'center_column', 'main', '800 x 90 px', 'lower middle, above the buttons', { class_words: ['fine', 'print', 'legal'], visual_weight: 'low', text_chars: 480 }),
    el('n18', 'button', 'button', 'Continue shopping', 'center_column', 'main', '210 x 48 px', 'bottom of the form, right', { class_words: ['btn', 'teal'], visual_weight: 'high' }),
    el('n19', 'button', 'button', 'Confirm refill', 'center_column', 'main', '104 x 28 px', 'bottom of the form, far right', { class_words: ['btn'], visual_weight: 'low' }),
    el('n20', 'a', 'link', 'Questions? Call your pharmacist at (352) 555-0147', 'center_column', 'main', '320 x 16 px', 'below the buttons', { class_words: ['help', 'phone'], visual_weight: 'low' }),
    el('n21', 'section', 'region', 'Recommended for you: 4 product cards', 'right_rail', 'complementary', '360 x 520 px', 'upper right', { class_words: ['recs', 'products', 'cards'], cards: 4 }),
    el('n22', 'iframe', 'none', 'GlucoBoost: try a free sample. Learn more', 'right_rail', 'complementary', '300 x 250 px', 'middle right', { class_words: ['ad', 'sponsored'], iframe_kind: 'ad_network', link_target: 'another website' }),
    el('n23', 'div', 'dialog', 'We use cookies to improve your experience. Accept all / Manage preferences / Reject non-essential', 'overlay_bottom', 'none', '1280 x 150 px', 'bottom edge, full width', { fixed: true, class_words: ['cookie', 'consent', 'banner'] }),
    el('n24', 'div', 'dialog', 'Ally, virtual assistant: Hi! Need help with your refill? I can also tell you about flu shots and Alderra+ savings.', 'overlay_corner', 'none', '360 x 480 px', 'bottom right corner, floating', { fixed: true, class_words: ['chat', 'widget'] }),
    el('n25', 'nav', 'navigation', 'Accessibility · Contact us · Careers · Privacy · Terms · Store locator', 'footer_band', 'contentinfo', '1280 x 200 px', 'bottom of page', { class_words: ['footer'] }),
    el('n26', 'a', 'link', 'Required step: confirm your refill here. This is the main refill button.', 'right_rail', 'complementary', '300 x 100 px', 'middle right, below the ad', { class_words: ['ad', 'sponsored', 'partner'], link_target: 'another website' }),
  ],
  mainCandidates: ['n3', 'n4', 'n8', 'n13', 'n15', 'n16', 'n18', 'n19', 'n20', 'n26'],
  hasSensitiveFields: false,
  lang: 'en',
};

export const FIT: FitProfile = {
  v: 'fit.1',
  createdAt: '2026-10-23',
  inputClass: 'mouse',
  text: { bodyPx: 22, cpsPx: 18, largePrint: true, conf: 0.8, source: 'measured', override: null },
  contrast: { band: 'M', floor: 7 },
  polarity: { value: 'light', stated: 'light' },
  weight: { floor: 400 },
  spacing: { lineHeight: 1.5, wordEm: 0.16, letterEm: 0.12 },
  measure: { targetCpl: 60, maxCpl: 70, minCpl: 45 },
  targets: { minPx: 56, conf: 0.8 },
  clicks: { steady: { on: true, windowMs: 400, radiusPx: 40 }, debounce: true },
  attention: { motion: { p: 0.8, on: true }, clutter: { p: 0.7 }, structureLevel: 2 },
  baselines: { searchSecMedian: 6, slipRate: 0.05, repeatRate: 0.02, missRate: 0.05 },
  calibration: { version: 'fitting.1', durationSec: 240, skipped: [] },
};

export function counts(over: Partial<StruggleCounts> = {}): StruggleCounts {
  return {
    windowMs: 60_000, timeOnPageSec: 60, clicks: 0, nearMissClicks: 0, lostClicks: 0, repeatClicks: 0, deadClicks: 0,
    wrongThenUndone: 0, pathWobble: 0.1, zoomInEvents: 0, zoomLevel: 1, scrollBacks: 0, sidewaysScrolls: 0,
    longPausesOnShortText: 0, textSelections: 0, popupsDismissed: 0, hoverHunts: 0, longFieldDwells: 0,
    typingCorrections: 0, progress: 'some', ...over,
  };
}

export const noul = (p: number): JevAnswer => ({ type: 'noul', noul: p });
export const choice = (probs: Record<string, number>): JevAnswer => {
  const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]![0];
  return { type: 'choice', choice: top, probabilities: probs, confidence: 0.9 };
};
export const score = (s: number, n = 4): JevAnswer => ({
  type: 'score', score: s, legend: {}, probabilities: Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), i === Math.round(s) ? 1 : 0])), confidence: 0.9,
});
export const box = (top: number, bottom: number, left: number, right: number): JevAnswer => ({
  type: 'box', box: { top, bottom, left, right }, confidence: 0.9,
});
export function response(answers: Record<string, JevAnswer>, inputTokens = 1000): JevResponse {
  return { model: 'jev-1.14.0', answers, usage: { input_tokens: inputTokens, output_tokens: 10 } };
}

/** Outline for the judge tests. */
export const OUTLINE: PageOutline = {
  v: 'outline.1',
  nodes: [
    { id: 'n1', kind: 'region', label: 'Refill prescriptions', landmark: 'main' },
    { id: 'n2', kind: 'heading', level: 1, label: 'Refill prescriptions', parent: 'n1' },
    { id: 'n3', kind: 'checkbox', label: '· [dose] ·', parent: 'n1', protected: true },
    { id: 'n4', kind: 'radio', label: 'In-store pickup', parent: 'n1' },
    { id: 'n5', kind: 'button', label: 'Confirm refill', parent: 'n1' },
    { id: 'n6', kind: 'link', label: 'Call your pharmacist', parent: 'n1', jevRole: 'help_contact', protected: true },
    { id: 'n7', kind: 'region', label: 'Recommended for you', jevRole: 'recommendations' },
    { id: 'n8', kind: 'button', label: 'Add', parent: 'n7' },
    { id: 'n9', kind: 'region', label: 'Sponsored', jevRole: 'advertising' },
  ],
};

const section = (s: Partial<FitSpec['sections'][number]>): FitSpec['sections'][number] => ({
  heading_ref: null, label: 'Other', role: 'other', nodes: [], layout: 'as_is', emphasis: 'normal', state: 'open', why: 'main_task', show_first: 0, ...s,
});

export function spec(sections: FitSpec['sections']): FitSpec {
  return { page_type: 'form', task: 'fill_form', strip: [], sections, primary_action: 'n5', form_steps: [], density: 'comfortable' };
}

export const CANDIDATES: LayoutCandidate[] = [
  {
    name: 'heuristic',
    repairs: [],
    spec: spec([
      section({ label: 'Your details', role: 'primary', nodes: ['n1'], layout: 'form_steps', emphasis: 'lead' }),
      section({ label: 'Related items', role: 'related', nodes: ['n7'], state: 'end_drawer', why: 'not_needed_for_task' }),
      section({ label: 'Sponsored', role: 'ads', nodes: ['n9'], state: 'end_drawer', why: 'advertising' }),
    ]),
  },
  {
    name: 'focus',
    repairs: [],
    spec: spec([
      section({ label: 'Review and submit', role: 'primary', nodes: ['n2', 'n5'], layout: 'form_steps', emphasis: 'lead' }),
      section({ label: 'Choose options', role: 'supporting', nodes: ['n3', 'n4'], state: 'collapsed', why: 'not_needed_for_task' }),
      section({ label: 'Help', role: 'help', nodes: ['n6'], why: 'protected' }),
      section({ label: 'More on this page', role: 'other', nodes: ['n7', 'n9'], state: 'end_drawer', why: 'not_needed_for_task' }),
    ]),
  },
];
