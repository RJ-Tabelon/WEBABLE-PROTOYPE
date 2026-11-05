// Owner: X (round 7). Structured content read on the device: stats, scoreboards, tables, schedules, logos, regions.
import { describe, expect, it } from 'vitest';
import { extractPage } from './index';
import { chromeOf, findRegions } from './regions';
import { findScoreboards } from './scoreboard';
import { findCards, groupCards, statsItems } from './stats';
import { findScheduleCards, readTable, scheduleFromTable, tableItem } from './table';
import { box, find, gatorsHistory, gatorsResume, h } from './testkit';
import { link, textLeaves, textOf } from './text';
import { findSiteLogo, isHomeHref } from './logos';
import type { SNode } from './types';

const none = () => false;

function gatorsPage(): { root: SNode; main: SNode } {
  const header = h('header', box(0, 0, 1440, 270, { cls: 'site-header' }),
    h('a', box(48, 129, 112, 71, { attrs: { href: '/' } }), h('img', box(48, 129, 112, 71, { attrs: { alt: 'Florida Gators', src: 'https://cdn.example/main_nav_logo.svg' } }))),
    h('nav', box(400, 140, 900, 40, { attrs: { label: 'Main' } }), h('a', box(400, 140, 80, 30, { text: 'Sports', attrs: { href: '/sports' } }))),
  );
  const pageHead = h('div', box(48, 294, 1344, 93, { cls: 'opponent-history-page__header' }),
    h('h1', box(48, 310, 233, 30, { text: 'Opponent History', fs: 28, fw: 700 })),
    h('a', box(1225, 294, 167, 61, { attrs: { href: '/history' } }), h('span', box(1259, 314, 99, 21, { text: 'Back To History' }))),
  );
  const news = h('div', box(48, 4933, 1344, 487, { cls: 's-stories-module' }),
    h('h2', box(81, 4970, 131, 38, { text: 'Related News', fs: 24, fw: 700 })),
    h('div', box(81, 5041, 1278, 264, { cls: 's-stories__content-grid' }),
      ...[0, 1, 2, 3].map((i) => h('div', box(81 + i * 324, 5041, 308, 264, { cls: 's-card' }),
        h('a', box(81 + i * 324, 5041, 308, 173, { attrs: { href: `/news/${i}` } }), h('img', box(81 + i * 324, 5041, 308, 173, { attrs: { alt: 'Story', src: `https://cdn.example/s${i}.jpg` } }))),
        h('a', box(81 + i * 324, 5230, 308, 45, { attrs: { href: `/news/${i}` } }), h('span', box(81 + i * 324, 5230, 308, 45, { text: i === 0 ? 'SEC Nation set for Florida-Georgia Game' : `Story number ${i} about the team` }))),
        h('div', box(81 + i * 324, 5283, 308, 23, { text: 'Saturday, October 24' })),
      )),
    ),
  );
  const content = h('div', box(48, 387, 1344, 3996, { cls: 'c-opponent-history-detail-page__content' }),
    h('div', box(81, 420, 1278, 26, { text: 'Football History vs University of Kentucky from November 29, 1917 - November 8, 2025', fs: 22, fw: 700 })),
    h('div', box(81, 478, 1278, 3855, { cls: 'c-opponent-history-detail-page__body' }), gatorsResume(), gatorsHistory()),
  );
  const main = h('main', box(48, 294, 1344, 5126, { cls: 'main-content' }), pageHead, h('div', box(48, 387, 1344, 5033), content, news));
  const footer = h('section', box(0, 5476, 1440, 173, { cls: 'site-footer' }), h('a', box(48, 5500, 64, 23, { text: 'Contact', attrs: { href: '/contact' } })));
  const root = h('body', box(0, 0, 1440, 5945), header, h('div', box(0, 0, 1440, 5476, { cls: 'sidearm-wrapper' }), main), footer);
  return { root, main };
}

