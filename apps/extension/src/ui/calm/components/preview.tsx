// Owner: Alfred (round 7). Sample page for the six Calm components.
// Series record, the Nov 8 2025 score, and the game list are the figures on Florida's Kentucky opponent-history page.
// Quarter scores: Florida 7-0-0-0, Kentucky 3-21-7-7 (that game's box score). The recipe text is a short sample, not a copied page.
// Letter marks stand in for the team logos so the preview does not depend on another site's images.
import { render } from 'preact';
import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { tokensFor, tokensToStyle } from '../../tokens';
import { DataTable, LogoMark, Recipe, ScheduleList, Scoreboard, StatGrid, componentsCss } from './index';
import type { Picture, RecipeProps, ScheduleItem, ScoreboardProps, StatItem } from './types';

function mark(letter: string, background: string, alt: string): Picture {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="${background}"/><text x="32" y="43" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#FFFFFF">${letter}</text></svg>`;
  return { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, alt, ratio: 1 };
}

const floridaMark = mark('F', '#0021A5', 'Florida');
const kentuckyMark = mark('K', '#0033A0', 'Kentucky');

const cookieSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><circle cx="600" cy="400" r="280" fill="#C4893A"/><circle cx="500" cy="330" r="32" fill="#3B2618"/><circle cx="680" cy="360" r="28" fill="#3B2618"/><circle cx="560" cy="470" r="26" fill="#3B2618"/><circle cx="720" cy="480" r="22" fill="#3B2618"/><circle cx="470" cy="450" r="18" fill="#3B2618"/></svg>`;

const cookiePicture: Picture = {
  src: `data:image/svg+xml,${encodeURIComponent(cookieSvg)}`,
  alt: 'A chocolate chip cookie',
  ratio: 3 / 2,
};

export const gatorsStats: StatItem[] = [
  { label: 'Wins', value: '54', sub: 'since 1917', emphasis: 'lead' },
  { label: 'Losses', value: '22', emphasis: 'lead' },
  { label: 'Home record', value: '30-6' },
  { label: 'Away record', value: '22-13' },
];

export const gatorsScore: ScoreboardProps = {
  label: 'Last matchup',
  date: '11/8/2025',
  joiner: 'at',
  sides: [
    { name: 'Florida', score: '7', side: 'away', winner: false, logo: floridaMark },
    { name: 'Kentucky', score: '38', side: 'home', winner: true, logo: kentuckyMark },
  ],
  periods: {
    labels: ['1', '2', '3', '4'],
    rows: [
      { name: 'Florida', values: ['7', '0', '0', '0'] },
      { name: 'Kentucky', values: ['3', '21', '7', '7'] },
    ],
  },
};

/** Date, season, location, score, and optional media, as the opponent-history table lists them. Ad rows are left out. */
const GAME_LINES = `
Saturday, November 8 | 2025 | Away Lexington, Ky. | L 7-38 |
Saturday, October 19 | 2024 | Home Gainesville, Fla. | W 48-20 |
Saturday, September 30 | 2023 | Away Lexington, Ky. | L 14-33 |
Saturday, September 10 | 2022 | Home Gainesville, Fla. | L 16-26 |
Saturday, October 2 | 2021 | Away Lexington, Ky. | L 13-20 |
Saturday, November 28 | 2020 | Home Gainesville, FL | W 34-10 |
Saturday, September 14 | 2019 | Away Lexington, KY | W 29-21 |
Saturday, September 8 | 2018 | Home Gainesville, FL | L 16-27 |
Saturday, September 23 | 2017 | Away Lexington, KY | W 28-27 |
Saturday, September 10 | 2016 | Home Gainesville, FL | W 45-7 |
Saturday, September 19 | 2015 | Away Lexington, Ky. | W 14-9 |
Saturday, September 13 | 2014 | Home Gainesville, FL | OT W 36-30 |
Saturday, September 28 | 2013 | Away Lexington, KY | W 24-7 |
Saturday, September 22 | 2012 | Home Gainesville, FL | W 38-0 |
Saturday, September 24 | 2011 | Away Lexington, KY | W 48-10 |
Saturday, September 25 | 2010 | Home Gainesville, FL | W 48-14 |
Saturday, September 26 | 2009 | Away Lexington, KY | W 41-7 |
Saturday, October 25 | 2008 | Home Gainesville, FL | W 63-5 |
Saturday, October 20 | 2007 | Away Lexington, KY | W 45-37 |
Saturday, September 23 | 2006 | Home Gainesville, FL | W 26-7 |
Saturday, September 24 | 2005 | Away Lexington, KY | W 49-28 |
Saturday, September 25 | 2004 | Home Gainesville, FL | W 20-3 |
Saturday, September 27 | 2003 | Away Lexington,KY | W 24-21 |
Saturday, September 28 | 2002 | Home Gainesville, FL | W 41-34 |
Saturday, September 22 | 2001 | Away Lexington, KY | W 44-10 |
Saturday, September 23 | 2000 | Home Gainesville, FL | W 59-31 |
Saturday, September 25 | 1999 | Away Lexington, KY | W 38-10 |
Saturday, September 26 | 1998 | Home Gainesville, FL | W 51-35 | Boxscore
Saturday, September 27 | 1997 | Away Lexington, KY | W 55-28 |
Saturday, September 28 | 1996 | Home Gainesville, FL | W 65-0 |
Saturday, September 9 | 1995 | Away Lexington, KY | W 42-7 |
Saturday, September 10 | 1994 | Home Gainesville, FL | W 73-7 |
Saturday, September 11 | 1993 | Away Lexington, KY | W 24-20 |
Saturday, September 12 | 1992 | Home Gainesville, FL | W 35-19 |
Saturday, November 16 | 1991 | Home Gainesville, FL | W 35-26 |
Saturday, November 17 | 1990 | Away Lexington, KY | W 47-15 |
Saturday, November 18 | 1989 | Home Gainesville, FL | W 38-28 |
Saturday, November 12 | 1988 | Away Lexington, KY | W 24-19 |
Saturday, November 14 | 1987 | Home Gainesville, FL | W 27-14 |
Saturday, November 15 | 1986 | Away Lexington, KY | L 3-10 |
Saturday, November 16 | 1985 | Home Gainesville, FL | W 15-13 |
Saturday, November 17 | 1984 | Away Lexington, KY | W 25-17 |
Saturday, November 12 | 1983 | Home Gainesville, FL | W 24-7 |
Saturday, November 13 | 1982 | Away Lexington, KY | W 39-13 |
Saturday, November 14 | 1981 | Home Gainesville, FL | W 33-12 |
Saturday, November 15 | 1980 | Away Lexington, KY | W 17-15 |
Saturday, November 17 | 1979 | Home Gainesville, FL | L 3-31 |
Saturday, November 18 | 1978 | Away Lexington, KY | W 18-16 |
Saturday, November 12 | 1977 | Home Gainesville, FL | L 7-14 |
Saturday, November 13 | 1976 | Away Lexington, KY | L 9-28 |
Saturday, November 15 | 1975 | Home Gainesville, FL | W 48-7 |
Saturday, November 16 | 1974 | Away Lexington, KY | L 41-24 |
Saturday, November 17 | 1973 | Home Gainesville, FL | W 20-18 |
Saturday, November 18 | 1972 | Home Gainesville, FL | W 40-0 |
Saturday, November 13 | 1971 | Home Gainesville, FL | W 35-24 |
Saturday, November 14 | 1970 | Neutral Tampa, FL | W 24-13 |
Saturday, November 15 | 1969 | Home Gainesville, FL | W 31-6 |
Saturday, November 16 | 1968 | Away Lexington, KY | W 16-14 |
Saturday, November 18 | 1967 | Home Gainesville, FL | W 28-12 |
Saturday, October 5 | 1957 | Away Lexington, KY | W 14-7 |
Saturday, October 6 | 1956 | Home Gainesville, FL | L 8-17 |
Saturday, October 22 | 1955 | Away Lexington, KY | L 7-10 |
Saturday, October 16 | 1954 | Home Gainesville, FL | W 21-7 |
Saturday, October 3 | 1953 | Away Lexington, KY | L 13-26 |
Saturday, December 6 | 1952 | Home Gainesville, FL | W 27-0 |
Saturday, October 27 | 1951 | Home Gainesville, FL | L 6-14 |
Saturday, November 4 | 1950 | Away Lexington, KY | L 6-40 |
Saturday, November 12 | 1949 | Neutral Tampa, FL | L 0-35 |
Saturday, November 13 | 1948 | Away Lexington, KY | L 15-34 |
Saturday, December 4 | 1937 | Home Gainesville, FL | W 6-0 |
Saturday, October 24 | 1936 | Away Lexington, KY | L 0-7 |
Saturday, November 9 | 1935 | Away Lexington, KY | L 6-15 |
Saturday, December 5 | 1931 | Neutral Jacksonville, FL | L 2-7 |
Saturday, October 15 | 1927 | Neutral Jacksonville, FL | W 27-6 |
Saturday, October 23 | 1926 | Neutral Jacksonville, FL | L 13-18 |
Thursday, November 29 | 1917 | Away Lexington, KY | L 0-52 |
`;

function splitPlace(location: string): { site: string; place: string } {
  const m = /^(Home|Away|Neutral)\s+(.*)$/.exec(location.trim());
  if (!m) return { site: '', place: location.trim() };
  return { site: m[1] ?? '', place: (m[2] ?? '').trim() };
}

/** Fill Florida and Kentucky only when the W/L agrees with Florida's score coming first, as it does for the 2025 game. */
function splitScore(score: string): { florida: string; kentucky: string } {
  const m = /^(?:OT\s+)?([WL])\s+(\d+)-(\d+)$/.exec(score.trim());
  if (!m) return { florida: '', kentucky: '' };
  const wl = m[1];
  const a = Number(m[2]);
  const b = Number(m[3]);
  const ordered = (wl === 'W' && a >= b) || (wl === 'L' && a <= b);
  if (!ordered) return { florida: '', kentucky: '' };
  return { florida: String(a), kentucky: String(b) };
}

export const gatorsColumns = ['Date', 'Season', 'Site', 'Place', 'Result', 'Florida', 'Kentucky', 'Media'];
export const gatorsNumericCols = [1, 5, 6];
export const gatorsShowFirst = 8;

export const gatorsRows: string[][] = GAME_LINES.trim().split('\n').filter(Boolean).map((line) => {
  const parts = line.split('|').map((s) => s.trim());
  const date = parts[0] ?? '';
  const season = parts[1] ?? '';
  const location = parts[2] ?? '';
  const score = parts[3] ?? '';
  const media = parts[4] ?? '';
  const { site, place } = splitPlace(location);
  const { florida, kentucky } = splitScore(score);
  return [date, season, site, place, score, florida, kentucky, media];
});

export const gatorsSchedule: ScheduleItem[] = [
  {
    date: '11/8/2025',
    title: 'at Kentucky',
    detail: 'Lexington, Ky.',
    result: 'L 7-38',
    logo: kentuckyMark,
    href: 'https://floridagators.com/sports/football/stats/2025/kentucky/boxscore/27203',
  },
  { date: '10/19/2024', title: 'Kentucky', detail: 'Gainesville, Fla.', result: 'W 48-20', logo: floridaMark },
  { date: '9/30/2023', title: 'at Kentucky', detail: 'Lexington, Ky.', result: 'L 14-33', logo: kentuckyMark },
  { date: '9/10/2022', title: 'Kentucky', detail: 'Gainesville, Fla.', result: 'L 16-26', logo: floridaMark },
];

export const sampleRecipe: RecipeProps = {
  title: 'Chocolate chip cookies',
  meta: [
    { label: 'Prep', value: '15 min' },
    { label: 'Cook', value: '10 min' },
    { label: 'Serves', value: '24' },
  ],
  picture: cookiePicture,
  ingredients: [
    '1 cup butter, softened',
    '3/4 cup granulated sugar',
    '3/4 cup packed brown sugar',
    '2 large eggs',
    '2 teaspoons vanilla extract',
    '2 1/4 cups all-purpose flour',
    '1 teaspoon baking soda',
    '1 teaspoon salt',
    '2 cups semisweet chocolate chips',
  ],
  steps: [
    'Heat the oven to 375°F. Line two baking sheets with parchment.',
    'Beat the butter with both sugars until the mixture looks pale and creamy.',
    'Beat in the eggs and the vanilla, one egg at a time.',
    'Stir the flour, baking soda, and salt together, then mix them in just until the flour disappears.',
    'Stir in the chocolate chips.',
    'Drop rounded tablespoons of dough onto the sheets, leaving space between them.',
    'Bake 9 to 11 minutes, until the edges are golden and the centers still look soft. Cool on the sheet for 2 minutes, then move the cookies to a rack.',
  ],
  notes: [
    'Pull the cookies while the centers still look soft. They firm up as they cool.',
    'A teaspoon of salt is mixed into the dough.',
  ],
};

export function Preview(): JSX.Element {
  const [opened, setOpened] = useState('');
  const items = gatorsSchedule.map((item) => ({
    ...item,
    onActivate: () => setOpened(item.title),
  }));
  return (
    <>
      <StatGrid title="Series record" items={gatorsStats} />
      <Scoreboard {...gatorsScore} />
      <DataTable
        caption="Florida vs Kentucky"
        columns={gatorsColumns}
        rows={gatorsRows}
        numericCols={gatorsNumericCols}
        showFirst={gatorsShowFirst}
      />
      <ScheduleList title="Recent games" items={items} currentIndex={0} />
      {opened ? <p class="wa-preview__status" role="status">Opened {opened}</p> : null}
      <Recipe {...sampleRecipe} />
      <div class="wa-preview__logos" role="group" aria-label="Logos">
        <LogoMark picture={floridaMark} label="Florida" size="small" />
        <LogoMark picture={kentuckyMark} label="Kentucky" size="medium" />
        <LogoMark picture={floridaMark} label="Florida Gators" size="large" />
      </div>
    </>
  );
}

const previewCss = `
html,body{margin:0;background:var(--wa-canvas,#fff);color:var(--wa-ink,#121317)}
.wa-preview{box-sizing:border-box;max-width:var(--wa-wide-col);margin:0 auto;padding:var(--wa-top-pad) var(--wa-gutter) calc(var(--wa-gap) * 4);
  display:flex;flex-direction:column;gap:calc(var(--wa-gap) * 3);font-family:var(--wa-font);background:var(--wa-canvas);color:var(--wa-ink)}
.wa-preview__status{min-height:var(--wa-t);margin:0;color:var(--wa-ink-2)}
.wa-preview__logos{display:flex;flex-wrap:wrap;align-items:center;gap:var(--wa-gap) var(--wa-row-pad);padding-top:var(--wa-gap);
  border-top:var(--wa-hair) solid var(--wa-line)}
`;

/** Used by preview.html. Does nothing when this module is imported from a test. */
export function mountPreview(root: HTMLElement): void {
  const tokens = tokensToStyle(tokensFor(null, 'light', { surface: 'calm' }));
  const tokenCss = Object.entries(tokens).map(([k, v]) => `${k}:${v};`).join('');
  const style = document.createElement('style');
  style.textContent = `:root{${tokenCss}}${componentsCss}${previewCss}`;
  document.head.appendChild(style);
  render(<main class="wa-preview" style={tokens}><Preview /></main>, root);
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('wa-preview');
  if (root) mountPreview(root);
}
