import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, SegmentedControl, SwitchRow } from '@webable/ui';

import type { Theme } from '@/lib/storage/settings';
import type { TabDetail } from '@/lib/sw/ui';

import type { PopupApi } from './usePopup';

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies ReadonlyArray<{ value: Theme; label: string }>;

/**
 * Settings (design-final 10.3): WebAble's own theme and motion, links to the
 * person's fit and help, the account on this device, and the escape hatch
 * "Turn WebAble off everywhere" with an inline confirmation (never a modal).
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
  const offRef = useRef<HTMLButtonElement>(null);
  const onRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<'question' | 'off' | 'on' | null>(null);
  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    // The target may appear only after the worker's next view (on <-> off).
    const el =
      want === 'question'
        ? questionRef.current
        : want === 'off'
          ? offRef.current
          : onRef.current;
    if (!el) return;
    focusNext.current = null;
    el.focus();
  });
  const setPrefs = (p: { theme?: Theme; reduceMotion?: boolean }) =>
    void api.call({ type: 'ui:set-prefs', ...p });

  return (
    <section className="pp-sub" aria-labelledby="pp-settings-title">
      <h1
        id="pp-settings-title"
        ref={titleRef}
        tabIndex={-1}
        className="pp-sub__title"
      >
        Settings
      </h1>

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

      <div className="pp-settings__links">
        <Button
          variant="ghost"
          size="md"
          href={view.links.fit}
          arrow="external"
        >
          Open your fit
        </Button>
        <Button
          variant="ghost"
          size="md"
          href={view.links.help}
          arrow="external"
        >
          Help
        </Button>
      </div>

      <div className="pp-settings__account">
        {view.account.signedIn || view.account.needsReauth ? (
          <>
            <p className="pp-note">
              {view.account.email
                ? `Signed in as ${view.account.email}`
                : 'Signed in'}
            </p>
            <Button
              variant="secondary"
              size="md"
              onClick={() => void api.call({ type: 'ui:sign-out' })}
            >
              Sign out on this device
            </Button>
          </>
        ) : (
          <>
            <p className="pp-note">Your fit is on this device only.</p>
            <Button
              variant="secondary"
              size="md"
              href={view.links.connect}
              arrow="external"
            >
              Sign in
            </Button>
          </>
        )}
      </div>

      <div className="pp-settings__danger">
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
            <div className="pp-confirm__pair">
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
