import type { OpId } from '@webable/core/ops/catalog';

import type { TreeScope } from '../util/dom';

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

class StyleLayer {
  readonly sheet: CSSStyleSheet;
  private readonly blocks = new Map<string, string>();
  private dirty = false;

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
    this.sheet.replaceSync([...this.blocks.values()].join('\n'));
    if (this.blocks.size > 0) this.attach();
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
