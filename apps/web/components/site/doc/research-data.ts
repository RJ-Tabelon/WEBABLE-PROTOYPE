/**
 * The evidence behind each change WebAble makes and behind Tune. Every source is
 * listed in docs/03-Evidence-Base.md or docs/research/*.md, cited by author,
 * venue and year (never by title, so no page names a condition). Strength words
 * follow the evidence base; gaps are stated, not hidden.
 */

export interface Source {
  id: string;
  /** "Piepenbrock, Mayr & Buchner, Ergonomics 2013" */
  cite: string;
  url: string;
}

export type Strength = 'Strong' | 'Moderate' | 'Mixed' | 'Consensus only';

/**
 * Which way the evidence points. `for`: it supports what WebAble does. `against`:
 * it shows the idea doesn't help, which is why WebAble leaves it out.
 */
export type Polarity = 'for' | 'against';

export interface EvidenceItem {
  id: string;
  title: string;
  strength: Strength;
  /** Default `for`. */
  polarity?: Polarity;
  /** What WebAble does, in a few words, for the summary table (changes only). */
  summary?: string;
  /** What the studies found, in plain words. */
  finding: string;
  /** What WebAble does because of it. */
  practice: string;
  /** What the evidence does not show. */
  gap?: string;
  sources: readonly string[];
}

