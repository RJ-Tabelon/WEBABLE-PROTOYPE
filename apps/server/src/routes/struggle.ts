// POST /v1/struggle {signals} -> StruggleJudgment
// One Noul per kind of difficulty over baseline-relative bands; thresholds and offers are decided in code.
import type { Hono } from 'hono';
import { buildStruggleCall, parseStruggle } from '@webable/core';
import type { StruggleJudgment, StruggleSignals } from '@webable/core';
import { askJev, jevMetrics } from '../jev';
import { sanitizeSignals } from '../sanitize';
import { StruggleBody } from '../schemas';
import { log } from '../util';
import { readBody, wantsFresh } from './common';

export async function judgeStruggle(input: StruggleSignals, opts: { fresh?: boolean } = {}): Promise<StruggleJudgment> {
  const { signals, dropped } = sanitizeSignals(input);
  if (dropped) log('struggle: dropped signal values that looked personal', { count: dropped });
  const call = buildStruggleCall(signals);
  const r = await askJev({ state: call.state, questions: call.questions }, { tag: 'struggle', fresh: opts.fresh });
  return parseStruggle(r.body, jevMetrics([r]));
}

export function registerStruggle(app: Hono): void {
  app.post('/v1/struggle', async (c) => {
    const { signals } = await readBody(c, StruggleBody);
    return c.json(await judgeStruggle(signals, { fresh: wantsFresh(c) }));
  });
}
