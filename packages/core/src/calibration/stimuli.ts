/**
 * Original stimulus bank for Tune (cal-vision.md 3, cal-attention.md 4.3).
 *
 * - Reading sentences: 9-11 words, 55-60 characters, everyday topics, a
 *   clear true or false answer, no names and nothing about health, money or
 *   politics. Written for this product; no MNREAD items are reused.
 * - Contrast words: common five-letter lowercase words, each with three
 *   distractors of the same length for the four-choice "Which word is it?" task.
 * - Find-in-text passages: about 120 words of plain language with one
 *   question whose answer is a single sentence, in dense and chunked layouts.
 *
 * Stimuli are data only: they carry no styling and never adapt to the profile.
 */

export interface ReadingSentence {
  id: string;
  text: string;
  /** Whether the sentence is true. */
  answer: boolean;
}

export interface ContrastWord {
  id: string;
  word: string;
  distractors: readonly [string, string, string];
}

export interface FindTextPassage {
  id: string;
  /** Short neutral topic label, for logs and authoring only. */
  topic: string;
  question: string;
  sentences: readonly string[];
  /** Index into `sentences` of the one sentence that answers the question. */
  answerIndex: number;
  /** Sentence indices offered as the three-option fallback (keyboard and touch); includes the answer. */
  choices: readonly [number, number, number];
  /** Chunked variant: a heading, three short paragraphs of sentence indices, and terms set in bold. */
  chunked: {
    heading: string;
    paragraphs: readonly (readonly number[])[];
    keyTerms: readonly string[];
  };
}

const sentence = (
  id: string,
  text: string,
  answer: boolean,
): ReadingSentence => ({ id, text, answer });

export const READING_SENTENCES: readonly ReadingSentence[] = [
  sentence(
    't01',
    'Most people open their front doors with a metal house key.',
    true,
  ),
  sentence(
    't02',
    'A bicycle has two wheels and moves forward when pedaled.',
    true,
  ),
  sentence(
    't03',
    'Fresh bread is usually baked inside a very hot kitchen oven.',
    true,
  ),
  sentence(
    't04',
    'The sun rises every morning and slowly sets every evening.',
    true,
  ),
  sentence(
    't05',
    'Soups are usually served in bowls and eaten using spoons.',
    true,
  ),
  sentence(
    't06',
    'Library books can be borrowed and then brought back later.',
    true,
  ),
  sentence(
    't07',
    'Garden plants need water, soil and sunlight to grow well.',
    true,
  ),
  sentence(
    't08',
    'A kitchen clock shows the current time with moving hands.',
    true,
  ),
  sentence(
    't09',
    'People often carry umbrellas outside when rain is falling.',
    true,
  ),
  sentence(
    't10',
    'Ice cream melts quickly when left outside on summer days.',
    true,
  ),
  sentence(
    't11',
    'Chairs are pieces of furniture that people can sit upon.',
    true,
  ),
  sentence(
    't12',
    'Fish live in water and use their fins for swimming around.',
    true,
  ),
  sentence(
    't13',
    'A sharp pencil can write words across a sheet of paper.',
    true,
  ),
  sentence(
    't14',
    'Many birds build nests to keep their small eggs protected.',
    true,
  ),
  sentence(
    't15',
    'Apples are round fruits that grow on branches of trees.',
    true,
  ),
  sentence(
    't16',
    'Large windows let bright daylight into rooms of a house.',
    true,
  ),
  sentence(
    't17',
    'Shoes are usually sold in pairs, one shoe for each foot.',
    true,
  ),
  sentence(
    't18',
    'Kettles are often used for heating water to make hot tea.',
    true,
  ),
  sentence(
    't19',
    'Snow usually falls during winter when the air is freezing.',
    true,
  ),
  sentence(
    't20',
    'Paper maps can help travelers find their way around towns.',
    true,
  ),
  sentence(
    'f01',
    'A house cat is usually much larger than a city building.',
    false,
  ),
  sentence(
    'f02',
    'People usually wear thick winter coats to swim in summer.',
    false,
  ),
  sentence(
    'f03',
    'Rivers usually flow uphill toward the tops of mountains.',
    false,
  ),
  sentence(
    'f04',
    'Bananas are small metal tools that mechanics use on cars.',
    false,
  ),
  sentence(
    'f05',
    'Wooden chairs grow on tall trees and are picked when ripe.',
    false,
  ),
  sentence(
    'f06',
    'Most pet dogs can fly over tall buildings when they bark.',
    false,
  ),
  sentence(
    'f07',
    'Every bicycle has fifteen wheels and a large roof on top.',
    false,
  ),
  sentence(
    'f08',
    'Bread is made by freezing small stones inside glass jars.',
    false,
  ),
  sentence(
    'f09',
    'Libraries are places where books are grown in the soil.',
    false,
  ),
  sentence(
    'f10',
    'A single pencil weighs more than a truck filled with sand.',
    false,
  ),
  sentence(
    'f11',
    'Most trains travel along deep rivers instead of on tracks.',
    false,
  ),
  sentence(
    'f12',
    'Oranges are leather shoes that people wear to the office.',
    false,
  ),
  sentence(
    'f13',
    'The number two is always much larger than the number twenty.',
    false,
  ),
  sentence(
    'f14',
    'Kitchen sinks are where most people go to sleep each night.',
    false,
  ),
  sentence(
    'f15',
    'Each week has twelve days, and each day lasts six hours.',
    false,
  ),
  sentence(
    'f16',
    'Anyone can easily carry a whole house inside a paper bag.',
    false,
  ),
  sentence(
    'f17',
    'Clouds are made of heavy wood and roll along the ground.',
    false,
  ),
  sentence(
    'f18',
    'Ladders are mainly used for digging holes under the sea.',
    false,
  ),
  sentence(
    'f19',
    'Coffee cups are made for holding sand instead of drinks.',
    false,
  ),
  sentence(
    'f20',
    'Letters are mailed by folding them into tiny paper boats.',
    false,
  ),
];

