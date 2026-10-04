'use client';

import {
  Actions,
  Button,
  CheckGlyph,
  ErrorPanel,
  TextField,
} from '@webable/ui';
import { type FormEvent, useRef, useState } from 'react';

import {
  changeEmailAction,
  changePasswordAction,
  type PasswordFormField,
} from '../../../app/app/settings/actions';
import { PASSWORD_MIN } from '../../../lib/auth/schemas';
import {
  callAuthAction,
  checkEmail,
  checkExistingPassword,
  checkNewPassword,
  placeError,
} from '../forms/auth-forms';
import { PasswordField } from '../forms/PasswordField';
import { EditableRow } from './EditableRow';

function Done({ children }: { children: string }) {
  return (
    <p className="wa-app-form__done" role="status">
      <CheckGlyph size={16} />
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------------ */
/* Email                                                                      */
/* ------------------------------------------------------------------------ */

function EmailEditor({
  onSent,
  onCancel,
}: {
  onSent: (to: string) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
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
    onSent(result.sentTo);
  }

  return (
    <form
      className="wa-app-form"
      noValidate
      onSubmit={onSubmit}
      aria-label="Change email"
    >
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
      <Actions>
        <Button
          type="submit"
          variant="primary"
          size="md"
          busy={pending}
          busyLabel="Sending…"
        >
          Send link
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
      </Actions>
    </form>
  );
}

/** Email · alex@example.com [Change]. Nothing changes until the link is opened. */
export function EmailRow({ current }: { current: string | null }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  return (
    <EditableRow
      label="Email"
      value={current ?? 'None yet'}
      action={current ? 'Change' : 'Add an email'}
      actionContext="email"
      note={
        sentTo ? (
          <Done>{`Link sent to ${sentTo}. Open it to finish.`}</Done>
        ) : null
      }
    >
      {(close) => (
        <EmailEditor
          onCancel={close}
          onSent={(to) => {
            setSentTo(to);
            close();
          }}
        />
      )}
    </EditableRow>
  );
}

/* ------------------------------------------------------------------------ */
/* Password                                                                   */
/* ------------------------------------------------------------------------ */

type PasswordErrors = Partial<Record<PasswordFormField, string>>;

function PasswordEditor({
  hasPassword,
  onSaved,
  onCancel,
}: {
  hasPassword: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function show(next: PasswordErrors) {
    setErrors(next);
    if (next.current) currentRef.current?.focus();
    else if (next.password) passwordRef.current?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    const next: PasswordErrors = {};
    const currentError = hasPassword ? checkExistingPassword(current) : null;
    const passwordError = checkNewPassword(password);
    if (currentError) next.current = currentError;
    if (passwordError) next.password = passwordError;
    if (currentError || passwordError) {
      show(next);
      return;
    }
    setErrors({});
    setPending(true);
    let result: Awaited<ReturnType<typeof changePasswordAction>>;
    try {
      result = await changePasswordAction(
        hasPassword ? { current, password } : { password },
      );
    } catch {
      result = {
        ok: false,
        error: {
          code: 'unavailable',
          message:
            'WebAble couldn’t reach the sign-in service. Nothing changed. Try again in a moment.',
        },
      };
    }
    setPending(false);
    if (!result.ok) {
      if (result.error.field)
        show({ [result.error.field]: result.error.message });
      else setProblem(result.error.message);
      return;
    }
    onSaved();
  }

  return (
    <form
      className="wa-app-form"
      noValidate
      onSubmit={onSubmit}
      aria-label={hasPassword ? 'Change password' : 'Add a password'}
    >
      {hasPassword ? (
        <PasswordField
          inputRef={currentRef}
          label="Current password"
          name="current-password"
          autoComplete="current-password"
          value={current}
          onValueChange={setCurrent}
          error={errors.current}
          toggleContext="current"
        />
      ) : null}
      <PasswordField
        inputRef={passwordRef}
        label="New password"
        name="new-password"
        autoComplete="new-password"
        value={password}
        onValueChange={setPassword}
        error={errors.password}
        hint={`At least ${PASSWORD_MIN} characters`}
        toggleContext={hasPassword ? 'new' : undefined}
      />
      {problem ? (
        <ErrorPanel title="Your password wasn’t changed" live as="p">
          <p>{problem}</p>
        </ErrorPanel>
      ) : null}
      <Actions>
        <Button
          type="submit"
          variant="primary"
          size="md"
          busy={pending}
          busyLabel="Saving…"
        >
          Save
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
      </Actions>
    </form>
  );
}

/**
 * Password · Set [Change], or Not set [Add a password] for an account that only
 * uses email links. Changing it asks for the current password first.
 */
export function PasswordRow({
  hasPassword: initial,
}: {
  hasPassword: boolean;
}) {
  const [hasPassword, setHasPassword] = useState(initial);
  const [saved, setSaved] = useState<'changed' | 'added' | null>(null);
  return (
    <EditableRow
      label="Password"
      value={hasPassword ? 'Set' : 'Not set'}
      action={hasPassword ? 'Change' : 'Add a password'}
      actionContext={hasPassword ? 'password' : undefined}
      note={
        saved ? (
          <Done>
            {saved === 'added' ? 'Password added.' : 'Password changed.'}
          </Done>
        ) : null
      }
    >
      {(close) => (
        <PasswordEditor
          hasPassword={hasPassword}
          onCancel={close}
          onSaved={() => {
            setSaved(hasPassword ? 'changed' : 'added');
            setHasPassword(true);
            close();
          }}
        />
      )}
    </EditableRow>
  );
}
