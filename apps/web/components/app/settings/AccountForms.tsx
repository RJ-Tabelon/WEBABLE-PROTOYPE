'use client';

import {
  Actions,
  Button,
  CheckGlyph,
  ErrorPanel,
  TextField,
} from '@webable/ui';
import { type FormEvent, useRef, useState } from 'react';

import { changeEmailAction } from '../../../app/app/settings/actions';
import { updatePassword } from '../../../lib/auth/actions';
import { PASSWORD_MIN } from '../../../lib/auth/schemas';
import {
  callAuthAction,
  checkEmail,
  checkNewPassword,
  placeError,
} from '../forms/auth-forms';
import { PasswordField } from '../forms/PasswordField';

/** Change the sign-in email. Nothing changes until the confirmation link is opened. */
export function EmailForm({ current }: { current: string | null }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    const emailError = checkEmail(email);
    if (emailError) {
      setError(emailError);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setPending(true);
    const result = await callAuthAction(() => changeEmailAction({ email }));
    setPending(false);
    if (!result.ok) {
      const placed = placeError(result.error);
      if (placed.fields.email) {
        setError(placed.fields.email);
        inputRef.current?.focus();
      } else setProblem(placed.form);
      return;
    }
    setSentTo(result.sentTo);
    setEmail('');
  }

  return (
    <form
      className="wa-app-form"
      noValidate
      onSubmit={onSubmit}
      aria-label="Change email"
    >
      <p className="wa-row__detail">
        {current ? (
          <>
            You sign in as <strong>{current}</strong>.
          </>
        ) : (
          'Your account has no email address.'
        )}
      </p>
      <TextField
        ref={inputRef}
        label="New email"
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
        hint="We’ll send a link to confirm it. Nothing changes until you open it."
      />
      {problem ? (
        <ErrorPanel title="Couldn’t change your email" live as="p">
          <p>{problem}</p>
        </ErrorPanel>
      ) : null}
      {sentTo ? (
        <p className="wa-app-form__done" role="status">
          <CheckGlyph size={16} />
          <span>
            Link sent to {sentTo}. Open it to finish. Your current address may
            get one too.
          </span>
        </p>
      ) : null}
      <Actions>
        <Button
          type="submit"
          variant="secondary"
          busy={pending}
          busyLabel="Sending…"
        >
          Change email
        </Button>
      </Actions>
    </form>
  );
}

/** Set a new password for this account. */
export function PasswordForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    setDone(false);
    const passwordError = checkNewPassword(password);
    if (passwordError) {
      setError(passwordError);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setPending(true);
    const result = await callAuthAction(() => updatePassword({ password }));
    setPending(false);
    if (!result.ok) {
      const placed = placeError(result.error);
      if (placed.fields.password) {
        setError(placed.fields.password);
        inputRef.current?.focus();
      } else setProblem(placed.form);
      return;
    }
    setPassword('');
    setDone(true);
  }

  return (
    <form
      className="wa-app-form"
      noValidate
      onSubmit={onSubmit}
      aria-label="Change password"
    >
      <PasswordField
        inputRef={inputRef}
        label="New password"
        autoComplete="new-password"
        value={password}
        onValueChange={setPassword}
        error={error}
        hint={`At least ${PASSWORD_MIN} characters. You can also sign in with an email link instead.`}
      />
      {problem ? (
        <ErrorPanel title="Couldn’t change your password" live as="p">
          <p>{problem}</p>
        </ErrorPanel>
      ) : null}
      {done ? (
        <p className="wa-app-form__done" role="status">
          <CheckGlyph size={16} />
          <span>Password changed.</span>
        </p>
      ) : null}
      <Actions>
        <Button
          type="submit"
          variant="secondary"
          busy={pending}
          busyLabel="Saving…"
        >
          Save password
        </Button>
      </Actions>
    </form>
  );
}
