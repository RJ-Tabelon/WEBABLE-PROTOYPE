// Three quiet controls for the results page: a segmented choice, an on/off switch and a − / + stepper.
// All are at least 56 px tall, keyboard friendly and labelled for screen readers.
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { MinusIcon, PlusIcon } from './icons';

export interface SegOption<T> {
  value: T;
  label: string;
}

export function Segmented<T extends string | number>(props: {
  label: string;
  options: Array<SegOption<T>>;
  value: T;
  onChange(value: T): void;
  wide?: boolean;
}): JSX.Element {
  const { label, options, value, onChange, wide } = props;
  const idx = options.findIndex((o) => o.value === value);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (to: number): void => {
    const n = options.length;
    const j = (to + n) % n;
    const o = options[j];
    if (!o) return;
    onChange(o.value);
    refs.current[j]?.focus();
  };
  const onKey = (i: number) => (e: KeyboardEvent): void => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(i + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(i - 1);
    }
  };
  return (
    <div
      class={`seg${wide ? ' seg-wide' : ''}`}
      role="radiogroup"
      aria-label={label}
      style={{ '--n': String(options.length), '--i': String(Math.max(0, idx)) }}
    >
      {idx >= 0 && <span class="seg-thumb" aria-hidden="true" />}
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === idx}
          tabIndex={i === idx || (idx < 0 && i === 0) ? 0 : -1}
          class="seg-opt"
          onClick={() => onChange(o.value)}
          onKeyDown={onKey(i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch(props: { checked: boolean; label: string; onChange(on: boolean): void }): JSX.Element {
  const { checked, label, onChange } = props;
  return (
    <button type="button" role="switch" class="sw" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
  );
}

export function Stepper(props: {
  canDown: boolean;
  canUp: boolean;
  downLabel: string;
  upLabel: string;
  onStep(dir: 1 | -1): void;
}): JSX.Element {
  const { canDown, canUp, downLabel, upLabel, onStep } = props;
  return (
    <div class="step">
      <button type="button" class="step-btn" aria-label={downLabel} disabled={!canDown} onClick={() => onStep(-1)}>
        <MinusIcon />
      </button>
      <button type="button" class="step-btn" aria-label={upLabel} disabled={!canUp} onClick={() => onStep(1)}>
        <PlusIcon />
      </button>
    </div>
  );
}
