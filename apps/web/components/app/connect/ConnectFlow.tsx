'use client';

import {
  Actions,
  Button,
  ErrorPanel,
  StatusLine,
  StatusPill,
  TextLink,
} from '@webable/ui';
import { useEffect, useId, useRef, useState } from 'react';

import { signInPath } from '../../../lib/auth/routes';

import {
  advanceOnboardingAction,
  requestExtensionLinkAction,
} from '../../../lib/data/actions';
import { DATA_ERROR_MESSAGES } from '../../../lib/data/result';
import { extension } from '../../../lib/extension/bridge';
import {
  type BrowserKind,
  connectView,
  currentBrowser,
} from '../../../lib/extension/state';
import { useExtension } from '../../../lib/extension/useExtension';
import { useOpenWelcome } from '../../../lib/extension/welcome';
import { type ConnectFailure, linkFailure } from './failures';

export interface ConnectFlowProps {
  /** The signed-in person's email: the account the extension will sign in as. */
  email: string | null;
  /** Whether the person has a fit yet (decides where "next" goes). */
  hasFit: boolean;
  /** Chrome Web Store listing for this build's extension id, if known. */
  storeUrl: string | null;
  /** Show the load-unpacked steps (development builds only). */
  showDevSteps: boolean;
}

/**
 * The extension handoff (platform.md 3.3, docs/08 §8). Not installed: add it.
 * Installed: [Connect this browser] asks the server for a single-use sign-in
 * token and hands it to the extension, which signs itself in with its own
 * session (this page's session is never shared). Connected but not yet
 * allowed on every site: [Allow on all sites] asks the extension to show its
 * welcome page at that step (only the extension's page can ask Chrome).
 * Marks onboarding "connected".
 */
