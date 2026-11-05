// Owner: X (round 7). Data tables (<table> with a header, or ARIA grids) and schedules (date + opponent + result rows).

import type { ExtractedData } from '@webable/core';
import { collapse, descendants, hasDate, isControl, isDateText, isHeading, isNumericCell, isValueText, textLeaves, textOf } from './text';
import type { SNode } from './types';

export interface TableRead {
  caption?: string;
  columns: string[];
  rows: string[][];
  numericCols: number[];
  /** The body rows' elements, in order (for schedule items' node ids). */
  rowNodes: SNode[];
}

const MAX_ROWS = 300;
const MAX_CELL = 200;

function isTable(n: SNode): boolean {
  return n.tag === 'table' || n.role === 'table' || n.role === 'grid' || n.role === 'treegrid';
}

function isRow(n: SNode): boolean {
  return n.tag === 'tr' || n.role === 'row';
}

function isCell(n: SNode): boolean {
  return n.tag === 'td' || n.tag === 'th' || n.role === 'cell' || n.role === 'gridcell' || n.role === 'columnheader' || n.role === 'rowheader';
}

function isHeaderCell(n: SNode): boolean {
  return n.tag === 'th' || n.role === 'columnheader';
}

interface RawRow {
  node: SNode;
  cells: SNode[];
  head: boolean;
}

/** Rows of a table (not of tables nested inside it); null when a table is nested (a layout table). */
function rowsOf(t: SNode): RawRow[] | null {
  const out: RawRow[] = [];
  let nested = false;
  const walk = (n: SNode, head: boolean) => {
    for (const k of n.kids) {
      if (isTable(k)) {
        nested = true;
        continue;
      }
      if (isRow(k)) {
        const cells: SNode[] = [];
        const findCells = (x: SNode, depth: number) => {
          for (const c of x.kids) {
            if (isCell(c)) cells.push(c);
            else if (depth < 3 && !isTable(c)) findCells(c, depth + 1);
          }
        };
        findCells(k, 0);
        out.push({ node: k, cells, head: head || (k.parent?.tag === 'thead') });
        continue;
      }
      walk(k, head || k.tag === 'thead' || (k.role === 'rowgroup' && k.tag === 'thead'));
    }
  };
  walk(t, false);
  if (!nested) nested = out.some((r) => r.cells.some((c) => descendants(c).some((d) => d !== c && isTable(d))));
  return nested ? null : out;
}

function cellText(c: SNode): string {
  return collapse(textOf(c)).slice(0, MAX_CELL);
}

