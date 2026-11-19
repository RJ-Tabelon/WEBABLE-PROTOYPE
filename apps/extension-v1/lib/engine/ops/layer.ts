import { OP_IDS, type OpId } from '@webable/core/ops/catalog';

import type { TreeScope } from '../util/dom';
import { tokenOp, tokensOf } from './marks';

/**
 * One constructed stylesheet per tree scope (the document and each open shadow
 * root), adopted last so it follows the page's sheets in cascade order. Rule
 * blocks are keyed by op, so removing an op is dropping its block
 * (engine.md 3.2). The sheet is invisible to DOM snapshots and cannot be
 * removed except by reassigning adoptedStyleSheets, which the watchdog repairs.
 */

export interface OpCss {
  /** Rules for the document scope. */
  doc?: string;
  /** Rules for every shadow-root scope (defaults to `doc`). */
  shadow?: string;
}

interface Adopter {
  adoptedStyleSheets: CSSStyleSheet[];
}

// Expose host styles synchronously while measuring; restore before every yield.
const MEASURED_OPS = new Set<string>([
  'text_floor',
  'line_spacing',
  'line_length',
  'contrast',
  'target_size',
  'target_spacing',
  'dim_distractions',
  'focus_view',
  'unpin_bars',
  'calm_motion',
]);

// CSS transitions outrank even !important declarations. Reading the baseline
// can otherwise start a transition from the fit to the host style (and back),
// so both the measurements and the next painted frame see interpolated values.
const TRANSITION_PROPS: Partial<Record<OpId, readonly string[]>> = {
  text_floor: ['font-size', 'font-size-adjust', 'line-height'],
  line_spacing: ['line-height', 'word-spacing'],
  line_length: ['max-inline-size', 'max-width', 'max-height'],
  contrast: ['color'],
  target_size: ['inset', 'top', 'right', 'bottom', 'left', 'opacity'],
  target_spacing: ['column-gap', 'row-gap'],
  dim_distractions: ['opacity'],
  focus_view: ['opacity'],
  unpin_bars: ['position'],
};

/**
 * Cascade order is the catalog order, never insertion order. A counterfactual
 * read removes and re-adds an op's block; if that moved it to the end, which
 * of two equally specific rules wins (text_floor's line-height safety net or
 * line_spacing's line height) would depend on verification history.
 */
const RANK = new Map<string, number>(OP_IDS.map((op, i) => [op, i]));
const rank = (key: string): number => RANK.get(key) ?? OP_IDS.length;

/** Properties that inherit: a marked ancestor changes them on descendants too. */
const INHERITED = new Set([
  'font-size',
  'font-size-adjust',
  'line-height',
  'word-spacing',
  'color',
]);

/** Ops that own `property` on `el`, directly or (inherited properties) through a marked ancestor. */
function owns(el: Element, property: string): boolean {
  let n: Element | null = el;
  for (let depth = 0; n && depth < 5; depth++, n = n.parentElement) {
    if (depth > 0 && !INHERITED.has(property)) return false;
    for (const token of tokensOf(n)) {
      const op = tokenOp(token);
      if (op && TRANSITION_PROPS[op]?.includes(property)) return true;
    }
  }
  return false;
}

/** Cancel CSS transitions of properties WebAble controls on these animations. */
function cancelOwned(animations: readonly Animation[]): void {
  for (const animation of animations) {
    const property = (animation as Animation & { transitionProperty?: string })
      .transitionProperty;
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (!property || !(target instanceof Element)) continue;
    if (!owns(target, property)) continue;
    // cancel exposes the underlying CSS value immediately; finish would
    // leave a transition filling with the value from the previous phase.
    animation.cancel();
  }
}

class StyleLayer {
  readonly sheet: CSSStyleSheet;
  private readonly blocks = new Map<string, string>();
  private dirty = false;
  private measuring = false;

  constructor(
    readonly scope: TreeScope,
    readonly kind: 'doc' | 'shadow',
  ) {
    this.sheet = new CSSStyleSheet();
  }

  get attached(): boolean {
    return (this.scope as unknown as Adopter).adoptedStyleSheets.includes(
      this.sheet,
    );
  }

  attach(): boolean {
    const s = this.scope as unknown as Adopter;
    if (s.adoptedStyleSheets.includes(this.sheet)) return false;
    const list = s.adoptedStyleSheets as CSSStyleSheet[] & {
      push?: (x: CSSStyleSheet) => number;
    };
    try {
      list.push(this.sheet);
    } catch {
      s.adoptedStyleSheets = [...s.adoptedStyleSheets, this.sheet];
    }
    return true;
  }

  detach(): void {
    const s = this.scope as unknown as Adopter;
    if (!s.adoptedStyleSheets.includes(this.sheet)) return;
    s.adoptedStyleSheets = s.adoptedStyleSheets.filter((x) => x !== this.sheet);
  }

  set(key: string, css: string): void {
    if (this.blocks.get(key) === css) return;
    if (css) this.blocks.set(key, css);
    else this.blocks.delete(key);
    this.dirty = true;
  }