export function ConnectFlow({
  email,
  hasFit,
  storeUrl,
  showDevSteps,
}: ConnectFlowProps) {
  const { state, recheck, setStatus } = useExtension();
  const welcome = useOpenWelcome();
  const [connecting, setConnecting] = useState(false);
  const [failure, setFailure] = useState<ConnectFailure | null>(null);
  const [checkingAgain, setCheckingAgain] = useState(false);
  const [browser, setBrowser] = useState<BrowserKind>('chromium');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noEmailId = useId();
  const moveFocus = useRef(false);
  const marked = useRef(false);

  useEffect(() => setBrowser(currentBrowser()), []);

  const view = connectView(state, email);

  // After a step the person started, move focus to the new heading.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    headingRef.current?.focus();
  }, [view.view, failure]);

  // Record the milestone once, whether they connected now or earlier.
  useEffect(() => {
    if (view.view !== 'connected' || marked.current) return;
    marked.current = true;
    void advanceOnboardingAction('connected').catch(() => undefined);
  }, [view.view]);

  async function checkAgain() {
    setCheckingAgain(true);
    moveFocus.current = true;
    await recheck();
    setCheckingAgain(false);
  }

  async function connect() {
    if (connecting || !email) return;
    setConnecting(true);
    setFailure(null);
    moveFocus.current = true;

    let link: Awaited<ReturnType<typeof requestExtensionLinkAction>>;
    try {
      link = await requestExtensionLinkAction();
    } catch {
      link = {
        ok: false,
        error: {
          code: 'unavailable',
          message: DATA_ERROR_MESSAGES.unavailable,
        },
      };
    }
    if (!link.ok) {
      setConnecting(false);
      setFailure(linkFailure(link.error));
      return;
    }

    const result = await extension.connect(
      link.data.tokenHash,
      link.data.email,
    );
    setConnecting(false);
    if (!result.ok) {
      setFailure({
        title: 'Couldn’t connect this browser',
        message: result.error.message,
        code: result.error.code ?? result.error.reason,
      });
      return;
    }
    setStatus(result.data);
  }

  const heading = (text: string) => (
    <h1 ref={headingRef} tabIndex={-1} className="wa-auth-title">
      {text}
    </h1>
  );

  const nextStep = hasFit ? (
    <Button href="/app" variant="primary" arrow="forward">
      See your fit
    </Button>
  ) : (
    <Button href="/tune" variant="primary" arrow="forward">
      Tune WebAble
    </Button>
  );

  if (view.view === 'checking') {
    return (
      <div className="wa-connect">
        <header className="wa-auth-head">
          <p className="wa-auth-head__eyebrow">Connect this browser</p>
          {heading('Checking this browser')}
          <p className="wa-auth-deck">Looking for WebAble in this browser.</p>
        </header>
        <StatusLine
          state="checking"
          title="Checking…"
          className="wa-connect__status"
        />
      </div>
    );
  }

  if (view.view === 'install') {
    const unsupported = browser !== 'chromium';
    return (
      <div className="wa-connect">
        <header className="wa-auth-head">
          <p className="wa-auth-head__eyebrow">Add WebAble</p>
          {heading(
            unsupported
              ? 'WebAble works in Chrome on a computer'
              : 'Add WebAble to Chrome',
          )}
          <p className="wa-auth-deck">
            {unsupported
              ? 'Open this page in Chrome, Edge or another Chromium browser on a laptop or desktop to add it.'
              : 'WebAble is a Chrome extension. Add it, then come back to this tab to connect it.'}
          </p>
        </header>

        {unsupported ? null : (
          <>
            <ul role="list" className="wa-facts-list">
              <li>
                It adjusts pages with your fit. You can undo every change.
              </li>
              <li>Its welcome page asks to work on all sites. You choose.</li>
              <li>The sites you visit stay in this browser.</li>
            </ul>
            <Actions>
              {storeUrl ? (
                <Button href={storeUrl} variant="primary" arrow="external">
                  Add WebAble to Chrome
                </Button>
              ) : null}
              <Button
                variant={storeUrl ? 'secondary' : 'primary'}
                onClick={() => void checkAgain()}
                busy={checkingAgain}
                busyLabel="Checking…"
              >
                I’ve added it
              </Button>
            </Actions>
          </>
        )}

        {showDevSteps ? (
          <section
            className="wa-connect__dev"
            aria-labelledby="dev-steps-title"
          >
            <h2 id="dev-steps-title" className="wa-connect__dev-title">
              Running WebAble from source
            </h2>
            {view.configured ? null : (
              <p className="wa-app-meta">
                Set <code className="wa-code">NEXT_PUBLIC_EXTENSION_ID</code> in{' '}
                <code className="wa-code">apps/web/.env.local</code>, then
                restart the dev server.
              </p>
            )}
            <ol className="wa-steps">
              <li>
                <span>
                  Run <code className="wa-code">pnpm extension:enable</code> at
                  the repository root.
                </span>
              </li>
              <li>
                <span>
                  Open <code className="wa-code">chrome://extensions</code> and
                  turn on Developer mode.
                </span>
              </li>
              <li>
                <span>
                  Choose Load unpacked, then pick{' '}
                  <code className="wa-code">
                    apps/extension/.output/chrome-mv3
                  </code>
                  .
                </span>
              </li>
              <li>
                <span>Come back to this tab and choose I’ve added it.</span>
              </li>
            </ol>
          </section>
        ) : null}
      </div>
    );
  }

  if (view.view === 'error') {
    return (
      <div className="wa-connect">
        <header className="wa-auth-head">
          <p className="wa-auth-head__eyebrow">Connect this browser</p>
          {heading('WebAble didn’t answer')}
          <p className="wa-auth-deck">
            It’s installed, but this page couldn’t reach it. Nothing changed.
          </p>
        </header>
        <ErrorPanel title="What happened" as="h2">
          <p>{view.error.message}</p>
        </ErrorPanel>
        <Actions>
          <Button
            variant="primary"
            iconStart="refresh-cw"
            onClick={() => void checkAgain()}
            busy={checkingAgain}
            busyLabel="Checking…"
          >
            Check again
          </Button>
        </Actions>
      </div>
    );
  }

  if (view.view === 'connect') {
    const account = email ?? 'your account';
    return (
      <div className="wa-connect">
        <header className="wa-auth-head">
          <p className="wa-auth-head__eyebrow">Connect this browser</p>
          {heading('Use your fit in this browser')}
          <p className="wa-auth-deck">
            {view.otherEmail
              ? `WebAble in this browser is signed in as ${view.otherEmail}. Switching signs them out here.`
              : `WebAble signs in to ${account} here, so your fit applies on every site you open.`}
          </p>
        </header>

        <ul role="list" className="wa-facts-list">
          <li>
            The extension gets its own sign-in, for this browser only. Your
            password is never shared with it.
          </li>
          <li>You can disconnect it any time from Settings.</li>
        </ul>

        {failure ? (
          <ErrorPanel
            title={failure.title}
            live
            as="h2"
            details={
              failure.code ? (
                <p className="wa-mono">Code: {failure.code}</p>
              ) : undefined
            }
          >
            <p>{failure.message}</p>
          </ErrorPanel>
        ) : null}

        <Actions>
          {failure?.signIn ? (
            <Button
              href={signInPath('/connect')}
              variant="primary"
              arrow="forward"
            >
              Sign in again
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void connect()}
              busy={connecting}
              busyLabel="Connecting…"
              disabled={!email}
              aria-describedby={email ? undefined : noEmailId}
            >
              {failure
                ? 'Try again'
                : view.otherEmail && email
                  ? `Switch to ${email}`
                  : 'Connect this browser'}
            </Button>
          )}
        </Actions>
        {email ? null : (
          <p id={noEmailId} className="wa-app-meta">
            Your account needs an email address to connect a browser. Add one in
            Settings.
          </p>
        )}
      </div>
    );
  }

  // Connected.
  const title = !view.enabled
    ? 'Connected. WebAble is turned off here.'
    : view.allSites
      ? 'WebAble is on. Open any site.'
      : 'Connected. One step left.';
  const deck = !view.enabled
    ? 'Turn it on from WebAble in the toolbar, and your fit applies to the sites you open.'
    : view.allSites
      ? 'Your fit now applies to the sites you open in this browser. Every change shows, and you can undo it.'
      : 'Chrome asks before WebAble can change sites. You allow it once, on WebAble’s welcome page.';
  const fitLink = hasFit
    ? { href: '/app', label: 'See your fit' }
    : { href: '/tune', label: 'Tune WebAble' };
  return (
    <div className="wa-connect">
      <header className="wa-auth-head">
        <p className="wa-auth-head__eyebrow">
          {email ? `Connected as ${email}` : 'Connected'}
        </p>
        {heading(title)}
        <p className="wa-auth-deck">{deck}</p>
        {view.enabled && view.allSites ? (
          <StatusPill
            state="on"
            label="On · all sites"
            className="wa-connect__pill"
          />
        ) : !view.enabled ? (
          <StatusPill
            state="paused"
            label="Turned off here"
            className="wa-connect__pill"
          />
        ) : null}
      </header>

      {!view.enabled || view.allSites ? (
        <Actions>{nextStep}</Actions>
      ) : (
        <div className="wa-connect__step">
          <Actions>
            <Button
              variant="primary"
              arrow="external"
              onClick={() => void welcome.open()}
              busy={welcome.pending}
              busyLabel="Opening…"
            >
              Allow on all sites
            </Button>
            <Button
              variant="secondary"
              iconStart="refresh-cw"
              onClick={() => void checkAgain()}
              busy={checkingAgain}
              busyLabel="Checking…"
            >
              Check again
            </Button>
          </Actions>
          {welcome.error ? (
            <p className="wa-reason" role="alert">
              {welcome.error}
            </p>
          ) : null}
          <p className="wa-connect__next">
            <TextLink href={fitLink.href} kind="standalone">
              {fitLink.label}
            </TextLink>
          </p>
        </div>
      )}
    </div>
  );
}
