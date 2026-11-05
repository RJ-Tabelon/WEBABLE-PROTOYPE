// Owner: P (round 7). Which parts of the page a purpose component already draws, so Calm view never shows them twice.
//
// A component draws structured content read from the page (a record, a scoreboard, a table, a recipe). The page's own
// elements that hold only that content are "covered": Calm view leaves them out of the sections, because the component
// shows them. Elements that hold anything else (a "Full box score" link, a paragraph) stay where they are, so nothing
// is lost. Coverage is by words: every word of an element must be a word of the content (or of the component's own
// headings, like "Ingredients"), with a little slack for long blocks.
//
// Pure: works on any tree through the `CoverTree` accessors, so it is tested without a browser.

export interface CoverTree<T> {
  text(n: T): string;
  children(n: T): T[];
  /** A link, button or field the person can use (never covered unless its own words are content). */
  isControl(n: T): boolean;
  /** A real table: covered with more slack (its row buttons go to the part's links). */
  isTable(n: T): boolean;
}

/** Glue words content strings often leave out. */
const STOP = new Set(['the', 'of', 'a', 'an', 'and', 'to', 'for', 'in', 'on', 'at', 'vs', 'by', 'with', 'or', 'from', 'is', 'as', 'v']);

/** Words of a text: lower case, accents off, numbers kept whole ("30-6", "11/8/2025", "7:30", "2.5"). */
export function tokens(s: string): string[] {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .match(/[a-z0-9]+(?:[-–/.:'’][a-z0-9]+)*/g) ?? []
  ).map((t) => t.replace(/[’]/g, "'").replace(/–/g, '-'));
}

/** True when the words are (almost) all content words: misses allowed are `slack` of the words, rounded down. */
export function wordsCovered(words: string[], set: ReadonlySet<string>, slack = 0.1): boolean {
  const ws = words.filter((w) => !STOP.has(w));
  if (!ws.length) return true;
  let miss = 0;
  for (const w of ws) if (!set.has(w)) miss++;
  return miss <= Math.floor(ws.length * slack);
}

/** Share of the content's distinct words (three letters or more) that an element's words hold. */
export function contentShare(words: string[], content: ReadonlySet<string>): number {
  const own = new Set(words);
  let n = 0;
  let hit = 0;
  for (const w of content) {
    if (w.length < 3 || STOP.has(w)) continue;
    n++;
    if (own.has(w)) hit++;
  }
  return n ? hit / n : 0;
}

export interface CoverResult<T> {
  /** Outermost elements that hold only content (the component draws them). */
  covered: T[];
  /** Controls inside covered elements whose own words are not content (a table's "Links for game" buttons). */
  orphans: T[];
}

/**
 * Walk from `root`: an element whose words are all content is covered whole; an element with some other words is
 * opened up and its children checked; an element with no words (a logo picture, a divider) is covered when its parent's
 * words are mostly content and it holds no control. Depth is capped.
 */
export function coverTree<T>(root: T, tree: CoverTree<T>, set: ReadonlySet<string>, maxDepth = 12): CoverResult<T> {
  const covered: T[] = [];
  const orphans: T[] = [];
  const controlsIn = (n: T, out: T[]): void => {
    for (const c of tree.children(n)) {
      if (tree.isControl(c)) out.push(c);
      else controlsIn(c, out);
    }
  };
  const take = (n: T): void => {
    covered.push(n);
    const cs: T[] = [];
    if (tree.isControl(n)) return;
    controlsIn(n, cs);
    for (const c of cs) if (!wordsCovered(tokens(tree.text(c)), set, 0)) orphans.push(c);
  };
  /** Share of an element's own words that are content words (decides whether a word-less child is part of it). */
  const richness = (words: string[]): number => {
    const ws = words.filter((w) => !STOP.has(w));
    return ws.length ? ws.filter((w) => set.has(w)).length / ws.length : 0;
  };
  /** An element's words without the words of the links and buttons inside it (those are handled as controls). */
  const ownWords = (n: T): string[] => {
    const words = tokens(tree.text(n));
    if (tree.isControl(n)) return words;
    const cs: T[] = [];
    controlsIn(n, cs);
    if (!cs.length) return words;
    const left = new Map<string, number>();
    for (const w of words) left.set(w, (left.get(w) ?? 0) + 1);
    for (const c of cs) for (const w of tokens(tree.text(c))) left.set(w, (left.get(w) ?? 0) - 1);
    return words.filter((w) => {
      const k = left.get(w) ?? 0;
      if (k <= 0) return false;
      left.set(w, k - 1);
      return true;
    });
  };
  const walk = (n: T, depth: number, parentRich: boolean): void => {
    const all = tokens(tree.text(n));
    const words = ownWords(n);
    if (!all.length) {
      if (depth > 0 && parentRich && !tree.isControl(n)) {
        const cs: T[] = [];
        controlsIn(n, cs);
        if (!cs.length) covered.push(n);
      }
      return;
    }
    // Only links and buttons (no content words of its own): left for the part's link row.
    if (!words.length && !tree.isControl(n)) {
      if (depth >= maxDepth) return;
      for (const c of tree.children(n)) walk(c, depth + 1, false);
      return;
    }
    if (wordsCovered(words, set, tree.isTable(n) ? 0.2 : 0.1)) {
      take(n);
      return;
    }
    if (depth >= maxDepth || tree.isControl(n)) return;
    const rich = richness(words) >= 0.5;
    for (const c of tree.children(n)) walk(c, depth + 1, rich);
  };
  walk(root, 0, false);
  return { covered, orphans };
}
