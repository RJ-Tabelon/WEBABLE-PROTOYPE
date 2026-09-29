'use client';

import { Actions, Button, ErrorPanel, TextField } from '@webable/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

import { requestPasswordReset } from '../../../lib/auth/actions';
import {
  callAuthAction,
  checkEmail,
  placeError,
  rememberSentTo,
} from '../../../components/app/forms/auth-forms';

/**
 * Ask for a reset link. The answer is the same whether or not the address has
 * an account, so this form never reveals who uses WebAble.
 */
export function ForgotForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    const emailError = checkEmail(email);
    if (emailError) {
      setError(emailError);
      emailRef.current?.focus();
      return;
    }
    setError(null);
    setPending(true);
    const result = await callAuthAction(() => requestPasswordReset({ email }));
    if (!result.ok) {
      setPending(false);
      const placed = placeError(result.error);
      if (placed.fields.email) {
        setError(placed.fields.email);
        emailRef.current?.focus();
      } else setProblem(placed.form);
      return;
    }
    rememberSentTo(result.sentTo);
    router.push('/check-email?kind=reset');
  }

  return (
    <>
      {problem ? (
        <ErrorPanel
          title="Couldn’t send the link"
          live
          className="wa-auth-error"
        >
          <p>{problem}</p>
        </ErrorPanel>
      ) : null}
      <form
        className="wa-auth-form"
        noValidate
        onSubmit={onSubmit}
        aria-label="Reset your password"
      >
        <TextField
          ref={emailRef}
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error ?? undefined}
        />
        <Actions className="wa-auth-form__submit">
          <Button
            type="submit"
            variant="primary"
            busy={pending}
            busyLabel="Sending…"
          >
            Send reset link
          </Button>
        </Actions>
      </form>
    </>
  );
}