  drop(key: string): void {
    if (this.blocks.delete(key)) this.dirty = true;
  }

  get empty(): boolean {
    return this.blocks.size === 0;
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.sheet.replaceSync(
      [...this.blocks]
        .filter(([key]) => !this.measuring || !MEASURED_OPS.has(key))
        .sort(([a], [b]) => rank(a) - rank(b))
        .map(([, css]) => css)
        .join('\n'),
    );
    if (this.blocks.size > 0) this.attach();
  }

  measure(on: boolean): void {
    if (this.measuring === on) return;
    this.measuring = on;
    this.dirty = true;
    this.flush();
  }
}

export class LayerManager {
  private readonly layers = new Map<TreeScope, StyleLayer>();
  private readonly blocks = new Map<string, OpCss>();
  private reattachLog: number[] = [];
  private backoffUntil = 0;

  constructor(private readonly doc: Document) {
    this.layers.set(doc, new StyleLayer(doc, 'doc'));
  }

  /** Register a shadow root and replay every current block into it. */
  addScope(root: ShadowRoot): void {
    if (this.layers.has(root)) return;
    const layer = new StyleLayer(root, 'shadow');
    this.layers.set(root, layer);
    for (const [key, css] of this.blocks)
      layer.set(key, css.shadow ?? css.doc ?? '');
    layer.flush();
  }

  scopes(): TreeScope[] {
    return [...this.layers.keys()];
  }

  /** Stage a block for `key` (usually an op id). Takes effect on flush(). */
  set(key: OpId | string, css: OpCss): void {
    this.blocks.set(key, css);
    for (const layer of this.layers.values()) {
      layer.set(
        key,
        layer.kind === 'doc' ? (css.doc ?? '') : (css.shadow ?? css.doc ?? ''),
      );
    }
  }

  drop(key: OpId | string): void {
    this.blocks.delete(key);
    for (const layer of this.layers.values()) layer.drop(key);
  }

  has(key: string): boolean {
    return this.blocks.has(key);
  }

  /** One replaceSync per changed layer: the single write of a batch. */
  flush(): void {
    for (const layer of this.layers.values()) layer.flush();
  }

  /** Synchronously expose host styles for measurements, then restore them. */
  measure(on: boolean): void {
    for (const layer of this.layers.values()) layer.measure(on);
    this.finishOwnedTransitions();
  }

  /** Counterfactual layout read. Restore every sheet before returning/yielding. */
  without<T>(ops: readonly OpId[], read: () => T): T {
    for (const layer of this.layers.values())
      for (const op of ops) layer.drop(op);
    this.flush();
    this.finishOwnedTransitions();
    try {
      return read();
    } finally {
      for (const op of ops) {
        const css = this.blocks.get(op);
        if (!css) continue;
        for (const layer of this.layers.values())
          layer.set(
            op,
            layer.kind === 'doc'
              ? (css.doc ?? '')
              : (css.shadow ?? css.doc ?? ''),
          );
      }
      this.flush();
      this.finishOwnedTransitions();
    }
  }

  /**
   * Finish only transitions of properties WebAble currently controls,
   * including inherited ones on descendants of marked elements (a link with
   * `transition: all` inside an enlarged paragraph must not animate its size).
   */
  finishOwnedTransitions(): void {
    for (const scope of this.layers.keys()) {
      // getAnimations forces the style update that creates CSS transitions.
      cancelOwned(
        (
          scope as TreeScope & { getAnimations?: () => Animation[] }
        ).getAnimations?.() ?? [],
      );
    }
  }

  /**
   * The same, for just these elements and their subtrees: what was marked
   * inside a MutationObserver callback, where a document-wide scan is too much.
   */
  finishTransitionsOn(els: Iterable<Element>): void {
    for (const el of els) {
      if (!el.isConnected) continue;
      try {
        cancelOwned(el.getAnimations({ subtree: true }));
      } catch {
        // getAnimations({subtree}) unsupported: the next full pass covers it.
      }
    }
  }

  /**
   * Re-adopt sheets the page removed (frameworks that reassign
   * adoptedStyleSheets). Backs off after 10 repairs in 10 s for 2 s, like
   * Dark Reader's style-position watchdog. Returns the number of repairs.
   */
  watchdog(now = performance.now()): number {
    if (now < this.backoffUntil) return 0;
    let repaired = 0;
    for (const [scope, layer] of this.layers) {
      if (scope instanceof ShadowRoot && !scope.host.isConnected) {
        this.layers.delete(scope);
        continue;
      }
      if (!layer.empty && layer.attach()) repaired++;
    }
    if (repaired) {
      this.reattachLog = this.reattachLog.filter((t) => now - t < 10_000);
      this.reattachLog.push(now);
      if (this.reattachLog.length >= 10) {
        this.backoffUntil = now + 2000;
        this.reattachLog = [];
      }
    }
    return repaired;
  }

  /** Remove every block and detach every sheet. */
  clear(): void {
    this.blocks.clear();
    for (const layer of this.layers.values()) layer.detach();
    this.layers.clear();
    this.layers.set(this.doc, new StyleLayer(this.doc, 'doc'));
  }
}
