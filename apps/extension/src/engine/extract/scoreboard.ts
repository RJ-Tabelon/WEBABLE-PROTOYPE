// Owner: X (round 7). Scoreboards: two sides, each with a team logo and/or name and a score, an "at"/"vs" joiner, and
// around them a label ("Last Matchup", "Final"), a date and a line-score table.

import type { ExtractedData } from '@webable/core';
import {
  cleanName, contains, descendants, genericLogoName, isControl, isDateText, isImage, isLabelText, isScoreText,
  joinerOf, lca, textLeaves, textOf,
} from './text';
import { readTable } from './table';
import type { ExtractItem, SNode } from './types';

type Board = Extract<ExtractedData, { kind: 'scoreboard' }>;
type Side = Board['sides'][number];

const LOGO_WORDS = /logo|crest|badge|team|seal|emblem|mark|mascot|school|club/i;

/** A picture that can be a team or org logo: square-ish, 20..220 px. */
export function isLogoish(n: SNode): boolean {
  if (!isImage(n)) return false;
  if (n.w < 20 || n.h < 20 || n.w > 240 || n.h > 240) return false;
  const ratio = n.w / Math.max(1, n.h);
  if (ratio < 0.4 || ratio > 2.6) return false;
  const words = `${n.cls} ${n.attrs?.alt ?? ''} ${n.attrs?.src ?? ''} ${n.attrs?.label ?? ''}`;
  return LOGO_WORDS.test(words) || (n.w <= 140 && n.h <= 140);
}

function inTable(n: SNode): boolean {
  for (let p = n.parent; p; p = p.parent) if (p.tag === 'table' || p.role === 'table' || p.role === 'grid') return true;
  return false;
}

/** Maximal score nodes under `root` (outside tables). */
function scoresIn(root: SNode): SNode[] {
  return descendants(root).filter((n) => {
    if (inTable(n) || isImage(n) || isControl(n)) return false;
    const t = textOf(n);
    if (!isScoreText(t)) return false;
    return !(n.parent && n.parent !== root && isScoreText(textOf(n.parent)) && textOf(n.parent) === t);
  });
}

function logosIn(root: SNode): SNode[] {
  return descendants(root).filter((n) => isLogoish(n) && !inTable(n));
}

/** Text outside tables, without form controls. */
function looseText(n: SNode): string {
  const parts: string[] = [];
  const walk = (x: SNode) => {
    if (x.tag === 'table') return;
    if (x.text) parts.push(x.text);
    for (const k of x.kids) walk(k);
  };
  walk(n);
  return parts.join(' ');
}

export interface ScoreboardOptions {
  excluded: (n: SNode) => boolean;
}

/** Every scoreboard on the page. */
export function findScoreboards(root: SNode, opt: ScoreboardOptions): ExtractItem[] {
  const logos = descendants(root).filter((n) => isLogoish(n) && !opt.excluded(n) && !inTable(n));
  if (logos.length < 2) return [];
  // Candidate boxes: the lowest common box of two logos on about one line.
  const cands = new Set<SNode>();
  let pairs = 0;
  for (let a = 0; a < logos.length && pairs < 400; a++) {
    for (let b = a + 1; b < logos.length && pairs < 400; b++) {
      const la = logos[a] as SNode;
      const lb = logos[b] as SNode;
      if (Math.abs(la.y + la.h / 2 - (lb.y + lb.h / 2)) > 90 || Math.abs(la.x - lb.x) > 900) continue;
      pairs++;
      const c = lca(la, lb);
      if (c && !opt.excluded(c)) cands.add(c);
    }
  }
  const boxes: Array<{ box: SNode; scores: SNode[]; logos: SNode[] }> = [];
  for (const c of cands) {
    const ls = logosIn(c);
    const ss = scoresIn(c);
    if (ls.length !== 2 || ss.length !== 2) continue;
    if (looseText(c).length > 180) continue;
    boxes.push({ box: c, scores: ss, logos: ls });
  }
  // Keep the lowest boxes.
  const lowest = boxes.filter((b) => !boxes.some((o) => o !== b && contains(b.box, o.box)));
  const out: ExtractItem[] = [];
  for (const b of lowest) {
    const item = buildBoard(b.box, b.scores, b.logos, opt);
    if (item) out.push(item);
  }
  return out;
}

