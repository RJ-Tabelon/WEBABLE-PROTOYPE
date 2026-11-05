// POST /v1/reword/score {req: RewordScoreRequest} -> RewordScoreResult
// POST /v1/reword/write {req: RewordWriteRequest} -> RewordWriteResult
// Round 9: paragraphs fitted to the person.
// score: Jev answers need_<id> and how_<id> for every paragraph, for this reader (one call, two in parallel past 20
//   paragraphs; answers cached by hash in jev.ts); code picks the change. No Jev answer: the error goes back as it is
//   and the page keeps its own words.
// write: REWORD_MODEL rewrites each item in parallel; code checks numbers, condition words and link markers (a failed
//   item is written once more with the failure named, when there is time); ONE Jev call checks dropped/added for the
//   items that passed. ok only when every check passes. Finished items are cached by (brief, text, kind). No model
//   or no Jev: every item comes back ok:false with the reason (fail closed).
import type { Hono } from 'hono';
import {
  MIN_CHANGE, REWORD_CATALOG_VERSION, REWORD_MODEL, REWRITE_CHECK, buildRewriteCheckCall, buildScoreCall, changeShare,
  conditionsKept, linkWords, linkWordsRepeated, linksKept, outText, parseRewriteCheck, parseScore, quotesKept, readerBrief, rewordNumbersKept,
} from '@webable/core';
import type {
  JevMetrics, RewordKind, RewordOut, RewordParaIn, RewordScoreRequest, RewordScoreResult, RewordWriteRequest,
  RewordWriteResult, RewordWritten,
} from '@webable/core';
import { aiState } from '../ai';
import { jevKey } from '../config';
import { JevError, askJev, askJevAll, emptyJevMetrics, jevMetrics, type JevResult } from '../jev';
import { TtlLru } from '../lru';
import { rewordParagraph } from '../openai';
import { RewordScoreBody, RewordWriteBody } from '../schemas';
import { hashOf, log, round } from '../util';
import { readBody, wantsFresh } from './common';

/* ------------------------------------------------------------------ */
/* Score                                                               */
/* ------------------------------------------------------------------ */

