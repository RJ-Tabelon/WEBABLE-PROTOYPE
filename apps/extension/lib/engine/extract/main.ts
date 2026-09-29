/**
 * Main-content detection on the live DOM, without cloning (engine.md 2.11).
 * Constants and scoring follow Mozilla Readability.js (Apache-2.0):
 * tag base scores, class weight +-25, paragraph score 1 + commas + min(len/100, 3),
 * propagation to 5 ancestors with dividers 1, 2, level*3, and a final
 * (1 - link density) factor with hash links weighted 0.3.
 * Only textContent is read (no layout); nothing read here leaves the device.
 */

const UNLIKELY =
  /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i;
const MAYBE = /and|article|body|column|content|main|mathjax|shadow/i;
const POS =
  /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i;
const NEG =
  /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|footer|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget/i;
const TAG_BASE: Record<string, number> = {
  DIV: 5,
  PRE: 3,
  TD: 3,
  BLOCKQUOTE: 3,
  ADDRESS: -3,
  OL: -3,
  UL: -3,
  DL: -3,
  DD: -3,
  DT: -3,
  LI: -3,
  FORM: -3,
  H1: -5,
  H2: -5,
  H3: -5,
  H4: -5,
  H5: -5,
  H6: -5,
  TH: -5,
};

const classString = (e: Element): string =>
  `${typeof e.className === 'string' ? e.className : ''} ${e.id}`;

export function classWeight(e: Element): number {
  let w = 0;
  for (const s of [typeof e.className === 'string' ? e.className : '', e.id]) {
    if (!s) continue;
    if (NEG.test(s)) w -= 25;
    if (POS.test(s)) w += 25;
  }
  return w;
}

export const normText = (e: Element): string =>
  (e.textContent ?? '').replace(/\s+/g, ' ').trim();

/** True when `e` has at least `min` non-space characters of text (stops early). */
export function hasText(e: Element, min: number): boolean {
  const walker = e.ownerDocument.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  let n = 0;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    n += (t.nodeValue ?? '').replace(/\s+/g, '').length;
    if (n >= min) return true;
  }
  return false;
}

export function linkDensity(e: Element): number {
  const total = normText(e).length;
  if (!total) return 0;
  let linked = 0;
  for (const a of e.getElementsByTagName('a')) {
    const weight = /^#.+/.test(a.getAttribute('href') ?? '') ? 0.3 : 1;
    linked += normText(a).length * weight;
  }
  return Math.min(1, linked / total);
}

export type MainFoundBy =
  'landmark' | 'single_article' | 'readability' | 'ambiguous';

export interface MainResult {
  el: Element | null;
  foundBy: MainFoundBy;
  /** Top scored candidates (best first), 1-4 elements, for page analysis when ambiguous. */
  candidates: Element[];
  ambiguous: boolean;
}

export interface MainOptions {
  /** Paragraph cap for scoring. */
  cap?: number;
  /** Visibility predicate; defaults to "has a layout box". */
  visible?: (el: Element) => boolean;
}

export function findMainContent(
  doc: Document,
  opts: MainOptions = {},
): MainResult {
  const cap = opts.cap ?? 3000;
  const visible = opts.visible ?? (() => true);

  const landmarks = [...doc.querySelectorAll('main, [role="main"]')].filter(
    visible,
  );
  const lm = landmarks.find((m) => hasText(m, 420));
  if (lm)
    return { el: lm, foundBy: 'landmark', candidates: [lm], ambiguous: false };

  const articles = [...doc.querySelectorAll('article')].filter(visible);
  const topLevel = articles.filter(
    (a) => !articles.some((b) => b !== a && b.contains(a)),
  );
  if (topLevel.length === 1 && topLevel[0] && hasText(topLevel[0], 420)) {
    return {
      el: topLevel[0],
      foundBy: 'single_article',
      candidates: [topLevel[0]],
      ambiguous: false,
    };
  }

  const score = new Map<Element, number>();
  let n = 0;
  for (const p of doc.querySelectorAll('p, pre, td, blockquote')) {
    if (++n > cap) break;
    const parent = p.parentElement;
    if (!parent) continue;
    const sig = classString(parent);
    if (UNLIKELY.test(sig) && !MAYBE.test(sig)) continue;
    const t = normText(p);
    if (t.length < 25) continue;
    if (!visible(p)) continue;
    const s =
      1 + t.split(/[,，、]/).length + Math.min(Math.floor(t.length / 100), 3);
    let a: Element | null = parent;
    for (
      let level = 0;
      a && a !== doc.body && a !== doc.documentElement && level < 5;
      level++
    ) {
      if (!score.has(a))
        score.set(a, (TAG_BASE[a.tagName] ?? 0) + classWeight(a));
      const divider = level === 0 ? 1 : level === 1 ? 2 : level * 3;
      score.set(a, (score.get(a) ?? 0) + s / divider);
      a = a.parentElement;
    }
  }

  const ranked = [...score.entries()]
    .map(([el, s]) => [el, s * (1 - linkDensity(el))] as const)
    .filter(([, s]) => s > 0)
    .sort((x, y) => y[1] - x[1]);

  // Distinct candidates: drop ancestors/descendants of better-ranked ones.
  const candidates: Element[] = [];
  const candidateScores: number[] = [];
  for (const [el, s] of ranked) {
    if (candidates.some((c) => c.contains(el) || el.contains(c))) continue;
    candidates.push(el);
    candidateScores.push(s);
    if (candidates.length >= 4) break;
  }
  const best = candidates[0] ?? null;
  if (!best)
    return { el: null, foundBy: 'ambiguous', candidates: [], ambiguous: true };
  const s1 = candidateScores[0] ?? 0;
  const s2 = candidateScores[1] ?? 0;
  const ambiguous = s2 > 0 && s1 < 1.25 * s2;
  return {
    el: best,
    foundBy: ambiguous ? 'ambiguous' : 'readability',
    candidates,
    ambiguous,
  };
}

/**
 * Readability's isProbablyReaderable: sum of sqrt(len - 140) over visible
 * p/pre/article text blocks of at least 140 characters reaches 20.
 */
export function isProbablyReaderable(
  doc: Document,
  visible: (el: Element) => boolean = () => true,
): boolean {
  let score = 0;
  for (const node of doc.querySelectorAll('p, pre, article')) {
    if (!visible(node)) continue;
    const sig = classString(node);
    if (UNLIKELY.test(sig) && !MAYBE.test(sig)) continue;
    if (node.matches('li p')) continue;
    const len = normText(node).length;
    if (len < 140) continue;
    score += Math.sqrt(len - 140);
    if (score > 20) return true;
  }
  return false;
}
