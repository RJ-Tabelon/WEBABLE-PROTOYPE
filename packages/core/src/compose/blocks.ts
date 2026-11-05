// Round 10: a group's components as data. tidyBlocks cleans what the planner returned (no markdown, empty optional
// text -> null, warnings get the warning icon, page order), validateBlocks checks it against the group and the closed
// catalog, flatten draws it as plain text (Jev reads that; so do logs and the probe). The model never emits markup.
// The one mark kept is **…**: words the page itself shows in bold (the extension sends them so). The model's ** stays
// only around words the page bolds; every code check and Jev read the text without it.
import { markersIn } from '../reword/check';
import { COMPOSE_ICONS } from '../types';
import type { ComposeBlock, ComposeGroupIn, ComposeIcon, ComposeKind } from '../types';

export const COMPOSE_KINDS: readonly ComposeKind[] = Object.freeze([
  'prose', 'keyfacts', 'steps', 'stats', 'compare', 'callout', 'definitions', 'quote', 'contact', 'points',
]);

const ICONS: ReadonlySet<string> = new Set(COMPOSE_ICONS);
const KINDS: ReadonlySet<string> = new Set(COMPOSE_KINDS);
const TONES = new Set(['warning', 'important', 'tip', 'key']);
const CONTACT_KINDS = new Set(['phone', 'email', 'address', 'hours', 'web', 'other']);

/** Limits code holds the planner to (the prompt asks for less: titles of 6 words, labels of 4). */
export const COMPOSE_LIMITS = Object.freeze({
  maxBlocks: 8,
  titleWords: 8,
  labelWords: 6,
  maxRows: 14,
  maxTiles: 6,
  /** A group the extension sends holds at most this many units and characters. */
  maxUnits: 10,
  maxChars: 3_000,
});

export const isComposeIcon = (x: unknown): x is ComposeIcon => typeof x === 'string' && ICONS.has(x);

/* ------------------------------------------------------------------ */
/* Tidy                                                                */
/* ------------------------------------------------------------------ */

/* ---------- bold: the page's own, never added ---------- */

const BOLD_RE = /\*\*([^*\n]+?)\*\*/g;

/** The text without bold marks (what every check, Jev and the logs read). */
export function stripBold(s: string): string {
  return s.replace(/\*\*/g, '');
}

/** Words only, for comparing bold runs: lower case, punctuation as spaces, link markers kept. */
const boldWords = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}⟦⟧]+/gu, ' ').trim();

/** The runs of words the page shows in bold in this group (from its units' **…**), as boldWords. */
export function pageBoldRuns(group: ComposeGroupIn): string[] {
  return group.units.flatMap((u) => [...u.text.matchAll(BOLD_RE)].map((m) => boldWords(m[1]!)).filter(Boolean));
}

/**
 * **…** kept only around words the page itself shows in bold (the same words, whole, inside one of its bold runs);
 * any other ** (added bold, an unbalanced mark) is dropped and its words stay.
 */
export function keepPageBold(s: string, runs: readonly string[]): string {
  const KEEP = '\u0001';
  const kept = s.replace(BOLD_RE, (_m, inner: string) => {
    const w = boldWords(inner);
    if (!w || !runs.some((r) => ` ${r} `.includes(` ${w} `))) return inner;
    const lead = /^\s*/.exec(inner)![0];
    const tail = /\s*$/.exec(inner)![0];
    return `${lead}${KEEP}${inner.trim()}${KEEP}${tail}`;
  });
  return stripBold(kept).replaceAll(KEEP, '**');
}

/* ---------- text fields ---------- */

