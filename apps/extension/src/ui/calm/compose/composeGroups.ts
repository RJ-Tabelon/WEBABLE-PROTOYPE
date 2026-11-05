// Owner: D (round 10). Splits a section's body blocks into the groups the WebAble page asks to have laid out: the
// paragraphs, lists and tables under one heading become units (the page's own words, links as ⟦n⟧ markers, words the
// page shows in bold as **…**; italics are not sent); the
// heading stays the page's own and is drawn above the group. Anything that is not running text (pictures, controls,
// fields, bylines, captions, link lists, rich tables) ends a run and stays drawn where it is. Pure apart from reading
// attributes of the blocks' source nodes; nothing here writes to the page.
import type { ComposeGroupIn, ComposeUnit } from '@webable/core';
import { type Block, type FlowBlock, type Inline, type LinkPart, type ListBlock, type TableBlock, isRewritten } from '../model';

export const MAX_UNITS = 10;
export const MAX_CHARS = 3000;
/** Groups shorter than this stay in the page's own words (nothing to gain from laying them out). */
export const MIN_WORDS = 30;

export const BYLINE_RE = /^(by\s|written by|updated|published|last (updated|reviewed)|reviewed by|medically reviewed)|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+(19|20)\d{2}\b/i;

/** One group as the WebAble page draws it: what is asked for, the page's own links for ⟦n⟧, and the blocks it covers. */
export interface GroupSeg {
  k: 'group';
  group: ComposeGroupIn;
  /** links[n - 1] is ⟦n⟧ in the group's units. */
  links: LinkPart[];
  /** The page's own blocks of this run, drawn while the group waits, fails, or the person asks for them. */
  blocks: Block[];
}
/** Blocks drawn as they are (headings, pictures, controls, short runs). */
export interface PlainSeg { k: 'blocks'; blocks: Block[] }
export type Seg = GroupSeg | PlainSeg;

const MARK_CHARS = /[⟦⟧]/g;
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** FNV-1a over the text: the same content always gets the same id. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/* ---------- reading one block into a unit ---------- */

/** Round 9 swaps a rewrite into the paragraph itself: the group keeps the page's own words it saw first (same id). */
const firstSeen = new WeakMap<Node, Inline[]>();

function partsFor(b: FlowBlock): Inline[] {
  if (!isRewritten(b)) {
    firstSeen.set(b.src, b.parts);
    return b.parts;
  }
  const own = firstSeen.get(b.src);
  if (!own) return b.parts;
  // The page's anchors may be out of the document while the rewrite shows: use the live copy of the same link.
  const live = b.parts.filter((p): p is LinkPart => p.t === 'link');
  return own.map((p) => {
    if (p.t !== 'link' || p.el.isConnected) return p;
    const twin = live.find((l) => l.href === p.href && l.text === p.text);
    return twin ? { ...p, el: twin.el } : p;
  });
}

interface Draft { kind: ComposeUnit['kind']; text: string; links: LinkPart[]; words: number }

/** The page's own asterisks never read as a bold mark (∗ looks the same). */
const pageText = (s: string): string => s.replace(MARK_CHARS, '').replace(/\*{2,}/g, (m) => '\u2217'.repeat(m.length));

/**
 * Inline parts as one line: link words become ⟦n⟧ (numbered later, per group); a run the page shows in bold (words
 * and links) becomes **run**, the spaces at its edges outside the marks.
 */
function lineOf(parts: Inline[], links: LinkPart[]): string {
  let s = '';
  let bold = '';
  const close = (): void => {
    const core = bold.trim();
    s += core ? `${/^\s*/.exec(bold)![0]}**${core}**${/\s*$/.exec(bold)![0]}` : bold;
    bold = '';
  };
  for (const p of parts) {
    if (p.t === 'br') {
      close();
      s += ' ';
      continue;
    }
    let piece = '\u0000';
    if (p.t === 'text') piece = pageText(p.text);
    else links.push(p);
    // A space between two bold runs stays inside the run.
    if (p.b || (bold && p.t === 'text' && !/\S/.test(p.text))) bold += piece;
    else {
      close();
      s += piece;
    }
  }
  close();
  return squash(s.replace(/\*\*(\s*)\*\*/g, '$1'));
}

/** Words a line reads as (each ⟦n⟧ placeholder as its link's words; list bullets and bold marks not counted). */
function wordsIn(text: string, links: LinkPart[]): number {
  let i = 0;
  const plain = text.replace(/\*\*/g, '').replace(/\u0000/g, () => ` ${links[i++]?.text ?? ''} `).replace(/(^|\n)\s*•/g, ' ');
  return plain.split(/\s+/).filter(Boolean).length;
}

