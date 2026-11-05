// Owner: X (round 7). Test helpers: build reader trees (SNode) by hand. Used by the tests only.

import type { SAttrs, SNode } from './types';

export interface HProps {
  cls?: string;
  role?: string;
  text?: string;
  segs?: Array<[number, string]>;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fs?: number;
  fw?: number;
  fixed?: boolean;
  attrs?: SAttrs;
}

/** A tree node. Boxes default to 100 x 20 at (0, 0); children get `ci` in order. */
export function h(tag: string, props: HProps | string = {}, ...kids: SNode[]): SNode {
  const p: HProps = typeof props === 'string' ? { text: props } : props;
  const n: SNode = {
    tag,
    cls: p.cls ?? '',
    text: p.text ?? '',
    x: p.x ?? 0,
    y: p.y ?? 0,
    w: p.w ?? 100,
    h: p.h ?? 20,
    fs: p.fs ?? 16,
    fw: p.fw ?? 400,
    kids,
  };
  kids.forEach((k, i) => {
    k.ci = i;
  });
  if (p.role) n.role = p.role;
  if (p.segs) n.segs = p.segs;
  if (p.fixed) n.fixed = true;
  if (p.attrs) n.attrs = p.attrs;
  return n;
}

/** A box at (x, y) with size w x h. */
export function box(x: number, y: number, w: number, hh: number, extra: HProps = {}): HProps {
  return { x, y, w, h: hh, ...extra };
}

/** Find the first node matching a predicate (after `link`). */
export function find(root: SNode, pred: (n: SNode) => boolean): SNode | undefined {
  const stack = [root];
  while (stack.length) {
    const n = stack.shift() as SNode;
    if (pred(n)) return n;
    stack.push(...n.kids);
  }
  return undefined;
}

/** A stat card as on floridagators.com: label above, value below, optional date. */
export function statCard(x: number, y: number, label: string, value: string, sub?: string): SNode {
  const kids = [h('div', box(x + 100, y + 30, 80, 30, { text: label, cls: 's-text-heading-large' })), h('div', box(x + 100, y + 80, 60, 50, { text: value, fs: 40, fw: 700 }))];
  if (sub) kids.push(h('div', box(x + 100, y + 130, 90, 23, { text: sub })));
  return h('div', box(x, y, 308, 162, { cls: 'resume-item flex flex-col' }), ...kids);
}

