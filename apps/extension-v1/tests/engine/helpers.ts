import type { Page } from '@playwright/test';

import type { OpId } from '@webable/core/ops/catalog';
import type {
  AdaptationPlan,
  DecisionTrace,
  PlannedOp,
} from '@webable/core/policy/types';

export type Fixture =
  | 'article'
  | 'store'
  | 'app'
  | 'clip'
  | 'shadow'
  | 'spa'
  | 'large'
  | 'csp'
  | 'dynamic'
  | 'cards'
  | 'ranks'
  | 'hydration'
  | 'shell';
export const FIXTURES: readonly Fixture[] = [
  'article',
  'store',
  'app',
  'clip',
  'shadow',
  'spa',
];

/** Words and values from the fixtures that must never appear in extraction output. */
export const PRIVATE_STRINGS = [
  'quillon',
  'vesperine',
  'zebulon',
  'quartzite',
  'marmalade',
  'private@example.com',
  '48151623',
  '127.0.0.1',
  '4173',
  'http',
  '/engine/',
  'fixture',
];

/** Load a fixture with every non-local request blocked, then inject the engine bundle. */
export async function open(
  page: Page,
  fixture: Fixture,
  prePaint: OpId[] = [],
): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.goto(`/engine/${fixture}.html`, { waitUntil: 'load' });
  await page.addScriptTag({ url: '/__engine.js' });
  await page.waitForFunction(
    () => typeof window.__webableEngine !== 'undefined',
  );
  await page.evaluate(
    (pp) => window.__webableEngine.init(pp as never[]),
    prePaint,
  );
}

export function trace(
  op: OpId,
  level: number,
  mode: 'auto' | 'offer' = 'auto',
): DecisionTrace {
  return {
    op,
    mode,
    source: 'profile',
    level,
    p: 0.9,
    pOk: 0.9,
    why: 'test',
    evidence: [],
  };
}

export interface OpSpec {
  op: OpId;
  level?: number;
  regions?: string[];
  mode?: 'auto' | 'offer';
}

export function plan(
  ops: OpSpec[],
  id = `plan-${Math.random().toString(36).slice(2)}`,
): AdaptationPlan {
  return {
    id,
    createdAt: Date.now(),
    category: 'other',
    basis: 'local',
    ops: ops.map<PlannedOp>((o) => ({
      op: o.op,
      level: o.level ?? 0,
      mode: o.mode ?? 'auto',
      scope: o.regions ? { regions: o.regions } : 'page',
      trace: trace(o.op, o.level ?? 0, o.mode ?? 'auto'),
    })),
  };
}

/**
 * Every element's tag and attributes across the document and open shadow roots
 * (WebAble's own host excluded), for exact before/after comparison.
 */
export function domState(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const visit = (root: Document | ShadowRoot, prefix: string): void => {
      const all = root.querySelectorAll('*');
      all.forEach((el, i) => {
        if (el.localName === 'webable-ui') return;
        const attrs = [...el.attributes]
          .map((a) => `${a.name}=${a.value}`)
          .sort()
          .join(' ');
        out.push(`${prefix}${i}:${el.localName}[${attrs}]`);
        if (el.shadowRoot) visit(el.shadowRoot, `${prefix}${i}/`);
      });
    };
    visit(document, '');
    return out;
  });
}

const STYLE_PROPS = [
  'font-size',
  'line-height',
  'color',
  'opacity',
  'position',
  'max-inline-size',
  'column-gap',
  'row-gap',
  'word-spacing',
  'transition-delay',
  'font-size-adjust',
  'outline-style',
] as const;

/** Computed styles of every element (and ::after) for the props ops can touch. */
export function styleState(page: Page): Promise<string[]> {
  return page.evaluate(
    (props) => {
      const out: string[] = [];
      const visit = (root: Document | ShadowRoot, prefix: string): void => {
        root.querySelectorAll('*').forEach((el, i) => {
          if (
            el.localName === 'webable-ui' ||
            /^(script|style|head|meta|title|link)$/.test(el.localName)
          )
            return;
          // Elements the page itself is animating change on their own; skip them.
          if (el.getAnimations().some((a) => a.playState === 'running')) return;
          const cs = getComputedStyle(el);
          const after = getComputedStyle(el, '::after');
          out.push(
            `${prefix}${i}:${props.map((p) => cs.getPropertyValue(p)).join('|')}|after:${after.content}|${after.position}`,
          );
          if (el.shadowRoot) visit(el.shadowRoot, `${prefix}${i}/`);
        });
      };
      visit(document, '');
      return out;
    },
    STYLE_PROPS as unknown as string[],
  );
}

/** Accessibility-relevant attributes of every element (ARIA, role, tabindex, names). */
export function a11yAttrs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const visit = (root: Document | ShadowRoot, prefix: string): void => {
      root.querySelectorAll('*').forEach((el, i) => {
        if (el.localName === 'webable-ui') return;
        const attrs = [...el.attributes]
          .filter((a) =>
            /^(aria-|role$|tabindex$|alt$|title$|hidden$|inert$|lang$|for$|id$|name$|disabled$)/.test(
              a.name,
            ),
          )
          .map((a) => `${a.name}=${a.value}`)
          .sort()
          .join(' ');
        if (attrs) out.push(`${prefix}${i}:${el.localName}[${attrs}]`);
        if (el.shadowRoot) visit(el.shadowRoot, `${prefix}${i}/`);
      });
    };
    visit(document, '');
    return out;
  });
}

/**
 * One full pass of the sequential focus order (through shadow roots), up to
 * `n` stops. Stops at the wrap-around: whether the browser inserts a
 * document-level stop there is not deterministic in headless Chrome.
 */
