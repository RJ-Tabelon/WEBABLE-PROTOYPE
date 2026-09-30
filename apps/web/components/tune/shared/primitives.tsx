'use client';

// Reading stimuli are set in bundled Noto Sans 400 (design-final §9.2). Only the
// stage module brings the face, so no other page downloads it.
import '@fontsource/noto-sans/latin-400.css';

import { Button, CheckGlyph, cx, Kbd } from '@webable/ui';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

/**
 * Tune's screen primitives (design-final §9.1-9.2): the task heading that takes
 * focus when a screen opens, the fixed white stage, 64 px response buttons with
 * key hints, option chips, and the calm rest screen between parts.
 */

/* ---------- The stimulus face ---------- */

/** What the stimulus face is asked for; `document.fonts` loads it on demand. */
const STIMULUS_FACE = "400 16px 'Noto Sans'";
/** After this, stimuli show in the fallback face rather than wait for ever. */
const FONT_WAIT_MS = 3000;

let fontPromise: Promise<boolean> | null = null;
let fontSettled = false;

/**
 * Load the stimulus face once. The fontsource file declares `swap`; Tune gets
 * `block` behaviour by showing no stimulus until this settles, so a face never
 * swaps in the middle of a timed trial. Resolves true when Noto Sans is in use.
 */
export function loadStimulusFont(): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts?.load) {
    fontSettled = true;
    return Promise.resolve(false);
  }
  fontPromise ??= Promise.race([
    document.fonts
      .load(STIMULUS_FACE, 'Aa')
      .then((faces) => faces.length > 0)
      .catch(() => false),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), FONT_WAIT_MS),
    ),
  ]).then((loaded) => {
    fontSettled = true;
    return loaded;
  });
  return fontPromise;
}

/** Whether stimuli may be drawn: the stimulus face has loaded, or given up. */
export function useStimulusFontReady(): boolean {
  const [ready, setReady] = useState(() => fontSettled);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadStimulusFont().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

export interface TaskHeadingProps {
  children: ReactNode;
  /** A short fact above the heading ("Reading · 2 of 5"). */
  eyebrow?: ReactNode;
  className?: string;
}

/**
 * The screen's h1. It receives focus when it mounts, so every screen change
 * moves focus to the new heading (0 ms route change, design-final §12). Give it
 * a new `key` to move focus again inside one step.
 */
export function TaskHeading({
  children,
  eyebrow,
  className,
}: TaskHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    // Bring the heading into view without animating the page.
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  }, []);
  return (
    <div className={cx('tn-head', className)}>
      {eyebrow ? <p className="tn-eyebrow">{eyebrow}</p> : null}
      <h1 ref={ref} tabIndex={-1} className="tn-title">
        {children}
      </h1>
    </div>
  );
}

export function Deck({
  children,
  live = false,
  id,
}: {
  children: ReactNode;
  /** Announce changes (instructions that change inside one screen). */
  live?: boolean;
  id?: string;
}) {
  return (
    <p className="tn-deck" id={id} aria-live={live ? 'polite' : undefined}>
      {children}
    </p>
  );
}

export interface StageProps {
  children: ReactNode;
  /** Accessible name for the stage region. */
  label: string;
  className?: string;
  style?: CSSProperties;
  /** Remove the inner padding (pointing and mock pages lay out their own space). */
  bleed?: boolean;
  /** Set a fixed CSS px height (pointing tasks need exact geometry). */
  heightPx?: number;
}

/**
 * The stimulus field: #FFFFFF with #111111 stimuli in both themes, exempt from
 * the person's settings (sizes inside are CSS px, never rem).
 */
export const Stage = forwardRef<HTMLDivElement, StageProps>(function Stage(
  { children, label, className, style, bleed = false, heightPx },
  ref,
) {
  return (
    <section
      ref={ref}
      aria-label={label}
      // The stage keeps light tokens in both themes: stimuli and the controls
      // drawn inside it sit on a fixed white field (design-final §9.2).
      data-theme="light"
      className={cx('tn-stage', bleed && 'tn-stage--bleed', className)}
      style={heightPx ? { ...style, blockSize: `${heightPx}px` } : style}
    >
      {children}
    </section>
  );
});

