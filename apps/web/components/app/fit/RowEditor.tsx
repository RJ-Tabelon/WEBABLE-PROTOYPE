'use client';

import type { FitProfile } from '@webable/core';
import type { FitRow } from '@webable/core/profile/describe';
import { Actions, Button, ErrorPanel, Hint, Slider } from '@webable/ui';
import { useEffect, useId, useRef, useState } from 'react';

import {
  type AdjustValue,
  choiceFromValue,
  currentValue,
  editorFor,
  measuredAlternative,
  sameValue,
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

export interface RowEditorProps {
  id: string;
  row: FitRow;
  profile: FitProfile;
  busy: boolean;
  error: string | null;
  onSave: (value: AdjustValue) => void;
  onUseMeasured: () => void;
  onCancel: () => void;
}

/**
 * The inline editor under a fit row: a slider with steppers for ladders of
 * numbers, a segmented control for choices in words. Nothing changes until
 * Save; Cancel (or Esc) closes it and returns focus to Adjust.
 */
export function RowEditor({
  id,
  row,
  profile,
  busy,
  error,
  onSave,
  onUseMeasured,
  onCancel,
}: RowEditorProps) {
  const spec = editorFor(profile, row.id);
  const initial = currentValue(profile, row.id);
  const [draft, setDraft] = useState<AdjustValue>(initial);
  const labelId = useId();
  const reasonId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const measured = measuredAlternative(profile, row.id);

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

  return (
    <div
      id={id}
      ref={rootRef}
      tabIndex={-1}
      className="wa-fit-row__editor"
      role="group"
      aria-labelledby={labelId}
      aria-describedby={disabledReasons.length > 0 ? reasonId : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <p id={labelId} className="wa-fit-row__editor-label">
        Adjust {row.label.toLowerCase()}
      </p>

      {spec.control === 'slider' ? (
        <Slider
          label={row.label}
          steps={spec.steps}
          value={Number(draft.value)}
          onValueChange={(n) => {
            const next = valueFromSlider(row.id, n);
            if (next) setDraft(next);
          }}
          format={spec.format}
          formatSpoken={spec.spoken}
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
              if (next) setDraft(next);
            }}
          />
          {disabledReasons.length > 0 ? (
            <Hint id={reasonId}>{disabledReasons.join(' ')}</Hint>
          ) : null}
        </div>
      )}

      {measured ? (
        <div className="wa-fit-row__measured">
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
          onClick={() =>
            sameValue(draft, initial) ? onCancel() : onSave(draft)
          }
        >
          Save
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
