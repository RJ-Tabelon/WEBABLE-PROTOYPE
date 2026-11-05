// Owner: P (round 7). Pure parts of the meaning-first Calm view: which page elements a component already draws, and
// structured content mapped to the components' props.
import { describe, expect, it } from 'vitest';
import type { ExtractedData } from '@webable/core';
import { type CoverTree, contentShare, coverTree, tokens, wordsCovered } from './cover';
import {
  COMPONENT_WORDS, dataStrings, dataTableProps, isNumberLike, recipeProps, safePictureSrc, scheduleProps, scoreboardProps, statGridProps,
} from './purpose-props';

/** A tiny page tree: text is the element's whole visible text, like innerText. */
interface T { tag: string; own?: string; kids?: T[]; control?: boolean }
const textOf = (n: T): string => [n.own ?? '', ...(n.kids ?? []).map(textOf)].filter(Boolean).join(' ');
const TREE: CoverTree<T> = {
  text: textOf,
  children: (n) => n.kids ?? [],
  isControl: (n) => !!n.control,
  isTable: (n) => n.tag === 'table',
};
const words = (d: ExtractedData): Set<string> => new Set([...dataStrings(d).flatMap((s) => tokens(s)), ...COMPONENT_WORDS[d.kind]]);
const own = (d: ExtractedData): Set<string> => new Set(dataStrings(d).flatMap((s) => tokens(s)));

const STATS: ExtractedData = {
  kind: 'stats', items: [{ label: 'Wins', value: '54' }, { label: 'Losses', value: '22' }, { label: 'Home Record', value: '30-6' }, { label: 'Away Record', value: '22-13' }],
};
const BOARD: ExtractedData = {
  kind: 'scoreboard', label: 'Last Matchup', date: '11/8/2025', joiner: 'at',
  sides: [{ name: 'Florida', score: '7', logoSrc: 'https://floridagators.com/logos/uf.png' }, { name: 'Kentucky', score: '38', logoSrc: 'javascript:alert(1)' }],
  periods: { labels: ['1', '2', '3', '4', 'F'], rows: [{ name: 'Florida', values: ['7', '0', '0', '0', '7'] }, { name: 'Kentucky', values: ['10', '14', '7', '7', '38'] }] },
};

describe('words', () => {
  it('keeps numbers whole and drops accents', () => {
    expect(tokens('Home Record 30-6')).toEqual(['home', 'record', '30-6']);
    expect(tokens('Last Matchup 11/8/2025')).toEqual(['last', 'matchup', '11/8/2025']);
    expect(tokens('Crème brûlée, 2.5 cups')).toEqual(['creme', 'brulee', '2.5', 'cups']);
  });
  it('covers an element only when its words are the content’s', () => {
    const set = words(STATS);
    expect(wordsCovered(tokens('Wins 54'), set)).toBe(true);
    expect(wordsCovered(tokens('Back To History'), set)).toBe(false);
    expect(wordsCovered(tokens('Full Box Score'), words(BOARD))).toBe(false);
  });
  it('measures how much of the content an element holds', () => {
    expect(contentShare(tokens('Wins 54 Losses 22 Home Record 30-6 Away Record 22-13'), own(STATS))).toBeGreaterThan(0.9);
    expect(contentShare(tokens('Related News SEC Nation set for Florida-Georgia Game'), own(STATS))).toBeLessThan(0.2);
  });
});

describe('what a component already draws', () => {
  // The Gators main box: the title, the record cards, the scoreboard with its links, and the related news rail.
  const card = (label: string, value: string): T => ({ tag: 'div', kids: [{ tag: 'h3', own: label }, { tag: 'span', own: value }] });
  const main: T = {
    tag: 'section',
    kids: [
      { tag: 'h1', own: 'Opponent History' },
      { tag: 'div', kids: [card('Wins', '54'), card('Losses', '22'), card('Home Record', '30-6'), card('Away Record', '22-13')] },
      { tag: 'div', own: 'Related News', kids: [{ tag: 'a', own: 'SEC Nation set for Florida-Georgia Game', control: true }, { tag: 'img' }] },
    ],
  };

  it('covers the record cards, never the title or the news rail', () => {
    const { covered } = coverTree(main, TREE, words(STATS));
    expect(covered).toEqual([main.kids![1]]);
  });

  it('covers a scoreboard and hands its "Full Box Score" link back to go with it', () => {
    const link: T = { tag: 'a', own: 'Full Box Score', control: true };
    const board: T = {
      tag: 'div',
      kids: [
        { tag: 'p', own: 'Last Matchup' }, { tag: 'p', own: '11/8/2025' },
        { tag: 'div', kids: [{ tag: 'span', own: '7' }, { tag: 'img' }, { tag: 'span', own: 'at' }, { tag: 'img' }, { tag: 'span', own: '38' }] },
        { tag: 'table', kids: [{ tag: 'tr', own: '1 2 3 4 F' }, { tag: 'tr', own: 'Florida 7 0 0 0 7' }, { tag: 'tr', own: 'Kentucky 10 14 7 7 38' }] },
        link,
      ],
    };
    const { covered, orphans } = coverTree(board, TREE, words(BOARD));
    expect(covered).toEqual([board]);
    expect(orphans).toEqual([link]);
  });

  it('never swallows words that are not the content (a note beside the score stays on its own)', () => {
    const note: T = { tag: 'p', own: 'Kentucky snapped a long losing streak in this series' };
    const board: T = { tag: 'div', kids: [{ tag: 'p', own: 'Last Matchup 11/8/2025' }, { tag: 'p', own: 'Florida 7 at Kentucky 38' }, note] };
    const { covered } = coverTree(board, TREE, words(BOARD));
    expect(covered).not.toContain(board);
    expect(covered).not.toContain(note);
    expect(covered).toHaveLength(2);
  });

  it('takes a table whose rows carry buttons, and hands the buttons back', () => {
    const btn = (d: string): T => ({ tag: 'button', own: `Links for game on ${d}`, control: true });
    const table: T = {
      tag: 'table',
      kids: [
        { tag: 'tr', own: 'Date Location Result Score' },
        { tag: 'tr', own: '11/8/2025 Lexington L 7-38', kids: [btn('11/8/2025')] },
        { tag: 'tr', own: '11/9/2024 Gainesville W 48-20', kids: [btn('11/9/2024')] },
        { tag: 'tr', own: '9/30/2023 Lexington L 14-33', kids: [btn('9/30/2023')] },
      ],
    };
    const d: ExtractedData = {
      kind: 'table', columns: ['Date', 'Location', 'Result', 'Score'],
      rows: [['11/8/2025', 'Lexington', 'L', '7-38'], ['11/9/2024', 'Gainesville', 'W', '48-20'], ['9/30/2023', 'Lexington', 'L', '14-33']],
    };
    const res = coverTree(table, TREE, words(d));
    expect(res.covered).toEqual([table]);
    expect(res.orphans).toHaveLength(3);
  });
});