export async function tabOrder(page: Page, n: number): Promise<string[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.mouse.click(1, 1);
  const seen: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    seen.push(
      await page.evaluate(() => {
        let a: Element | null = document.activeElement;
        while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
        if (!a || a === document.body) return 'body';
        const label =
          a.getAttribute('aria-label') ??
          a.textContent?.trim().slice(0, 20) ??
          '';
        return `${a.localName}#${a.id}|${label}`;
      }),
    );
    const last = seen[seen.length - 1];
    if (last === 'body' || (seen.length > 1 && last === seen[0])) {
      seen.pop();
      break;
    }
  }
  return seen;
}

export async function regionKeys(
  page: Page,
): Promise<Array<{ key: string; ruleRole: string | null; zone: string }>> {
  const x = await page.evaluate(() => window.__webableEngine.extract());
  return x.signals.regions.map((r) => ({
    key: r.key,
    ruleRole: r.ruleRole,
    zone: r.zone,
  }));
}

/** What a reader sees of one text element: its size, field, and how much of it shows. */
export interface TextState {
  /** Index in document order among the page's text elements. */
  i: number;
  /** tag.classes<parentTag.parentClasses (state classes kept: exact template). */
  field: string;
  px: number;
  /** Share of the box its three nearest clipping ancestors leave visible. */
  shown: number;
  box: { left: number; top: number; right: number; bottom: number };
  /** Ids of the regions (by selector) that contain it. */
  regions: number[];
}

/**
 * Every rendered element with its own text under `scope`, read in page:
 * size, template field, visible share and box, plus which of `regions`
 * (selectors, each matching any number of containers) holds it.
 */
export function textStates(
  page: Page,
  scope: string,
  regions: string[],
): Promise<TextState[]> {
  return page.evaluate(
    ([scopeSel, regionSels]) => {
      const sig = (el: Element | null): string =>
        el ? `${el.localName}.${[...el.classList].sort().join('.')}` : '';
      const containers = (regionSels as string[]).flatMap((q) => [
        ...document.querySelectorAll(q),
      ]);
      const out: TextState[] = [];
      let i = 0;
      for (const root of document.querySelectorAll(scopeSel as string))
        for (const el of [root, ...root.querySelectorAll('*')]) {
          const own = [...el.childNodes].some(
            (n) => n.nodeType === 3 && (n.textContent ?? '').trim(),
          );
          if (!own || /^(script|style)$/.test(el.localName)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          let shown = 1;
          for (
            let n = el.parentElement, k = 0;
            n && k < 3;
            n = n.parentElement, k++
          ) {
            const cs = getComputedStyle(n);
            if (cs.overflowX === 'visible' && cs.overflowY === 'visible')
              continue;
            const nr = n.getBoundingClientRect();
            const left = Math.max(r.left, nr.left + n.clientLeft);
            const right = Math.min(
              r.right,
              nr.left + n.clientLeft + n.clientWidth,
            );
            const top = Math.max(r.top, nr.top + n.clientTop);
            const bottom = Math.min(
              r.bottom,
              nr.top + n.clientTop + n.clientHeight,
            );
            const a = Math.max(0, right - left) * Math.max(0, bottom - top);
            shown = Math.min(shown, a / (r.width * r.height));
          }
          const h = el as HTMLElement;
          if (h.scrollWidth > h.clientWidth + 1 && h.clientWidth > 0)
            shown = Math.min(shown, h.clientWidth / h.scrollWidth);
          if (h.scrollHeight > h.clientHeight + 1 && h.clientHeight > 0)
            shown = Math.min(shown, h.clientHeight / h.scrollHeight);
          out.push({
            i: i++,
            field: `${sig(el)}<${sig(el.parentElement)}`,
            px: parseFloat(getComputedStyle(el).fontSize),
            shown,
            box: {
              left: r.left,
              top: r.top + scrollY,
              right: r.right,
              bottom: r.bottom + scrollY,
            },
            regions: containers
              .map((c, k) => (c.contains(el) ? k : -1))
              .filter((k) => k >= 0),
          });
        }
      return out;
    },
    [scope, regions] as const,
  );
}

/**
 * Size-order inversions between two readings of the same elements, per
 * region: pairs natively smaller by more than half a pixel that end larger
 * by more than half a pixel. Zero inversions is Kendall tau = 1 with ties
 * allowed (docs/10 §10).
 */
export function inversions(
  before: readonly TextState[],
  after: readonly TextState[],
): string[] {
  const out: string[] = [];
  const regions = new Set(before.flatMap((t) => t.regions));
  for (const r of regions) {
    const ids = before.filter((t) => t.regions.includes(r)).map((t) => t.i);
    for (const a of ids)
      for (const b of ids) {
        const ba = before[a] as TextState;
        const bb = before[b] as TextState;
        const aa = after[a] as TextState;
        const ab = after[b] as TextState;
        if (ba.px + 0.5 < bb.px && aa.px > ab.px + 0.5)
          out.push(
            `region ${r}: ${ba.field} ${ba.px}->${aa.px} above ${bb.field} ${bb.px}->${ab.px}`,
          );
      }
  }
  return out;
}

/** Instances of one template field, at one native size, that end at different sizes. */
export function inconsistencies(
  before: readonly TextState[],
  after: readonly TextState[],
): string[] {
  const byField = new Map<string, number[]>();
  for (const t of before) {
    const key = `${t.field}@${t.px}`;
    const list = byField.get(key) ?? [];
    list.push((after[t.i] as TextState).px);
    byField.set(key, list);
  }
  const out: string[] = [];
  for (const [key, sizes] of byField)
    if (Math.max(...sizes) - Math.min(...sizes) > 0.25)
      out.push(`${key}: ${[...new Set(sizes)].join(', ')}`);
  return out;
}
