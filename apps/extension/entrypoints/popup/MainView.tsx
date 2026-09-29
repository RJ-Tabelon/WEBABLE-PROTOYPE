import { useEffect, useRef, type RefObject } from 'react';
import { browser } from 'wxt/browser';
import { Button, OfferBlock, SwitchRow, useToast } from '@webable/ui';

import { COPY } from '@/lib/popup/copy';
import {
  popupModel,
  type PopupModel,
  type PrimaryAction,
} from '@/lib/popup/model';
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

/** Block order: domain, state line, sentence, state body, (offer), What changed, Adjust, notes. */
export function MainView({ view, api, titleRef }: MainViewProps) {
  const model = popupModel(view);
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
          <p className="pp-note">{COPY.siteAccess}</p>
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

      {model.quick ? <QuickSection view={view} api={api} /> : null}

      {model.offer ? <Offer model={model} api={api} /> : null}

      {model.changes.length > 0 ||
      model.undone.length > 0 ||
      view.reasonOpen.length > 0 ? (
        <ChangesSection model={model} view={view} api={api} />
      ) : null}

      {model.showAdjust ? <AdjustPanel view={view} api={api} /> : null}

      {model.askAllSites ? (
        <div className="pp-notes pp-access">
          <p className="pp-note">{COPY.activeTabOnly}</p>
          <Button
            variant="secondary"
            size="md"
            className="pp-access__allow"
            onClick={() => requestAllSites(api)}
          >
            {COPY.allowAll}
          </Button>
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

function Primary({
  action,
  view,
  api,
}: {
  action: PrimaryAction;
  view: TabDetail;
  api: PopupApi;
}) {
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
          onClick={() => requestAllSites(api)}
        >
          {action.label}
        </Button>
      );
    case 'fit':
      return (
        <Button
          variant="ghost"
          size="md"
          href={view.links.fit}
          arrow="external"
          className="pp-inline-action"
        >
          {action.label}
        </Button>
      );
  }
}

const QUICK_OP = {
  text: 'text_floor',
  targets: 'target_size',
  calm: 'calm_motion',
} as const;

/** First run: three switches that change this site at once, then the call to Tune. */
function QuickSection({ view, api }: { view: TabDetail; api: PopupApi }) {
  const toast = useToast();
  const toggle =
    (key: 'text' | 'targets' | 'calm', label: string) => (on: boolean) => {
      void api.act({ type: 'ui:quick', key, on }).then((next) => {
        // Confirm only a change that is on the page now; one the checks put back has its own row.
        const stayed = next?.changes.some(
          (c) => c.op === QUICK_OP[key] && c.status === 'applied',
        );
        if (on && stayed)
          toast.show({
            message: `${label} is on for this site.`,
            applied: true,
          });
      });
    };
  return (
    <section className="pp-section pp-quick" aria-labelledby="pp-quick-title">
      <h2 id="pp-quick-title" className="pp-eyebrow">
        {COPY.quickTitle}
      </h2>
      <SwitchRow
        label={COPY.quickText}
        changesPage
        checked={view.quick.text}
        onCheckedChange={toggle('text', COPY.quickText)}
      />
      <SwitchRow
        label={COPY.quickTargets}
        changesPage
        checked={view.quick.targets}
        onCheckedChange={toggle('targets', COPY.quickTargets)}
      />
      <SwitchRow
        label={COPY.quickCalm}
        changesPage
        checked={view.quick.calm}
        onCheckedChange={toggle('calm', COPY.quickCalm)}
      />
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
