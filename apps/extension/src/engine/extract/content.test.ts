// Owner: X (round 7). Recipes, articles, JSON-LD, text classifiers, and keeping extracted data on the device.
import { describe, expect, it } from 'vitest';
import { authorsFrom, findArticle } from './article';
import { articleFromLd, parseLd, recipeFromLd, stepsOf } from './jsonld';
import { findRecipe } from './recipe';
import { stripLocalData, stripOutlineData } from './strip';
import { box, h } from './testkit';
import {
  cleanName, genericLogoName, isDateText, isLabelText, isNumericCell, isValueText, isoDuration, link, plain,
} from './text';

const none = () => false;

// A made-up recipe in the shape real sites publish (types array, HowToSection, ISO durations, entities).
const RECIPE_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Example Kitchen' },
    {
      '@type': ['Recipe', 'NewsArticle'],
      name: 'Oat Biscuits',
      headline: 'Oat Biscuits',
      image: { '@type': 'ImageObject', url: 'https://cdn.example/oat.jpg', width: 1500 },
      author: [{ '@type': 'Person', name: 'Sam Cook' }],
      prepTime: 'PT15M',
      cookTime: 'PT1H20M',
      totalTime: 'PT95M',
      recipeYield: ['24', '2 dozen biscuits'],
      aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.72', ratingCount: '1203' },
      recipeIngredient: ['1 cup oats', '&frac12; cup butter', '2 tablespoons honey'],
      recipeInstructions: [
        { '@type': 'HowToSection', name: 'Dough', itemListElement: [{ '@type': 'HowToStep', text: 'Mix the oats and butter.' }, { '@type': 'HowToStep', text: 'Stir in the honey.' }] },
        { '@type': 'HowToStep', text: 'Bake for 12 minutes at 350&deg;F.' },
      ],
    },
  ],
});

describe('JSON-LD', () => {
  it('parses @graph, type arrays and skips bad JSON', () => {
    const objs = parseLd([RECIPE_LD, '{not json', '[{"@type":"NewsArticle","headline":"A"}]']);
    expect(objs.map((o) => o['@type'])).toEqual(['WebSite', ['Recipe', 'NewsArticle'], 'NewsArticle']);
  });

  it('reads a recipe in plain strings', () => {
    const r = recipeFromLd(parseLd([RECIPE_LD])[1] as Record<string, unknown>);
    expect(r).toEqual({
      title: 'Oat Biscuits',
      imageSrc: 'https://cdn.example/oat.jpg',
      ingredients: ['1 cup oats', '½ cup butter', '2 tablespoons honey'],
      steps: ['Mix the oats and butter.', 'Stir in the honey.', 'Bake for 12 minutes at 350°F.'],
      meta: [
        { label: 'Prep', value: '15 min' }, { label: 'Cook', value: '1 hr 20 min' }, { label: 'Total', value: '1 hr 35 min' },
        { label: 'Servings', value: '24' }, { label: 'Yield', value: '2 dozen biscuits' }, { label: 'Rating', value: '4.7 (1,203 ratings)' },
      ],
    });
    expect(stepsOf('Mix.\nBake.')).toEqual(['Mix.', 'Bake.']);
  });

  it('reads an article', () => {
    const a = articleFromLd({ '@type': 'NewsArticle', headline: 'Rings for all', author: [], image: [{ url: 'https://cdn.example/a.jpg' }], datePublished: '2026-10-24T20:14:30Z', articleSection: ['sport'] });
    expect(a).toEqual({ headline: 'Rings for all', authors: [], imageSrc: 'https://cdn.example/a.jpg', published: '2026-10-24T20:14:30Z', section: 'sport' });
    expect(authorsFrom('By Jane Doe and John Roe, CNN')).toEqual(['Jane Doe', 'John Roe', 'CNN']);
  });
});

