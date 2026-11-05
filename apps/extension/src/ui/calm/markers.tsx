// Owner: Lucius (round 8, ROUND8 §5). The only things the simplified page adds to what the page says, and only inside
// it: a green dot before a "Live" label, an "Ad" tag on paid content, and "N min read" under an article's headline.
// Each says something the page already says, more clearly. Nothing here invents information.
import { isLive } from '@webable/core';
import type { ElementJudgment, PageUnderstanding } from '@webable/core';
import type { JSX } from 'preact';

/** A short label that says the page is live. */
export const LIVE_RE = /^(live|live updates|live now|watch live)$/i;
export const LIVE_MAX_CHARS = 24;
/** Jev's fine role for a live badge (round 8). Live elements are Jev's live badges and what it says is live now (core isLive). */
export const LIVE_FINE = 'live_badge';
/** Paid content: Jev's fine role (sponsored, advertising), or its "paid content dressed as a story" answer, at p >= 0.9. */
export const AD_FINE: ReadonlySet<string> = new Set(['sponsored', 'advertising']);
export const AD_MIN_P = 0.9;
/** Reading speed for "N min read" (words per minute). */
export const WORDS_PER_MINUTE = 230;

const squash = (t: string): string => t.replace(/\s+/g, ' ').trim();

/** A short label saying the page is live ("LIVE", "Live updates"), read on this device. */
export function isLiveText(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = squash(text).replace(/^[•●·\s]+|[•●·:\s]+$/g, '');
  return t.length > 0 && t.length <= LIVE_MAX_CHARS && LIVE_RE.test(t);
}

