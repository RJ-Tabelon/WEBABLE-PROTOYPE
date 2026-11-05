// Owner: X (round 7). schema.org JSON-LD: Recipe and NewsArticle (pure parsing; the reader hands over the script text).

import { collapse, isoDuration, plain } from './text';

export type Ld = Record<string, unknown>;

const MAX_OBJECTS = 200;

/** Parse every JSON-LD script; flattens arrays, @graph and mainEntity. Bad JSON is skipped. */
export function parseLd(texts: string[]): Ld[] {
  const out: Ld[] = [];
  const add = (x: unknown, depth: number) => {
    if (out.length >= MAX_OBJECTS || depth > 4 || x === null || typeof x !== 'object') return;
    if (Array.isArray(x)) {
      for (const y of x) add(y, depth + 1);
      return;
    }
    const o = x as Ld;
    if (o['@type'] !== undefined) out.push(o);
    if (o['@graph'] !== undefined) add(o['@graph'], depth + 1);
    if (o.mainEntity !== undefined && typeof o.mainEntity === 'object') add(o.mainEntity, depth + 1);
  };
  for (const t of texts) {
    if (!t || t.length > 2_000_000) continue;
    try {
      add(JSON.parse(t.replace(/^\s*<!--|-->\s*$/g, '')), 0);
    } catch {
      /* not JSON */
    }
  }
  return out;
}

export function typesOf(o: Ld): string[] {
  const t = o['@type'];
  const list = Array.isArray(t) ? t : [t];
  return list.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^.*[/#]/, '').toLowerCase());
}

export function findLd(objs: Ld[], types: string[]): Ld | null {
  const want = types.map((t) => t.toLowerCase());
  return objs.find((o) => typesOf(o).some((t) => want.includes(t))) ?? null;
}

function str(x: unknown): string {
  if (typeof x === 'string') return plain(x);
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return '';
}

/** An image's URL from a string, an ImageObject, or a list of either. */
export function imageUrl(x: unknown): string | undefined {
  if (!x) return undefined;
  if (typeof x === 'string') return /^(https?:)?\/\//i.test(x) || x.startsWith('/') ? x : undefined;
  if (Array.isArray(x)) {
    for (const y of x) {
      const u = imageUrl(y);
      if (u) return u;
    }
    return undefined;
  }
  if (typeof x === 'object') {
    const o = x as Ld;
    return imageUrl(o.url) ?? imageUrl(o.contentUrl) ?? imageUrl(o['@id']);
  }
  return undefined;
}

/** Names from a string, a Person/Organization, or a list of either. */
export function namesOf(x: unknown): string[] {
  if (!x) return [];
  if (typeof x === 'string') return x.trim() ? [plain(x)] : [];
  if (Array.isArray(x)) return x.flatMap(namesOf).filter((n, i, a) => n && a.indexOf(n) === i);
  if (typeof x === 'object') {
    const n = str((x as Ld).name);
    return n ? [n] : [];
  }
  return [];
}

export interface LdRecipe {
  title: string;
  imageSrc?: string;
  meta: Array<{ label: string; value: string }>;
  ingredients: string[];
  steps: string[];
}

/** A Recipe object in plain strings. */
export function recipeFromLd(o: Ld): LdRecipe | null {
  const title = str(o.name) || str(o.headline);
  const ingredients = (Array.isArray(o.recipeIngredient) ? o.recipeIngredient : Array.isArray(o.ingredients) ? o.ingredients : [])
    .map(str)
    .filter(Boolean)
    .slice(0, 80);
  const steps = stepsOf(o.recipeInstructions).slice(0, 60);
  if (!title || (!ingredients.length && !steps.length)) return null;
  const meta: Array<{ label: string; value: string }> = [];
  const time = (label: string, v: unknown) => {
    const d = isoDuration(str(v));
    if (d) meta.push({ label, value: d });
  };
  time('Prep', o.prepTime);
  time('Cook', o.cookTime);
  time('Total', o.totalTime);
  const yields = (Array.isArray(o.recipeYield) ? o.recipeYield : [o.recipeYield]).map(str).filter(Boolean);
  const servings = yields.find((y) => /^\d+$/.test(y));
  const yieldText = yields.find((y) => !/^\d+$/.test(y));
  if (servings) meta.push({ label: 'Servings', value: servings });
  if (yieldText && yieldText !== servings) meta.push({ label: 'Yield', value: yieldText });
  const rating = o.aggregateRating && typeof o.aggregateRating === 'object' ? (o.aggregateRating as Ld) : null;
  if (rating) {
    const v = Number(str(rating.ratingValue));
    const n = Number(str(rating.ratingCount) || str(rating.reviewCount));
    if (Number.isFinite(v) && v > 0) {
      const value = `${Math.round(v * 10) / 10}${Number.isFinite(n) && n > 0 ? ` (${n.toLocaleString('en-US')} ratings)` : ''}`;
      meta.push({ label: 'Rating', value });
    }
  }
  const out: LdRecipe = { title, meta, ingredients, steps };
  const img = imageUrl(o.image);
  if (img) out.imageSrc = img;
  return out;
}

/** recipeInstructions as a flat list of step texts (strings, HowToStep, HowToSection, ItemList). */
export function stepsOf(x: unknown, depth = 0): string[] {
  if (!x || depth > 4) return [];
  if (typeof x === 'string') {
    const t = String(x);
    const parts = /<li[\s>]/i.test(t) ? t.split(/<li[^>]*>/i) : t.split(/\n+|\r+/);
    return parts.map(plain).filter((s) => s.length > 1);
  }
  if (Array.isArray(x)) return x.flatMap((y) => stepsOf(y, depth + 1));
  if (typeof x === 'object') {
    const o = x as Ld;
    if (o.itemListElement !== undefined) return stepsOf(o.itemListElement, depth + 1);
    const t = str(o.text) || str(o.name) || str(o.description);
    return t ? [t] : [];
  }
  return [];
}

export const ARTICLE_TYPES = [
  'NewsArticle', 'Article', 'BlogPosting', 'ReportageNewsArticle', 'AnalysisNewsArticle', 'OpinionNewsArticle',
  'BackgroundNewsArticle', 'ReviewNewsArticle', 'LiveBlogPosting', 'TechArticle', 'ScholarlyArticle', 'Report',
];

export interface LdArticle {
  headline: string;
  description?: string;
  imageSrc?: string;
  authors: string[];
  published?: string;
  modified?: string;
  section?: string;
}

export function articleFromLd(o: Ld): LdArticle | null {
  const headline = str(o.headline) || str(o.name);
  if (!headline) return null;
  const out: LdArticle = { headline, authors: namesOf(o.author).slice(0, 6) };
  const d = str(o.description);
  if (d) out.description = d.slice(0, 400);
  const img = imageUrl(o.image) ?? imageUrl(o.thumbnailUrl);
  if (img) out.imageSrc = img;
  const pub = str(o.datePublished);
  if (pub) out.published = pub;
  const mod = str(o.dateModified);
  if (mod) out.modified = mod;
  const sec = Array.isArray(o.articleSection) ? str(o.articleSection[0]) : str(o.articleSection);
  if (sec) out.section = collapse(sec);
  return out;
}
