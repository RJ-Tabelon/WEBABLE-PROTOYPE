'use client';

import { Actions, Button, CheckGlyph, ErrorPanel } from '@webable/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { updatePassword } from '../../../lib/auth/actions';
import { PASSWORD_MIN } from '../../../lib/auth/schemas';
import {
  callAuthAction,
  checkNewPassword,
  placeError,
} from '../../../components/app/forms/auth-forms';
import { PasswordField } from '../../../components/app/forms/PasswordField';

/** Choose a new password (the recovery link has already signed this browser in). */
export function ResetForm({ next }: { next: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    const passwordError = checkNewPassword(password);
    if (passwordError) {
      setError(passwordError);
      passwordRef.current?.focus();
      return;
    }
    setError(null);
    setPending(true);
    const result = await callAuthAction(() =>
      updatePassword({ password, next }),
    );
    setPending(false);
    if (!result.ok) {
      const placed = placeError(result.error);
      if (placed.fields.password) {
        setError(placed.fields.password);
        passwordRef.current?.focus();
      } else setProblem(placed.form);
      return;
    }
    setPassword('');
    setDone(result.redirectTo);
  }

  if (done) {
    return (
      <div className="wa-connect" role="status">
        <div className="wa-auth-notice">
          <CheckGlyph size={20} />
          <div>
            <h2 ref={doneRef} tabIndex={-1} className="wa-connect__dev-title">
              Password changed
            </h2>
            <p>Use it the next time you sign in.</p>
          </div>
        </div>
        <Actions>
          <Button href={done} variant="primary" arrow="forward">
            Continue
          </Button>
        </Actions>
      </div>
    );
  }

  return (
    <>
      {problem ? (
        <ErrorPanel
          title="Couldn’t change your password"
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
        aria-label="Choose a new password"
      >
        <PasswordField
          inputRef={passwordRef}
          label="New password"
          autoComplete="new-password"
          value={password}
          onValueChange={setPassword}
          error={error}
          hint={`At least ${PASSWORD_MIN} characters.`}
        />
        <Actions className="wa-auth-form__submit">
          <Button
            type="submit"
            variant="primary"
            busy={pending}
            busyLabel="Saving…"
          >
            Save password
          </Button>
        </Actions>
      </form>
    </>
  );
}
