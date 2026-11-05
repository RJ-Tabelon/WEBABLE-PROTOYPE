// POST /v1/verify-visual VisualVerifyRequest -> VisualVerdict
// Before/after screenshots go to Jev (images are experimental since 1.14: the Danger Zone header is sent on this
// route only). The hard DOM checks in the extension stay the authority; this is a second opinion.
import type { Hono } from 'hono';
import { buildVisualCall, parseVisual } from '@webable/core';
import type { VisualVerdict, VisualVerifyRequest } from '@webable/core';
import { askJev, jevMetrics } from '../jev';
import { sanitizeVisual } from '../sanitize';
import { VisualVerifySchema } from '../schemas';
import { imageFormatOf, jevImageProblem } from '../text';
import { HttpError, log } from '../util';
import { readBody } from './common';

const VISUAL_TIMEOUT_MS = 10_000; // two screenshots upload slower than a text call

/**
 * Jev's asset format is { type: 'image', format: 'png' | 'jpg', data_base64 }. Accept the media_type/data spelling
 * too, and take the format from the bytes themselves.
 */
export function normalizeAssets(assets: Record<string, unknown>): Record<string, { type: 'image'; format: 'png' | 'jpg'; data_base64: string }> {
  const out: Record<string, { type: 'image'; format: 'png' | 'jpg'; data_base64: string }> = {};
  for (const [ref, a] of Object.entries(assets)) {
    if (!a || typeof a !== 'object') continue;
    const o = a as Record<string, unknown>;
    const raw = typeof o.data_base64 === 'string' ? o.data_base64 : typeof o.data === 'string' ? o.data : null;
    if (!raw) continue;
    const data = raw.replace(/^data:image\/[a-z+]+;base64,/i, '');
    const format = imageFormatOf(data) ?? (o.format === 'jpg' || o.format === 'jpeg' || o.media_type === 'image/jpeg' ? 'jpg' : 'png');
    out[ref] = { type: 'image', format, data_base64: data };
  }
  return out;
}

export async function verifyVisual(input: VisualVerifyRequest): Promise<VisualVerdict> {
  for (const [name, img] of [['before', input.before], ['after', input.after]] as const) {
    const problem = jevImageProblem(img, name);
    if (problem) throw new HttpError(422, 'bad_image', problem);
  }
  const req = sanitizeVisual(input);
  const call = buildVisualCall(req);
  const assets = normalizeAssets(call.assets);
  if (Object.keys(assets).length === 0) throw new HttpError(500, 'no_assets', 'The visual check was built without images.');
  const r = await askJev({ state: call.state, questions: call.questions, assets }, { tag: 'visual', images: true, timeoutMs: VISUAL_TIMEOUT_MS });
  const verdict = parseVisual(r.body, jevMetrics([r]));
  log('visual', {
    rollback: verdict.rollback,
    controls: verdict.keepsControls,
    help: verdict.keepsHelp,
    clipped: verdict.clipped,
    faint: verdict.faint,
  });
  return verdict;
}

export function registerVisual(app: Hono): void {
  app.post('/v1/verify-visual', async (c) => {
    const req = await readBody(c, VisualVerifySchema);
    return c.json(await verifyVisual(req));
  });
}
