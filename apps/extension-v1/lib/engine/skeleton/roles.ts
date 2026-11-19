import {
  SKEL_ROLES,
  SKEL_TAGS,
  type SkelInputType,
  type SkelRole,
  type SkelTag,
} from '@webable/core/skeleton/constants';

/**
 * Tag and role mapping onto the skeleton's closed vocabularies (docs/10 §6).
 * A raw tag name or role token never reaches a node: anything outside
 * SKEL_TAGS is 'custom' (custom elements) or 'other', anything outside
 * SKEL_ROLES is null. ARIA is read, never written.
 */

const TAGS: ReadonlySet<string> = new Set(SKEL_TAGS);
const ROLES: ReadonlySet<string> = new Set(SKEL_ROLES);

export function skelTag(el: Element): SkelTag {
  const t = el.localName;
  if (t === 'custom' || t === 'other') return 'other';
  if (TAGS.has(t)) return t as SkelTag;
  return t.includes('-') ? 'custom' : 'other';
}

/** First token of the role attribute, lowercased, or null. */
export function explicitRole(el: Element): string | null {
  const raw = el.getAttribute('role');
  if (!raw) return null;
  const first = raw.trim().toLowerCase().split(/\s+/)[0];
  return first && /^[a-z]{2,24}$/.test(first) ? first : null;
}

/** header/footer inside sectioning content are not landmarks (HTML-AAM). */
function sectioningScoped(el: Element): boolean {
  return (
    el.parentElement?.closest('article, aside, main, nav, section') != null
  );
}

const named = (el: Element): boolean =>
  !!(
    el.getAttribute('aria-label')?.trim() || el.getAttribute('aria-labelledby')
  );

/** Implicit ARIA role of an element (HTML-AAM, the subset the skeleton uses). */
export function implicitRole(el: Element): string | null {
  switch (el.localName) {
    case 'a':
    case 'area':
      return el.hasAttribute('href') ? 'link' : null;
    case 'button':
    case 'summary':
      return 'button';
    case 'select': {
      const s = el as HTMLSelectElement;
      return s.multiple || s.size > 1 ? 'listbox' : 'combobox';
    }
    case 'textarea':
      return 'textbox';
    case 'input':
      return inputRole(el as HTMLInputElement);
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'img':
      return el.getAttribute('alt') === '' ? null : 'img';
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'aside':
      return 'complementary';
    case 'header':
      return sectioningScoped(el) ? null : 'banner';
    case 'footer':
      return sectioningScoped(el) ? null : 'contentinfo';
    case 'form':
      return 'form';
    case 'search':
      return 'search';
    case 'section':
      return named(el) ? 'region' : null;
    case 'dialog':
      return 'dialog';
    case 'article':
      return 'article';
    case 'ul':
    case 'ol':
    case 'menu':
      return 'list';
    case 'li':
      return 'listitem';
    case 'table':
      return 'table';
    case 'tr':
      return 'row';
    case 'td':
      return 'cell';
    case 'th':
      return 'columnheader';
    case 'figure':
      return 'figure';
    case 'details':
    case 'fieldset':
      return 'group';
    default:
      return null;
  }
}

function inputRole(el: HTMLInputElement): string | null {
  const t = (el.getAttribute('type') ?? 'text').toLowerCase();
  switch (t) {
    case 'hidden':
      return null;
    case 'search':
      return el.hasAttribute('list') ? 'combobox' : 'searchbox';
    case 'button':
    case 'submit':
    case 'reset':
    case 'image':
      return 'button';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'range':
      return 'slider';
    case 'number':
      return 'spinbutton';
    default:
      return el.hasAttribute('list') ? 'combobox' : 'textbox';
  }
}