/** Read one table; null for layout tables and tables too small to be data. */
export function readTable(t: SNode): TableRead | null {
  if (!isTable(t) || t.role === 'presentation' || t.role === 'none') return null;
  const raw = rowsOf(t);
  if (!raw || raw.length < 2) return null;
  // Header: the last thead row, else a first row made of header cells.
  let headIdx = -1;
  raw.forEach((r, i) => {
    if (r.head) headIdx = i;
  });
  if (headIdx < 0 && raw[0] && raw[0].cells.length >= 2 && raw[0].cells.every(isHeaderCell)) headIdx = 0;
  const header = headIdx >= 0 ? raw[headIdx] : undefined;
  const body = raw.filter((r, i) => i !== headIdx && !r.head && r.cells.length > 0);
  const expand = (r: RawRow) => {
    const out: string[] = [];
    for (const c of r.cells) {
      const span = Math.min(12, Math.max(1, c.attrs?.colspan ?? 1));
      out.push(cellText(c));
      for (let s = 1; s < span; s++) out.push('');
    }
    return out;
  };
  let columns = header ? expand(header) : [];
  let rows = body.map(expand).filter((r) => r.some(Boolean)).slice(0, MAX_ROWS);
  const rowNodes = body.filter((r) => expand(r).some(Boolean)).slice(0, MAX_ROWS).map((r) => r.node);
  if (rows.length < 2) return null;
  const ncols = Math.max(columns.length, ...rows.map((r) => r.length));
  if (ncols < 2) return null;
  // A table whose cells hold paragraphs or forms is layout.
  if (descendants(t).some((x) => x.tag === 'form' || x.tag === 'fieldset')) return null;
  columns = pad(columns, ncols);
  rows = rows.map((r) => pad(r, ncols));
  // Drop columns that say nothing: empty everywhere, or one control label repeated ("Links", "Details").
  const keep: number[] = [];
  for (let c = 0; c < ncols; c++) {
    const vals = rows.map((r) => r[c] ?? '');
    const empty = vals.every((v) => !v) && !columns[c];
    const filled = vals.filter(Boolean);
    const same = filled.length > 0 && filled.every((v) => v === filled[0]);
    const controlsOnly = body.every((r) => {
      const cell = cellAt(r, c);
      return !cell || !textOf(cell) || descendants(cell).some((x) => isControl(x) && textOf(x) === textOf(cell));
    });
    if (empty || (same && controlsOnly && rows.length >= 3)) continue;
    keep.push(c);
  }
  if (keep.length < 2) return null;
  columns = keep.map((c) => columns[c] ?? '');
  rows = rows.map((r) => keep.map((c) => r[c] ?? ''));
  const numericCols: number[] = [];
  columns.forEach((_c, i) => {
    const vals = rows.map((r) => r[i] ?? '').filter(Boolean);
    if (vals.length && vals.filter(isNumericCell).length / vals.length >= 0.7) numericCols.push(i);
  });
  const out: TableRead = { columns, rows, numericCols, rowNodes };
  const caption = captionOf(t);
  if (caption) out.caption = caption;
  return out;
}

function cellAt(r: RawRow, col: number): SNode | undefined {
  let at = 0;
  for (const c of r.cells) {
    const span = Math.max(1, c.attrs?.colspan ?? 1);
    if (col >= at && col < at + span) return c;
    at += span;
  }
  return undefined;
}

function pad(r: string[], n: number): string[] {
  const out = r.slice(0, n);
  while (out.length < n) out.push('');
  return out;
}

/** The table's caption, aria-label, or the short title just before it ("History from 1917 - 2025"). */
export function captionOf(t: SNode): string | undefined {
  const cap = t.kids.find((k) => k.tag === 'caption');
  if (cap && textOf(cap)) return textOf(cap).slice(0, 160);
  if (t.attrs?.label) return collapse(t.attrs.label).slice(0, 160);
  let a: SNode | null | undefined = t;
  for (let up = 0; a && a.parent && up < 4; up++, a = a.parent) {
    const sibs = a.parent.kids;
    const idx = sibs.indexOf(a);
    for (let s = idx - 1; s >= 0; s--) {
      const sib = sibs[s] as SNode;
      const tx = textOf(sib);
      if (!tx) continue;
      if (tx.length <= 140 && !isValueText(tx) && (isHeading(sib) || sib.fw >= 600 || tx.split(' ').length <= 16)) return tx;
      return undefined;
    }
    if (textOf(a.parent).length > textOf(a).length + 160) return undefined;
  }
  return undefined;
}

/** Table data for the page, or a schedule when the table lists games or events against named opponents. */
export function tableItem(read: TableRead): ExtractedData {
  const sched = scheduleFromTable(read);
  if (sched) return sched;
  const data: ExtractedData = { kind: 'table', columns: read.columns, rows: read.rows };
  if (read.numericCols.length) data.numericCols = read.numericCols;
  if (read.caption) data.caption = read.caption;
  return data;
}

const OPPONENT_COL = /^(opponent|opponents|matchup|game|event|vs\.?|versus|team|teams|match|fixture)$/i;
const DATE_COL = /^(date|day|when|game date)$/i;
const RESULT_COL = /^(result|results|score|final|w\/l|outcome|time|tv)$/i;

