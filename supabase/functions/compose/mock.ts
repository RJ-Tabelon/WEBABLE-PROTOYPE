// A deterministic stand-in for the OpenAI Responses API, for the compose tests
// and the local dev planner (`pnpm dev:compose --mock`). Never deployed: only
// tests and scripts/dev-compose.ts import it.
//
// The mock sees exactly what OpenAI would: the request body with the outline
// the handler wrote. It reads the outline back into nodes and answers with a
// heuristic-like PageSpec that uses only ids from the outline, in the
// Responses API's own shape (output -> message -> output_text), including
// usage, so tests can prove the handler never passes those fields on.
//
// Failure modes mirror the real API: model_not_found (404), a refusal part,
// an incomplete answer, HTTP errors with OpenAI's error body, slow answers that
// honour the AbortSignal, and connection failures.

import type {
  CardStyle,
  FieldRole,
  FieldShow,
  ItemKind,
  MediaShape,
  PageSpec,
  SectionKind,
  SectionLayout,
  SpecCollection,
  SpecField,
  SpecSection,
} from '../_shared/core.bundle.js';
import { OPENAI_RESPONSES_URL } from './config.ts';

// ---------------------------------------------------------------------------
// Outline -> nodes
// ---------------------------------------------------------------------------

export interface OutlineNode {
  id: string;
  parent: string | null;
  tag: string;
  role: string | null;
  control: boolean;
  list: boolean;
  slot: boolean;
  tokens: Set<string>;
  pat: string[];
  input: string | null;
  text: boolean;
  box: [number, number, number, number];
}

export interface Outline {
  vh: number;
  nodes: OutlineNode[];
  kids: Map<string, string[]>;
}

const LINE = /^( *)(e\d{1,4}) (\S+)(.*)$/;

/** Read an outline (skeleton/outline.ts) back into a node tree. Lines that are not nodes are skipped. */
export function parseOutline(outline: string): Outline {
  const lines = outline.split('\n');
  const vh =
    Number(/viewport=\d+x(\d+)/.exec(lines[0] ?? '')?.[1] ?? 800) || 800;
  const nodes: OutlineNode[] = [];
  const kids = new Map<string, string[]>();
  const stack: Array<{ depth: number; id: string }> = [];
  for (const raw of lines.slice(1)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const depth = m[1]!.length;
    const id = m[2]!;
    const head = m[3]!;
    // Quoted label words are the page's interface words: never interpreted here.
    const rest = m[4]!.replace(/"[^"]*"/g, ' ');
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1]!.id : null;
    stack.push({ depth, id });

    const tokens = new Set(rest.trim().split(/\s+/).filter(Boolean));
    const box = /\[(\d+),(\d+),(\d+),(\d+)\]/.exec(rest);
    const node: OutlineNode = {
      id,
      parent,
      tag: head.replace(/[[*].*$/, ''),
      role: /\[([a-z]+)\]/.exec(head)?.[1] ?? null,
      control: head.endsWith('*'),
      list: tokens.has('LIST'),
      slot: tokens.has('slot'),
      tokens,
      pat: /(?:^|\s)pat:([a-z,]+)/.exec(rest)?.[1]?.split(',') ?? [],
      input: /(?:^|\s)it:([a-z]+)/.exec(rest)?.[1] ?? null,
      text: /(?:^|\s)text:[a-z]+/.test(rest),
      box: box
        ? [Number(box[1]), Number(box[2]), Number(box[3]), Number(box[4])]
        : [0, 0, 0, 0],
    };
    nodes.push(node);
    if (parent !== null) {
      const list = kids.get(parent);
      if (list) list.push(id);
      else kids.set(parent, [id]);
    }
  }
  return { vh, nodes, kids };
}

// ---------------------------------------------------------------------------
// Nodes -> PageSpec
// ---------------------------------------------------------------------------

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const MEDIA_TAGS = new Set(['img', 'picture', 'video', 'canvas', 'svg']);
const MAX_SECTIONS = 24;
const MAX_COLLECTIONS = 16;
const MAX_FIELDS = 16;

function subtree(o: Outline, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const k = stack.pop()!;
    out.push(k);
    stack.push(...[...(o.kids.get(k) ?? [])].reverse());
  }
  return out;
}

const isHeading = (n: OutlineNode): boolean =>
  HEADING_TAGS.has(n.tag) || n.role === 'heading';
const area = (n: OutlineNode): number => n.box[2] * n.box[3];