export interface ResponseButtonProps {
  children: ReactNode;
  /** Single key that answers the same way, shown as a <kbd> hint. */
  hotkey?: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

/** A 64 px task response with its key hint inside ("True  T"). */
export function ResponseButton({
  children,
  hotkey,
  onPress,
  variant = 'secondary',
  disabled,
}: ResponseButtonProps) {
  return (
    <Button
      variant={variant}
      size="task"
      onClick={onPress}
      disabled={disabled}
      className="tn-response"
      aria-keyshortcuts={hotkey ? hotkey.toUpperCase() : undefined}
    >
      <span className="tn-response__label">{children}</span>
      {hotkey ? <KeyHint>{hotkey.toUpperCase()}</KeyHint> : null}
    </Button>
  );
}

/** A visible key hint; hidden from the accessible name (aria-keyshortcuts carries it). */
export function KeyHint({ children }: { children: ReactNode }) {
  return (
    <span className="tn-keyhint" aria-hidden="true">
      <Kbd className="tn-response__kbd">{children}</Kbd>
    </span>
  );
}

export function Responses({
  children,
  label,
  layout = 'row',
}: {
  children: ReactNode;
  label?: string;
  /** `row` (answers side by side), `grid` (2 x 2 on small screens), `stack` (full width on small screens). */
  layout?: 'row' | 'grid' | 'stack';
}) {
  return (
    <div
      className={cx(
        'tn-responses',
        layout === 'grid' && 'tn-responses--grid',
        layout === 'stack' && 'tn-responses--stack',
      )}
      role={label ? 'group' : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional second line. */
  hint?: ReactNode;
}

interface OptionGroupBase<T extends string> {
  legend: ReactNode;
  /** Visually hide the legend (it stays the group's name). */
  hideLegend?: boolean;
  options: ReadonlyArray<ChoiceOption<T>>;
  className?: string;
  /** Stack options full width (long labels, scales). */
  stacked?: boolean;
}

export type OptionGroupProps<T extends string> = OptionGroupBase<T> &
  (
    | { multiple?: false; value: T | null; onChange: (value: T) => void }
    | { multiple: true; value: readonly T[]; onChange: (value: T[]) => void }
  );

/**
 * Native radio or checkbox options drawn as 64 px chips, 16 px apart. Native
 * inputs keep the semantics: arrow keys move between radios, Space toggles
 * checkboxes, and the fieldset legend names the group.
 */
export function OptionGroup<T extends string>(props: OptionGroupProps<T>) {
  const { legend, hideLegend, options, className, stacked } = props;
  const name = useId();
  const selected = (value: T) =>
    props.multiple ? props.value.includes(value) : props.value === value;
  const toggle = (value: T) => {
    if (props.multiple) {
      const set = new Set(props.value);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      props.onChange(options.map((o) => o.value).filter((v) => set.has(v)));
    } else {
      props.onChange(value);
    }
  };
  return (
    <fieldset
      className={cx('tn-options', stacked && 'tn-options--stacked', className)}
    >
      <legend className={cx('tn-options__legend', hideLegend && 'sr-only')}>
        {legend}
      </legend>
      <div className="tn-options__list">
        {options.map((option) => {
          const on = selected(option.value);
          return (
            <label
              key={option.value}
              className={cx('tn-option', props.multiple && 'tn-option--check')}
              data-selected={on || undefined}
            >
              <input
                className="tn-option__input"
                type={props.multiple ? 'checkbox' : 'radio'}
                name={name}
                value={option.value}
                checked={on}
                onChange={() => toggle(option.value)}
              />
              <span className="tn-option__mark" aria-hidden="true">
                {on && props.multiple ? <CheckGlyph size={16} /> : null}
              </span>
              <span className="tn-option__text">
                <span className="tn-option__label">{option.label}</span>
                {option.hint ? (
                  <span className="tn-option__hint">{option.hint}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface CheckChipProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
}

/** A single checkbox drawn as a 64 px task chip (same anatomy as OptionGroup). */
export function CheckChip({
  checked,
  onChange,
  children,
  hint,
}: CheckChipProps) {
  return (
    <label
      className="tn-option tn-option--check"
      data-selected={checked || undefined}
    >
      <input
        className="tn-option__input"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="tn-option__mark" aria-hidden="true">
        {checked ? <CheckGlyph size={16} /> : null}
      </span>
      <span className="tn-option__text">
        <span className="tn-option__label">{children}</span>
        {hint ? <span className="tn-option__hint">{hint}</span> : null}
      </span>
    </label>
  );
}

export interface ScaleOption<T extends string> {
  value: T;
  /** The full accessible name ("Version 1, clearly"). */
  name: string;
}

export interface ScaleProps<T extends string> {
  legend: ReactNode;
  /** Five steps, from one end to the other. */
  options: readonly [
    ScaleOption<T>,
    ScaleOption<T>,
    ScaleOption<T>,
    ScaleOption<T>,
    ScaleOption<T>,
  ];
  /** Visible words under the first, middle and last steps. */
  ends: { start: string; middle: string; end: string };
  value: T | null;
  onChange: (value: T) => void;
}

/**
 * A five-step scale: 64 px circular radios on a hairline, 16 px apart, with
 * words only at the ends and the centre. Each radio carries its full name, so
 * the words on screen are never the only label. Native radios keep the
 * semantics: one Tab stop, arrows move the choice.
 */
export function Scale<T extends string>({
  legend,
  options,
  ends,
  value,
  onChange,
}: ScaleProps<T>) {
  const name = useId();
  return (
    <fieldset className="tn-scale">
      <legend className="sr-only">{legend}</legend>
      <div className="tn-scale__steps">
        {options.map((option) => {
          const on = value === option.value;
          return (
            <label
              key={option.value}
              className="tn-scale__step"
              data-selected={on || undefined}
            >
              <input
                className="tn-scale__input"
                type="radio"
                name={name}
                value={option.value}
                checked={on}
                onChange={() => onChange(option.value)}
              />
              <span className="sr-only">{option.name}</span>
            </label>
          );
        })}
      </div>
      <div className="tn-scale__words" aria-hidden="true">
        <span className="tn-scale__word tn-scale__word--start">
          {ends.start}
        </span>
        <span className="tn-scale__word tn-scale__word--middle">
          {ends.middle}
        </span>
        <span className="tn-scale__word tn-scale__word--end">{ends.end}</span>
      </div>
    </fieldset>
  );
}

export interface RestProps {
  /** A calm line about what just finished ("Reading is done."), with a check. */
  done?: string | null;
  /** One real value from the part that finished, when it changed (a fit mark). */
  fit?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action: ReactNode;
}

/** A moment of rest between parts: one calm line and a Continue button. */
export function Rest({ done, fit, title, children, action }: RestProps) {
  return (
    <div className="tn-rest">
      {done ? (
        <div className="tn-rest__done">
          <p className="tn-rest__line">
            <CheckGlyph size={20} className="tn-rest__check" />
            <span>{done}</span>
          </p>
          {fit ? <p className="tn-rest__fit">{fit}</p> : null}
        </div>
      ) : null}
      <TaskHeading>{title}</TaskHeading>
      {children}
      <div className="tn-rest__action">{action}</div>
    </div>
  );
}
