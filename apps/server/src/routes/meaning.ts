// Owner: J (round 7). POST /v1/meaning {req: MeaningCheckRequest} -> MeaningVerdict
// The meaning check before Calm view: Jev compares a structure-only summary of the Calm plan with the original page
// (core jev/meaning.ts builds the question and reads the answers). Only fine roles, the page purpose and a short
// allowlisted region description get through: unknown roles are dropped, the description loses every word outside
// the interface vocabulary and every digit. Fails closed: Jev errors map to 5xx and the extension then offers no Calm
// view on that page.
import type { Hono } from 'hono';
import { z } from 'zod';
import { buildMeaningCall, parseMeaning, sanitizeMeaningRequest } from '@webable/core';
import type { MeaningCheckRequest, MeaningVerdict } from '@webable/core';
import { askJev, jevMetrics } from '../jev';
import { HttpError, errorMessage, log, round } from '../util';
import { readBody, wantsFresh } from './common';

const roleList = z.array(z.string().max(40)).max(64);

export const MeaningBody = z.object({
  req: z.object({
    purpose: z.string().max(40).nullable(),
    original: z.object({ mainRegion: z.string().max(200), leadRoles: roleList, mustKeep: roleList }),
    calm: z.object({ leadRoles: roleList, shownRoles: roleList, foldedRoles: roleList }),
  }),
});

export async function meaning(input: MeaningCheckRequest, opts: { fresh?: boolean } = {}): Promise<MeaningVerdict> {
  const req = sanitizeMeaningRequest(input);
  let call: ReturnType<typeof buildMeaningCall>;
  try {
    call = buildMeaningCall(req);
  } catch (e) {
    throw new HttpError(422, 'no_evidence', `Nothing to compare: ${errorMessage(e).slice(0, 80)}`);
  }
  const r = await askJev({ state: call.state, questions: call.questions }, { tag: 'meaning', fresh: opts.fresh });
  let verdict: MeaningVerdict;
  try {
    verdict = parseMeaning(r.body, jevMetrics([r]));
  } catch (e) {
    log('meaning: answer parser failed', { error: errorMessage(e).slice(0, 120) });
    throw new HttpError(502, 'meaning_unavailable', 'Jev did not answer the meaning check.');
  }
  log('meaning', {
    purpose: req.purpose ?? 'unknown',
    leads: round(verdict.leadsWithMain, 2),
    missing: round(verdict.missingMain, 2),
    pass: verdict.pass,
    cached: r.cached || undefined,
  });
  // Structure only (fine roles, the purpose and an allowlisted description), for tuning: WEBABLE_LOG_MEANING=1.
  if (process.env.WEBABLE_LOG_MEANING === '1') log('meaning request', { req: JSON.stringify(req).slice(0, 1200) });
  return verdict;
}

export function registerMeaning(app: Hono): void {
  app.post('/v1/meaning', async (c) => {
    const { req } = await readBody(c, MeaningBody);
    return c.json(await meaning(req as MeaningCheckRequest, { fresh: wantsFresh(c) }));
  });
}