export const SOURCES: readonly Source[] = [
  {
    id: 'calabrese2016',
    cite: 'Calabrèse et al., IOVS 2016',
    url: 'https://iovs.arvojournals.org/article.aspx?articleid=2537421',
  },
  {
    id: 'legge2011',
    cite: 'Legge & Bigelow, Journal of Vision 2011',
    url: 'https://jov.arvojournals.org/article.aspx?articleid=2191906',
  },
  {
    id: 'fontreview',
    cite: 'Systematic review of font size for older readers, PubMed Central',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9376262',
  },
  {
    id: 'rello',
    cite: 'Rello & Baeza-Yates, eye-tracking study with 92 readers',
    url: 'https://repositori.upf.edu/bitstreams/275f50cd-7524-479a-a09f-1edc22830b30/download',
  },
  {
    id: 'zorzi2012',
    cite: 'Zorzi et al., PNAS 2012',
    url: 'https://pubmed.ncbi.nlm.nih.gov/22665803/',
  },
  {
    id: 'wcag1412',
    cite: 'W3C, Understanding WCAG 2.2 success criterion 1.4.12',
    url: 'https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html',
  },
  {
    id: 'chung2002',
    cite: 'Chung, 2002',
    url: 'https://pubmed.ncbi.nlm.nih.gov/11923275/',
  },
  {
    id: 'blackmore2013',
    cite: 'Blackmore-Wright, Georgeson & Anderson, PLoS ONE 2013',
    url: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0080325',
  },
  {
    id: 'piepenbrock2013',
    cite: 'Piepenbrock, Mayr & Buchner, Ergonomics 2013',
    url: 'https://www.tandfonline.com/doi/abs/10.1080/00140139.2013.790485',
  },
  {
    id: 'piepenbrock2014',
    cite: 'Piepenbrock et al., Human Factors 2014',
    url: 'https://journals.sagepub.com/doi/abs/10.1177/0018720813515509',
  },
  {
    id: 'legge1985',
    cite: 'Legge, Rubin, Pelli & Schleske, Vision Research 1985',
    url: 'https://legge.psych.umn.edu/sites/legge.psych.umn.edu/files/2020-08/Psychophysics%20of%20Reading%20II%20Low%20Vision%20Legge%20Rubin%20Pelli%20Schleske%201985.pdf',
  },
  {
    id: 'kobayashi2011',
    cite: 'Kobayashi et al., INTERACT 2011',
    url: 'https://www.researchgate.net/publication/221054180_Elderly_User_Evaluation_of_Mobile_Touchscreen_Interactions',
  },
  {
    id: 'jin2007',
    cite: 'Jin, Plocher & Kiff, HCI International 2007',
    url: 'https://link.springer.com/chapter/10.1007/978-3-540-73279-2_104',
  },
  {
    id: 'findlater2017',
    cite: 'Findlater et al., CHI 2017',
    url: 'https://obj.umiacs.umd.edu/chi2017/Findlater_ComparingTouchscreenAndMouseInputPerformanceByPeopleWithAndWithoutUpperBodyMotorImpairments_CHI2017.pdf',
  },
  {
    id: 'trewin2006',
    cite: 'Trewin, Keates & Moffatt, ASSETS 2006',
    url: 'https://research.ibm.com/publications/developing-steady-clicks-a-method-of-cursor-assistance-for-people-with-motor-impairments',
  },
  {
    id: 'tufail2017',
    cite: 'Tufail & Kim, Applied Ergonomics 2017',
    url: 'https://www.sciencedirect.com/science/article/abs/pii/S0003687017301473',
  },
  {
    id: 'trewin1999',
    cite: 'Trewin & Pain, International Journal of Human-Computer Studies 1999',
    url: 'https://www.sciencedirect.com/science/article/abs/pii/S1071581998902385',
  },
  {
    id: 'simola2011',
    cite: 'Simola et al., Journal of Experimental Psychology: Applied 2011',
    url: 'https://eric.ed.gov/?id=EJ934193',
  },
  {
    id: 'vital2022',
    cite: 'Vital, van der Baan, Stenberg & Sandnes, HCII 2022',
    url: 'https://link.springer.com/chapter/10.1007/978-3-031-05028-2_10',
  },
  {
    id: 'burke2005',
    cite: 'Burke, Hornof, Nilsen & Gorman, TOCHI 2005',
    url: 'https://dl.acm.org/doi/10.1145/1121112.1121116',
  },
  {
    id: 'shen2025',
    cite: 'Shen, Frontiers in Psychology 2025',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12684101/',
  },
  {
    id: 'baughan2020',
    cite: 'Baughan, August, Yamashita & Reinecke, CHI 2020',
    url: 'https://dl.acm.org/doi/fullHtml/10.1145/3313831.3376849',
  },
  {
    id: 'salience2020',
    cite: 'Study of age and visual attention, PubMed Central',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7745017/',
  },
  {
    id: 'dyson2001',
    cite: 'Dyson & Haselgrove, International Journal of Human-Computer Studies 2001',
    url: 'https://www.sciencedirect.com/science/article/abs/pii/S1071581901904586',
  },
  {
    id: 'wcag148',
    cite: 'W3C, Understanding WCAG 2.2 success criterion 1.4.8',
    url: 'https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html',
  },
  {
    id: 'subramanian2006',
    cite: 'Subramanian & Pardhan, 2006',
    url: 'https://www.researchgate.net/publication/6878621_The_Repeatability_of_MNREAD_Acuity_Charts_and_Variability_at_Different_Test_Distances',
  },
  {
    id: 'latham2022',
    cite: 'Latham & Macnaughton, Ophthalmic and Physiological Optics 2022',
    url: 'https://onlinelibrary.wiley.com/doi/10.1111/opo.12946',
  },
  {
    id: 'mansfield1996',
    cite: 'Mansfield, Legge & Bane, IOVS 1996',
    url: 'https://iovs.arvojournals.org/article.aspx?articleid=2161324',
  },
  {
    id: 'yeatman2024',
    cite: 'Yeatman et al., Frontiers in Education 2024',
    url: 'https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2024.1494431/full',
  },
  {
    id: 'gajos2007',
    cite: 'Gajos, Wobbrock & Weld, UIST 2007',
    url: 'https://www.eecs.harvard.edu/~kgajos/papers/2007/kgajos-uist07.pdf',
  },
  {
    id: 'pandey2023',
    cite: 'Pandey et al., TACCESS 2023',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12363608/',
  },
  {
    id: 'hedge2018',
    cite: 'Hedge, Powell & Sumner, Behavior Research Methods 2018',
    url: 'https://link.springer.com/article/10.3758/s13428-017-0935-1',
  },
  {
    id: 'hertzum2025',
    cite: 'Hertzum, International Journal of Human-Computer Studies 2025',
    url: 'https://mortenhertzum.dk/publ/IJHCS2025.pdf',
  },
  {
    id: 'findlater2004',
    cite: 'Findlater & McGrenere, CHI 2004',
    url: 'https://www.cs.ubc.ca/labs/imager/tr/2004/findlater04menus/',
  },
  {
    id: 'gajos2008',
    cite: 'Gajos et al., CHI 2008',
    url: 'https://www.eecs.harvard.edu/~kgajos/papers/2008/gajos08predictability.shtml',
  },
  {
    id: 'lavie2010',
    cite: 'Lavie & Meyer, International Journal of Human-Computer Studies 2010',
    url: 'https://www.sciencedirect.com/science/article/abs/pii/S1071581910000145',
  },
  {
    id: 'wanscher2026',
    cite: 'Wanscher et al., arXiv 2026',
    url: 'https://arxiv.org/abs/2608.24913',
  },
  {
    id: 'wallace2022',
    cite: 'Wallace et al., TOCHI 2022',
    url: 'https://dl.acm.org/doi/10.1145/3502222',
  },
  {
    id: 'wery2017',
    cite: 'Wery & Diliberto, 2017',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5629233/',
  },
  {
    id: 'kuster2018',
    cite: 'Kuster et al., 2018',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5934461/',
  },
  {
    id: 'readwise',
    cite: 'Readwise reading-speed study with over 2,000 readers',
    url: 'https://blog.readwise.io/bionic-reading-results/',
  },
  {
    id: 'henderson2013',
    cite: 'Henderson et al., Journal of Research in Special Educational Needs 2013',
    url: 'https://nasenjournals.onlinelibrary.wiley.com/doi/abs/10.1111/j.1471-3802.2012.01237.x',
  },
  {
    id: 'wcag2413',
    cite: 'W3C, Understanding WCAG 2.2 success criterion 2.4.13',
    url: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
  },
  {
    id: 'wobbrock2018',
    cite: 'Wobbrock, Gajos, Kane & Vanderheiden, Communications of the ACM 2018',
    url: 'https://dl.acm.org/doi/10.1145/3148051',
  },
];