export async function rewordScore(req: RewordScoreRequest, opts: { fresh?: boolean } = {}): Promise<RewordScoreResult> {
  const t0 = performance.now();
  if (req.paras.length === 0) return { scores: [], jev: emptyJevMetrics(), ms: 0 };
  const brief = readerBrief(req.reader);
  const calls = buildScoreCall(brief, req.page, req.paras);
  const results = await askJevAll(calls, { tag: 'reword-score', fresh: opts.fresh });
  const scores = parseScore(req.paras, results.map((r) => r.body));
  const ms = round(performance.now() - t0);
  log('reword score', {
    paras: req.paras.length,
    picked: scores.filter((s) => s.pick).length,
    calls: calls.length,
    cached: results.every((r) => r.cached) || undefined,
    ms,
  });
  return { scores, jev: jevMetrics(results), ms };
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

type Item = RewordParaIn & { kind: RewordKind };
type Written = Omit<RewordWritten, 'id'>;
type CodeFailure = 'numbers' | 'conditions' | 'links' | 'quotes' | 'shape' | 'unchanged';

const cache = new TtlLru<Written>(500, 60 * 60_000);

/** A failed item is written again only when the first try came back within this (so a batch stays near 3-4 s). */
export const REWORD_RETRY_BEFORE_MS = 2_000;
/** Items Jev flagged (dropped/added) are written once more when the first check came back within this. */
export const REWORD_JEV_RETRY_BEFORE_MS = 3_000;

const JEV_RETRY_NOTES: Record<'dropped' | 'added', string> = {
  dropped: 'A checker found a fact, number, condition, limit or warning from the paragraph missing in your version. Keep every one of them; make it easier only in how it is said.',
  added: 'A checker found something in your version that the paragraph does not say. Add no new fact, reason, advice or example; only short meanings of words.',
};

const RETRY_NOTES: Record<CodeFailure, string> = {
  numbers: 'A number, amount or date from the paragraph was missing or changed. Copy every number exactly.',
  conditions: 'A word that limits the meaning (not, no, only, unless, except, at least, at most, within, until, if) was missing.',
  links: 'A link marker was missing, repeated or new, or a link\'s words were written out. Keep each ⟦n⟧ of the paragraph exactly once and never write its words.',
  quotes: 'Words inside quotation marks were changed. Copy quoted words exactly, or drop the quotation marks and report what was said.',
  shape: 'A list needs a lead line of at most 12 words and 2 to 6 items holding the facts.',
  unchanged: 'Your version was nearly the same as the original. Make the change CHANGE asks for, at this reader\'s level.',
};

/** Tidy what the model returned: no list marks or markdown, items only for a list. */
export function tidyOut(kind: RewordKind, out: RewordOut): RewordOut {
  const clean = (s: string) =>
    s
      .replace(/\*\*|__|`/g, '')
      .replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  const items = out.items.map(clean).filter(Boolean);
  if (kind !== 'list') return { lead: [clean(out.lead), ...items].filter(Boolean).join(' '), items: [], ordered: false };
  return { lead: clean(out.lead), items, ordered: out.ordered };
}

/** A list's lead only introduces the items: at most this many words (or 40% of the original's, if more). */
const LIST_LEAD_MAX_WORDS = 16;

function codeChecks(item: Item, out: RewordOut): { numbers: boolean; conditions: boolean; links: boolean; failure: CodeFailure | null } {
  const numbers = rewordNumbersKept(item.text, out);
  const conditions = conditionsKept(item.text, out, item.kind);
  const links = linksKept(item.text, out) && !linkWordsRepeated(item.text, out, item.linkTexts);
  const quotes = quotesKept(item.text, out);
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const leadMax = Math.max(LIST_LEAD_MAX_WORDS, Math.round(words(item.text) * 0.4));
  const shapeOk =
    outText(out).trim() !== '' && (item.kind !== 'list' || (out.items.length >= 2 && out.items.length <= 8 && words(out.lead) <= leadMax));
  const changed = changeShare(item.text, out) >= MIN_CHANGE[item.kind];
  const failure: CodeFailure | null = !numbers
    ? 'numbers'
    : !conditions
      ? 'conditions'
      : !links
        ? 'links'
        : !quotes
          ? 'quotes'
          : !shapeOk
            ? 'shape'
            : !changed
              ? 'unchanged'
              : null;
  return { numbers, conditions, links, failure };
}

interface Draft {
  item: Item;
  out: RewordOut | null;
  checks: ReturnType<typeof codeChecks> | null;
  llmError?: string;
}

async function draft(brief: string, req: RewordWriteRequest, item: Item, t0: number): Promise<Draft> {
  let last: Draft | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const retry = last?.checks?.failure ? RETRY_NOTES[last.checks.failure] : undefined;
    const r = await rewordParagraph(brief, req.reader.level, req.page, item.kind, item.text, retry, linkWords(item));
    if (!r.ok) return last ?? { item, out: null, checks: null, llmError: r.error };
    const out = tidyOut(item.kind, r.data);
    const checks = codeChecks(item, out);
    last = { item, out, checks };
    if (!checks.failure) return last;
    if (performance.now() - t0 > REWORD_RETRY_BEFORE_MS) return last;
    log('reword retry', { kind: item.kind, failure: checks.failure });
  }
  return last!;
}

function failed(kind: RewordKind, reason: string, out: RewordOut | null = null, checks?: Draft['checks']): Written {
  return {
    kind,
    ok: false,
    out,
    checks: {
      numbersKept: checks?.numbers ?? false,
      conditionWordsKept: checks?.conditions ?? false,
      linksKept: checks?.links ?? false,
      dropped: 1,
      added: 1,
    },
    reason,
  };
}

export async function rewordWrite(req: RewordWriteRequest, opts: { fresh?: boolean } = {}): Promise<RewordWriteResult> {
  const t0 = performance.now();
  const items: Item[] = req.items.slice(0, 8);
  const brief = readerBrief(req.reader, { forWriter: true });
  const done = (results: RewordWritten[], jev: JevMetrics = emptyJevMetrics()): RewordWriteResult => ({
    results, model: REWORD_MODEL, ms: round(performance.now() - t0), jev,
  });
  const ai = aiState();
  if (ai.status !== 'on') return done(items.map((it) => ({ id: it.id, ...failed(it.kind, 'llm_unavailable') })));
  if (!jevKey()) return done(items.map((it) => ({ id: it.id, ...failed(it.kind, 'check_unavailable') })));

  const keyOf = (it: Item) => hashOf(REWORD_CATALOG_VERSION, brief, req.reader.level, it.text, it.kind, it.linkTexts ?? []);
  const byId = new Map<string, Written>();
  const todo: Item[] = [];
  for (const it of items) {
    const hit = opts.fresh ? undefined : cache.get(keyOf(it));
    if (hit) byId.set(it.id, hit);
    else todo.push(it);
  }

  const drafts = await Promise.all(todo.map((it) => draft(brief, req, it, t0)));
  const toCheck = drafts.filter((d) => d.out && d.checks && !d.checks.failure);
  let jev = emptyJevMetrics();
  const jevRuns: JevResult[] = [];
  let verdicts: Record<string, { dropped: number; added: number }> | null = null;
  if (toCheck.length) {
    try {
      const call = buildRewriteCheckCall(toCheck.map((d) => ({ id: d.item.id, original: d.item.text, rewrite: outText(d.out!), links: linkWords(d.item) })));
      const r = await askJev({ state: call.state, questions: call.questions }, { tag: 'reword-check', fresh: opts.fresh });
      jevRuns.push(r);
      jev = jevMetrics(jevRuns);
      verdicts = parseRewriteCheck(toCheck.map((d) => d.item.id), r.body);
    } catch (e) {
      log('reword: rewrites could not be checked; keeping the page\'s own words', { kind: e instanceof JevError ? e.kind : 'error' });
    }
  }

  const judged = (kind: RewordKind, out: RewordOut, v: { dropped: number; added: number }): Written => {
    const reason = v.dropped >= REWRITE_CHECK.droppedMax ? 'dropped' : v.added >= REWRITE_CHECK.addedMax ? 'added' : undefined;
    return {
      kind,
      ok: !reason,
      out,
      checks: { numbersKept: true, conditionWordsKept: true, linksKept: true, dropped: round(v.dropped, 3), added: round(v.added, 3) },
      ...(reason ? { reason } : {}),
    };
  };
  const written = new Map<string, Written>();
  for (const d of drafts) {
    const { item } = d;
    let w: Written;
    if (!d.out || !d.checks) {
      w = failed(item.kind, 'llm_unavailable');
    } else if (d.checks.failure) {
      w = failed(item.kind, d.checks.failure, d.out, d.checks);
    } else if (!verdicts) {
      w = failed(item.kind, 'check_unavailable', d.out, d.checks);
    } else {
      w = judged(item.kind, d.out, verdicts[item.id] ?? { dropped: 1, added: 1 });
    }
    written.set(item.id, w);
  }

  // One more try for what Jev flagged, with the failure named, when the batch still has time; checked the same way.
  const flagged = drafts.filter((d) => {
    const r = written.get(d.item.id)?.reason;
    return r === 'dropped' || r === 'added';
  });
  if (flagged.length && performance.now() - t0 < REWORD_JEV_RETRY_BEFORE_MS) {
    const again = (
      await Promise.all(
        flagged.map(async (d) => {
          const note = JEV_RETRY_NOTES[written.get(d.item.id)!.reason as 'dropped' | 'added'];
          const r = await rewordParagraph(brief, req.reader.level, req.page, d.item.kind, d.item.text, note, linkWords(d.item));
          if (!r.ok) return null;
          const out = tidyOut(d.item.kind, r.data);
          return codeChecks(d.item, out).failure ? null : { item: d.item, out };
        }),
      )
    ).filter((x): x is { item: Item; out: RewordOut } => x !== null);
    if (again.length) {
      try {
        const call = buildRewriteCheckCall(again.map((a) => ({ id: a.item.id, original: a.item.text, rewrite: outText(a.out), links: linkWords(a.item) })));
        const r = await askJev({ state: call.state, questions: call.questions }, { tag: 'reword-check/2', fresh: opts.fresh });
        jevRuns.push(r);
        jev = jevMetrics(jevRuns);
        const v2 = parseRewriteCheck(again.map((a) => a.item.id), r.body);
        for (const a of again) {
          const w = judged(a.item.kind, a.out, v2[a.item.id] ?? { dropped: 1, added: 1 });
          if (w.ok) written.set(a.item.id, w);
        }
        log('reword retry after check', { tried: flagged.length, rescued: again.filter((a) => written.get(a.item.id)?.ok).length });
      } catch (e) {
        log('reword: second check unavailable', { kind: e instanceof JevError ? e.kind : 'error' });
      }
    }
  }

  for (const d of drafts) {
    const w = written.get(d.item.id)!;
    // Checked answers are kept (a failed check too: the same paragraph would fail the same way); outages are not.
    if (w.reason !== 'llm_unavailable' && w.reason !== 'check_unavailable') cache.set(keyOf(d.item), w);
    byId.set(d.item.id, w);
  }

  const results = items.map((it) => ({ id: it.id, ...(byId.get(it.id) ?? failed(it.kind, 'llm_unavailable')) }));
  const out = done(results, jev);
  log('reword write', {
    items: items.length,
    ok: results.filter((r) => r.ok).length,
    cached: items.length - todo.length || undefined,
    fails: results.filter((r) => !r.ok).map((r) => r.reason).join(',') || undefined,
    ms: out.ms,
  });
  return out;
}

export function registerReword(app: Hono): void {
  app.post('/v1/reword/score', async (c) => {
    const { req } = await readBody(c, RewordScoreBody);
    return c.json(await rewordScore(req, { fresh: wantsFresh(c) }));
  });
  app.post('/v1/reword/write', async (c) => {
    const { req } = await readBody(c, RewordWriteBody);
    return c.json(await rewordWrite(req, { fresh: wantsFresh(c) }));
  });
}