const word = (word: string, a: string, b: string, c: string): ContrastWord => ({
  id: word,
  word,
  distractors: [a, b, c],
});

export const CONTRAST_WORDS: readonly ContrastWord[] = [
  word('house', 'horse', 'mouse', 'hours'),
  word('water', 'later', 'tower', 'wider'),
  word('light', 'night', 'might', 'eight'),
  word('bread', 'break', 'dream', 'broad'),
  word('chair', 'chain', 'charm', 'cheer'),
  word('table', 'cable', 'title', 'stale'),
  word('plant', 'plane', 'plain', 'plate'),
  word('green', 'greet', 'queen', 'grown'),
  word('clock', 'click', 'clerk', 'block'),
  word('stone', 'store', 'stove', 'shine'),
  word('river', 'rider', 'ruler', 'rover'),
  word('apple', 'ample', 'angle', 'apply'),
  word('train', 'trail', 'brain', 'grain'),
  word('cloud', 'clown', 'could', 'proud'),
  word('smile', 'smell', 'slide', 'smoke'),
  word('paper', 'power', 'paler', 'pages'),
  word('sugar', 'super', 'solar', 'cigar'),
  word('grass', 'gross', 'brass', 'grasp'),
  word('beach', 'bench', 'peach', 'reach'),
  word('dream', 'dread', 'cream', 'drama'),
  word('music', 'magic', 'basic', 'mimic'),
  word('horse', 'nurse', 'noise', 'horns'),
  word('lemon', 'melon', 'linen', 'lever'),
  word('shirt', 'short', 'skirt', 'shift'),
  word('spoon', 'spoke', 'scoop', 'sport'),
  word('piano', 'pizza', 'radio', 'patio'),
  word('glass', 'grass', 'class', 'gloss'),
  word('honey', 'money', 'hobby', 'handy'),
  word('north', 'forth', 'worth', 'month'),
  word('ocean', 'organ', 'orbit', 'olive'),
];

