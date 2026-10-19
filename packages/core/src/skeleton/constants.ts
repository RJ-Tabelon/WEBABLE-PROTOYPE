/**
 * Zod-free skeleton vocabulary (docs/10 §4, §6). The content script imports
 * these directly. Every value that can leave the device in a compose request
 * comes from one of these closed lists, never from the page: a raw tag name,
 * role token or attribute can never reach the planner's prompt.
 */

/** Tags kept by name. Anything else is 'custom' (custom elements) or 'other'. */
export const SKEL_TAGS = [
  'a',
  'article',
  'aside',
  'audio',
  'blockquote',
  'body',
  'button',
  'canvas',
  'code',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'iframe',
  'img',
  'input',
  'label',
  'legend',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'picture',
  'pre',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'summary',
  'svg',
  'table',
  'td',
  'textarea',
  'th',
  'time',
  'tr',
  'ul',
  'video',
  'custom',
  'other',
] as const;
export type SkelTag = (typeof SKEL_TAGS)[number];

/** ARIA roles (explicit or implicit) the skeleton keeps. Unknown tokens become null. */
export const SKEL_ROLES = [
  'alert',
  'alertdialog',
  'article',
  'banner',
  'button',
  'cell',
  'checkbox',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'dialog',
  'feed',
  'figure',
  'form',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'link',
  'list',
  'listbox',
  'listitem',
  'main',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'option',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowheader',
  'search',
  'searchbox',
  'slider',
  'spinbutton',
  'status',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'textbox',
  'toolbar',
  'tree',
  'treeitem',
] as const;
export type SkelRole = (typeof SKEL_ROLES)[number];

/**
 * landmark   banner/nav/main/aside/footer/search/form/dialog/region
 * group      a container with two or more kept children
 * heading    h1-h6 or role=heading
 * control    link, button, tab, menu item, switch, focusable custom control
 * input      text field, search field, select, checkbox, radio, slider, textarea
 * media      img, picture, video, audio, canvas, iframe, large svg, background-image box
 * text       a long text block (only its length and shape are kept)
 * stext      a short text (<= 40 chars): pattern tags; its words stay on the device
 * table      a data table, summarised as rows x columns
 * collection a run of >= 3 similar siblings, kept as a count plus one exemplar subtree
 */
export const SKEL_KINDS = [
  'landmark',
  'group',
  'heading',
  'control',
  'input',
  'media',
  'text',
  'stext',
  'table',
  'collection',
] as const;
export type SkelKind = (typeof SKEL_KINDS)[number];

export const SKEL_FLAGS = [
  /** position: fixed / sticky (or inside such a box). */
  'fixed',
  'sticky',
  /** A video that is playing without a recent user gesture. */
  'playing',
  /** Ad-like markup (ids, classes, data attributes, ad-network iframe). */
  'adhint',
  /** Consent-management markup (CMP vendors, cookie banners). */
  'consenthint',
  /** A control with no visible text (its name comes from aria-label/title/alt). */
  'icon',
  /** A control whose only content is an image (thumbnail link). */
  'imgctrl',
  /** A heading that is (or contains) a link. */
  'headlink',
  /** Text in a box that clips: ellipsis, line-clamp, overflow hidden, fixed height. */
  'cliprisk',
  /** Text positioned over media (duration badges, captions on thumbnails). */
  'overlay',
  /** contenteditable or a rich editor root. */
  'editable',
  'disabled',
  /** aria-selected / aria-current / checked. */
  'selected',
  /** aria-pressed=true. */
  'pressed',
  /** aria-expanded=true. */
  'expanded',
  /** aria-haspopup (opens a menu, listbox or dialog). */
  'popup',
  'required',
  /** Rendered bold (>= 600) where siblings are not: unread rows, current items. */
  'bold',
  /** Visible only on hover or focus-within (record actions such as archive, ⋮). */
  'hoveronly',
  /** The element (or its subtree) currently holds focus. */
  'focus',
] as const;
export type SkelFlag = (typeof SKEL_FLAGS)[number];

/** Shapes of short texts. Only the shape leaves the device, never the text. */
export const SKEL_PATTERNS = [
  'price',
  'duration',
  'count',
  'rating',
  'date',
  'percent',
  'num',
] as const;
export type SkelPattern = (typeof SKEL_PATTERNS)[number];

/** Character-length buckets used on the wire. */
export const SKEL_LENGTH_BUCKETS = [
  'xs', // <= 10
  's', // <= 20
  'm', // <= 40
  'l', // <= 80
  'xl', // <= 400
  'xxl', // > 400
] as const;
export type SkelLengthBucket = (typeof SKEL_LENGTH_BUCKETS)[number];

/** Count buckets for collection sizes, link counts and select options. */
export const SKEL_COUNT_BUCKETS = [
  '0',
  '1',
  '2',
  '3-5',
  '6-10',
  '11-25',
  '26-50',
  '51-100',
  '100+',
] as const;
export type SkelCountBucket = (typeof SKEL_COUNT_BUCKETS)[number];

export const SKEL_INPUT_TYPES = [
  'text',
  'search',
  'email',
  'tel',
  'url',
  'number',
  'password',
  'checkbox',
  'radio',
  'range',
  'date',
  'file',
  'select',
  'textarea',
  'other',
] as const;
export type SkelInputType = (typeof SKEL_INPUT_TYPES)[number];

/** Where a link goes, relative to the tab's site. Hrefs themselves never leave the device. */
export const SKEL_HREF_KINDS = ['same', 'other', 'fragment', 'none'] as const;
export type SkelHrefKind = (typeof SKEL_HREF_KINDS)[number];

/** Node id format, shared by the skeleton, the wire request and the PageSpec. */
export const SKEL_ID_PATTERN = /^e[0-9]{1,4}$/;
export const SKEL_ID_PATTERN_SOURCE = '^e[0-9]{1,4}$';

/** Limits (docs/10 §6). */
export const SKEL_MAX_NODES = 600;
export const SKEL_MAX_DEPTH = 24;
export const SKEL_MAX_LABEL_WORDS = 6;
export const SKEL_MAX_EXEMPLAR_NODES = 24;
/** Boxes on the wire are rounded to this many CSS px. */
export const SKEL_BOX_ROUND = 8;
/** Largest coordinate allowed on the wire (very long documents are clamped). */
export const SKEL_MAX_COORD = 200_000;

export function lengthBucket(chars: number): SkelLengthBucket {
  if (chars <= 10) return 'xs';
  if (chars <= 20) return 's';
  if (chars <= 40) return 'm';
  if (chars <= 80) return 'l';
  if (chars <= 400) return 'xl';
  return 'xxl';
}

export function countBucket(n: number): SkelCountBucket {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n === 2) return '2';
  if (n <= 5) return '3-5';
  if (n <= 10) return '6-10';
  if (n <= 25) return '11-25';
  if (n <= 50) return '26-50';
  if (n <= 100) return '51-100';
  return '100+';
}
