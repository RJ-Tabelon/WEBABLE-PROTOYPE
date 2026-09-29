import {
  DIM_IDS,
  type DimId,
  OP_CATALOG,
  OP_IDS,
  type OpId,
} from '@webable/core';
import { z } from 'zod';

import { NBSP } from '../format';

/**
 * "What WebAble has learned" from the synced learning state (domain-free:
 * per-op keep/undo counts and per-dimension settled values). Only facts with
 * enough evidence are shown, in plain sentences about changes, never about the
 * person. Pure; tolerant of partial or older state shapes.
 */

export interface LearnedOp {
  op: OpId;
  label: string;
  sentence: string;
}

export interface LearnedDim {
  dim: DimId;
  label: string;
  /** What Tune measured, formatted ("18 px"). */
  from: string;
  /** Where it has settled, formatted ("21 px"). */
  to: string;
  srText: string;
}

export interface LearnedSummary {
  ops: LearnedOp[];
  dims: LearnedDim[];
}

/** Evidence needed (decayed keeps plus undos) before a keep/undo pattern is shown. */
export const MIN_EVIDENCE = 3;
/** A settled value must differ from Tune's by at least this much in log space (~6%). */
export const MIN_LOG_SHIFT = 0.06;
const HALF_LIFE_DAYS = 90;

const countsSchema = z.object({ s: z.number(), f: z.number(), t: z.number() });
const opSchema = z.object({
  c: countsSchema,
  src: z.enum(['profile', 'pinned', 'system', 'none']).optional(),
  blocked: z.literal(true).optional(),
});
const dimSchema = z.object({ m: z.number(), v: z.number(), mCal: z.number() });
const stateSchema = z.object({
  ops: z.record(z.string(), z.unknown()).optional(),
  dims: z.record(z.string(), z.unknown()).optional(),
});

function decayed(c: z.infer<typeof countsSchema>, today: number) {
  const dt = Math.max(0, today - c.t);
  const g = Math.pow(2, -dt / HALF_LIFE_DAYS);
  return { s: Math.max(0, c.s) * g, f: Math.max(0, c.f) * g };
}

function isOpId(value: string): value is OpId {
  return (OP_IDS as readonly string[]).includes(value);
}

function isDimId(value: string): value is DimId {
  return (DIM_IDS as readonly string[]).includes(value);
}

/** How each dimension is shown ("18 px") and spoken as a range ("18 to 21 pixels"). */
interface DimFormat {
  label: string;
  show: (v: number) => string;
  say: (from: number, to: number) => string;
}

const round = (v: number) => Math.round(v);
const tenth = (v: number) => Math.round(v * 10) / 10;
const percent = (v: number) => Math.round(v * 100);
const softer = (v: number) => Math.round((1 - v) * 100);

const DIM_FORMAT: Readonly<Record<DimId, DimFormat>> = {
  textPx: {
    label: 'Text size',
    show: (v) => `${round(v)}${NBSP}px`,
    say: (a, b) => `${round(a)} to ${round(b)} pixels`,
  },
  zoom: {
    label: 'Page zoom',
    show: (v) => `${percent(v)}%`,
    say: (a, b) => `${percent(a)} to ${percent(b)} percent`,
  },
  lineHeight: {
    label: 'Line spacing',
    show: (v) => String(tenth(v)),
    say: (a, b) => `line spacing ${tenth(a)} to ${tenth(b)}`,
  },
  lineCh: {
    label: 'Line length',
    show: (v) => `${round(v)}${NBSP}characters`,
    say: (a, b) => `${round(a)} to ${round(b)} characters`,
  },
  targetPx: {
    label: 'Click targets',
    show: (v) => `${round(v)}${NBSP}px`,
    say: (a, b) => `${round(a)} to ${round(b)} pixels`,
  },
  clickWindowMs: {
    label: 'Steady clicks',
    show: (v) => `${round(v)}${NBSP}ms`,
    say: (a, b) => `${round(a)} to ${round(b)} milliseconds`,
  },
  dimOpacity: {
    label: 'Busy areas',
    show: (v) => `${softer(v)}% softer`,
    say: (a, b) => `${softer(a)} to ${softer(b)} percent softer`,
  },
};

function opSentence(
  op: z.infer<typeof opSchema>,
  today: number,
): string | null {
  if (op.blocked) return 'You turned this off everywhere.';
  if (op.src === 'pinned') return 'You asked for this on every site.';
  const { s, f } = decayed(op.c, today);
  if (s + f < MIN_EVIDENCE) return null;
  const kept = s / (s + f);
  if (kept >= 0.7) return 'You usually keep this change.';
  if (kept <= 0.3) return 'You usually undo this change.';
  return 'You keep this change about as often as you undo it.';
}

/** Summarize a learning_state.state document. `today` is days since the epoch. */
export function learnedSummary(state: unknown, today: number): LearnedSummary {
  const parsed = stateSchema.safeParse(state);
  if (!parsed.success) return { ops: [], dims: [] };

  const ops: LearnedOp[] = [];
  for (const id of OP_IDS) {
    const raw = parsed.data.ops?.[id];
    if (raw === undefined) continue;
    const op = opSchema.safeParse(raw);
    if (!op.success) continue;
    const sentence = opSentence(op.data, today);
    if (sentence) ops.push({ op: id, label: OP_CATALOG[id].label, sentence });
  }

  const dims: LearnedDim[] = [];
  for (const [id, raw] of Object.entries(parsed.data.dims ?? {})) {
    if (!isDimId(id)) continue;
    const dim = dimSchema.safeParse(raw);
    if (!dim.success) continue;
    if (!Number.isFinite(dim.data.m) || !Number.isFinite(dim.data.mCal))
      continue;
    if (Math.abs(dim.data.m - dim.data.mCal) < MIN_LOG_SHIFT) continue;
    const format = DIM_FORMAT[id];
    const from = Math.exp(dim.data.mCal);
    const to = Math.exp(dim.data.m);
    const shownFrom = format.show(from);
    const shownTo = format.show(to);
    if (shownFrom === shownTo) continue;
    dims.push({
      dim: id,
      label: format.label,
      from: shownFrom,
      to: shownTo,
      srText: format.say(from, to),
    });
  }
  dims.sort((a, b) => DIM_IDS.indexOf(a.dim) - DIM_IDS.indexOf(b.dim));
  return { ops, dims };
}

/** One row of "What WebAble has learned": a settled value and/or a keep-or-undo pattern. */
export interface LearnedRow {
  key: string;
  label: string;
  dim?: LearnedDim;
  sentence?: string;
}

/**
 * Rows for the page, one per label: a dimension and the op with the same label
 * ("Text size") share a row. Dimensions first, then the remaining ops, each in
 * catalog order.
 */
export function learnedRows(summary: LearnedSummary): LearnedRow[] {
  const rows: LearnedRow[] = summary.dims.map((dim) => ({
    key: `dim-${dim.dim}`,
    label: dim.label,
    dim,
  }));
  for (const op of summary.ops) {
    const shared = rows.find(
      (row) => row.label === op.label && row.sentence === undefined,
    );
    if (shared) shared.sentence = op.sentence;
    else
      rows.push({ key: `op-${op.op}`, label: op.label, sentence: op.sentence });
  }
  return rows;
}

/** Days since the epoch for a date (the learners' clock). */
export function dayOf(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

export { isOpId as isKnownOp };
