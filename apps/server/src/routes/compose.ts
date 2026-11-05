// POST /v1/compose {req: ComposeRequest} -> ComposeResponse
// Round 10: the WebAble page as components. Per group, in parallel: COMPOSE_MODEL proposes blocks (data only) ->
// tidyBlocks -> validateBlocks and the code checks (coverage, numbers kept and none new, links, quotes, conditions);
// a failed group is laid out once more with the failure named when its first try came back within
// COMPOSE_RETRY_BEFORE_MS. Then ONE Jev call checks every group that passed: better (easier for this reader?),
// dropped and added. ok only when every check passes and better reaches COMPOSE_CHECK.betterMin. The model keeping
// the page's text, or prose that barely changes it, is ok:false 'plain_is_better'. Answers are cached by
// (catalog version, reader brief, leaning, group). No model or no Jev: every group ok:false with the reason (fail
// closed); one bad group never fails the others.
// Bold: a unit's **…** is words the page shows in bold. The planner is told to keep ** on those same words and add it
// nowhere else; tidyBlocks drops any other **, and the code checks and Jev read every text without it.
import type { Hono } from 'hono';
import {
  COMPOSE_CATALOG_VERSION, COMPOSE_LIMITS, COMPOSE_MODEL, buildComposeCheckCall, composeBrief, composeChecks,
  composeLeaning, composeLinkWords, flatten, groupText, parseComposeCheck, tidyBlocks, verdictFailure,
} from '@webable/core';
import type { ComposeBlock, ComposeCodeChecks, ComposeGroupIn, ComposeRequest, ComposeResponse, ComposeResult, ComposeVerdict, JevMetrics } from '@webable/core';
import { aiState } from '../ai';
import { jevKey } from '../config';
import { JevError, askJev, emptyJevMetrics, jevMetrics } from '../jev';
import { TtlLru } from '../lru';
import { composeGroup } from '../openai';
import { ComposeBody } from '../schemas';
import { hashOf, log, round } from '../util';
import { readBody, wantsFresh } from './common';

type Result = Omit<ComposeResult, 'id'>;

const cache = new TtlLru<Result>(500, 60 * 60_000);

/** A group that failed a code check is laid out again only when its first try came back within this. */
export const COMPOSE_RETRY_BEFORE_MS = 2_000;

const NO_CHECKS: ComposeResult['checks'] = {
  covered: false, numbersKept: false, noNewNumbers: false, linksKept: false, quotesKept: false, dropped: 1, added: 1,
};

function failed(reason: string, blocks: ComposeBlock[] | null = null, checks?: ComposeCodeChecks | null, better: number | null = null): Result {
  return {
    ok: false,
    blocks,
    better,
    checks: checks
      ? { covered: checks.covered, numbersKept: checks.numbersKept, noNewNumbers: checks.noNewNumbers, linksKept: checks.linksKept, quotesKept: checks.quotesKept, dropped: 1, added: 1 }
      : NO_CHECKS,
    reason,
  };
}

/** The group is over the contract's size (10 units, 3,000 characters). */
export function oversize(group: ComposeGroupIn): boolean {
  return group.units.length > COMPOSE_LIMITS.maxUnits || group.units.reduce((n, u) => n + u.text.length, 0) > COMPOSE_LIMITS.maxChars;
}

interface Draft {
  group: ComposeGroupIn;
  blocks: ComposeBlock[] | null;
  checks: ComposeCodeChecks | null;
  /** The model chose the page's own text. */
  plain?: boolean;
  llmError?: string;
  tries: number;
  ms: number;
}

async function draft(brief: string, leaning: string, req: ComposeRequest, group: ComposeGroupIn, t0: number): Promise<Draft> {
  let last: Draft | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await composeGroup(brief, leaning, req.reader?.level ?? 'everyday', req.page, group, last?.checks?.note ?? undefined);
    const ms = round(performance.now() - t0);
    if (!r.ok) return last ?? { group, blocks: null, checks: null, llmError: r.error, tries: attempt + 1, ms };
    if (r.data.keep_page_text && r.data.blocks.length === 0) return { group, blocks: null, checks: null, plain: true, tries: attempt + 1, ms };
    const blocks = tidyBlocks(group, r.data.blocks);
    const checks = composeChecks(group, blocks);
    last = { group, blocks, checks, tries: attempt + 1, ms };
    if (!checks.failure || checks.failure === 'plain_is_better') return last;
    if (performance.now() - t0 > COMPOSE_RETRY_BEFORE_MS) return last;
    log('compose retry', { failure: checks.failure });
  }
  return last!;
}

