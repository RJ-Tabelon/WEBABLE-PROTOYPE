'use client';

import { Checkbox, cx, TextField } from '@webable/ui';
import { type ReactNode, useId, useState, type Ref } from 'react';

export interface PasswordFieldProps {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  /** `current-password` to sign in, `new-password` to create or change one. */
  autoComplete: 'current-password' | 'new-password';
  error?: string | null;
  hint?: string;
  name?: string;
  inputRef?: Ref<HTMLInputElement>;
  /**
   * A meta link at the right end of the label row ("Forgot your password?").
   * It comes before the input in the DOM, so reading and focus order follow
   * what the eye sees: label, link, field.
   */
  labelAside?: ReactNode;
  /**
   * Screen-reader words after "Show password" when a form has two password
   * fields ("current", "new"), so the two checkboxes have different names.
   */
  toggleContext?: string;
}

/**
 * Password input with a "Show password" checkbox under it, so the person can
 * check what they typed without an icon-only control. Paste is never blocked.
 */
export function PasswordField({
  label = 'Password',
  value,
  onValueChange,
  autoComplete,
  error,
  hint,
  name = 'password',
  inputRef,
  labelAside,
  toggleContext,
}: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div
      className={cx('wa-password', labelAside ? 'wa-password--aside' : null)}
    >
      {labelAside ? (
        <div className="wa-password__aside">{labelAside}</div>
      ) : null}
      <TextField
        ref={inputRef}
        id={`${id}-password`}
        label={label}
        name={name}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        error={error ?? undefined}
        hint={hint}
      />
      <Checkbox
        checked={shown}
        onCheckedChange={setShown}
        className="wa-inline-toggle"
      >
        Show password
        {toggleContext ? (
          <span className="sr-only"> ({toggleContext})</span>
        ) : null}
      </Checkbox>
    </div>
  );
}
