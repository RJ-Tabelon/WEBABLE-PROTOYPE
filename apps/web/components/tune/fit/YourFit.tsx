'use client';

import type { FitProfile } from '@webable/core';
import {
  fitRows,
  type FitRow,
  type FitRowId,
} from '@webable/core/profile/describe';
import {
  Button,
  cx,
  ErrorPanel,
  FitArrow,
  FitMark,
  SegmentedControl,
} from '@webable/ui';
import { useId, useMemo, useState } from 'react';

import {
  adjustSpec,
  applyAdjustment,
  keepOldRows,
  type AdjustSpec,
} from '../flow/adjust';
import { TaskHeading } from '../shared/primitives';
import { FitPreview } from './FitPreview';

export type SaveState =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string };

export interface YourFitProps {
  profile: FitProfile;
  /** The current fit when recalibrating: rows show the diff with Keep new / Keep old. */
  previous: FitProfile | null;
  /** When the previous fit was made (ISO), for "since Jun 12". */
  previousDate: string | null;
  rootFontPx: number;
  /** Signed in: the fit is saved to the account; otherwise it waits in this browser. */
  signedIn: boolean;
  save: SaveState;
  onUse: (profile: FitProfile) => void;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function since(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `since ${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}`;
}

/** "16 px" → value and unit; anything else stays a word ("Paused"). */
function split(value: string): { n: string; unit?: string } {
  const m = /^([\d.:]+)\u00a0(px|ms|characters)$/.exec(value);
  return m && m[1] ? { n: m[1], unit: m[2] } : { n: value };
}

function isNumeric(value: string): boolean {
  return /^[\d.:]+$/.test(value);
}

function Readout({ row }: { row: FitRow }) {
  const after = split(row.after);
  const before = split(row.before);
  // Words ("Paused", "Site colors") read as words; numbers get the Mono fit mark.
  const words = !isNumeric(after.n) || (row.changed && !isNumeric(before.n));
  if (!words) {
    const sameUnit = !before.unit || before.unit === after.unit;
    return (
      <span className="tn-readout-lg">
        <span aria-hidden="true">
          <FitMark
            size="readout"
            className={cx('tn-fitmark', !row.changed && 'tn-fitmark--same')}
            {...(row.changed ? { from: sameUnit ? before.n : row.before } : {})}
            to={after.n}
            {...(after.unit ? { unit: after.unit } : {})}
          />
        </span>
        <span className="sr-only">{row.srText}</span>
      </span>
    );
  }
  if (!row.changed) {
    return (
      <span className="tn-readout-lg tn-readout-lg--same tn-readout-lg--words">
        <span aria-hidden="true">{row.after}</span>
        <span className="sr-only">{row.srText}</span>
      </span>
    );
  }
  return (
    <span className="tn-readout-lg tn-readout-lg--words">
      <span aria-hidden="true" className="tn-readout-lg__visual">
        <span className="tn-readout-lg__from">{row.before}</span>
        <FitArrow className="tn-readout-lg__arrow" />
        <span className="tn-readout-lg__to">{row.after}</span>
      </span>
      <span className="sr-only">{row.srText}</span>
    </span>
  );
}

function AdjustControl({
  spec,
  onChange,
}: {
  spec: AdjustSpec;
  onChange: (value: string | number) => void;
}) {
  if (spec.kind === 'note') return <p className="tn-meta">{spec.text}</p>;
  if (spec.kind === 'choice') {
    return (
      <SegmentedControl
        label={spec.label}
        value={spec.current}
        onValueChange={(v) => onChange(v)}
        options={spec.options.map((o) => ({ value: o.value, label: o.label }))}
      />
    );
  }
  const i = spec.values.indexOf(spec.current);
  const lower = i > 0 ? spec.values[i - 1] : undefined;
  const higher =
    i >= 0 && i < spec.values.length - 1 ? spec.values[i + 1] : undefined;
  return (
    <div className="tn-stepper" role="group" aria-label={spec.label}>
      <Button
        variant="secondary"
        size="task"
        iconStart="minus"
        disabled={lower === undefined}
        onClick={() => lower !== undefined && onChange(lower)}
      >
        Smaller
      </Button>
      <output className="tn-stepper__value" aria-live="polite">
        {spec.current}
        {' '}
        {spec.unit}
      </output>
      <Button
        variant="secondary"
        size="task"
        iconStart="plus"
        disabled={higher === undefined}
        onClick={() => higher !== undefined && onChange(higher)}
      >
        Larger
      </Button>
    </div>
  );
}

function RowView({
  row,
  spec,
  open,
  onToggle,
  onAdjust,
  recalibrating,
  keepOld,
  onKeep,
  sinceText,
}: {
  row: FitRow;
  spec: AdjustSpec;
  open: boolean;
  onToggle: () => void;
  onAdjust: (value: string | number) => void;
  recalibrating: boolean;
  keepOld: boolean;
  onKeep: (old: boolean) => void;
  sinceText: string | null;
}) {
  const panelId = useId();
  const labelId = useId();
  return (
    <li className="tn-fit-row" data-open={open || undefined}>
      <div className="tn-fit-row__text">
        <h2 id={labelId} className="tn-fit-row__label">
          {row.label}
        </h2>
        <p className="tn-fit-row__sentence">{row.sentence}</p>
        <p className="tn-fit-row__source">
          {row.source}
          {recalibrating && row.changed && sinceText
            ? ` · changed ${sinceText}`
            : ''}
        </p>
      </div>
      <div className="tn-fit-row__value">
        <Readout row={row} />
      </div>
      <div className="tn-fit-row__actions">
        <Button
          variant="ghost"
          size="md"
          aria-expanded={open}
          aria-controls={panelId}
          iconStart="sliders-horizontal"
          onClick={onToggle}
        >
          Adjust<span className="sr-only"> {row.label.toLowerCase()}</span>
        </Button>
      </div>
      {recalibrating && row.changed ? (
        <div className="tn-fit-row__keep">
          <SegmentedControl<'new' | 'old'>
            labelledBy={labelId}
            value={keepOld ? 'old' : 'new'}
            onValueChange={(v) => onKeep(v === 'old')}
            options={[
              { value: 'new', label: 'Keep new' },
              { value: 'old', label: 'Keep old' },
            ]}
          />
        </div>
      ) : null}
      <div id={panelId} className="tn-fit-row__panel" hidden={!open}>
        {open ? <AdjustControl spec={spec} onChange={onAdjust} /> : null}
      </div>
    </li>
  );
}

/**
 * "Your fit" (design-final §9.4-9.5): what WebAble will change and why, one row
 * per setting with a real before and after, a source line, Adjust, and a live
 * preview on a sample page. Recalibration adds Keep new / Keep old per row.
 */
export function YourFit({
  profile,
  previous,
  previousDate,
  rootFontPx,
  signedIn,
  save,
  onUse,
}: YourFitProps) {
  const [adjusted, setAdjusted] = useState(profile);
  const [keepOld, setKeepOld] = useState<ReadonlySet<FitRowId>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<FitRowId>>(new Set());
  const recalibrating = previous !== null;
  const now = useMemo(() => new Date(), []);

  const final = useMemo(
    () => (previous ? keepOldRows(adjusted, previous, keepOld) : adjusted),
    [adjusted, previous, keepOld],
  );
  const markRows = fitRows(adjusted, previous ?? undefined, {
    browserDefaultPx: rootFontPx,
    now,
  });
  const finalRows = fitRows(final, previous ?? undefined, {
    browserDefaultPx: rootFontPx,
    now,
  });
  const previewRows = fitRows(final, undefined, {
    browserDefaultPx: rootFontPx,
    now,
  });
  const changedCount = previewRows.filter((r) => r.changesPages).length;
  const sinceText = since(previousDate);

  const toggle = (id: FitRowId) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const adjustFirst = () => {
    setOpen(new Set(markRows.map((r) => r.id)));
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          '.tn-fit-row__panel:not([hidden]) button, .tn-fit-row__panel:not([hidden]) [role="radio"][tabindex="0"]',
        )
        ?.focus();
    });
  };

  const saving = save.kind === 'saving';

  return (
    <div className="tn-fit">
      <TaskHeading>Your fit</TaskHeading>
      <p className="tn-deck">
        {recalibrating
          ? 'Here is what changed since your last fit. Keep the new value or the old one for each.'
          : 'Here’s what WebAble will change, and why. You can adjust any of it.'}
      </p>
      <p className="tn-meta tn-fit__summary">
        {changedCount === 0
          ? 'Most pages already fit you, so WebAble will change very little.'
          : `WebAble will change ${changedCount} ${changedCount === 1 ? 'thing' : 'things'} on pages for you.`}
      </p>

      <ol className="tn-fit-rows">
        {finalRows.map((row, i) => {
          const mark = markRows[i] ?? row;
          return (
            <RowView
              key={row.id}
              row={{
                ...row,
                before: mark.before,
                after: mark.after,
                srText: mark.srText,
                changed: mark.changed,
              }}
              spec={adjustSpec(adjusted, row.id, rootFontPx)}
              open={open.has(row.id)}
              onToggle={() => toggle(row.id)}
              onAdjust={(value) => {
                setAdjusted((p) => applyAdjustment(p, row.id, value));
                if (keepOld.has(row.id)) {
                  setKeepOld((prev) => {
                    const next = new Set(prev);
                    next.delete(row.id);
                    return next;
                  });
                }
              }}
              recalibrating={recalibrating}
              keepOld={keepOld.has(row.id)}
              onKeep={(old) =>
                setKeepOld((prev) => {
                  const next = new Set(prev);
                  if (old) next.add(row.id);
                  else next.delete(row.id);
                  return next;
                })
              }
              sinceText={sinceText}
            />
          );
        })}
      </ol>

      <FitPreview profile={final} rows={previewRows} rootFontPx={rootFontPx} />

      {save.kind === 'error' ? (
        <ErrorPanel title="Your fit wasn’t saved" live as="h2">
          {save.message} Your fit is still here.
        </ErrorPanel>
      ) : null}

      <div className="tn-controls tn-fit__actions">
        <Button
          variant="primary"
          size="task"
          arrow="forward"
          busy={saving}
          busyLabel="Saving…"
          onClick={() => onUse(final)}
        >
          {recalibrating ? 'Save my fit' : 'Use this fit'}
        </Button>
        <Button
          variant="secondary"
          size="task"
          onClick={adjustFirst}
          disabled={saving}
        >
          Adjust first
        </Button>
      </div>
      <p className="tn-meta">
        {signedIn
          ? 'WebAble saves your fit and a short summary of each part to your account. The answers you gave stay in this browser and are cleared when you leave.'
          : 'Your fit stays in this browser until you create an account. The answers you gave are cleared when you leave.'}
      </p>
    </div>
  );
}
