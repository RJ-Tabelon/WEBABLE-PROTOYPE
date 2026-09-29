'use client';

import { Button, Wordmark } from '@webable/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface TaskShellProps {
  children: ReactNode;
  /** The progress ruler (`<ProgressRuler … />`). */
  ruler?: ReactNode;
  /**
   * The accessible progress line: "Part 2 of 3 · Pointing · about 1 min left".
   * Time is estimated in words and rounded up; never a clock or a percentage.
   */
  progressText?: string;
  /** Pause: also bound to Esc. Omit to hide the action bar's Pause. */
  onPause?: () => void;
  /** Skip this part: recorded without penalty. */
  onSkip?: () => void;
  pauseLabel?: string;
  skipLabel?: string;
  /** Hide the action bar (intro and "Your fit" screens). */
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
 */
export function TaskShell({
  children,
  ruler,
  progressText,
  onPause,
  onSkip,
  pauseLabel = 'Pause',
  skipLabel = 'Skip this part',
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
    if (hideActions) return;
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
  }, [idleAfterMs, idleKey, hideActions]);

  return (
    <div className="wa-task">
      <header className="wa-task__bar">
        <span className="wa-task__brand">
          <Wordmark markSize={20} />
        </span>
        {ruler ? <div className="wa-task__ruler">{ruler}</div> : null}
        {progressText ? (
          <p className="wa-task__progress">{progressText}</p>
        ) : null}
      </header>

      <main id="main" tabIndex={-1} className="wa-task__main">
        <div className="wa-task__column">{children}</div>
      </main>

      {!hideActions && (onPause || onSkip) ? (
        <footer className="wa-task__actions">
          <div className="wa-task__actions-inner">
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
          </div>
        </footer>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {announcement ?? ''}
      </p>
    </div>
  );
}
