import { type ActivityTableRow, narrowCounts } from './activity';

function Count({ n }: { n: number }) {
  return (
    <td className={n === 0 ? 'wa-table__num wa-table__zero' : 'wa-table__num'}>
      {n}
    </td>
  );
}

/**
 * Changes by kind over the period, as one hairline table (Change | This week |
 * N weeks | Undone by you | Undone by checks), right-aligned tabular numerals.
 * Below 40em the same rows read as one line each ("48 this week · 78 in 8
 * weeks"); only one of the two is displayed, so only one is in the
 * accessibility tree.
 */
export function ActivityTable({
  rows,
  weeks,
}: {
  rows: readonly ActivityTableRow[];
  weeks: number;
}) {
  return (
    <div className="wa-activity">
      <table className="wa-table wa-activity__table">
        <caption className="sr-only">
          Changes by kind, this week and in the last {weeks} weeks
        </caption>
        <thead>
          <tr>
            <th scope="col">Change</th>
            <th scope="col" className="wa-table__num">
              This week
            </th>
            <th scope="col" className="wa-table__num">
              {weeks} weeks
            </th>
            <th scope="col" className="wa-table__num">
              Undone by you
            </th>
            <th scope="col" className="wa-table__num">
              Undone by checks
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <Count n={row.week.applied} />
              <Count n={row.period.applied} />
              <Count n={row.period.undone} />
              <Count n={row.period.undoneByChecks} />
            </tr>
          ))}
        </tbody>
      </table>
      <ul
        role="list"
        className="wa-rows wa-activity__list"
        aria-label={`Changes by kind, this week and in the last ${weeks} weeks`}
      >
        {rows.map((row) => (
          <li key={row.key} className="wa-row">
            <p className="wa-row__label">{row.label}</p>
            <p className="wa-row__detail wa-num">{narrowCounts(row, weeks)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
