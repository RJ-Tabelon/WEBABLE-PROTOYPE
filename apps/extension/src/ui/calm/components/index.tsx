// Owner: Alfred (round 7). Calm view components that keep a page's meaning.
// The planner passes plain-data props; these components only render them. They never read the page's DOM.
// Clicking calls onActivate, which presses the original element. Styles live in components.css.ts and use --wa-* tokens.
import { Fragment, type JSX } from 'preact';
import { useId, useState } from 'preact/hooks';
import { componentsCss } from './components.css';
import type {
  DataTableProps, LogoMarkProps, Picture, RecipeProps, ScheduleItem, ScheduleListProps, ScoreSide, ScoreboardProps, StatGridProps,
} from './types';

export { componentsCss };

function ratioStyle(picture: Picture): JSX.CSSProperties | undefined {
  const ratio = picture.ratio;
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) return undefined;
  return { '--wa-mc-ratio': String(Math.round(ratio * 1000) / 1000) } as JSX.CSSProperties;
}

/** A content picture in a box of its real aspect ratio. No frame, and no CSS url(). */
function PictureBox({ picture, size }: { picture: Picture; size: 'mark' | 'small' | 'score' | 'wide' }): JSX.Element {
  return (
    <span class={`wa-picbox wa-picbox--${size}`} style={ratioStyle(picture)}>
      <img src={picture.src} alt={picture.alt} decoding="async" />
    </span>
  );
}

/** US numeric dates from the page ("11/8/2025") get a machine-readable datetime. Anything else stays plain text. */
function DateText({ date, class: className }: { date: string; class: string }): JSX.Element {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date.trim());
  const month = Number(m?.[1]);
  const day = Number(m?.[2]);
  const year = m?.[3];
  if (year && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
    const dateTime = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return <time class={className} dateTime={dateTime}>{date}</time>;
  }
  return <span class={className}>{date}</span>;
}

function sideWord(side: ScoreSide['side']): string | null {
  if (side === 'home') return 'Home';
  if (side === 'away') return 'Away';
  if (side === 'neutral') return 'Neutral';
  return null;
}

