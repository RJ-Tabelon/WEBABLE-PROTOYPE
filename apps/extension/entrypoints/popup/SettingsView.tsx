import { useEffect, useRef, useState, type RefObject } from 'react';
import { browser } from 'wxt/browser';
import { formatOpValue } from '@webable/core/ops/catalog';
import { Button, Icon, SegmentedControl, SwitchRow } from '@webable/ui';

import { COPY } from '@/lib/popup/copy';
import type { Theme } from '@/lib/storage/settings';
import type { TabDetail } from '@/lib/sw/ui';

import type { PopupApi } from './usePopup';
import './settings.css';

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies ReadonlyArray<{ value: Theme; label: string }>;

type GlobalOp = keyof TabDetail['globalOverrides'];
const GLOBAL_LABELS: Record<GlobalOp, string> = {
  text_floor: COPY.textSize,
  line_spacing: COPY.lineSpacing,
  target_size: 'Click targets',
};

/** A sync older than this gets the "Last synced" line. */
const STALE_SYNC_MS = 24 * 60 * 60 * 1000;

/**
 * Settings (design-final 10.3), in groups split by hairlines: WebAble's own
 * theme and motion; links to the person's fit and help (and the browser-wide
 * sizes, if any); site access while it is limited; the account on this
 * device; and "Turn WebAble off everywhere" with an inline confirmation
 * (never a modal).
 */