export const SOURCE_BY_ID: ReadonlyMap<string, Source> = new Map(
  SOURCES.map((s) => [s.id, s]),
);

/** One block per change WebAble can make. */
export const ADAPTATIONS: readonly EvidenceItem[] = [
  {
    id: 'text-size',
    title: 'Text size',
    strength: 'Strong',
    summary: 'Raises small text to your size',
    finding:
      'Reading gets faster as print grows, up to a size where it levels off. That size differs a lot between people and rises with age.',
    practice:
      'WebAble raises only text smaller than your measured size, and never shrinks text. Text that is already large stays as it is.',
    gap: 'Past a certain size, reading slows again, so larger is not always better. That is why WebAble measures instead of choosing one big size for everyone.',
    sources: ['calabrese2016', 'legge2011', 'fontreview', 'rello'],
  },
  {
    id: 'spacing',
    title: 'Line and word spacing',
    strength: 'Moderate',
    summary: 'Offers line spacing from 1.5 to 2.0',
    finding:
      'More space between lines and words raised reading speed by 26% and 46% for some readers in one study, and made no difference in another. Extra space between letters helped children who find reading hard in one study, but not most readers.',
    practice:
      'WebAble offers line spacing from 1.5 to 2.0 on running text, keeps letter spacing as the site set it unless you choose more, and checks every page for overlapping text afterwards.',
    gap: 'The benefit varies from person to person, so WebAble learns it from what you keep and undo rather than applying it to everyone.',
    sources: ['blackmore2013', 'chung2002', 'zorzi2012', 'wcag1412'],
  },
  {
    id: 'contrast',
    title: 'Contrast and light or dark pages',
    strength: 'Strong',
    summary: 'Darkens faint text to your contrast floor',
    finding:
      'Most people read dark text on a light page more accurately, and the advantage grows as text gets smaller. People whose eyes scatter light often read faster with light text on a dark page.',
    practice:
      'WebAble darkens faint text to your contrast floor and keeps each colour’s hue. A dark page is only offered when your Tune or your own choice points to it.',
    gap: 'Screens are not calibrated, so absolute contrast can’t be measured precisely at home. WebAble uses three wide bands instead of a single threshold.',
    sources: ['piepenbrock2013', 'piepenbrock2014', 'legge1985'],
  },
  {
    id: 'targets',
    title: 'Click targets',
    strength: 'Strong',
    summary: 'Enlarges small click areas',
    finding:
      'Small targets cause most missed taps and clicks. In one study, touch errors fell from 42% at 6 mm to 7% at 18 mm for people with less precise pointing.',
    practice:
      'WebAble enlarges the clickable area around small links and buttons without moving them, and stops at half the gap to the next control so areas never overlap.',
    gap: 'In simulations, a short pointing task places you within one step of the right size about 8 times in 10. WebAble refines it from how you use real pages.',
    sources: ['kobayashi2011', 'jin2007', 'findlater2017'],
  },
  {
    id: 'steady-clicks',
    title: 'Steady clicks',
    strength: 'Moderate',
    summary: 'Offers a 200 to 400 ms click window',
    finding:
      'More than 1 in 4 clicks by people with less precise pointing included movement during the click. Holding the click on the pressed target helped, and 200 to 400 ms worked best for older adults, while 800 ms made dragging harder.',
    practice:
      'Only ever offered, never switched on silently. WebAble uses a window of 200 to 400 ms and never applies it to dragging, sliders or text selection.',
    gap: 'Some sites handle clicks in ways that ignore this, so WebAble checks whether it works on each page.',
    sources: ['trewin2006', 'trewin1999', 'tufail2017'],
  },
  {
    id: 'motion',
    title: 'Moving things',
    strength: 'Moderate',
    summary: 'Stops decorative animation',
    finding:
      'Animated ads and backgrounds slowed reading and search in lab and online studies, and animated banners raised the effort people reported.',
    practice:
      'WebAble stops decorative animation and pauses media that starts on its own. You can play anything again.',
    gap: 'No randomized trial yet shows that stopping page motion speeds up everyday tasks. A widely quoted review of distraction during reading covers things like TV and messages, not page motion, so WebAble does not rely on it here.',
    sources: ['simola2011', 'vital2022', 'burke2005', 'shen2025'],
  },
  {
    id: 'busy',
    title: 'Busy areas',
    strength: 'Mixed',
    summary: 'Softens ads and widgets',
    finding:
      'Cluttered pages slowed search from about 4 to 7 seconds on average, more so for people who prefer simple pages. Older readers are also drawn to eye-catching parts of a page, so hiding the wrong part could do harm.',
    practice:
      'WebAble softens ads, recommendations and chat widgets instead of hiding them, and brings them back when you point at them or move into them with the keyboard. Navigation, forms and help are never softened.',
    gap: 'Deciding what an area is for can be wrong. When WebAble is unsure, it leaves the area alone.',
    sources: ['baughan2020', 'salience2020'],
  },
  {
    id: 'line-length',
    title: 'Line length',
    strength: 'Moderate',
    summary: 'Keeps lines to 62 to 80 characters',
    finding:
      'Lines of about 55 characters gave the best understanding at typical and fast reading speeds. Lines of 80 or more made readers lose their place.',
    practice:
      'WebAble keeps long lines of running text to 62 to 80 characters.',
    sources: ['dyson2001', 'wcag148'],
  },
];

