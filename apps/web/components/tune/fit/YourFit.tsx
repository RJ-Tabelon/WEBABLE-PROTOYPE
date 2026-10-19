'use client';

import type { FitProfile } from '@webable/core';
import {
  fitRows,
  type FitRow as CoreFitRow,
  type FitRowId,
} from '@webable/core/profile/describe';
import {
  Button,
  Disclosure,
  ErrorPanel,
  FitRow,
  SegmentedControl,
} from '@webable/ui';
import {
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';

import { currentValue } from '../../app/fit/adjust';
import { RowEditor } from '../../app/fit/RowEditor';
import {
  applyEditorValue,
  keepOldRows,
  type EditorValue,
} from '../flow/adjust';
import { rowSource, rowValue, type FitValueShape } from '../shared/fit';
import { TaskHeading } from '../shared/primitives';
import { FitPreview } from './FitPreview';

export type SaveState =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string };

/** What the action bar calls: [Use this fit] and [Adjust first]. */
export interface YourFitControl {
  use: () => void;
  adjustFirst: () => void;
}

export interface YourFitProps {
  profile: FitProfile;
  /** The current fit, when there is one: rows show the diff with Keep new / Keep old. */
  previous: FitProfile | null;
  /** When the previous fit was made (ISO), for "since Jun 12". */
  previousDate: string | null;
  rootFontPx: number;
  /** Signed in: the fit is saved to the account; otherwise it waits in this browser. */
  signedIn: boolean;
  save: SaveState;
  onUse: (profile: FitProfile) => void;
  /** The shell's action bar drives [Use this fit] and [Adjust first] through this. */
  controlRef?: Ref<YourFitControl>;
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

/** Only displayed controls can take focus: the slider thumb, then the chosen option. */
const EDITOR_FOCUS = [
  '[role="slider"]',
  '[role="radio"][tabindex="0"]',
  'input[type="radio"]:checked',
  'button',
] as const;

function focusEditor(root: HTMLElement | null): void {
  if (!root || root.contains(document.activeElement)) return;
  const shown = (el: HTMLElement) => el.getClientRects().length > 0;
  const target = EDITOR_FOCUS.map((selector) =>
    Array.from(root.querySelectorAll<HTMLElement>(selector)).find(shown),
  ).find((el): el is HTMLElement => el !== undefined);
  target?.focus();
}

const labelIdOf = (id: FitRowId) => `tn-fit-row-${id}`;
const editorId = (id: FitRowId) => `tn-fit-editor-${id}`;

/** Whether a row changes pages (it goes in the main list) or is left as sites made it. */
function changes(row: CoreFitRow): boolean {
  return row.changesPages && rowValue(row).kind !== 'same';
}

const SAME: (row: CoreFitRow) => FitValueShape = (row) => ({
  kind: 'same',
  srText: `${row.label}: as the site made it`,
});

/**
 * "Your fit" (design-final §9.4-9.5): what WebAble will change and why, one
 * row per change with its real value and where it came from, a preview on a
 * sample page, then the settings left as sites made them. Adjust opens the
 * same editor as the app, live: the preview follows it. With a current fit,
 * the rows show what changed since then, with Keep new / Keep old.
 */
export function YourFit({
  profile,
  previous,
  previousDate,
  rootFontPx,
  signedIn,
  save,
  onUse,
  controlRef,
}: YourFitProps) {
  const [adjusted, setAdjusted] = useState(profile);
  const [keepOld, setKeepOld] = useState<ReadonlySet<FitRowId>>(new Set());
  const [open, setOpen] = useState<FitRowId | null>(null);
  const [restOpen, setRestOpen] = useState(false);
  /** The profile when the open editor was opened, for Esc. */
  const openedWith = useRef<FitProfile | null>(null);
  const rowEls = useRef(new Map<FitRowId, HTMLElement>());
  const adjustEls = useRef(new Map<FitRowId, HTMLButtonElement>());
  const comparing = previous !== null;
  const now = useMemo(() => new Date(), []);
  const options = { browserDefaultPx: rootFontPx, now };

  const final = useMemo(
    () => (previous ? keepOldRows(adjusted, previous, keepOld) : adjusted),
    [adjusted, previous, keepOld],
  );
  // Rows against the browser's defaults: what WebAble will change on pages.
  const siteRows = fitRows(final, undefined, options);
  // With a current fit, the diff shows the new value (before Keep old applies).
  const diffRows = previous ? fitRows(adjusted, previous, options) : null;
  const sinceText = since(previousDate);

  const mainRows = diffRows
    ? diffRows.filter((row) => row.changed)
    : siteRows.filter(changes);
  const shownIds = new Set(mainRows.map((row) => row.id));
  const otherRows = siteRows.filter((row) => !shownIds.has(row.id));

  const openRow = (id: FitRowId) => {
    openedWith.current = adjusted;
    // A row in the closed "Left as sites made them" list opens it first.
    if (!shownIds.has(id)) setRestOpen(true);
    setOpen(id);
    requestAnimationFrame(() => focusEditor(rowEls.current.get(id) ?? null));
  };
  const closeRow = (id: FitRowId, revert: boolean) => {
    if (revert && openedWith.current) setAdjusted(openedWith.current);
    openedWith.current = null;
    setOpen(null);
    requestAnimationFrame(() => adjustEls.current.get(id)?.focus());
  };
  const edit = (id: FitRowId, value: EditorValue) => {
    setAdjusted((p) => applyEditorValue(p, value));
    if (keepOld.has(id)) {
      setKeepOld((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  useImperativeHandle(
    controlRef,
    () => ({
      use: () => onUse(final),
      adjustFirst: () => {
        const first = mainRows[0] ?? otherRows[0];
        if (first) openRow(first.id);
      },
    }),
    // openRow reads refs and state setters only.
    [final, onUse, mainRows[0]?.id, otherRows[0]?.id, adjusted],
  );

  const adjustButton = (row: CoreFitRow) => {
    const isOpen = open === row.id;
    return (
      <Button
        ref={(el: HTMLButtonElement | null) => {
          if (el) adjustEls.current.set(row.id, el);
          else adjustEls.current.delete(row.id);
        }}
        variant="ghost"
        size="md"
        flush="end"
        iconStart="sliders-horizontal"
        aria-expanded={isOpen}
        aria-controls={isOpen ? editorId(row.id) : undefined}
        onClick={() => (isOpen ? closeRow(row.id, false) : openRow(row.id))}
      >
        {isOpen ? 'Done' : 'Adjust'}
        <span className="sr-only"> {row.label.toLowerCase()}</span>
      </Button>
    );
  };

  const editorFor = (row: CoreFitRow) =>
    open === row.id ? (
      <RowEditor
        id={editorId(row.id)}
        labelledBy={labelIdOf(row.id)}
        row={row}
        value={currentValue(adjusted, row.id)}
        mode="live"
        systemReducedMotion={adjusted.attention.systemReducedMotion}
        onDraft={(value: EditorValue) => edit(row.id, value)}
        onCommit={(value: EditorValue) => {
          edit(row.id, value);
          closeRow(row.id, false);
        }}
        onCancel={() => closeRow(row.id, true)}
      />
    ) : null;

  const rowRef = (id: FitRowId) => (el: HTMLElement | null) => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  };

  return (
    <div className="tn-fit">
      <TaskHeading>Your fit</TaskHeading>
      <p className="tn-deck">
        {comparing
          ? 'Here’s what changed since your last fit. Keep the new value or the old one.'
          : 'Here’s what WebAble will change, and why. Pages with small text are zoomed toward your size, and busy pages can open in Fit view. You can adjust any of it.'}
      </p>

      {mainRows.length > 0 ? (
        <ol className="wa-fitrows tn-fit__rows">
          {mainRows.map((row) => {
            const labelId = labelIdOf(row.id);
            const keepControl =
              comparing && row.changed ? (
                <div className="tn-fit__keep">
                  <SegmentedControl<'new' | 'old'>
                    labelledBy={labelId}
                    value={keepOld.has(row.id) ? 'old' : 'new'}
                    onValueChange={(v) =>
                      setKeepOld((prev) => {
                        const next = new Set(prev);
                        if (v === 'old') next.add(row.id);
                        else next.delete(row.id);
                        return next;
                      })
                    }
                    options={[
                      { value: 'new', label: 'Keep new' },
                      { value: 'old', label: 'Keep old' },
                    ]}
                  />
                </div>
              ) : null;
            const editor = editorFor(row);
            return (
              <li
                key={row.id}
                ref={rowRef(row.id)}
                className="tn-fit__item"
                data-open={open === row.id || undefined}
              >
                <FitRow
                  density="task"
                  headingLevel={2}
                  labelId={labelId}
                  label={row.label}
                  sentence={row.sentence}
                  source={
                    comparing && sinceText
                      ? `${rowSource(row)} · changed ${sinceText}`
                      : rowSource(row)
                  }
                  value={
                    comparing ? rowValue(row, { diff: true }) : rowValue(row)
                  }
                  changed
                  action={adjustButton(row)}
                  editor={
                    keepControl || editor ? (
                      <>
                        {keepControl}
                        {editor}
                      </>
                    ) : undefined
                  }
                />
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="tn-meta">
          {comparing
            ? 'Nothing changed since your last fit.'
            : 'Most pages already fit you, so WebAble will change very little.'}
        </p>
      )}

      <FitPreview profile={final} rows={siteRows} rootFontPx={rootFontPx} />

      {otherRows.length > 0 ? (
        <Disclosure
          title={
            comparing
              ? `The rest of your fit (${otherRows.length})`
              : `Left as sites made them (${otherRows.length})`
          }
          headingLevel={2}
          className="tn-fit__rest"
          open={restOpen}
          onOpenChange={setRestOpen}
        >
          <ul className="wa-fitrows tn-fit__rows tn-fit__rows--compact">
            {otherRows.map((row) => {
              const editor = editorFor(row);
              const value: FitValueShape =
                comparing && changes(row) ? rowValue(row) : SAME(row);
              return (
                <li
                  key={row.id}
                  ref={rowRef(row.id)}
                  className="tn-fit__item"
                  data-open={open === row.id || undefined}
                >
                  <FitRow
                    density="task"
                    headingLevel={3}
                    labelId={labelIdOf(row.id)}
                    label={row.label}
                    sentence={null}
                    value={value}
                    changed={false}
                    size="inline"
                    action={adjustButton(row)}
                    editor={editor ?? undefined}
                  />
                </li>
              );
            })}
          </ul>
        </Disclosure>
      ) : null}

      {save.kind === 'error' ? (
        <ErrorPanel title="Your fit wasn’t saved" live as="h2">
          {save.message} Your fit is still here.
        </ErrorPanel>
      ) : null}

      <p className="tn-meta">
        {signedIn
          ? 'WebAble saves your fit and a short summary of each part to your account. The answers you gave stay in this browser and are cleared when you leave.'
          : 'Your fit stays in this browser until you create an account. The answers you gave are cleared when you leave.'}
      </p>
    </div>
  );
}
