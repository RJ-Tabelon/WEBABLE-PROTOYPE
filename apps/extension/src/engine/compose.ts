// Owner: B (round 10). The WebAble page's groups laid out for the person, asked for group by group.
//
// The WebAble page groups the page's own content (the paragraphs, lists and tables under one heading) and calls
// api.compose(groups), first screen first. Here: each id is asked for once on this page (the same content gets the
// same id), in the order given; the latest call's order wins for groups not yet sent. Requests carry up to 2 groups,
// with up to 3 in flight; the background adds the person's AI answer (or none: laid out for a general reader) and
// posts to /v1/compose, where the model proposes components as data, code checks them and Jev judges them. Code here
// checks links and numbers again before a group is shown. Each group goes 'waiting' -> 'ready' (with readyAt, so the
// view settles it in once) | 'kept' (Jev or the model found the page's own words easier) | 'failed' (a check failed or
// the server could not be reached); 'kept' and 'failed' show the page's own words. A new page starts again, and late
// answers for an old page are dropped. When every group asked for has an answer, one summary for the ledger.

import { markersIn, numbersKept, stripMarkers } from '@webable/core';
import type { BgRequest, ComposeBlock, ComposeGroupIn, ComposeResponse, ComposeResult, RewordPage } from '@webable/core';
import type { ComposeGroupState, EngineState } from '../contracts';

/** Groups per request. */
export const COMPOSE_BATCH = 2;
/** Requests in flight at once: a long article's groups (about 12) all go out together, so the slowest answer, not a
 *  second wave, sets how long the page takes. */
export const COMPOSE_IN_FLIGHT = 6;
/** A little over the background's own 20 s, so its plainer timeout message wins. */
const COMPOSE_TIMEOUT_MS = 24_000;

export type ComposeState = NonNullable<EngineState['compose']>;

export const COMPOSE_KINDS: ReadonlySet<string> = new Set<ComposeBlock['k']>([
  'prose', 'keyfacts', 'steps', 'stats', 'compare', 'callout', 'definitions', 'quote', 'contact', 'points',
]);

export interface ComposeSummary {
  opId: string;
  /** Groups asked for on this page. */
  asked: number;
  /** Laid out, every check passed. */
  laidOut: number;
  /** Kept in the page's own words because they read better as they are. */
  kept: number;
  /** Kept in the page's own words because a check failed or the server could not be reached. */
  failed: number;
  /** Failed because the server could not be reached (or answered with something unusable). */
  unreachable: number;
  /** Jev's probabilities that the layout is easier, for the groups laid out. */
  better: number[];
  ms: number;
}

export interface ComposeHost {
  ask<T>(req: BgRequest, timeoutMs?: number): Promise<T>;
  /** The page as the model sees it (title, host, Jev's purpose when known). */
  page(): RewordPage;
  /** Nothing is sent from this page (password or payment fields, mail, chat or banking sites). */
  blocked(): boolean;
  publish(s: ComposeState): void;
  /** Every group asked for so far has an answer (again after later groups are answered: same opId, replace it). */
  finished(s: ComposeSummary): void;
  /** Tests: the clock (default performance.now). */
  now?: () => number;
}

export interface ComposeRunner {
  compose(groups: ComposeGroupIn[]): void;
  /** A new page (or WebAble turned off): nothing kept, late answers dropped. */
  reset(): void;
  lastSummary(): ComposeSummary | null;
  ownsOp(opId: string): boolean;
  /** Tests and the Jev view. */
  state(): ComposeState;
}

/* ------------------------------------------------------------------ */
/* Pure checks (tested)                                                */
/* ------------------------------------------------------------------ */

/** Keys whose values are names, not words the person reads. */
const NOT_TEXT = new Set(['k', 'tone', 'icon', 'kind', 'src']);