describe('props for the components', () => {
  it('the record leads with wins and losses', () => {
    const p = statGridProps(STATS as Extract<ExtractedData, { kind: 'stats' }>);
    expect(p.items.map((x) => x.emphasis)).toEqual(['lead', 'lead', 'normal', 'normal']);
    expect(p.items[2]).toMatchObject({ label: 'Home Record', value: '30-6' });
    expect(statGridProps(STATS as Extract<ExtractedData, { kind: 'stats' }>, { lead: false }).items.every((x) => x.emphasis === 'normal')).toBe(true);
  });

  it('a stats title that only repeats its own numbers is left out', () => {
    const d = { ...STATS, title: 'Wins 54 Losses 22' } as Extract<ExtractedData, { kind: 'stats' }>;
    expect(statGridProps(d).title).toBeUndefined();
    expect(statGridProps({ ...d, title: 'All-time series' }).title).toBe('All-time series');
  });

  it('the scoreboard says who won and keeps only safe logos', () => {
    const p = scoreboardProps(BOARD as Extract<ExtractedData, { kind: 'scoreboard' }>, 'https://floridagators.com');
    expect(p.sides.map((s) => s.winner)).toEqual([false, true]);
    expect(p.sides[0]!.logo).toEqual({ src: 'https://floridagators.com/logos/uf.png', alt: 'Florida logo', ratio: 1 });
    expect(p.sides[1]!.logo).toBeUndefined();
    expect(p.periods?.rows[1]!.values).toEqual(['10', '14', '7', '7', '38']);
    expect(p).toMatchObject({ label: 'Last Matchup', date: '11/8/2025', joiner: 'at' });
  });

  it('tables right-align their number columns and show the first rows', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [`${i + 1}/1/2000`, 'Gainesville', i % 2 ? 'W' : 'L', `${i}-${i + 3}`]);
    const p = dataTableProps({ kind: 'table', columns: ['Date', 'Location', 'Result', 'Score'], rows }, { showFirst: 10 });
    expect(p.numericCols).toEqual([0, 3]);
    expect(p.showFirst).toBe(10);
    expect(dataTableProps({ kind: 'table', columns: ['a', 'b'], rows: [['1', '2'], ['3', '4']] }, { showFirst: 10 }).showFirst).toBeUndefined();
  });

  it('schedule rows press the original element', () => {
    let pressed = '';
    const p = scheduleProps(
      { kind: 'schedule', items: [{ date: 'Oct 10', title: 'vs South Carolina', result: 'L 19-38', nodeId: 'n7' }, { date: 'Oct 17', title: 'at Texas' }] },
      (id) => () => { pressed = id; },
    );
    p.items[0]!.onActivate!();
    expect(pressed).toBe('n7');
    expect(p.items[1]!.onActivate).toBeUndefined();
  });

  it('recipes keep every ingredient and step', () => {
    const p = recipeProps({
      kind: 'recipe', title: 'Best Chocolate Chip Cookies', imageSrc: 'https://www.allrecipes.com/cookies.jpg',
      meta: [{ label: 'Prep', value: '20 mins' }, { label: 'Servings', value: '24' }],
      ingredients: ['1 cup butter, softened', '1 cup white sugar', '2 eggs'], steps: ['Preheat the oven to 350 degrees F.', 'Beat butter and sugar.'],
    }, 'https://www.allrecipes.com');
    expect(p.ingredients).toHaveLength(3);
    expect(p.steps).toHaveLength(2);
    expect(p.picture?.src).toBe('https://www.allrecipes.com/cookies.jpg');
    expect(p.meta).toEqual([{ label: 'Prep', value: '20 mins' }, { label: 'Servings', value: '24' }]);
  });

  it('pictures only from safe addresses', () => {
    expect(safePictureSrc('javascript:alert(1)')).toBeNull();
    expect(safePictureSrc('http://evil.example/x.png', 'https://floridagators.com')).toBeNull();
    expect(safePictureSrc('/images/uf.png', 'https://floridagators.com')).toBe('https://floridagators.com/images/uf.png');
    expect(safePictureSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('knows numbers when it sees them', () => {
    for (const s of ['54', '30-6', '$4.00', '12.5%', '7:30', '11/8']) expect(isNumberLike(s)).toBe(true);
    for (const s of ['Lexington, Ky.', 'W', 'Florida']) expect(isNumberLike(s)).toBe(false);
  });
});