/** Big numbers with their labels underneath. Two columns when narrow, up to four when there is room. Lead items are larger. */
export function StatGrid({ title, items }: StatGridProps): JSX.Element {
  const titleId = useId();
  return (
    <section class="wa-mc wa-statgrid" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : 'Statistics'}>
      {title ? <h2 class="wa-statgrid__title" id={titleId}>{title}</h2> : null}
      <ul class="wa-statgrid__items">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} class="wa-statgrid__item" data-emphasis={item.emphasis === 'lead' ? 'lead' : 'normal'}>
            <span class="wa-statgrid__value">{item.value}</span>
            <span class="wa-statgrid__label">{item.label}</span>
            {item.sub ? <span class="wa-statgrid__sub">{item.sub}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Two sides, their logos and scores. The winner is bold and labelled "Won", not signalled by colour alone. */
export function Scoreboard({ label, date, joiner, sides, periods }: ScoreboardProps): JSX.Element {
  const labelId = useId();
  const pair = sides.length === 2;
  const between = typeof joiner === 'string' && joiner.length > 0;
  const showLine = !!periods && (periods.labels.length > 0 || periods.rows.length > 0);
  return (
    <section class="wa-mc wa-scoreboard" aria-labelledby={label ? labelId : undefined} aria-label={label ? undefined : date ? `Scoreboard, ${date}` : 'Scoreboard'}>
      {(label || date) ? (
        <header class="wa-scoreboard__head">
          {label ? <h2 class="wa-scoreboard__label" id={labelId}>{label}</h2> : null}
          {date ? <DateText class="wa-scoreboard__date" date={date} /> : null}
        </header>
      ) : null}
      <div class={`wa-scoreboard__sides${pair ? ' wa-scoreboard__sides--pair' : ''}${pair && !between ? ' wa-scoreboard__sides--plain' : ''}`}>
        {sides.map((side, i) => {
          const place = sideWord(side.side);
          return (
            <Fragment key={`${side.name}-${i}`}>
              {i > 0 && between ? <p class="wa-scoreboard__joiner">{joiner}</p> : null}
              <div class="wa-scoreboard__side" data-winner={side.winner ? '' : undefined}>
                {side.logo ? <PictureBox picture={side.logo} size="score" /> : null}
                <p class="wa-scoreboard__name">{side.name}</p>
                {place ? <p class="wa-scoreboard__place">{place}</p> : null}
                <p class="wa-scoreboard__score">{side.score}</p>
                {side.winner ? <p class="wa-scoreboard__won">Won</p> : null}
              </div>
            </Fragment>
          );
        })}
      </div>
      {showLine && periods ? <LineScore periods={periods} /> : null}
    </section>
  );
}

function LineScore({ periods }: { periods: NonNullable<ScoreboardProps['periods']> }): JSX.Element {
  const longest = periods.rows.reduce((n, row) => Math.max(n, row.values.length), 0);
  const labels = periods.labels.length > 0 ? periods.labels : Array.from({ length: longest }, (_, i) => String(i + 1));
  return (
    <div class="wa-scoreboard__linescroll" tabIndex={0} aria-label="Line score. Scroll sideways for more columns.">
      <table class="wa-scoreboard__lines">
        <caption>Line score</caption>
        <thead>
          <tr>
            <th scope="col">Team</th>
            {labels.map((text, i) => (
              <th key={i} scope="col" data-num="">{text}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.rows.map((row, i) => (
            <tr key={`${row.name}-${i}`}>
              <th scope="row">{row.name}</th>
              {labels.map((_, j) => (
                <td key={j} data-num="">{row.values[j] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** How many rows to show before the "Show all" button. Null means the whole table is already in view. */
function collapseCount(showFirst: number | undefined, total: number): number | null {
  if (showFirst == null || !Number.isFinite(showFirst)) return null;
  const n = Math.max(0, Math.floor(showFirst));
  if (n >= total) return null;
  return n;
}

/**
 * A real table. Wide tables scroll inside this box (minmax(0, 1fr) plus overflow) so the page itself does not scroll sideways.
 * Numbers in `numericCols` are right-aligned in tabular figures. `showFirst` folds the rest behind "Show all N rows".
 */
export function DataTable({ caption, columns, rows, numericCols, showFirst }: DataTableProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const numeric = new Set((numericCols ?? []).filter((n) => Number.isInteger(n) && n >= 0 && n < columns.length));
  const folded = collapseCount(showFirst, rows.length);
  const shown = folded == null || open ? rows : rows.slice(0, folded);
  const scrollLabel = caption ? `${caption}. Scroll sideways for more columns.` : 'Scroll sideways for more columns.';
  return (
    <div class="wa-mc wa-datatable">
      <div class="wa-datatable__scroll" tabIndex={0} aria-label={scrollLabel}>
        <table>
          {caption ? <caption>{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((col, j) => (
                <th key={j} scope="col" data-num={numeric.has(j) ? '' : undefined}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i}>
                {columns.map((_, j) => (
                  <td key={j} data-num={numeric.has(j) ? '' : undefined}>{row[j] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {folded != null ? (
        <button type="button" class="wa-datatable__more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? `Show the first ${folded} rows` : `Show all ${rows.length} rows`}
        </button>
      ) : null}
    </div>
  );
}

function ScheduleRow({ item, current }: { item: ScheduleItem; current: boolean }): JSX.Element {
  const body = (
    <>
      <DateText class="wa-schedule__date" date={item.date} />
      {item.logo ? <PictureBox picture={item.logo} size="small" /> : <span class="wa-schedule__logo-spacer" aria-hidden="true" />}
      <span class="wa-schedule__main">
        <span class="wa-schedule__titleline">
          <span class="wa-schedule__name">{item.title}</span>
          {current ? <span class="wa-schedule__current">Current</span> : null}
        </span>
        {item.detail ? <span class="wa-schedule__detail">{item.detail}</span> : null}
        {item.href ? <span class="wa-schedule__href" title={item.href}>{item.href}</span> : null}
      </span>
      {item.result ? <span class="wa-schedule__result">{item.result}</span> : null}
    </>
  );
  return (
    <li class="wa-schedule__item" data-current={current ? '' : undefined}>
      {item.onActivate ? (
        <button type="button" class="wa-schedule__row" aria-current={current ? 'true' : undefined} onClick={item.onActivate}>
          {body}
        </button>
      ) : (
        <div class="wa-schedule__row" aria-current={current ? 'true' : undefined}>{body}</div>
      )}
    </li>
  );
}

/** One row per item: date, logo, title, result. The current row is marked in words. Rows are buttons only when they can activate. */
export function ScheduleList({ title, items, currentIndex }: ScheduleListProps): JSX.Element {
  const titleId = useId();
  return (
    <section class="wa-mc wa-schedule" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : 'Schedule'}>
      {title ? <h2 class="wa-schedule__heading" id={titleId}>{title}</h2> : null}
      <ul class="wa-schedule__list">
        {items.map((item, i) => (
          <ScheduleRow key={`${item.date}-${item.title}-${i}`} item={item} current={i === currentIndex} />
        ))}
      </ul>
    </section>
  );
}

/** Checklist state lives in memory for this view only. Ticking crosses an ingredient off; nothing is stored. */
function Ingredients({ items }: { items: string[] }): JSX.Element {
  const [done, setDone] = useState<boolean[]>([]);
  const toggle = (i: number): void => {
    setDone((prev) => {
      const next = prev.slice();
      next[i] = !prev[i];
      return next;
    });
  };
  return (
    <ul class="wa-recipe__ings">
      {items.map((item, i) => {
        const on = !!done[i];
        return (
          <li key={`${item}-${i}`}>
            <label class="wa-recipe__ing" data-done={on ? '' : undefined}>
              <input type="checkbox" checked={on} onChange={() => toggle(i)} />
              <span class="wa-recipe__ingtext">{item}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** Title, picture, a small stat row, ingredients to tick off, numbered steps, then notes. */
export function Recipe({ title, meta, picture, ingredients, steps, notes }: RecipeProps): JSX.Element {
  const titleId = useId();
  return (
    <article class="wa-mc wa-recipe" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      {picture ? (
        <figure class="wa-recipe__figure">
          <PictureBox picture={picture} size="wide" />
        </figure>
      ) : null}
      {meta && meta.length > 0 ? (
        <ul class="wa-recipe__meta">
          {meta.map((item, i) => (
            <li key={`${item.label}-${i}`}>
              <span class="wa-recipe__metavalue">{item.value}</span>
              <span class="wa-recipe__metalabel">{item.label}</span>
              {item.sub ? <span class="wa-recipe__metasub">{item.sub}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {ingredients.length > 0 ? (
        <div class="wa-recipe__block">
          <h3>Ingredients</h3>
          <Ingredients items={ingredients} />
        </div>
      ) : null}
      {steps.length > 0 ? (
        <div class="wa-recipe__block">
          <h3>Steps</h3>
          <ol class="wa-recipe__steps">
            {steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {notes && notes.length > 0 ? (
        <div class="wa-recipe__block">
          <h3>Notes</h3>
          <ul class="wa-recipe__notes">
            {notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/** A logo kept because it identifies something, with its name beside it. */
export function LogoMark({ picture, label, size = 'medium' }: LogoMarkProps): JSX.Element {
  return (
    <span class="wa-mc wa-logomark" data-size={size}>
      <PictureBox picture={picture} size="mark" />
      <span class="wa-logomark__name">{label}</span>
    </span>
  );
}
