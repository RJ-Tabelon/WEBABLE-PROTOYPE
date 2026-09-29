import type { HistoryItem } from './history';
import { FitReadout } from './FitReadout';

/**
 * Saved versions, newest first (design-final §9.5): when, where it came from,
 * and which rows changed from the version before, as inline fit marks.
 */
export function FitHistory({ items }: { items: HistoryItem[] }) {
  return (
    <ol role="list" className="wa-history">
      {items.map((item) => (
        <li key={item.id} className="wa-history__item">
          <div className="wa-history__head">
            <h3 className="wa-history__title">
              Version {item.version}
              <span className="wa-history__source"> · {item.sourceLabel}</span>
            </h3>
            <p className="wa-history__date">
              <time dateTime={item.dateTime}>{item.date}</time>
              {item.isCurrent ? ' · In use now' : ''}
            </p>
          </div>
          {item.unreadable ? (
            <p className="wa-app-meta">
              This version was saved by an older WebAble and can’t be shown.
            </p>
          ) : item.changes.length > 0 ? (
            <ul role="list" className="wa-history__changes">
              {item.changes.map((change) => (
                <li key={change.id} className="wa-history__change">
                  <span className="wa-history__change-label">
                    {change.label}
                  </span>
                  <FitReadout
                    size="inline"
                    before={change.before}
                    after={change.after}
                    srText={change.srText}
                    changed
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="wa-app-meta">
              {item.first
                ? 'Your first fit.'
                : 'Saved again with the same settings.'}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
