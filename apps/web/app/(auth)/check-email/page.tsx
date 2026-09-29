import type { Metadata } from 'next';

import {
  firstParam,
  isCheckEmailKind,
} from '../../../components/app/forms/auth-forms';
import { CheckEmail } from './CheckEmail';

export const metadata: Metadata = { title: 'Check your email' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /check-email?kind=sign-in|sign-up|reset. The address itself never travels in the URL. */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const kind = firstParam((await searchParams).kind);
  return <CheckEmail kind={isCheckEmailKind(kind) ? kind : 'sign-in'} />;
}
