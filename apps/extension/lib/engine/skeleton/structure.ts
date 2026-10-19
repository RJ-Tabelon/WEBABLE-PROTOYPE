import { cyrb53 } from '../util/hash';

/**
 * Structure hash (Skeleton.structure): one value per site template, stable
 * across loads and across pages built from it. It covers tags, roles, kinds,
 * heading levels, input types, structural flags, nesting and collection
 * exemplars. It leaves out labels, text, boxes and counts: prose leaves are
 * skipped (outside records), runs of identical sibling subtrees count once,
 * and ad and consent subtrees, which come and go, are dropped. State flags
 * (focus, selected, expanded, bold, playing...) are left out too.
 */

export interface StructNode {
  tag: string;
  role: string | null;
  kind: string;
  level?: number;
  inputType?: string;
  flags: ReadonlySet<string>;
  kids: readonly StructNode[];
  list?: { exemplar: StructNode; itemTag: string };
  slot?: boolean;
}

/** Flags that describe the template rather than the moment. */
const STRUCTURAL_FLAGS = [
  'fixed',
  'sticky',
  'icon',
  'imgctrl',
  'headlink',
  'cliprisk',
  'overlay',
  'editable',
  'popup',
  'required',
  'hoveronly',
] as const;

function token(n: StructNode): string | null {
  if (n.flags.has('adhint') || n.flags.has('consenthint')) return null;
  if ((n.kind === 'text' || n.kind === 'stext') && !n.slot) return null;
  let s = `${n.tag}|${n.role ?? ''}|${n.kind}`;
  if (n.level) s += `|h${n.level}`;
  if (n.inputType) s += `|i:${n.inputType}`;
  const f = STRUCTURAL_FLAGS.filter((x) => n.flags.has(x));
  if (f.length) s += `|${f.join('.')}`;
  if (n.list) {
    const ex = token(n.list.exemplar);
    s += `|L:${n.list.itemTag}{${ex ?? ''}}`;
  }
  const kids: string[] = [];
  for (const k of n.kids) {
    const t = token(k);
    if (t === null) continue;
    if (kids[kids.length - 1] === t) continue;
    kids.push(t);
  }
  if (kids.length) s += `(${kids.join(',')})`;
  return s;
}

export function structureHash(root: StructNode): string {
  return `s${cyrb53(token(root) ?? '').toString(36)}`;
}
