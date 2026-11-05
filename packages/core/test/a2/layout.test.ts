import { describe, expect, test } from 'vitest';
import type { FitSpec, FitSummaryForModel, PageOutline, Role } from '../../src/types';
import {
  FitSpecSchema, fitSpecJsonSchema, FIT_SECTION_LABELS, indexOutline, outlineProtection, placementMap, repairSpec,
  sectionRenderIds, specCoverage,
} from '../../src/layout/spec';
import { heuristicSpec } from '../../src/layout/heuristic';
import { DEMO_FITS, summarizeFitForModel } from '../../src/fit/derive';
import { ALDERRA, PRODUCT, randomOutline, rng } from './fixtures';

const ROSA: FitSummaryForModel = summarizeFitForModel(DEMO_FITS.rosa);
const TYPICAL: FitSummaryForModel = summarizeFitForModel(DEMO_FITS.typical);

/** Where an id renders: itself if listed, else its nearest listed ancestor. */
function renderPlace(spec: FitSpec, outline: PageOutline, id: string): 'strip' | number | null {
  const ix = indexOutline(outline);
  const m = placementMap(spec);
  for (const x of [id, ...ix.ancestors(id)]) {
    const w = m.get(x);
    if (w !== undefined) return w;
  }
  return null;
}

function invariants(spec: FitSpec, outline: PageOutline, roles: Record<string, Role> = {}): void {
  const ix = indexOutline(outline);
  const listed = [...spec.strip, ...spec.sections.flatMap((s) => s.nodes)];
  for (const id of listed) expect(ix.nodes.has(id), `unknown id ${id}`).toBe(true);
  expect(new Set(listed).size, 'duplicate ids').toBe(listed.length);
  expect(specCoverage(spec, outline).missing).toEqual([]);
  if (spec.primary_action) {
    expect(['button', 'link']).toContain(ix.kind(spec.primary_action));
    const prim = spec.sections.filter((s) => s.role === 'primary');
    expect(prim).toHaveLength(1);
    expect(prim[0]?.state).toBe('open');
    expect(renderPlace(spec, outline, spec.primary_action)).toBe(spec.sections.indexOf(prim[0]!));
  }
  expect(spec.sections.filter((s) => s.emphasis === 'lead').length).toBeLessThanOrEqual(1);
  // A protected node renders open: where it (or its nearest listed ancestor) is listed, or, for a container
  // placed through its children, every child renders open.
  const renderedOpen = (id: string): boolean => {
    const at = renderPlace(spec, outline, id);
    if (at === 'strip') return true;
    if (at != null) return spec.sections[at]?.state === 'open';
    const kids = ix.children.get(id) ?? [];
    return kids.length > 0 && kids.every(renderedOpen);
  };
  for (const id of ix.nodes.keys()) {
    if (!outlineProtection(ix, id, roles)) continue;
    expect(renderedOpen(id), `protected ${id} is folded or unplaced`).toBe(true);
  }
  const stepFields = spec.form_steps.flatMap((s) => s.fields);
  expect(new Set(stepFields).size).toBe(stepFields.length);
  for (const f of stepFields) expect(['field', 'select', 'checkbox', 'radio']).toContain(ix.kind(f));
  for (const s of spec.sections) if (s.layout === 'buy_box') expect(spec.page_type).toBe('product_detail');
  for (const s of spec.sections) expect(s.nodes.length).toBeGreaterThan(0);
}

