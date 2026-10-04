'use client';

import type { SentReceipt } from '@webable/core';
import {
  Button,
  Disclosure,
  ErrorPanel,
  StatusGlyph,
  TextLink,
} from '@webable/ui';
import { useCallback, useEffect, useState } from 'react';

import { type BridgeFailure, extension } from '../../../lib/extension/bridge';
import { useExtension } from '../../../lib/extension/useExtension';
import { formatBytes, formatMoment, plural } from '../format';

type Load =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; receipts: SentReceipt[] }
  | { phase: 'failed'; error: BridgeFailure };

const PAGE = 20;

/** Sent on this window when "Clear this browser's WebAble data" finishes. */
export const LOCAL_CLEARED_EVENT = 'wa-local-cleared';

/** The exact request body, pretty-printed. Never throws. */
export function payloadText(body: unknown): string {
  try {
    const text = JSON.stringify(body, null, 2);
    return text === undefined ? 'Nothing' : text;
  } catch {
    return 'This request can’t be shown.';
  }
}

/**
 * "What was sent": every page-analysis request that left this browser, with the
 * exact body behind a disclosure. The receipts live in the extension; the site
 * name is shown from this browser only and was never part of what was sent.
 */
export function Receipts({ cloudAnalysis }: { cloudAnalysis: boolean }) {
  const { state, recheck } = useExtension();
  const [load, setLoad] = useState<Load>({ phase: 'idle' });
  const [limit, setLimit] = useState(PAGE);

  const read = useCallback(async () => {
    setLoad((current) =>
      current.phase === 'ready' ? current : { phase: 'loading' },
    );
    const result = await extension.receipts();
    setLoad(
      result.ok
        ? {
            phase: 'ready',
            receipts: [...result.data].sort((a, b) => b.at - a.at),
          }
        : { phase: 'failed', error: result.error },
    );
  }, []);

  const installed = state.phase === 'ready';
  useEffect(() => {
    if (installed) void read();
  }, [installed, read]);

  // "Clear this browser's WebAble data" (in Your data) empties this list too.
  useEffect(() => {
    const onCleared = () => setLoad({ phase: 'ready', receipts: [] });
    window.addEventListener(LOCAL_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(LOCAL_CLEARED_EVENT, onCleared);
  }, []);

  if (
    state.phase === 'checking' ||
    (installed && (load.phase === 'idle' || load.phase === 'loading'))
  ) {
    return (
      <p className="wa-browser-status" role="status">
        <span className="wa-browser-status__text">
          <StatusGlyph state="checking" />
          Reading this browser’s list…
        </span>
      </p>
    );
  }

  if (state.phase === 'missing') {
    return (
      <p className="wa-app-prose">
        WebAble isn’t installed in this browser, so nothing was sent from it.{' '}
        <TextLink href="/connect">Add WebAble</TextLink>
      </p>
    );
  }

  if (state.phase === 'error' || load.phase === 'failed') {
    const error =
      state.phase === 'error'
        ? state.error
        : load.phase === 'failed'
          ? load.error
          : null;
    return (
      <ErrorPanel
        title="Couldn’t read this browser’s list"
        live
        as="h3"
        action={
          <Button
            variant="secondary"
            iconStart="refresh-cw"
            onClick={() => void (state.phase === 'error' ? recheck() : read())}
          >
            Try again
          </Button>
        }
      >
        <p>{error?.message}</p>
      </ErrorPanel>
    );
  }

  if (load.phase !== 'ready') return null;
  const receipts = load.receipts;

  return (
    <>
      {receipts.length === 0 ? (
        <div className="wa-app-prose">
          <p>Nothing has been sent from this browser.</p>
          <p className="wa-app-meta">
            {cloudAnalysis
              ? 'When WebAble sends page structure for analysis, the exact request shows up here.'
              : 'Page analysis is off, so nothing will be sent.'}
          </p>
        </div>
      ) : (
        <>
          <p className="wa-app-meta">
            {plural(receipts.length, 'request')} from this browser, newest
            first. Site names are shown from this browser only. They were never
            part of what was sent.
          </p>
          <ul
            role="list"
            className="wa-rows"
            aria-label="Requests sent from this browser"
          >
            {receipts.slice(0, limit).map((receipt) => (
              <li key={receipt.id} className="wa-receipt">
                <div className="wa-receipt__head">
                  <p className="wa-row__label">{receipt.domain || 'A page'}</p>
                  <p className="wa-row__detail">
                    <time dateTime={new Date(receipt.at).toISOString()}>
                      {formatMoment(receipt.at)}
                    </time>
                    {` · ${formatBytes(receipt.bytes)} to page analysis`}
                  </p>
                </div>
                <Disclosure
                  title="Exactly what was sent"
                  density="compact"
                  headingLevel={null}
                >
                  <pre
                    className="wa-payload"
                    tabIndex={0}
                    aria-label="Request body"
                  >
                    {payloadText(receipt.body)}
                  </pre>
                </Disclosure>
              </li>
            ))}
          </ul>
          {receipts.length > limit ? (
            <div>
              <Button
                variant="secondary"
                onClick={() => setLimit((n) => n + PAGE)}
              >
                Show {Math.min(PAGE, receipts.length - limit)} more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
