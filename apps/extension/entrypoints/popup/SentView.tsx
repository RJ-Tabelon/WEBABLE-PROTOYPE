import { useEffect, useState, type RefObject } from 'react';
import type { SentReceipt } from '@webable/core/bridge/protocol';
import { Button, Disclosure } from '@webable/ui';

import { clockTime, structureSummary } from '@/lib/popup/format';
import type { TabDetail } from '@/lib/sw/ui';

import type { PopupApi } from './usePopup';

/**
 * "What was sent" (design-final 10.3, ai-architecture 9): the exact request
 * body that left the device for this page, in plain words first and then as
 * data. Receipts live on this device only (last 50 or 7 days).
 */
export function SentView({
  view,
  api,
  titleRef,
}: {
  view: TabDetail;
  api: PopupApi;
  titleRef: RefObject<HTMLHeadingElement | null>;
}) {
  const [receipts, setReceipts] = useState<SentReceipt[] | null>(null);

  useEffect(() => {
    let live = true;
    void api.client.send({ type: 'ui:receipts' }).then((list) => {
      if (live) setReceipts(list ?? []);
    });
    return () => {
      live = false;
    };
  }, [api.client]);

  const forPage =
    receipts && view.domain
      ? (receipts.find(
          (r) => r.domain === view.domain && r.at === view.lastSentAt,
        ) ??
        (view.lastSentAt !== null
          ? receipts.find((r) => r.domain === view.domain)
          : undefined))
      : undefined;
  const summary = forPage ? structureSummary(forPage.body) : null;

  return (
    <section className="pp-sub" aria-labelledby="pp-sent-title">
      <h1
        id="pp-sent-title"
        ref={titleRef}
        tabIndex={-1}
        className="pp-sub__title"
      >
        What was sent
      </h1>
      <p className="pp-note">
        {forPage
          ? `Last sent ${clockTime(forPage.at)} to WebAble’s server`
          : 'Nothing was sent from this page.'}
      </p>

      <div className="pp-sent__lines">
        {forPage ? (
          <p>
            <strong className="pp-sent__key">Sent:</strong>{' '}
            {summary ? `page structure — ${summary}.` : 'page structure.'}
          </p>
        ) : (
          <p>
            <strong className="pp-sent__key">Sent:</strong>{' '}
            {view.onDeviceOnly
              ? 'nothing. Suggestions run on this device only.'
              : 'page structure only, when WebAble is unsure what part of a page is for.'}
          </p>
        )}
        <p>
          <strong className="pp-sent__key">Not sent:</strong> page text,
          anything you typed, your browsing history.
        </p>
      </div>

      {forPage ? (
        <Disclosure
          title="Show the exact data"
          density="compact"
          headingLevel={2}
        >
          <pre
            className="pp-payload"
            tabIndex={0}
            aria-label="The exact data sent"
          >
            {JSON.stringify(forPage.body, null, 2)}
          </pre>
          <p className="pp-note">{`${forPage.bytes.toLocaleString()} bytes`}</p>
        </Disclosure>
      ) : null}

      <div className="pp-sent__more">
        <Button
          variant="ghost"
          size="md"
          href={view.links.privacy}
          arrow="external"
        >
          Everything WebAble sent
        </Button>
      </div>
    </section>
  );
}
