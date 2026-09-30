import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { browser } from 'wxt/browser';
import {
  Button,
  CheckGlyph,
  Disclosure,
  IndexRule,
  TextLink,
  Wordmark,
} from '@webable/ui';

import { createClient, type UiClient } from '@/lib/popup/client';
import { applyPrefs, readSystemSignals } from '@/lib/popup/theme';
import type { WelcomeState } from '@/lib/sw/ui';

/**
 * The welcome page, opened once on install (design-final Task density: one
 * column, one decision per region). Three numbered rows: allow site access
 * with a click, tune WebAble (or sign in to an existing account), and pin the
 * toolbar icon. Any order works, and every step can be skipped. What WebAble
 * reads and sends is one meta line with the detail behind a disclosure.
 * `#allow` (wa:open-welcome from the web app) focuses the Allow button.
 */

const ALL_SITES = { origins: ['<all_urls>'] };

type Grant = 'idle' | 'asking' | 'declined' | 'failed';

export function Welcome({ client = defaultClient() }: { client?: UiClient }) {
  const [state, setState] = useState<WelcomeState | null>(null);
  const [unresponsive, setUnresponsive] = useState(false);
  const [grant, setGrant] = useState<Grant>('idle');
  const accessDoneRef = useRef<HTMLParagraphElement>(null);
  const allowRef = useRef<HTMLButtonElement>(null);
  // Focus the Allow step once the page has its state (or on a later #allow).
  const wantAllow = useRef(readHash() === '#allow');
  const [hashTick, setHashTick] = useState(0);

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
    const onHash = () => {
      if (readHash() !== '#allow') return;
      wantAllow.current = true;
      setHashTick((n) => n + 1);
    };
    window.addEventListener('hashchange', onHash);
    const onPermission = () => void load();
    browser.permissions.onAdded.addListener(onPermission);
    browser.permissions.onRemoved.addListener(onPermission);
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('hashchange', onHash);
      browser.permissions.onAdded.removeListener(onPermission);
      browser.permissions.onRemoved.removeListener(onPermission);
    };
  }, [client, load]);

  useEffect(() => {
    if (state) applyPrefs(document.documentElement, state.prefs);
  }, [state]);

  useEffect(() => {
    if (!state || !wantAllow.current) return;
    wantAllow.current = false;
    (state.allSites ? accessDoneRef.current : allowRef.current)?.focus();
    // Drop the hash so the next #allow from the web app is a hashchange again.
    history.replaceState(null, '', location.pathname + location.search);
  }, [state, hashTick]);

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
  const webOrigin = state ? originOf(state.links.connect) : null;

  return (
    <div className="wl">
      <header className="wl-bar">
        <div className="wl-bar__inner">
          <Wordmark markSize={24} />
        </div>
      </header>

      <main className="wl-main" id="main">
        <div className="wl-intro">
          {done ? <p className="wl-eyebrow">All set</p> : null}
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

        <div className="wl-region">
          <IndexRule />
          <ol className="wl-steps">
            <Step
              n={1}
              title="Allow WebAble on sites"
              body="Pages then fit you as they load, not only where you open WebAble."
              done={allSites}
              doneText="Allowed on all sites"
              doneRef={accessDoneRef}
              notes={
                grant === 'declined' ? (
                  <p className="wl-note" role="status">
                    Nothing changed. You can allow it here any time, or open
                    WebAble on a page to use it there.
                  </p>
                ) : grant === 'failed' ? (
                  <p className="wl-note" role="status">
                    Chrome didn’t show its prompt. Try again, or allow access in
                    Chrome’s extension settings.
                  </p>
                ) : null
              }
            >
              <Button
                ref={allowRef}
                variant="primary"
                size="lg"
                busy={grant === 'asking'}
                busyLabel="Waiting for Chrome…"
                onClick={allow}
              >
                Allow on all sites
              </Button>
            </Step>

            <Step
              n={2}
              title="Tune it to you"
              body="Three short tasks set the text size, spacing and click targets that fit you."
              done={connected}
              doneText={
                state?.email ? `Connected as ${state.email}` : 'Connected'
              }
            >
              <Button
                variant={allSites ? 'primary' : 'secondary'}
                size="lg"
                href={state?.links.tune ?? '#'}
                arrow="external"
              >
                {'Tune WebAble · 6 min'}
              </Button>
              {webOrigin ? (
                <TextLink
                  href={`${webOrigin}/sign-in?next=/connect`}
                  onClick={(e) => openOrFocusConnect(e, webOrigin)}
                >
                  I have an account
                </TextLink>
              ) : null}
            </Step>

            <Step
              n={3}
              title="Pin WebAble"
              body="Pin it from Chrome’s extensions menu so its icon stays in the toolbar."
            />
          </ol>
        </div>

        <div className="wl-region">
          <IndexRule />
          <p className="wl-note">
            WebAble reads page layout on this computer. Page text, anything you
            type and the sites you visit stay here.
          </p>
          <Disclosure title="What WebAble reads and sends" headingLevel={2}>
            <dl className="wl-facts">
              <div className="wl-fact">
                <dt>What this allows</dt>
                <dd>
                  WebAble reads the layout of each page on this computer, then
                  adjusts text size, spacing, click targets and motion.
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
          </Disclosure>
        </div>
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
            {webOrigin ? (
              <a
                href={`${webOrigin}/privacy#what-webable-sends`}
                target="_blank"
                rel="noopener noreferrer"
              >
                What WebAble sends
              </a>
            ) : null}
          </p>
        ) : null}
      </footer>
    </div>
  );
}