describe('recipe', () => {
  function recipePage() {
    const ingr = h('div', box(222, 4683, 600, 300, { cls: 'structured-ingredients' }),
      h('h2', box(222, 4700, 600, 40, { text: 'Ingredients' })),
      h('ul', box(222, 4750, 600, 200),
        h('li', box(222, 4750, 600, 27), h('p', box(222, 4750, 600, 27), h('span', '1'), h('span', 'cup'), h('span', 'oats'))),
        h('li', box(222, 4780, 600, 27), h('p', box(222, 4780, 600, 27), h('span', '½'), h('span', 'cup'), h('span', 'butter'))),
        h('li', box(222, 4810, 600, 27), h('p', box(222, 4810, 600, 27), h('span', '2'), h('span', 'tablespoons'), h('span', 'honey'))),
      ),
    );
    const steps = h('div', box(222, 5000, 600, 900, { cls: 'recipe-steps' }),
      h('h2', box(222, 5000, 600, 40, { text: 'Directions' })),
      h('ol', box(222, 5050, 600, 500),
        h('li', box(222, 5050, 600, 100), h('p', box(222, 5050, 600, 50, { text: 'Mix the oats and butter.' })), h('figure', box(222, 5100, 600, 50), h('figcaption', 'Photo by the kitchen'))),
        h('li', box(222, 5150, 600, 100), h('p', box(222, 5150, 600, 50, { text: 'Stir in the honey.' }))),
        h('li', box(222, 5250, 600, 100), h('p', box(222, 5250, 600, 50, { text: 'Bake for 12 minutes at 350°F.' }))),
      ),
      h('div', box(222, 5600, 600, 200, { cls: 'callout' }),
        h('h3', box(222, 5600, 600, 40, { text: 'Tips' })),
        h('div', box(222, 5650, 600, 150), h('p', box(222, 5650, 600, 50, { text: 'Chill the dough if it feels soft before baking.' }))),
      ),
    );
    const content = h('div', box(222, 1165, 600, 5000, { cls: 'article-content' }),
      h('p', box(222, 1200, 600, 300, { text: 'A long story about biscuits and the people who love them, which goes on.' })), ingr, steps);
    return h('body', box(0, 0, 1440, 20000), h('header', box(0, 0, 1440, 148)), content);
  }

  it('finds where the JSON-LD recipe sits, keeps the page lines, and reads the tips', () => {
    const root = recipePage();
    link(root);
    const it0 = findRecipe(root, parseLd([RECIPE_LD]), none);
    expect(it0?.node.cls).toBe('article-content');
    expect(it0?.data).toMatchObject({
      kind: 'recipe', title: 'Oat Biscuits', ingredients: ['1 cup oats', '½ cup butter', '2 tablespoons honey'],
      steps: ['Mix the oats and butter.', 'Stir in the honey.', 'Bake for 12 minutes at 350°F.'],
      notes: ['Chill the dough if it feels soft before baking.'], imageSrc: 'https://cdn.example/oat.jpg',
    });
  });

  it('reads the page alone when there is no JSON-LD', () => {
    const root = recipePage();
    root.kids.push(h('h1', { text: 'Oat Biscuits' }));
    link(root);
    const it0 = findRecipe(root, [], none);
    expect(it0?.data).toMatchObject({ kind: 'recipe', ingredients: ['1 cup oats', '½ cup butter', '2 tablespoons honey'] });
    expect(it0?.data.kind === 'recipe' ? it0.data.steps.length : 0).toBe(3);
  });
});

describe('article', () => {
  function articlePage(withForm = false) {
    const para = (y: number) => h('p', box(390, y, 660, 96, { text: 'A paragraph of the story that runs on for a while so that it reads like a real article body. '.repeat(2) }));
    return h('body', box(0, 0, 1440, 4000),
      h('header', box(0, 0, 1440, 357), h('a', box(10, 10, 46, 22, { attrs: { href: '/' } }), h('svg', box(10, 10, 46, 22, { cls: 'brand-logo' })))),
      h('section', box(0, 433, 1440, 243),
        h('h1', box(0, 433, 1440, 135, { text: 'Knicks try to clear up misinformation about rings', fs: 40 })),
        h('div', box(48, 624, 131, 20, { cls: 'vossi-byline_elevate byline-elevate' }), h('span', box(48, 624, 131, 20, { cls: 'byline__authors', text: 'By Associated Press' }))),
        h('div', box(48, 592, 74, 20, { cls: 'timestamp-elevate' }), h('span', box(48, 592, 56, 20, { text: '6 hr ago' }))),
      ),
      h('main', box(390, 676, 660, 2092),
        h('div', box(390, 676, 660, 538, { cls: 'image__lede' }), h('img', box(390, 676, 660, 514, { attrs: { alt: 'The trophy', src: 'https://cdn.example/prod/gettyimages-1.jpg?c=16x9' } }))),
        h('div', box(390, 1214, 660, 1498, { attrs: { itemprop: 'articleBody' } }), para(1218), para(1367), para(1487), para(1607), para(1727)),
        ...(withForm ? [h('form', box(390, 2800, 660, 100), h('input', box(390, 2800, 300, 40)), h('input', box(390, 2850, 300, 40)))] : []),
      ),
    );
  }

  it('finds headline, byline, date, lead image and body; authors from the byline when JSON-LD has none', () => {
    const root = articlePage();
    link(root);
    const ld = parseLd([JSON.stringify({ '@type': 'NewsArticle', headline: 'Knicks try to clear up misinformation about rings', author: [], image: [{ url: 'https://cdn.example/prod/gettyimages-1.jpg?c=original' }] })]);
    const a = findArticle(root, ld, none);
    expect(a?.meta).toMatchObject({ headline: 'Knicks try to clear up misinformation about rings', authors: ['Associated Press'], source: 'json-ld', image: { src: 'https://cdn.example/prod/gettyimages-1.jpg?c=original', alt: 'The trophy' } });
    expect(a?.headline?.tag).toBe('h1');
    expect(a?.byline?.cls).toContain('byline');
    expect(a?.date?.cls).toContain('timestamp');
    expect(a?.leadImage?.tag).toBe('img');
    expect(a?.body?.attrs?.itemprop).toBe('articleBody');
  });

  it('a task page with some prose is not an article', () => {
    const root = articlePage(true);
    link(root);
    expect(findArticle(root, [], none)).toBeNull();
  });
});

