import type { Metadata } from 'next';
import { ChangesView } from './ChangesView';

export const metadata: Metadata = { title: 'Changes' };

/**
 * /app/changes: what WebAble changed on pages, as one sentence about this week
 * and one table by kind of change over 8 weeks, then what it has learned (each
 * part undoable). Domain-free: only weekly counts per change are stored, never
 * sites or pages.
 */
export default function ChangesPage() {
  return <ChangesView />;
}
