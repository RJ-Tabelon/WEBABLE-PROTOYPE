// Test fixtures for `compose`: wire skeletons exactly as the extension sends
// them (skeleton/to-wire.ts on core's YouTube and news-article skeleton
// fixtures). Every label word is from VOCAB_V1 and no node inside a record
// carries words (fixtures.test.ts asserts both), so each fixture is what a
// correct extension would send.

import {
  COMPOSE_SCHEMA_VERSION,
  type ComposeRequest,
  type WireNode,
  type WireSkeleton,
} from '../_shared/core.bundle.js';

type Extra = Omit<WireNode, 'id' | 'p' | 't' | 'r' | 'k' | 'b'>;

/** One wire node: id, parent, tag, role, kind, box, then the optional fields. */
function n(
  id: string,
  p: string | null,
  t: WireNode['t'],
  r: WireNode['r'],
  k: WireNode['k'],
  b: WireNode['b'],
  extra: Extra = {},
): WireNode {
  return { id, p, t, r, k, b, ...extra };
}

/** A video channel page: banner with search, a rail, tabs and a 51-100 video grid. */
export const YOUTUBE: WireSkeleton = {
  page: { vw: 1280, vh: 800, dw: 1280, dh: 6704, lang: 'en' },
  nodes: [
    n('e1', null, 'body', null, 'group', [0, 0, 1280, 6704]),
    n('e2', 'e1', 'div', null, 'group', [0, 56, 1280, 6648]),
    n('e3', 'e2', 'custom', 'banner', 'landmark', [0, 0, 1280, 56], {
      f: ['fixed'],
    }),
    n('e4', 'e3', 'div', null, 'group', [0, 0, 1280, 56]),
    n('e5', 'e4', 'div', null, 'group', [16, 0, 168, 56]),
    n('e6', 'e5', 'button', 'button', 'control', [24, 16, 24, 24], {
      fs: 13,
      w: 400,
      f: ['icon'],
      l: ['guide'],
    }),
    n('e7', 'e5', 'custom', null, 'group', [56, 0, 128, 56]),
    n('e8', 'e7', 'a', 'link', 'control', [56, 0, 120, 56], {
      fs: 10,
      w: 400,
      f: ['icon'],
      l: ['you', '·', 'home'],
      hr: 'same',
    }),
    n('e9', 'e7', 'span', null, 'stext', [168, 16, 16, 48], {
      fs: 10,
      w: 400,
      sh: { len: 'xs' },
    }),
    n('e10', 'e4', 'div', null, 'group', [248, 8, 736, 40]),
    n('e11', 'e10', 'custom', 'search', 'landmark', [288, 8, 640, 40]),
    n('e12', 'e11', 'div', null, 'group', [288, 8, 632, 40]),
    n('e13', 'e12', 'form', 'form', 'landmark', [336, 16, 512, 24]),
    n('e14', 'e13', 'input', 'combobox', 'input', [336, 16, 512, 24], {
      fs: 16,
      w: 400,
      it: 'search',
      l: ['search'],
    }),
    n('e15', 'e12', 'button', 'button', 'control', [856, 8, 64, 40], {
      fs: 13,
      w: 400,
      f: ['icon'],
      l: ['search'],
    }),
    n('e16', 'e10', 'button', 'button', 'control', [936, 8, 40, 40], {
      fs: 14,
      w: 400,
      f: ['icon'],
      l: ['search', 'with', 'your', '·'],
    }),
    n('e17', 'e4', 'div', null, 'group', [1112, 8, 152, 40]),
    n('e18', 'e17', 'button', 'button', 'control', [1120, 16, 24, 24], {
      fs: 13,
      w: 400,
      f: ['icon'],
      l: ['settings'],
    }),
    n('e19', 'e17', 'a', 'link', 'control', [1160, 8, 104, 40], {
      fs: 14,
      w: 400,
      l: ['sign', 'in'],
      sh: { len: 'xs' },
      hr: 'same',
    }),
    n('e20', 'e2', 'custom', 'navigation', 'landmark', [0, 56, 72, 744], {
      f: ['fixed'],
    }),
    n('e21', 'e20', 'div', null, 'collection', [8, 64, 64, 304], {
      n: '3-5',
      itm: 'custom',
      ex: 'e22',
    }),
    n('e22', 'e21', 'a', 'link', 'control', [8, 64, 64, 80], {
      fs: 10,
      w: 400,
      sh: { len: 'xs' },
      hr: 'same',
      s: true,
    }),
    n('e23', 'e2', 'custom', 'main', 'landmark', [72, 56, 1208, 6648]),
    n('e24', 'e23', 'div', null, 'group', [72, 56, 1208, 440], {
      f: ['fixed'],
    }),
    n('e25', 'e24', 'div', null, 'group', [72, 56, 1208, 392]),
    n('e26', 'e25', 'img', null, 'media', [144, 56, 1072, 176]),
    n('e27', 'e25', 'div', null, 'group', [144, 248, 1072, 200]),
    n('e28', 'e27', 'img', null, 'media', [144, 264, 160, 160]),
    n('e29', 'e27', 'div', null, 'group', [320, 248, 896, 200]),
    n('e30', 'e29', 'h1', 'heading', 'heading', [320, 248, 208, 40], {
      fs: 36,
      w: 600,
      lv: 1,
      l: ['·', 'verified'],
      sh: { len: 's' },
    }),
    n('e31', 'e29', 'custom', null, 'group', [320, 296, 896, 24]),
    n('e32', 'e31', 'div', 'group', 'stext', [320, 296, 80, 24], {
      fs: 10,
      w: 400,
      sh: { len: 's' },
    }),
    n('e33', 'e31', 'span', null, 'stext', [400, 296, 8, 24], {
      fs: 14,
      w: 400,
      sh: { len: 'xs' },
    }),
    n('e34', 'e31', 'div', 'group', 'stext', [408, 296, 200, 24], {
      fs: 10,
      w: 400,
      sh: { len: 'm', pat: ['count'] },
    }),
    n('e35', 'e29', 'custom', null, 'group', [320, 328, 600, 24]),
    n('e36', 'e35', 'span', null, 'text', [320, 328, 568, 16], {
      fs: 14,
      w: 400,
      sh: { len: 'xl' },
    }),
    n('e37', 'e35', 'button', 'button', 'control', [872, 328, 48, 24], {
      fs: 14,
      w: 400,
      l: ['·', 'an', '·', 'of', '·', 'videos'],
      sh: { len: 'l' },
    }),
    n('e38', 'e29', 'custom', null, 'group', [320, 360, 600, 24]),
    n('e39', 'e38', 'a', 'link', 'control', [320, 360, 112, 16], {
      fs: 14,
      w: 400,
      l: ['·'],
      sh: { len: 's' },
      hr: 'other',
    }),
    n('e40', 'e38', 'span', null, 'stext', [432, 360, 104, 24], {
      fs: 14,
      w: 400,
      sh: { len: 's' },
    }),
    n('e41', 'e29', 'button', 'button', 'control', [320, 392, 96, 40], {
      fs: 14,
      w: 400,
      l: ['subscribe'],
      sh: { len: 'xs' },
    }),
    n('e42', 'e24', 'custom', 'tablist', 'group', [144, 448, 1072, 48]),
    n('e43', 'e42', 'div', 'tablist', 'group', [144, 448, 496, 48]),
    n('e44', 'e43', 'div', null, 'collection', [144, 448, 424, 48], {
      n: '6-10',
      itm: 'custom',
      ex: 'e45',
    }),
    n('e45', 'e44', 'custom', 'tab', 'control', [144, 448, 48, 48], {
      fs: 14,
      w: 400,
      sh: { len: 'xs' },
      s: true,
    }),
    n('e46', 'e43', 'button', 'button', 'control', [592, 448, 40, 40], {
      fs: 13,
      w: 400,
      f: ['icon'],
      l: ['search'],
    }),
    n('e47', 'e23', 'custom', null, 'group', [128, 496, 1088, 6192]),
    n('e48', 'e47', 'div', 'tablist', 'group', [136, 512, 224, 32]),
    n('e49', 'e48', 'div', null, 'collection', [136, 512, 216, 32], {
      n: '3-5',
      itm: 'div',
      ex: 'e50',
    }),
    n('e50', 'e49', 'button', 'tab', 'control', [136, 512, 64, 32], {
      fs: 13,
      w: 400,
      sh: { len: 'xs' },
      s: true,
    }),
    n('e51', 'e47', 'div', null, 'collection', [128, 568, 1072, 6032], {
      n: '51-100',
      itm: 'custom',
      ex: 'e52',
    }),
    n('e52', 'e51', 'div', null, 'group', [128, 568, 344, 248], { s: true }),
    n('e53', 'e52', 'a', 'link', 'control', [128, 568, 344, 208], {
      fs: 10,
      w: 400,
      f: ['imgctrl'],
      sh: { len: 'xs', pat: ['duration'] },
      hr: 'same',
      s: true,
    }),
    n('e54', 'e52', 'custom', null, 'group', [128, 776, 344, 48], { s: true }),
    n('e55', 'e54', 'div', null, 'group', [128, 776, 336, 48], { s: true }),
    n('e56', 'e55', 'h3', 'heading', 'heading', [128, 776, 336, 24], {
      fs: 12,
      w: 600,
      lv: 3,
      f: ['headlink'],
      sh: { len: 'l' },
      s: true,
    }),
    n('e57', 'e55', 'div', 'group', 'group', [128, 800, 336, 24], { s: true }),
    n('e58', 'e57', 'span', null, 'stext', [144, 800, 32, 24], {
      fs: 14,
      w: 400,
      sh: { len: 'xs', pat: ['num'] },
      s: true,
    }),
    n('e59', 'e57', 'span', null, 'stext', [184, 800, 40, 24], {
      fs: 14,
      w: 400,
      sh: { len: 'xs', pat: ['date'] },
      s: true,
    }),
    n('e60', 'e54', 'button', 'button', 'control', [448, 768, 40, 40], {
      fs: 14,
      w: 400,
      f: ['icon'],
      s: true,
    }),
  ],
};