function sectionKind(n: OutlineNode, navSeen: boolean): SectionKind | null {
  if (n.tag === 'main' || n.role === 'main') return null;
  if (n.tokens.has('adhint')) return 'ads';
  if (n.tokens.has('consenthint')) return 'consent';
  if (n.tag === 'dialog' || n.role === 'dialog') return 'overlay_modal';
  if (n.tag === 'header' || n.role === 'banner') return 'header';
  if (n.role === 'search') return 'search';
  if (n.tag === 'nav' || n.role === 'navigation')
    return navSeen ? 'secondary_nav' : 'primary_nav';
  if (n.tag === 'footer' || n.role === 'contentinfo') return 'footer';
  if (n.tag === 'aside' || n.role === 'complementary') return 'related';
  return 'secondary';
}

const IMPORTANCE: Partial<Record<SectionKind, SpecSection['importance']>> = {
  ads: 'fold',
  overlay_modal: 'fold',
  footer: 'tertiary',
  related: 'tertiary',
  secondary_nav: 'tertiary',
};

const LAYOUT: Partial<Record<SectionKind, SectionLayout>> = {
  header: 'chip_bar',
  search: 'form_panel',
  primary_nav: 'chip_bar',
  secondary_nav: 'menu',
  footer: 'link_grid',
  related: 'row_list',
  consent: 'as_is',
  overlay_modal: 'as_is',
  ads: 'as_is',
};

/** The card of each item kind the mock emits (core's CARD_OF for these kinds). */
const CARD: Partial<Record<ItemKind, CardStyle>> = {
  nav_link: 'link',
  video: 'media',
  product: 'tile',
  tab: 'chip',
  article_card: 'story',
};

/** Media shape from a thumbnail box, as core's mediaShapeOf. */
function mediaShape(box: OutlineNode['box'] | null): MediaShape {
  if (!box) return 'none';
  const [, , w, h] = box;
  if (!(w > 0) || !(h > 0)) return 'square';
  const r = w / h;
  return r >= 1.3 ? 'landscape' : r <= 0.85 ? 'portrait' : 'square';
}

function fieldRole(o: Outline, n: OutlineNode): FieldRole {
  if (MEDIA_TAGS.has(n.tag) || n.tokens.has('media') || n.tokens.has('imgctrl'))
    return 'thumbnail';
  if (isHeading(n)) return 'title';
  if (n.pat.includes('price')) return 'price';
  if (n.pat.includes('duration')) return 'duration';
  if (n.pat.includes('rating')) return 'rating';
  if (n.pat.includes('date')) return 'timestamp';
  if (n.pat.includes('count') || n.pat.includes('num')) return 'meta';
  if (n.input === 'checkbox') return 'select_toggle';
  if (n.control && n.tokens.has('icon'))
    return n.tokens.has('popup') ? 'overflow_menu' : 'secondary_action';
  if (n.control) return 'link';
  if (n.text) return 'description';
  if ((o.kids.get(n.id) ?? []).length > 0) return 'other';
  return 'meta';
}

const ALWAYS: ReadonlySet<FieldRole> = new Set([
  'title',
  'thumbnail',
  'price',
  'duration',
  'rating',
  'timestamp',
  'select_toggle',
]);

function collection(
  o: Outline,
  list: OutlineNode,
  insideNav: boolean,
): SpecCollection {
  const byId = new Map(o.nodes.map((n) => [n.id, n] as const));
  const slots = subtree(o, list.id)
    .slice(1)
    .map((id) => byId.get(id)!)
    .filter((n) => n.slot);
  const fields: SpecField[] = [];
  for (const n of slots) {
    if (fields.length >= MAX_FIELDS) break;
    const role = fieldRole(o, n);
    const show: FieldShow = ALWAYS.has(role)
      ? 'always'
      : role === 'other'
        ? 'hide'
        : 'on_expand';
    fields.push({ slot_id: n.id, role, show });
  }
  const roles = new Set(fields.map((f) => f.role));
  const shapes = new Set(slots.flatMap((n) => n.pat));
  const kind: ItemKind = insideNav
    ? 'nav_link'
    : shapes.has('duration')
      ? 'video'
      : shapes.has('price')
        ? 'product'
        : slots.some((n) => n.role === 'tab')
          ? 'tab'
          : roles.has('title')
            ? 'article_card'
            : 'other';
  const open =
    slots.find((n) => isHeading(n) && n.tokens.has('headlink')) ??
    slots.find((n) => n.control && n.tokens.has('imgctrl')) ??
    slots.find((n) => n.control && !n.tokens.has('icon')) ??
    null;
  const thumb = fields
    .filter((f) => f.role === 'thumbnail')
    .map((f) => byId.get(f.slot_id)!)
    .reduce<OutlineNode | null>(
      (a, n) => (a && area(a) >= area(n) ? a : n),
      null,
    );
  return {
    list_id: list.id,
    item_kind: kind,
    open_slot: open?.id ?? null,
    card: CARD[kind] ?? 'row',
    media: mediaShape(thumb?.box ?? null),
    lead: 'none',
    fields,
  };
}

