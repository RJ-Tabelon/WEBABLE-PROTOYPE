// Visual self-check from before/after screenshots (Jev 1.14 images + Box, Danger Zone; research-jev §3.9, §4.3).
// Owner: A1. The hard DOM checks stay the authority; this is an extra, demo-grade check.
//
// Request format (hack/jev-docs/sec/images.md, verified live): a top-level `assets` map
// { <ref>: { type: 'image', format: 'png', data_base64 } }, the ref written as a whole string value in `state`,
// a fresh UUID ref per image, and the header `TypeSafe-Danger-Zone-Images: true` (JEV_IMAGES_HEADER) on the call.
import type { JevMetrics, VisualVerdict, VisualVerifyRequest } from '../types';
import { uiLabel } from '../redact';
import { boxOf, noulOf } from './api';
import type { JevImageAsset, JevQuestion, JevResponse } from './api';


export const VISUAL = Object.freeze({
  minSide: 280,
  maxSide: 1568,
  minPixels: 78_400,
  maxPixels: 2_458_624,
  rollbackClipped: 0.7,
  rollbackFaint: 0.7,
  rollbackKeeps: 0.3,
  maxListed: 16,
});

export const Q_CLIPPED = 'Is any text in `after` cut off inside the page, so that part of a word or line is hidden by its box or by another element? Text cut only by the top or bottom edge of the screenshot does not count.';
export const Q_FAINT = 'Is any text in `after` hard to read because it is too faint against its background?';

export class VisualInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisualInputError';
  }
}

function stripDataUrl(s: string): string {
  const t = String(s ?? '').trim();
  const i = t.indexOf('base64,');
  return (t.startsWith('data:') && i >= 0 ? t.slice(i + 7) : t).replace(/\s+/g, '');
}

function decodeHead(b64: string, bytes: number): Uint8Array {
  const chars = Math.ceil(bytes / 3) * 4;
  const bin = atob(b64.slice(0, chars));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Format and (for PNG) size of a base64 image; throws VisualInputError outside Jev's image limits. */
export function inspectImage(b64: string, name: string): { format: 'png' | 'jpg'; width: number | null; height: number | null } {
  if (!b64 || b64.length < 32) throw new VisualInputError(`${name}: no image data`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new VisualInputError(`${name}: not standard base64`);
  const head = decodeHead(b64, 24);
  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const jpg = head[0] === 0xff && head[1] === 0xd8;
  if (!png && !jpg) throw new VisualInputError(`${name}: not a PNG or JPEG`);
  if (!png) return { format: 'jpg', width: null, height: null };
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  if (width < VISUAL.minSide || height < VISUAL.minSide || width > VISUAL.maxSide || height > VISUAL.maxSide) {
    throw new VisualInputError(`${name}: ${width} x ${height} px is outside ${VISUAL.minSide}-${VISUAL.maxSide} px per side`);
  }
  const px = width * height;
  if (px < VISUAL.minPixels || px > VISUAL.maxPixels) throw new VisualInputError(`${name}: ${px} pixels is outside the limit`);
  return { format: 'png', width, height };
}

function freshRef(tag: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const id = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
  return `${tag}-${id}`;
}

function quotedList(labels: string[]): string {
  const xs = [...new Set(labels.map((l) => uiLabel(l, 8)).filter((l) => l.length > 0))].slice(0, VISUAL.maxListed);
  const q = xs.map((x) => `"${x.replace(/"/g, "'")}"`);
  if (q.length <= 1) return q.join('');
  return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
}

export function buildVisualCall(req: VisualVerifyRequest): {
  state: unknown; questions: Record<string, JevQuestion>; assets: Record<string, JevImageAsset>;
} {
  const before = stripDataUrl(req.before);
  const after = stripDataUrl(req.after);
  const fb = inspectImage(before, 'before');
  const fa = inspectImage(after, 'after');
  const refB = freshRef('before');
  const refA = freshRef('after');
  const assets: Record<string, JevImageAsset> = {
    [refB]: { type: 'image', format: fb.format, data_base64: before },
    [refA]: { type: 'image', format: fa.format, data_base64: after },
  };
  const questions: Record<string, JevQuestion> = {};
  const controls = quotedList(req.controls ?? []);
  if (controls) {
    questions.keeps_controls = { type: 'noul', instructions: `Does \`after\` still show every form control that \`before\` shows: ${controls}?` };
  }
  const help = quotedList(req.help ?? []);
  if (help) {
    questions.keeps_help = { type: 'noul', instructions: `Does \`after\` still show, readable and uncovered, the help links that \`before\` shows: ${help}?` };
  }
  questions.clipped = { type: 'noul', instructions: Q_CLIPPED };
  questions.faint = { type: 'noul', instructions: Q_FAINT };
  const main = req.mainLabel ? uiLabel(req.mainLabel, 8).replace(/"/g, "'") : '';
  if (main) {
    questions.main_visible = { type: 'noul', instructions: `Is the "${main}" button visible in \`after\`?` };
    questions.main_box = { type: 'box', instructions: `the "${main}" button in \`after\`` };
  }
  return { state: { before: refB, after: refA }, questions, assets };
}

/**
 * Roll back when clipped >= 0.70, faint >= 0.70, keeps_controls <= 0.30 or keeps_help <= 0.30 (research-jev §4.4).
 * A question that was not asked or not answered counts as passing: no Jev answer, no Jev-driven change.
 */
export function parseVisual(resp: JevResponse, metrics: JevMetrics): VisualVerdict {
  const keepsControls = noulOf(resp, 'keeps_controls') ?? 1;
  const keepsHelp = noulOf(resp, 'keeps_help') ?? 1;
  const clipped = noulOf(resp, 'clipped') ?? 0;
  const faint = noulOf(resp, 'faint') ?? 0;
  const mainVisible = noulOf(resp, 'main_visible');
  const box = boxOf(resp, 'main_box');
  const rollback =
    clipped >= VISUAL.rollbackClipped || faint >= VISUAL.rollbackFaint ||
    keepsControls <= VISUAL.rollbackKeeps || keepsHelp <= VISUAL.rollbackKeeps;
  return {
    keepsControls,
    keepsHelp,
    clipped,
    faint,
    mainVisible,
    mainBox: box && (mainVisible === null || mainVisible >= 0.5) ? box.box : null,
    rollback,
    metrics,
  };
}

/** Plain reasons for a rollback, for the ledger ("Reversed Calm view: some text was cut off (0.97)"). */
export function visualReasons(v: VisualVerdict): string[] {
  const out: string[] = [];
  if (v.clipped >= VISUAL.rollbackClipped) out.push(`some text was cut off (${v.clipped.toFixed(2)})`);
  if (v.faint >= VISUAL.rollbackFaint) out.push(`some text was too faint (${v.faint.toFixed(2)})`);
  if (v.keepsControls <= VISUAL.rollbackKeeps) out.push(`a form control went missing (${v.keepsControls.toFixed(2)})`);
  if (v.keepsHelp <= VISUAL.rollbackKeeps) out.push(`a help link was hidden (${v.keepsHelp.toFixed(2)})`);
  return out;
}