/** Minutes to read `words` words: words / 230, rounded, at least 1. */
export function readMinutes(words: number): number {
  return Math.max(1, Math.round(Math.max(0, words) / WORDS_PER_MINUTE));
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

/** The page already says how long it takes to read ("6 min read", "4 minute read"). */
export function saysMinRead(text: string): boolean {
  return /\b\d+\s*(?:-\s*)?(?:min|mins|minute|minutes)\.?\s+read\b/i.test(text) || /\bmin(?:ute)?s?\.?\s+read\b/i.test(text);
}

/** The page's own "5 min read" (a number, then min or minutes, then read). */
const OWN_READ_RE = /\b(\d{1,3})\s*(?:-\s*)?(?:min|mins|minute|minutes)\.?\s+read\b/i;

/**
 * The reading-time line under an article's headline: the page's own ("5 min read" next to its headline, which the
 * simplified header would otherwise drop), else ours ("N min read": words / 230), else null when the page says it
 * somewhere we cannot place. The words are the article's paragraphs: in the main region Jev named (p >= 0.8), else
 * the page's <article>, else <main>.
 */
export function readTimeLine(doc: Document, u: PageUnderstanding | null, elementFor: (id: string) => Element | null): string | null {
  const body = doc.body;
  if (!body) return null;
  const pageText = body.innerText ?? body.textContent ?? '';
  const h1 = squash(doc.querySelector('h1')?.textContent ?? '').slice(0, 40);
  const at = h1 ? squash(pageText).indexOf(h1) : -1;
  const own = at >= 0 ? OWN_READ_RE.exec(squash(pageText).slice(at, at + 800)) : null;
  if (own) return `${Number(own[1])} min read`;
  if (saysMinRead(pageText)) return null;
  let root: Element | null = null;
  const mr = u?.mainRegion;
  if (mr && mr.id !== 'none' && mr.p >= 0.8) root = elementFor(mr.id);
  root ??= doc.querySelector('article') ?? doc.querySelector('main') ?? body;
  let words = 0;
  for (const p of Array.from(root.querySelectorAll('p'))) words += countWords(p.textContent ?? '');
  if (!words) words = countWords((root as HTMLElement).innerText ?? root.textContent ?? '');
  return words ? `${readMinutes(words)} min read` : null;
}

/** Jev's judgments by fine role, for the markers: elements judged live badges, and elements judged paid content. */
export interface Marks<T = Element> {
  live: T[];
  ads: T[];
}

type MarkJudgment = Pick<ElementJudgment, 'id' | 'fine' | 'fineP' | 'liveP' | 'paidAsStoryP'>;

export function marksFrom<T>(elements: ReadonlyArray<MarkJudgment>, elementFor: (id: string) => T | null): Marks<T> {
  const live: T[] = [];
  const ads: T[] = [];
  for (const e of elements) {
    const fine = e.fine as string | undefined;
    const p = e.fineP ?? 0;
    const liveEl = isLive(e as ElementJudgment);
    const adEl = (!!fine && AD_FINE.has(fine) && p >= AD_MIN_P) || (e.paidAsStoryP ?? 0) >= AD_MIN_P;
    if (!liveEl && !adEl) continue;
    const el = elementFor(e.id);
    if (!el) continue;
    if (liveEl) live.push(el);
    if (adEl) ads.push(el);
  }
  return { live, ads };
}

export function pageMarks(u: PageUnderstanding | null, elementFor: (id: string) => Element | null): Marks {
  if (!u) return { live: [], ads: [] };
  return marksFrom(u.elements, elementFor);
}

/** The item drawn from `el` is paid content: it is, or sits inside, an element Jev judged sponsored or advertising. */
export function isAdItem(el: Element | null | undefined, marks: Marks | null | undefined): boolean {
  if (!el || !marks?.ads.length) return false;
  return marks.ads.some((a) => a === el || a.contains(el));
}

/**
 * The live label to show for an item drawn from `el` with this label text: the text itself when it says live, else
 * the short text of a live badge Jev found in the item (when the item shows no label of its own, or shows that one).
 */
export function liveLabelFor(el: Element | null | undefined, label: string | null | undefined, marks: Marks | null | undefined): string | null {
  if (isLiveText(label)) return squash(label!);
  if (!el || !marks?.live.length) return null;
  for (const b of marks.live) {
    if (b !== el && !el.contains(b) && !b.contains(el)) continue;
    const t = squash(b.textContent ?? '');
    if (!t || t.length > LIVE_MAX_CHARS) continue;
    if (!label || squash(label).toLowerCase() === t.toLowerCase()) return t;
  }
  return null;
}

/** The green dot before a live label. It pulses gently only when moving things are fine for this person. */
export function LiveDot({ pulse }: { pulse: boolean }): JSX.Element {
  return <span class="wa-live__dot" data-pulse={pulse ? '' : undefined} aria-hidden="true" />;
}

/** A kicker that may be a live label (dot + label) — the page's words either way. */
export function Kicker({ text, live, pulse }: { text: string | null; live: string | null; pulse: boolean }): JSX.Element | null {
  if (live) {
    return (
      <span class="wa-kicker wa-live">
        <LiveDot pulse={pulse} />
        {live}
      </span>
    );
  }
  return text ? <span class="wa-kicker">{text}</span> : null;
}

export function AdTag(): JSX.Element {
  return <span class="wa-adtag">Ad</span>;
}

/** Styles for the markers, scoped under .wa-calm and sized from the fit's tokens. */
export const markersCss = `
.wa-calm .wa-live{display:inline-flex;align-items:center;gap:.4em}
.wa-calm .wa-live__dot{flex:none;display:inline-block;width:.55em;height:.55em;border-radius:50%;background:#1f9d55;box-shadow:0 0 0 0 rgba(31,157,85,.45)}
.wa-calm .wa-live__dot[data-pulse]{animation:wa-live-pulse 2.4s ease-in-out infinite}
@keyframes wa-live-pulse{0%,100%{box-shadow:0 0 0 0 rgba(31,157,85,.45)}50%{box-shadow:0 0 0 .32em rgba(31,157,85,0)}}
@media (prefers-reduced-motion: reduce){.wa-calm .wa-live__dot[data-pulse]{animation:none}}
.wa-calm[data-motion=reduce] .wa-live__dot[data-pulse]{animation:none}
.wa-calm .wa-adtag{display:inline-flex;align-items:center;align-self:flex-start;width:max-content;margin:0 0 .3em;padding:.08em .5em;border-radius:.35em;
  font-size:.78em;font-weight:600;letter-spacing:.02em;line-height:1.5;color:var(--wa-ink-2);box-shadow:inset 0 0 0 1px var(--wa-line-strong)}
.wa-calm .wa-readtime{margin-top:calc(var(--wa-lead-gap)*1.2)}
.wa-calm .wa-story__text>.wa-adtag,.wa-calm .wa-row__main>.wa-adtag{margin-bottom:.15em}
`;