/** An article when main holds one (or no list); otherwise its list. */
function mainKind(o: Outline, id: string): 'article' | 'main_list' {
  const byId = new Map(o.nodes.map((n) => [n.id, n] as const));
  const nodes = subtree(o, id).map((k) => byId.get(k)!);
  if (nodes.some((n) => n.tag === 'article' || n.role === 'article'))
    return 'article';
  return nodes.some((n) => n.list) ? 'main_list' : 'article';
}

/**
 * A deterministic, heuristic-like PageSpec for an outline: one section per
 * top-level region, main content as the single primary section, and one
 * collection per LIST with its slots mapped to roles by shape.
 */
export function mockPlannerSpec(outline: string): PageSpec {
  const o = parseOutline(outline);
  const byId = new Map(o.nodes.map((n) => [n.id, n] as const));
  const root = o.nodes[0];
  if (!root) throw new Error('mockPlannerSpec: empty outline');

  // Top-level regions: descend through single-child wrappers.
  let regions = o.kids.get(root.id) ?? [];
  let holder = root;
  while (regions.length === 1) {
    const only = byId.get(regions[0]!)!;
    const below = o.kids.get(only.id) ?? [];
    if (below.length === 0 || only.tag === 'main' || only.role === 'main')
      break;
    holder = only;
    regions = below;
  }
  if (regions.length === 0) regions = [holder.id];

  const lists = o.nodes.filter((n) => n.list);
  const sections: SpecSection[] = [];
  let navSeen = false;
  let primary: number | null = null;
  for (const id of regions) {
    if (sections.length >= MAX_SECTIONS) break;
    const n = byId.get(id)!;
    const ids = new Set(subtree(o, id));
    const inList = new Set(
      lists
        .filter((l) => ids.has(l.id))
        .flatMap((l) => subtree(o, l.id).slice(1)),
    );
    const heading = [...ids]
      .map((k) => byId.get(k)!)
      .find((k) => k.id !== id && isHeading(k) && !inList.has(k.id));
    let kind = sectionKind(n, navSeen);
    if (kind === 'primary_nav' || kind === 'secondary_nav') navSeen = true;
    let importance: SpecSection['importance'];
    let layout: SectionLayout;
    if (kind === null) {
      kind = mainKind(o, id);
      importance = 'primary';
      layout = kind === 'main_list' ? 'card_grid' : 'reading';
      primary = sections.length;
    } else {
      importance = IMPORTANCE[kind] ?? 'secondary';
      layout = LAYOUT[kind] ?? 'reading';
    }
    sections.push({
      kind,
      importance,
      node_ids: [id],
      heading_ref: heading?.id ?? null,
      layout,
    });
  }
  if (primary === null) {
    // No main landmark: the largest secondary region carries the task.
    let best = -1;
    for (const [i, s] of sections.entries()) {
      if (s.kind !== 'secondary') continue;
      const n = byId.get(s.node_ids[0]!)!;
      if (best < 0 || area(n) > area(byId.get(sections[best]!.node_ids[0]!)!))
        best = i;
    }
    if (best < 0) best = 0;
    const s = sections[best]!;
    const kind = mainKind(o, s.node_ids[0]!);
    sections[best] = {
      ...s,
      kind,
      importance: 'primary',
      layout: kind === 'main_list' ? 'card_grid' : 'reading',
    };
    primary = best;
  }

  const navIds = new Set(
    sections
      .filter((s) => s.kind === 'primary_nav' || s.kind === 'secondary_nav')
      .flatMap((s) => subtree(o, s.node_ids[0]!)),
  );
  const collections = lists
    .slice(0, MAX_COLLECTIONS)
    .map((l) => collection(o, l, navIds.has(l.id)));

  const main = sections[primary]!;
  const listing = main.kind === 'main_list';
  return {
    v: 1,
    page_type: listing
      ? 'listing_grid'
      : main.kind === 'article'
        ? 'article'
        : 'other',
    primary_task: listing
      ? 'browse_and_choose'
      : main.kind === 'article'
        ? 'read'
        : 'other',
    sections,
    collections,
  };
}

// ---------------------------------------------------------------------------
// The Responses API
// ---------------------------------------------------------------------------

