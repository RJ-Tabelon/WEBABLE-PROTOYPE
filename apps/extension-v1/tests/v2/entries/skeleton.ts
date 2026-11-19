/**
 * v2 skeleton harness (WP3a): reads the page with the real content-script
 * modules and exposes window.__v2skeleton for Playwright. The read runs in
 * the page's main world here (in the extension it runs in the isolated
 * world); every method returns plain serializable data. The last read's
 * registry is kept so a spec can mutate the page and ask it again.
 */
import { vocabFilter } from '@webable/core/page/vocab';
import type { Locator, Skeleton } from '@webable/core/skeleton/types';

import { extract } from '../../../lib/engine/extract';
import type {
  MediaInfo,
  SkeletonRegistry,
} from '../../../lib/engine/fitview/types';
import { readSkeleton, regionKeysOf } from '../../../lib/engine/skeleton';

interface Described {
  tag: string;
  qa: string | null;
  id: string | null;
  text: string;
}

interface ReadOptions {
  regionKeys?: boolean;
  budgetMs?: number;
  maxNodes?: number;
  sliceMs?: number;
}

let registry: SkeletonRegistry | null = null;
let skeleton: Skeleton | null = null;

function describe(el: Element | null): Described | null {
  if (!el) return null;
  return {
    tag: el.localName,
    qa: el.getAttribute('data-qa'),
    id: el.id || null,
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
  };
}

function need(): SkeletonRegistry {
  if (!registry) throw new Error('no skeleton read yet');
  return registry;
}

function q(selector: string): Element {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  return el;
}

const port = { vocabFilter };

const api = {
  async read(opts: ReadOptions = {}) {
    let regionKeys: Map<Element, string> | undefined;
    if (opts.regionKeys) {
      const x = await extract(document, { vocab: port });
      regionKeys = regionKeysOf(x.facts);
    }
    let measuredCalls = 0;
    let yields = 0;
    const res = await readSkeleton(document, {
      regionKeys,
      budgetMs: opts.budgetMs,
      maxNodes: opts.maxNodes,
      sliceMs: opts.sliceMs,
      measured: <T>(fn: () => T): T => {
        measuredCalls++;
        return fn();
      },
      yieldMain: async () => {
        yields++;
        await new Promise((r) => setTimeout(r, 0));
      },
    });
    registry = res?.registry ?? null;
    skeleton = res?.skeleton ?? null;
    if (!res) return null;
    const elements: Record<string, Described | null> = {};
    for (const n of res.skeleton.nodes)
      elements[n.id] = describe(res.registry.element(n.id));
    return {
      skeleton: res.skeleton,
      registryId: res.registry.extractionId,
      elements,
      measuredCalls,
      yields,
    };
  },
  /** LayoutFeatures from the v1 extraction pass (PageSignals.layout). */
  async features() {
    const x = await extract(document, { vocab: port });
    return {
      layout: x.signals.layout ?? null,
      perf: x.perf,
      mainFontPx: x.signals.text.mainFontPx,
      forms: x.signals.forms,
    };
  },
  element(id: string) {
    return describe(need().element(id));
  },
  members(listId: string) {
    return need().members(listId).map(describe);
  },
  keys(listId: string) {
    const r = need();
    return r.members(listId).map((m) => r.recordKey(listId, m));
  },
  fingerprints(listId: string) {
    const r = need();
    return r.members(listId).map((m) => r.fingerprint(listId, m));
  },
  /** One slot of member `index` (current order). */
  slot(listId: string, index: number, slotId: string) {
    const r = need();
    const m = r.members(listId)[index];
    return m ? describe(r.slot(listId, m, slotId)) : null;
  },
  /** Every slot of every member, as visible text (or the name of an action). */
  slotTexts(listId: string, slotId: string) {
    const r = need();
    return r.members(listId).map((m) => {
      const el = r.slot(listId, m, slotId);
      return el ? r.text(el) || r.name(el) : null;
    });
  },
  text(selector: string) {
    return need().text(q(selector));
  },
  name(selector: string) {
    return need().name(q(selector));
  },
  media(selector: string): MediaInfo {
    return need().media(q(selector));
  },
  href(selector: string) {
    return need().href(q(selector));
  },
  locator(id: string): Locator {
    return need().locator(id);
  },
  resolve(locator: Locator, within?: string) {
    return describe(
      need().resolve(locator, within ? document.querySelector(within) : null),
    );
  },
  /** Resolve a slot locator inside member `index` of a list. */
  resolveInMember(locator: Locator, listId: string, index: number) {
    const r = need();
    const m = r.members(listId)[index];
    return m ? describe(r.resolve(locator, m)) : null;
  },
  lastSkeleton() {
    return skeleton;
  },
};

declare global {
  interface Window {
    __v2skeleton: typeof api;
  }
}

window.__v2skeleton = api;
