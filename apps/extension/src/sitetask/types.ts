// Real-website tasks for the onboarding's Finding part (docs/design/ONBOARDING.md, round 8c).
// The onboarding page asks the background to open real sites one after another in a task tab; on each site the
// content script runs in task mode (WebAble changes nothing), shows one "Find and click" card, measures, and reports.

export interface SiteTaskSpec {
  id: string;
  /** Plain site name shown to the person, e.g. "CNN". */
  name: string;
  url: string;
  /** What to find, shown as "Find and click: {prompt}". */
  prompt: string;
  /** A click counts as found when the clicked element or its nearest link matches any of these. */
  target: { hrefIncludes?: string[]; text?: string[] };
  /** Our own prior: is this a busy page (ads, teasers, moving parts)? */
  busy: boolean;
}

export interface SiteTaskResult {
  id: string;
  name: string;
  busy: boolean;
  found: boolean;
  skipped: boolean;
  /** Time from the card appearing to the found click; null when skipped or not found. */
  ms: number | null;
  /** Clicks on something other than the target. */
  wrongClicks: number;
  /** Clicks that landed within 24 CSS px of the target's box but outside it. */
  nearMisses: number;
  /** Presses that started on one element and were released on another. */
  slips: number;
  presses: number;
  /** How far the person scrolled, in screen heights. */
  scrollScreens: number;
  /** Something was moving in view during the task (playing video, running animation, auto-advancing carousel). */
  motionSeen: boolean;
  /** Ads and sponsored boxes counted on the page. */
  adsSeen: number;
}

/** Messages on chrome.runtime between the onboarding page, the background and the task tab. */
export type SiteTaskMessage =
  | { siteTask: 'start'; tasks: SiteTaskSpec[] }
  | { siteTask: 'whoami' }
  | { siteTask: 'done'; result: SiteTaskResult }
  | { siteTask: 'finished'; results: SiteTaskResult[] };
