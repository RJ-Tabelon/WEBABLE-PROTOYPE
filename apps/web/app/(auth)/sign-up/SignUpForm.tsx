'use client';

import { Actions, Button, ErrorPanel, TextField } from '@webable/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useRef, useState } from 'react';

import { sendMagicLink, signUpWithPassword } from '../../../lib/auth/actions';
import { PASSWORD_MIN } from '../../../lib/auth/schemas';
import {
  callAuthAction,
  checkEmail,
  checkNewPassword,
  type FieldErrors,
  placeError,
  rememberSentTo,
  withNext,
} from '../../../components/app/forms/auth-forms';
import { PasswordField } from '../../../components/app/forms/PasswordField';

interface FormProblem {
  title: string;
  message: string;
}

/**
 * Create an account with email and password, or with an email link and no
 * password at all: both actions sit in one row under the fields. Nothing is
 * pre-ticked and nothing else is signed up for.
 */
export function SignUpForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [pending, setPending] = useState<'password' | 'link' | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const linkHintId = useId();

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
    const passwordError = checkNewPassword(password);
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
      signUpWithPassword({ email, password, next }),
    );
    if (!result.ok) {
      setPending(null);
      const placed = placeError(result.error);
      if (placed.form)
        setProblem({
          title: 'Couldn’t create your account',
          message: placed.form,
        });
      showFieldErrors(placed.fields);
      return;
    }
    if (result.needsConfirmation) {
      rememberSentTo(email.trim().toLowerCase());
      router.push(withNext('/check-email?kind=sign-up', next));
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
    router.push(withNext('/check-email?kind=sign-in', next));
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
        aria-label="Create your account"
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
          label="Choose a password"
          autoComplete="new-password"
          value={password}
          onValueChange={setPassword}
          error={fields.password}
          hint={`At least ${PASSWORD_MIN} characters. A short phrase works well.`}
        />
        <div className="wa-auth-form__actions">
          <Actions>
            <Button
              type="submit"
              variant="primary"
              busy={pending === 'password'}
              busyLabel="Creating…"
            >
              Create account
            </Button>
            <Button
              variant="secondary"
              onClick={onEmailLink}
              busy={pending === 'link'}
              busyLabel="Sending…"
              aria-describedby={linkHintId}
            >
              Email me a link instead
            </Button>
          </Actions>
          <p id={linkHintId} className="wa-auth-form__hint">
            A link signs you in without a password.
          </p>
        </div>
      </form>
    </>
  );
}
