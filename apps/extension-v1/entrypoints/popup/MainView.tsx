import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { browser } from 'wxt/browser';
import {
  Button,
  Disclosure,
  IconButton,
  OfferBlock,
  SwitchRow,
  useToast,
} from '@webable/ui';

import { COPY } from '@/lib/popup/copy';
import {
  originOf,
  popupModel,
  type FitViewModel,
  type PopupModel,
  type PrimaryAction,
  type QuickRow,
} from '@/lib/popup/model';
import {
  dismissedNotices,
  dismissNotice,
  wantsFitViewNotice,
} from '@/lib/popup/notices';
import type { TabDetail } from '@/lib/sw/ui';

import { AdjustPanel } from './Adjust';
import { ChangesSection } from './Changes';
import { StateLine } from './StateLine';
import type { PopupApi } from './usePopup';

export interface MainViewProps {
  view: TabDetail;
  api: PopupApi;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onOpenSent: () => void;
}

/**
 * Block order: domain, state line, sentence, state body, (the one-time
 * notice), Fit view, What changed, (offer), Adjust or the quick switches,
 * the all-sites line, notes. What changed and Show on page stay in view
 * whatever the offer does.
 */
export function MainView({ view, api, titleRef }: MainViewProps) {
  const model = popupModel(view);
  const notice = useFitViewNotice(view, titleRef);
  return (
    <>
      <section className="pp-state">
        {model.domainLine ? (
          <p className="pp-domain">{model.domainLine}</p>
        ) : null}
        <StateLine
          ref={titleRef}
          glyph={model.copy.glyph}
          title={model.copy.title}
        />
        <p className="pp-sentence">{model.copy.sentence}</p>

        {model.reauth ? (
          <Button
            variant="secondary"
            size="lg"
            block
            href={view.links.connect}
            arrow="external"
          >
            {COPY.signIn}
          </Button>
        ) : null}

        {model.primary ? (
          <Primary action={model.primary} view={view} api={api} />
        ) : null}
        {model.primary?.kind === 'allow' ? (
          <>
            <LinkButton standalone onClick={() => requestAllSites(api)}>
              {COPY.orAllowAll}
            </LinkButton>
            <p className="pp-note">{COPY.siteAccess}</p>
          </>
        ) : null}

        {model.siteSwitch ? (
          <SwitchRow
            label={COPY.siteSwitch}
            changesPage
            checked={model.siteSwitch.on}
            onCheckedChange={(on) =>
              void api.act({ type: 'ui:pause-site', paused: !on })
            }
            className="pp-site-switch"
          />
        ) : null}
      </section>

      {notice.show ? (
        <div className="pp-notice">
          <p className="pp-notice__text">{COPY.fitViewNotice}</p>
          <IconButton
            icon="x"
            label={COPY.hideNotice}
            tooltipPlacement="top"
            onClick={notice.dismiss}
          />
        </div>
      ) : null}

      {model.fitView ? (
        <FitViewSection model={model.fitView} view={view} api={api} />
      ) : null}

      {model.changes.length > 0 ||
      model.undone.length > 0 ||
      view.undoneByYou.length > 0 ||
      view.reasonOpen.length > 0 ? (
        <ChangesSection model={model} view={view} api={api} />
      ) : null}

      {model.offer ? <Offer model={model} api={api} /> : null}

      {model.quick ? (
        <QuickSection rows={model.quickRows} view={view} api={api} />
      ) : null}

      {model.showAdjust ? <AdjustPanel view={view} api={api} /> : null}

      {model.askAllSites ? (
        <div className="pp-notes pp-access" style={ASK_ROW}>
          <div>
            <p className="pp-note">{COPY.activeTabOnly}</p>
            {/* Its own line, so the action keeps a 44 px target. */}
            <LinkButton standalone onClick={() => requestAllSites(api)}>
              {COPY.allowAll}
            </LinkButton>
          </div>
          <IconButton
            icon="x"
            label={COPY.hideAsk}
            tooltipPlacement="top"
            onClick={() =>
              void api.call({ type: 'ui:set-prefs', hideAllSitesAsk: true })
            }
          />
        </div>
      ) : null}

      {model.notes.length > 0 ? (
        <div className="pp-notes">
          {model.notes.map((note) => (
            <p key={note} className="pp-note">
              {note}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * The one-time v2 notice (docs/10 §8), until the person hides it. Its ✕
 * disappears with it, so keyboard focus goes back to the state title.
 */
function useFitViewNotice(
  view: TabDetail,
  titleRef: RefObject<HTMLHeadingElement | null>,
): { show: boolean; dismiss: () => void } {
  // null while the dismissal is being read: never flash the notice.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void dismissedNotices().then((ids) => {
      if (live) setDismissed(ids.has('fit_view'));
    });
    return () => {
      live = false;
    };
  }, []);
  return {
    show: dismissed === false && wantsFitViewNotice(view),
    dismiss: () => {
      setDismissed(true);
      void dismissNotice('fit_view');
      requestAnimationFrame(() => titleRef.current?.focus());
    },
  };
}

/**
 * Fit view for this tab: the switch (open or close it here, and keep it on
 * as this tab moves on), "Always here" for the site, and the planner's
 * state. A page Fit view can't show gets one plain line instead.
 */
function FitViewSection({
  model,
  view,
  api,
}: {
  model: FitViewModel;
  view: TabDetail;
  api: PopupApi;
}) {
  const { toggle, always } = model;
  return (
    <section className="pp-section pp-fitview">
      {toggle ? (
        <SwitchRow
          label={COPY.fitView}
          description={toggle.description ?? undefined}
          changesPage
          checked={toggle.on}
          onCheckedChange={(on) =>
            void api.act({ type: 'ui:fit-view', on, scope: 'page' })
          }
        />
      ) : null}
      {/* Planning, then "A better layout is ready", are said as they arrive. */}
      <div className="pp-fitview__live" aria-live="polite">
        {model.line ? <p className="pp-note">{model.line}</p> : null}
        {model.better ? (
          <div className="pp-fitview__better">
            <p className="pp-fitview__ready">{COPY.betterReady}</p>
            <Button
              variant="secondary"
              size="md"
              aria-label={COPY.switchLayoutLabel}
              onClick={() => void api.act({ type: 'ui:fit-view-switch' })}
            >
              {COPY.switchLayout}
            </Button>
          </div>
        ) : null}
      </div>
      {always ? (
        <SwitchRow
          label={COPY.alwaysHere}
          description={COPY.alwaysHereDesc}
          changesPage
          checked={always.on}
          onCheckedChange={(on) =>
            void api.act({ type: 'ui:fit-view', on, scope: 'site' })
          }
        />
      ) : null}
      {model.consent ? (
        <div className="pp-fitview__consent">
          <p className="pp-note">{COPY.betterLayoutsNote}</p>
          <Button
            variant="ghost"
            size="md"
            href={`${view.links.privacy}#sharing`}
            arrow="external"
          >
            {COPY.betterLayouts}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Meta line beside its 44 px ✕ (popup.css has no rule for this row yet). */
const ASK_ROW: CSSProperties = {
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'start',
  justifyItems: 'stretch',
  marginInlineEnd: 'calc(-1 * var(--space-3))',
};

/** A button that reads as an ink, underlined link (an action, not a place). */
const LINK_RESET: CSSProperties = {
  margin: 0,
  padding: 0,
  border: 0,
  background: 'none',
  font: 'inherit',
  letterSpacing: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
};

function LinkButton({
  standalone = false,
  onClick,
  children,
}: {
  standalone?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={standalone ? 'wa-link wa-link--standalone' : 'wa-link'}
      style={standalone ? { ...LINK_RESET, justifySelf: 'start' } : LINK_RESET}
      onClick={onClick}
    >
      {children}
    </button>
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

/** This tab's http(s) origin, read ahead so the click can ask Chrome at once. */
function useTabOrigin(tabId: number | null, wanted: boolean): string | null {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted || tabId === null) return;
    let live = true;
    void browser.tabs
      .get(tabId)
      .then((tab) => {
        if (live) setOrigin(originOf(tab.url));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tabId, wanted]);
  return origin;
}

/** Ask Chrome for this one site (inside the click), then tell the worker. */
function requestSite(api: PopupApi, origin: string | null): void {
  if (!origin) return;
  void browser.permissions
    .request({ origins: [`${origin}/*`] })
    .then((granted) =>
      granted ? api.act({ type: 'ui:grant-site', origin }) : null,
    )
    .catch(() => undefined);
}

function Primary({
  action,
  view,
  api,
}: {
  action: PrimaryAction;
  view: TabDetail;
  api: PopupApi;
}) {
  const origin = useTabOrigin(api.tabId, action.kind === 'allow');
  switch (action.kind) {
    case 'resume':
      return (
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => void api.act({ type: 'ui:pause-site', paused: false })}
        >
          {action.label}
        </Button>
      );
    case 'turn_on':
      return (
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => void api.call({ type: 'ui:enabled', enabled: true })}
        >
          {action.label}
        </Button>
      );
    case 'reload':
      return (
        <Button
          variant="secondary"
          size="lg"
          block
          iconStart="refresh-cw"
          onClick={() => {
            if (api.tabId === null) return;
            void browser.tabs.reload(api.tabId).then(
              () => window.close(),
              () => undefined,
            );
          }}
        >
          {action.label}
        </Button>
      );
    case 'allow':
      return (
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => requestSite(api, origin)}
        >
          {action.label}
        </Button>
      );
    case 'tune':
    case 'sign_in':
    case 'fit':
      return (
        <Button
          variant="ghost"
          size="md"
          href={
            action.kind === 'tune'
              ? view.links.tune
              : action.kind === 'sign_in'
                ? view.links.connect
                : view.links.fit
          }
          arrow="external"
          className="pp-inline-action"
        >
          {action.label}
        </Button>
      );
  }
}

/**
 * First run: three switches that change this site at once, then the call to
 * Tune. A switch the checks undid here reads Off, says why, and keeps its pin.
 */
function QuickSection({
  rows,
  view,
  api,
}: {
  rows: QuickRow[];
  view: TabDetail;
  api: PopupApi;
}) {
  const toast = useToast();
  const toggle = (row: QuickRow) => (on: boolean) => {
    void api.act({ type: 'ui:quick', key: row.key, on }).then((next) => {
      // Confirm only a change that is on the page now; one the checks put back says so on its row.
      const stayed = next?.changes.some(
        (c) => c.op === row.op && c.status === 'applied',
      );
      if (on && stayed)
        toast.show({
          message: `${row.label} is on for this site.`,
          applied: true,
        });
    });
  };
  return (
    <section className="pp-section pp-quick" aria-labelledby="pp-quick-title">
      <h2 id="pp-quick-title" className="pp-eyebrow">
        {COPY.quickTitle}
      </h2>
      {rows.map((row) => (
        <Fragment key={row.key}>
          <SwitchRow
            label={row.label}
            description={row.undone ?? undefined}
            changesPage={row.undone === null}
            checked={row.on}
            onCheckedChange={toggle(row)}
          />
          {row.undone !== null ? (
            <Disclosure
              title={COPY.why}
              density="compact"
              headingLevel={null}
              className="pp-why"
            >
              <p>{COPY.whyUndone}</p>
            </Disclosure>
          ) : null}
        </Fragment>
      ))}
      <div className="pp-tune">
        <Button
          variant="primary"
          size="lg"
          block
          href={view.links.tune}
          arrow="external"
        >
          {COPY.tune}
        </Button>
        <p className="pp-note">{COPY.tuneMeta}</p>
      </div>
    </section>
  );
}

/** The one contained surface in the popup: a question with two equal answers. */
function Offer({ model, api }: { model: PopupModel; api: PopupApi }) {
  const offer = model.offer;
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!offer || seen.current === offer.op) return;
    seen.current = offer.op;
    void api.act({ type: 'ui:offer-seen' });
  }, [offer, api]);
  if (!offer) return null;
  const answer = (a: 'accept' | 'dismiss' | 'never_here') => () =>
    void api.act({ type: 'ui:offer-answer', op: offer.op, answer: a });
  return (
    <div className="pp-offer">
      <OfferBlock
        question={offer.question}
        reason={offer.reason}
        onAccept={answer('accept')}
        onDecline={answer('dismiss')}
        onNeverHere={answer('never_here')}
        neverLabel="Don’t suggest this here"
      />
    </div>
  );
}