/** How Tune measures, and how sure it can be. */
export const TUNE_EVIDENCE: readonly EvidenceItem[] = [
  {
    id: 'tune-reading',
    title: 'Reading',
    strength: 'Strong',
    finding:
      'Short true-or-false sentences get smaller until reading slows. The size where it slows is a well-studied measure that repeats within about one size step between sessions.',
    practice:
      'Tune uses everyday sentences in a typical web font, because the font changes the size a person needs. It measures rather than asking, since the size people pick for comfort can be off by a factor of 2 or more.',
    gap: 'Distance from the screen is unknown, so the result is stored for each kind of device you use.',
    sources: ['subramanian2006', 'latham2022', 'mansfield1996', 'yeatman2024'],
  },
  {
    id: 'tune-pointing',
    title: 'Pointing',
    strength: 'Moderate',
    finding:
      'Pointing speed alone predicts poorly for many people. Misses, slips and spread around the target predict what helps.',
    practice:
      'Tune measures misses and slips on circles of a few sizes, then places you on the target-size ladder. Keyboard, switch and voice users can skip it and set sizes by hand.',
    gap: 'One short session is a starting point. In one study, measures became much more reliable after four sessions, so WebAble keeps refining.',
    sources: ['gajos2007', 'pandey2023'],
  },
  {
    id: 'tune-focus',
    title: 'Focus',
    strength: 'Mixed',
    finding:
      'Short behaviour measures of distraction are noisy for any one person. Which of two pages people prefer tracks how hard a task felt more than how long it took.',
    practice:
      'Tune combines a few search tasks on sample pages with side-by-side choices, and weighs your choices heavily. Pages with motion are never shown if your device asks for reduced motion.',
    gap: 'Onboarding can only spot strong effects. Your keeps and undos do most of the learning afterwards.',
    sources: ['hedge2018', 'hertzum2025', 'baughan2020'],
  },
];

