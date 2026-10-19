import type { SkelKind, SkelRole, SkelTag } from './constants';
import type { WireNode, WireSkeleton } from './wire';

/**
 * The outline the planner reads (docs/10 §6), written by the Edge Function
 * from a validated wire skeleton, never by the page: one line per node,
 *
 *   e14 input[combobox]* it:search "search" [336,16,512,24] fs16
 *   e51 div LIST n=51-100 item=custom [128,560,1072,6032]
 *     exemplar:
 *       e52 custom slot [128,560,344,248]
 *
 * `*` marks a control or input; flags, label words, text shape, box and font
 * size follow. Collections show their count bucket and item tag, then their
 * one exemplar subtree. There is no host, path or title: the outline is a
 * pure function of the wire, so the same template yields the same outline.
 *
 * Long pages are cut to about OUTLINE_TOKEN_BUDGET tokens by collapsing deep,
 * low-value groups into one summary line ("…collapsed: 12 links, 3 texts"):
 * below the fold before above it, never main's own column first, never a
 * subtree holding focus, a search field or a large collection while anything
 * cheaper is left.
 */

/** o200k tokens per character on outlines, measured on the probe pages. */
export const OUTLINE_CHARS_PER_TOKEN = 2.75;
/** Planner input budget for the outline. */
export const OUTLINE_TOKEN_BUDGET = 6000;

export function outlineTokens(text: string): number {
  return Math.ceil(text.length / OUTLINE_CHARS_PER_TOKEN);
}

/** The role a tag carries anyway; it is not repeated in the outline. */
const IMPLICIT: Partial<Record<SkelTag, SkelRole>> = {
  a: 'link',
  article: 'article',
  aside: 'complementary',
  button: 'button',
  dialog: 'dialog',
  figure: 'figure',
  footer: 'contentinfo',
  form: 'form',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  header: 'banner',
  img: 'img',
  li: 'listitem',
  main: 'main',
  nav: 'navigation',
  ol: 'list',
  section: 'region',
  select: 'combobox',
  table: 'table',
  td: 'cell',
  textarea: 'textbox',
  th: 'columnheader',
  tr: 'row',
  ul: 'list',
};

const MEDIA_TAGS: ReadonlySet<SkelTag> = new Set([
  'img',
  'picture',
  'video',
  'audio',
  'canvas',
  'iframe',
  'svg',
]);

const TEXT_BEARING: ReadonlySet<SkelKind> = new Set([
  'heading',
  'control',
  'input',
  'text',
  'stext',
]);

const LARGE_COUNTS: ReadonlySet<string> = new Set([
  '11-25',
  '26-50',
  '51-100',
  '100+',
]);

function head(n: WireNode): string {
  let s = n.t;
  if (n.r && IMPLICIT[n.t] !== n.r) s += `[${n.r}]`;
  if (n.k === 'control' || n.k === 'input') s += '*';
  return s;
}

/** One node's line without indentation (and without a collapse summary). */
function line(n: WireNode, exemplarOf: string | null): string {
  const parts: string[] = [n.id, head(n)];
  if (n.k === 'collection') {
    parts.push('LIST');
    if (n.n) parts.push(`n=${n.n}`);
    if (n.itm) parts.push(`item=${n.itm}`);
  } else if (n.k === 'media' && !MEDIA_TAGS.has(n.t)) parts.push('media');
  else if (n.k === 'table') parts.push('table');
  if (n.lv && n.t !== `h${n.lv}`) parts.push(`lv${n.lv}`);
  if (n.f?.length) parts.push(...n.f);
  if (n.it) parts.push(`it:${n.it}`);
  if (n.o) parts.push(`opts:${n.o}`);
  if (n.hr && n.hr !== 'same') parts.push(`href:${n.hr}`);
  if (n.s) parts.push('slot');
  if (exemplarOf) parts.push(`exemplar-of:${exemplarOf}`);
  if (n.l?.length) parts.push(`"${n.l.join(' ')}"`);
  if (n.sh) {
    parts.push(`${n.k === 'text' ? 'text' : 'len'}:${n.sh.len}`);
    if (n.sh.pat?.length) parts.push(`pat:${n.sh.pat.join(',')}`);
    if (n.sh.ln) parts.push(`links:${n.sh.ln}`);
  }
  parts.push(`[${n.b.join(',')}]`);
  // Font size is a property of text, not of the boxes around it.
  if (n.fs && TEXT_BEARING.has(n.k)) parts.push(`fs${n.fs}`);
  if (n.w === 600) parts.push('w600');
  return parts.join(' ');
}