export interface MockPlannerOptions {
  /** Models this key cannot use: answered 404 model_not_found. */
  unavailableModels?: readonly string[];
  /** Replace the answered spec (any JSON value), given the outline. */
  spec?: (outline: string) => unknown;
  /** Answer this raw output text instead of a spec (e.g. malformed JSON). */
  outputText?: string;
  /** Answer with a refusal content part. */
  refusal?: boolean;
  /** Stop early: status 'incomplete' with this reason. */
  incomplete?: 'max_output_tokens' | 'content_filter';
  /** Answer this HTTP status with OpenAI's error body. */
  status?: number;
  error?: {
    message?: string;
    type?: string;
    param?: string | null;
    code?: string | null;
  };
  /** Simulated model time; honours the request's AbortSignal. */
  delayMs?: number;
  /** Reject like a failed connection. */
  networkError?: boolean;
  /** Called with every parsed request body and its headers. */
  onRequest?: (body: Record<string, unknown>, headers: Headers) => void;
}

function hex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function errorReply(
  status: number,
  error: MockPlannerOptions['error'],
): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: error?.message ?? 'The request failed.',
        type: error?.type ?? 'invalid_request_error',
        param: error?.param ?? null,
        code: error?.code ?? null,
      },
    }),
    {
      status,
      headers: {
        'content-type': 'application/json',
        'x-request-id': `req_${hex(32)}`,
      },
    },
  );
}

function wait(
  ms: number,
  signal: AbortSignal | null | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The signal has been aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('The signal has been aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** A fetch that behaves like POST https://api.openai.com/v1/responses (non-streaming). */
export function createMockPlannerFetch(
  opts: MockPlannerOptions = {},
): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const signal = init?.signal;
    if (opts.networkError)
      throw new TypeError('error sending request: connection refused');
    if (url !== OPENAI_RESPONSES_URL || (init?.method ?? 'GET') !== 'POST')
      return errorReply(404, { message: 'Not found.', code: 'not_found' });
    const headers = new Headers(init?.headers);
    if (!/^Bearer \S+$/.test(headers.get('authorization') ?? ''))
      return errorReply(401, {
        message: 'No API key provided.',
        code: 'invalid_api_key',
      });

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(typeof init?.body === 'string' ? init.body : '');
    } catch {
      return errorReply(400, {
        message: 'We could not parse the JSON body of your request.',
      });
    }
    opts.onRequest?.(body, headers);

    const model = typeof body.model === 'string' ? body.model : '';
    const format = (
      body.text as { format?: Record<string, unknown> } | undefined
    )?.format;
    if (typeof body.input !== 'string' || !model)
      return errorReply(400, {
        message: "Missing required parameter: 'input'.",
        param: 'input',
        code: 'missing_required_parameter',
      });
    if (format?.type !== 'json_schema' || format.strict !== true)
      return errorReply(400, {
        message: 'Invalid text.format.',
        param: 'text.format',
        code: 'invalid_value',
      });
    if (opts.unavailableModels?.includes(model))
      return errorReply(404, {
        message: `The model \`${model}\` does not exist or you do not have access to it.`,
        code: 'model_not_found',
      });

    if (opts.delayMs) await wait(opts.delayMs, signal);
    else if (signal?.aborted)
      throw new DOMException('The signal has been aborted', 'AbortError');
    if (opts.status) return errorReply(opts.status, opts.error);

    const outline = body.input;
    const text =
      opts.outputText ??
      JSON.stringify(opts.spec ? opts.spec(outline) : mockPlannerSpec(outline));
    const content = opts.refusal
      ? [{ type: 'refusal', refusal: 'I can’t help with that.' }]
      : [{ type: 'output_text', text, annotations: [], logprobs: [] }];
    const inputTokens = Math.ceil(outline.length / 2.75) + 1400;
    const reply = {
      id: `resp_${hex(48)}`,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      status: opts.incomplete ? 'incomplete' : 'completed',
      background: false,
      error: null,
      incomplete_details: opts.incomplete ? { reason: opts.incomplete } : null,
      instructions: body.instructions ?? null,
      max_output_tokens: body.max_output_tokens ?? null,
      model: `${model}-2026-08-01`,
      output: [
        {
          id: `msg_${hex(48)}`,
          type: 'message',
          status: opts.incomplete ? 'incomplete' : 'completed',
          role: 'assistant',
          content,
        },
      ],
      parallel_tool_calls: true,
      prompt_cache_key: body.prompt_cache_key ?? null,
      reasoning: body.reasoning ?? { effort: null, summary: null },
      service_tier: body.service_tier === 'priority' ? 'fast' : 'default',
      store: body.store ?? true,
      temperature: body.temperature ?? 1,
      text: body.text,
      tool_choice: 'auto',
      tools: [],
      top_p: 1,
      truncation: 'disabled',
      usage: {
        input_tokens: inputTokens,
        input_tokens_details: { cached_tokens: 1280 },
        output_tokens: Math.ceil(text.length / 3),
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: inputTokens + Math.ceil(text.length / 3),
      },
      user: null,
      metadata: {},
    };
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'openai-processing-ms': '4210',
        'x-request-id': `req_${hex(32)}`,
      },
    });
  };
}
