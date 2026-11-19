'use client';

import { Actions, Button, Dialog, FitValue, useToast } from '@webable/ui';
import { useState } from 'react';

import {
  forgetLearningAction,
  resetLearnedAction,
} from '../../../app/app/actions';
import { DATA_ERROR_MESSAGES } from '../../../lib/data/result';
import { nudgeExtension } from '../../../lib/extension/bridge';
import { AppSection } from '../PageHead';
import { type LearnedRow, learnedKeys } from './learned';

async function run(
  action: () => Promise<
    { ok: true } | { ok: false; error: { message: string } }
  >,
): Promise<string | null> {
  try {
    const result = await action();
    return result.ok ? null : result.error.message;
  } catch {
    return DATA_ERROR_MESSAGES.unavailable;
  }
}

/**
 * "What WebAble has learned", undoable row by row (design-final §13.1 rule 4:
 * undo sits next to every change). [Reset] clears what was learned for that
 * row; a change turned off everywhere gets [Turn back on]. The section's
 * [Forget what WebAble learned] clears all of it after one question. The
 * extension is told at once, so pages follow.
 */
export function LearnedSection({
  initial,
  eyebrow,
}: {
  initial: LearnedRow[];
  /** "Last updated Sep 29, 2026". */
  eyebrow?: string;
}) {
  const [rows, setRows] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);
  const toast = useToast();

  async function reset(row: LearnedRow) {
    setPending(row.key);
    const keys = learnedKeys(row);
    const error = await run(() => resetLearnedAction({ keys }));
    setPending(null);
    if (error) {
      toast.show({ message: `Nothing changed. ${error}` });
      return;
    }
    setRows((list) => list.filter((r) => r.key !== row.key));
    void nudgeExtension();
    toast.show({
      message: row.blocked
        ? `${row.label} is back on. WebAble can use it again.`
        : `${row.label} starts fresh. WebAble learns it again as you browse.`,
    });
  }

  async function forget() {
    setForgetting(true);
    setForgetError(null);
    const error = await run(() => forgetLearningAction());
    setForgetting(false);
    if (error) {
      setForgetError(error);
      return;
    }
    setConfirming(false);
    setRows([]);
    void nudgeExtension();
    toast.show({ message: 'WebAble forgot what it learned. Your fit stays.' });
  }

  const forgetButton =
    rows.length > 0 ? (
      <Button
        variant="ghost"
        size="md"
        flush="end"
        onClick={() => setConfirming(true)}
      >
        Forget what WebAble learned
      </Button>
    ) : null;

  return (
    <AppSection
      id="learned"
      title="What WebAble has learned"
      eyebrow={eyebrow}
      deck="From the changes you keep and undo. It’s saved with your account, without any sites."
      action={forgetButton}
    >
      {rows.length === 0 ? (
        <p className="wa-app-prose">
          Nothing yet. WebAble learns from the changes you keep and undo.
        </p>
      ) : (
        <ul
          role="list"
          className="wa-rows"
          aria-label="What WebAble has learned"
        >
          {rows.map((row) => (
            <li
              key={row.key}
              className="wa-row wa-row--split wa-row--end-action wa-learned"
              aria-busy={pending === row.key || undefined}
            >
              <div className="wa-learned__text">
                <p className="wa-row__label">{row.label}</p>
                {row.dim ? (
                  <p className="wa-learned__detail">
                    <span>Adjusted as you browse</span>
                    <FitValue value={row.dim.value} size="inline" />
                  </p>
                ) : null}
                {row.sentence ? (
                  <p className="wa-learned__detail">{row.sentence}</p>
                ) : null}
              </div>
              <div className="wa-row__actions">
                <Button
                  variant="ghost"
                  size="md"
                  flush="end"
                  busy={pending === row.key}
                  busyLabel={row.blocked ? 'Turning on…' : 'Resetting…'}
                  disabled={pending !== null && pending !== row.key}
                  onClick={() => void reset(row)}
                >
                  {row.blocked ? 'Turn back on' : 'Reset'}
                  <span className="sr-only"> {row.label.toLowerCase()}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !forgetting) setConfirming(false);
        }}
        title="Forget what WebAble learned?"
        description="WebAble forgets which changes you keep and undo, and the values it adjusted as you browse. Your fit stays, and WebAble starts learning again."
        actions={
          <Actions>
            <Button
              variant="danger-filled"
              busy={forgetting}
              busyLabel="Forgetting…"
              onClick={() => void forget()}
            >
              Forget it
            </Button>
            <Button
              variant="secondary"
              disabled={forgetting}
              onClick={() => setConfirming(false)}
            >
              Keep it
            </Button>
          </Actions>
        }
      >
        {forgetError ? (
          <p className="wa-reason" role="alert">
            Nothing was forgotten. {forgetError}
          </p>
        ) : null}
      </Dialog>
    </AppSection>
  );
}