/** The Kentucky opponent-history page's record block, in the same structure as the real page. */
export function gatorsResume(): SNode {
  const lineScore = h('table', box(761, 719, 565, 140, { cls: 'w-full' }),
    h('thead', box(761, 719, 565, 34),
      h('tr', box(761, 719, 565, 34),
        h('th', box(761, 719, 224, 34)),
        ...['1', '2', '3', '4', 'F'].map((t, i) => h('th', box(985 + i * 68, 719, 67, 34), h('div', box(995 + i * 68, 727, 47, 21, { text: t })))),
      ),
    ),
    h('tbody', box(761, 753, 565, 106),
      h('tr', box(761, 753, 565, 53),
        h('th', box(761, 753, 224, 53), h('span', box(772, 771, 203, 21, { text: 'Florida', fw: 700 }))),
        ...['7', '0', '0', '0', '7'].map((t, i) => h('td', box(985 + i * 68, 753, 67, 53, { text: t }))),
      ),
      h('tr', box(761, 806, 565, 53),
        h('th', box(761, 806, 224, 53), h('span', box(772, 823, 203, 21, { text: 'Kentucky' }))),
        ...['3', '21', '7', '7', '38'].map((t, i) => h('td', box(985 + i * 68, 806, 67, 53, { text: t }))),
      ),
    ),
  );
  const lastMatchup = h('div', box(728, 478, 631, 534, { cls: 'c-opponent-history-detail-page__top-right' }),
    h('div', box(728, 478, 631, 534, { cls: 'c-opponent-history-detail-page__resume-last-matchup' }),
      h('div', box(1001, 563, 86, 18, { text: 'Last Matchup' })),
      h('div', box(1012, 596, 63, 23, { text: '11/8/2025' })),
      h('div', box(850, 651, 387, 60, { cls: 'resume-last-matchup__logos flex' }),
        h('div', box(850, 656, 22, 50, { text: '7', fs: 48, fw: 800 })),
        h('div', box(888, 651, 60, 60, { cls: 'resume-last-matchup__teamLogo' }),
          h('img', box(888, 651, 60, 60, { attrs: { alt: 'Team Logo', src: 'https://cdn.example/logos/site.png' } }))),
        h('div', box(1030, 673, 16, 16, { cls: 's-stamp' }), h('span', box(1032, 670, 12, 21, { text: 'at' }))),
        h('div', box(1112, 651, 60, 60, { cls: 'resume-last-matchup__teamLogo' }),
          h('img', box(1112, 651, 60, 60, { attrs: { alt: 'Opponent Logo', src: 'https://cdn.example/logos/Kentucky.png' } }))),
        h('div', box(1188, 656, 49, 50, { text: '38', fs: 48, fw: 800 })),
      ),
      h('div', box(761, 719, 565, 140, { cls: 'last-matchup-table' }), lineScore),
      h('div', box(917, 891, 252, 37),
        h('a', box(917, 891, 141, 37, { attrs: { href: '/boxscore/27203' } }), h('span', box(935, 899, 105, 21, { text: 'Full Boxscore' }))),
        h('a', box(1075, 891, 95, 37, { attrs: { href: '/news/recap' } }), h('span', box(1093, 899, 59, 21, { text: 'Recap' }))),
      ),
    ),
  );
  const record = h('div', box(81, 478, 631, 534, { cls: 'c-opponent-history-detail-page__top-left grid' }),
    h('div', box(81, 478, 631, 162, { cls: 'grid md:grid-cols-2' }), statCard(81, 478, 'Wins', '54'), statCard(405, 478, 'Losses', '22')),
    h('div', box(81, 656, 631, 162, { cls: 'grid md:grid-cols-2' }), statCard(81, 656, 'Home Record', '30-6'), statCard(405, 656, 'Away Record', '22-13')),
    h('div', box(81, 834, 631, 178, { cls: 'grid md:grid-cols-2' }), statCard(81, 834, 'Conference Record', '54-21'), statCard(405, 834, 'Streak', 'L1')),
  );
  const more = h('div', box(81, 1028, 1278, 191, { cls: 'c-opponent-history-detail-page__bottom grid' }),
    h('div', box(81, 1028, 631, 191, { cls: 'grid md:grid-cols-3' }),
      statCard(81, 1028, 'First Matchup', 'L 0-52', '11/29/1917'),
      statCard(297, 1028, 'Last 10 Matchups', '5-5', '9/10/2016 - 11/8/2025'),
      statCard(512, 1028, 'Largest Margin of Victory', 'W 73-7', '9/10/1994')),
    h('div', box(728, 1028, 631, 191, { cls: 'grid md:grid-cols-3' }),
      statCard(728, 1028, 'Smallest Margin of Victory', 'W 28-27', '9/23/2017'),
      statCard(944, 1028, 'Total Points', '2071'),
      statCard(1159, 1028, 'Average Points', '27')),
  );
  return h('div', box(81, 478, 1278, 741, { cls: 'c-opponent-history-detail-page__resume flex flex-col' }),
    h('div', box(81, 478, 1278, 534, { cls: 'c-opponent-history-detail-page__top grid' }), lastMatchup, record),
    more,
  );
}

/** The history table under it (a few rows), with its title just before. */
export function gatorsHistory(): SNode {
  const rows: Array<[string, string, string, string]> = [
    ['Saturday, November 8', '2025', 'Away Lexington, Ky.', 'L 7-38'],
    ['Saturday, October 19', '2024', 'Home Gainesville, Fla.', 'W 48-20'],
    ['Saturday, September 30', '2023', 'Away Lexington, Ky.', 'L 14-33'],
    ['Saturday, September 10', '2022', 'Home Gainesville, Fla.', 'L 16-26'],
  ];
  const cell = (y: number, x: number, t: string) => h('td', box(x, y, 160, 36), h('span', box(x + 10, y + 8, 120, 20, { text: t })));
  const links = (y: number) => h('td', box(1189, y, 169, 36), h('div', box(1200, y + 8, 148, 21, { cls: 's-dropdown' }),
    h('button', box(1200, y + 8, 58, 21, { attrs: { label: 'Links for game' } }), h('span', box(1200, y + 8, 32, 21, { text: 'Links' })))));
  return h('div', box(81, 1251, 1278, 400, { cls: 'c-opponent-history-detail-page__results' }),
    h('div', box(81, 1251, 1278, 26, { text: 'History from November 29, 1917 - November 8, 2025', fs: 22, fw: 700 })),
    h('div', box(81, 1309, 1278, 330, { cls: 's-table' }),
      h('table', box(82, 1310, 1276, 330),
        h('thead', box(82, 1310, 1276, 36), h('tr', box(82, 1310, 1276, 36),
          ...['Date', 'Season', 'Location', 'Score', 'Media'].map((t, i) => h('th', box(82 + i * 240, 1310, 240, 36), h('span', box(93 + i * 240, 1319, 50, 21, { text: t })))))),
        h('tbody', box(82, 1346, 1276, 290),
          ...rows.map((r, i) => {
            const y = 1346 + i * 36;
            return h('tr', box(82, y, 1276, 36), cell(y, 82, r[0]), cell(y, 446, r[1]), cell(y, 611, r[2]), cell(y, 994, r[3]), links(y));
          }),
        ),
      ),
    ),
  );
}
