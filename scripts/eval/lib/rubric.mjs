/**
 * Rubric for page specs against a hand-labelled answer key (answer-key.mjs),
 * resolved to node ids of a frozen skeleton. Scores the validated spec (what
 * Fit view renders), for the heuristic and the planner alike:
 *
 *   page type    the spec's page_type is one of the key's accepted types
 *   primary      the primary section covers the true main content
 *                (1; 0.5 when it is a much larger wrapper or only part of it)
 *   search       the site search is a search section (1), shown in another
 *                section (0.5), or folded away (0)
 *   navigation   each key nav block sits in a navigation-like section (1),
 *                another shown section (0.5), or folded (0)
 *   records      each key list is a collection (0.5) whose title slot is
 *                mapped to the title role or opens the item (+0.5)
 *   clutter      each key clutter block is folded
 *
 * The score is the mean of the criteria that apply to the page, out of 5.
 */

const CONTENT = new Set([
  'heading',
  'control',
  'input',
  'text',
  'stext',
  'table',
  'collection',
  'media',
]);
const NAV_KINDS = new Set([
  'primary_nav',
  'secondary_nav',
  'header',
  'breadcrumbs',
  'tabs',
  'filters',
  'sort_and_view',
]);

export function makeIndex(skeleton) {
  const byId = new Map(skeleton.nodes.map((n) => [n.id, n]));
  const kids = new Map();
  for (const n of skeleton.nodes) {
    if (n.parent === null) continue;
    const list = kids.get(n.parent) ?? [];
    list.push(n.id);
    kids.set(n.parent, list);
  }
  const ancestors = (id) => {
    const out = [];
    for (
      let p = byId.get(id)?.parent ?? null;
      p;
      p = byId.get(p)?.parent ?? null
    )
      out.push(p);
    return out;
  };
  const subtree = (id) => {
    const out = new Set();
    const stack = [id];
    while (stack.length) {
      const x = stack.pop();
      if (out.has(x)) continue;
      out.add(x);
      for (const k of kids.get(x) ?? []) stack.push(k);
    }
    return out;
  };
  const area = (id) => {
    const b = byId.get(id)?.box;
    return b ? Math.max(1, b[2] * b[3]) : 1;
  };
  return { byId, kids, ancestors, subtree, area };
}

/** Ids covered by a list of section ids (each id with its subtree). */
function covered(index, ids) {
  const out = new Set();
  for (const id of ids) for (const x of index.subtree(id)) out.add(x);
  return out;
}

/** The section (index) that holds a node, or -1 (rest or nowhere). */
function sectionOf(index, spec, id) {
  const anc = new Set([id, ...index.ancestors(id)]);
  return spec.sections.findIndex((s) => s.node_ids.some((x) => anc.has(x)));
}

function contentNodes(index, ids) {
  return [...ids].filter(
    (x) => CONTENT.has(index.byId.get(x)?.kind) && !index.byId.get(x)?.slot,
  );
}

export function primaryScore(index, validated, main) {
  if (!main || !index.byId.has(main)) return null;
  const sec = validated.spec.sections[validated.primary];
  if (!sec) return 0;
  const P = sec.node_ids;
  const mainAnc = new Set(index.ancestors(main));
  for (const p of P) {
    if (p === main) return 1;
    if (mainAnc.has(p)) return index.area(p) > 1.6 * index.area(main) ? 0.5 : 1;
  }
  const inside = P.filter((p) => index.ancestors(p).includes(main));
  if (!inside.length) return 0;
  const all = contentNodes(index, index.subtree(main));
  const got = new Set(contentNodes(index, covered(index, inside)));
  const share = all.length ? got.size / all.length : 0;
  return share >= 0.5 ? 0.75 : 0.5;
}

export function score(validated, skeleton, key) {
  if (!validated || !key?.ids) return null;
  const index = makeIndex(skeleton);
  const spec = validated.spec;
  const ids = key.ids;
  const crit = {};
  const folded = (i) => i >= 0 && spec.sections[i].importance === 'fold';

  crit.pageType = key.pageTypes?.length
    ? key.pageTypes.includes(spec.page_type)
      ? 1
      : 0
    : null;
  crit.primary = primaryScore(index, validated, ids.main);

  if (ids.search && index.byId.has(ids.search)) {
    const i = sectionOf(index, spec, ids.search);
    crit.search =
      i < 0 || folded(i) ? 0 : spec.sections[i].kind === 'search' ? 1 : 0.5;
  } else crit.search = null;

  const navIds = (ids.nav ?? []).filter((x) => index.byId.has(x));
  crit.nav = navIds.length
    ? navIds
        .map((n) => {
          const i = sectionOf(index, spec, n);
          if (i < 0 || folded(i)) return 0;
          return NAV_KINDS.has(spec.sections[i].kind) ? 1 : 0.5;
        })
        .reduce((a, b) => a + b, 0) / navIds.length
    : null;

  const lists = (ids.lists ?? []).filter((l) => l.id && index.byId.has(l.id));
  crit.records = lists.length
    ? lists
        .map((l) => {
          const c = spec.collections.find((x) => x.list_id === l.id);
          if (!c) return 0;
          const i = sectionOf(index, spec, l.id);
          if (i >= 0 && folded(i)) return 0;
          if (!l.title) return 1;
          const near = (slot) =>
            slot === l.title ||
            index.ancestors(slot).includes(l.title) ||
            index.ancestors(l.title).includes(slot);
          const titled =
            c.fields.some((f) => f.role === 'title' && near(f.slot_id)) ||
            (c.open_slot !== null && near(c.open_slot));
          return titled ? 1 : 0.5;
        })
        .reduce((a, b) => a + b, 0) / lists.length
    : null;

  const clutter = (ids.clutter ?? []).filter((x) => index.byId.has(x));
  crit.clutter = clutter.length
    ? clutter
        .map((c) => (folded(sectionOf(index, spec, c)) ? 1 : 0))
        .reduce((a, b) => a + b, 0) / clutter.length
    : null;

  const applied = Object.values(crit).filter((x) => x !== null);
  const total = applied.length
    ? (applied.reduce((a, b) => a + b, 0) / applied.length) * 5
    : null;
  return {
    criteria: crit,
    score: total === null ? null : Math.round(total * 100) / 100,
  };
}

/** Agreement between two validated specs for one skeleton. */
export function agreement(a, b, skeleton) {
  if (!a || !b) return null;
  const index = makeIndex(skeleton);
  const prim = (v) => {
    const s = v.spec.sections[v.primary];
    return new Set(contentNodes(index, covered(index, s ? s.node_ids : [])));
  };
  const pa = prim(a);
  const pb = prim(b);
  const inter = [...pa].filter((x) => pb.has(x)).length;
  const union = new Set([...pa, ...pb]).size;
  const jaccard = union ? inter / union : 0;
  return {
    pageType: a.spec.page_type === b.spec.page_type,
    primaryKind:
      a.spec.sections[a.primary]?.kind === b.spec.sections[b.primary]?.kind,
    primaryJaccard: Math.round(jaccard * 100) / 100,
    primaryAgree: jaccard >= 0.5,
  };
}
