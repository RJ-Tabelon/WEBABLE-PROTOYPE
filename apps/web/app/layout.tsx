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
import { withBase } from '../lib/base-path';

/* The brand sans (Latin) is also served from /fonts so the <head> can preload it.
   Same family and descriptors as fonts.css; this later rule wins, so the file is
   fetched once, from the preloaded URL. Inline so the URL carries the base path. */
const BRAND_FONT_URL = withBase('/fonts/webable-sans-latin.woff2');
const BRAND_FONT_FACE = `@font-face{font-family:'WebAble Sans';src:url('${BRAND_FONT_URL}') format('woff2');font-weight:200 800;font-style:normal;font-display:swap;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;

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
      { url: withBase('/favicon.ico'), sizes: '32x32' },
      { url: withBase('/icon.svg'), type: 'image/svg+xml' },
    ],
    apple: [{ url: withBase('/apple-touch-icon.png'), sizes: '180x180' }],
  },
  manifest: withBase('/manifest.webmanifest'),
  openGraph: {
    type: 'website',
    siteName: 'WebAble',
    title: 'WebAble. The web, made to measure.',
    description,
    images: [
      {
        url: withBase('/og.png'),
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
    images: [withBase('/og.png')],
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
        <style dangerouslySetInnerHTML={{ __html: BRAND_FONT_FACE }} />
        <link
          rel="preload"
          href={BRAND_FONT_URL}
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
