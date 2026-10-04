'use client';

import { CalmError, type CalmErrorProps } from '../../components/app/CalmError';

export default function ErrorBoundary(props: CalmErrorProps) {
  return <CalmError {...props} />;
}