function buildBoard(box: SNode, scores: SNode[], logos: SNode[], opt: ScoreboardOptions): ExtractItem | null {
  // Tokens in document order: text leaves and the two logos.
  const leaves = textLeaves(box, [], (x) => isImage(x));
  const tokens = [...leaves, ...logos].sort((a, b) => (a.i ?? 0) - (b.i ?? 0));
  const joinTok = tokens.find((t) => !isImage(t) && joinerOf(textOf(t)) !== null);
  const joiner = joinTok ? (joinerOf(textOf(joinTok)) as string) : undefined;
  let left: SNode[];
  let right: SNode[];
  if (joinTok) {
    left = tokens.filter((t) => (t.i ?? 0) < (joinTok.i ?? 0));
    right = tokens.filter((t) => (t.i ?? 0) > (joinTok.i ?? 0));
  } else {
    const mid = box.x + box.w / 2;
    left = tokens.filter((t) => t.x + t.w / 2 < mid);
    right = tokens.filter((t) => t.x + t.w / 2 >= mid);
  }
  const sideOf = (toks: SNode[]): (Side & { logoNode?: SNode }) | null => {
    const score = toks.find((t) => scores.includes(t) || (!isImage(t) && isScoreText(textOf(t))));
    if (!score) return null;
    const logo = toks.find((t) => isImage(t));
    const name = toks
      .filter((t) => t !== score && !isImage(t) && joinerOf(textOf(t)) === null && !isScoreText(textOf(t)))
      .map((t) => textOf(t))
      .join(' ');
    const s: Side & { logoNode?: SNode } = { name, score: textOf(score) };
    if (logo) {
      s.logoNode = logo;
      if (logo.attrs?.src) s.logoSrc = logo.attrs.src;
      const alt = logo.attrs?.alt ?? logo.attrs?.label ?? '';
      if (alt) s.logoAlt = alt;
    }
    return s;
  };
  const a = sideOf(left);
  const b = sideOf(right);
  if (!a || !b) return null;

  // Grow to the box that also holds the label, date and line score, and nothing else of substance.
  let rootN = box;
  for (let up = 0; up < 5 && rootN.parent; up++) {
    const p: SNode = rootN.parent;
    if (opt.excluded(p)) break;
    const extraScores = scoresIn(p).filter((s) => !contains(rootN, s));
    const extraLogos = logosIn(p).filter((l) => !contains(rootN, l));
    if (extraScores.length || extraLogos.length) break;
    const tables = descendants(p).filter((x) => x.tag === 'table' && !contains(rootN, x));
    if (tables.length > 1) break;
    if (tables[0] && (readTable(tables[0])?.rows.length ?? 99) > 4) break;
    const extraLeaves = textLeaves(p, [], (x) => x === rootN || x.tag === 'table' || isControl(x));
    if (extraLeaves.length > 6 || extraLeaves.some((l) => textOf(l).length > 60)) break;
    const controls = descendants(p).filter((x) => isControl(x) && !contains(rootN, x));
    if (controls.length > 4) break;
    if (p.h > 800 || p.w > 1100) break;
    rootN = p;
  }

  const board: Board = { kind: 'scoreboard', sides: [stripSide(a), stripSide(b)] };
  if (joiner) board.joiner = joiner;
  // Label and date: short texts in the root outside the box, the table and the controls.
  const around = textLeaves(rootN, [], (x) => x === box || x.tag === 'table' || isControl(x));
  const date = around.find((l) => isDateText(textOf(l)));
  if (date) board.date = textOf(date);
  const label = around.find((l) => l !== date && isLabelText(textOf(l)) && joinerOf(textOf(l)) === null);
  if (label) board.label = textOf(label);
  // Line score.
  const table = descendants(rootN).find((x) => x.tag === 'table');
  const read = table ? readTable(table) : null;
  if (read && read.rows.length >= 2 && read.rows.length <= 4) {
    const labels = read.columns.slice(1);
    const rows = read.rows.map((r) => ({ name: r[0] ?? '', values: r.slice(1) }));
    if (labels.length >= 1 && rows.every((r) => r.values.length === labels.length && r.name)) {
      board.periods = { labels, rows };
    }
  }
  // Names: the side's own text, else the line-score row with the same final, else the logo's alt text.
  board.sides.forEach((s, i) => {
    if (s.name) return;
    const rows = board.periods?.rows ?? [];
    const byFinal = rows.filter((r) => r.values[r.values.length - 1] === s.score);
    const row = byFinal.length === 1 ? byFinal[0] : rows[i];
    if (row?.name) s.name = row.name;
    else if (s.logoAlt && !genericLogoName(cleanName(s.logoAlt))) s.name = cleanName(s.logoAlt);
  });
  if (joiner === 'at') {
    (board.sides[0] as Side).side = 'away';
    (board.sides[1] as Side).side = 'home';
  }
  const sa = Number(board.sides[0]?.score);
  const sb = Number(board.sides[1]?.score);
  if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) {
    (board.sides[0] as Side).winner = sa > sb;
    (board.sides[1] as Side).winner = sb > sa;
  }
  return { node: rootN, data: board, logoNodes: [a.logoNode ?? null, b.logoNode ?? null] };
}

function stripSide(s: Side & { logoNode?: SNode }): Side {
  const { logoNode: _drop, ...rest } = s;
  return rest;
}
