import type { Metadata } from 'next';

import { safeNextPath } from '../../../lib/auth/routes';
import {
  firstParam,
  isCheckEmailKind,
} from '../../../components/app/forms/auth-forms';
import { CheckEmail } from './CheckEmail';

export const metadata: Metadata = { title: 'Check your email' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * /check-email?kind=sign-in|sign-up|reset&next=/connect. The address itself
 * never travels in the URL; `next` is kept for "Use a different email".
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const kind = firstParam(params.kind);
  const next = safeNextPath(firstParam(params.next));
  return (
    <CheckEmail kind={isCheckEmailKind(kind) ? kind : 'sign-in'} next={next} />
  );
}
