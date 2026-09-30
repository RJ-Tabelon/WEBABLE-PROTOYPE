import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button, IconButton, ToastProvider, Wordmark } from '@webable/ui';

import { COPY } from '@/lib/popup/copy';
import { popupModel, type FooterAction } from '@/lib/popup/model';
import type { TabDetail } from '@/lib/sw/ui';

import { MainView } from './MainView';
import { SentView } from './SentView';
import { SettingsView } from './SettingsView';
import { StateLine } from './StateLine';
import { usePopup, type PopupApi } from './usePopup';

/**
 * The toolbar popup (design-final 10). Fixed 56 px header and 48 px footer;
 * the body between them scrolls. The main view shows the state of this tab;
 * "What was sent" and Settings push in as sub-views with a Back button.
 * On open, focus goes to the state title so the state is announced first.
 */

type SubView = 'sent' | 'settings';

export function Popup() {
  const api = usePopup();
  const [sub, setSub] = useState<SubView | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const focusedOnOpen = useRef(false);

  // Focus the state title once, when the first view (or the error) is shown.
  useEffect(() => {
    if (focusedOnOpen.current || api.phase === 'loading') return;
    focusedOnOpen.current = true;
    titleRef.current?.focus();
  }, [api.phase]);

  // A control that disappears with a new view (Resume, Undo all, Turn on)
  // must not drop keyboard focus onto the page body: it goes to the title.
  useEffect(() => {
    if (!focusedOnOpen.current) return;
    const active = document.activeElement;
    if (!active || active === document.body) titleRef.current?.focus();
  }, [api.view]);

  // Sub-views take focus to their title; Back returns it to the opener.
  useEffect(() => {
    if (sub) titleRef.current?.focus();
  }, [sub]);

  const open = useCallback((next: SubView) => {
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSub(next);
  }, []);

  const back = useCallback(() => {
    setSub(null);
    const opener = openerRef.current;
    requestAnimationFrame(() => {
      if (opener && opener.isConnected) opener.focus();
      else titleRef.current?.focus();
    });
  }, []);

  // Esc inside a sub-view goes back (the popup itself closes on Esc otherwise).
  useEffect(() => {
    if (!sub) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sub, back]);

  return (
    <ToastProvider placement="popup" resetKey={api.view?.domain ?? null}>
      <div className="pp" data-sub={sub ?? undefined}>
        <header className="pp-header">
          {sub ? (
            <Button
              variant="ghost"
              size="md"
              iconStart="chevron-left"
              onClick={back}
              className="pp-back"
            >
              {COPY.back}
            </Button>
          ) : (
            <>
              <Wordmark className="pp-wordmark" />
              <IconButton
                icon="settings"
                label={COPY.settings}
                tooltipPlacement="bottom"
                onClick={() => open('settings')}
              />
            </>
          )}
        </header>

        <main
          className="pp-body"
          key={sub ?? 'main'}
          data-enter={sub ? '' : undefined}
        >
          <Body
            api={api}
            sub={sub}
            titleRef={titleRef}
            onOpenSent={() => open('sent')}
          />
        </main>

        {!sub && api.view ? (
          <Footer view={api.view} api={api} onOpenSent={() => open('sent')} />
        ) : null}
      </div>
    </ToastProvider>
  );
}

function Body({
  api,
  sub,
  titleRef,
  onOpenSent,
}: {
  api: PopupApi;
  sub: SubView | null;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onOpenSent: () => void;
}): ReactNode {
  if (api.phase === 'loading')
    return <p className="pp-loading" aria-hidden="true" />;
  if (api.phase === 'unresponsive' || !api.view) {
    return (
      <section className="pp-state">
        <StateLine
          ref={titleRef}
          glyph="attention"
          title={COPY.notResponding}
        />
        <p className="pp-sentence">{COPY.notRespondingBody}</p>
      </section>
    );
  }
  if (sub === 'sent')
    return <SentView view={api.view} api={api} titleRef={titleRef} />;
  if (sub === 'settings')
    return <SettingsView view={api.view} api={api} titleRef={titleRef} />;
  return (
    <MainView
      view={api.view}
      api={api}
      titleRef={titleRef}
      onOpenSent={onOpenSent}
    />
  );
}

function Footer({
  view,
  api,
  onOpenSent,
}: {
  view: TabDetail;
  api: PopupApi;
  onOpenSent: () => void;
}) {
  const [start, end] = popupModel(view).footer;
  const render = (a: FooterAction | null) => {
    switch (a) {
      case null:
        return null;
      case 'sent':
        return (
          <Button key={a} variant="ghost" size="md" onClick={onOpenSent}>
            {COPY.whatWasSent}
          </Button>
        );
      case 'undo_all':
        return (
          <Button
            key={a}
            variant="ghost"
            size="md"
            iconStart="rotate-ccw"
            onClick={() => void api.act({ type: 'ui:undo', op: 'all' })}
          >
            {COPY.undoAll}
          </Button>
        );
      case 'redo_all':
        return (
          <Button
            key={a}
            variant="ghost"
            size="md"
            iconStart="rotate-cw"
            onClick={() => void api.act({ type: 'ui:redo', op: 'all' })}
          >
            {COPY.redoAll}
          </Button>
        );
      case 'fit':
        return (
          <Button
            key={a}
            variant="ghost"
            size="md"
            href={view.links.fit}
            arrow="external"
          >
            {COPY.yourFit}
          </Button>
        );
      case 'sign_in':
        return (
          <Button
            key={a}
            variant="ghost"
            size="md"
            href={view.links.connect}
            arrow="external"
          >
            {COPY.signIn}
          </Button>
        );
    }
  };
  return (
    <footer className="pp-footer">
      <div className="pp-footer__start">{render(start)}</div>
      <div className="pp-footer__end">{render(end)}</div>
    </footer>
  );
}