/** One numbered 56 px row: numeral, title, one sentence, and its action. */
function Step({
  n,
  title,
  body,
  done = false,
  doneText,
  doneRef,
  notes,
  children,
}: {
  n: number;
  title: string;
  body: string;
  done?: boolean;
  doneText?: string;
  doneRef?: Ref<HTMLParagraphElement>;
  notes?: ReactNode;
  children?: ReactNode;
}) {
  const id = `wl-step-${n}`;
  return (
    <li className="wl-step" data-done={done || undefined}>
      <span className="wl-step__n" aria-hidden="true">
        {n}
      </span>
      <div className="wl-step__text">
        <h2 id={id} className="wl-step__title">
          {title}
        </h2>
        <p className="wl-step__body">{body}</p>
        {done ? null : notes}
      </div>
      {done ? (
        <p
          ref={doneRef}
          tabIndex={-1}
          className="wl-step__action wl-step__done"
          role="status"
        >
          <CheckGlyph size={16} className="wl-step__check" />
          <span>{doneText}</span>
        </p>
      ) : children ? (
        <div className="wl-step__action">{children}</div>
      ) : null}
    </li>
  );
}

/**
 * "I have an account": if the web app's connect page is already open (the
 * person started there), bring that tab forward instead of opening another.
 */
function openOrFocusConnect(
  e: MouseEvent<HTMLAnchorElement>,
  origin: string,
): void {
  const href = e.currentTarget.href;
  e.preventDefault();
  void browser.tabs
    .query({})
    .then(async (tabs) => {
      const open = tabs.find((t) => isConnectTab(t.url, origin));
      if (open?.id === undefined) {
        await browser.tabs.create({ url: href });
        return;
      }
      await browser.tabs.update(open.id, { active: true });
      if (open.windowId !== undefined)
        await browser.windows.update(open.windowId, { focused: true });
    })
    .catch(() => window.open(href, '_blank', 'noopener'));
}

function isConnectTab(url: string | undefined, origin: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.origin === origin &&
      (u.pathname === '/connect' || u.pathname.startsWith('/connect/'))
    );
  } catch {
    return false;
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function readHash(): string {
  return typeof location === 'undefined' ? '' : location.hash;
}

let shared: UiClient | null = null;
function defaultClient(): UiClient {
  shared ??= createClient();
  return shared;
}
