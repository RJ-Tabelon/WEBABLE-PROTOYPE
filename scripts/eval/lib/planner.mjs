import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { respond } from '../openai.mjs';

/**
 * The planner path as the `compose` Edge Function runs it (docs/10 §6),
 * step for step, so the evaluation measures the shipped contract:
 *
 *   1. the wire skeleton parses with composeRequestSchema (strict);
 *   2. every label word is VOCAB_V1 or '·', and no record or text node
 *      carries words (the function's server-side re-check);
 *   3. the server writes the outline (wireOutline) the model reads;
 *   4. plannerRequestBody(outline, { model, fast }) goes to the Responses API;
 *   5. the answer must be JSON, parse as a PageSpec, and use only ids that
 *      were in the request (otherwise the function rejects it whole).
 */

/** Every id a spec refers to (supabase/functions/compose/validate.ts specIds). */
export function specIds(spec) {
  const ids = [];
  for (const s of spec.sections) {
    ids.push(...s.node_ids);
    if (s.heading_ref !== null) ids.push(s.heading_ref);
  }
  for (const c of spec.collections) {
    ids.push(c.list_id);
    if (c.open_slot !== null) ids.push(c.open_slot);
    for (const f of c.fields) ids.push(f.slot_id);
  }
  return ids;
}

/** Nodes carrying words where the wire never has any (validate.ts recordWordNodes). */
function recordWordNodes(nodes) {
  const kinds = new Map(nodes.map((n) => [n.id, n.k]));
  const exemplars = new Set();
  for (const n of nodes) if (n.k === 'collection' && n.ex) exemplars.add(n.ex);
  const inside = new Set();
  let count = 0;
  for (const n of nodes) {
    const p = n.p;
    if (
      n.s === true ||
      exemplars.has(n.id) ||
      (p !== null && (inside.has(p) || kinds.get(p) === 'collection'))
    )
      inside.add(n.id);
    if (!n.l) continue;
    if (n.k === 'text' || n.k === 'stext' || inside.has(n.id)) count += 1;
  }
  return count;
}

/** Steps 1-3: the request the function would accept and the outline it writes. */
export function plannerInput(core, wire) {
  const parsed = core.composeRequestSchema.safeParse({
    v: 1,
    schema: core.COMPOSE_SCHEMA_VERSION,
    skeleton: wire,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      stage: 'schema',
      issue: first
        ? `${first.code}@${first.path.filter((p) => typeof p === 'string').join('.')}`
        : null,
    };
  }
  const nodes = parsed.data.skeleton.nodes;
  const badWords = nodes
    .flatMap((n) => n.l ?? [])
    .filter((w) => w !== core.DROPPED_MARK && !core.isVocabWord(w)).length;
  if (badWords) return { ok: false, stage: 'vocabulary', count: badWords };
  const misplaced = recordWordNodes(nodes);
  if (misplaced) return { ok: false, stage: 'record_words', count: misplaced };
  const outline = core.wireOutline(parsed.data.skeleton);
  const body = JSON.stringify(parsed.data);
  return {
    ok: true,
    outline,
    ids: new Set(nodes.map((n) => n.id)),
    nodes: nodes.length,
    bytes: core.wireBytes(body),
    outlineTokens: core.outlineTokens(outline),
    words: nodes.reduce(
      (n, x) => n + (x.l ?? []).filter((w) => w !== core.DROPPED_MARK).length,
      0,
    ),
  };
}

/** Step 5. */
export function checkOutput(core, text, ids) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, stage: 'json' };
  }
  const parsed = core.pageSpecSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      stage: 'schema',
      issue: first ? `${first.code}@${first.path.join('.')}` : null,
    };
  }
  const all = specIds(parsed.data);
  const unknown = all.filter((id) => !ids.has(id));
  if (unknown.length)
    return {
      ok: false,
      stage: 'unknown_id',
      count: unknown.length,
      total: all.length,
      spec: parsed.data,
    };
  return { ok: true, spec: parsed.data, total: all.length };
}

/**
 * One planner call for a wire skeleton. With `cacheDir`, an answer for the
 * same outline, model and tier is reused (re-runs of the evaluation do not
 * spend again); the benchmark passes none.
 */
export async function planOnce(
  core,
  wire,
  { ledger, model = core.COMPOSE_PINNED_MODEL, fast = true, cacheDir = null },
) {
  const input = plannerInput(core, wire);
  if (!input.ok) return { ok: false, stage: 'request', input };
  const meta = {
    nodes: input.nodes,
    bytes: input.bytes,
    outlineTokens: input.outlineTokens,
    words: input.words,
  };
  const key = createHash('sha256')
    .update(`${model}|${fast}|${core.COMPOSE_SCHEMA_VERSION}|${input.outline}`)
    .digest('hex')
    .slice(0, 24);
  const file = cacheDir ? join(cacheDir, `${key}.json`) : null;
  let res = null;
  let cached = false;
  if (file) {
    try {
      res = JSON.parse(await readFile(file, 'utf8'));
      cached = true;
    } catch {
      res = null;
    }
  }
  if (!res) {
    const body = core.plannerRequestBody(input.outline, { model, fast });
    res = await respond(body, { ledger, timeoutMs: 30_000 });
    if (file && res.ok) {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(file, JSON.stringify(res));
    }
  }
  const call = {
    model,
    cached,
    ok: res.ok,
    err: res.err ?? null,
    totalMs: res.totalMs,
    ttftMs: res.ttftMs,
    usage: res.usage,
    tier: res.tier,
    cost: cached ? 0 : res.cost,
    /** The function's 12 s deadline (no retry). */
    overDeadline: res.totalMs > 12_000,
  };
  if (!res.ok)
    return { ok: false, stage: 'call', call, meta, outline: input.outline };
  const out = checkOutput(core, res.text, input.ids);
  return {
    ok: out.ok,
    stage: out.ok ? 'done' : out.stage,
    check: { ...out, spec: undefined },
    spec: out.spec ?? null,
    call,
    meta,
    outline: input.outline,
  };
}
