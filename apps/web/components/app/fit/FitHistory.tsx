'use client';

import { Actions, Button, FitValue, useToast } from '@webable/ui';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';

import { restoreVersionAction } from '../../../app/app/actions';
import { DATA_ERROR_MESSAGES } from '../../../lib/data/result';
import { nudgeExtension } from '../../../lib/extension/bridge';
import { writeFitUi } from '../../shell/fit-ui';
import type { HistoryChange, HistoryItem } from './history';
import { fitUiFor, toFitUiInput } from './ui';

function Changes({
  changes,
  label,
}: {
  changes: HistoryChange[];
  label?: string;
}) {
  return (
    <ul role="list" className="wa-history__changes" aria-label={label}>
      {changes.map((change) => (
        <li key={change.id} className="wa-history__change">
          <span className="wa-history__change-label">{change.label}</span>
          <FitValue value={change.value} size="inline" />
        </li>
      ))}
    </ul>
  );
}

async function saveVersion(fromVersion: number) {
  try {
    const result = await restoreVersionAction({ fromVersion });
    return result.ok ? result.data : result.error.message;
  } catch {
    return DATA_ERROR_MESSAGES.unavailable;
  }
}

/**
 * Saved versions, newest first (design-final §9.5): when, where it came from,
 * and which rows changed from the version before, as inline fit marks. Any
 * earlier version can be used again: [Use this version] shows what would
 * change from the current fit, and [Use it] saves it as a new version, with
 * Undo.
 */
export function FitHistory({ items }: { items: HistoryItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const uid = useId();

  function close(id: string) {
    setOpen(null);
    setError(null);
    requestAnimationFrame(() => openers.current.get(id)?.focus());
  }

  function applied(profile: Parameters<typeof fitUiFor>[0]) {
    writeFitUi(toFitUiInput(fitUiFor(profile)));
    void nudgeExtension();
    router.refresh();
  }

  async function use(item: HistoryItem) {
    setSaving(true);
    setError(null);
    const result = await saveVersion(item.version);
    setSaving(false);
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    applied(result.profile);
    setOpen(null);
    const previous = result.previousVersion;
    toast.show({
      message: `Now using version ${item.version}.`,
      applied: true,
      action: {
        label: 'Undo',
        onAction: () =>
          void (async () => {
            const back = await saveVersion(previous);
            if (typeof back === 'string') {
              toast.show({ message: `Couldn’t undo. ${back}` });
              return;
            }
            applied(back.profile);
            toast.show({ message: `Back to version ${previous}.` });
          })(),
      },
    });
  }

  return (
    <ol role="list" className="wa-history">
      {items.map((item) => {
        const isOpen = open === item.id;
        const panelId = `${uid}-use-${item.id}`;
        const titleId = `${uid}-title-${item.id}`;
        return (
          <li key={item.id} className="wa-history__item">
            <div className="wa-history__head">
              <h3 id={titleId} className="wa-history__title">
                Version {item.version}
                <span className="wa-history__source">
                  {' '}
                  · {item.sourceLabel}
                </span>
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
              <Changes changes={item.changes} />
            ) : (
              <p className="wa-app-meta">
                {item.first
                  ? 'Your first fit.'
                  : 'Saved again with the same settings.'}
              </p>
            )}
            {item.restore ? (
              <div className="wa-history__use">
                <Button
                  ref={(el: HTMLButtonElement | null) => {
                    if (el) openers.current.set(item.id, el);
                    else openers.current.delete(item.id);
                  }}
                  variant="ghost"
                  size="md"
                  flush="start"
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? panelId : undefined}
                  aria-describedby={titleId}
                  disabled={saving && !isOpen}
                  onClick={() => (isOpen ? close(item.id) : setOpen(item.id))}
                >
                  Use this version
                </Button>
                {isOpen ? (
                  <div
                    id={panelId}
                    role="group"
                    aria-labelledby={titleId}
                    className="wa-history__panel"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && !saving) {
                        event.preventDefault();
                        close(item.id);
                      }
                    }}
                  >
                    {item.restore.length > 0 ? (
                      <>
                        <p className="wa-history__panel-lead">
                          From your fit now to version {item.version}:
                        </p>
                        <Changes
                          changes={item.restore}
                          label={`What changes with version ${item.version}`}
                        />
                      </>
                    ) : (
                      <p className="wa-history__panel-lead">
                        Version {item.version} has the same settings as your fit
                        now.
                      </p>
                    )}
                    {error ? (
                      <p className="wa-reason" role="alert">
                        Nothing changed. {error}
                      </p>
                    ) : null}
                    <Actions>
                      <Button
                        variant="primary"
                        size="md"
                        busy={saving}
                        busyLabel="Saving…"
                        onClick={() => void use(item)}
                      >
                        Use it
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        disabled={saving}
                        onClick={() => close(item.id)}
                      >
                        Cancel
                      </Button>
                    </Actions>
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