export const FIND_TEXT_PASSAGES: readonly FindTextPassage[] = [
  {
    id: 'library',
    topic: 'Library borrowing rules',
    question: 'How long can you keep a book?',
    sentences: [
      'The town library is open six days a week and is closed on Mondays.',
      'Anyone who lives in town can get a free library card at the front desk.',
      'Bring a letter or a card that shows your name and your home address.',
      'With a library card, you can borrow up to ten items at a time.',
      'Books can be kept for three weeks before they need to come back.',
      'Films and music can be kept for one week.',
      'Most items can be renewed twice, online or at the desk, if no one else is waiting for them.',
      'You can return items at any hour in the drop box by the main door.',
      'Quiet rooms upstairs can be booked for up to two hours a day.',
    ],
    answerIndex: 4,
    choices: [5, 4, 8],
    chunked: {
      heading: 'Borrowing from the library',
      paragraphs: [
        [0, 1, 2],
        [3, 4, 5, 6],
        [7, 8],
      ],
      keyTerms: ['three weeks', 'one week', 'ten items'],
    },
  },
  {
    id: 'bike',
    topic: 'Bike rental rules',
    question: 'How long can you keep a bike?',
    sentences: [
      'Bikes can be rented from any of the twelve stations around the city.',
      'To start a ride, open the app and scan the code on the handlebar.',
      'Every bike has a basket, front and back lights, and a bell.',
      'A single ride can last for up to two hours.',
      'If you need more time, return the bike to any station and take it out again.',
      'Helmets are not provided, so please bring your own.',
      'Lock the bike into an open dock at the end of every ride.',
      'If a station is full, the app will show the nearest one with space.',
      'Please report a flat tire or a broken light using the button in the app.',
    ],
    answerIndex: 3,
    choices: [6, 4, 3],
    chunked: {
      heading: 'Renting a bike',
      paragraphs: [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
      ],
      keyTerms: ['two hours', 'open dock'],
    },
  },
  {
    id: 'pool',
    topic: 'Swimming pool rules',
    question: 'When is the pool open for lap swimming?',
    sentences: [
      'The town pool opens in early June and closes at the end of August each year.',
      'Lap swimming is from six to eight in the morning on weekdays.',
      'Open swim for all ages runs every afternoon from one to five.',
      'Children under eight must stay with an adult while they are in the water.',
      'Please take a quick shower before you get into the pool.',
      'Glass bottles and food are not allowed on the pool deck.',
      'Lockers are free to use, but you need to bring your own lock.',
      'The pool closes for thirty minutes whenever there is thunder nearby.',
      'Lost items are kept at the front desk for two weeks, then given away.',
    ],
    answerIndex: 1,
    choices: [2, 7, 1],
    chunked: {
      heading: 'Using the town pool',
      paragraphs: [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
      ],
      keyTerms: ['Lap swimming', 'Open swim'],
    },
  },
  {
    id: 'recycling',
    topic: 'Recycling pickup rules',
    question: 'Which day is paper collected?',
    sentences: [
      'Recycling is picked up once a week from the same spot as your trash.',
      'Paper and cardboard are collected every week on Tuesdays.',
      'Glass jars, metal cans, and plastic bottles are collected on Fridays.',
      'Please rinse cans and bottles before you put them in the bin.',
      'Flatten boxes so that they fit inside the blue bin with the lid closed.',
      'Put your bins at the curb by seven in the morning on pickup day.',
      'Plastic bags jam the sorting machines, so take them back to a store instead.',
      'Large items, like an old chair, can be picked up if you call ahead.',
      'In any week with a public holiday, pickup moves one day later.',
    ],
    answerIndex: 1,
    choices: [1, 2, 5],
    chunked: {
      heading: 'Recycling pickup',
      paragraphs: [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
      ],
      keyTerms: ['Tuesdays', 'Fridays'],
    },
  },
];

/** A run of text inside a passage sentence; `strong` marks a key term in the chunked layout. */
export interface TextRun {
  text: string;
  strong: boolean;
}

export interface PassageSentence {
  index: number;
  runs: readonly TextRun[];
}

export interface PassageLayout {
  heading: string | null;
  paragraphs: readonly (readonly PassageSentence[])[];
}

function splitKeyTerms(text: string, terms: readonly string[]): TextRun[] {
  const runs: TextRun[] = [];
  let rest = text;
  while (rest.length > 0) {
    let hit: { at: number; term: string } | null = null;
    for (const term of terms) {
      const at = term.length > 0 ? rest.indexOf(term) : -1;
      if (at >= 0 && (hit === null || at < hit.at)) hit = { at, term };
    }
    if (!hit) {
      runs.push({ text: rest, strong: false });
      break;
    }
    if (hit.at > 0) runs.push({ text: rest.slice(0, hit.at), strong: false });
    runs.push({ text: hit.term, strong: true });
    rest = rest.slice(hit.at + hit.term.length);
  }
  return runs;
}

/**
 * The passage in one of its two formats. Dense: one paragraph, no heading, no
 * emphasis. Chunked: heading, three short paragraphs, key terms in bold. Every
 * sentence keeps its index so a click on it can be scored.
 */
export function passageLayout(
  passage: FindTextPassage,
  format: 'dense' | 'chunked',
): PassageLayout {
  const plain = (index: number): PassageSentence => ({
    index,
    runs: [{ text: passage.sentences[index] ?? '', strong: false }],
  });
  if (format === 'dense') {
    return {
      heading: null,
      paragraphs: [passage.sentences.map((_s, i) => plain(i))],
    };
  }
  return {
    heading: passage.chunked.heading,
    paragraphs: passage.chunked.paragraphs.map((p) =>
      p.map((index) => ({
        index,
        runs: splitKeyTerms(
          passage.sentences[index] ?? '',
          passage.chunked.keyTerms,
        ),
      })),
    ),
  };
}

/** Fisher-Yates shuffle with an injected uniform source, for seeded, reproducible orders. */
export function shuffleStimuli<T>(
  items: readonly T[],
  random: () => number,
): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}
