import { useRef, useState } from 'react';
import { Button, Disclosure, FitMark, Icon, IndexRule } from '@webable/ui';
import { OP_CATALOG, type OpId } from '@webable/core/ops/catalog';

import { COPY, zoomLowered } from '@/lib/popup/copy';
import { fitValue, redoableOps, targetLimited } from '@/lib/popup/format';
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

const HIDE_ON_PAGE = 'Hide on page';
const TARGET_LIMITED = 'Limited by nearby buttons';

/**
 * "What changed" (design-final 10.1-10.2): one row per change with its fit
 * mark and an Undo right beside it. Changes WebAble's checks put back sit at
 * the top as neutral rows; they are not errors. A change the person undid
 * stays as a "{label} was undone" row with Redo on this site; one
 * undone here also offers an optional reason.
 */
export function ChangesSection({ model, view, api }: ChangesSectionProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [undoneHere, setUndoneHere] = useState<OpId[]>([]);
  const count = model.changes.length;

  /** Keep keyboard focus in the list when the focused row goes away. */
  const focusSoon = (id: string) =>
    requestAnimationFrame(() => {
      (document.getElementById(id) ?? headingRef.current)?.focus();
    });

  const undo = (op: OpId) => {
    setUndoneHere((list) => (list.includes(op) ? list : [...list, op]));
    void api
      .act({ type: 'ui:undo', op })
      .then(() => focusSoon(`pp-reason-${op}`));
  };

  const redo = (op: OpId) => {
    setUndoneHere((list) => list.filter((o) => o !== op));
    void api.act({ type: 'ui:redo', op }).then(() => focusSoon(`pp-row-${op}`));
  };

  const showOnPage = (op: OpId | null, on: boolean) =>
    void api.act({ type: 'ui:show-on-page', op, on });

  const redoable = redoableOps(view.undoneByYou, view.changes);

  const rows = (
    <>
      {model.undone.map((row) => (
        <UndoneByChecks key={`undone-${row.op}`} row={row} />
      ))}
      {redoable.map((op) => (
        <ReasonRow
          key={`reason-${op}`}
          op={op}
          ask={undoneHere.includes(op)}
          api={api}
          onRedo={redo}
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
            aria-pressed={view.showing}
            onClick={() => showOnPage(null, !view.showing)}
          >
            {view.showing ? HIDE_ON_PAGE : COPY.showOnPage}
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
  // Page zoom is the whole page (100% -> 150%): nothing to mark on it.
  const zoom = row.op === 'page_zoom';
  // A zoom the checks lowered one step and kept carries why (nav_hidden, overflow).
  const lowered =
    zoom && row.change.vcode ? zoomLowered(row.change.vcode) : null;
  return (
    <li className="pp-row">
      {zoom ? (
        <span
          id={`pp-row-${row.op}`}
          tabIndex={-1}
          className="pp-row__label pp-row__label--static"
        >
          {row.label}
        </span>
      ) : (
        <button
          type="button"
          id={`pp-row-${row.op}`}
          className="pp-row__label"
          onClick={() => onShow(row.op)}
          aria-label={`${row.label}: show on page`}
        >
          {row.label}
        </button>
      )}
      <span className="pp-row__value">
        <FitMark {...value} />
        {system ? (
          <span className="pp-row__source">from your system setting</span>
        ) : null}
        {targetLimited(row.change) ? (
          <span className="pp-row__source">{TARGET_LIMITED}</span>
        ) : null}
        {lowered ? <span className="pp-row__source">{lowered}</span> : null}
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

/**
 * A change the person undid: "{label} was undone" with Redo. It stays until
 * the popup closes; `ask` adds the optional "What was wrong?" chips.
 */
function ReasonRow({
  op,
  ask,
  api,
  onRedo,
}: {
  op: OpId;
  ask: boolean;
  api: PopupApi;
  onRedo: (op: OpId) => void;
}) {
  const [answered, setAnswered] = useState(false);
  const label = OP_CATALOG[op].label;
  const title = `${label} was undone`;
  return (
    <div
      id={`pp-reason-${op}`}
      className="pp-reason"
      role="group"
      aria-label={title}
      tabIndex={-1}
    >
      <div className="pp-reason__head">
        <p className="pp-reason__title">
          <Icon name="rotate-ccw" size={16} />
          <span>{title}</span>
        </p>
        <Button
          variant="ghost"
          size="md"
          iconStart={<Icon name="rotate-cw" size={16} />}
          className="pp-reason__redo"
          aria-label={`Redo ${label.toLowerCase()}`}
          onClick={() => onRedo(op)}
        >
          Redo
        </Button>
      </div>
      <p className="pp-reason__meta">
        Saved for this site. Redo turns it back on.
      </p>
      {!ask ? null : answered ? (
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
