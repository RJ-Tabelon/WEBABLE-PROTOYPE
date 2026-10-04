/**
 * Hover-only menus (engine.md 2.8): submenus that are hidden now and are
 * revealed by a :hover rule on an ancestor or sibling.
 *   (a) static CSS scan of readable stylesheets for `X:hover <combinator> Y`
 *       rules that change display/visibility/opacity/transform;
 *   (b) structure: nav items or aria-haspopup owners containing a hidden list/menu.
 * Cross-origin sheets are skipped (reading them throws).
 */

const REVEAL_PROPS =
  /(?:^|;)\s*(display|visibility|opacity|transform|max-height|height|clip-path)\s*:/i;

function hidden(el: Element): boolean {
  const e = el as Element & {
    checkVisibility?: (o?: Record<string, boolean>) => boolean;
  };
  if (typeof e.checkVisibility === 'function') {
    return !e.checkVisibility({
      visibilityProperty: true,
      opacityProperty: true,
    });
  }
  return false;
}

/** `.menu li:hover > ul` -> `.menu li > ul`; null when :hover is on the target itself. */
export function hoverTargetSelector(selector: string): string | null {
  const idx = selector.indexOf(':hover');
  if (idx < 0) return null;
  const after = selector.slice(idx + ':hover'.length);
  // The revealed element must be reached through a combinator after the hovered one.
  if (!/^[^\s>+~,]*\s*[>+~\s]\s*\S/.test(after)) return null;
  const cleaned = selector
    .replace(/:hover/g, '')
    .replace(/:focus-within|:focus-visible|:focus/g, '');
  return cleaned.trim() || null;
}

function* cssRules(sheet: CSSStyleSheet, depth = 0): Generator<CSSStyleRule> {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return;
  }
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) yield rule;
    else if (depth < 3 && 'cssRules' in rule) {
      const group = rule as CSSGroupingRule;
      for (const inner of group.cssRules) {
        if (inner instanceof CSSStyleRule) yield inner;
      }
    }
  }
}

export function detectHoverMenus(doc: Document, maxRules = 3000): Element[] {
  const found = new Set<Element>();
  let seen = 0;
  outer: for (const sheet of doc.styleSheets) {
    for (const rule of cssRules(sheet)) {
      if (++seen > maxRules) break outer;
      const sel = rule.selectorText;
      if (!sel.includes(':hover')) continue;
      if (!REVEAL_PROPS.test(rule.style.cssText)) continue;
      for (const part of sel.split(',')) {
        const target = hoverTargetSelector(part.trim());
        if (!target) continue;
        let els: NodeListOf<Element>;
        try {
          els = doc.querySelectorAll(target);
        } catch {
          continue;
        }
        let n = 0;
        for (const el of els) {
          if (++n > 50) break;
          if (hidden(el)) found.add(el);
        }
      }
    }
  }
  let items = 0;
  for (const owner of doc.querySelectorAll(
    'nav li, [aria-haspopup]:not([aria-haspopup="false"])',
  )) {
    if (++items > 200) break;
    const host =
      owner.localName === 'li'
        ? owner
        : (owner.closest('li') ?? owner.parentElement);
    if (!host) continue;
    for (const sub of host.querySelectorAll(
      ':scope > ul, :scope > ol, :scope > [role="menu"], :scope > div > ul',
    )) {
      if (hidden(sub)) found.add(sub);
    }
  }
  // Keep outermost submenus only.
  const list = [...found];
  return list.filter((el) => !list.some((o) => o !== el && o.contains(el)));
}
