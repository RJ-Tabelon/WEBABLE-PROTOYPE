// Owner: Lucius (round 8); B (round 10). The open rule: on a reading page the WebAble page is the default.
//
// Round 10: the WebAble page opens by itself on EVERY reading page, busy or not (round 8 needed a busy page). It opens
// once, the moment the page is understood, when ALL hold:
// - Jev is sure (p >= 0.8) the page is for reading or looking something up: its probability summed over the reading
//   kinds (READING_PURPOSES), so a news home Jev reads as 0.64 news index + 0.25 home portal counts as 0.89;
// - the main content is clear (mainRegion p >= 0.8, or a content block of importance >= 3) and the meaning check
//   passed;
// - the person has not clicked, pressed a key or scrolled past one screen since the page loaded;
// - the site is not set to "Original page".
// Never on sign-in, checkout, account or statement pages, or a page with password or payment fields; task forms keep
// their stepper rule (in the controller). The distractions are still counted, for the log only.
// Pure: the controller measures the page and passes numbers in.
import type { ElementJudgment, PagePurpose } from '@webable/core';

export const READING_PURPOSES: ReadonlySet<string> = new Set<PagePurpose>([
  'article', 'news_index', 'recipe', 'record_stats', 'scoreboard', 'schedule', 'standings', 'info_guide', 'faq',
  'home_portal', 'directory_listing', 'comparison',
  // round 8 purposes that are pages to read: a live blog, one game's page.
  'live_blog', 'game_detail',
]);

/** Pages that are never replaced, whatever else is true. */
export const NEVER_PURPOSES: ReadonlySet<string> = new Set<PagePurpose>(['sign_in', 'checkout', 'account_dashboard', 'bill_statement']);

/** The distraction family (fine roles), compared as strings. */
export const DISTRACTION_FINE: ReadonlySet<string> = new Set([
  'advertising', 'sponsored', 'upsell_promo', 'newsletter_signup', 'teaser_other_content', 'social_share', 'comments',
  'video_autoplay', 'carousel', 'popup',
  // Jev's round 8 roles that used to be answered as the ones above (an ad's own "Advertisement" label is not counted
  // again: it is part of the ad).
  'app_install_banner', 'paywall_prompt', 'betting_odds', 'related_links', 'testimonial',
]);

export const PURPOSE_MIN_P = 0.8;
export const DISTRACTION_MIN_P = 0.7;
export const MAIN_REGION_MIN_P = 0.8;
export const MAIN_IMPORTANCE = 3;

/** One "distraction" box bigger than this share of the page is a layout container or an overlay, not a part. */
export const MAX_BOX_SHARE = 0.4;
/** The never-replaced kinds together at or above this probability keep the page as it is. */
export const NEVER_MAX_P = 0.2;

export function isDistraction(e: Pick<ElementJudgment, 'fine' | 'fineP'>): boolean {
  return !!e.fine && DISTRACTION_FINE.has(e.fine as string) && (e.fineP ?? 0) >= DISTRACTION_MIN_P;
}

export function countDistractions(elements: ReadonlyArray<Pick<ElementJudgment, 'fine' | 'fineP'>>): number {
  return elements.filter(isDistraction).length;
}

/**
 * The share of the page's area the distractions cover: outermost boxes only (an ad inside a counted ad is not
 * counted twice), capped at 1. `boxes` are [element, area in px²]; `contains(a, b)` is a.contains(b).
 */
export function distractionShare<T>(boxes: ReadonlyArray<readonly [T, number]>, pageArea: number, contains: (a: T, b: T) => boolean): number {
  if (!(pageArea > 0)) return 0;
  const sorted = boxes.filter(([, a]) => a > 0 && a <= MAX_BOX_SHARE * pageArea).slice().sort((x, y) => y[1] - x[1]);
  const kept: T[] = [];
  let sum = 0;
  for (const [el, area] of sorted) {
    if (kept.some((k) => k === el || contains(k, el))) continue;
    kept.push(el);
    sum += area;
  }
  return Math.min(1, sum / pageArea);
}

/** P(the page is for reading): the purpose's probabilities summed over the reading kinds (or its top p). */
export function readingP(purpose: OpenInput['purpose']): number {
  if (!purpose) return 0;
  const probs = purpose.probs && Object.keys(purpose.probs).length ? purpose.probs : { [purpose.kind]: purpose.p };
  let sum = 0;
  for (const [k, p] of Object.entries(probs)) if (READING_PURPOSES.has(k) && Number.isFinite(p)) sum += p;
  return Math.min(1, sum);
}

/** P(the page is one that is never replaced: sign-in, checkout, account, statement). */
export function neverP(purpose: OpenInput['purpose']): number {
  if (!purpose) return 0;
  const probs = purpose.probs && Object.keys(purpose.probs).length ? purpose.probs : { [purpose.kind]: purpose.p };
  let sum = 0;
  for (const [k, p] of Object.entries(probs)) if (NEVER_PURPOSES.has(k) && Number.isFinite(p)) sum += p;
  return Math.min(1, sum);
}

export interface OpenInput {
  purpose: { kind: string; p: number; probs?: Record<string, number> } | null | undefined;
  mainRegion: { id: string; p: number } | null | undefined;
  elements: ReadonlyArray<Pick<ElementJudgment, 'fine' | 'fineP' | 'importance'>>;
  /** Distractions' share of the page's area (0..1), from distractionShare (for the log only). */
  share: number;
  /** Password or payment fields on the page. */
  sensitive: boolean;
  /** The structural meaning check: true passed, false failed, null not run (no meaning read). */
  meaningPass: boolean | null;
  /** A click, key press or scroll past one screen since the page loaded. */
  interacted: boolean;
  /** The site is set to "Original page". */
  pinned: boolean;
}

export interface OpenVerdict {
  open: boolean;
  /** Plain words: why it opened or why not. */
  reason: string;
  /** Distractions (p >= 0.7) and their share of the page, for the log. */
  count: number;
  share: number;
}

export function openVerdict(i: OpenInput): OpenVerdict {
  const count = countDistractions(i.elements);
  const out = (open: boolean, reason: string): OpenVerdict => ({ open, reason, count, share: i.share });
  const kind = i.purpose?.kind ?? null;
  if ((kind && NEVER_PURPOSES.has(kind)) || neverP(i.purpose) >= NEVER_MAX_P) return out(false, 'sign-in, checkout, account and statement pages keep their own layout');
  if (i.sensitive) return out(false, 'pages with password or payment fields keep their own layout');
  if (i.pinned) return out(false, 'this site is set to the original page');
  if (readingP(i.purpose) < PURPOSE_MIN_P) return out(false, 'it is not clearly a page for reading');
  const mainClear = (i.mainRegion && i.mainRegion.id !== 'none' && i.mainRegion.p >= MAIN_REGION_MIN_P) ||
    i.elements.some((e) => (e.importance ?? 0) >= MAIN_IMPORTANCE && !isDistraction(e));
  if (!mainClear) return out(false, 'the main content is not clear');
  if (i.meaningPass !== true) return out(false, i.meaningPass === false ? 'the simpler page would change what this page shows first' : 'the page’s meaning could not be checked');
  if (i.interacted) return out(false, 'you had already started using the page');
  return out(true, 'a page for reading');
}
