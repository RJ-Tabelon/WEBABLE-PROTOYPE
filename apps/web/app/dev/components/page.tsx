import type { Metadata } from 'next';
import { Gallery } from './Gallery';

export const metadata: Metadata = {
  title: 'Components',
  description:
    'Every WebAble component in every state, in both themes. For design review.',
  robots: { index: false, follow: false },
};

export default async function ComponentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await searchParams;
  return <Gallery only={typeof section === 'string' ? section : null} />;
}