function isQuote(b: FlowBlock): boolean {
  const el = b.src instanceof Element ? b.src : b.src.parentElement;
  if (el?.closest('blockquote,q')) return b.text.length <= 1200;
  return b.text.length <= 400 && /^["“‘'].{12,}["”’']$/.test(b.text);
}

function isCaptionFlow(b: FlowBlock): boolean {
  const el = b.src instanceof Element ? b.src : b.src.parentElement;
  return !!el?.closest('figcaption,[class*="caption" i],[class*="credit" i],[itemprop="caption"]');
}

function flowUnit(b: FlowBlock): Draft | null {
  if (b.text.length <= 140 && BYLINE_RE.test(b.text)) return null;
  if (isCaptionFlow(b)) return null;
  const links: LinkPart[] = [];
  const text = lineOf(partsFor(b), links);
  if (!text.replace(/\u0000/g, '').trim() && !links.length) return null;
  return { kind: isQuote(b) ? 'quote' : 'para', text, links, words: wordsIn(text, links) };
}

/** A list item's words; null when it holds anything but text and links (a picture, a field, a button). */
function itemLine(item: Block[], links: LinkPart[], depth: number, lines: string[]): boolean {
  let words = '';
  for (const b of item) {
    if (b.b === 'flow') words += ` ${lineOf(partsFor(b), links)}`;
    else if (b.b === 'control' && b.role === 'link') {
      links.push({ t: 'link', el: b.el, text: b.text, href: b.href, help: b.help });
      words += ' \u0000';
    } else if (b.b === 'list') {
      const nested: string[] = [];
      if (!listLines(b, links, depth + 1, nested)) return false;
      if (squash(words)) lines.push(`${'  '.repeat(depth)}• ${squash(words)}`);
      words = '';
      lines.push(...nested);
    } else return false;
  }
  if (squash(words)) lines.push(`${'  '.repeat(depth)}• ${squash(words)}`);
  return true;
}

function listLines(b: ListBlock, links: LinkPart[], depth: number, lines: string[]): boolean {
  for (const item of b.items) if (!itemLine(item, links, depth, lines)) return false;
  return true;
}

function listUnit(b: ListBlock): Draft | null {
  // A list of nothing but links is the site's menu or "related" links, not running text.
  if (b.items.length && b.items.every((it) => it.length === 1 && it[0]!.b === 'control')) return null;
  const links: LinkPart[] = [];
  const lines: string[] = [];
  if (!listLines(b, links, 0, lines) || !lines.length) return null;
  const text = lines.join('\n');
  return { kind: 'list', text, links, words: wordsIn(text, links) };
}

function tableUnit(b: TableBlock): Draft | null {
  const rows = b.rows.map((r) => r.map((c) => squash(pageText(c))).join(' | ')).filter((r) => r.replace(/[|\s]/g, ''));
  if (rows.length < 2) return null;
  const text = rows.join('\n');
  return { kind: 'table', text, links: [], words: wordsIn(text.replace(/\|/g, ' '), []) };
}

/** The unit a block reads as, or null when it ends a run (and is drawn where it is). */
export function unitOf(b: Block): Draft | null {
  let d: Draft | null = null;
  if (b.b === 'flow') d = flowUnit(b);
  else if (b.b === 'list') d = listUnit(b);
  else if (b.b === 'table') d = tableUnit(b);
  return d && d.text.length <= MAX_CHARS ? d : null;
}

/* ---------- runs into groups ---------- */

interface Item { b: Block; d: Draft }

/** Split a run so no group has more than 10 units or 3,000 characters, the parts about the same size. */
export function splitRun<T extends { d: { text: string } }>(run: T[]): T[][] {
  const chars = run.reduce((a, x) => a + x.d.text.length, 0);
  const n = Math.max(1, Math.ceil(run.length / MAX_UNITS), Math.ceil(chars / MAX_CHARS));
  const target = Math.ceil(chars / n);
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const x of run) {
    const len = x.d.text.length;
    if (cur.length && (cur.length >= MAX_UNITS || size + len > MAX_CHARS || (size >= target && out.length < n - 1))) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(x);
    size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

function groupOf(items: Item[], heading: string | null): { group: ComposeGroupIn; links: LinkPart[] } {
  const links: LinkPart[] = [];
  const units: ComposeUnit[] = items.map((x, i) => {
    let text = x.d.text;
    for (const l of x.d.links) {
      links.push(l);
      text = text.replace('\u0000', `⟦${links.length}⟧`);
    }
    return { id: `u${i + 1}`, kind: x.d.kind, text: text.replace(/\u0000/g, '') };
  });
  const linkTexts = links.map((l) => squash(l.text.replace(MARK_CHARS, '')).slice(0, 200));
  const id = `g${hashText(`${units.map((u) => `${u.kind}:${u.text}`).join('\n')}\n${linkTexts.join('\n')}`)}`;
  return { group: { id, heading: heading ? squash(heading).slice(0, 200) : null, units, linkTexts }, links };
}

export interface SegmentOptions {
  /** The section's own title (drawn above its body): the first group's heading. */
  heading: string | null;
  /** Group ids already used on this page: a repeat of the same content stays in the page's own words. */
  seen?: Set<string>;
}

/**
 * A section's body as the WebAble page draws it: groups (runs of paragraphs, lists and tables under one heading, at
 * most 10 units and 3,000 characters each, at least 30 words) and everything else as it is, in page order.
 */
export function segmentBlocks(blocks: Block[], o: SegmentOptions): Seg[] {
  const out: Seg[] = [];
  const seen = o.seen ?? new Set<string>();
  let heading = o.heading;
  let run: Item[] = [];
  const plain = (bs: Block[]): void => {
    if (!bs.length) return;
    const last = out[out.length - 1];
    if (last?.k === 'blocks') last.blocks.push(...bs);
    else out.push({ k: 'blocks', blocks: [...bs] });
  };
  const flush = (): void => {
    for (const part of splitRun(run)) {
      const words = part.reduce((a, x) => a + x.d.words, 0);
      const g = groupOf(part, heading);
      if (words < MIN_WORDS || seen.has(g.group.id)) {
        plain(part.map((x) => x.b));
        continue;
      }
      seen.add(g.group.id);
      out.push({ k: 'group', group: g.group, links: g.links, blocks: part.map((x) => x.b) });
    }
    run = [];
  };
  for (const b of blocks) {
    const d = unitOf(b);
    if (d) {
      run.push({ b, d });
      continue;
    }
    flush();
    if (b.b === 'heading') heading = b.text;
    plain([b]);
  }
  flush();
  return out;
}

/** The groups to ask for, in page order. */
export function groupsOf(segs: Seg[]): ComposeGroupIn[] {
  return segs.filter((s): s is GroupSeg => s.k === 'group').map((s) => s.group);
}