/** How WebAble decides, and why it checks. */
export const DECISION_EVIDENCE: readonly EvidenceItem[] = [
  {
    id: 'offer',
    title: 'Offer, never impose',
    strength: 'Strong',
    finding:
      'People preferred interfaces they control to ones that change on their own, and inaccurate automatic changes were worse than none.',
    practice:
      'Your Tune sets what WebAble does. Anything it notices while you browse only ever becomes a question with two equal answers.',
    sources: ['findlater2004', 'gajos2008', 'lavie2010', 'wobbrock2018'],
  },
  {
    id: 'verify',
    title: 'Checked before it stays',
    strength: 'Moderate',
    finding:
      'A browser extension that audited, changed and then re-checked pages caught all 57 planted problems and rejected 126 harmful edits.',
    practice:
      'After every change, WebAble checks for text that is cut off or overlaps, sideways scrolling, lost contrast, hidden or lost focus and collapsed controls, and puts back any change that fails.',
    gap: 'Checks can’t tell whether a page is easier for you. Your keeps and undos answer that.',
    sources: ['wanscher2026'],
  },
];

/** Popular ideas the evidence does not support, so WebAble does not offer them. */
export const NOT_OFFERED: readonly EvidenceItem[] = [
  {
    id: 'special-fonts',
    title: 'Special reading fonts',
    strength: 'Strong',
    polarity: 'against',
    finding:
      'Fonts sold as easier to read gave no gain in speed or accuracy over common fonts, and one study found readers did not prefer them.',
    practice: 'WebAble does not offer them.',
    sources: ['wery2017', 'kuster2018'],
  },
  {
    id: 'bolding',
    title: 'Bold word beginnings',
    strength: 'Strong',
    polarity: 'against',
    finding:
      'Across more than 2,000 readers, bolding the start of each word made reading slightly slower.',
    practice: 'WebAble does not offer it.',
    sources: ['readwise'],
  },
  {
    id: 'tints',
    title: 'Coloured tints',
    strength: 'Moderate',
    polarity: 'against',
    finding: 'Coloured overlays showed no reliable reading benefit.',
    practice: 'WebAble does not offer them.',
    sources: ['henderson2013'],
  },
  {
    id: 'preference',
    title: 'Trusting preference alone',
    strength: 'Moderate',
    polarity: 'against',
    finding:
      'Reading speed differed by 35% between a person’s fastest and slowest font, and the font people said they liked did not predict the fastest one.',
    practice:
      'WebAble keeps what it measured and what you chose separately. Your choice always wins, and the measurement sets the starting point.',
    sources: ['wallace2022'],
  },
  {
    id: 'focus-outline',
    title: 'Focus outline sizes',
    strength: 'Consensus only',
    finding:
      'No controlled study has measured how the size or contrast of a focus outline changes task time.',
    practice:
      'WebAble follows the published guidance of at least 2 px at 3:1, and uses 3 px.',
    sources: ['wcag2413'],
  },
];
