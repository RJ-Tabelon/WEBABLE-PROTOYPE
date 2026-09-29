'use client';

import { Actions, Button, CheckGlyph, ErrorPanel } from '@webable/ui';
import { useEffect, useId, useState } from 'react';

import { requestPasswordReset, sendMagicLink } from '../../../lib/auth/actions';
import { AuthHeading } from '../_components/AuthHeading';
import {
  callAuthAction,
  type CheckEmailKind,
  readSentTo,
} from '../../../components/app/forms/auth-forms';

/** Seconds before another link can be requested (the mailer limits bursts). */
export const RESEND_AFTER_S = 30;

const COPY: Record<
  CheckEmailKind,
  { lead: (to: string) => string; back: { href: string; label: string } }
> = {
  'sign-in': {
    lead: (to) =>
      `We sent a sign-in link to ${to}. Open it on this device to finish signing in.`,
    back: { href: '/sign-in', label: 'Use a different email' },
  },
  'sign-up': {
    lead: (to) =>
      `We sent a link to ${to}. Open it to confirm your address and finish signing up.`,
    back: { href: '/sign-up', label: 'Use a different email' },
  },
  reset: {
    lead: (to) =>
      `If ${to} has a WebAble account, we sent it a link to choose a new password.`,
    back: { href: '/forgot-password', label: 'Use a different email' },
  },
};

/**
 * "Check your email". The address comes from this tab's session storage (it is
 * never put in the URL); without it the copy stays general and there is no resend.
 */
export function CheckEmail({ kind }: { kind: CheckEmailKind }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [resent, setResent] = useState(false);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const hintId = useId();

  useEffect(() => {
    setSentTo(readSentTo());
  }, []);

  // One quiet wait before a new link can be requested; no ticking countdown.
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setReady(true), RESEND_AFTER_S * 1000);
    return () => clearTimeout(timer);
  }, [ready]);

  const copy = COPY[kind];

  async function resend() {
    if (!sentTo || sending || !ready) return;
    setSending(true);
    setProblem(null);
    const result = await callAuthAction(() =>
      kind === 'reset'
        ? requestPasswordReset({ email: sentTo })
        : sendMagicLink({ email: sentTo }),
    );
    setSending(false);
    if (!result.ok) {
      setProblem(result.error.message);
      return;
    }
    setResent(true);
    setReady(false);
  }

  return (
    <>
      <AuthHeading
        title="Check your email"
        deck={copy.lead(sentTo ?? 'your email address')}
      />

      <div className="wa-connect">
        <ul role="list" className="wa-connect__facts">
          <li>
            <CheckGlyph size={16} />
            <span>The link works once.</span>
          </li>
          <li>
            <CheckGlyph size={16} />
            <span>
              It can take a minute to arrive. Check your spam folder too.
            </span>
          </li>
        </ul>

        {problem ? (
          <ErrorPanel title="Couldn’t send another link" live>
            <p>{problem}</p>
          </ErrorPanel>
        ) : null}

        <div className="wa-auth-alt">
          <p className="sr-only" role="status">
            {resent ? 'Sent. Check your email again.' : ''}
          </p>
          {sentTo ? (
            <p id={hintId} className="wa-auth-alt__hint">
              {resent && !ready
                ? 'Sent again. You can ask for another link after 30 seconds.'
                : ready
                  ? 'Didn’t get it? Ask for another link.'
                  : 'Didn’t get it? You can ask for another link after 30 seconds.'}
            </p>
          ) : null}
          <Actions>
            {sentTo ? (
              <Button
                variant="secondary"
                onClick={resend}
                busy={sending}
                busyLabel="Sending…"
                disabled={!ready}
                aria-describedby={hintId}
              >
                Send another link
              </Button>
            ) : null}
            <Button href={copy.back.href} variant="ghost">
              {copy.back.label}
            </Button>
          </Actions>
        </div>
      </div>
    </>
  );
}
