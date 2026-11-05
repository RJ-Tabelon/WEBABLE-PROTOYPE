// POST /v1/overlay-close {overlay, candidates} -> OverlayCloseResult
// Jev picks an overlay's own minimise/close control (core jev/overlay.ts builds the questions and applies the gate
// and the code vetoes). The server re-redacts every label, asks about at most 8 buttons, and never asks about a
// consent notice: WebAble never answers one for the person.
import type { Hono } from 'hono';
import { buildOverlayCloseCall, parseOverlayClose } from '@webable/core';
import type { OverlayButtonEvidence, OverlayCloseResult, OverlayEvidence } from '@webable/core';
import { askJev, emptyJevMetrics, jevMetrics } from '../jev';
import { sanitizeOverlay, sanitizeOverlayButton } from '../sanitize';
import { OverlayCloseBody } from '../schemas';
import { HttpError, errorMessage, log, round } from '../util';
import { readBody, wantsFresh } from './common';

/** Jev reads at most this many buttons per overlay (the measured design). */
export const OVERLAY_MAX_CANDIDATES = 8;

/** OverlayCloseResult plus, when no question was asked, the reason (consent, no buttons). */
export type OverlayCloseResponse = OverlayCloseResult & { skipped?: 'consent' | 'no_candidates' | 'no_questions' };

function noPick(skipped: NonNullable<OverlayCloseResponse['skipped']>): OverlayCloseResponse {
  return { pick: 'none', pFwd: 0, pRev: 0, sideEffect: 1, accept: false, metrics: emptyJevMetrics(), skipped };
}

export async function overlayClose(
  input: { overlay: OverlayEvidence; candidates: OverlayButtonEvidence[] },
  opts: { fresh?: boolean } = {},
): Promise<OverlayCloseResponse> {
  const overlay = sanitizeOverlay(input.overlay);
  if (overlay.kind_hint === 'consent') return noPick('consent');
  const seen = new Set<string>();
  const unique = input.candidates.filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
  const candidates = unique.slice(0, OVERLAY_MAX_CANDIDATES).map(sanitizeOverlayButton);
  if (!candidates.length) return noPick('no_candidates');

  let call: ReturnType<typeof buildOverlayCloseCall>;
  try {
    call = buildOverlayCloseCall(overlay, candidates);
  } catch (e) {
    log('overlay-close: question builder failed', { error: errorMessage(e).slice(0, 120) });
    throw new HttpError(503, 'overlay_unavailable', 'The overlay check is not available right now. Nothing on the page was pressed.');
  }
  if (!call || Object.keys(call.questions).length === 0) return noPick('no_questions');

  const r = await askJev({ state: call.state, questions: call.questions }, { tag: 'overlay', fresh: opts.fresh });
  let result: OverlayCloseResult;
  try {
    result = parseOverlayClose(r.body, overlay, candidates, jevMetrics([r]));
  } catch (e) {
    log('overlay-close: answer parser failed', { error: errorMessage(e).slice(0, 120) });
    throw new HttpError(503, 'overlay_unavailable', 'The overlay check is not available right now. Nothing on the page was pressed.');
  }
  log('overlay-close', {
    kind: overlay.kind_hint,
    buttons: candidates.length,
    pick: result.pick,
    fwd: round(result.pFwd, 2),
    rev: round(result.pRev, 2),
    side: round(result.sideEffect, 2),
    accept: result.accept,
    cached: r.cached || undefined,
  });
  return result;
}

export function registerOverlay(app: Hono): void {
  app.post('/v1/overlay-close', async (c) => {
    const body = await readBody(c, OverlayCloseBody);
    return c.json(await overlayClose(body, { fresh: wantsFresh(c) }));
  });
}
