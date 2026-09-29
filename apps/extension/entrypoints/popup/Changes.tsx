import { useEffect, useRef, useState } from 'react';
import { Button, Disclosure, FitMark, Icon, IndexRule } from '@webable/ui';
import { OP_CATALOG, type OpId } from '@webable/core/ops/catalog';

import { COPY } from '@/lib/popup/copy';
import { fitValue } from '@/lib/popup/format';
import {
  reasonChips,
  type ChangeRow,
  type PopupModel,
  type UndoneRow,
} from '@/lib/popup/model';
import type { TabDetail } from '@/lib/sw/ui';

import type { PopupApi } from './usePopup';

export interface ChangesSectionProps {
  model: PopupModel;
  view: TabDetail;
  api: PopupApi;
}

/**
 * "What changed" (design-final 10.1-10.2): one row per change with its fit
 * mark and an Undo right beside it. Changes WebAble's checks put back sit at
 * the top as neutral rows; they are not errors. Undoing a row offers an
 * optional reason for 8 s.
 */
export function ChangesSection({ model, view, api }: ChangesSectionProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [showing, setShowing] = useState(false);
  const [undoneHere, setUndoneHere] = useState<OpId[]>([]);
  const count = model.changes.length;

  const undo = (op: OpId) => {
    setUndoneHere((list) => (list.includes(op) ? list : [...list, op]));
    void api.act({ type: 'ui:undo', op }).then(() => {
      // The row is gone: keep keyboard focus in the list.
      requestAnimationFrame(() => {
        const reasonRow = document.getElementById(`pp-reason-${op}`);
        (reasonRow ?? headingRef.current)?.focus();
      });
    });
  };

  const showOnPage = (op: OpId | null, on: boolean) =>
    void api.client.send({
      type: 'ui:show-on-page',
      tabId: view.tabId,
      op,
      on,
    });

  const reasons = view.reasonOpen.filter((r) => undoneHere.includes(r.op));

  const rows = (
    <>
      {model.undone.map((row) => (
        <UndoneByChecks key={`undone-${row.op}`} row={row} />
      ))}
      {reasons.map((r) => (
        <ReasonRow
          key={`reason-${r.op}`}
          op={r.op}
          until={r.until}
          api={api}
          onDone={() => {
            if (document.activeElement?.closest(`#pp-reason-${r.op}`))
              headingRef.current?.focus();
          }}
        />
      ))}
      {model.changes.length > 0 ? (
        <ul className="pp-rows" aria-label={COPY.whatChanged}>
          {model.changes.map((row) => (
            <Row
              key={row.op}
              row={row}
              onUndo={undo}
              onShow={(op) => showOnPage(op, true)}
            />
          ))}
        </ul>
      ) : null}
    </>
  );

  if (model.collapseChanges) {
    return (
      <section className="pp-section pp-changes">
        <Disclosure
          title={COPY.whatChanged}
          meta={String(count)}
          density="compact"
          headingLevel={2}
        >
          {rows}
        </Disclosure>
      </section>
    );
  }

  return (
    <section
      className="pp-section pp-changes"
      aria-labelledby="pp-changes-title"
    >
      <IndexRule />
      <div className="pp-section__head">
        <h2
          id="pp-changes-title"
          ref={headingRef}
          tabIndex={-1}
          className="pp-eyebrow"
        >
          {COPY.whatChanged}
        </h2>
        {count > 0 ? (
          <Button
            variant="ghost"
            size="md"
            iconStart="square-dashed"
            aria-pressed={showing}
            onClick={() => {
              const next = !showing;
              setShowing(next);
              showOnPage(null, next);
            }}
          >
            {COPY.showOnPage}
          </Button>
        ) : null}
      </div>
      {rows}
    </section>
  );
}

function Row({
  row,
  onUndo,
  onShow,
}: {
  row: ChangeRow;
  onUndo: (op: OpId) => void;
  onShow: (op: OpId) => void;
}) {
  const value = fitValue(row.change);
  const system = row.change.trace.source === 'system';
  return (
    <li className="pp-row">
      <button
        type="button"
        className="pp-row__label"
        onClick={() => onShow(row.op)}
        aria-label={`${row.label}: show on page`}
      >
        {row.label}
      </button>
      <span className="pp-row__value">
        <FitMark {...value} />
        {system ? (
          <span className="pp-row__source">from your system setting</span>
        ) : null}
      </span>
      <Button
        variant="ghost"
        size="md"
        className="pp-row__undo"
        aria-label={`Undo ${row.label.toLowerCase()}`}
        onClick={() => onUndo(row.op)}
      >
        {COPY.undo}
      </Button>
    </li>
  );
}

/** A change WebAble's own checks put back. Neutral, never "needs attention". */
function UndoneByChecks({ row }: { row: UndoneRow }) {
  return (
    <div className="pp-undone">
      <span className="pp-undone__glyph">
        <Icon name="rotate-ccw" size={16} />
      </span>
      <div className="pp-undone__text">
        <p className="pp-undone__title">{row.title}</p>
        <p className="pp-undone__detail">{row.detail}</p>
        <Disclosure
          title={COPY.why}
          density="compact"
          headingLevel={null}
          className="pp-why"
        >
          <p>{COPY.whyUndone}</p>
        </Disclosure>
      </div>
    </div>
  );
}

/** Optional: why the person undid a change. Hides after the 8 s window. */
function ReasonRow({
  op,
  until,
  api,
  onDone,
}: {
  op: OpId;
  until: number;
  api: PopupApi;
  onDone: () => void;
}) {
  const [answered, setAnswered] = useState(false);
  const [open, setOpen] = useState(() => until > Date.now());
  const label = OP_CATALOG[op].label;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const ms = until - Date.now();
    if (ms <= 0) {
      setOpen(false);
      return;
    }
    const timer = setTimeout(
      () => setOpen(false),
      answered ? Math.min(ms, 2_500) : ms,
    );
    return () => clearTimeout(timer);
  }, [until, answered]);

  useEffect(() => {
    if (!open) onDoneRef.current();
  }, [open]);

  if (!open) return null;
  return (
    <div
      id={`pp-reason-${op}`}
      className="pp-reason"
      role="group"
      aria-label={`${label} undone`}
      tabIndex={-1}
    >
      <p className="pp-reason__title">
        <Icon name="rotate-ccw" size={16} />
        <span>{`${label} undone`}</span>
      </p>
      {answered ? (
        <p className="pp-reason__meta" role="status">
          Noted. WebAble will use this next time.
        </p>
      ) : (
        <>
          <p className="pp-reason__meta">What was wrong? You can skip this.</p>
          <div className="pp-reason__chips">
            {reasonChips(op).map((chip) => (
              <Button
                key={chip.reason}
                variant="secondary"
                size="md"
                onClick={() => {
                  setAnswered(true);
                  void api.act({
                    type: 'ui:undo-reason',
                    op,
                    reason: chip.reason,
                  });
                }}
              >
                {chip.label}
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