/** Every word the person will read in the blocks, one string per field. */
export function blockTexts(blocks: ComposeBlock[]): string[] {
  const out: string[] = [];
  const walk = (x: unknown, key: string | null): void => {
    if (typeof x === 'string') {
      if (!key || !NOT_TEXT.has(key)) out.push(x);
    } else if (Array.isArray(x)) {
      for (const y of x) walk(y, key);
    } else if (x && typeof x === 'object') {
      for (const [k, v] of Object.entries(x)) if (!NOT_TEXT.has(k)) walk(v, k);
    }
  };
  walk(blocks, null);
  return out;
}

/** Digit numbers as written (thousands separators and trailing .0 ignored). */
function digitsIn(s: string): string[] {
  return (s.match(/\d+(?:[.,:]\d+)*/g) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, '').replace(/\.0+$/, ''));
}

/**
 * Code's own check of a group's blocks before they are shown (the server's code and Jev checked them already): known
 * kinds, every ⟦n⟧ in range, every link of the group kept, every number of the page's text kept, and no number the
 * page doesn't have. Null when it passes, else the reason.
 */
export function checkBlocks(group: ComposeGroupIn, blocks: unknown): string | null {
  if (!Array.isArray(blocks) || !blocks.length) return 'invalid';
  for (const b of blocks) {
    if (!b || typeof b !== 'object' || !COMPOSE_KINDS.has((b as { k?: unknown }).k as string)) return 'invalid';
  }
  const texts = blockTexts(blocks as ComposeBlock[]);
  const all = texts.join('\n');
  const links = group.linkTexts.length;
  const seen = new Set<number>();
  for (const n of markersIn(all)) {
    if (n < 1 || n > links) return 'links';
    seen.add(n);
  }
  if (seen.size !== links || /[⟦⟧]/.test(all.replace(/⟦\d{1,3}⟧/g, ''))) return 'links';
  const original = group.units.map((u) => u.text).join('\n');
  const words = stripMarkers(all);
  if (!numbersKept(stripMarkers(original), words)) return 'numbers';
  // Numbers the person reads must come from the page: its text, its heading or its links' words.
  const source = [original, group.heading ?? '', ...group.linkTexts].join('\n');
  const have = new Set(digitsIn(stripMarkers(source)));
  for (const n of digitsIn(words)) if (!have.has(n)) return 'new_numbers';
  return null;
}

/**
 * The send order after a call: this call's groups not yet sent, in its order (new ones and ones already waiting), then
 * the rest of the queue as it was. Ids already sent are never queued again.
 */
export function nextQueue(queue: ComposeGroupIn[], call: ComposeGroupIn[], sent: ReadonlySet<string>): ComposeGroupIn[] {
  const first: ComposeGroupIn[] = [];
  const ids = new Set<string>();
  for (const g of call) {
    if (!g || typeof g.id !== 'string' || sent.has(g.id) || ids.has(g.id)) continue;
    ids.add(g.id);
    first.push(g);
  }
  return [...first, ...queue.filter((g) => !ids.has(g.id))];
}

function isResponse(x: unknown): x is ComposeResponse {
  return !!x && typeof x === 'object' && Array.isArray((x as ComposeResponse).results);
}

const prob = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : null);

/* ------------------------------------------------------------------ */
/* The runner                                                          */
/* ------------------------------------------------------------------ */