export async function compose(req: ComposeRequest, opts: { fresh?: boolean } = {}): Promise<ComposeResponse> {
  const t0 = performance.now();
  const seen = new Set<string>();
  const groups = req.groups.filter((g) => !seen.has(g.id) && seen.add(g.id)).slice(0, 4);
  const done = (results: ComposeResult[], jev: JevMetrics = emptyJevMetrics()): ComposeResponse => ({
    results, model: COMPOSE_MODEL, ms: round(performance.now() - t0), jev,
  });
  if (!groups.length) return done([]);
  const ai = aiState();
  if (ai.status !== 'on') return done(groups.map((g) => ({ id: g.id, ...failed('llm_unavailable') })));
  if (!jevKey()) return done(groups.map((g) => ({ id: g.id, ...failed('check_unavailable') })));

  const brief = composeBrief(req.reader);
  const leaning = composeLeaning(req.reader);
  const keyOf = (g: ComposeGroupIn) => hashOf(COMPOSE_CATALOG_VERSION, brief, leaning, req.page.purpose ?? '', g.heading ?? '', g.units, g.linkTexts);
  const byId = new Map<string, Result>();
  const todo: ComposeGroupIn[] = [];
  for (const g of groups) {
    if (oversize(g)) {
      byId.set(g.id, failed('invalid'));
      continue;
    }
    const hit = opts.fresh ? undefined : cache.get(keyOf(g));
    if (hit) byId.set(g.id, hit);
    else todo.push(g);
  }

  const drafts = await Promise.all(todo.map((g) => draft(brief, leaning, req, g, t0)));
  const toCheck = drafts.filter((d) => d.blocks && d.checks && !d.checks.failure);
  let jev = emptyJevMetrics();
  let verdicts: Record<string, ComposeVerdict> | null = null;
  if (toCheck.length) {
    try {
      const call = buildComposeCheckCall(
        brief,
        req.page,
        toCheck.map((d) => ({ id: d.group.id, heading: d.group.heading, source: groupText(d.group), layout: flatten(d.blocks!), links: composeLinkWords(d.group) })),
      );
      const r = await askJev(call, { tag: 'compose-check', fresh: opts.fresh });
      jev = jevMetrics([r]);
      verdicts = parseComposeCheck(toCheck.map((d) => d.group.id), r.body);
    } catch (e) {
      log("compose: layouts could not be checked; showing the page's own words", { kind: e instanceof JevError ? e.kind : 'error' });
    }
  }

  for (const d of drafts) {
    let res: Result;
    if (d.plain) res = failed('plain_is_better');
    else if (!d.blocks || !d.checks) res = failed('llm_unavailable');
    else if (d.checks.failure) res = failed(d.checks.failure, d.blocks, d.checks);
    else if (!verdicts) res = failed('check_unavailable', d.blocks, d.checks);
    else {
      const v = verdicts[d.group.id] ?? { better: 0, dropped: 1, added: 1 };
      const reason = verdictFailure(v);
      res = {
        ok: !reason,
        blocks: d.blocks,
        better: round(v.better, 3),
        checks: {
          covered: true, numbersKept: true, noNewNumbers: true, linksKept: true, quotesKept: true,
          dropped: round(v.dropped, 3), added: round(v.added, 3),
        },
        ...(reason ? { reason } : {}),
      };
    }
    // Checked answers are kept (a failed check too: the same group would fail the same way); outages are not.
    if (res.reason !== 'llm_unavailable' && res.reason !== 'check_unavailable') cache.set(keyOf(d.group), res);
    byId.set(d.group.id, res);
  }

  const results = groups.map((g) => ({ id: g.id, ...(byId.get(g.id) ?? failed('llm_unavailable')) }));
  const out = done(results, jev);
  log('compose', {
    groups: groups.length,
    ok: results.filter((r) => r.ok).length,
    cached: groups.length - todo.length || undefined,
    retries: drafts.filter((d) => d.tries > 1).length || undefined,
    fails: results.filter((r) => !r.ok).map((r) => r.reason).join(',') || undefined,
    firstMs: drafts.length ? Math.min(...drafts.map((d) => d.ms)) : undefined,
    ms: out.ms,
  });
  return out;
}

export function registerCompose(app: Hono): void {
  app.post('/v1/compose', async (c) => {
    const { req } = await readBody(c, ComposeBody);
    return c.json(await compose(req, { fresh: wantsFresh(c) }));
  });
}
