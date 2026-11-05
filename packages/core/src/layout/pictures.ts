// Owner: D. The pure rules behind Calm view v3's pictures, news index and type (no DOM, so they are unit-tested here):
// which alt text is junk, what counts as a logo, how a picture is framed, which srcset candidate to load, how
// prominent a story is, when a line is a time, and the type ramp from the person's body size.
// Measured basis: scratchpad round4/design.md §2–§4 (OpenAI, DeepMind and xAI computed CSS; six CNN probe runs).

/* ------------------------------------------------------------------ */
/* Alt text and logos                                                  */
/* ------------------------------------------------------------------ */

/** File names and CMS slugs used as alt text ("Detour Ep.4.jpg", "LP_TITLE_Texted_Homepage", "image 3"). */
export const JUNK_ALT_RE = /\.(jpe?g|png|webp|gif|avif)$|_|^(image|photo|thumb)\b/i;

/** The alt text worth keeping as the picture's description ('' for junk). Alt text is never shown as visible text. */
export function cleanAlt(alt: string | null | undefined): string {
  const a = (alt ?? '').replace(/\s+/g, ' ').trim();
  return !a || JUNK_ALT_RE.test(a) ? '' : a;
}

export interface LogoEvidence {
  /** Rendered size in CSS px. */
  w: number;
  h: number;
  /** Alt, class or file name says logo / wordmark / brand mark. */
  named: boolean;
  /** Inside the site's header, navigation or footer. */
  inChrome: boolean;
  /** Inside a link to the site's home page from its header. */
  homeLink: boolean;
}

/**
 * A logo is never drawn (the site's name is in the top bar). Only small pictures (longest side under 160 px) or
 * pictures in the header, navigation or footer count, so a 245×138 story tile whose file is "…WHITE LOGO STP.jpg"
 * stays a story picture.
 */
export function isLogoPicture(e: LogoEvidence): boolean {
  if (e.homeLink) return true;
  return e.named && (Math.max(e.w, e.h) < 160 || e.inChrome);
}

/* ------------------------------------------------------------------ */
/* Frames                                                              */
/* ------------------------------------------------------------------ */

export interface PictureFrame {
  /** Width ÷ height of the reserved box. */
  ratio: number;
  /** cover: the picture fills its box; contain: it sits in a well at its own shape. */
  fit: 'cover' | 'contain';
  well: boolean;
}

/** Keep the source ratio when it is a photograph's (1.25–2.0); anything taller or wider sits in a 4:3 well. */
export function pictureFrame(w: number, h: number): PictureFrame {
  const ratio = w > 0 && h > 0 ? w / h : 0;
  if (ratio >= 1.25 && ratio <= 2.0) return { ratio, fit: 'cover', well: false };
  return { ratio: 4 / 3, fit: 'contain', well: true };
}

/**
 * The box once the picture has loaded (round 6): its own shape, so a lead picture never sits in a taller box with an
 * empty band above it. Shapes from 3:4 to 2.4:1 fill their box at that shape; a taller or wider picture keeps a box
 * clamped to that range and sits inside it whole (`contain`). Unknown sizes give null (keep the reserved box).
 */
export function loadedFrame(nw: number, nh: number): PictureFrame | null {
  if (!(nw > 0 && nh > 0)) return null;
  const r = nw / nh;
  const lo = 0.75;
  const hi = 2.4;
  if (r >= lo && r <= hi) return { ratio: r, fit: 'cover', well: false };
  return { ratio: Math.min(hi, Math.max(lo, r)), fit: 'contain', well: true };
}

/** Story thumbnails and the lead story picture are always 16:9 (cropped to fill); figures keep pictureFrame. */
export const STORY_RATIO = 16 / 9;

/** A figure goes wide (to the picture column) when its natural width is at least 1.4 × the text column. */
export function isWideFigure(naturalW: number, textColumnPx: number): boolean {
  return naturalW > 0 && textColumnPx > 0 && naturalW >= 1.4 * textColumnPx;
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

export interface SrcCandidate { url: string; w: number | null; x: number | null }

/** Parse a srcset (URLs may hold commas, as CNN's "q=w_860,c_fill" does; a candidate ends at whitespace). */
export function parseSrcset(srcset: string): SrcCandidate[] {
  const out: SrcCandidate[] = [];
  const s = srcset ?? '';
  let i = 0;
  const n = s.length;
  const ws = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  while (i < n) {
    while (i < n && (ws(s[i]!) || s[i] === ',')) i++;
    if (i >= n) break;
    let j = i;
    while (j < n && !ws(s[j]!)) j++;
    let url = s.slice(i, j);
    i = j;
    let desc = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let depth = 0;
      let k = i;
      while (k < n) {
        const c = s[k]!;
        if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) break;
        k++;
      }
      desc = s.slice(i, k).trim();
      i = k + 1;
    }
    if (!url) continue;
    let w: number | null = null;
    let x: number | null = null;
    for (const d of desc.split(/\s+/).filter(Boolean)) {
      const m = /^(\d+(?:\.\d+)?)([wx])$/i.exec(d);
      if (!m) continue;
      if (m[2]!.toLowerCase() === 'w') w = Number(m[1]);
      else x = Number(m[1]);
    }
    out.push({ url, w, x });
  }
  return out;
}

/**
 * The candidate a browser would pick for a box `displayW` CSS px wide at device ratio `dpr`: the smallest width
 * descriptor at least displayW × dpr (else the largest); for density descriptors the smallest at least dpr.
 */
