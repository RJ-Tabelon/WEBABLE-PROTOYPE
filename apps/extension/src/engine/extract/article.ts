// Owner: X (round 7). Article metadata: NewsArticle JSON-LD (headline, image, author, dates) and the page elements that
// show them (the headline, the byline, the lead image, the body), for Calm view's article template.

import { ARTICLE_TYPES, articleFromLd, findLd, type Ld } from './jsonld';
import { collapse, descendants, hasWord, isControl, isHeading, similar, textOf } from './text';
import type { ArticleNodes, ArticleMeta, SNode } from './types';

const BYLINE_WORD = /^(byline|bylines|author|authors|attribution|contributor|contributors|writer)$/;
const DATE_WORD = /^(timestamp|date|dateline|published|updated|pubdate|time)$/;
const TEASER_WORD = /^(related|recirc|promo|teaser|recommended|trending|more|outbrain|taboola|card|cards)$/;

function insideLinkOrTeaser(n: SNode): boolean {
  for (let p: SNode | null | undefined = n; p; p = p.parent) {
    if (p.tag === 'a' && p.attrs?.href !== undefined) return true;
    if (hasWord(p, TEASER_WORD)) return true;
  }
  return false;
}

function fileStem(src: string): string {
  try {
    const u = new URL(src, 'https://x.invalid/');
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    return last.replace(/\.[a-z0-9]+$/i, '').toLowerCase().slice(0, 40);
  } catch {
    return '';
  }
}

/** The article on the page, or null when the page is not one. */
export function findArticle(root: SNode, ld: Ld[], excluded: (n: SNode) => boolean): ArticleNodes | null {
  const o = findLd(ld, ARTICLE_TYPES);
  const fromLd = o ? articleFromLd(o) : null;
  const nodes = descendants(root).filter((n) => !excluded(n));
  const h1s = nodes.filter((n) => (n.tag === 'h1' || (n.role === 'heading' && /h1/.test(n.cls))) && textOf(n).length >= 8);
  let headline: SNode | null = null;
  if (fromLd) {
    let best = 0;
    for (const h of nodes.filter((n) => isHeading(n) && textOf(n).length >= 8)) {
      const s = similar(fromLd.headline, textOf(h));
      if (s > best) {
        best = s;
        headline = h;
      }
    }
    if (best < 0.5) headline = h1s[0] ?? null;
  } else headline = h1s[0] ?? null;
  if (!fromLd && !headline) return null;

  // Long paragraphs: the body. Without JSON-LD the page must look like an article: 4+ paragraphs and 1200+ characters
  // in one box, and no form to fill in (a task page with some prose is not an article).
  const paras = nodes.filter((n) => n.tag === 'p' && textOf(n).length >= 60 && !insideLinkOrTeaser(n));
  const paraChars = paras.reduce((s, p) => s + textOf(p).length, 0);
  const body = bodyOf(paras, nodes);
  if (!fromLd) {
    if (paras.length < 4 || paraChars < 1200 || !body) return null;
    const fields = nodes.filter((n) => n.tag === 'input' || n.tag === 'select' || n.tag === 'textarea').length;
    if (fields >= 2) return null;
  }

  const after = (n: SNode | null) => (x: SNode) => !n || (x.i ?? 0) > (n.i ?? 0);
  const near = (n: SNode | null, dy: number) => (x: SNode) => !n || (x.y >= n.y - 600 && x.y <= n.y + dy);
  const byline = nodes.find((n) => after(headline)(n) && near(headline, 1400)(n) && hasWord(n, BYLINE_WORD) && textOf(n).length >= 3 && textOf(n).length <= 140 && !isControl(n))
    ?? nodes.find((n) => after(headline)(n) && near(headline, 1400)(n) && /^by\s+\S/i.test(n.text) && textOf(n).length <= 100)
    ?? null;
  const date = nodes.find((n) => after(headline)(n) && near(headline, 1400)(n) && (n.tag === 'time' || hasWord(n, DATE_WORD)) && textOf(n).length >= 3 && textOf(n).length <= 80 && !isControl(n)) ?? null;
  const stem = fromLd?.imageSrc ? fileStem(fromLd.imageSrc) : '';
  const big = nodes.filter((n) => (n.tag === 'img' || n.tag === 'video' || n.tag === 'picture') && n.w >= 280 && n.h >= 150 && !insideLinkOrTeaser(n));
  const leadImage = (stem ? big.find((n) => n.attrs?.src && fileStem(n.attrs.src) === stem) : undefined)
    ?? big.find((n) => near(headline, 1200)(n) && (!body || n.y <= body.y + 300))
    ?? null;

  const meta: ArticleMeta = {
    headline: fromLd?.headline ?? collapse(textOf(headline as SNode)),
    authors: fromLd?.authors.length ? fromLd.authors : byline ? authorsFrom(textOf(byline)) : [],
    source: fromLd ? 'json-ld' : 'page',
  };
  if (fromLd?.description) meta.description = fromLd.description;
  const imgSrc = fromLd?.imageSrc ?? leadImage?.attrs?.src;
  if (imgSrc) {
    meta.image = { src: imgSrc };
    const alt = leadImage?.attrs?.alt;
    if (alt) meta.image.alt = alt;
  }
  if (fromLd?.published) meta.published = fromLd.published;
  if (fromLd?.modified) meta.modified = fromLd.modified;
  if (fromLd?.section) meta.section = fromLd.section;
  return { meta, headline, byline, leadImage, date, body };
}

/** "By Jane Doe and John Roe, CNN" -> ['Jane Doe', 'John Roe', 'CNN']. */
export function authorsFrom(t: string): string[] {
  const s = collapse(t).replace(/^by\s+/i, '').replace(/\s*(updated|published).*$/i, '');
  return s.split(/\s*(?:,|\band\b|&)\s*/i).map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 60).slice(0, 6);
}

/** The box that holds most of the article's paragraphs. */
function bodyOf(paras: SNode[], nodes: SNode[]): SNode | null {
  if (!paras.length) return null;
  const marked = nodes.find((n) => n.attrs?.itemprop === 'articleBody' || hasWord(n, /^(articlebody)$/));
  if (marked) return marked;
  const counts = new Map<SNode, number>();
  for (const p of paras) {
    let up = 0;
    for (let a = p.parent; a && up < 4; a = a.parent, up++) counts.set(a, (counts.get(a) ?? 0) + textOf(p).length);
  }
  const total = paras.reduce((s, p) => s + textOf(p).length, 0);
  let best: SNode | null = null;
  for (const [n, c] of counts) {
    if (c < 0.6 * total) continue;
    if (!best || (n.i ?? 0) > (best.i ?? 0)) best = n; // the deepest box that still holds most of the text
  }
  return best;
}
