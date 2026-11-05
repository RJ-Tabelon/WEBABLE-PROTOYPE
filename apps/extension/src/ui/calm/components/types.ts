// Contract for Calm view's meaning-first components (round 7).
// The engine and planner (Lucius) turn a page into these plain-data props; the components (Alfred) only render them.
// Components never touch the page's DOM. Anything clickable calls `onActivate`, which presses the original element.

export interface Activatable {
  /** Called when the person activates this item in Calm view; presses the original element on the page. */
  onActivate?: () => void;
  /** Original link target, shown for context only (never navigated to directly). */
  href?: string;
}

/** A picture the page uses as content (team logos, product shots, chart images). Never decorative. */
export interface Picture {
  src: string;
  alt: string;
  /** Natural aspect ratio (width / height) when known, so the box never jumps. */
  ratio?: number;
}

/** "Wins 54", "Home record 30-6", "Price $4.00". */
export interface StatItem {
  label: string;
  value: string;
  /** Small context under the value: "since 1917", "this season". */
  sub?: string;
  /** Emphasise the one or two numbers the page is mainly about. */
  emphasis?: 'lead' | 'normal';
}

export interface StatGridProps {
  title?: string;
  items: StatItem[];
}

export interface ScoreSide {
  name: string;
  logo?: Picture;
  score: string;
  /** 'home' | 'away' | 'neutral' as the page states it. */
  side?: 'home' | 'away' | 'neutral';
  winner?: boolean;
}

export interface ScoreboardProps {
  /** "Last matchup", "Final". */
  label?: string;
  date?: string;
  /** "at", "vs". */
  joiner?: string;
  sides: ScoreSide[];
  /** Optional line score: period labels and one row per side. */
  periods?: { labels: string[]; rows: Array<{ name: string; values: string[] }> };
}

export interface DataTableProps {
  caption?: string;
  columns: string[];
  rows: string[][];
  /** Column indexes that hold numbers (right-aligned, tabular figures). */
  numericCols?: number[];
  /** Show the first N rows, with "Show all N rows" for the rest. */
  showFirst?: number;
}

export interface ScheduleItem extends Activatable {
  date: string;
  title: string;
  detail?: string;
  /** "W 38-19", "Final", "3:30 p.m." */
  result?: string;
  logo?: Picture;
}

export interface ScheduleListProps {
  title?: string;
  items: ScheduleItem[];
  /** Index of the item to mark as next or current. */
  currentIndex?: number;
}

export interface RecipeProps {
  title: string;
  /** "Prep 15 min", "Serves 24", "Rating 4.7". */
  meta?: StatItem[];
  picture?: Picture;
  ingredients: string[];
  steps: string[];
  /** Original-page notes the person may want (e.g. "Tips"), shown after the steps. */
  notes?: string[];
}

/** A site or team mark shown next to a name; kept because it identifies something on the page. */
export interface LogoMarkProps {
  picture: Picture;
  label: string;
  size?: 'small' | 'medium' | 'large';
}