/** One line of text: no markdown but the page's own bold, spaces squashed. */
function cleanText(s: unknown, runs: readonly string[]): string {
  if (typeof s !== 'string') return '';
  return keepPageBold(s.replace(/__|`/g, ''), runs).replace(/\s+/g, ' ').trim();
}

/** The cleaners for one group (bold is checked against its own bold runs). */
function cleaners(runs: readonly string[]) {
  const clean = (s: unknown): string => cleanText(s, runs);
  return {
    clean,
    /** An item's text without a list mark or number the model put in front ("1. ", "- ", "• "). */
    cleanItem: (s: unknown): string => clean(s).replace(/^(?:[-*•]|\d{1,2}[.)])\s+/, ''),
    /** Prose keeps its paragraph breaks (a blank line). */
    cleanProse: (s: unknown): string =>
      typeof s !== 'string'
        ? ''
        : s
          .split(/\n\s*\n/)
          .map((p) => clean(p).replace(/^#+\s+/, ''))
          .filter(Boolean)
          .join('\n\n'),
    opt: (s: unknown): string | null => clean(s) || null,
  };
}
/** Icons are kept as given (validateBlocks rejects one outside the catalog); '' and anything not a string is null. */
function icon(x: unknown): ComposeIcon | null {
  return typeof x === 'string' && x.trim() ? (x.trim() as ComposeIcon) : null;
}
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});
const strs = (x: unknown): string[] => arr(x).filter((s): s is string => typeof s === 'string').map((s) => s.trim());

function tidyOne(raw: unknown, runs: readonly string[]): ComposeBlock | null {
  const { clean, cleanItem, cleanProse, opt } = cleaners(runs);
  const b = obj(raw);
  const src = strs(b.src);
  switch (b.k) {
    case 'prose':
      return { k: 'prose', src, text: cleanProse(b.text) };
    case 'keyfacts':
      return {
        k: 'keyfacts', src, title: opt(b.title), icon: icon(b.icon),
        rows: arr(b.rows).map((r) => ({ label: cleanItem(obj(r).label), value: clean(obj(r).value), icon: icon(obj(r).icon) })),
      };
    case 'steps':
      return {
        k: 'steps', src, title: opt(b.title), lead: opt(b.lead),
        steps: arr(b.steps).map((s) => ({ title: cleanItem(obj(s).title), detail: opt(obj(s).detail) })),
      };
    case 'stats':
      return {
        k: 'stats', src,
        tiles: arr(b.tiles).map((t) => ({ label: clean(obj(t).label), value: clean(obj(t).value), note: opt(obj(t).note), icon: icon(obj(t).icon) })),
      };
    case 'compare':
      return {
        k: 'compare', src, title: opt(b.title), columns: strs(b.columns).map(clean),
        rows: arr(b.rows).map((r) => ({ label: clean(obj(r).label), cells: arr(obj(r).cells).map(clean) })),
      };
    case 'callout': {
      const tone = TONES.has(b.tone as string) ? (b.tone as 'warning' | 'important' | 'tip' | 'key') : 'important';
      // Warnings always get the warning icon.
      return { k: 'callout', src, tone, title: clean(b.title), text: clean(b.text), icon: tone === 'warning' ? 'triangle-alert' : icon(b.icon) };
    }
    case 'definitions':
      return { k: 'definitions', src, title: opt(b.title), items: arr(b.items).map((i) => ({ term: cleanItem(obj(i).term), meaning: clean(obj(i).meaning) })) };
    case 'quote':
      return { k: 'quote', src, text: clean(b.text).replace(/^["“”']+|["“”']+$/g, '').trim(), who: clean(b.who), role: opt(b.role) };
    case 'contact':
      return {
        k: 'contact', src, title: opt(b.title),
        rows: arr(b.rows).map((r) => {
          const kind = CONTACT_KINDS.has(obj(r).kind as string) ? (obj(r).kind as 'phone') : 'other';
          return { kind, label: cleanItem(obj(r).label), value: clean(obj(r).value) };
        }),
      };
    case 'points':
      return { k: 'points', src, title: opt(b.title), items: arr(b.items).map((i) => ({ icon: icon(obj(i).icon), title: cleanItem(obj(i).title), text: clean(obj(i).text) })) };
    default:
      return null;
  }
}

/**
 * A prose block with empty text keeps the page's own words for its units (the planner need not copy them out, which
 * is faster and exact). Only paragraphs and quotations can be kept this way; a list or table unit leaves the text
 * empty, and validateBlocks says so.
 */
function pageWords(group: ComposeGroupIn, src: string[]): string {
  const units = src.map((id) => group.units.find((u) => u.id === id));
  if (!units.length || units.some((u) => !u || (u.kind !== 'para' && u.kind !== 'quote'))) return '';
  return group.units.filter((u) => src.includes(u.id)).map((u) => u.text.replace(/\s+/g, ' ').trim()).join('\n\n');
}

/**
 * The planner's blocks, cleaned, in page order: blocks are ordered by the first unit they cover (stable), so the
 * layout reads in the page's order. A 'key' callout the model put first stays first; any other goes last.
 * Small repairs that keep every check honest: a paragraph no block covers is added as the page's own words, a list
 * the planner split in two is joined, and a single step or point becomes prose. Unknown kinds are dropped
 * (validateBlocks then finds the units they covered uncovered).
 */
export function tidyBlocks(group: ComposeGroupIn, raw: unknown): ComposeBlock[] {
  const order = new Map(group.units.map((u, i) => [u.id, i]));
  const firstOf = (b: ComposeBlock) => Math.min(...b.src.map((s) => order.get(s) ?? 1e6), 1e6);
  const runs = pageBoldRuns(group);
  const blocks = arr(raw)
    .map((r) => tidyOne(r, runs))
    .filter((b): b is ComposeBlock => b !== null)
    .map((b) => (b.k === 'prose' && !b.text ? { ...b, text: pageWords(group, b.src) } : b));
  const isKey = (b: ComposeBlock) => b.k === 'callout' && b.tone === 'key';
  const keyFirst = blocks.length > 0 && isKey(blocks[0]!);
  const keys = blocks.filter(isKey);
  // Units no block covers that are paragraphs keep the page's own words (the planner most often forgets the last one).
  const covered = new Set(blocks.filter((b) => !isKey(b)).flatMap((b) => b.src));
  const missed = group.units.filter((u) => !covered.has(u.id) && (u.kind === 'para' || u.kind === 'quote'));
  const filled: ComposeBlock[] = missed.map((u) => ({ k: 'prose', src: [u.id], text: pageWords(group, [u.id]) }));
  const rest = mergeRuns([...blocks.filter((b) => !isKey(b)), ...filled]
    .map((b, i) => ({ b, i, at: firstOf(b) }))
    .sort((x, y) => x.at - y.at || x.i - y.i)
    .map((x) => x.b))
    .map(loneItem);
  return keyFirst ? [...keys, ...rest] : [...rest, ...keys];
}

/** Prose runs are one block; a run of the same list-like kind, the later ones untitled, is one block too (the
 *  planner sometimes splits a list). */
function mergeRuns(blocks: ComposeBlock[]): ComposeBlock[] {
  const out: ComposeBlock[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    const src = (a: ComposeBlock, c: ComposeBlock) => [...new Set([...a.src, ...c.src])];
    // Prose next to prose is one block of paragraphs (a planner that keeps every paragraph as it is writes one each).
    if (prev && prev.k === 'prose' && b.k === 'prose' && prev.text && b.text) {
      out[out.length - 1] = { ...prev, src: src(prev, b), text: `${prev.text}\n\n${b.text}` };
      continue;
    }
    if (prev && prev.k === b.k && 'title' in b && !b.title) {
      if (prev.k === 'points' && b.k === 'points') out[out.length - 1] = { ...prev, src: src(prev, b), items: [...prev.items, ...b.items] };
      else if (prev.k === 'steps' && b.k === 'steps' && !b.lead) out[out.length - 1] = { ...prev, src: src(prev, b), steps: [...prev.steps, ...b.steps] };
      else if (prev.k === 'keyfacts' && b.k === 'keyfacts') out[out.length - 1] = { ...prev, src: src(prev, b), rows: [...prev.rows, ...b.rows] };
      else if (prev.k === 'definitions' && b.k === 'definitions') out[out.length - 1] = { ...prev, src: src(prev, b), items: [...prev.items, ...b.items] };
      else out.push(b);
    } else out.push(b);
  }
  return out;
}

/** One step is not a sequence and one point is not a grid: either becomes a sentence of prose. */
function loneItem(b: ComposeBlock): ComposeBlock {
  if (b.k === 'steps' && b.steps.length === 1) {
    const s = b.steps[0]!;
    const sentence = s.detail ? `${s.title.replace(/[.:]$/, '')}. ${s.detail}` : s.title;
    return { k: 'prose', src: b.src, text: [b.lead, sentence].filter(Boolean).join(' ') };
  }
  if (b.k === 'points' && b.items.length === 1) {
    const p = b.items[0]!;
    return { k: 'prose', src: b.src, text: `${p.title.replace(/[.:]$/, '')}: ${p.text}` };
  }
  return b;
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

const TONE_WORD: Record<'warning' | 'important' | 'tip' | 'key', string> = {
  warning: 'Warning', important: 'Important', tip: 'Tip', key: 'Main point',
};

/** Every piece of text a block shows, in reading order (titles and labels included, icons not), without bold marks. */
export function blockTexts(b: ComposeBlock): string[] {
  return shownTexts(b).map(stripBold);
}

function shownTexts(b: ComposeBlock): string[] {
  switch (b.k) {
    case 'prose':
      return [b.text];
    case 'keyfacts':
      return [b.title ?? '', ...b.rows.flatMap((r) => [r.label, r.value])];
    case 'steps':
      return [b.title ?? '', b.lead ?? '', ...b.steps.flatMap((s) => [s.title, s.detail ?? ''])];
    case 'stats':
      return b.tiles.flatMap((t) => [t.label, t.value, t.note ?? '']);
    case 'compare':
      return [b.title ?? '', ...b.columns, ...b.rows.flatMap((r) => [r.label, ...r.cells])];
    case 'callout':
      return [b.title, b.text];
    case 'definitions':
      return [b.title ?? '', ...b.items.flatMap((i) => [i.term, i.meaning])];
    case 'quote':
      return [`“${b.text}”`, b.who, b.role ?? ''];
    case 'contact':
      return [b.title ?? '', ...b.rows.flatMap((r) => [r.label, r.value])];
    case 'points':
      return [b.title ?? '', ...b.items.flatMap((i) => [i.title, i.text])];
  }
}

export const isKeyCallout = (b: ComposeBlock): boolean => b.k === 'callout' && b.tone === 'key';

/**
 * The sentences a layout shows, without titles, labels or defined terms (a link's words may fairly name a card or a
 * term; written beside the marker in a sentence, they would show twice).
 */
export function runningText(blocks: ComposeBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.k === 'prose') parts.push(b.text);
    else if (b.k === 'keyfacts') parts.push(...b.rows.map((r) => r.value));
    else if (b.k === 'steps') parts.push(b.lead ?? '', ...b.steps.map((s) => s.detail ?? ''));
    else if (b.k === 'stats') parts.push(...b.tiles.map((t) => t.note ?? ''));
    else if (b.k === 'compare') parts.push(...b.rows.flatMap((r) => r.cells));
    else if (b.k === 'callout') parts.push(b.text);
    else if (b.k === 'contact') parts.push(...b.rows.map((r) => r.value));
    else if (b.k === 'points') parts.push(...b.items.map((i) => i.text));
  }
  return stripBold(parts.filter(Boolean).join('\n'));
}

/**
 * All the words a layout shows as one text, for the code checks: no kind labels and no step numbers (so a "1." before
 * a step never counts as a number). `key: false` leaves out the 'key' callout (it only repeats).
 */
export function layoutText(blocks: ComposeBlock[], opts: { key?: boolean } = {}): string {
  return blocks
    .filter((b) => opts.key !== false || !isKeyCallout(b))
    .flatMap(blockTexts)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');
}

/** The page's own text of a group: its units in order, a blank line between them (no bold marks). */
export function groupText(group: ComposeGroupIn): string {
  return stripBold(group.units.map((u) => u.text.trim()).join('\n\n'));
}

/** The layout as plain text, the way it reads on the page: each block under a short label, steps numbered, no bold. */
export function flatten(blocks: ComposeBlock[]): string {
  const head = (label: string, title: string | null) => (title ? `[${label}: ${title}]` : `[${label}]`);
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.k) {
      case 'prose':
        out.push(b.text);
        break;
      case 'keyfacts':
        out.push(head('Key facts', b.title), ...b.rows.map((r) => `- ${r.label}: ${r.value}`));
        break;
      case 'steps':
        out.push(head('Steps', b.title), ...(b.lead ? [b.lead] : []), ...b.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? ` ${s.detail}` : ''}`));
        break;
      case 'stats':
        out.push('[Figures]', ...b.tiles.map((t) => `- ${t.label}: ${t.value}${t.note ? ` (${t.note})` : ''}`));
        break;
      case 'compare':
        out.push(head('Table', b.title), b.columns.join(' | '), ...b.rows.map((r) => [r.label, ...r.cells].join(' | ')));
        break;
      case 'callout':
        out.push(`[${TONE_WORD[b.tone]}: ${b.title}] ${b.text}`);
        break;
      case 'definitions':
        out.push(head('Words explained', b.title), ...b.items.map((i) => `- ${i.term}: ${i.meaning}`));
        break;
      case 'quote':
        out.push(`[Quote] “${b.text}” (${b.who}${b.role ? `, ${b.role}` : ''})`);
        break;
      case 'contact':
        out.push(head('Contact', b.title), ...b.rows.map((r) => `- ${r.label}: ${r.value}`));
        break;
      case 'points':
        out.push(head('Points', b.title), ...b.items.map((i) => `- ${i.title}: ${i.text}`));
        break;
    }
  }
  return stripBold(out.join('\n'));
}