interface Tree {
  nodes: WireNode[];
  /** Children ids in document order. */
  kids: Map<string, string[]>;
  index: Map<string, number>;
  depth: Map<string, number>;
  /** Exemplar id -> its collection, for exemplars whose parent is the collection. */
  exemplarUnder: Map<string, string>;
  /** Exemplar id -> its collection, for exemplars placed elsewhere. */
  exemplarElsewhere: Map<string, string>;
  /** Characters of each node's own line(s): indentation, text, newline, and an "exemplar:" line above it. */
  cost: Map<string, number>;
}

function tree(wire: WireSkeleton): Tree {
  const nodes = wire.nodes;
  const kids = new Map<string, string[]>();
  const index = new Map<string, number>();
  const depth = new Map<string, number>();
  for (const [i, n] of nodes.entries()) {
    index.set(n.id, i);
    depth.set(n.id, n.p === null ? 0 : (depth.get(n.p) ?? 0) + 1);
    if (n.p !== null) {
      const list = kids.get(n.p);
      if (list) list.push(n.id);
      else kids.set(n.p, [n.id]);
    }
  }
  const exemplarUnder = new Map<string, string>();
  const exemplarElsewhere = new Map<string, string>();
  for (const n of nodes) {
    if (n.k !== 'collection' || !n.ex || !index.has(n.ex)) continue;
    const ex = nodes[index.get(n.ex)!]!;
    if (ex.p === n.id) exemplarUnder.set(n.ex, n.id);
    else exemplarElsewhere.set(n.ex, n.id);
  }
  // Rendered indentation: one level per tree level, two below an "exemplar:" line.
  const rdepth = new Map<string, number>();
  const cost = new Map<string, number>();
  for (const n of nodes) {
    const under = exemplarUnder.has(n.id);
    const d = n.p === null ? 0 : (rdepth.get(n.p) ?? 0) + (under ? 2 : 1);
    rdepth.set(n.id, d);
    const own = 2 * d + line(n, exemplarElsewhere.get(n.id) ?? null).length + 1;
    const label = under ? 2 * (d - 1) + 'exemplar:'.length + 1 : 0;
    cost.set(n.id, own + label);
  }
  return { nodes, kids, index, depth, exemplarUnder, exemplarElsewhere, cost };
}