export function pickSrcset(srcset: string, displayW: number, dpr: number): string | null {
  const c = parseSrcset(srcset);
  if (!c.length) return null;
  const target = Math.max(1, displayW) * Math.max(1, dpr);
  const wide = c.filter((x) => x.w != null).sort((a, b) => a.w! - b.w!);
  if (wide.length) return (wide.find((x) => x.w! >= target) ?? wide[wide.length - 1]!).url;
  const dens = c.map((x) => ({ ...x, x: x.x ?? 1 })).sort((a, b) => a.x - b.x);
  return (dens.find((x) => x.x >= dpr) ?? dens[dens.length - 1]!).url;
}

/** A URL with its #hash removed (two links to one story compare equal). */
export function hrefKey(href: string): string {
  const i = href.indexOf('#');
  return i >= 0 ? href.slice(0, i) : href;
}

/** Tiny GIF/PNG/SVG data URIs that lazy loaders park in src until the real picture loads. */
export function isPlaceholderSrc(u: string | null | undefined): boolean {
  if (!u) return true;
  if (/^data:image\/(gif|png|svg)/i.test(u) && u.length < 400) return true;
  return /(^|\/)(blank|spacer|pixel|transparent|placeholder|lazy|loading)\.(gif|png|svg)(\?|$)/i.test(u) || /cnn-placeholder-image/i.test(u);
}

/* ------------------------------------------------------------------ */
/* Stories                                                             */
/* ------------------------------------------------------------------ */

const TIME_RE =
  /^(updated|published|posted)?\s*(\d+\s?(sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|h|m|day|days|d|week|weeks|wk|month|months)\.?\s+ago|just now|yesterday|today|\d{1,2}:\d{2}\s?([ap]\.?m\.?)?(\s+[A-Z]{2,4})?|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(,?\s+\d{4})?|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(\s+\d{4})?|(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})\b/i;

/** "20 min ago", "Updated 9:48 PM EDT", "Oct 23, 2026", "October 2026": a time line on a story card or byline. */
export function isTimeText(s: string): boolean {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 0 && t.length <= 60 && TIME_RE.test(t);
}

/** A short label above a headline ("Analysis", "Live Updates", "Research"): at most 3 words and 24 characters. */
export function isKickerText(s: string): boolean {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length >= 2 && t.length <= 24 && t.split(' ').length <= 3 && !/[.!?]$/.test(t) && !isTimeText(t);
}

export interface StoryEvidence {
  /** This story's picture is the largest story picture whose top is in the first 1.5 screens. */
  largestEarlyPicture: boolean;
  /** Headline font size and the page's body size, in CSS px. */
  headPx: number;
  bodyPx: number;
  /** Top of the story on the page, and the screen height, in CSS px. */
  top: number;
  screenH: number;
  /** Jev picked it as the page's main link. */
  promoted: boolean;
  hasPicture: boolean;
}

/**
 * Prominence the page itself gives a story (design.md F3): +4 for the largest story picture in the first 1.5 screens,
 * +2 when the headline is at least 1.3 × the body size, +1 when it starts in the first screen; plus +3 for Jev's main
 * pick and +1 for having a picture. The lead story is the highest score with a picture.
 */
export function storyScore(e: StoryEvidence): number {
  let s = 0;
  if (e.largestEarlyPicture) s += 4;
  if (e.bodyPx > 0 && e.headPx >= 1.3 * e.bodyPx) s += 2;
  if (e.top >= 0 && e.top < e.screenH) s += 1;
  if (e.promoted) s += 3;
  if (e.hasPicture) s += 1;
  return s;
}

/* ------------------------------------------------------------------ */
/* Type                                                                */
/* ------------------------------------------------------------------ */

/**
 * Heading ratios to the body size F (design.md §2): the large-heading ratio shrinks as F grows, so a person who needs
 * 32 px text still gets a title that fits the screen. Anchors at F = 17 / 24 / 32 / 40; flat outside them. The page
 * title is never more than 2 × F (round 6: 3 × F looked oversized at a laptop window), and the title's px still grow
 * with F so the hierarchy never inverts.
 */
const CALM_RAMP: ReadonlyArray<readonly [number, number, number, number]> = [
  [17, 2.0, 1.45, 1.2],
  [24, 1.8, 1.35, 1.15],
  [32, 1.55, 1.25, 1.1],
  [40, 1.35, 1.18, 1.07],
];

export function calmTypeRatios(F: number): { page: number; section: number; title: number } {
  const first = CALM_RAMP[0]!;
  const last = CALM_RAMP[CALM_RAMP.length - 1]!;
  if (!(F > first[0])) return { page: first[1], section: first[2], title: first[3] };
  if (F >= last[0]) return { page: last[1], section: last[2], title: last[3] };
  for (let i = 0; i < CALM_RAMP.length - 1; i++) {
    const a = CALM_RAMP[i]!;
    const b = CALM_RAMP[i + 1]!;
    if (F >= a[0] && F <= b[0]) {
      const t = (F - a[0]) / (b[0] - a[0]);
      return { page: a[1] + (b[1] - a[1]) * t, section: a[2] + (b[2] - a[2]) * t, title: a[3] + (b[3] - a[3]) * t };
    }
  }
  return { page: last[1], section: last[2], title: last[3] };
}

/** Meta text (dates, captions, bylines) is never below 16 px: the references' 12–14 px is too small. */
export function calmMetaPx(F: number): number {
  return Math.max(16, 0.85 * F);
}

/** Text column in characters: the person's measure, never above 68 (WCAG 1.4.8 asks for at most 80). */
export function calmMeasureCh(targetCpl: number | null | undefined): number {
  const t = typeof targetCpl === 'number' && Number.isFinite(targetCpl) ? targetCpl : 66;
  return Math.max(30, Math.min(68, t));
}
