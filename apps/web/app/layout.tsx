import '@webable/tokens/fonts.css';
import '@webable/tokens/tokens.css';
import '@webable/tokens/base.css';
import '@webable/ui/styles.css';
import '../components/shell/shell.css';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { FIT_UI_BOOT_SCRIPT } from '../components/shell/fit-ui';
import { ShellProviders } from '../components/shell/Providers';
import { SkipLink } from '../components/shell/SkipLink';
import { THEME_BOOT_SCRIPT } from '../components/shell/theme';

const siteUrl = process.env.NEXT_PUBLIC_WEB_ORIGIN || 'http://localhost:3000';
const description =
  'WebAble learns how you read, point and focus, then adjusts each site to fit. You see every change and can undo it.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'WebAble', template: '%s · WebAble' },
  description,
  applicationName: 'WebAble',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    siteName: 'WebAble',
    title: 'WebAble. The web, made to measure.',
    description,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'WebAble: the web, made to measure.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WebAble. The web, made to measure.',
    description,
    images: ['/og.png'],
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAFAF7' },
    { media: '(prefers-color-scheme: dark)', color: '#141412' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The boot scripts set data-theme, data-wa-* and --wa-* on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_BOOT_SCRIPT + FIT_UI_BOOT_SCRIPT,
          }}
        />
        <link
          rel="preload"
          href="/fonts/webable-sans-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <SkipLink />
        <ShellProviders>{children}</ShellProviders>
      </body>
    </html>
  );
}