/** "12 links, 3 texts": what a collapsed subtree held (WebAble's words, not the page's). */
function summary(t: Tree, id: string): string {
  const c = {
    heading: 0,
    link: 0,
    button: 0,
    input: 0,
    image: 0,
    text: 0,
    list: 0,
  };
  const stack = [...(t.kids.get(id) ?? [])];
  while (stack.length) {
    const k = stack.pop()!;
    const n = t.nodes[t.index.get(k)!]!;
    if (n.k === 'heading') c.heading++;
    else if (n.k === 'control') {
      if (n.r === 'link' || n.t === 'a') c.link++;
      else c.button++;
    } else if (n.k === 'input') c.input++;
    else if (n.k === 'media') c.image++;
    else if (n.k === 'text' || n.k === 'stext') c.text++;
    else if (n.k === 'collection') c.list++;
    stack.push(...(t.kids.get(k) ?? []));
  }
  const parts = Object.entries(c)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`);
  return `…collapsed: ${parts.length ? parts.join(', ') : 'layout only'}`;
}

/** Properties of each subtree that make it worth keeping. */
interface Worth {
  size: number;
  focus: boolean;
  search: boolean;
  largeList: boolean;
  main: boolean;
}

function worth(t: Tree): Map<string, Worth> {
  const out = new Map<string, Worth>();
  for (let i = t.nodes.length - 1; i >= 0; i--) {
    const n = t.nodes[i]!;
    const w: Worth = {
      size: 1,
      focus: n.f?.includes('focus') ?? false,
      search: n.r === 'search' || n.r === 'searchbox' || n.it === 'search',
      largeList: n.k === 'collection' && LARGE_COUNTS.has(n.n ?? ''),
      main: n.r === 'main' || n.t === 'main',
    };
    for (const k of t.kids.get(n.id) ?? []) {
      const kw = out.get(k)!;
      w.size += kw.size;
      w.focus ||= kw.focus;
      w.search ||= kw.search;
      w.largeList ||= kw.largeList;
      w.main ||= kw.main;
    }
    out.set(n.id, w);
  }
  return out;
}

const PASSES = [
  { minDepth: 2, minSize: 6 },
  { minDepth: 1, minSize: 3 },
  { minDepth: 1, minSize: 2 },
] as const;

/**
 * Compact indented outline of a wire skeleton, deterministic, within about
 * `budget` estimated tokens.
 */
export function wireOutline(
  wire: WireSkeleton,
  budget: number = OUTLINE_TOKEN_BUDGET,
): string {
  const t = tree(wire);
  const w = worth(t);
  const header =
    `PAGE viewport=${wire.page.vw}x${wire.page.vh} doc=${wire.page.dw}x${wire.page.dh}` +
    (wire.page.lang ? ` lang=${wire.page.lang}` : '');
  const maxChars = Math.floor(budget * OUTLINE_CHARS_PER_TOKEN);
  const vh = Math.max(1, wire.page.vh);
  const root = t.nodes[0];

  // Visible characters per subtree, kept current as subtrees collapse.
  const vis = new Map<string, number>();
  for (let i = t.nodes.length - 1; i >= 0; i--) {
    const n = t.nodes[i]!;
    let sum = t.cost.get(n.id) ?? 0;
    for (const k of t.kids.get(n.id) ?? []) sum += vis.get(k) ?? 0;
    vis.set(n.id, sum);
  }
  // Records (collections and everything inside them) are planned field by field: never collapsed.
  const record = new Set<string>();
  for (const n of t.nodes) {
    if (
      n.k === 'collection' ||
      t.exemplarUnder.has(n.id) ||
      t.exemplarElsewhere.has(n.id) ||
      (n.p !== null && record.has(n.p))
    )
      record.add(n.id);
  }
  const notes = new Map<string, string>();
  const note = (id: string): string => {
    let s = notes.get(id);
    if (s === undefined) {
      s = summary(t, id);
      notes.set(id, s);
    }
    return s;
  };

  const collapsed = new Map<string, string>();
  const hidden = new Set<string>();
  let total = header.length + 1 + (root ? (vis.get(root.id) ?? 0) : 0);
  for (const pass of PASSES) {
    while (total > maxChars) {
      let best: { id: string; score: number; saved: number } | null = null;
      for (const n of t.nodes) {
        if (n.p === null || collapsed.has(n.id) || hidden.has(n.id)) continue;
        if (record.has(n.id)) continue;
        const nw = w.get(n.id)!;
        const d = t.depth.get(n.id) ?? 0;
        if (d < pass.minDepth || nw.size < pass.minSize || nw.focus) continue;
        const saved =
          (vis.get(n.id) ?? 0) -
          (t.cost.get(n.id) ?? 0) -
          note(n.id).length -
          1;
        if (saved <= 0) continue;
        const below = Math.max(0, n.b[1] - vh) / vh;
        let value = 1;
        // main itself, or a wrapper holding it: collapsing it hides the page's content.
        if (nw.main) value *= 5;
        if (nw.search) value *= 3;
        if (nw.largeList) value *= 3;
        const score = (saved * (1 + 0.6 * below)) / value;
        if (!best || score > best.score) best = { id: n.id, score, saved };
      }
      if (!best) break;
      collapsed.set(best.id, note(best.id));
      const stack = [...(t.kids.get(best.id) ?? [])];
      while (stack.length) {
        const k = stack.pop()!;
        hidden.add(k);
        stack.push(...(t.kids.get(k) ?? []));
      }
      // The collapsed subtree now costs its own line plus the note.
      let p: string | null = best.id;
      while (p !== null) {
        vis.set(p, (vis.get(p) ?? 0) - best.saved);
        p = t.nodes[t.index.get(p)!]!.p;
      }
      total -= best.saved;
    }
  }

  // Render.
  const lines: string[] = [header];
  const render = (id: string, depth: number): void => {
    const n = t.nodes[t.index.get(id)!]!;
    const pad = '  '.repeat(depth);
    let text = line(n, t.exemplarElsewhere.get(id) ?? null);
    const folded = collapsed.get(id);
    if (folded !== undefined) text += ` ${folded}`;
    lines.push(pad + text);
    if (folded !== undefined) return;
    for (const k of t.kids.get(id) ?? []) {
      if (t.exemplarUnder.get(k) === id) {
        lines.push(`${pad}  exemplar:`);
        render(k, depth + 2);
      } else render(k, depth + 1);
    }
  };
  if (root) render(root.id, 0);

  // Last resort (a flat page of leaves): keep the head of the page, say what was cut.
  let out = lines.join('\n');
  if (out.length > maxChars) {
    let keep = lines.length;
    let len = out.length;
    while (keep > 2 && len > maxChars - 64) {
      keep--;
      len -= lines[keep]!.length + 1;
    }
    const cut = lines.length - keep;
    out = `${lines.slice(0, keep).join('\n')}\n…truncated: ${cut} more line${cut === 1 ? '' : 's'}`;
  }
  return out;
}