export function SettingsView({
  view,
  api,
  titleRef,
}: {
  view: TabDetail;
  api: PopupApi;
  titleRef: RefObject<HTMLHeadingElement | null>;
}) {
  const [confirming, setConfirming] = useState(false);
  // Keep keyboard focus on the control that replaces the one just pressed.
  const questionRef = useRef<HTMLParagraphElement>(null);
  const pairRef = useRef<HTMLDivElement>(null);
  const offRef = useRef<HTMLButtonElement>(null);
  const onRef = useRef<HTMLButtonElement>(null);
  const fitRef = useRef<HTMLAnchorElement>(null);
  const focusNext = useRef<'question' | 'off' | 'on' | 'fit' | null>(null);
  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    // The target may appear only after the worker's next view (on <-> off).
    const el =
      want === 'question'
        ? questionRef.current
        : want === 'off'
          ? offRef.current
          : want === 'on'
            ? onRef.current
            : fitRef.current;
    if (!el) return;
    focusNext.current = null;
    if (want === 'question') {
      // The confirmation sits at the bottom: bring both buttons into view.
      el.focus({ preventScroll: true });
      pairRef.current?.scrollIntoView({ block: 'end' });
    } else el.focus();
  });
  const setPrefs = (p: { theme?: Theme; reduceMotion?: boolean }) =>
    void api.call({ type: 'ui:set-prefs', ...p });

  const overrides = (
    Object.entries(view.globalOverrides) as Array<[GlobalOp, number]>
  ).filter(([, level]) => typeof level === 'number');
  const signedIn = view.account.signedIn || view.account.needsReauth;
  const syncStale =
    signedIn &&
    view.lastSyncAt !== null &&
    Date.now() - view.lastSyncAt > STALE_SYNC_MS;

  return (
    <section className="pp-sub pp-set" aria-labelledby="pp-settings-title">
      <h1
        id="pp-settings-title"
        ref={titleRef}
        tabIndex={-1}
        className="pp-sub__title"
      >
        Settings
      </h1>

      <div className="pp-set__group" role="group" aria-label="Appearance">
        <div className="pp-field">
          <p id="pp-theme-label" className="pp-field__label">
            Theme
          </p>
          <SegmentedControl<Theme>
            labelledBy="pp-theme-label"
            options={THEMES}
            value={view.prefs.theme}
            onValueChange={(theme) => setPrefs({ theme })}
            fill
          />
        </div>
        <SwitchRow
          label="Reduce motion in WebAble"
          description="WebAble’s own screens only. Sites are not affected."
          checked={view.prefs.reduceMotion}
          onCheckedChange={(reduceMotion) => setPrefs({ reduceMotion })}
        />
      </div>

      <div className="pp-set__group" role="group" aria-label="Your fit">
        <div className="pp-set__rows">
          <LinkRow ref={fitRef} href={view.links.fit}>
            Your fit
          </LinkRow>
          <LinkRow href={view.links.help}>Help</LinkRow>
        </div>
        {overrides.length > 0 ? (
          <div className="pp-set__block">
            <p className="pp-note">
              {`This browser uses its own sizes: ${overrides
                .map(
                  ([op, level]) =>
                    `${GLOBAL_LABELS[op]} ${formatOpValue(op, level)}`,
                )
                .join(', ')}`}
            </p>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                focusNext.current = 'fit';
                void api.call({ type: 'ui:clear-everywhere' });
              }}
            >
              Go back to your fit
            </Button>
          </div>
        ) : null}
      </div>

      {!view.allSites ? (
        <div className="pp-set__group" role="group" aria-label="Site access">
          <div className="pp-set__block">
            <p className="pp-note">
              WebAble works on a page when you open it here. Allow all sites to
              adapt pages as they load.
            </p>
            <Button
              variant="secondary"
              size="md"
              onClick={() => requestAllSites(api)}
            >
              {COPY.allowAll}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="pp-set__group" role="group" aria-label="Account">
        <div className="pp-set__block">
          {signedIn ? (
            <p className="pp-note">
              {view.account.email
                ? `Signed in as ${view.account.email}`
                : 'Signed in'}
            </p>
          ) : null}
          {syncStale && view.lastSyncAt !== null ? (
            <p className="pp-note">
              {`Last synced ${shortDate(view.lastSyncAt)}. Your fit still works here.`}
            </p>
          ) : null}
          {!view.account.calibrated ? (
            <p className="pp-note">
              Basic fit only. Tune WebAble for your own fit.
            </p>
          ) : !signedIn ? (
            <p className="pp-note">
              Your fit is in this browser only. Sign in to use it elsewhere.
            </p>
          ) : null}
          {signedIn ? (
            <Button
              variant="secondary"
              size="md"
              onClick={() => void api.call({ type: 'ui:sign-out' })}
            >
              Sign out on this device
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="md"
              href={view.links.connect}
              arrow="external"
            >
              Sign in
            </Button>
          )}
        </div>
      </div>

      <div className="pp-set__group" role="group" aria-label="Turn off">
        {!view.enabled ? (
          <Button
            ref={onRef}
            variant="primary"
            size="lg"
            block
            onClick={() => {
              focusNext.current = 'off';
              void api.call({ type: 'ui:enabled', enabled: true });
            }}
          >
            Turn WebAble on
          </Button>
        ) : confirming ? (
          <div
            className="pp-confirm"
            role="group"
            aria-labelledby="pp-confirm-q"
          >
            <p
              id="pp-confirm-q"
              ref={questionRef}
              tabIndex={-1}
              className="pp-confirm__q"
            >
              Turn WebAble off on every site?
            </p>
            <p className="pp-note">
              Pages will look the way their sites made them. You can turn it
              back on here.
            </p>
            <div ref={pairRef} className="pp-confirm__pair">
              <Button
                variant="danger"
                size="lg"
                onClick={() => {
                  focusNext.current = 'on';
                  setConfirming(false);
                  void api.call({ type: 'ui:enabled', enabled: false });
                }}
              >
                Turn off
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => {
                  focusNext.current = 'off';
                  setConfirming(false);
                }}
              >
                Keep it on
              </Button>
            </div>
          </div>
        ) : (
          <Button
            ref={offRef}
            variant="danger"
            size="lg"
            block
            onClick={() => {
              focusNext.current = 'question';
              setConfirming(true);
            }}
          >
            Turn WebAble off everywhere
          </Button>
        )}
      </div>
    </section>
  );
}

/** A 56 px hairline row that opens a web app page in a new tab. */
function LinkRow({
  href,
  children,
  ref,
}: {
  href: string;
  children: string;
  ref?: RefObject<HTMLAnchorElement | null>;
}) {
  return (
    <a
      ref={ref}
      className="pp-set__row"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span>{children}</span>
      <Icon name="arrow-up-right" size={20} className="pp-set__arrow" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * Ask Chrome for access to every site. Must run inside the click (Chrome shows
 * its own prompt). If the popup closes while the prompt is open, the worker
 * still sees the grant (permissions.onAdded) and adapts open tabs itself.
 */
function requestAllSites(api: PopupApi): void {
  void browser.permissions
    .request({ origins: ['<all_urls>'] })
    .then((granted) =>
      granted ? api.call({ type: 'ui:grant-all-sites' }) : null,
    )
    .catch(() => undefined);
}

/** "Sep 27" in the person's locale. */
function shortDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(ms);
}