describe('textOf and textLeaves', () => {
  it('puts direct text after the child it follows', () => {
    const p = h('p', { text: 'The sought to clear up', segs: [[0, 'The'], [1, 'sought to clear up']] }, h('a', 'Knicks'));
    link(p);
    expect(textOf(p)).toBe('The Knicks sought to clear up');
  });
  it('keeps a one-line inline run as one leaf and skips the skipped', () => {
    const cell = h('div', box(0, 0, 60, 21), h('span', box(0, 1, 8, 20, { text: 'L' })), h('span', box(12, 1, 30, 20, { text: '7-38' })));
    link(cell);
    expect(textLeaves(cell).map(textOf)).toEqual(['L 7-38']);
    const row = h('div', box(0, 0, 600, 160), h('div', box(0, 0, 300, 160), h('div', 'Wins'), h('div', '54')), h('div', box(300, 0, 300, 160), h('div', 'Losses')));
    link(row);
    const first = row.kids[0] as SNode;
    expect(textLeaves(row, [], (x) => x === first).map(textOf)).toEqual(['Losses']);
  });
});

describe('stats', () => {
  it('reads the record grid and the more-stats grid as two groups, never the scoreboard', () => {
    const { root } = gatorsPage();
    link(root);
    const cards = findCards(root, { excluded: none });
    expect(cards.map((c) => `${c.label}=${c.value}`)).toEqual([
      'Wins=54', 'Losses=22', 'Home Record=30-6', 'Away Record=22-13', 'Conference Record=54-21', 'Streak=L1',
      'First Matchup=L 0-52', 'Last 10 Matchups=5-5', 'Largest Margin of Victory=W 73-7', 'Smallest Margin of Victory=W 28-27',
      'Total Points=2071', 'Average Points=27',
    ]);
    expect(cards.find((c) => c.label === 'Last 10 Matchups')?.sub).toBe('9/10/2016 - 11/8/2025');
    const groups = groupCards(cards, { excluded: none, blocked: none });
    expect(groups.map((g) => g.cards.length)).toEqual([6, 6]);
    expect(groups[0]?.root.cls).toContain('top-left');
    expect(groups[0]?.title).toBeUndefined();
    const items = statsItems(groups);
    expect(items[0]?.data).toMatchObject({ kind: 'stats', items: [{ label: 'Wins', value: '54' }, { label: 'Losses', value: '22' }, {}, {}, {}, {}] });
  });

  it('reads "Prep Time: 20 mins" style details, and leaves cards with buttons alone', () => {
    const details = h('div', box(0, 0, 550, 134),
      ...[['Prep Time:', '20 mins'], ['Cook Time:', '10 mins'], ['Servings:', '48'], ['Yield:', '4 dozen cookies']].map(([l, v], i) =>
        h('div', box(i * 140, 0, 130, 55), h('div', box(i * 140, 0, 130, 27, { text: l })), h('div', box(i * 140, 27, 130, 28, { text: v })))),
    );
    const products = h('ul', box(0, 300, 900, 260),
      ...[0, 1, 2, 3].map((i) => h('li', box(i * 200, 300, 187, 259),
        h('a', box(i * 200, 340, 160, 34, { text: `Product ${i} with a name`, attrs: { href: `/p/${i}` } })),
        h('span', box(i * 200, 380, 160, 20, { text: `$${i + 3}.49` })),
        h('button', box(i * 200, 410, 160, 32, { text: 'Add' })))),
    );
    const root = h('body', box(0, 0, 1000, 800), details, products);
    link(root);
    const cards = findCards(root, { excluded: none });
    expect(cards.map((c) => `${c.label}|${c.value}`)).toEqual(['Prep Time|20 mins', 'Cook Time|10 mins', 'Servings|48', 'Yield|4 dozen cookies']);
  });
});

