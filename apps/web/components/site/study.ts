/**
 * WebAble's fall 2026 study, as reported in the final honors thesis and its
 * defense (University of Florida, exempt determination by UF's Human Research
 * Protection Program). One source for the home page's band and the research
 * page's section, so the two never disagree.
 *
 * Differences are WebAble minus original, computed per person before rounding.
 * The study is exploratory: p-values are two-sided paired comparisons with all
 * 25 people and are not adjusted for multiple comparisons.
 */

export const STUDY = {
  people: 25,
  tasks: 150,
  tasksPerVersion: 75,
  ages: [
    { band: '50 to 64', count: 9 },
    { band: '65 to 74', count: 9 },
    { band: '75 to 84', count: 7 },
  ],
  /** People could choose more than one. */
  trouble: [
    { what: 'Getting around websites', count: 19 },
    { what: 'Finding information', count: 14 },
    { what: 'Understanding content', count: 10 },
  ],
  sites: ['AP News', 'Health.com', 'PEOPLE'],
  correct: {
    original: { count: 50, percent: 67 },
    webable: { count: 67, percent: 89 },
    differencePoints: 22.7,
    interval: [5.5, 39.9],
    p: '.012',
  },
  /** "I could not find it" answers, out of 75 tasks each. */
  gaveUp: { original: 16, webable: 2 },
  wrong: { original: 8, webable: 5 },
  /** Person by person, on correct answers. */
  perPerson: { better: 12, same: 10, worse: 3 },
  /** Modified four-item UMUX, 0 to 100, after each round. */
  usability: {
    original: 49.7,
    webable: 74.3,
    difference: 24.7,
    interval: [12.6, 36.7],
    p: '< .001',
  },
  /** One question after every task, 1 (very hard) to 7 (very easy). */
  ease: {
    original: 3.99,
    webable: 5.59,
    difference: 1.6,
    interval: [0.83, 2.37],
    p: '< .001',
  },
  /** Seconds the page was on screen, leaving out loading and pauses. */
  time: {
    meanOriginal: 38.0,
    meanWebable: 32.9,
    medianOriginal: 31.3,
    medianWebable: 18.2,
    p: '.479',
  },
  noticed: 21,
} as const;
