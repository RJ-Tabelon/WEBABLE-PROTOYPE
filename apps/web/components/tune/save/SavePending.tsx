'use client';

import { fitUiVars } from '@webable/core/profile/describe';
import { Button, ErrorPanel, ProgressRuler } from '@webable/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { TaskShell } from '../../shell/TaskShell';
import { writeFitUi } from '../../shell/fit-ui';
import { persistFit, type TuneServerActions } from '../flow/persist';
import { MODULE_LABEL, MODULE_TASKS, MODULES } from '../flow/steps';
import {
  clearPendingFit,
  readPendingFit,
  type PendingFit,
} from '../flow/storage';
import { SIGN_IN_TO_SAVE } from '../screens';
import { Deck, Rest, TaskHeading } from '../shared/primitives';

type SaveView =
  | { kind: 'checking' }
  | { kind: 'saving' }
  | { kind: 'saved'; recalibration: boolean }
  | { kind: 'nothing' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string };

const RULER_SECTIONS = MODULES.map((id) => ({
  id,
  label: MODULE_LABEL[id],
  tasks: MODULE_TASKS[id],
}));

/**
 * Stores the fit a signed-out Tune left in this browser, once the person has
 * signed up or in. On success the pending entry is removed and WebAble's own UI
 * wears the fit; on failure the entry stays, so nothing is lost.
 */
export function SavePending({ actions }: { actions: TuneServerActions }) {
  const [view, setView] = useState<SaveView>({ kind: 'checking' });
  const running = useRef(false);

  const save = useCallback(
    async (pending: PendingFit) => {
      if (running.current) return;
      running.current = true;
      setView({ kind: 'saving' });
      const outcome = await persistFit(actions, {
        profile: pending.profile,
        record: pending.record,
        source: pending.source,
      });
      running.current = false;
      if (outcome.kind === 'saved') {
        clearPendingFit();
        const ui = fitUiVars(pending.profile);
        writeFitUi({
          vars: ui.style,
          ...(ui.attributes['data-wa-motion'] === 'reduce'
            ? { motion: 'reduce' as const }
            : {}),
        });
        setView({
          kind: 'saved',
          recalibration: pending.source === 'recalibration',
        });
      } else if (outcome.kind === 'signed-out') {
        setView({ kind: 'signed-out' });
      } else {
        setView({ kind: 'error', message: outcome.message });
      }
    },
    [actions],
  );

  // Read the browser's pending fit once, after the first render.
  useEffect(() => {
    if (view.kind !== 'checking') return;
    const pending = readPendingFit();
    if (!pending) {
      setView({ kind: 'nothing' });
      return;
    }
    void save(pending);
  }, [save, view.kind]);

  const retry = () => {
    const pending = readPendingFit();
    if (pending) void save(pending);
    else setView({ kind: 'nothing' });
  };

  let screen;
  switch (view.kind) {
    case 'checking':
    case 'saving':
      screen = (
        <div className="tn-rest" aria-busy="true">
          <TaskHeading key="saving">Saving your fit</TaskHeading>
          <Deck>This takes a moment.</Deck>
        </div>
      );
      break;
    case 'saved':
      screen = (
        <Rest
          key="saved"
          done="Your fit is saved to your account."
          title="WebAble now fits you."
          action={
            view.recalibration ? (
              <Button variant="primary" size="task" href="/app" arrow="forward">
                See your fit
              </Button>
            ) : (
              <Button
                variant="primary"
                size="task"
                href="/connect"
                arrow="forward"
              >
                Connect the extension
              </Button>
            )
          }
        >
          <Deck>
            {view.recalibration
              ? 'The extension picks up the new fit the next time it syncs.'
              : 'Next, connect the extension so the sites you visit can use it. This page already does.'}
          </Deck>
        </Rest>
      );
      break;
    case 'nothing':
      screen = (
        <Rest
          key="nothing"
          title="There’s no fit waiting here."
          action={
            <div className="tn-controls">
              <Button
                variant="primary"
                size="task"
                href="/tune"
                arrow="forward"
              >
                Tune WebAble
              </Button>
              <Button variant="secondary" size="task" href="/app">
                Go to your fit
              </Button>
            </div>
          }
        >
          <Deck>
            A fit made in this browser is saved here after you sign in. It may
            already be in your account, or it was made in another browser.
          </Deck>
        </Rest>
      );
      break;
    case 'signed-out':
      screen = (
        <Rest
          key="signed-out"
          title="Sign in to save your fit."
          action={
            <Button
              variant="primary"
              size="task"
              href={SIGN_IN_TO_SAVE}
              arrow="forward"
            >
              Sign in
            </Button>
          }
        >
          <Deck>
            Your session ended. Your fit is still waiting in this browser.
          </Deck>
        </Rest>
      );
      break;
    case 'error':
      screen = (
        <div className="tn-rest">
          <TaskHeading key="error">Your fit isn&rsquo;t saved yet.</TaskHeading>
          <ErrorPanel title="Saving didn’t finish" live>
            {view.message} Your fit is still waiting in this browser.
          </ErrorPanel>
          <div className="tn-rest__action">
            <Button variant="primary" size="task" onClick={retry}>
              Try again
            </Button>
          </div>
        </div>
      );
      break;
  }

  // The ruler says the parts are done only when there is a finished fit here.
  const hasFit = view.kind !== 'checking' && view.kind !== 'nothing';
  return (
    <TaskShell
      ruler={
        hasFit ? (
          <ProgressRuler
            sections={RULER_SECTIONS}
            current={MODULES.length}
            taskIndex={0}
          />
        ) : undefined
      }
      progressText={hasFit ? 'All 3 parts done' : undefined}
      hideActions
      announcement={
        view.kind === 'saved'
          ? 'Your fit is saved.'
          : view.kind === 'saving'
            ? 'Saving your fit.'
            : ''
      }
    >
      <div className="tn-screen">{screen}</div>
    </TaskShell>
  );
}