/** A news article with ads, a sign-up form and a related rail. */
export const NEWS: WireSkeleton = {
  page: { vw: 1280, vh: 800, dw: 1280, dh: 4600, lang: 'en' },
  nodes: [
    n('e1', null, 'body', null, 'group', [0, 0, 1280, 4600]),
    n('e2', 'e1', 'div', null, 'group', [160, 0, 680, 120], { f: ['adhint'] }),
    n('e3', 'e2', 'span', null, 'stext', [160, 0, 120, 16], {
      fs: 11,
      w: 400,
      sh: { len: 's' },
    }),
    n('e4', 'e2', 'iframe', null, 'media', [208, 24, 584, 96], {
      f: ['adhint'],
    }),
    n('e5', 'e1', 'header', 'banner', 'landmark', [0, 120, 1280, 128]),
    n('e6', 'e5', 'div', null, 'group', [40, 128, 1200, 72]),
    n('e7', 'e6', 'button', 'button', 'control', [40, 144, 40, 40], {
      fs: 14,
      w: 400,
      f: ['icon', 'popup'],
      l: ['sections'],
    }),
    n('e8', 'e6', 'button', 'button', 'control', [88, 144, 40, 40], {
      fs: 14,
      w: 400,
      f: ['icon', 'popup'],
      l: ['search'],
    }),
    n('e9', 'e6', 'a', 'link', 'control', [480, 136, 320, 56], {
      fs: 16,
      w: 400,
      f: ['icon'],
      l: ['the', 'daily', '·'],
      hr: 'same',
    }),
    n('e10', 'e6', 'a', 'link', 'control', [1000, 152, 112, 40], {
      fs: 14,
      w: 400,
      l: ['subscribe'],
      sh: { len: 'xs' },
      hr: 'same',
    }),
    n('e11', 'e6', 'a', 'link', 'control', [1128, 152, 80, 40], {
      fs: 14,
      w: 400,
      l: ['sign', 'in'],
      sh: { len: 'xs' },
      hr: 'same',
    }),
    n('e12', 'e5', 'nav', 'navigation', 'landmark', [40, 208, 1200, 40], {
      l: ['sections'],
    }),
    n('e13', 'e12', 'ul', 'list', 'collection', [40, 208, 1000, 40], {
      n: '11-25',
      itm: 'li',
      ex: 'e14',
    }),
    n('e14', 'e13', 'a', 'link', 'control', [40, 216, 64, 32], {
      fs: 14,
      w: 400,
      sh: { len: 'xs' },
      hr: 'same',
      s: true,
    }),
    n('e15', 'e1', 'main', 'main', 'landmark', [0, 248, 1280, 3904]),
    n('e16', 'e15', 'article', 'article', 'group', [160, 280, 680, 3200]),
    n('e17', 'e16', 'header', null, 'group', [160, 280, 680, 240]),
    n('e18', 'e17', 'a', 'link', 'control', [160, 280, 80, 24], {
      fs: 13,
      w: 400,
      l: ['science'],
      sh: { len: 'xs' },
      hr: 'same',
    }),
    n('e19', 'e17', 'h1', 'heading', 'heading', [160, 312, 680, 120], {
      fs: 44,
      w: 600,
      lv: 1,
      l: ['·', 'new', 'kind', 'of', '·', 'warning'],
      sh: { len: 'l' },
    }),
    n('e20', 'e17', 'p', null, 'text', [160, 440, 680, 56], {
      fs: 20,
      w: 400,
      sh: { len: 'xl' },
    }),
    n('e21', 'e17', 'div', null, 'group', [160, 496, 680, 24]),
    n('e22', 'e21', 'a', 'link', 'control', [160, 496, 120, 24], {
      fs: 14,
      w: 400,
      l: ['·'],
      sh: { len: 's' },
      hr: 'same',
    }),
    n('e23', 'e21', 'time', null, 'stext', [304, 496, 160, 24], {
      fs: 14,
      w: 400,
      sh: { len: 's', pat: ['date'] },
    }),
    n('e24', 'e16', 'figure', 'figure', 'group', [160, 544, 680, 472]),
    n('e25', 'e24', 'img', 'img', 'media', [160, 544, 680, 424], {
      l: ['·', 'beside', '·'],
    }),
    n('e26', 'e24', 'figcaption', null, 'text', [160, 968, 680, 40], {
      fs: 13,
      w: 400,
      sh: { len: 'xl' },
    }),
    n('e27', 'e16', 'div', 'toolbar', 'group', [160, 1024, 680, 40]),
    n('e28', 'e27', 'button', 'button', 'control', [160, 904, 40, 40], {
      fs: 14,
      w: 400,
      f: ['icon'],
      l: ['share', 'on', '·'],
    }),
    n('e29', 'e27', 'button', 'button', 'control', [208, 904, 40, 40], {
      fs: 14,
      w: 400,
      f: ['icon'],
      l: ['share', 'on'],
    }),
    n('e30', 'e27', 'button', 'button', 'control', [248, 904, 40, 40], {
      fs: 14,
      w: 400,
      f: ['icon'],
      l: ['share', 'by', 'email'],
    }),
    n('e31', 'e27', 'button', 'button', 'control', [296, 904, 40, 40], {
      fs: 14,
      w: 400,
      f: ['icon'],
      l: ['copy', 'link'],
    }),
    n('e32', 'e27', 'button', 'button', 'control', [800, 904, 40, 40], {
      fs: 14,
      w: 400,
      f: ['icon'],
      l: ['save', 'article'],
    }),
    n('e33', 'e16', 'div', null, 'group', [160, 1080, 680, 2304]),
    n('e34', 'e33', 'p', null, 'text', [160, 1080, 680, 152], {
      fs: 18,
      w: 400,
      sh: { len: 'xxl', ln: '1' },
    }),
    n('e35', 'e33', 'p', null, 'text', [160, 1248, 680, 120], {
      fs: 18,
      w: 400,
      sh: { len: 'xl' },
    }),
    n('e36', 'e33', 'div', null, 'group', [160, 1392, 680, 288], {
      f: ['adhint'],
    }),
    n('e37', 'e36', 'span', null, 'stext', [160, 1392, 120, 16], {
      fs: 11,
      w: 400,
      sh: { len: 's' },
    }),
    n('e38', 'e36', 'iframe', null, 'media', [208, 1408, 584, 264], {
      f: ['adhint'],
    }),
    n('e39', 'e33', 'p', null, 'text', [160, 1704, 680, 152], {
      fs: 18,
      w: 400,
      sh: { len: 'xxl', ln: '2' },
    }),
    n('e40', 'e33', 'aside', null, 'group', [160, 1872, 680, 120]),
    n('e41', 'e40', 'span', null, 'stext', [176, 1888, 200, 24], {
      fs: 14,
      w: 400,
      sh: { len: 'xs' },
    }),
    n('e42', 'e40', 'a', 'link', 'control', [176, 1912, 640, 64], {
      fs: 18,
      w: 400,
      l: ['why', '·', 'are', '·'],
      sh: { len: 'm' },
      hr: 'same',
    }),
    n('e43', 'e33', 'p', null, 'text', [160, 2008, 680, 152], {
      fs: 18,
      w: 400,
      sh: { len: 'xxl', ln: '1' },
    }),
    n('e44', 'e33', 'form', 'form', 'landmark', [160, 2184, 680, 200]),
    n('e45', 'e44', 'h2', 'heading', 'heading', [184, 2200, 400, 32], {
      fs: 22,
      w: 600,
      lv: 2,
      l: ['get', 'the', 'morning', '·'],
      sh: { len: 'm' },
    }),
    n('e46', 'e44', 'p', null, 'text', [184, 2240, 600, 48], {
      fs: 15,
      w: 400,
      sh: { len: 'xl' },
    }),
    n('e47', 'e44', 'input', 'textbox', 'input', [184, 2304, 424, 48], {
      fs: 16,
      w: 400,
      it: 'email',
      l: ['email', 'address'],
    }),
    n('e48', 'e44', 'button', 'button', 'control', [624, 2304, 144, 48], {
      fs: 16,
      w: 400,
      l: ['sign', 'up'],
      sh: { len: 'xs' },
    }),
    n('e49', 'e33', 'p', null, 'text', [160, 2400, 680, 120], {
      fs: 18,
      w: 400,
      sh: { len: 'xl' },
    }),
    n('e50', 'e33', 'div', null, 'group', [160, 2544, 680, 288], {
      f: ['adhint'],
    }),
    n('e51', 'e50', 'span', null, 'stext', [160, 2544, 120, 16], {
      fs: 11,
      w: 400,
      sh: { len: 's' },
    }),
    n('e52', 'e50', 'iframe', null, 'media', [208, 2560, 584, 264], {
      f: ['adhint'],
    }),
    n('e53', 'e33', 'p', null, 'text', [160, 2848, 680, 152], {
      fs: 18,
      w: 400,
      sh: { len: 'xxl', ln: '1' },
    }),
    n('e54', 'e33', 'p', null, 'text', [160, 3024, 680, 88], {
      fs: 18,
      w: 400,
      sh: { len: 'xl' },
    }),
    n('e55', 'e33', 'h2', 'heading', 'heading', [160, 3128, 680, 40], {
      fs: 26,
      w: 600,
      lv: 2,
      l: ['what', '·', 'next'],
      sh: { len: 's' },
    }),
    n('e56', 'e33', 'p', null, 'text', [160, 3184, 680, 152], {
      fs: 18,
      w: 400,
      sh: { len: 'xxl', ln: '2' },
    }),
    n('e57', 'e16', 'div', null, 'group', [160, 3400, 680, 40]),
    n('e58', 'e57', 'span', null, 'stext', [160, 3408, 64, 24], {
      fs: 14,
      w: 400,
      sh: { len: 'xs' },
    }),
    n('e59', 'e57', 'ul', 'list', 'collection', [232, 3408, 400, 32], {
      n: '3-5',
      itm: 'li',
      ex: 'e60',
    }),
    n('e60', 'e59', 'a', 'link', 'control', [232, 3408, 88, 32], {
      fs: 14,
      w: 400,
      sh: { len: 'xs' },
      hr: 'same',
      s: true,
    }),
    n('e61', 'e15', 'section', 'region', 'landmark', [160, 3504, 680, 624], {
      l: ['comments'],
    }),
    n('e62', 'e61', 'h2', 'heading', 'heading', [160, 3504, 680, 40], {
      fs: 24,
      w: 600,
      lv: 2,
      l: ['comments'],
      sh: { len: 's' },
    }),
    n('e63', 'e61', 'button', 'button', 'control', [160, 3552, 200, 40], {
      fs: 15,
      w: 400,
      l: ['sign', 'in', 'to', 'comment'],
      sh: { len: 's' },
    }),
    n('e64', 'e61', 'ol', 'list', 'collection', [160, 3600, 680, 464], {
      n: '6-10',
      itm: 'li',
      ex: 'e65',
    }),
    n('e65', 'e64', 'li', 'listitem', 'group', [160, 3600, 680, 144], {
      s: true,
    }),
    n('e66', 'e65', 'a', 'link', 'control', [160, 3608, 144, 24], {
      fs: 14,
      w: 600,
      f: ['bold'],
      sh: { len: 's' },
      hr: 'same',
      s: true,
    }),
    n('e67', 'e65', 'time', null, 'stext', [312, 3608, 88, 24], {
      fs: 13,
      w: 400,
      sh: { len: 's', pat: ['date'] },
      s: true,
    }),
    n('e68', 'e65', 'p', null, 'text', [160, 3632, 680, 72], {
      fs: 16,
      w: 400,
      sh: { len: 'xl' },
      s: true,
    }),
    n('e69', 'e65', 'button', 'button', 'control', [160, 3712, 72, 32], {
      fs: 13,
      w: 400,
      sh: { len: 'xs' },
      s: true,
    }),
    n('e70', 'e65', 'button', 'button', 'control', [240, 3712, 72, 32], {
      fs: 13,
      w: 400,
      sh: { len: 'xs' },
      s: true,
    }),
    n('e71', 'e65', 'button', 'button', 'control', [808, 3608, 40, 32], {
      fs: 13,
      w: 400,
      f: ['icon', 'popup'],
      s: true,
    }),
    n('e72', 'e61', 'button', 'button', 'control', [160, 4072, 200, 40], {
      fs: 15,
      w: 400,
      l: ['show', 'more', 'comments'],
      sh: { len: 's' },
    }),
    n(
      'e73',
      'e15',
      'aside',
      'complementary',
      'landmark',
      [880, 280, 304, 1600],
    ),
    n('e74', 'e73', 'section', null, 'group', [880, 280, 304, 704]),
    n('e75', 'e74', 'h2', 'heading', 'heading', [880, 280, 304, 32], {
      fs: 20,
      w: 600,
      lv: 2,
      l: ['most', 'read'],
      sh: { len: 'xs' },
    }),
    n('e76', 'e74', 'ol', 'list', 'collection', [880, 320, 304, 648], {
      n: '6-10',
      itm: 'li',
      ex: 'e77',
    }),
    n('e77', 'e76', 'li', 'listitem', 'group', [880, 320, 304, 64], {
      s: true,
    }),
    n('e78', 'e77', 'span', null, 'stext', [880, 328, 24, 32], {
      fs: 28,
      w: 400,
      sh: { len: 'xs', pat: ['num'] },
      s: true,
    }),
    n('e79', 'e77', 'a', 'link', 'control', [912, 328, 272, 56], {
      fs: 16,
      w: 400,
      sh: { len: 'l' },
      hr: 'same',
      s: true,
    }),
    n('e80', 'e73', 'div', null, 'group', [880, 1000, 304, 600], {
      f: ['sticky', 'adhint'],
    }),
    n('e81', 'e80', 'span', null, 'stext', [880, 1000, 120, 16], {
      fs: 11,
      w: 400,
      sh: { len: 's' },
    }),
    n('e82', 'e80', 'iframe', null, 'media', [880, 1024, 304, 248], {
      f: ['adhint'],
    }),
    n('e83', 'e80', 'video', null, 'media', [880, 1288, 304, 168], {
      f: ['playing', 'adhint'],
    }),
    n('e84', 'e1', 'footer', 'contentinfo', 'landmark', [0, 4152, 1280, 456]),
    n('e85', 'e84', 'div', null, 'collection', [40, 4184, 1200, 240], {
      n: '3-5',
      itm: 'div',
      ex: 'e86',
    }),
    n('e86', 'e85', 'div', null, 'group', [40, 4184, 280, 240], { s: true }),
    n('e87', 'e86', 'h3', 'heading', 'heading', [40, 4184, 280, 24], {
      fs: 15,
      w: 600,
      lv: 3,
      sh: { len: 'xs' },
      s: true,
    }),
    n('e88', 'e86', 'ul', 'list', 'collection', [40, 4216, 280, 200], {
      n: '6-10',
      itm: 'li',
      ex: 'e89',
      s: true,
    }),
    n('e89', 'e88', 'a', 'link', 'control', [40, 4216, 104, 24], {
      fs: 14,
      w: 400,
      sh: { len: 'xs' },
      hr: 'same',
      s: true,
    }),
    n('e90', 'e84', 'ul', 'list', 'group', [40, 4464, 1200, 40]),
    n('e91', 'e90', 'a', 'link', 'control', [40, 4472, 120, 24], {
      fs: 13,
      w: 400,
      l: ['contact', 'us'],
      sh: { len: 'xs' },
      hr: 'same',
    }),
    n('e92', 'e90', 'a', 'link', 'control', [184, 4472, 120, 24], {
      fs: 13,
      w: 400,
      l: ['privacy', 'policy'],
      sh: { len: 's' },
      hr: 'same',
    }),
    n('e93', 'e90', 'a', 'link', 'control', [320, 4472, 120, 24], {
      fs: 13,
      w: 400,
      l: ['terms', 'of', 'use'],
      sh: { len: 's' },
      hr: 'same',
    }),
    n('e94', 'e90', 'a', 'link', 'control', [464, 4472, 160, 24], {
      fs: 13,
      w: 400,
      l: ['cookie', 'settings'],
      sh: { len: 's' },
      hr: 'same',
    }),
    n('e95', 'e84', 'small', null, 'stext', [40, 4520, 400, 24], {
      fs: 12,
      w: 400,
      sh: { len: 'm' },
    }),
    n('e96', 'e1', 'div', null, 'group', [0, 720, 1280, 80], { f: ['fixed'] }),
    n('e97', 'e96', 'span', null, 'stext', [200, 744, 504, 32], {
      fs: 18,
      w: 400,
      sh: { len: 'm' },
    }),
    n('e98', 'e96', 'a', 'link', 'control', [904, 736, 160, 48], {
      fs: 16,
      w: 400,
      l: ['see', 'offers'],
      sh: { len: 'xs' },
      hr: 'same',
    }),
    n('e99', 'e96', 'button', 'button', 'control', [1200, 744, 32, 32], {
      fs: 14,
      w: 400,
      f: ['icon'],
      l: ['close'],
    }),
    n('e100', 'e1', 'custom', 'button', 'control', [1200, 640, 56, 56], {
      fs: 14,
      w: 400,
      f: ['fixed', 'icon'],
      l: ['chat', 'with', 'us'],
    }),
    n('e101', 'e1', 'div', 'dialog', 'landmark', [0, 560, 1280, 160], {
      f: ['fixed', 'consenthint'],
      l: ['privacy', 'choices'],
    }),
    n('e102', 'e101', 'p', null, 'text', [80, 584, 760, 64], {
      fs: 15,
      w: 400,
      sh: { len: 'xl', ln: '1' },
    }),
    n('e103', 'e101', 'button', 'button', 'control', [904, 584, 160, 48], {
      fs: 15,
      w: 400,
      l: ['accept', 'all'],
      sh: { len: 'xs' },
    }),
    n('e104', 'e101', 'button', 'button', 'control', [1080, 584, 160, 48], {
      fs: 15,
      w: 400,
      l: ['manage', 'choices'],
      sh: { len: 's' },
    }),
  ],
};

