'use client';

import { Button, Wordmark } from '@webable/ui';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** Server render has no layout; the browser measures before paint. */
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The bars stay pinned (the main column scrolls between them) only while they
 * take at most this share of the viewport's height. At a large text scale or on
 * a short screen the page flows normally instead, with nothing pinned over it.
 */
export const TASK_FIXED_MAX_SHARE = 0.3;

/**
 * Joins with a no-break space before each separator dot, so a wrapped progress
 * line never starts with "·": "Part 1 of 3 · Reading · about 6 min left".
 */
export function progressLine(text: string): string {
  return text.replace(/\s+·\s+/g, '\u00a0· ');
}

export interface TaskShellProps {
  children: ReactNode;
  /**
   * The progress ruler (`<ProgressRuler … />`), shown in the top bar. `false`
   * leaves the ruler row out. Default true: the ruler row shows whatever
   * element is passed (nothing when none is).
   */
  ruler?: ReactNode;
  /**
   * The progress line in full: "Part 1 of 3 · Reading · about 6 min left". It
   * is the accessible source (design-final §9.3) and is shown in full at 48em
   * and wider. Time is in words and rounded up; never a clock or a percentage.
   */
  progress?: string;
  /**
   * What the progress line shows below 48em ("About 6 min left"). The full
   * `progress` stays in the accessibility tree. Default: `progress`.
   */
  progressShort?: string;
  /** @deprecated Use `progress`. */
  progressText?: string;
  /** Pause: also bound to Esc. Omit to hide the action bar's Pause. */
  onPause?: () => void;
  /** Skip this part: recorded without penalty. */
  onSkip?: () => void;
  pauseLabel?: string;
  /** Visible label of Skip. Default "Skip this part"; pass a shorter one ("Skip") where room is short. */
  skipLabel?: string;
  /**
   * Replaces Pause and Skip in the action bar (for example Tune's fit step:
   * [Use this fit] [Adjust first]).
   */
  actions?: ReactNode;
  /** Accessible name of the action bar group. Default "Tune controls". */
  actionsLabel?: string;
  /** Hide the action bar (intro and end screens). */
  hideActions?: boolean;
  /**
   * After this many ms without input the idle note appears ("Take your time, or
   * skip this part."). Default 20 000. Reset it by changing `idleKey` per task.
   */
  idleAfterMs?: number;
  idleKey?: unknown;
  idleNote?: string;
  /** Polite announcement for section changes ("Pointing. 2 of 3."). */
  announcement?: string;
}

/**
 * Task-density frame for Tune (design-final §9.1): a 64 px top bar with the
 * wordmark, the ruler and the progress line; a centred `--w-task` column; a 96 px
 * action bar with Pause and Skip this part. Screens change in 0 ms: move focus to
 * the new h1 yourself (give it `tabIndex={-1}`).
 *
 * Both bars are measured. While together they take at most 30% of the window's
 * height, the frame is a 100dvh grid (`data-task-fixed`) and only the main
 * column scrolls, so a focused control can never sit under the action bar.
 * Otherwise (a large text scale, a short window) the page flows normally and
 * the action bar follows the content. `--task-bar-live` and
 * `--task-actions-live` on `.wa-task` carry the measured heights.
 */
export function TaskShell({
  children,
  ruler,
  progress,
  progressShort,
  progressText,
  onPause,
  onSkip,
  pauseLabel = 'Pause',
  skipLabel = 'Skip this part',
  actions,
  actionsLabel = 'Tune controls',
  hideActions = false,
  idleAfterMs = 20_000,
  idleKey,
  idleNote = 'Take your time, or skip this part.',
  announcement,
}: TaskShellProps) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const full = progress ?? progressText;
  const fullLine = full ? progressLine(full) : undefined;
  const shortLine = progressShort ? progressLine(progressShort) : undefined;
  const showActions = !hideActions && (!!actions || !!onPause || !!onSkip);
  const taskControls = showActions && !actions;

  // Esc pauses, unless something else (a dialog, a menu) already handled it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        !onPauseRef.current
      )
        return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      onPauseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The idle note: shown after a quiet spell, hidden again on any input.
  useEffect(() => {
    if (!taskControls) return;
    const arm = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setIdle(true), idleAfterMs);
    };
    const onActivity = () => {
      setIdle(false);
      arm();
    };
    arm();
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const name of events)
      window.addEventListener(name, onActivity, { passive: true });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      for (const name of events) window.removeEventListener(name, onActivity);
    };
  }, [idleAfterMs, idleKey, taskControls]);

  // Pinned bars only while they leave the content most of the window. The
  // measurement follows the text scale, the window and the bars' own content.
  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    const bar = barRef.current;
    if (!root || !bar) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const barH = bar.getBoundingClientRect().height;
      const actionsH = actionsRef.current?.getBoundingClientRect().height ?? 0;
      root.style.setProperty('--task-bar-live', `${barH}px`);
      root.style.setProperty('--task-actions-live', `${actionsH}px`);
      const fixed =
        barH + actionsH <= TASK_FIXED_MAX_SHARE * window.innerHeight;
      root.toggleAttribute('data-task-fixed', fixed);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(bar);
    if (actionsRef.current) observer?.observe(actionsRef.current);
    window.addEventListener('resize', schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [showActions]);

  return (
    <div ref={rootRef} className="wa-task">
      <header
        ref={barRef}
        className="wa-task__bar"
        data-ruler={ruler === false ? undefined : ''}
      >
        <span className="wa-task__brand">
          <Wordmark />
        </span>
        {ruler !== false ? (
          <div className="wa-task__ruler">
            {typeof ruler === 'boolean' ? null : ruler}
          </div>
        ) : null}
        {fullLine ? (
          <p className="wa-task__progress">
            <span
              className="wa-task__progress-full"
              data-has-short={shortLine ? '' : undefined}
            >
              {fullLine}
            </span>
            {shortLine ? (
              <span className="wa-task__progress-short" aria-hidden="true">
                {shortLine}
              </span>
            ) : null}
          </p>
        ) : null}
      </header>

      <main id="main" tabIndex={-1} className="wa-task__main">
        <div className="wa-task__column">{children}</div>
      </main>

      {showActions ? (
        <div
          ref={actionsRef}
          role="group"
          aria-label={actionsLabel}
          className="wa-task__actions"
          data-custom={actions ? '' : undefined}
        >
          <div className="wa-task__actions-inner">
            {actions ?? (
              <>
                {onPause ? (
                  <Button
                    variant="secondary"
                    size="task"
                    iconStart="pause"
                    onClick={onPause}
                  >
                    {pauseLabel}
                  </Button>
                ) : null}
                {onSkip ? (
                  <Button variant="secondary" size="task" onClick={onSkip}>
                    {skipLabel}
                  </Button>
                ) : null}
                <p
                  className="wa-task__idle"
                  data-visible={idle || undefined}
                  aria-live="polite"
                >
                  {idle ? idleNote : ''}
                </p>
              </>
            )}
          </div>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {announcement ?? ''}
      </p>
    </div>
  );
}