describe('text classifiers', () => {
  it('tells values, dates and labels apart', () => {
    for (const v of ['54', '30-6', '22-13', 'W 73-7', 'L 0-52', 'L1', '$4.00', '2,071', '87%', '20 mins', '4 dozen cookies', '9 AM – 9 PM']) expect(isValueText(v), v).toBe(true);
    for (const v of ['11/8/2025', 'Saturday, November 8', 'Wins', 'Oct 10', '9/10/2016 - 11/8/2025']) expect(isValueText(v), v).toBe(false);
    for (const d of ['11/8/2025', 'Saturday, November 8', 'Oct 10', '9/10/2016 - 11/8/2025', '2026-10-24']) expect(isDateText(d), d).toBe(true);
    for (const l of ['Wins', 'Home Record', 'Prep Time:', 'Last 10 Matchups', 'Largest Margin of Victory']) expect(isLabelText(l), l).toBe(true);
    for (const l of ['54', '11/8/2025', 'This is a long sentence that is not a label at all']) expect(isLabelText(l), l).toBe(false);
    expect(isNumericCell('W 48-20')).toBe(true);
    expect(isNumericCell('Gainesville, Fla.')).toBe(false);
  });

  it('cleans names and decodes entities', () => {
    expect(cleanName("Visit Allrecipes' homepage")).toBe('Allrecipes');
    expect(cleanName('University of Florida, opens in new window')).toBe('University of Florida');
    expect(genericLogoName('Team Logo')).toBe(true);
    expect(genericLogoName('Kentucky')).toBe(false);
    expect(plain('<p>1 &frac12; cups &amp; more&#33;</p>')).toBe('1 ½ cups & more!');
    expect(isoDuration('PT1H20M')).toBe('1 hr 20 min');
    expect(isoDuration('P1DT2H')).toBe('1 day 2 hr');
    expect(isoDuration('nonsense')).toBe('');
  });
});

describe('extracted data stays on the device', () => {
  const outline = {
    v: 'outline.1' as const,
    nodes: [
      { id: 'n1', kind: 'region' as const, label: '·', data: { kind: 'stats' as const, items: [{ label: 'Wins', value: '54' }] } },
      { id: 'n2', kind: 'text' as const, label: '' },
    ],
  };

  it('stripOutlineData removes data from every node, nothing else', () => {
    const out = stripOutlineData(outline);
    expect(out.nodes).toEqual([{ id: 'n1', kind: 'region', label: '·' }, { id: 'n2', kind: 'text', label: '' }]);
    expect(outline.nodes[0]).toHaveProperty('data'); // the original is untouched
  });

  it('stripLocalData removes node data anywhere in a request body and keeps other `data` keys', () => {
    const body = { outline, fit: { text_need: 'some' }, other: { data: 'kept', id: 'x1' } };
    const out = stripLocalData(body);
    expect(JSON.stringify(out)).not.toContain('Wins');
    expect(out.other.data).toBe('kept');
    expect(out.fit).toEqual({ text_need: 'some' });
  });
});