/** Schedule rows from a table with a date column and an opponent or event column. */
export function scheduleFromTable(read: TableRead): ExtractedData | null {
  const cols = read.columns.map((c) => collapse(c));
  const opp = cols.findIndex((c) => OPPONENT_COL.test(c));
  let date = cols.findIndex((c) => DATE_COL.test(c));
  if (date < 0) date = cols.findIndex((_c, i) => mostly(read.rows.map((r) => r[i] ?? ''), (v) => isDateText(v) || hasDate(v)));
  if (opp < 0 || date < 0 || opp === date) return null;
  const res = cols.findIndex((c, i) => i !== opp && i !== date && RESULT_COL.test(c));
  const others = cols.map((_c, i) => i).filter((i) => i !== opp && i !== date && i !== res);
  const items = read.rows.slice(0, 120).map((r) => {
    const item: { date: string; title: string; detail?: string; result?: string } = { date: r[date] ?? '', title: r[opp] ?? '' };
    const detail = others.map((i) => r[i] ?? '').filter(Boolean).join(' · ');
    if (detail) item.detail = detail;
    if (res >= 0 && r[res]) item.result = r[res];
    return item;
  }).filter((x) => x.title || x.date);
  if (items.length < 2) return null;
  const data: ExtractedData = { kind: 'schedule', items };
  if (read.caption) data.title = read.caption;
  return data;
}

function mostly(vals: string[], pred: (v: string) => boolean): boolean {
  const xs = vals.filter(Boolean);
  return xs.length >= 2 && xs.filter(pred).length / xs.length >= 0.7;
}

/* ------------------------------------------------------------------ */
/* Schedules made of cards (not tables)                                */
/* ------------------------------------------------------------------ */

const RESULT_TEXT = /^(?:[WLT]\s?\d{1,3}\s?[-–]\s?\d{1,3}|final(?:\/ot)?|postponed|canceled|cancelled|tba|tbd|\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)(?:\s?[a-z]{2,4})?)$/i;
const OPP_TEXT = /^(?:vs\.?|at|@)\s+\S/i;

/**
 * Repeated sibling cards each with a date and an opponent ("vs South Carolina", "at #7 Texas") or a result. News teasers
 * (a date and a headline) do not count: they have neither.
 */
export function findScheduleCards(root: SNode, excluded: (n: SNode) => boolean): Array<{ node: SNode; data: ExtractedData; rows: SNode[] }> {
  const out: Array<{ node: SNode; data: ExtractedData; rows: SNode[] }> = [];
  const used = new Set<SNode>();
  for (const parent of descendants(root)) {
    if (excluded(parent) || parent.kids.length < 3 || used.has(parent)) continue;
    if ([...used].some((u) => isInside(parent, u))) continue;
    const items: Array<{ date: string; title: string; detail?: string; result?: string }> = [];
    const rows: SNode[] = [];
    for (const k of parent.kids) {
      const leaves = leavesOf(k);
      const date = leaves.find((t) => isDateText(t) || (hasDate(t) && t.length <= 40));
      const opp = leaves.find((t) => OPP_TEXT.test(t));
      const result = leaves.find((t) => RESULT_TEXT.test(t));
      if (!date || !opp) continue;
      const item: { date: string; title: string; detail?: string; result?: string } = { date, title: opp };
      if (result) item.result = result;
      items.push(item);
      rows.push(k);
    }
    if (items.length >= 3 && items.length >= 0.6 * parent.kids.length) {
      out.push({ node: parent, data: { kind: 'schedule', items }, rows });
      used.add(parent);
    }
  }
  return out;
}

function isInside(n: SNode, outer: SNode): boolean {
  for (let p: SNode | null | undefined = n; p; p = p.parent) if (p === outer) return true;
  return false;
}

function leavesOf(n: SNode): string[] {
  return textLeaves(n).map(textOf).filter((t) => t.length <= 80);
}