export function createCompose(host: ComposeHost): ComposeRunner {
  const now = host.now ?? (() => performance.now());
  let groups: Record<string, ComposeGroupState> = {};
  /** Ids asked for on this page (waiting in the queue, in flight or answered). */
  const known = new Set<string>();
  /** Ids sent to the server on this page. */
  const sent = new Set<string>();
  let queue: ComposeGroupIn[] = [];
  let inFlight = 0;
  let status: ComposeState['status'] = 'idle';
  let version = 0;
  let run = 0;
  let startedAt = 0;
  let summary: ComposeSummary | null = null;
  const ops = new Set<string>();

  const snapshot = (): ComposeState => ({ status, groups: { ...groups }, version });

  const publish = () => {
    version++;
    host.publish(snapshot());
  };

  const set = (id: string, next: ComposeGroupState) => {
    groups = { ...groups, [id]: next };
  };

  const settle = (g: ComposeGroupIn, r: ComposeResult | undefined) => {
    if (!r) {
      set(g.id, { id: g.id, state: 'failed', blocks: null, better: null, reason: 'llm_unavailable' });
      return;
    }
    const better = prob(r.better);
    if (!r.ok) {
      const reason = r.reason || 'check_unavailable';
      set(g.id, { id: g.id, state: reason === 'plain_is_better' ? 'kept' : 'failed', blocks: null, better, reason });
      return;
    }
    const bad = checkBlocks(g, r.blocks);
    if (bad) {
      set(g.id, { id: g.id, state: 'failed', blocks: null, better, reason: bad });
      return;
    }
    set(g.id, { id: g.id, state: 'ready', blocks: r.blocks as ComposeBlock[], better, readyAt: now() });
  };

  const maybeDone = (my: number) => {
    if (my !== run || queue.length || inFlight) return;
    const all = Object.values(groups);
    if (!all.length || all.some((g) => g.state === 'waiting')) return;
    status = 'done';
    publish();
    const ready = all.filter((g) => g.state === 'ready');
    const opId = `compose-${my}`;
    ops.add(opId);
    summary = {
      opId,
      asked: all.length,
      laidOut: ready.length,
      kept: all.filter((g) => g.state === 'kept').length,
      failed: all.filter((g) => g.state === 'failed').length,
      unreachable: all.filter((g) => g.state === 'failed' && g.reason === 'unreachable').length,
      better: ready.map((g) => g.better).filter((p): p is number => p !== null),
      ms: Math.round(now() - startedAt),
    };
    host.finished(summary);
  };

  const send = async (my: number, batch: ComposeGroupIn[]): Promise<void> => {
    let res: ComposeResponse | null = null;
    try {
      const got = await host.ask<unknown>({ type: 'compose', req: { page: host.page(), groups: batch } }, COMPOSE_TIMEOUT_MS);
      res = isResponse(got) ? got : null;
    } catch {
      res = null;
    }
    if (my !== run) return;
    inFlight--;
    if (!res) {
      for (const g of batch) set(g.id, { id: g.id, state: 'failed', blocks: null, better: null, reason: 'unreachable' });
    } else {
      const byId = new Map(res.results.filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r] as const));
      for (const g of batch) settle(g, byId.get(g.id));
    }
    publish();
    pump(my);
    maybeDone(my);
  };

  function pump(my: number): void {
    while (my === run && inFlight < COMPOSE_IN_FLIGHT && queue.length) {
      const batch = queue.slice(0, COMPOSE_BATCH);
      queue = queue.slice(batch.length);
      for (const g of batch) sent.add(g.id);
      inFlight++;
      void send(my, batch);
    }
  }

  function compose(input: ComposeGroupIn[]): void {
    if (!Array.isArray(input) || !input.length || host.blocked()) return;
    const fresh = input.filter((g) => g && typeof g.id === 'string' && !known.has(g.id));
    queue = nextQueue(queue, input, sent);
    if (!fresh.length && !queue.length) return;
    if (!startedAt) startedAt = now();
    for (const g of fresh) {
      known.add(g.id);
      set(g.id, { id: g.id, state: 'waiting', blocks: null, better: null });
    }
    if (fresh.length) {
      status = 'working';
      publish();
    }
    pump(run);
  }

  function reset(): void {
    const had = status !== 'idle' || Object.keys(groups).length > 0;
    run++;
    groups = {};
    known.clear();
    sent.clear();
    queue = [];
    inFlight = 0;
    summary = null;
    startedAt = 0;
    status = 'idle';
    if (had) publish();
  }

  return {
    compose,
    reset,
    lastSummary: () => summary,
    ownsOp: (opId) => ops.has(opId),
    state: snapshot,
  };
}
