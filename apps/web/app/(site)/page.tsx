import type { Metadata } from 'next';
import { HomePage } from '../../components/site/home/HomePage';

export const metadata: Metadata = {
  title: { absolute: 'WebAble · The web, made to measure' },
  alternates: { canonical: '/' },
};

export default function Home() {
  return <HomePage />;
}
