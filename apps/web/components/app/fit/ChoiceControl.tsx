'use client';

import { SegmentedControl } from '@webable/ui';
import { useId } from 'react';

import type { ChoiceOption } from './adjust';

export interface ChoiceControlProps {
  /** Id of the visible label for the group. */
  labelledBy: string;
  /** Id of a reason line (a disabled option), if any. */
  describedBy?: string;
  options: ReadonlyArray<ChoiceOption<string>>;
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * A choice in words (§7.5). A segmented control where it fits; in a narrow
 * editor (a phone, or a large text scale) the same choice as a stack of native
 * radio rows, because segment labels must never wrap or overflow. Only one of
 * the two is displayed (the other is display: none, so it is neither in the
 * tab order nor in the accessibility tree); both share one value.
 */
export function ChoiceControl({
  labelledBy,
  describedBy,
  options,
  value,
  onValueChange,
}: ChoiceControlProps) {
  const name = useId();
  return (
    <div className="wa-choice">
      <div className="wa-choice__segmented">
        <SegmentedControl
          labelledBy={labelledBy}
          options={options.map((o) => ({
            value: o.value,
            label: o.label,
            disabled: Boolean(o.disabledReason),
          }))}
          value={value}
          onValueChange={onValueChange}
        />
      </div>
      <div
        className="wa-choice__stack"
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        {options.map((option) => {
          const disabled = Boolean(option.disabledReason);
          return (
            <label
              key={option.value}
              className="wa-choice__option"
              data-disabled={disabled || undefined}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                disabled={disabled}
                onChange={() => onValueChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