describe('scoreboard', () => {
  it('reads both sides with logos, names from the line score, the joiner, label, date and periods', () => {
    const resume = gatorsResume();
    link(resume);
    const items = findScoreboards(resume, { excluded: none });
    expect(items).toHaveLength(1);
    const it0 = items[0];
    expect(it0?.node.cls).toContain('top-right');
    expect(it0?.data).toEqual({
      kind: 'scoreboard',
      label: 'Last Matchup',
      date: '11/8/2025',
      joiner: 'at',
      sides: [
        { name: 'Florida', score: '7', logoSrc: 'https://cdn.example/logos/site.png', logoAlt: 'Team Logo', side: 'away', winner: false },
        { name: 'Kentucky', score: '38', logoSrc: 'https://cdn.example/logos/Kentucky.png', logoAlt: 'Opponent Logo', side: 'home', winner: true },
      ],
      periods: {
        labels: ['1', '2', '3', '4', 'F'],
        rows: [{ name: 'Florida', values: ['7', '0', '0', '0', '7'] }, { name: 'Kentucky', values: ['3', '21', '7', '7', '38'] }],
      },
    });
    expect(it0?.logoNodes?.map((l) => l?.attrs?.alt)).toEqual(['Team Logo', 'Opponent Logo']);
  });

  it('needs two logos and two scores', () => {
    const one = h('div', box(0, 0, 400, 60), h('img', box(0, 0, 60, 60, { attrs: { alt: 'Texas logo', src: 'x.png' } })), h('div', box(80, 0, 30, 40, { text: '27' })), h('div', box(120, 0, 30, 40, { text: '24' })));
    link(one);
    expect(findScoreboards(one, { excluded: none })).toEqual([]);
  });
});

describe('tables', () => {
  it('reads a data table with its title, drops the repeated "Links" column, marks number columns', () => {
    const hist = gatorsHistory();
    link(hist);
    const table = find(hist, (n) => n.tag === 'table') as SNode;
    const read = readTable(table);
    expect(read?.columns).toEqual(['Date', 'Season', 'Location', 'Score']);
    expect(read?.rows[0]).toEqual(['Saturday, November 8', '2025', 'Away Lexington, Ky.', 'L 7-38']);
    expect(read?.numericCols).toEqual([1, 3]);
    expect(read?.caption).toBe('History from November 29, 1917 - November 8, 2025');
    expect(tableItem(read!).kind).toBe('table');
  });

  it('turns a table with date and opponent columns into a schedule', () => {
    const sched = scheduleFromTable({
      columns: ['Date', 'Opponent', 'Location', 'Result'],
      rows: [['Oct 10', 'vs South Carolina', 'Gainesville', 'W 38-19'], ['Oct 17', 'at #7 Texas', 'Austin', 'L 24-27']],
      numericCols: [], rowNodes: [],
    });
    expect(sched).toEqual({
      kind: 'schedule',
      items: [
        { date: 'Oct 10', title: 'vs South Carolina', detail: 'Gainesville', result: 'W 38-19' },
        { date: 'Oct 17', title: 'at #7 Texas', detail: 'Austin', result: 'L 24-27' },
      ],
    });
  });

  it('reads a schedule made of cards, and never news teasers', () => {
    const games = h('div', box(0, 0, 1200, 120),
      ...[['Oct 10', 'vs South Carolina', 'W 38-19'], ['Oct 17', 'at #7 Texas', 'L 24-27'], ['Oct 31', 'vs #5 Georgia', '3:30 p.m.']].map(([d, o, r], i) =>
        h('div', box(i * 380, 0, 370, 110), h('span', box(i * 380, 0, 60, 20, { text: d as string })), h('span', box(i * 380, 40, 200, 20, { text: o as string })), h('span', box(i * 380, 70, 80, 20, { text: r as string })))),
    );
    const news = h('div', box(0, 200, 1200, 260),
      ...[0, 1, 2].map((i) => h('div', box(i * 380, 200, 370, 250), h('a', box(i * 380, 200, 370, 40, { text: `Story ${i} headline here`, attrs: { href: '/n' } })), h('div', box(i * 380, 250, 200, 20, { text: 'Saturday, October 24' })))),
    );
    const root = h('body', box(0, 0, 1200, 600), games, news);
    link(root);
    const found = findScheduleCards(root, none);
    expect(found).toHaveLength(1);
    expect(found[0]?.data).toEqual({ kind: 'schedule', items: [
      { date: 'Oct 10', title: 'vs South Carolina', result: 'W 38-19' },
      { date: 'Oct 17', title: 'at #7 Texas', result: 'L 24-27' },
      { date: 'Oct 31', title: 'vs #5 Georgia', result: '3:30 p.m.' },
    ] });
  });

  it('ignores layout tables', () => {
    const t = h('table', box(0, 0, 800, 400), h('tr', {}, h('td', {}, h('table', {}, h('tr', {}, h('td', 'a'), h('td', 'b'))))), h('tr', {}, h('td', 'x'), h('td', 'y')));
    link(t);
    expect(readTable(t)).toBeNull();
  });
});

