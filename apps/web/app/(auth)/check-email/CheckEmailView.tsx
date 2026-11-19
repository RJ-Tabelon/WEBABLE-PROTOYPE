'use client';

import { useSearchParams } from 'next/navigation';

import { isCheckEmailKind } from '../../../components/app/forms/auth-forms';
import { safeNextPath } from '../../../lib/auth/routes';
import { CheckEmail } from './CheckEmail';

export function CheckEmailView() {
  const params = useSearchParams();
  const kind = params.get('kind') ?? undefined;
  const next = safeNextPath(params.get('next'));
  return (
    <CheckEmail kind={isCheckEmailKind(kind) ? kind : 'sign-in'} next={next} />
  );
}