/** ARIA roles beyond SKEL_ROLES that still override the implicit role. */
const OTHER_ARIA_ROLES: ReadonlySet<string> = new Set([
  'application',
  'blockquote',
  'caption',
  'code',
  'comment',
  'definition',
  'deletion',
  'directory',
  'document',
  'emphasis',
  'insertion',
  'log',
  'mark',
  'marquee',
  'math',
  'meter',
  'note',
  'paragraph',
  'progressbar',
  'rowgroup',
  'scrollbar',
  'separator',
  'strong',
  'subscript',
  'suggestion',
  'superscript',
  'term',
  'time',
  'timer',
  'tooltip',
]);

/**
 * The role the skeleton reasons with: a valid explicit role, else the
 * implicit one (an invalid token such as role="text" is ignored, as in ARIA).
 */
export function roleOf(el: Element): string | null {
  const ex = explicitRole(el);
  if (ex === 'presentation' || ex === 'none') return null;
  if (ex && ex !== 'generic' && (ROLES.has(ex) || OTHER_ARIA_ROLES.has(ex)))
    return ex;
  return implicitRole(el);
}

export function skelRole(role: string | null): SkelRole | null {
  return role && ROLES.has(role) ? (role as SkelRole) : null;
}

/** Landmark roles (SKEL_KINDS 'landmark'). */
export const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  'banner',
  'navigation',
  'main',
  'complementary',
  'contentinfo',
  'search',
  'form',
  'region',
  'dialog',
  'alertdialog',
]);

/** Composite containers whose role is meaning: never flattened away. */
export const CONTAINER_ROLES: ReadonlySet<string> = new Set([
  'toolbar',
  'tablist',
  'menu',
  'menubar',
  'feed',
  'tabpanel',
  'radiogroup',
  'listbox',
  'tree',
  'grid',
  'treegrid',
  'list',
  'table',
  'group',
  'article',
]);

/** Roles that make an element a control (SKEL_KINDS 'control'). */
export const CONTROL_ROLES: ReadonlySet<string> = new Set([
  'button',
  'link',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'switch',
  'option',
  'treeitem',
]);

/** Roles that make a non-native element an input (SKEL_KINDS 'input'). */
export const INPUT_ROLES: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'combobox',
  'searchbox',
  'textbox',
  'slider',
  'spinbutton',
]);

const DATE_TYPES = new Set(['date', 'datetime-local', 'month', 'week', 'time']);

/** Input kind on the closed SKEL_INPUT_TYPES list. */
export function inputTypeOf(el: Element, role: string | null): SkelInputType {
  switch (el.localName) {
    case 'select':
      return 'select';
    case 'textarea':
      return 'textarea';
    case 'input': {
      const t = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (DATE_TYPES.has(t)) return 'date';
      // A button input with an input role (role="radio" on a swatch) is that input.
      if (isButtonInput(el) && (role === 'radio' || role === 'checkbox'))
        return role;
      switch (t) {
        case 'text':
        case 'search':
        case 'email':
        case 'tel':
        case 'url':
        case 'number':
        case 'password':
        case 'checkbox':
        case 'radio':
        case 'range':
        case 'file':
          return t;
        default:
          return 'other';
      }
    }
    default:
      break;
  }
  switch (role) {
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'combobox':
      return 'select';
    case 'searchbox':
      return 'search';
    case 'slider':
      return 'range';
    case 'spinbutton':
      return 'number';
    case 'textbox':
      return el.getAttribute('aria-multiline') === 'true' ? 'textarea' : 'text';
    default:
      return 'other';
  }
}

/** Native input types that are buttons, not fields. */
export function isButtonInput(el: Element): boolean {
  if (el.localName !== 'input') return false;
  const t = (el.getAttribute('type') ?? '').toLowerCase();
  return t === 'button' || t === 'submit' || t === 'reset' || t === 'image';
}

export function headingLevel(el: Element): number {
  const m = /^h([1-6])$/.exec(el.localName);
  if (m) return Number(m[1]);
  const lv = Number(el.getAttribute('aria-level'));
  return Number.isInteger(lv) && lv >= 1 && lv <= 6 ? lv : 2;
}