describe('logos', () => {
  it('finds the site mark in a home link and names it', () => {
    const { root } = gatorsPage();
    link(root);
    const site = findSiteLogo(root, 'https://floridagators.com/sports/football/opponent-history/x/32', 'Florida Gators');
    expect(site?.holder.tag).toBe('a');
    expect(site?.label).toBe('Florida Gators');
    expect(isHomeHref('/', 'https://www.example.com/a/b')).toBe(true);
    expect(isHomeHref('https://example.com/index.html', 'https://www.example.com/a')).toBe(true);
    expect(isHomeHref('/news', 'https://example.com/a')).toBe(false);
  });
});

describe('regions', () => {
  it('leaves out site chrome and keeps the record block whole', () => {
    const { root, main } = gatorsPage();
    const nodes = link(root);
    const chrome = chromeOf(nodes, main, root.h);
    expect([...chrome].map((c) => c.tag).sort()).toEqual(['header', 'section']);
  });

  it('extractPage: the Gators page yields its data, logos and 4-12 regions with the record block as one', () => {
    const { root, main } = gatorsPage();
    const ex = extractPage({ root, main, ld: [], siteName: 'Florida Gators', url: 'https://floridagators.com/sports/football/opponent-history/university-of-kentucky/32', vw: 1440, vh: 900 });
    const kinds = ex.items.map((i) => i.data.kind);
    expect(kinds.filter((k) => k === 'stats')).toHaveLength(2);
    expect(kinds).toContain('scoreboard');
    expect(kinds).toContain('table');
    const logos = ex.items.filter((i) => i.data.kind === 'logo').map((i) => (i.data.kind === 'logo' ? i.data.label : ''));
    expect(logos).toEqual(['Florida Gators', 'Florida', 'Kentucky']);
    expect(ex.regions.length).toBeGreaterThanOrEqual(4);
    expect(ex.regions.length).toBeLessThanOrEqual(12);
    const record = ex.regions.find((r) => r.cls.includes('__resume'));
    expect(record).toBeDefined();
    expect(ex.regionNotes.get(record as SNode)).toContain('scoreboard with 2 team logos and a line score');
    expect(ex.regionNotes.get(record as SNode)).toContain('number cards x12 in 2 groups');
    // The news teasers are their own region, never inside the record block.
    const newsRegion = ex.regions.find((r) => r.cls.includes('stories'));
    expect(newsRegion).toBeDefined();
    expect(ex.regions.some((r) => r.tag === 'header' || r.cls.includes('site-footer'))).toBe(false);
    expect(ex.article).toBeNull();
  });

  it('never goes past 12 regions and never splits a unit', () => {
    const many = h('body', box(0, 0, 1200, 6000),
      ...Array.from({ length: 20 }, (_v, i) => h('section', box(0, i * 300, 1200, 280), h('h2', box(0, i * 300, 600, 30, { text: `Section ${i}` })), h('p', box(0, i * 300 + 40, 1200, 200, { text: 'Some words in this section that make it real content for a person reading.' })))),
    );
    link(many);
    const regions = findRegions(many, { excluded: none, units: new Set() });
    expect(regions.length).toBeLessThanOrEqual(12);
    const table = h('body', box(0, 0, 1200, 3000), h('table', box(0, 0, 1200, 2000), h('tr', box(0, 0, 1200, 1000), h('td', box(0, 0, 600, 1000, { text: 'cell one text here' })), h('td', box(600, 0, 600, 1000, { text: 'cell two text here' })))), h('div', box(0, 2000, 1200, 900, { text: 'After the table, more text for the page.' })));
    link(table);
    expect(findRegions(table, { excluded: none, units: new Set() }).map((r) => r.tag)).toEqual(['table', 'div']);
  });
});