export function composeRequest(
  skeleton: WireSkeleton = YOUTUBE,
): ComposeRequest {
  return {
    v: 1,
    schema: COMPOSE_SCHEMA_VERSION,
    skeleton: structuredClone(skeleton),
  };
}

/**
 * A request of about `bytes` bytes of JSON: a flat page of short texts
 * under one main landmark, within the node cap.
 */
export function largeRequest(bytes: number): ComposeRequest {
  const nodes: WireNode[] = [
    n('e1', null, 'body', null, 'group', [0, 0, 1280, 200000]),
    n('e2', 'e1', 'main', 'main', 'landmark', [0, 0, 1280, 200000]),
  ];
  const req = (): ComposeRequest => ({
    v: 1,
    schema: COMPOSE_SCHEMA_VERSION,
    skeleton: {
      page: { vw: 1280, vh: 800, dw: 1280, dh: 200000, lang: 'en' },
      nodes,
    },
  });
  let id = 3;
  while (JSON.stringify(req()).length < bytes && nodes.length < 600) {
    nodes.push(
      n(`e${id}`, 'e2', 'p', null, 'text', [128, id * 64, 1024, 56], {
        fs: 18,
        w: 400,
        sh: { len: 'xxl', pat: ['date', 'num'], ln: '3-5' },
        f: ['cliprisk', 'overlay', 'bold', 'hoveronly'],
        hr: 'same',
      }),
    );
    id += 1;
  }
  return req();
}

/** Every label word in a request (to check fixtures against VOCAB_V1). */
export function fixtureWords(req: ComposeRequest): string[] {
  return req.skeleton.nodes.flatMap((node) => node.l ?? []);
}
