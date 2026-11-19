import { useEffect, useState, type RefObject } from 'react';
import type { SentReceipt } from '@webable/core/bridge/protocol';
import { Button, Disclosure } from '@webable/ui';

import { receiptForPage, sentCopy } from '@/lib/popup/sent';
import type { TabDetail } from '@/lib/sw/ui';

import type { PopupApi } from './usePopup';

/**
 * "What was sent" (design-final 10.3, ai-architecture 9, docs/10 §8): the
 * exact request body that left the device for this page, page analysis or
 * Fit view layout planning, in plain words first and then as data. Receipts
 * live on this device only (last 50 or 7 days).
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

  const forPage = receiptForPage(receipts, view);
  const copy = sentCopy(view, forPage);

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
      <p className="pp-note">{copy.lead}</p>

      <div className="pp-sent__lines">
        <p>
          <strong className="pp-sent__key">Sent:</strong> {copy.sent}
        </p>
        <p>
          <strong className="pp-sent__key">Not sent:</strong> {copy.notSent}
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
