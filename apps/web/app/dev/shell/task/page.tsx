import type { Metadata } from 'next';
import { TaskPreview } from './TaskPreview';

export const metadata: Metadata = { title: 'Tune shell preview' };

export default function TaskShellPreview() {
  return <TaskPreview />;
}
