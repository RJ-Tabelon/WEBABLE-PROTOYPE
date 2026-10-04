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
  | 'dynamic';
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
