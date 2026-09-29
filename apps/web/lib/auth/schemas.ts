import { z } from 'zod';

import { type AuthActionError, type AuthErrorCode, authError } from './errors';

/**
 * Input schemas for the auth server actions. Actions accept either a plain object
 * or the FormData a <form action={...}> posts, so forms work before hydration.
 */

export const PASSWORD_MIN = 8;
/** bcrypt ignores bytes after 72, so longer passwords would silently truncate. */
export const PASSWORD_MAX_BYTES = 72;

const email = z
  .string({ error: 'invalid_email' })
  .trim()
  .toLowerCase()
  .max(254, { error: 'invalid_email' })
  .pipe(z.email({ error: 'invalid_email' }));

const existingPassword = z
  .string({ error: 'password_required' })
  .min(1, { error: 'password_required' })
  .max(1024, { error: 'invalid_input' });

const newPassword = z
  .string({ error: 'password_required' })
  .min(1, { error: 'password_required' })
  .refine((value) => [...value].length >= PASSWORD_MIN, {
    error: 'weak_password',
  })
  .refine(
    (value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES,
    { error: 'weak_password' },
  );

const next = z.string().max(4096).optional();

export const signInSchema = z.object({
  email,
  password: existingPassword,
  next,
});
export const signUpSchema = z.object({ email, password: newPassword, next });
export const magicLinkSchema = z.object({ email, next });
export const passwordResetSchema = z.object({ email });
export const updatePasswordSchema = z.object({ password: newPassword, next });
export const signOutSchema = z.object({
  scope: z.enum(['local', 'global']).default('local'),
});

export type SignInInput = z.input<typeof signInSchema>;
export type SignUpInput = z.input<typeof signUpSchema>;
export type MagicLinkInput = z.input<typeof magicLinkSchema>;
export type PasswordResetInput = z.input<typeof passwordResetSchema>;
export type UpdatePasswordInput = z.input<typeof updatePasswordSchema>;
export type SignOutInput = z.input<typeof signOutSchema>;

/** Keep only string fields from FormData (files and repeated keys are ignored). */
export function formToObject(
  form: FormData,
  keys: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = form.get(key);
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** Codes a schema issue may carry as its message; anything else becomes invalid_input. */
const SCHEMA_CODES: ReadonlySet<string> = new Set<AuthErrorCode>([
  'invalid_email',
  'password_required',
  'weak_password',
  'invalid_input',
]);

function isSchemaCode(value: string | undefined): value is AuthErrorCode {
  return value !== undefined && SCHEMA_CODES.has(value);
}

/** Validate action input; the first issue becomes a plain-language error. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  keys: readonly string[],
): { ok: true; data: z.output<S> } | { ok: false; error: AuthActionError } {
  const raw = input instanceof FormData ? formToObject(input, keys) : input;
  const result = schema.safeParse(raw ?? {});
  if (result.success) return { ok: true, data: result.data };
  const message = result.error.issues[0]?.message;
  return {
    ok: false,
    error: authError(isSchemaCode(message) ? message : 'invalid_input'),
  };
}
