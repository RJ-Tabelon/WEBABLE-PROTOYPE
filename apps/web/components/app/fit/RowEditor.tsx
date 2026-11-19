'use client';

import './row-editor.css';

import type { FitRow } from '@webable/core/profile/describe';
import { Actions, Button, ErrorPanel, Hint, Slider } from '@webable/ui';
import { useEffect, useId, useRef, useState } from 'react';

import {
  type AdjustValue,
  choiceFromValue,
  editorFor,
  valueFromChoice,
  valueFromSlider,
} from './adjust';
import { ChoiceControl } from './ChoiceControl';

// Only displayed controls can take focus, so the hidden choice layout is skipped.
const FOCUS_ORDER = [
  '[role="slider"]',
  '[role="radio"][tabindex="0"]',
  'input[type="radio"]:checked',
  'button',
] as const;

/** A slider's draft reaches the page once it has rested this long (design-final §7.6). */
export const DRAFT_DELAY_MS = 150;

export interface RowEditorProps {
  /** The row being edited (`@webable/core` describes it). */
  row: FitRow;
  /** The value the editor opens with. */
  value: AdjustValue;
  /**
   * The value while the person is choosing: at once for a choice, after the
   * slider rests for 150 ms. Previews and the row's value follow it.
   */
  onDraft: (value: AdjustValue) => void;
  /** [Save] (`save`) or [Done] (`live`) with the chosen value. */
  onCommit: (value: AdjustValue) => void;
  /** [Cancel] or Esc: put the value back and close. */
  onCancel: () => void;
  /**
   * `save`: nothing changes until Save (the app, where saving writes a new
   * version). `live`: every draft already applies, and Done closes (Tune).
   */
  mode: 'save' | 'live';
  /** Id for the editor, for `aria-controls` on the row's Adjust button. */
  id?: string;
  /**
   * Id of the row's heading. Sliders use it as the group's name, since their
   * own label already says what they change; choices get "Adjust …" instead.
   */
  labelledBy?: string;
  /** Saving (save mode). Locks the controls and shows "Saving…". */
  busy?: boolean;
  /** Why saving failed, in plain words. */
  error?: string | null;
  /** The measured value in words when the person's value replaced it ("19 px"). */
  measured?: string | null;
  onUseMeasured?: () => void;
  /** The device asks for less motion (the motion row can't be set to play). */
  systemReducedMotion?: boolean;
}

/**
 * The inline editor under a fit row, shared by Tune and the app: a slider with
 * steppers for ladders of numbers, a segmented control for choices in words.
 * Esc cancels. Focus moves onto the control when it opens.
 */
export function RowEditor({
  row,
  value,
  onDraft,
  onCommit,
  onCancel,
  mode,
  id,
  labelledBy,
  busy = false,
  error = null,
  measured = null,
  onUseMeasured,
  systemReducedMotion = false,
}: RowEditorProps) {
  // The opening value fixes the steps: they must not move while dragging.
  const [start] = useState(value);
  const spec = editorFor(row.id, start, { systemReducedMotion });
  const [draft, setDraft] = useState<AdjustValue>(start);
  const labelId = useId();
  const reasonId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;

  // Move focus into the editor, onto its control, when it opens. Selectors are
  // tried in order: the slider thumb (not its − stepper), then the chosen segment.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const shown = (el: HTMLElement) => el.getClientRects().length > 0;
    const target = FOCUS_ORDER.map((selector) =>
      Array.from(root.querySelectorAll<HTMLElement>(selector)).find(shown),
    ).find((el): el is HTMLElement => el !== undefined);
    (target ?? root).focus();
  }, []);

  const disabledReasons =
    spec.control === 'choice'
      ? spec.options
          .filter((o) => o.disabledReason)
          .map((o) => o.disabledReason as string)
      : [];
  const slider = spec.control === 'slider';
  // A slider already names itself ("Text size 18 px"): the row's heading names
  // the group. A choice gets its own "Adjust …" label.
  const groupLabel = slider && labelledBy ? labelledBy : labelId;

  return (
    <div
      id={id}
      ref={rootRef}
      tabIndex={-1}
      className="wa-fit-editor"
      role="group"
      aria-labelledby={groupLabel}
      aria-describedby={disabledReasons.length > 0 ? reasonId : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      {slider && labelledBy ? null : (
        <p id={labelId} className="wa-fit-editor__label">
          Adjust {row.label.toLowerCase()}
        </p>
      )}

      {spec.control === 'slider' ? (
        <Slider
          label={row.label}
          steps={spec.steps}
          value={Number(draft.value)}
          onValueChange={(n) => {
            const next = valueFromSlider(row.id, n);
            if (next) setDraft(next);
          }}
          onValueCommit={(n) => {
            const next = valueFromSlider(row.id, n);
            if (next) onDraftRef.current(next);
          }}
          commitDelay={DRAFT_DELAY_MS}
          format={spec.format}
          formatSpoken={spec.spoken}
          disabled={busy}
          changesPage
        />
      ) : (
        <div>
          <ChoiceControl
            labelledBy={labelId}
            describedBy={disabledReasons.length > 0 ? reasonId : undefined}
            options={spec.options}
            value={choiceFromValue(draft)}
            onValueChange={(choice) => {
              const next = valueFromChoice(row.id, choice);
              if (!next) return;
              setDraft(next);
              onDraftRef.current(next);
            }}
          />
          {disabledReasons.length > 0 ? (
            <Hint id={reasonId}>{disabledReasons.join(' ')}</Hint>
          ) : null}
        </div>
      )}

      {measured && onUseMeasured ? (
        <div className="wa-fit-editor__measured">
          <p className="wa-app-meta">Tune measured {measured}.</p>
          <Button
            variant="ghost"
            size="md"
            onClick={onUseMeasured}
            disabled={busy}
          >
            Use the measured value
          </Button>
        </div>
      ) : null}

      {error ? (
        <ErrorPanel title="Couldn’t save this change" live as="p">
          <p>{error}</p>
        </ErrorPanel>
      ) : null}

      <Actions>
        <Button
          variant="primary"
          size="md"
          busy={busy}
          busyLabel="Saving…"
          onClick={() => onCommit(draft)}
        >
          {mode === 'save' ? 'Save' : 'Done'}
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </Actions>
    </div>
  );
}