/* ------------------------------------------------------------------ */
/* Validate                                                            */
/* ------------------------------------------------------------------ */

export interface BlockValidation {
  ok: boolean;
  /** Every unit is covered by at least one block that is not a 'key' callout. */
  covered: boolean;
  uncovered: string[];
  /** Plain sentences naming each problem (the planner reads them on a retry). */
  problems: string[];
}

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/**
 * Checks the blocks against the group and the catalog: known kinds; src ids that exist; every unit covered by a
 * block that is not a 'key' callout; required text present; compare cells match the columns; icons only from
 * COMPOSE_ICONS; at most one 'key' callout and no link markers in it; titles and labels short.
 */
export function validateBlocks(group: ComposeGroupIn, blocks: ComposeBlock[]): BlockValidation {
  const problems: string[] = [];
  const ids = new Set(group.units.map((u) => u.id));
  const add = (p: string) => {
    if (!problems.includes(p)) problems.push(p);
  };
  if (blocks.length === 0) add('There are no blocks.');
  if (blocks.length > COMPOSE_LIMITS.maxBlocks) add(`Use at most ${COMPOSE_LIMITS.maxBlocks} blocks.`);
  const iconOk = (x: ComposeIcon | null, where: string) => {
    if (x !== null && !isComposeIcon(x)) add(`${where} uses an icon that is not in the list.`);
  };
  const need = (s: string | null | undefined, where: string) => {
    if (!s || !s.trim()) add(`${where} is empty.`);
  };
  const title = (s: string | null, where: string) => {
    if (s && words(s) > COMPOSE_LIMITS.titleWords) add(`${where} title is longer than ${COMPOSE_LIMITS.titleWords} words.`);
  };
  const label = (s: string, where: string) => {
    need(s, where);
    if (words(s) > COMPOSE_LIMITS.labelWords) add(`${where} is longer than ${COMPOSE_LIMITS.labelWords} words.`);
  };
  let keys = 0;
  blocks.forEach((b, i) => {
    const at = `Block ${i + 1} (${b.k})`;
    if (!KINDS.has(b.k)) return add(`${at} is not a kind in the list.`);
    if (!b.src.length) add(`${at} names no units in src.`);
    for (const s of b.src) if (!ids.has(s)) add(`${at} names unit ${s}, which is not in this group.`);
    switch (b.k) {
      case 'prose':
        if (!b.text.trim()) add(`${at} text is empty: only paragraphs can be kept as the page has them (text ""); write a list or table out in a block.`);
        break;
      case 'keyfacts':
        title(b.title, at);
        iconOk(b.icon, at);
        if (!b.rows.length || b.rows.length > COMPOSE_LIMITS.maxRows) add(`${at} needs 1 to ${COMPOSE_LIMITS.maxRows} rows.`);
        b.rows.forEach((r, j) => {
          label(r.label, `${at} row ${j + 1} label`);
          need(r.value, `${at} row ${j + 1} value`);
          iconOk(r.icon, `${at} row ${j + 1}`);
        });
        break;
      case 'steps':
        title(b.title, at);
        if (b.steps.length < 2 || b.steps.length > COMPOSE_LIMITS.maxRows) add(`${at} needs 2 to ${COMPOSE_LIMITS.maxRows} steps.`);
        b.steps.forEach((s, j) => need(s.title, `${at} step ${j + 1} title`));
        break;
      case 'stats':
        if (!b.tiles.length || b.tiles.length > COMPOSE_LIMITS.maxTiles) add(`${at} needs 1 to ${COMPOSE_LIMITS.maxTiles} tiles.`);
        b.tiles.forEach((t, j) => {
          label(t.label, `${at} tile ${j + 1} label`);
          need(t.value, `${at} tile ${j + 1} value`);
          iconOk(t.icon, `${at} tile ${j + 1}`);
        });
        break;
      case 'compare':
        title(b.title, at);
        if (b.columns.length < 2) add(`${at} needs at least 2 columns (the first names the rows).`);
        b.columns.forEach((c, j) => need(c, `${at} column ${j + 1}`));
        if (b.rows.length < 2 || b.rows.length > COMPOSE_LIMITS.maxRows) add(`${at} needs 2 to ${COMPOSE_LIMITS.maxRows} rows.`);
        b.rows.forEach((r, j) => {
          need(r.label, `${at} row ${j + 1} label`);
          if (r.cells.length !== b.columns.length - 1) add(`${at} row ${j + 1} has ${r.cells.length} cells; it needs ${b.columns.length - 1} (one per column after the first).`);
        });
        break;
      case 'callout':
        need(b.title, `${at} title`);
        title(b.title, at);
        need(b.text, `${at} text`);
        iconOk(b.icon, at);
        if (b.tone === 'key') {
          keys++;
          if (markersIn(`${b.title} ${b.text}`).length) add(`${at} is the main point; it may not hold link markers.`);
        }
        break;
      case 'definitions':
        title(b.title, at);
        if (!b.items.length) add(`${at} needs at least 1 term.`);
        b.items.forEach((d, j) => {
          label(d.term, `${at} term ${j + 1}`);
          need(d.meaning, `${at} term ${j + 1} meaning`);
        });
        break;
      case 'quote':
        need(b.text, `${at} text`);
        need(b.who, `${at} who`);
        break;
      case 'contact':
        title(b.title, at);
        if (!b.rows.length) add(`${at} needs at least 1 row.`);
        b.rows.forEach((r, j) => {
          label(r.label, `${at} row ${j + 1} label`);
          need(r.value, `${at} row ${j + 1} value`);
        });
        break;
      case 'points':
        title(b.title, at);
        if (b.items.length < 2 || b.items.length > COMPOSE_LIMITS.maxRows) add(`${at} needs 2 to ${COMPOSE_LIMITS.maxRows} points.`);
        b.items.forEach((p, j) => {
          need(p.title, `${at} point ${j + 1} title`);
          title(p.title, `${at} point ${j + 1}`);
          need(p.text, `${at} point ${j + 1} text`);
          iconOk(p.icon, `${at} point ${j + 1}`);
        });
        break;
    }
  });
  if (keys > 1) add('Use at most one main-point (key) callout.');
  const coveredIds = new Set(blocks.filter((b) => !isKeyCallout(b)).flatMap((b) => b.src));
  const uncovered = group.units.map((u) => u.id).filter((id) => !coveredIds.has(id));
  return { ok: problems.length === 0 && uncovered.length === 0, covered: uncovered.length === 0, uncovered, problems };
}