describe('FitSpec schema', () => {
  test('the strict JSON schema requires every property and forbids extras at every object level', () => {
    const walk = (node: unknown, path: string): void => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (o.type === 'object') {
        expect(o.additionalProperties, path).toBe(false);
        expect([...(o.required as string[])].sort(), path).toEqual(Object.keys(o.properties as object).sort());
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(fitSpecJsonSchema, '$');
    const props = (fitSpecJsonSchema.properties as Record<string, Record<string, unknown>>);
    expect((props.sections?.items as { properties: { label: { enum: string[] } } }).properties.label.enum).toEqual([...FIT_SECTION_LABELS]);
  });

  test('zod accepts a valid spec and rejects bad ids, enums and limits', () => {
    const ok: FitSpec = {
      page_type: 'form', task: 'fill_form', strip: ['n1'], primary_action: 'n9', density: 'airy',
      sections: [{ heading_ref: null, label: 'Overview', role: 'primary', nodes: ['n2'], layout: 'as_is', emphasis: 'lead', state: 'open', why: 'main_task', show_first: 0 }],
      form_steps: [{ label: 'Your details', fields: ['n3'] }],
    };
    expect(FitSpecSchema.safeParse(ok).success).toBe(true);
    expect(FitSpecSchema.safeParse({ ...ok, strip: ['x1'] }).success).toBe(false);
    expect(FitSpecSchema.safeParse({ ...ok, page_type: 'shop' }).success).toBe(false);
    expect(FitSpecSchema.safeParse({ ...ok, sections: [] }).success).toBe(false);
    expect(FitSpecSchema.safeParse({ ...ok, sections: [{ ...ok.sections[0], show_first: 5 }] }).success).toBe(false);
    expect(FitSpecSchema.safeParse({ ...ok, strip: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'] }).success).toBe(false);
  });
});

describe('repairSpec', () => {
  const sec = (nodes: string[], extra: Partial<FitSpec['sections'][number]> = {}): FitSpec['sections'][number] => ({
    heading_ref: null, label: 'Details', role: 'supporting', nodes, layout: 'as_is', emphasis: 'normal', state: 'open', why: 'reference_info', show_first: 0, ...extra,
  });

  test('drops unknown and duplicate ids, places every node, keeps help and consent open', () => {
    const bad: FitSpec = {
      page_type: 'form', task: 'fill_form', strip: ['n9', 'n999'], primary_action: 'n48', density: 'comfortable', form_steps: [],
      sections: [
        sec(['n28', 'n29', 'n30', 'n48', 'n48'], { role: 'primary', label: 'Overview', emphasis: 'lead', why: 'main_task' }),
        sec(['n57', 'n65'], { state: 'end_drawer', label: 'More on this page' }),
        sec(['n37'], { emphasis: 'lead' }),
      ],
    };
    const { spec, repairs } = repairSpec(bad, ALDERRA, { fit: ROSA });
    invariants(spec, ALDERRA);
    expect(repairs.some((r) => r.startsWith('unknown_id'))).toBe(true);
    expect(repairs.some((r) => r.startsWith('duplicate_id'))).toBe(true);
    expect(repairs.some((r) => r.startsWith('coverage'))).toBe(true);
    // The footer's "Contact us" was folded with the footer: it is lifted into view.
    const contact = renderPlace(spec, ALDERRA, 'n59');
    expect(contact === 'strip' || spec.sections[contact as number]?.state === 'open').toBe(true);
    // The cookie banner is open, drawn as the site does.
    const cookies = spec.sections[renderPlace(spec, ALDERRA, 'n65') as number];
    expect(cookies?.state).toBe('open');
    expect(FitSpecSchema.safeParse(spec).success).toBe(true);
  });

  test('a primary action that is not a button or link is replaced by the page\'s real one', () => {
    const bad: FitSpec = {
      page_type: 'form', task: 'fill_form', strip: [], primary_action: 'n31', density: 'airy', form_steps: [],
      sections: [sec(['n27'], { role: 'primary', label: 'Overview' })],
    };
    const { spec } = repairSpec(bad, ALDERRA, { roles: {} });
    expect(spec.primary_action).toBe('n48');
    invariants(spec, ALDERRA);
  });

  test('a primary action folded into the end drawer is moved into the main section', () => {
    const bad: FitSpec = {
      page_type: 'form', task: 'fill_form', strip: [], primary_action: 'n48', density: 'airy', form_steps: [],
      sections: [
        sec(['n28', 'n30', 'n37'], { role: 'primary', label: 'Overview' }),
        sec(['n48', 'n47'], { state: 'end_drawer', label: 'More on this page' }),
      ],
    };
    const { spec } = repairSpec(bad, ALDERRA);
    invariants(spec, ALDERRA);
    expect(spec.sections.find((s) => s.role === 'primary')?.nodes).toContain('n48');
  });

  test('form steps keep page order, include every field once and respect the step limit', () => {
    const bad: FitSpec = {
      page_type: 'form', task: 'fill_form', strip: [], primary_action: 'n48', density: 'airy',
      form_steps: [{ label: 'Delivery and returns', fields: ['n40', 'n38', 'n38', 'n7'] }],
      sections: [sec(['n27'], { role: 'primary', label: 'Overview', layout: 'form_steps' })],
    };
    const { spec } = repairSpec(bad, ALDERRA, { fit: ROSA });
    invariants(spec, ALDERRA);
    const fields = spec.form_steps.flatMap((s) => s.fields);
    expect(fields).not.toContain('n7'); // the header search is not part of the form
    expect([...fields].sort()).toEqual(['n31', 'n32', 'n33', 'n38', 'n39', 'n40'].sort());
    const ix = indexOutline(ALDERRA);
    const order = fields.map((f) => ix.order.get(f) ?? 0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const s of spec.form_steps) expect(s.fields.length).toBeLessThanOrEqual(5);
  });

  test('fit limits fold extra open sections (reviews before details) and cap list previews', () => {
    const many: FitSpec = {
      page_type: 'product_detail', task: 'buy', strip: [], primary_action: 'n22', density: 'airy', form_steps: [],
      sections: [
        sec(['n14'], { role: 'primary', label: 'Buy', layout: 'buy_box' }),
      ],
    };
    // Split main into its children so there are many sections.
    const ix = indexOutline(PRODUCT);
    const kids = ix.children.get('n14') ?? [];
    many.sections = [
      sec(kids.filter((k) => ['n15', 'n18', 'n19', 'n20', 'n21', 'n22'].includes(k)), { role: 'primary', label: 'Buy', layout: 'buy_box' }),
      sec(['n23', 'n24'], { role: 'reference', label: 'Details', layout: 'reading' }),
      sec(['n25', 'n26'], { role: 'reference', label: 'Specifications', layout: 'facts' }),
      sec(['n29', 'n30'], { role: 'social_proof', label: 'Reviews', layout: 'row_list', show_first: 12 }),
      sec(['n31', 'n32'], { role: 'social_proof', label: 'Questions', layout: 'row_list' }),
      sec(['n33'], { role: 'ads', label: 'Sponsored', layout: 'card_grid' }),
      sec(['n35', 'n36'], { role: 'related', label: 'Related items', layout: 'card_grid' }),
    ];
    const { spec } = repairSpec(many, PRODUCT, { fit: ROSA });
    invariants(spec, PRODUCT);
    const openContent = spec.sections.filter((s) => s.state === 'open' && !['orient', 'alert', 'consent', 'help'].includes(s.role));
    // Warnings are protected and may add one open section beyond the limit of 3.
    expect(openContent.length).toBeLessThanOrEqual(4);
    expect(spec.sections.find((s) => s.label === 'Sponsored')?.state).toBe('end_drawer');
    expect(spec.sections.find((s) => s.label === 'Reviews')?.state).not.toBe('open');
    for (const s of spec.sections) if (s.layout === 'row_list' || s.layout === 'card_grid') expect([3, 4]).toContain(s.show_first);
    // Safety text under "Warnings" stays open.
    expect(spec.sections[renderPlace(spec, PRODUCT, 'n28') as number]?.state).toBe('open');
  });

  test('fuzz: random outlines and random specs always repair to a valid, complete spec', () => {
    const r = rng(7);
    for (let t = 0; t < 120; t++) {
      const outline = randomOutline(1000 + t, 10 + Math.floor(r() * 70), t % 5 === 0);
      const ids = outline.nodes.map((n) => n.id);
      const anyId = (): string => (r() < 0.1 ? `n${900 + Math.floor(r() * 99)}` : (ids[Math.floor(r() * ids.length)] as string));
      const nSec = 1 + Math.floor(r() * 6);
      const states = ['open', 'collapsed', 'end_drawer'] as const;
      const roles = ['primary', 'supporting', 'ads', 'promo', 'help', 'consent', 'other'] as const;
      const spec: FitSpec = {
        page_type: r() < 0.3 ? 'product_detail' : 'form',
        task: 'other',
        strip: Array.from({ length: Math.floor(r() * 8) }, anyId),
        sections: Array.from({ length: nSec }, () => sec(Array.from({ length: 1 + Math.floor(r() * 8) }, anyId), {
          state: states[Math.floor(r() * 3)], role: roles[Math.floor(r() * roles.length)], emphasis: r() < 0.4 ? 'lead' : 'normal',
          layout: r() < 0.3 ? 'buy_box' : r() < 0.5 ? 'form_steps' : 'row_list', show_first: 12,
        })),
        primary_action: r() < 0.7 ? anyId() : null,
        form_steps: r() < 0.5 ? [{ label: 'Your details', fields: Array.from({ length: 3 }, anyId) }] : [],
        density: 'airy',
      };
      const fit = t % 2 ? ROSA : TYPICAL;
      const out = repairSpec(spec, outline, { fit }).spec;
      invariants(out, outline);
      // Idempotent: repairing a repaired spec changes nothing that matters.
      const again = repairSpec(out, outline, { fit });
      invariants(again.spec, outline);
      if (out.sections.every((s) => s.nodes.length <= 40) && out.sections.length <= 12) {
        expect(FitSpecSchema.safeParse(out).success, JSON.stringify(FitSpecSchema.safeParse(out).error?.issues?.[0])).toBe(true);
      }
    }
  });
});

describe('heuristicSpec', () => {
  test('Alderra: Confirm refill is the primary action, offers fold, help and cookies stay open, every node placed', () => {
    const t0 = performance.now();
    const spec = heuristicSpec(ALDERRA, {}, ROSA);
    const ms = performance.now() - t0;
    invariants(spec, ALDERRA);
    expect(FitSpecSchema.safeParse(spec).success).toBe(true);
    expect(ms).toBeLessThan(50);
    expect(spec.primary_action).toBe('n48');
    expect(spec.page_type).toBe('form');
    expect(spec.task).toBe('fill_form');
    expect(spec.density).toBe('airy');
    // Strip: search, account, cart and one help control.
    expect(spec.strip).toEqual(expect.arrayContaining(['n7', 'n9', 'n10']));
    expect(spec.strip.length).toBeLessThanOrEqual(6);
    // Promotions, the carousel, recommendations and ads all go to the end drawer.
    for (const id of ['n1', 'n21', 'n34', 'n42', 'n51', 'n54', 'n56']) {
      expect(spec.sections[renderPlace(spec, ALDERRA, id) as number]?.state, id).toBe('end_drawer');
    }
    // The help link next to the task stays in the main section; the cookie banner is open.
    const prim = spec.sections.findIndex((s) => s.role === 'primary');
    expect(renderPlace(spec, ALDERRA, 'n50')).toBe(prim);
    expect(spec.sections[renderPlace(spec, ALDERRA, 'n65') as number]?.role).toBe('consent');
    expect(spec.sections[prim]?.emphasis).toBe('lead');
    expect(spec.sections[prim]?.layout).toBe('form_steps');
    // Two steps (prescriptions, then pickup), page order, ≤ 5 fields each.
    expect(spec.form_steps.map((s) => s.fields)).toEqual([['n31', 'n32', 'n33'], ['n38', 'n39', 'n40']]);
    expect(spec.form_steps[1]?.label).toBe('Delivery and returns');
    // The upsell button inside the form is not rendered with the form.
    expect(sectionRenderIds(spec, ALDERRA, prim)).not.toContain('n36');
    // Navigation is collapsed.
    expect(spec.sections[renderPlace(spec, ALDERRA, 'n11') as number]?.state).toBe('collapsed');
  });

  test('Alderra with Jev roles from the decisions map gives the same task section', () => {
    const roles: Record<string, Role> = { n47: 'action_button', n48: 'action_button', n34: 'advertising', n70: 'help_contact' };
    const spec = heuristicSpec(ALDERRA, roles, TYPICAL);
    invariants(spec, ALDERRA, roles);
    expect(spec.primary_action).toBe('n48');
    expect(spec.density).toBe('comfortable');
  });

  test('product page: buy box first, safety open, reviews folded, sponsored and related in the end drawer', () => {
    const spec = heuristicSpec(PRODUCT, {}, ROSA);
    invariants(spec, PRODUCT);
    expect(FitSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.page_type).toBe('product_detail');
    expect(spec.task).toBe('buy');
    expect(spec.primary_action).toBe('n22');
    const prim = spec.sections.find((s) => s.role === 'primary');
    expect(prim?.layout).toBe('buy_box');
    expect(spec.form_steps).toEqual([]);
    expect(spec.strip).toEqual(expect.arrayContaining(['n3', 'n5', 'n6']));
    expect(spec.sections[renderPlace(spec, PRODUCT, 'n28') as number]?.state).toBe('open');
    expect(spec.sections[renderPlace(spec, PRODUCT, 'n30') as number]?.state).toBe('collapsed');
    expect(spec.sections[renderPlace(spec, PRODUCT, 'n33') as number]?.state).toBe('end_drawer');
    expect(spec.sections[renderPlace(spec, PRODUCT, 'n36') as number]?.state).toBe('end_drawer');
    expect(spec.sections[renderPlace(spec, PRODUCT, 'n43') as number]?.state).toBe('open');
    const help = renderPlace(spec, PRODUCT, 'n38');
    expect(help === 'strip' || spec.sections[help as number]?.state === 'open').toBe(true);
  });

  test('structure level 0 keeps more open', () => {
    const level0 = heuristicSpec(PRODUCT, {}, { ...TYPICAL, structure_level: 0 });
    const level2 = heuristicSpec(PRODUCT, {}, ROSA);
    const open = (s: FitSpec): number => s.sections.filter((x) => x.state === 'open').length;
    expect(open(level0)).toBeGreaterThan(open(level2));
    invariants(level0, PRODUCT);
  });

  test('places every node on random tree and flat outlines', () => {
    for (let t = 0; t < 80; t++) {
      const outline = randomOutline(5000 + t, 5 + (t * 7) % 90, t % 3 === 0);
      const spec = heuristicSpec(outline, {}, t % 2 ? ROSA : TYPICAL);
      invariants(spec, outline);
    }
  });

  test('deterministic', () => {
    expect(heuristicSpec(ALDERRA, {}, ROSA)).toEqual(heuristicSpec(ALDERRA, {}, ROSA));
  });
});
