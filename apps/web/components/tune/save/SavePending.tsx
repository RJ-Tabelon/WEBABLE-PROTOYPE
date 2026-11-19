'use client';

import type { FitProfile } from '@webable/core';
import { fitUiVars } from '@webable/core/profile/describe';
import { Button, ErrorPanel, ProgressRuler } from '@webable/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { nudgeExtension } from '../../../lib/extension/bridge';
import { TaskShell } from '../../shell/TaskShell';
import { writeFitUi } from '../../shell/fit-ui';
import { YourFit, type SaveState, type YourFitControl } from '../fit/YourFit';
import { browserDefaultFontPx } from '../flow/device';
import { persistFit, type TuneServerActions } from '../flow/persist';
import { rederivePending, type PreviousFit } from '../flow/previous';
import { MODULE_LABEL, MODULE_TASKS, MODULES } from '../flow/steps';
import {
  clearPendingFit,
  readPendingFit,
  type PendingFit,
} from '../flow/storage';
import { SavedToAccount, SIGN_IN_TO_SAVE } from '../screens';
import { Deck, Rest, TaskHeading } from '../shared/primitives';

type SaveView =
  | { kind: 'checking' }
  /** The account has a fit: compare before saving. */
  | {
      kind: 'compare';
      pending: PendingFit;
      profile: FitProfile;
      save: SaveState;
    }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'nothing' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string };

const RULER_SECTIONS = MODULES.map((id) => ({
  id,
  label: MODULE_LABEL[id],
  tasks: MODULE_TASKS[id],
}));

export interface SavePendingProps {
  actions: TuneServerActions;
  /** The account's current fit, loaded on the server, or null when there is none. */
  previous: PreviousFit | null;
}

/**
 * Stores the fit a signed-out Tune left in this browser, once the person has
 * signed up or in. With a fit already in the account, the waiting fit is
 * derived again against it (what the person set survives) and shown as Keep
 * new / Keep old before anything is saved. On success the pending entry is
 * removed, WebAble's own UI wears the fit and the extension is told; on
 * failure the entry stays, so nothing is lost.
 */
export function SavePending({ actions, previous }: SavePendingProps) {
  const [view, setView] = useState<SaveView>({ kind: 'checking' });
  const [rootFontPx, setRootFontPx] = useState(16);
  const running = useRef(false);
  const fitControl = useRef<YourFitControl>(null);

  const save = useCallback(
    async (pending: PendingFit, profile: FitProfile, compare: boolean) => {
      if (running.current) return;
      running.current = true;
      // Comparing, the screen stays and its primary action shows the work.
      setView((v) =>
        compare && v.kind === 'compare'
          ? { ...v, save: { kind: 'saving' } }
          : { kind: 'saving' },
      );
      const outcome = await persistFit(actions, {
        profile,
        record: pending.record,
        // A fit saved over an existing one is a recalibration.
        source: previous ? 'recalibration' : pending.source,
      });
      running.current = false;
      if (outcome.kind === 'saved') {
        clearPendingFit();
        const ui = fitUiVars(profile);
        writeFitUi({
          vars: ui.style,
          ...(ui.attributes['data-wa-motion'] === 'reduce'
            ? { motion: 'reduce' as const }
            : {}),
        });
        void nudgeExtension();
        setView({ kind: 'saved' });
      } else if (outcome.kind === 'signed-out') {
        setView({ kind: 'signed-out' });
      } else {
        const message = outcome.message;
        setView((v) =>
          compare && v.kind === 'compare'
            ? { ...v, save: { kind: 'error', message } }
            : { kind: 'error', message },
        );
      }
    },
    [actions, previous],
  );

  /** Read the waiting fit: compare it with the account's, or save it. */
  const start = useCallback(() => {
    const pending = readPendingFit();
    if (!pending) {
      setView({ kind: 'nothing' });
      return;
    }
    if (previous) {
      setView({
        kind: 'compare',
        pending,
        profile: rederivePending(pending, previous.profile),
        save: { kind: 'idle' },
      });
      return;
    }
    void save(pending, pending.profile, false);
  }, [previous, save]);

  // Read the browser's pending fit once, after the first render.
  useEffect(() => {
    setRootFontPx(browserDefaultFontPx());
    if (view.kind !== 'checking') return;
    start();
  }, [start, view.kind]);

  let screen;
  let key: string = view.kind;
  switch (view.kind) {
    case 'checking':
    case 'saving':
      key = 'saving';
      screen = (
        <div className="tn-rest" aria-busy="true">
          <TaskHeading>Saving your fit</TaskHeading>
          <Deck>This takes a moment.</Deck>
        </div>
      );
      break;
    case 'compare':
      screen = (
        <YourFit
          profile={view.profile}
          previous={previous?.profile ?? null}
          previousDate={previous?.createdAt ?? null}
          rootFontPx={rootFontPx}
          signedIn
          save={view.save}
          onUse={(profile) => void save(view.pending, profile, true)}
          controlRef={fitControl}
        />
      );
      break;
    case 'saved':
      screen = <SavedToAccount done="Your fit is saved to your account." />;
      break;
    case 'nothing':
      screen = (
        <Rest
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
          <TaskHeading>Your fit isn&rsquo;t saved yet.</TaskHeading>
          <ErrorPanel title="Saving didn’t finish" live>
            {view.message} Your fit is still waiting in this browser.
          </ErrorPanel>
          <div className="tn-rest__action">
            <Button
              variant="primary"
              size="task"
              onClick={() => {
                setView({ kind: 'checking' });
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      );
      break;
  }

  // The ruler says the parts are done only when there is a finished fit here.
  const hasFit = view.kind !== 'checking' && view.kind !== 'nothing';
  const comparing = view.kind === 'compare';
  const busy = view.kind === 'compare' && view.save.kind === 'saving';
  const compareActions = comparing ? (
    <>
      <Button
        variant="primary"
        size="task"
        arrow="forward"
        busy={busy}
        busyLabel="Saving…"
        onClick={() => fitControl.current?.use()}
      >
        Save my fit
      </Button>
      <Button
        variant="secondary"
        size="task"
        disabled={busy}
        onClick={() => fitControl.current?.adjustFirst()}
      >
        Adjust first
      </Button>
    </>
  ) : undefined;
  return (
    <TaskShell
      ruler={
        hasFit ? (
          <ProgressRuler
            sections={RULER_SECTIONS}
            current={MODULES.length}
            taskIndex={0}
          />
        ) : (
          false
        )
      }
      progress={hasFit ? 'All 3 parts done' : undefined}
      actions={compareActions}
      hideActions={!comparing}
      announcement={
        view.kind === 'saved'
          ? 'Your fit is saved.'
          : view.kind === 'saving'
            ? 'Saving your fit.'
            : view.kind === 'compare'
              ? 'Your fit is ready. Compare it with your last one.'
              : ''
      }
    >
      <div key={key} className="tn-screen" data-step={`save-${view.kind}`}>
        {screen}
      </div>
    </TaskShell>
  );
}
