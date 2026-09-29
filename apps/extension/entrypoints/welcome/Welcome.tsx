import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { browser } from 'wxt/browser';
import { Button, CheckGlyph, IndexRule, Wordmark } from '@webable/ui';

import { createClient, type UiClient } from '@/lib/popup/client';
import { applyPrefs, readSystemSignals } from '@/lib/popup/theme';
import type { WelcomeState } from '@/lib/sw/ui';

/**
 * The welcome page, opened once on install (design-final Task density: one
 * column, one decision per region). Step 1 asks for site access with a click,
 * and says plainly what that access means. Step 2 connects the person's fit
 * from the web app. Both steps can be done in any order, or skipped.
 */

const ALL_SITES = { origins: ['<all_urls>'] };

type Grant = 'idle' | 'asking' | 'declined' | 'failed';

export function Welcome({ client = defaultClient() }: { client?: UiClient }) {
  const [state, setState] = useState<WelcomeState | null>(null);
  const [unresponsive, setUnresponsive] = useState(false);
  const [grant, setGrant] = useState<Grant>('idle');
  const accessDoneRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async () => {
    const next = await client.send({ type: 'ui:welcome' });
    if (next) {
      setState(next);
      setUnresponsive(false);
    } else setUnresponsive(true);
  }, [client]);

  useEffect(() => {
    void client.send({ type: 'ui:system', signals: readSystemSignals(window) });
    void load();
    const off = client.onChanged(() => void load());
    // Coming back from the web app (sign-in, Tune) or Chrome's settings.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    const onPermission = () => void load();
    browser.permissions.onAdded.addListener(onPermission);
    browser.permissions.onRemoved.addListener(onPermission);
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
      browser.permissions.onAdded.removeListener(onPermission);
      browser.permissions.onRemoved.removeListener(onPermission);
    };
  }, [client, load]);

  useEffect(() => {
    if (state) applyPrefs(document.documentElement, state.prefs);
  }, [state]);

  const allow = () => {
    setGrant('asking');
    // permissions.request must run inside the click: Chrome shows its own prompt.
    browser.permissions.request(ALL_SITES).then(
      async (granted) => {
        if (!granted) {
          setGrant('declined');
          return;
        }
        const next = await client.send({ type: 'ui:grant-all-sites' });
        if (next) setState(next);
        else await load();
        setGrant('idle');
        requestAnimationFrame(() => accessDoneRef.current?.focus());
      },
      () => setGrant('failed'),
    );
  };

  const allSites = state?.allSites ?? false;
  const connected = state?.connected ?? false;
  const done = allSites && connected;

  return (
    <div className="wl">
      <header className="wl-bar">
        <div className="wl-bar__inner">
          <Wordmark markSize={24} />
        </div>
      </header>

      <main className="wl-main" id="main">
        <div className="wl-intro">
          <p className="wl-eyebrow">Two steps · about a minute</p>
          <h1 className="wl-title">
            {done ? 'WebAble is ready' : 'Set up WebAble'}
          </h1>
          <p className="wl-lead">
            WebAble adjusts each site to how you read, point and focus. You see
            every change and can undo it.
          </p>
        </div>

        {unresponsive ? (
          <p className="wl-body" role="alert">
            WebAble isn’t responding. Reload this page to try again. Nothing was
            changed.
          </p>
        ) : null}

        <Step
          n={1}
          label="Site access"
          title="Let WebAble work on every site"
          done={allSites}
          doneText="WebAble can work on every site. Pages fit you as they load."
          doneRef={accessDoneRef}
        >
          <p className="wl-body">
            Pages then fit you as they load. Without this, WebAble works only on
            the page where you open it from the toolbar.
          </p>
          <div className="wl-actions">
            <Button
              variant="primary"
              size="lg"
              busy={grant === 'asking'}
              busyLabel="Waiting for Chrome…"
              onClick={allow}
            >
              Allow on all sites
            </Button>
          </div>
          {grant === 'declined' ? (
            <p className="wl-note" role="status">
              Nothing changed. You can allow it here any time, or open WebAble
              on a page to use it there.
            </p>
          ) : null}
          {grant === 'failed' ? (
            <p className="wl-note" role="status">
              Chrome didn’t show its prompt. Try again, or allow access in
              Chrome’s extension settings.
            </p>
          ) : null}
          <dl className="wl-facts">
            <div className="wl-fact">
              <dt>What this allows</dt>
              <dd>
                WebAble reads the layout of each page on this device, then
                adjusts text size, spacing, click targets and motion for you.
              </dd>
            </div>
            <div className="wl-fact">
              <dt>What never leaves this computer</dt>
              <dd>
                Page text, anything you type, and the list of sites you visit.
                If you turn on page analysis, only page structure is sent, and
                you can see exactly what.
              </dd>
            </div>
            <div className="wl-fact">
              <dt>What you keep</dt>
              <dd>
                Every change is listed in WebAble’s toolbar menu with an Undo.
                You can pause any site, or remove access later in Chrome’s
                settings.
              </dd>
            </div>
          </dl>
        </Step>

        <Step
          n={2}
          label="Your fit"
          title="Connect your fit"
          done={connected}
          doneText={
            state?.email
              ? `Connected as ${state.email}.`
              : 'Connected. Your fit is on this browser.'
          }
        >
          <p className="wl-body">
            Tune WebAble to you in three short tasks, or sign in if you already
            have. Your fit then works in this browser. Until then, WebAble uses
            your system settings.
          </p>
          <div className="wl-actions">
            <Button
              variant={allSites ? 'primary' : 'secondary'}
              size="lg"
              href={state?.links.connect ?? '#'}
              arrow="external"
            >
              Connect your fit
            </Button>
          </div>
        </Step>

        {done ? (
          <section className="wl-done" aria-labelledby="wl-done-title">
            <IndexRule />
            <h2 id="wl-done-title" className="wl-step__title">
              You’re set
            </h2>
            <p className="wl-body">
              Open any site. WebAble’s toolbar icon shows how many changes it
              made, and each one can be undone.
            </p>
          </section>
        ) : null}

        <p className="wl-tip">
          Tip: pin WebAble from Chrome’s extensions menu so its icon stays in
          the toolbar.
        </p>
      </main>

      <footer className="wl-footer">
        <p className="wl-honest">
          WebAble changes how pages look and work for you. It doesn’t make any
          site accessible or compliant.
        </p>
        {state ? (
          <p className="wl-links">
            <a
              href={state.links.help}
              target="_blank"
              rel="noopener noreferrer"
            >
              Help
            </a>
          </p>
        ) : null}
      </footer>
    </div>
  );
}

function Step({
  n,
  label,
  title,
  done,
  doneText,
  doneRef,
  children,
}: {
  n: number;
  label: string;
  title: string;
  done: boolean;
  doneText: string;
  doneRef?: Ref<HTMLParagraphElement>;
  children: ReactNode;
}) {
  const id = `wl-step-${n}`;
  return (
    <section
      className="wl-step"
      aria-labelledby={id}
      data-done={done || undefined}
    >
      <IndexRule />
      <p className="wl-eyebrow">{`Step ${n} of 2 · ${label}`}</p>
      <h2 id={id} className="wl-step__title">
        {title}
      </h2>
      {done ? (
        <p ref={doneRef} tabIndex={-1} className="wl-step__done" role="status">
          <CheckGlyph size={16} className="wl-step__check" />
          <span>{doneText}</span>
        </p>
      ) : (
        children
      )}
    </section>
  );
}

let shared: UiClient | null = null;
function defaultClient(): UiClient {
  shared ??= createClient();
  return shared;
}
