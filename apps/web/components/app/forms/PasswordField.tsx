'use client';

import { Checkbox, TextField } from '@webable/ui';
import { useId, useState, type Ref } from 'react';

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
}: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div className="wa-password">
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
      </Checkbox>
    </div>
  );
}
