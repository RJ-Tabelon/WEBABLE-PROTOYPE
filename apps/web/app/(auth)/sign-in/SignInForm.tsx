'use client';

import { Actions, Button, ErrorPanel, TextField, TextLink } from '@webable/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

import { sendMagicLink, signInWithPassword } from '../../../lib/auth/actions';
import {
  checkEmail,
  callAuthAction,
  checkExistingPassword,
  type FieldErrors,
  placeError,
  rememberSentTo,
} from '../../../components/app/forms/auth-forms';
import { PasswordField } from '../../../components/app/forms/PasswordField';

interface FormProblem {
  title: string;
  message: string;
}

export interface SignInFormProps {
  /** Where to go after signing in (already validated by safeNextPath). */
  next: string;
}

/**
 * Sign in with email and password, or ask for an email link instead (no
 * password to type). Errors sit next to the field they belong to; the values
 * the person typed are kept.
 */
export function SignInForm({ next }: SignInFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [pending, setPending] = useState<'password' | 'link' | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function showFieldErrors(errors: FieldErrors) {
    setFields(errors);
    if (errors.email) emailRef.current?.focus();
    else if (errors.password) passwordRef.current?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const errors: FieldErrors = {};
    const emailError = checkEmail(email);
    const passwordError = checkExistingPassword(password);
    if (emailError) errors.email = emailError;
    if (passwordError) errors.password = passwordError;
    setProblem(null);
    if (emailError || passwordError) {
      showFieldErrors(errors);
      return;
    }
    setFields({});
    setPending('password');
    const result = await callAuthAction(() =>
      signInWithPassword({ email, password, next }),
    );
    if (!result.ok) {
      setPending(null);
      const placed = placeError(result.error);
      if (placed.form)
        setProblem({ title: 'Couldn’t sign in', message: placed.form });
      showFieldErrors(placed.fields);
      return;
    }
    router.replace(result.redirectTo);
    router.refresh();
  }

  async function onEmailLink() {
    if (pending) return;
    const emailError = checkEmail(email);
    setProblem(null);
    if (emailError) {
      showFieldErrors({ email: emailError });
      return;
    }
    setFields({});
    setPending('link');
    const result = await callAuthAction(() => sendMagicLink({ email, next }));
    if (!result.ok) {
      setPending(null);
      const placed = placeError(result.error);
      if (placed.form)
        setProblem({ title: 'Couldn’t send the link', message: placed.form });
      showFieldErrors(placed.fields);
      return;
    }
    rememberSentTo(result.sentTo);
    router.push('/check-email?kind=sign-in');
  }

  return (
    <>
      {problem ? (
        <ErrorPanel title={problem.title} live className="wa-auth-error">
          <p>{problem.message}</p>
        </ErrorPanel>
      ) : null}

      <form
        className="wa-auth-form"
        noValidate
        onSubmit={onSubmit}
        aria-label="Sign in"
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
          error={fields.email}
        />
        <PasswordField
          inputRef={passwordRef}
          autoComplete="current-password"
          value={password}
          onValueChange={setPassword}
          error={fields.password}
        />
        <div className="wa-auth-form__row">
          <TextLink href="/forgot-password">Forgot your password?</TextLink>
        </div>
        <Actions className="wa-auth-form__submit">
          <Button
            type="submit"
            variant="primary"
            busy={pending === 'password'}
            busyLabel="Signing in…"
          >
            Sign in
          </Button>
        </Actions>
      </form>

      <p className="wa-auth-divider">or</p>

      <div className="wa-auth-alt">
        <p className="wa-auth-alt__hint">
          Skip the password. We’ll email you a link that signs you in.
        </p>
        <Actions>
          <Button
            variant="secondary"
            onClick={onEmailLink}
            busy={pending === 'link'}
            busyLabel="Sending…"
          >
            Email me a sign-in link
          </Button>
        </Actions>
      </div>
    </>
  );
}
