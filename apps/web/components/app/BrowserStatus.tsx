'use client';

import {
  Button,
  type ExtensionStatus,
  StatusGlyph,
  TextLink,
} from '@webable/ui';
import type { ReactNode } from 'react';

import { connectView } from '../../lib/extension/state';
import { chromeStoreUrl } from '../../lib/extension/store';
import { useExtension } from '../../lib/extension/useExtension';
import { useOpenWelcome } from '../../lib/extension/welcome';

const NOT_USED = 'Your fit isn’t used in this browser yet';

/** A tonal note with one step to take (design-final §7.18: one action). */
function Note({
  children,
  action,
}: {
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="wa-app-note">
      <p className="wa-app-note__title">{NOT_USED}</p>
      <p className="wa-app-note__text">{children}</p>
      <div className="wa-app-note__action">{action}</div>
    </div>
  );
}

function Line({
  state,
  children,
  after,
}: {
  state: ExtensionStatus;
  children: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div className="wa-browser-status">
      <span className="wa-browser-status__text">
        <StatusGlyph state={state} />
        {children}
      </span>
      {after}
    </div>
  );
}

/**
 * WebAble in this browser, read from the extension over the bridge. When the
 * fit isn't reaching this browser yet (not installed, not connected) it is a
 * note with the one step to take; otherwise one quiet line (on, paused,
 * checking), with the next step inline when there is one.
 */
export function BrowserStatus({ email }: { email: string | null }) {
  // One polite live region that stays put, so the answer is announced when it
  // replaces "Checking this browser…".
  return (
    <div className="wa-browser" aria-live="polite">
      <BrowserStatusBody email={email} />
    </div>
  );
}

function BrowserStatusBody({ email }: { email: string | null }) {
  const { state } = useExtension();
  const welcome = useOpenWelcome();
  const view = connectView(state, email);

  switch (view.view) {
    case 'checking':
      return <Line state="checking">Checking this browser…</Line>;
    case 'install': {
      const store = chromeStoreUrl();
      return (
        <Note
          action={
            store ? (
              <Button href={store} variant="primary" size="md" arrow="external">
                Add WebAble
              </Button>
            ) : (
              <Button href="/get" variant="primary" size="md" arrow="forward">
                Add WebAble
              </Button>
            )
          }
        >
          Add WebAble to Chrome, and it applies your fit to the sites you open.
        </Note>
      );
    }
    case 'connect':
      return (
        <Note
          action={
            <Button href="/connect" variant="primary" size="md" arrow="forward">
              Connect this browser
            </Button>
          }
        >
          {view.otherEmail
            ? `WebAble here is signed in as ${view.otherEmail}.`
            : 'WebAble is in this browser, but not connected to your account.'}
        </Note>
      );
    case 'connected':
      if (!view.enabled)
        return (
          <Line state="paused">WebAble is turned off in this browser.</Line>
        );
      if (view.allSites)
        return <Line state="on">WebAble is on in this browser.</Line>;
      return (
        <>
          <Line
            state="attention"
            after={
              <Button
                variant="ghost"
                size="md"
                arrow="external"
                busy={welcome.pending}
                busyLabel="Opening…"
                onClick={() => void welcome.open()}
              >
                Finish setup
              </Button>
            }
          >
            WebAble is connected, but can’t change sites yet.
          </Line>
          {welcome.error ? (
            <p className="wa-reason" role="alert">
              {welcome.error}
            </p>
          ) : null}
        </>
      );
    case 'error':
      return (
        <Line
          state="attention"
          after={
            <TextLink href="/connect" kind="standalone">
              See what’s wrong
            </TextLink>
          }
        >
          Couldn’t check WebAble in this browser.
        </Line>
      );
  }
}
